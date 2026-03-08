/**
 * chunks 表操作（含向量检索）
 */

import { supabase } from "../lib/supabase.js";

export interface ChunkInsert {
  document_id: string;
  content: string;
  embedding: number[];
  metadata?: Record<string, unknown>;
  chunk_index: number;
}

export async function insertChunks(chunks: ChunkInsert[]) {
  if (!supabase) throw new Error("Supabase 未配置");
  const rows = chunks.map((c) => ({
    document_id: c.document_id,
    content: c.content,
    embedding: c.embedding,
    metadata: c.metadata ?? {},
    chunk_index: c.chunk_index,
  }));
  const { error } = await supabase.from("chunks").insert(rows);
  if (error) throw error;
}

/**
 * 向量检索，返回最相似的 chunks
 * 需先在 Supabase 创建 match_chunks 函数（见 SUPABASE_SETUP.md）
 */
export async function searchChunks(
  embedding: number[],
  options?: { limit?: number }
) {
  if (!supabase) throw new Error("Supabase 未配置");
  const limit = options?.limit ?? 5;

  const { data, error } = await supabase.rpc("match_chunks", {
    query_embedding: embedding,
    match_count: limit,
  });

  if (error) throw error;
  return (data ?? []) as { id: string; document_id: string; content: string; metadata: Record<string, unknown> }[];
}
