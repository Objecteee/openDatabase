/**
 * Markitdown 解析器
 *
 * 将各类文档（docx、xlsx、pptx、csv、json、html、xml、图片等）
 * 通过 302.ai Markitdown API 转换为 Markdown 文本，
 * 供后续的 smartChunkingParser 和 semanticEnrichmentService 处理。
 *
 * 支持的文件类型（由 API 决定）：
 *   .pptx .docx .xlsx .xls .csv .json .pdf
 *   .jpg .jpeg .png .zip .html .xml .wav .mp3 .m4a
 *
 * 环境变量：
 *   AI_API_KEY  — 302.ai API Key（必填）
 *   AI_BASE_URL — 302.ai Base URL（默认 https://api.302.ai）
 */

const AI_API_KEY = process.env.AI_API_KEY;
const AI_BASE_URL = (process.env.AI_BASE_URL || "https://api.302.ai").replace(/\/$/, "");
const MARKITDOWN_URL = `${AI_BASE_URL}/302/markitdown/convert`;

/**
 * 将文件 Buffer 通过 Markitdown API 转换为 Markdown 文本。
 *
 * @param fileBuffer  文件的二进制内容
 * @param fileName    文件名（含扩展名，用于 API 识别类型）
 * @param mimeType    MIME 类型（可选，兜底为 application/octet-stream）
 */
export async function convertToMarkdown(
  fileBuffer: Buffer,
  fileName: string,
  mimeType = "application/octet-stream",
): Promise<string> {
  if (!AI_API_KEY) {
    throw new Error("AI_API_KEY 未配置，无法调用 Markitdown API");
  }

  const formData = new FormData();
  formData.append("source_data_type", "file");
  formData.append(
    "file",
    new Blob([fileBuffer], { type: mimeType }),
    fileName,
  );

  console.log(`[markitdownParser] 开始转换文件: ${fileName} (${(fileBuffer.length / 1024).toFixed(1)} KB)`);

  const response = await fetch(MARKITDOWN_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${AI_API_KEY}`,
    },
    body: formData,
  });

  const rawText = await response.text();

  if (!response.ok) {
    throw new Error(`Markitdown API 请求失败 (${response.status}): ${rawText}`);
  }

  // API 有时直接返回 Markdown 文本，有时返回 { data: "..." } JSON
  let mdText: string;
  try {
    const json = JSON.parse(rawText) as { data?: string };
    mdText = json.data ?? rawText;
  } catch {
    mdText = rawText;
  }

  if (!mdText || !mdText.trim()) {
    throw new Error(`Markitdown API 返回内容为空（文件: ${fileName}）`);
  }

  console.log(`[markitdownParser] 转换完成: ${fileName}，Markdown 长度 ${mdText.length} 字符`);
  return mdText;
}

/**
 * 根据文件扩展名推断 MIME 类型
 */
export function getMimeTypeByExt(ext: string): string {
  const map: Record<string, string> = {
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    xls: "application/vnd.ms-excel",
    pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    csv: "text/csv",
    json: "application/json",
    html: "text/html",
    xml: "application/xml",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    zip: "application/zip",
  };
  return map[ext.toLowerCase()] ?? "application/octet-stream";
}

/**
 * 判断某扩展名是否应走 Markitdown 转换流程。
 * 排除已有专用解析器的类型（txt、md、pdf）和媒体类型（mp4、mp3、wav、m4a）。
 */
export function shouldUseMarkitdown(type: string): boolean {
  const excluded = new Set(["txt", "md", "pdf", "video", "audio"]);
  return !excluded.has(type);
}
