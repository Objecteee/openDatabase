/**
 * 阶段 A：智能切片 (Smart Chunking)
 * 调用 DeepSeek 在语义转折、话题切换处插入 [SPLIT]，再按 [SPLIT] 切分
 * 约束：保持原文、不切断 Markdown 表格与代码块、单段 500-800 字
 */

import { callDeepSeek } from "../services/deepseekService.js";

const TARGET_CHUNK_MIN = 500;
const TARGET_CHUNK_MAX = 800;

const SMART_CHUNK_SYSTEM_PROMPT = `你是一位文档结构化专家，擅长在保持原文完整的前提下进行智能语义切分。

## 任务
在用户提供的文本中，在「语义转折」或「话题切换」的恰当位置插入分割标记 [SPLIT]。

## 规则（必须严格遵守）
1. **保持原文不动**：只插入 [SPLIT]，不添加、删除或修改任何原有文字。
2. **禁止切断**：
   - Markdown 表格（|...| 行）内部和中间不得插入 [SPLIT]。
   - 代码块（\`\`\`...\`\`\`）内部不得插入 [SPLIT]。
   - 列表项（-、*、1. 等）若属于同一主题，尽量不拆散。
3. **切分尺度**：单个片段目标长度 500-800 字；若某段自然长度超出 800 字，可在段落边界处适当插入 [SPLIT]；若某段不足 500 字但已为完整语义单元，可保留不切。
4. **切分位置**：通常在段落末尾（空行后）、小节标题前、明显话题切换处插入 [SPLIT]。

## 输出
直接输出修改后的全文，仅在需要切分处插入 [SPLIT]。不要有任何解释、说明或前后缀。`;

export interface SmartChunkResult {
  content: string;
  chunk_index: number;
  metadata: Record<string, unknown>;
}

export async function smartChunkWithDeepSeek(
  rawText: string,
  docId: string,
  docType: "txt" | "md"
): Promise<SmartChunkResult[]> {
  const userPrompt = `请在以下文本的恰当位置插入 [SPLIT] 标记。文档类型：${docType.toUpperCase()}。

---
${rawText}
---`;

  const result = await callDeepSeek(
    [
      { role: "system", content: SMART_CHUNK_SYSTEM_PROMPT },
      { role: "user", content: userPrompt },
    ],
    { temperature: 0.2, max_tokens: 8192 }
  );

  const parts = result
    .split(/\[SPLIT\]/i)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  // 若模型未插入任何 [SPLIT]，整文作为单段（且超长时需回退切分）
  let chunks: string[];
  if (parts.length <= 1 && rawText.length > TARGET_CHUNK_MAX) {
    chunks = fallbackChunkByLength(rawText);
  } else {
    chunks = parts;
  }

  return chunks.map((content, idx) => ({
    content,
    chunk_index: idx,
    metadata: {},
  }));
}

/** 回退：按长度切分（避免超长单段） */
function fallbackChunkByLength(text: string): string[] {
  const chunks: string[] = [];
  const paragraphs = text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);

  let buffer = "";
  for (const p of paragraphs) {
    if (buffer.length + p.length + 2 > TARGET_CHUNK_MAX && buffer.length > 0) {
      chunks.push(buffer);
      buffer = "";
    }
    buffer = buffer ? `${buffer}\n\n${p}` : p;
  }
  if (buffer) chunks.push(buffer);
  return chunks;
}
