/**
 * chunks 表操作（含向量检索）
 * 支持单 ID 多向量：enriched_main + qa_hypothetical x2
 */

import { supabase } from "../lib/supabase.js";

export interface ChunkInsert {
  user_id: string;
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
  user_id: string;
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
    user_id: c.user_id,
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
    user_id: string;
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
        user_id: c.user_id,
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

export interface ChunkSearchResult {
  id: string;
  document_id: string;
  content: string;
  metadata: Record<string, unknown>;
  similarity?: number;
}

/**
 * 向量检索，返回最相似的 chunks
 * 需先在 Supabase 创建 match_chunks / match_chunks_filtered 函数（见 doc/migrations）
 * 只检索 enriched_main 向量（语义最丰富，避免 qa_hypothetical 重复召回同一 chunk）
 * @param options.documentIds 可选；传入时仅在这些文档的 chunks 中检索（调用 match_chunks_filtered）
 */
export async function searchChunks(
  embedding: number[],
  options: { userId: string; limit?: number; documentIds?: string[] }
): Promise<ChunkSearchResult[]> {
  if (!supabase) throw new Error("Supabase 未配置");
  if (!options?.userId) throw new Error("userId 必填");
  const limit = options?.limit ?? 5;
  const docIds = options?.documentIds?.filter((id) => id && /^[0-9a-f-]{36}$/i.test(id));

  const fn = docIds && docIds.length > 0 ? "match_chunks_filtered_scoped" : "match_chunks_scoped";
  const payload =
    fn === "match_chunks_filtered_scoped"
      ? { query_embedding: embedding, scope_user_id: options.userId, filter_document_ids: docIds, match_count: limit }
      : { query_embedding: embedding, scope_user_id: options.userId, match_count: limit };

  const { data, error } = await supabase.rpc(fn, payload);
  if (error) throw error;
  return (data ?? []) as ChunkSearchResult[];
}

/**
 * 关键词元数据过滤检索
 * 在 chunks 表的 metadata->keywords 字段中匹配任意关键词
 * @param options.documentIds 可选；传入时仅在这些文档的 chunks 中检索
 */
export async function searchChunksByKeywords(
  keywords: string[],
  options: { userId: string; limit?: number; documentIds?: string[] }
): Promise<ChunkSearchResult[]> {
  if (!supabase) throw new Error("Supabase 未配置");
  if (!options?.userId) throw new Error("userId 必填");
  if (keywords.length === 0) return [];

  const limit = options?.limit ?? 5;
  const docIds = options?.documentIds?.filter((id) => id && /^[0-9a-f-]{36}$/i.test(id));

  let query = supabase
    .from("chunks")
    .select("id, document_id, content, metadata")
    .eq("vector_type", "enriched_main")
    .eq("user_id", options.userId)
    .or(keywords.map((kw) => `metadata->keywords.cs.["${kw}"]`).join(","));

  if (docIds && docIds.length > 0) {
    query = query.in("document_id", docIds);
  }

  const { data, error } = await query.limit(limit);

  if (error) {
    console.warn("[ChunkService] 关键词检索失败:", error.message);
    return [];
  }

  return (data ?? []) as ChunkSearchResult[];
}
