/**
 * 文档解析：从 Storage 下载并按类型解析为文本切片
 * txt/md：智能切片 (DeepSeek) + 语义增强 (DeepSeek)
 * pdf：Mistral OCR → Markdown → 智能切片 (DeepSeek) + 语义增强 (DeepSeek)
 * 其他（docx/xlsx/pptx/csv/html/png/jpg 等）：Markitdown API → Markdown → 智能切片 + 语义增强
 * video：方舟视频理解 → 结构化 Markdown（时间戳分段）→ 智能切片 + 语义增强
 * audio：豆包语音识别极速版 → 带时间戳 Markdown → 智能切片 + 语义增强
 *
 * pointer 溯源规则：
 *   pdf   → "p.N"（页码，从 OCR 分页结果推断）
 *   video → "HH:mm:ss"（时间戳，从 Markdown 标题 ### [HH:mm:ss ~ ...] 提取）
 *   audio → "HH:mm:ss"（时间戳，从 Markdown **[HH:mm:ss ~ ...]** 提取）
 *   其他  → null
 */
import { supabase } from "../lib/supabase.js";
import { smartChunkWithDeepSeek } from "../parsers/smartChunkingParser.js";
import { enrichChunks } from "./semanticEnrichmentService.js";
import { parsePdfWithMistralOcr } from "../parsers/mistralOcrParser.js";
import { convertToMarkdown, getMimeTypeByExt, shouldUseMarkitdown } from "../parsers/markitdownParser.js";
import { parseVideoWithArk } from "../parsers/arkVideoParser.js";
import { parseAudioWithDoubao, getAudioFormat } from "../parsers/arkAudioParser.js";
export async function parseDocument(documentId, storagePath, type) {
    if (!supabase)
        throw new Error("Supabase 未配置");
    const { data, error } = await supabase.storage.from("documents").download(storagePath);
    if (error || !data)
        throw new Error(error?.message ?? "下载文件失败");
    switch (type) {
        case "txt":
        case "md": {
            const text = await data.text();
            if (!text || !text.trim())
                throw new Error("文件内容为空");
            return parseMarkdownText(text, documentId, type);
        }
        case "pdf": {
            const arrayBuffer = await data.arrayBuffer();
            const pdfBuffer = Buffer.from(arrayBuffer);
            console.log(`[parseDocument] 开始 Mistral OCR 解析 PDF，大小: ${pdfBuffer.length} bytes`);
            const ocrResult = await parsePdfWithMistralOcr(pdfBuffer, true);
            const mdText = ocrResult.fullMarkdown;
            console.log(`[parseDocument] OCR 完成，共 ${ocrResult.pages.length} 页，Markdown 长度: ${mdText.length}`);
            if (!mdText || !mdText.trim())
                throw new Error("PDF OCR 结果为空");
            // 构建页码 pointer 映射：记录每页 Markdown 的字符范围
            const pagePointers = buildPdfPagePointers(ocrResult.pages, mdText);
            return parseMarkdownText(mdText, documentId, "md", pagePointers);
        }
        case "video": {
            const { data: signedData, error: signError } = await supabase.storage
                .from("documents")
                .createSignedUrl(storagePath, 3600);
            if (signError || !signedData?.signedUrl) {
                throw new Error(`生成视频签名 URL 失败: ${signError?.message ?? "未知错误"}`);
            }
            console.log(`[parseDocument] 开始方舟视频理解，storagePath: ${storagePath}`);
            const videoResult = await parseVideoWithArk(signedData.signedUrl);
            console.log(`[parseDocument] 视频理解完成，Markdown 长度: ${videoResult.markdown.length}`);
            if (!videoResult.markdown.trim())
                throw new Error("视频理解结果为空");
            return parseMarkdownText(videoResult.markdown, documentId, "md", null, "video");
        }
        case "audio": {
            const fileName = storagePath.split("/").pop() ?? "audio.mp3";
            const ext = fileName.split(".").pop() ?? "mp3";
            const format = getAudioFormat(ext);
            const arrayBuffer = await data.arrayBuffer();
            const audioBuffer = Buffer.from(arrayBuffer);
            console.log(`[parseDocument] 开始豆包语音识别，格式: ${format}，大小: ${(audioBuffer.length / 1024).toFixed(1)} KB`);
            const audioResult = await parseAudioWithDoubao(audioBuffer, format);
            console.log(`[parseDocument] 音频识别完成，时长: ${audioResult.durationMs}ms，Markdown 长度: ${audioResult.markdown.length}`);
            if (!audioResult.markdown.trim())
                throw new Error("音频识别结果为空");
            return parseMarkdownText(audioResult.markdown, documentId, "md", null, "audio");
        }
        default: {
            if (!shouldUseMarkitdown(type)) {
                throw new Error(`不支持解析的类型: ${type}`);
            }
            const fileName = storagePath.split("/").pop() ?? `file.${type}`;
            const ext = fileName.split(".").pop() ?? type;
            const mimeType = getMimeTypeByExt(ext);
            const arrayBuffer = await data.arrayBuffer();
            const fileBuffer = Buffer.from(arrayBuffer);
            console.log(`[parseDocument] 开始 Markitdown 转换，类型: ${type}，文件: ${fileName}`);
            const mdText = await convertToMarkdown(fileBuffer, fileName, mimeType);
            console.log(`[parseDocument] Markitdown 转换完成，Markdown 长度: ${mdText.length}`);
            if (!mdText || !mdText.trim())
                throw new Error("Markitdown 转换结果为空");
            return parseMarkdownText(mdText, documentId, "md");
        }
    }
}
// ─── Pointer 提取工具函数 ─────────────────────────────────────────────
/**
 * PDF：根据 OCR 分页结果，构建每页内容的字符偏移范围。
 * 返回数组：[{ page: 1, startOffset: 0, endOffset: 500 }, ...]
 * 用于后续按 chunk 内容的字符位置推断所属页码。
 */
function buildPdfPagePointers(pages, fullMarkdown) {
    const result = [];
    let searchFrom = 0;
    for (const page of pages) {
        const pageContent = page.markdown?.trim();
        if (!pageContent)
            continue;
        // 取页面内容的前 100 字符作为定位锚点（避免 base64 图片干扰）
        const anchor = pageContent.slice(0, 100).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const match = fullMarkdown.slice(searchFrom).search(new RegExp(anchor));
        if (match === -1)
            continue;
        const startOffset = searchFrom + match;
        const endOffset = startOffset + pageContent.length + 20; // 加少量余量
        result.push({ page: page.index + 1, startOffset, endOffset });
        searchFrom = startOffset + 1;
    }
    return result;
}
/**
 * 根据 chunk 内容在全文中的位置，推断所属 PDF 页码。
 * 返回 "p.N" 格式，找不到则返回 null。
 */
function inferPdfPointer(chunkContent, fullText, pagePointers) {
    if (pagePointers.length === 0)
        return null;
    const anchor = chunkContent.slice(0, 50).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pos = fullText.search(new RegExp(anchor));
    if (pos === -1)
        return null;
    // 找到 chunk 起始位置所在的页
    for (const p of pagePointers) {
        if (pos >= p.startOffset && pos <= p.endOffset) {
            return `p.${p.page}`;
        }
    }
    // fallback：取最近的页
    const closest = pagePointers.reduce((prev, cur) => Math.abs(cur.startOffset - pos) < Math.abs(prev.startOffset - pos) ? cur : prev);
    return `p.${closest.page}`;
}
/**
 * 视频/音频：从 chunk 内容中提取第一个时间戳。
 * 视频格式：### [HH:mm:ss ~ HH:mm:ss]
 * 音频格式：**[HH:mm:ss ~ HH:mm:ss]**
 * 返回 "HH:mm:ss" 格式，找不到则返回 null。
 */
function extractTimestampPointer(chunkContent) {
    const match = chunkContent.match(/\[(\d{2}:\d{2}:\d{2})/);
    return match ? match[1] : null;
}
// ─── 核心解析函数 ─────────────────────────────────────────────────────
async function parseMarkdownText(text, documentId, type, pdfPagePointers, mediaType) {
    const smartChunks = await smartChunkWithDeepSeek(text, documentId, type);
    const chunks = await enrichChunks(smartChunks);
    return {
        chunks: chunks.map((c) => {
            let pointer = null;
            if (pdfPagePointers && pdfPagePointers.length > 0) {
                pointer = inferPdfPointer(c.content, text, pdfPagePointers);
            }
            else if (mediaType === "video" || mediaType === "audio") {
                pointer = extractTimestampPointer(c.content);
            }
            return {
                content: c.content,
                chunk_index: c.chunk_index,
                pointer,
                metadata: {},
                summary: c.summary,
                keywords: c.keywords,
                hypothetical_questions: c.hypothetical_questions,
            };
        }),
        text,
    };
}
