/**
 * 阶段 B：语义增强 (Semantic Enrichment)
 * 批量模式：每次请求合并 BATCH_SIZE 个 chunk，减少 API 调用次数，规避 429 限流
 */
import { callDeepSeek } from "./deepseekService.js";
// 每次 DeepSeek 请求处理的 chunk 数量
// 每个 chunk 输出约 100 token，5个 = 500 token，加上 system prompt 仍在 max_tokens=1024 以内
const BATCH_SIZE = 20;
// 批次间并发数（每批已合并多个 chunk，并发不需要太高）
const BATCH_CONCURRENCY = 20;
// ─── Prompt ─────────────────────────────────────────────────────────
const ENRICHMENT_SYSTEM_PROMPT = `你是一位知识库语义增强专家，负责为文档切片批量提取结构化元数据，用于提升检索与问答质量。

## 任务
对用户提供的若干编号文档片段，分别提取以下三项：
1. **summary**：一句话概括本段核心内容（20-50 字，精炼）。
2. **keywords**：3-5 个核心技术或主题词汇（数组形式）。
3. **hypothetical_questions**：2 个用户可能针对该片段提出的真实问题（疑问句形式）。

## 输出格式（严格 JSON 数组，顺序与输入一致，不要有任何其他文字）
[
  {"summary":"...","keywords":["词1","词2"],"hypothetical_questions":["问题1？","问题2？"]},
  {"summary":"...","keywords":["词1","词2"],"hypothetical_questions":["问题1？","问题2？"]}
]

## 约束
- 只输出 JSON 数组，无前后缀、无解释。
- 输出条目数必须与输入片段数完全一致。
- hypothetical_questions 必须是具体、可回答的问题，与片段内容强相关。`;
// ─── 解析单条增强结果 ────────────────────────────────────────────────
function parseEnrichItem(item) {
    const summary = String(item.summary ?? "").trim() || "无摘要";
    const keywords = Array.isArray(item.keywords)
        ? item.keywords.map(String).slice(0, 5)
        : String(item.keywords ?? "")
            .split(/[,，、]/)
            .map((s) => s.trim())
            .filter(Boolean)
            .slice(0, 5);
    const hq = Array.isArray(item.hypothetical_questions)
        ? item.hypothetical_questions.map(String).filter(Boolean)
        : [];
    return {
        summary,
        keywords,
        hypothetical_questions: [
            hq[0]?.trim() || "这段内容讲的是什么？",
            hq[1]?.trim() || "有哪些要点？",
        ],
    };
}
// ─── 默认兜底结果 ────────────────────────────────────────────────────
function defaultEnrichment() {
    return {
        summary: "无摘要",
        keywords: [],
        hypothetical_questions: ["这段内容讲的是什么？", "有哪些要点？"],
    };
}
// ─── 批量调用 DeepSeek（单次请求处理 BATCH_SIZE 个 chunk）────────────
async function enrichBatch(chunkTexts) {
    const blockListText = chunkTexts
        .map((text, idx) => `[片段 ${idx}]\n${text.slice(0, 800)}`)
        .join("\n\n---\n\n");
    const userPrompt = `请对以下 ${chunkTexts.length} 个文档片段分别提取元数据：\n\n${blockListText}`;
    let raw;
    try {
        raw = await callDeepSeek([
            { role: "system", content: ENRICHMENT_SYSTEM_PROMPT },
            { role: "user", content: userPrompt },
        ], { temperature: 0.3, max_tokens: 128 * chunkTexts.length });
    }
    catch (err) {
        console.warn("[Enrichment] 批量调用失败，返回默认值:", err instanceof Error ? err.message : err);
        return chunkTexts.map(() => defaultEnrichment());
    }
    // 提取 JSON 数组
    const arrMatch = raw.match(/\[[\s\S]*\]/);
    if (!arrMatch) {
        console.warn("[Enrichment] 返回非数组 JSON，回退默认值。原始:", raw.slice(0, 200));
        return chunkTexts.map(() => defaultEnrichment());
    }
    let parsed;
    try {
        parsed = JSON.parse(arrMatch[0]);
        if (!Array.isArray(parsed))
            throw new Error("不是数组");
    }
    catch {
        console.warn("[Enrichment] JSON 解析失败，回退默认值");
        return chunkTexts.map(() => defaultEnrichment());
    }
    // 按位置映射，数量不足时用默认值补齐
    return chunkTexts.map((_, idx) => {
        const item = parsed[idx];
        if (!item || typeof item !== "object")
            return defaultEnrichment();
        return parseEnrichItem(item);
    });
}
// ─── 主入口：批量增强所有 chunks ─────────────────────────────────────
export async function enrichChunks(chunks) {
    const results = new Array(chunks.length);
    // 把 chunks 分成每组 BATCH_SIZE 的批次
    const batches = [];
    for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
        batches.push({ startIdx: i, items: chunks.slice(i, i + BATCH_SIZE) });
    }
    // 批次间按 BATCH_CONCURRENCY 并发
    for (let i = 0; i < batches.length; i += BATCH_CONCURRENCY) {
        const concurrentBatches = batches.slice(i, i + BATCH_CONCURRENCY);
        const batchResults = await Promise.all(concurrentBatches.map((b) => enrichBatch(b.items.map((c) => c.content))));
        concurrentBatches.forEach((b, batchIdx) => {
            b.items.forEach((c, itemIdx) => {
                results[b.startIdx + itemIdx] = { ...c, ...batchResults[batchIdx][itemIdx] };
            });
        });
    }
    return results;
}
