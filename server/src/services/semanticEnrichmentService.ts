/**
 * 阶段 B：语义增强 (Semantic Enrichment)
 * 针对每个切片调用 DeepSeek 提取：Summary、Keywords、Hypothetical Questions (HyDE)
 */

import { callDeepSeek } from "./deepseekService.js";

const ENRICHMENT_SYSTEM_PROMPT = `你是一位知识库语义增强专家，负责为文档切片提取结构化元数据，用于提升检索与问答质量。

## 任务
对给定的文档片段，提取以下三项（必须严格按 JSON 格式输出，不要有多余文字）：

1. **summary**：一句话概括本段核心内容（20-50 字，精炼）。
2. **keywords**：3-5 个核心技术或主题词汇（中文或英文，以逗号分隔）。
3. **hypothetical_questions**：2 个用户可能针对该片段提出的真实问题（疑问句形式，模拟检索场景）。

## 输出格式（严格 JSON）
\`\`\`json
{
  "summary": "本段核心概括",
  "keywords": ["词1", "词2", "词3"],
  "hypothetical_questions": ["问题1？", "问题2？"]
}
\`\`\`

## 约束
- 只输出上述 JSON，无前后缀。
- hypothetical_questions 必须是具体、可回答的问题，与片段内容强相关。
- 若片段极短或信息不足，可适当简化，但三项均需提供。`;

export interface EnrichmentResult {
  summary: string;
  keywords: string[];
  hypothetical_questions: [string, string];
}

export async function enrichChunk(chunkText: string): Promise<EnrichmentResult> {
  const userPrompt = `请对以下文档片段提取元数据：

---
${chunkText.slice(0, 2000)}
---`;

  const raw = await callDeepSeek(
    [
      { role: "system", content: ENRICHMENT_SYSTEM_PROMPT },
      { role: "user", content: userPrompt },
    ],
    { temperature: 0.3, max_tokens: 512 }
  );

  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error(`语义增强返回非 JSON 格式: ${raw.slice(0, 200)}`);

  let parsed: { summary?: string; keywords?: string[]; hypothetical_questions?: string[] };
  try {
    parsed = JSON.parse(jsonMatch[0]);
  } catch {
    throw new Error("语义增强 JSON 解析失败");
  }

  const summary = String(parsed.summary ?? "").trim() || "无摘要";
  const keywords = Array.isArray(parsed.keywords)
    ? parsed.keywords.map(String).slice(0, 5)
    : String(parsed.keywords ?? "")
        .split(/[,，、]/)
        .map((s) => s.trim())
        .filter(Boolean)
        .slice(0, 5);
  const hq = Array.isArray(parsed.hypothetical_questions)
    ? parsed.hypothetical_questions.map(String).filter(Boolean)
    : [];

  const q1 = hq[0]?.trim() || "这段内容讲的是什么？";
  const q2 = hq[1]?.trim() || "有哪些要点？";

  return {
    summary,
    keywords,
    hypothetical_questions: [q1, q2],
  };
}

export async function enrichChunks(
  chunks: Array<{ content: string; chunk_index: number }>
): Promise<Array<{ content: string; chunk_index: number } & EnrichmentResult>> {
  const results: Array<{ content: string; chunk_index: number } & EnrichmentResult> = [];

  for (const c of chunks) {
    const enrichment = await enrichChunk(c.content);
    results.push({
      ...c,
      ...enrichment,
    });
  }

  return results;
}
