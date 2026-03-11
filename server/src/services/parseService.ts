/**
 * 文档解析：从 Storage 下载并按类型解析为文本切片
 * txt/md：智能切片 (DeepSeek) + 语义增强 (DeepSeek)
 * pdf：Mistral OCR → Markdown → 智能切片 (DeepSeek) + 语义增强 (DeepSeek)
 * 其他（docx/xlsx/pptx/csv/html/png/jpg 等）：Markitdown API → Markdown → 智能切片 + 语义增强
 */

import { supabase } from "../lib/supabase.js";
import { smartChunkWithDeepSeek } from "../parsers/smartChunkingParser.js";
import { enrichChunks } from "./semanticEnrichmentService.js";
import { parsePdfWithMistralOcr } from "../parsers/mistralOcrParser.js";
import { convertToMarkdown, getMimeTypeByExt, shouldUseMarkitdown } from "../parsers/markitdownParser.js";

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
    default: {
      if (!shouldUseMarkitdown(type)) {
        throw new Error(`不支持解析的类型: ${type}（视频/音频需单独处理）`);
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
