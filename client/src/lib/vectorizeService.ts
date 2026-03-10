/**
 * 向量化服务：解析 → 前端 embed → 提交 chunks
 * 依赖 embeddingClient（本地模型）与 documents API
 */

import { embedBatch } from "./embeddingClient.js";

const API_BASE = "/api/documents";

export interface ParseChunk {
  content: string;
  chunk_index: number;
  metadata?: Record<string, unknown>;
}

export interface VectorizeResult {
  ok: boolean;
  error?: string;
  count?: number;
}

export async function vectorizeDocument(documentId: string): Promise<VectorizeResult> {
  try {
    const parseRes = await fetch(`${API_BASE}/${documentId}/parse`);
    if (!parseRes.ok) {
      const json = await parseRes.json().catch(() => ({}));
      return { ok: false, error: json.error ?? "解析失败" };
    }
    const { chunks } = (await parseRes.json()) as { chunks: ParseChunk[] };
    if (!chunks?.length) return { ok: false, error: "无有效切片" };

    const texts = chunks.map((c) => c.content);
    const embeddings = await embedBatch(texts);
    if (embeddings.length !== chunks.length) return { ok: false, error: "向量化数量不匹配" };

    const payload = chunks.map((c, i) => ({
      chunk_index: c.chunk_index,
      content: c.content,
      metadata: c.metadata ?? {},
      embedding: embeddings[i] ?? [],
    }));

    const postRes = await fetch(`${API_BASE}/${documentId}/chunks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chunks: payload }),
    });
    if (!postRes.ok) {
      const json = await postRes.json().catch(() => ({}));
      return { ok: false, error: json.error ?? "提交失败" };
    }
    const json = (await postRes.json()) as { count?: number };
    return { ok: true, count: json.count ?? chunks.length };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "向量化失败" };
  }
}
