/**
 * Mistral OCR 解析器
 *
 * 将 PDF Buffer 通过 Mistral OCR API 转换为 Markdown 文本。
 * 图片内容会被 OCR 识别并以 base64 内嵌形式保留在 Markdown 中，
 * 供后续的 smartChunkingParser 和 semanticEnrichmentService 处理。
 *
 * 环境变量：
 *   AI_API_KEY    — 302.ai API Key（必填）
 *   AI_BASE_URL   — 302.ai Base URL（默认 https://api.302.ai）
 */

const AI_API_KEY = process.env.AI_API_KEY;
const AI_BASE_URL = (process.env.AI_BASE_URL || "https://api.302.ai").replace(/\/$/, "");
const MISTRAL_OCR_URL = `${AI_BASE_URL}/mistral/v1/ocr`;
const MISTRAL_OCR_MODEL = process.env.MISTRAL_OCR_MODEL || "mistral-ocr-latest";

export interface OcrPage {
  index: number;
  markdown: string;
  images: Array<{ id: string; image_base64?: string }>;
  dimensions: { dpi: number; height: number; width: number };
}

export interface OcrResult {
  pages: OcrPage[];
  /** 拼接后的完整 Markdown（各页以分隔线连接） */
  fullMarkdown: string;
}

/**
 * 将 PDF Buffer 发送至 Mistral OCR API，返回解析结果。
 *
 * @param pdfBuffer  PDF 文件的二进制内容
 * @param includeImageBase64  是否在响应中内嵌图片 base64（默认 true，供后续处理）
 */
export async function parsePdfWithMistralOcr(
  pdfBuffer: Buffer,
  includeImageBase64 = true,
): Promise<OcrResult> {
  if (!AI_API_KEY) {
    throw new Error("AI_API_KEY 未配置，无法调用 Mistral OCR API");
  }

  const base64 = pdfBuffer.toString("base64");
  const dataUrl = `data:application/pdf;base64,${base64}`;

  const response = await fetch(MISTRAL_OCR_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${AI_API_KEY}`,
    },
    body: JSON.stringify({
      model: MISTRAL_OCR_MODEL,
      document: {
        type: "document_url",
        document_url: dataUrl,
      },
      include_image_base64: includeImageBase64,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Mistral OCR API 请求失败 (${response.status}): ${text}`);
  }

  const result = await response.json() as {
    pages?: Array<{
      index: number;
      markdown: string;
      images?: Array<{ id: string; image_base64?: string }>;
      dimensions?: { dpi: number; height: number; width: number };
    }>;
  };

  if (!result.pages || result.pages.length === 0) {
    throw new Error("Mistral OCR API 返回结果为空");
  }

  const pages: OcrPage[] = result.pages.map((p) => ({
    index: p.index,
    markdown: p.markdown ?? "",
    images: p.images ?? [],
    dimensions: p.dimensions ?? { dpi: 72, height: 0, width: 0 },
  }));

  // 将各页 Markdown 拼接，页间插入分隔线，保留图片引用
  const fullMarkdown = pages
    .map((p) => {
      let md = p.markdown;
      // 将页内图片的 base64 内嵌到 Markdown 中，替换 ![img-N.jpeg](img-N.jpeg) 形式的引用
      for (const img of p.images) {
        if (img.image_base64) {
          const ext = img.id.split(".").pop() || "jpeg";
          const mimeType = ext === "png" ? "image/png" : "image/jpeg";
          const dataUri = `data:${mimeType};base64,${img.image_base64}`;
          // 替换 Markdown 中对该图片的引用（src 为 id 本身）
          md = md.replace(
            new RegExp(`!\\[([^\\]]*)\\]\\(${escapeRegex(img.id)}\\)`, "g"),
            `![$1](${dataUri})`,
          );
        }
      }
      return md;
    })
    .join("\n\n---\n\n");

  return { pages, fullMarkdown };
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
