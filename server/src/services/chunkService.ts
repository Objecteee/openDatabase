/**
 * chunks 表操作（含向量检索）
 * 支持单 ID 多向量：enriched_main + qa_hypothetical x2
 */

import { supabase } from "../lib/supabase.js";

export interface ChunkInsert {
  document_id: string;
  content: string;
  embedding: number[];
  metadata?: Record<string, unknown>;
  chunk_index: number;
  chunk_group_id?: string;
  vector_type?: "enriched_main" | "qa_hypothetical";
}

/** 多向量插入：同一逻辑切片 3 条记录 */
export interface MultiVectorChunkInsert {
  document_id: string;
  chunk_group_id: string;
  content: string;
  metadata?: Record<string, unknown>;
  chunk_index: number;
  embeddings: Array<{
    type: "enriched_main" | "qa_hypothetical";
    embedding: number[];
  }>;
}

/** 删除文档下所有 chunks（用于重新处理前清空） */
export async function deleteChunksByDocumentId(documentId: string) {
  if (!supabase) throw new Error("Supabase 未配置");
  const { error } = await supabase.from("chunks").delete().eq("document_id", documentId);
  if (error) throw error;
}

export async function insertChunks(chunks: ChunkInsert[]) {
  if (!supabase) throw new Error("Supabase 未配置");
  const rows = chunks.map((c) => ({
    document_id: c.document_id,
    content: c.content,
    embedding: c.embedding,
    metadata: c.metadata ?? {},
    chunk_index: c.chunk_index,
    chunk_group_id: c.chunk_group_id ?? null,
    vector_type: c.vector_type ?? "enriched_main",
  }));
  const { error } = await supabase.from("chunks").insert(rows);
  if (error) throw error;
}

/** 插入多向量 chunks（1 enriched_main + 2 qa_hypothetical 每逻辑切片） */
export async function insertMultiVectorChunks(chunks: MultiVectorChunkInsert[]) {
  if (!supabase) throw new Error("Supabase 未配置");
  const rows: Array<{
    document_id: string;
    chunk_group_id: string;
    content: string;
    metadata: Record<string, unknown>;
    chunk_index: number;
    embedding: number[];
    vector_type: string;
  }> = [];

  for (const c of chunks) {
    for (const e of c.embeddings) {
      rows.push({
        document_id: c.document_id,
        chunk_group_id: c.chunk_group_id,
        content: c.content,
        metadata: c.metadata ?? {},
        chunk_index: c.chunk_index,
        embedding: e.embedding,
        vector_type: e.type,
      });
    }
  }

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
