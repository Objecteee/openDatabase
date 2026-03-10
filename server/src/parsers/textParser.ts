/**
 * 文本解析与切片（txt、md）
 * 按段落优先，超长则按固定长度切，带重叠
 */

const CHUNK_SIZE = 500;
const CHUNK_OVERLAP = 50;

function splitByParagraphs(text: string): string[] {
  const paragraphs = text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  return paragraphs;
}

function splitLongChunk(chunk: string): string[] {
  const result: string[] = [];
  let start = 0;
  while (start < chunk.length) {
    const end = Math.min(start + CHUNK_SIZE, chunk.length);
    result.push(chunk.slice(start, end));
    start = end - CHUNK_OVERLAP;
    if (start >= chunk.length) break;
  }
  return result;
}

export interface ParsedChunk {
  content: string;
  chunk_index: number;
  metadata: Record<string, unknown>;
}

/**
 * 解析文本为切片
 */
export function parseTextToChunks(text: string): ParsedChunk[] {
  const paragraphs = splitByParagraphs(text);
  const chunks: ParsedChunk[] = [];
  let idx = 0;
  for (const p of paragraphs) {
    if (p.length <= CHUNK_SIZE) {
      chunks.push({ content: p, chunk_index: idx++, metadata: {} });
    } else {
      for (const sub of splitLongChunk(p)) {
        chunks.push({ content: sub, chunk_index: idx++, metadata: {} });
      }
    }
  }
  return chunks;
}
