/**
 * 文档解析：从 Storage 下载并按类型解析为文本切片
 * 首版支持 txt、md
 */

import { supabase } from "../lib/supabase.js";
import { parseTextToChunks, type ParsedChunk } from "../parsers/textParser.js";

export interface ParseResult {
  chunks: ParsedChunk[];
  text: string;
}

export async function parseDocument(documentId: string, storagePath: string, type: string): Promise<ParseResult> {
  if (!supabase) throw new Error("Supabase 未配置");

  const { data, error } = await supabase.storage.from("documents").download(storagePath);
  if (error || !data) throw new Error(error?.message ?? "下载文件失败");

  const text = await data.text();
  if (!text || !text.trim()) throw new Error("文件内容为空");

  let chunks: ParsedChunk[];
  switch (type) {
    case "txt":
    case "md":
      chunks = parseTextToChunks(text);
      break;
    default:
      throw new Error(`暂不支持的类型: ${type}`);
  }

  return { chunks, text };
}
