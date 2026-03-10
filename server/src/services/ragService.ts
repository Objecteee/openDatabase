/**
 * RAG 检索增强服务
 *
 * 三阶段流程：
 *   Step 1 — 意图分类 + 查询重写（Query Transformation）
 *            判断是"闲聊"还是"知识寻求"；若是知识寻求，将依赖上下文的问题
 *            重写为独立查询，并提取关键词
 *
 *   Step 2 — 混合检索（Hybrid Search）
 *            向量检索（pgvector）+ 关键词元数据过滤，结果合并去重并提升命中权重
 *
 *   Step 3 — 精排（Reranking）
 *            将 Top-N 候选 chunk 发给 LLM 裁判，保留高度相关的片段并排序
 */

import { callDeepSeek } from "./deepseekService.js";
import { searchChunks, searchChunksByKeywords } from "./chunkService.js";

// ─── 类型 ────────────────────────────────────────────────────────────

export interface RagChunk {
  id: string;
  document_id: string;
  content: string;
  metadata: Record<string, unknown>;
  score?: number;
}

export interface RagContext {
  type: "chat" | "rag";
  chunks: RagChunk[];
  rewrittenQuery?: string;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

// ─── 配置 ────────────────────────────────────────────────────────────

const VECTOR_RECALL_COUNT = 10;    // 向量检索初始召回数
const KEYWORD_RECALL_COUNT = 5;    // 关键词检索召回数
const RERANK_TOP_K = 3;            // 精排后保留的最大 chunk 数

// ─── Step 1：意图分类 + 查询重写 ─────────────────────────────────────

interface IntentResult {
  type: "chat" | "rag";
  rewrittenQuery: string;
  keywords: string[];
}

const INTENT_SYSTEM_PROMPT = `你是一个对话意图分析器。分析用户最新消息，完成以下任务：

## 判断意图
- **chat**：礼貌寒暄、闲聊、情感表达、与知识库无关的问题
- **rag**：寻求具体知识、查询文档内容、技术问题、需要检索资料的问题

## 查询重写（仅当意图为 rag 时）
若用户问题包含代词（"它"、"那个"、"刚才说的"、"上面提到的"等）或依赖对话历史，
结合历史对话将其重写为**不依赖上下文、包含核心关键词的独立查询语句**。
若问题本身已足够独立，直接使用原句。

## 关键词提取（仅当意图为 rag 时）
从重写后的查询中提取 3-5 个核心技术/主题关键词，用于元数据过滤。

## 输出格式（严格 JSON，不要有任何其他文字）
{"type":"chat|rag","rewrittenQuery":"重写后的查询或原句","keywords":["词1","词2"]}`;

export async function analyzeIntent(
  messages: ChatMessage[]
): Promise<IntentResult> {
  const lastUserMsg = [...messages].reverse().find((m) => m.role === "user");
  if (!lastUserMsg) return { type: "chat", rewrittenQuery: "", keywords: [] };

  // 构造历史上下文摘要（最近 6 条，避免过长）
  const recentHistory = messages
    .slice(-6)
    .filter((m) => m.role !== "system")
    .map((m) => `${m.role === "user" ? "用户" : "助手"}：${m.content.slice(0, 200)}`)
    .join("\n");

  const userPrompt = `## 对话历史（最近几轮）\n${recentHistory}\n\n## 用户最新消息\n${lastUserMsg.content}`;

  let raw: string;
  try {
    raw = await callDeepSeek(
      [
        { role: "system", content: INTENT_SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
      { temperature: 0.1, max_tokens: 256 }
    );
  } catch {
    // 意图分析失败，降级为直接 chat
    return { type: "chat", rewrittenQuery: lastUserMsg.content, keywords: [] };
  }

  const jsonMatch = raw.match(/\{[\s\S]*?\}/);
  if (!jsonMatch) return { type: "rag", rewrittenQuery: lastUserMsg.content, keywords: [] };

  try {
    const parsed = JSON.parse(jsonMatch[0]) as {
      type?: string;
      rewrittenQuery?: string;
      keywords?: unknown;
    };
    return {
      type: parsed.type === "chat" ? "chat" : "rag",
      rewrittenQuery: String(parsed.rewrittenQuery ?? lastUserMsg.content).trim() || lastUserMsg.content,
      keywords: Array.isArray(parsed.keywords) ? parsed.keywords.map(String).slice(0, 5) : [],
    };
  } catch {
    return { type: "rag", rewrittenQuery: lastUserMsg.content, keywords: [] };
  }
}

// ─── Step 2：混合检索 ────────────────────────────────────────────────

/**
 * 向量检索 + 关键词过滤，结果合并去重
 * 命中关键词的 chunk 权重提升（score += 0.1 per keyword hit）
 */
export async function hybridSearch(
  queryEmbedding: number[],
  keywords: string[]
): Promise<RagChunk[]> {
  const [vectorResults, keywordResults] = await Promise.all([
    searchChunks(queryEmbedding, { limit: VECTOR_RECALL_COUNT }),
    keywords.length > 0
      ? searchChunksByKeywords(keywords, { limit: KEYWORD_RECALL_COUNT })
      : Promise.resolve([]),
  ]);

  // 以 chunk_group_id 或 id 去重，合并两路结果
  const seen = new Map<string, RagChunk>();

  for (const c of vectorResults) {
    const key = c.id;
    seen.set(key, { ...c, score: (c as RagChunk & { similarity?: number }).similarity ?? 0.5 });
  }

  // 关键词命中的 chunk 提升权重
  for (const c of keywordResults) {
    const key = c.id;
    if (seen.has(key)) {
      // 已在向量结果中，提升 score
      const existing = seen.get(key)!;
      seen.set(key, { ...existing, score: Math.min(1, (existing.score ?? 0.5) + 0.15) });
    } else {
      // 仅关键词命中，给予基础分
      seen.set(key, { ...c, score: 0.4 });
    }
  }

  // 按 score 降序排列
  return [...seen.values()].sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
}

// ─── Step 3：精排 ────────────────────────────────────────────────────

const RERANK_SYSTEM_PROMPT = `你是一个检索结果精排裁判。

## 任务
给定用户问题和若干候选文档片段（含编号和摘要），判断哪些片段能直接回答用户问题。

## 输出格式（严格 JSON，不要有任何其他文字）
{"relevant_indices":[0,2,4]}

规则：
- 只保留与用户问题高度相关的片段编号（最多 ${RERANK_TOP_K} 个）
- 按相关性从高到低排序
- 若所有片段都不相关，返回 {"relevant_indices":[]}`;

export async function rerankChunks(
  query: string,
  chunks: RagChunk[]
): Promise<RagChunk[]> {
  if (chunks.length === 0) return [];
  if (chunks.length <= RERANK_TOP_K) return chunks;

  const chunkListText = chunks
    .map((c, idx) => {
      const summary = (c.metadata?.summary as string) ?? "";
      const preview = c.content.slice(0, 300);
      return `[${idx}] ${summary ? `摘要：${summary}\n` : ""}内容：${preview}${c.content.length > 300 ? "..." : ""}`;
    })
    .join("\n\n---\n\n");

  const userPrompt = `## 用户问题\n${query}\n\n## 候选片段\n${chunkListText}`;

  let raw: string;
  try {
    raw = await callDeepSeek(
      [
        { role: "system", content: RERANK_SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
      { temperature: 0.1, max_tokens: 128 }
    );
  } catch {
    // 精排失败，直接返回前 RERANK_TOP_K 个
    return chunks.slice(0, RERANK_TOP_K);
  }

  const jsonMatch = raw.match(/\{[\s\S]*?\}/);
  if (!jsonMatch) return chunks.slice(0, RERANK_TOP_K);

  try {
    const parsed = JSON.parse(jsonMatch[0]) as { relevant_indices?: unknown };
    const indices = Array.isArray(parsed.relevant_indices)
      ? parsed.relevant_indices
          .map(Number)
          .filter((n) => Number.isInteger(n) && n >= 0 && n < chunks.length)
          .slice(0, RERANK_TOP_K)
      : [];

    if (indices.length === 0) return chunks.slice(0, RERANK_TOP_K);
    return indices.map((i) => chunks[i]);
  } catch {
    return chunks.slice(0, RERANK_TOP_K);
  }
}

// ─── 主入口：完整 RAG 流程（不含向量化，向量由调用方传入）────────────

/**
 * 执行完整 RAG 流程，返回上下文信息
 * @param messages 完整对话历史
 * @param queryEmbedding 已向量化的查询向量（由调用方在服务端计算）
 */
export async function buildRagContext(
  messages: ChatMessage[],
  queryEmbedding: number[]
): Promise<RagContext> {
  // Step 1：意图分类 + 查询重写
  const intent = await analyzeIntent(messages);
  console.log(`[RAG] Step1 意图分析: type=${intent.type}, query="${intent.rewrittenQuery}", keywords=${JSON.stringify(intent.keywords)}`);

  if (intent.type === "chat") {
    console.log("[RAG] 判断为闲聊，跳过检索");
    return { type: "chat", chunks: [] };
  }

  // Step 2：混合检索
  const candidates = await hybridSearch(queryEmbedding, intent.keywords);
  console.log(`[RAG] Step2 混合检索: 召回 ${candidates.length} 个候选 chunk`);

  if (candidates.length === 0) {
    console.log("[RAG] 检索结果为空，知识库中无相关内容");
    return { type: "rag", chunks: [], rewrittenQuery: intent.rewrittenQuery };
  }

  // Step 3：精排
  const finalChunks = await rerankChunks(intent.rewrittenQuery, candidates);
  console.log(`[RAG] Step3 精排完成: 保留 ${finalChunks.length} 个 chunk`);

  return {
    type: "rag",
    chunks: finalChunks,
    rewrittenQuery: intent.rewrittenQuery,
  };
}

// ─── 构造 RAG 增强的 system prompt ──────────────────────────────────

export function buildRagSystemPrompt(chunks: RagChunk[]): string {
  if (chunks.length === 0) {
    return "你是一个有帮助的助手。请始终使用 Markdown 格式回复。";
  }

  const contextText = chunks
    .map((c, idx) => {
      const docId = c.document_id;
      const chunkId = c.id;
      return `[来源 ${idx + 1}] document_id:${docId} chunk_id:${chunkId}\n${c.content}`;
    })
    .join("\n\n---\n\n");

  return `你是一个基于知识库的智能助手。请根据以下检索到的相关文档片段回答用户问题。

## 检索到的相关内容
${contextText}

## 回答规则
1. 优先基于上述文档内容回答，使用 Markdown 格式。
2. 回答末尾必须附上引用来源，格式：【来源 N】，N 对应上方片段编号。
3. 若文档内容不足以回答，可结合自身知识补充，但需注明"以下为补充信息"。
4. 不要编造文档中没有的信息。`;
}
