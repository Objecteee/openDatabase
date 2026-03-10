/**
 * 文档解析：从 Storage 下载并按类型解析为文本切片
 * txt/md：智能切片 (DeepSeek) + 语义增强 (DeepSeek)
 */

import { supabase } from "../lib/supabase.js";
import { smartChunkWithDeepSeek } from "../parsers/smartChunkingParser.js";
import { enrichChunks } from "./semanticEnrichmentService.js";

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

  const text = await data.text();
  if (!text || !text.trim()) throw new Error("文件内容为空");

  switch (type) {
    case "txt":
    case "md": {
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
    default:
      throw new Error(`暂不支持的类型: ${type}`);
  }
}
