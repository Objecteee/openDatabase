/**
 * 阶段 A：智能切片 (Smart Chunking) — 方案 B：滑窗 + 切分点索引
 *
 * 核心流程：
 *   1. 本地把全文解析成"块数组"（block[]），每块是不可拆分的最小单元：
 *      - 代码块（```...```）整块
 *      - 表格（连续 |...| 行）整块
 *      - 普通段落（空行分隔）
 *   2. 把块数组按 WINDOW_SIZE 字符 + OVERLAP 块数 划分成若干"窗口"
 *   3. 对每个窗口调用 DeepSeek，输入"块编号 + 块内容"，
 *      要求只输出 JSON：{ "split_after": [2, 5, 8] }（在哪些块后面切分）
 *   4. 本地按切分点把块数组拼接成最终 chunks
 *
 * 好处：
 *   - 输入可控（每窗口 ≤ WINDOW_CHARS 字符）
 *   - 输出极短（只有索引数组），max_tokens 几十就够
 *   - 大文件自动分窗口处理，不会超上下文
 *   - 保留 DeepSeek 的语义理解能力（在窗口内做决策）
 */
import { callDeepSeek } from "../services/deepseekService.js";
// ─── 配置 ───────────────────────────────────────────────────────────
const TARGET_CHUNK_MIN = 500; // chunk 目标最小字符数
const TARGET_CHUNK_MAX = 800; // chunk 目标最大字符数
const WINDOW_CHARS = 12_000; // 每个滑窗最大字符数（约 6k token，留余量给 system+output）
const WINDOW_OVERLAP = 2; // 相邻窗口重叠的块数（防止跨窗口语义断裂）
const SMALL_TEXT_THRESHOLD = 10_000; // 小于此字符数直接用原有"全文插 [SPLIT]"逻辑
// ─── Prompt ─────────────────────────────────────────────────────────
const WINDOW_SYSTEM_PROMPT = `你是一位文档结构化专家，负责对文档片段进行语义切分。

## 任务
给定若干编号块（Block），判断应在哪些块"之后"进行切分，使每个切片语义完整、长度适中（目标 500-800 字）。

## 规则
1. 切分位置通常在：话题切换处、小节结束处、段落语义完结处。
2. 不要在代码块（type: code）或表格（type: table）之后强制切分，除非语义确实结束。
3. 若某段连续块总长度超过 800 字，必须在合适位置切分。
4. 若连续块总长度不足 500 字但语义完整，可不切分。

## 输出格式（严格 JSON，不要有任何其他文字）
{"split_after":[块索引1,块索引2,...]}

如果整个片段不需要切分，输出：{"split_after":[]}`;
// ─── 本地块解析 ──────────────────────────────────────────────────────
/**
 * 把全文解析成不可拆分的块数组
 * 顺序：代码块 > 表格 > 普通段落
 */
function parseBlocks(text) {
    const blocks = [];
    const lines = text.split("\n");
    let i = 0;
    while (i < lines.length) {
        const line = lines[i];
        // 代码块：``` 开头，收集到下一个 ``` 结束
        if (/^```/.test(line)) {
            const start = i;
            i++;
            while (i < lines.length && !/^```/.test(lines[i]))
                i++;
            i++; // 包含结束 ```
            blocks.push({ text: lines.slice(start, i).join("\n"), type: "code" });
            continue;
        }
        // 表格：连续的 | 开头行
        if (/^\s*\|/.test(line)) {
            const start = i;
            while (i < lines.length && /^\s*\|/.test(lines[i]))
                i++;
            blocks.push({ text: lines.slice(start, i).join("\n"), type: "table" });
            continue;
        }
        // 普通段落：收集到下一个空行
        if (line.trim() === "") {
            i++;
            continue;
        }
        const start = i;
        while (i < lines.length && lines[i].trim() !== "" && !/^```/.test(lines[i]) && !/^\s*\|/.test(lines[i])) {
            i++;
        }
        const paraText = lines.slice(start, i).join("\n").trim();
        if (paraText)
            blocks.push({ text: paraText, type: "paragraph" });
    }
    return blocks;
}
// ─── 滑窗切分 ────────────────────────────────────────────────────────
/**
 * 把块数组按 WINDOW_CHARS 字符划分成若干窗口
 * 相邻窗口重叠 WINDOW_OVERLAP 个块，防止跨窗口语义断裂
 */
function buildWindows(blocks) {
    const windows = [];
    let i = 0;
    while (i < blocks.length) {
        const windowBlocks = [];
        let charCount = 0;
        let j = i;
        while (j < blocks.length) {
            const b = blocks[j];
            if (charCount + b.text.length > WINDOW_CHARS && windowBlocks.length > 0)
                break;
            windowBlocks.push(b);
            charCount += b.text.length;
            j++;
        }
        windows.push({ startIdx: i, blocks: windowBlocks });
        // 下一个窗口从（当前窗口末尾 - overlap）开始
        i = Math.max(i + 1, j - WINDOW_OVERLAP);
    }
    return windows;
}
// ─── DeepSeek 窗口切分 ───────────────────────────────────────────────
/**
 * 对单个窗口调用 DeepSeek，返回"应在哪些块后切分"的本地索引列表
 * 本地索引：0 = 窗口内第一块
 */
async function getSplitPointsForWindow(windowBlocks) {
    // 构造块列表文本：每块显示编号、类型、内容（截断过长块的显示，但不影响切分判断）
    const blockListText = windowBlocks
        .map((b, idx) => `[Block ${idx}][${b.type}]\n${b.text.slice(0, 600)}${b.text.length > 600 ? "\n...(截断)" : ""}`)
        .join("\n\n---\n\n");
    const userPrompt = `请判断以下 ${windowBlocks.length} 个块应在哪些块之后切分：\n\n${blockListText}`;
    let raw;
    try {
        raw = await callDeepSeek([
            { role: "system", content: WINDOW_SYSTEM_PROMPT },
            { role: "user", content: userPrompt },
        ], { temperature: 0.1, max_tokens: 256 });
    }
    catch (err) {
        // 单窗口失败不影响整体，回退到按长度切分（返回空，由调用方处理）
        console.warn("[SmartChunk] 窗口 DeepSeek 调用失败，回退到长度切分:", err instanceof Error ? err.message : err);
        return [];
    }
    const jsonMatch = raw.match(/\{[\s\S]*?\}/);
    if (!jsonMatch)
        return [];
    try {
        const parsed = JSON.parse(jsonMatch[0]);
        const arr = parsed.split_after;
        if (!Array.isArray(arr))
            return [];
        return arr
            .map(Number)
            .filter((n) => Number.isInteger(n) && n >= 0 && n < windowBlocks.length - 1);
    }
    catch {
        return [];
    }
}
// ─── 块数组 → chunks ─────────────────────────────────────────────────
/**
 * 把块数组按切分点集合（全局块索引）拼接成 chunk 字符串数组
 */
function assembleChunks(blocks, splitAfterSet) {
    const chunks = [];
    let buffer = [];
    for (let i = 0; i < blocks.length; i++) {
        buffer.push(blocks[i].text);
        if (splitAfterSet.has(i) || i === blocks.length - 1) {
            const text = buffer.join("\n\n").trim();
            if (text)
                chunks.push(text);
            buffer = [];
        }
    }
    return chunks;
}
// ─── 小文本回退（原有逻辑）──────────────────────────────────────────
const SMALL_TEXT_SYSTEM_PROMPT = `你是一位文档结构化专家，擅长在保持原文完整的前提下进行智能语义切分。

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
async function smallTextChunk(rawText, docType) {
    const userPrompt = `请在以下文本的恰当位置插入 [SPLIT] 标记。文档类型：${docType.toUpperCase()}。\n\n---\n${rawText}\n---`;
    const result = await callDeepSeek([
        { role: "system", content: SMALL_TEXT_SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
    ], { temperature: 0.2, max_tokens: 8192 });
    const parts = result
        .split(/\[SPLIT\]/i)
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
    if (parts.length <= 1 && rawText.length > TARGET_CHUNK_MAX) {
        return fallbackChunkByLength(rawText);
    }
    return parts;
}
function fallbackChunkByLength(text) {
    const chunks = [];
    const paragraphs = text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
    let buffer = "";
    for (const p of paragraphs) {
        if (buffer.length + p.length + 2 > TARGET_CHUNK_MAX && buffer.length > 0) {
            chunks.push(buffer);
            buffer = "";
        }
        buffer = buffer ? `${buffer}\n\n${p}` : p;
    }
    if (buffer)
        chunks.push(buffer);
    return chunks;
}
// ─── 主入口 ──────────────────────────────────────────────────────────
export async function smartChunkWithDeepSeek(rawText, docId, docType) {
    // 小文本：沿用原有"全文插 [SPLIT]"逻辑（质量更高，不需要滑窗）
    if (rawText.length <= SMALL_TEXT_THRESHOLD) {
        const chunks = await smallTextChunk(rawText, docType);
        return chunks.map((content, idx) => ({ content, chunk_index: idx, metadata: {} }));
    }
    // 大文本：方案 B — 本地块解析 + 滑窗 + DeepSeek 输出切分点索引
    console.log(`[SmartChunk] 大文本模式 (${rawText.length} 字符)，开始块解析...`);
    const blocks = parseBlocks(rawText);
    console.log(`[SmartChunk] 解析出 ${blocks.length} 个块`);
    if (blocks.length === 0) {
        return [{ content: rawText.trim(), chunk_index: 0, metadata: {} }];
    }
    const windows = buildWindows(blocks);
    console.log(`[SmartChunk] 划分为 ${windows.length} 个窗口，开始并行调用 DeepSeek...`);
    // 并发调用各窗口（控制并发数，避免 API 限流）
    const CONCURRENCY = 3;
    const splitAfterSet = new Set();
    for (let i = 0; i < windows.length; i += CONCURRENCY) {
        const batch = windows.slice(i, i + CONCURRENCY);
        const results = await Promise.all(batch.map((w) => getSplitPointsForWindow(w.blocks)));
        results.forEach((localIndices, batchIdx) => {
            const globalStartIdx = batch[batchIdx].startIdx;
            for (const localIdx of localIndices) {
                splitAfterSet.add(globalStartIdx + localIdx);
            }
        });
    }
    // 如果 DeepSeek 完全没给出切分点，回退到长度切分
    if (splitAfterSet.size === 0) {
        console.warn("[SmartChunk] DeepSeek 未给出任何切分点，回退到长度切分");
        const fallback = fallbackChunkByLength(rawText);
        return fallback.map((content, idx) => ({ content, chunk_index: idx, metadata: {} }));
    }
    const chunkTexts = assembleChunks(blocks, splitAfterSet);
    console.log(`[SmartChunk] 最终生成 ${chunkTexts.length} 个 chunks`);
    return chunkTexts.map((content, idx) => ({ content, chunk_index: idx, metadata: {} }));
}
