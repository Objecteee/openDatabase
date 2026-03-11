/**
 * 文档解析：从 Storage 下载并按类型解析为文本切片
 * txt/md：智能切片 (DeepSeek) + 语义增强 (DeepSeek)
 * pdf：Mistral OCR → Markdown → 智能切片 (DeepSeek) + 语义增强 (DeepSeek)
 * 其他（docx/xlsx/pptx/csv/html/png/jpg 等）：Markitdown API → Markdown → 智能切片 + 语义增强
 * video：方舟视频理解 → 结构化 Markdown（时间戳分段）→ 智能切片 + 语义增强
 * audio：豆包语音识别极速版 → 带时间戳 Markdown → 智能切片 + 语义增强
 */

import { supabase } from "../lib/supabase.js";
import { smartChunkWithDeepSeek } from "../parsers/smartChunkingParser.js";
import { enrichChunks } from "./semanticEnrichmentService.js";
import { parsePdfWithMistralOcr } from "../parsers/mistralOcrParser.js";
import { convertToMarkdown, getMimeTypeByExt, shouldUseMarkitdown } from "../parsers/markitdownParser.js";
import { parseVideoWithArk } from "../parsers/arkVideoParser.js";
import { parseAudioWithDoubao, getAudioFormat } from "../parsers/arkAudioParser.js";

export interface EnrichedChunk {
  content: string;
  chunk_index: number;
  metadata: Record<string, unknown>;
  summary: string;
  keywords: string[];
  hypothetical_questions: [string, string];
}

export interface ParseResult {
  chunks: EnrichedChunk[];
  text: string;
}

export async function parseDocument(documentId: string, storagePath: string, type: string): Promise<ParseResult> {
  if (!supabase) throw new Error("Supabase 未配置");

  const { data, error } = await supabase.storage.from("documents").download(storagePath);
  if (error || !data) throw new Error(error?.message ?? "下载文件失败");

  switch (type) {
    case "txt":
    case "md": {
      const text = await data.text();
      if (!text || !text.trim()) throw new Error("文件内容为空");
      return parseMarkdownText(text, documentId, type);
    }
    case "pdf": {
      const arrayBuffer = await data.arrayBuffer();
      const pdfBuffer = Buffer.from(arrayBuffer);

      console.log(`[parseDocument] 开始 Mistral OCR 解析 PDF，大小: ${pdfBuffer.length} bytes`);
      const ocrResult = await parsePdfWithMistralOcr(pdfBuffer, true);
      const mdText = ocrResult.fullMarkdown;
      console.log(`[parseDocument] OCR 完成，共 ${ocrResult.pages.length} 页，Markdown 长度: ${mdText.length}`);

      if (!mdText || !mdText.trim()) throw new Error("PDF OCR 结果为空");

      return parseMarkdownText(mdText, documentId, "md");
    }
    case "video": {
      // 视频理解需要公网可访问的 URL，生成 Supabase Storage 签名 URL（有效期 1 小时）
      const { data: signedData, error: signError } = await supabase.storage
        .from("documents")
        .createSignedUrl(storagePath, 3600);
      if (signError || !signedData?.signedUrl) {
        throw new Error(`生成视频签名 URL 失败: ${signError?.message ?? "未知错误"}`);
      }

      console.log(`[parseDocument] 开始方舟视频理解，storagePath: ${storagePath}`);
      const videoResult = await parseVideoWithArk(signedData.signedUrl);
      console.log(`[parseDocument] 视频理解完成，Markdown 长度: ${videoResult.markdown.length}`);

      if (!videoResult.markdown.trim()) throw new Error("视频理解结果为空");

      return parseMarkdownText(videoResult.markdown, documentId, "md");
    }
    case "audio": {
      // 音频识别：直接下载 Buffer 后 base64 传给豆包语音极速版
      const fileName = storagePath.split("/").pop() ?? "audio.mp3";
      const ext = fileName.split(".").pop() ?? "mp3";
      const format = getAudioFormat(ext);

      const arrayBuffer = await data.arrayBuffer();
      const audioBuffer = Buffer.from(arrayBuffer);

      console.log(`[parseDocument] 开始豆包语音识别，格式: ${format}，大小: ${(audioBuffer.length / 1024).toFixed(1)} KB`);
      const audioResult = await parseAudioWithDoubao(audioBuffer, format);
      console.log(`[parseDocument] 音频识别完成，时长: ${audioResult.durationMs}ms，Markdown 长度: ${audioResult.markdown.length}`);

      if (!audioResult.markdown.trim()) throw new Error("音频识别结果为空");

      return parseMarkdownText(audioResult.markdown, documentId, "md");
    }
    default: {
      if (!shouldUseMarkitdown(type)) {
        throw new Error(`不支持解析的类型: ${type}`);
      }

      // 从 storagePath 推断文件名和扩展名
      const fileName = storagePath.split("/").pop() ?? `file.${type}`;
      const ext = fileName.split(".").pop() ?? type;
      const mimeType = getMimeTypeByExt(ext);

      const arrayBuffer = await data.arrayBuffer();
      const fileBuffer = Buffer.from(arrayBuffer);

      console.log(`[parseDocument] 开始 Markitdown 转换，类型: ${type}，文件: ${fileName}`);
      const mdText = await convertToMarkdown(fileBuffer, fileName, mimeType);
      console.log(`[parseDocument] Markitdown 转换完成，Markdown 长度: ${mdText.length}`);

      if (!mdText || !mdText.trim()) throw new Error("Markitdown 转换结果为空");

      return parseMarkdownText(mdText, documentId, "md");
    }
  }
}

async function parseMarkdownText(text: string, documentId: string, type: string): Promise<ParseResult> {
  const smartChunks = await smartChunkWithDeepSeek(text, documentId, type);
  const chunks = await enrichChunks(smartChunks);
  return {
    chunks: chunks.map((c) => ({
      content: c.content,
      chunk_index: c.chunk_index,
      metadata: {},
      summary: c.summary,
      keywords: c.keywords,
      hypothetical_questions: c.hypothetical_questions,
    })),
    text,
  };
}
