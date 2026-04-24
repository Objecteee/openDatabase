/**
 * 向量化服务：解析 → 增强型/模拟提问向量 → 提交多向量 chunks
 * 阶段 C：为每个切片构造 enriched_main + 2 qa_hypothetical 向量
 */

import { embedBatch } from "./embeddingClient.js";
import { api } from "./apiClient.js";
import { createUuid } from "./uuid.js";

export interface ParseChunk {
  content: string;
  chunk_index: number;
  /** 溯源指针：PDF 页码（"p.3"）或视频/音频时间戳（"00:01:23"），无则为 null */
  pointer?: string | null;
  metadata?: Record<string, unknown>;
  summary?: string;
  keywords?: string[];
  hypothetical_questions?: [string, string];
}

export interface VectorizeResult {
  ok: boolean;
  error?: string;
  count?: number;
  total_vectors?: number;
}

/**
 * 构造增强型主向量输入
 * 模板：[ID: {id}] [Type: {type}] [Summary: {summary}] [Keywords: {keywords}] [Content: {chunk_text}]
 */
function buildEnrichedText(docId: string, docType: string, chunk: ParseChunk): string {
  const summary = chunk.summary ?? "无摘要";
  const keywords = (chunk.keywords ?? []).join(", ");
  return `[ID: ${docId}] [Type: ${docType}] [Summary: ${summary}] [Keywords: ${keywords}] [Content: ${chunk.content}]`;
}

export async function vectorizeDocument(documentId: string): Promise<VectorizeResult> {
  try {
    const parseRes = await api.get(`/documents/${documentId}/parse`);
    const { chunks, document_id, document_type, document_name } = parseRes.data as {
      chunks: ParseChunk[];
      document_id?: string;
      document_type?: string;
      document_name?: string;
    };
    if (!chunks?.length) return { ok: false, error: "无有效切片" };

    const docId = document_id ?? documentId;
    const docType = document_type ?? "txt";
    const docName = document_name ?? "";

    // 为每个 chunk 构造 3 个向量输入：enriched + q1 + q2
    const textsToEmbed: string[] = [];
    for (const c of chunks) {
      textsToEmbed.push(buildEnrichedText(docId, docType, c));
      const [q1, q2] = c.hypothetical_questions ?? ["这段内容讲的是什么？", "有哪些要点？"];
      textsToEmbed.push(q1, q2);
    }

    const allEmbeddings = await embedBatch(textsToEmbed);
    if (allEmbeddings.length !== textsToEmbed.length) return { ok: false, error: "向量化数量不匹配" };

    // 映射回 chunks：每 chunk 3 个 embedding
    const payload = chunks.map((c, i) => {
      const base = i * 3;
      const chunkGroupId = createUuid();
      return {
        chunk_index: c.chunk_index,
        content: c.content,
        // 将语义增强字段和溯源字段写入 metadata，供检索后 citations 事件使用
        metadata: {
          ...(c.metadata ?? {}),
          summary: c.summary ?? null,
          keywords: c.keywords ?? [],
          pointer: c.pointer ?? null,
          document_name: docName,
        },
        chunk_group_id: chunkGroupId,
        embeddings: [
          { type: "enriched_main" as const, embedding: allEmbeddings[base] ?? [] },
          { type: "qa_hypothetical" as const, embedding: allEmbeddings[base + 1] ?? [] },
          { type: "qa_hypothetical" as const, embedding: allEmbeddings[base + 2] ?? [] },
        ],
      };
    });

    const postRes = await api.post(`/documents/${documentId}/chunks`, { chunks: payload });
    const json = postRes.data as { count?: number; total_vectors?: number };
    return { ok: true, count: json.count ?? chunks.length, total_vectors: json.total_vectors };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "向量化失败" };
  }
}
