/**
 * Mistral OCR API 测试 - PDF 解析为 Markdown
 * 价格：0.002 PTC/页
 * 文档：https://docs.mistral.ai/api/endpoint/ocr
 *
 * 运行：npm run test:mistral-ocr 或 node mistral-ocr.test.js
 *
 * 用法：
 *   1. 默认：使用简单单页 PDF (w3.org dummy.pdf)
 *   2. 指定 URL：MISTRAL_PDF_URL=https://xxx.pdf node mistral-ocr.test.js
 */

import "dotenv/config";

const AI_API_KEY = process.env.AI_API_KEY;
const AI_BASE_URL = process.env.AI_BASE_URL || "https://api.302.ai";
const MISTRAL_OCR_URL = `${AI_BASE_URL.replace(/\/$/, "")}/mistral/v1/ocr`;

/** 简单单页 PDF（用户要求不使用复杂 PDF） */
const SIMPLE_PDF_URL =
  process.env.MISTRAL_PDF_URL ||
  "https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf";

if (!AI_API_KEY) {
  console.error("❌ 未设置 AI_API_KEY，请在 .env 中配置");
  process.exit(1);
}

/**
 * 调用 Mistral OCR API 解析 PDF
 * @param {string} documentUrl - PDF 的公开 URL
 */
async function parsePdfWithMistral(documentUrl) {
  const body = {
    model: "mistral-ocr-latest",
    document: {
      type: "document_url",
      document_url: documentUrl,
    },
    include_image_base64: false, // 简单测试不包含图片 base64，减少响应体积
  };

  const res = await fetch(MISTRAL_OCR_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${AI_API_KEY}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HTTP ${res.status}: ${text}`);
  }

  return res.json();
}

async function run() {
  console.log("Mistral OCR API 测试 - PDF 解析为 Markdown");
  console.log("接口: POST", MISTRAL_OCR_URL);
  console.log("模型: mistral-ocr-latest");
  console.log("价格: 0.002 PTC/页");
  console.log("");

  console.log("--- 1. 测试 PDF ---");
  console.log("URL:", SIMPLE_PDF_URL);
  console.log("(简单单页 PDF，便于快速验证)");
  console.log("");

  console.log("--- 2. 提交解析请求 ---");
  const start = Date.now();
  const result = await parsePdfWithMistral(SIMPLE_PDF_URL);
  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`✓ 请求完成，耗时 ${elapsed}s`);
  console.log("");

  console.log("--- 3. 解析结果 ---");
  const { model, pages, usage_info } = result;

  console.log("模型:", model);
  if (usage_info) {
    console.log("处理页数:", usage_info.pages_processed ?? "-");
    console.log("文件大小:", usage_info.doc_size_bytes ? `${(usage_info.doc_size_bytes / 1024).toFixed(1)} KB` : "-");
  }
  console.log("");

  if (pages && pages.length > 0) {
    for (const page of pages) {
      console.log(`\n--- 第 ${page.index} 页 Markdown ---`);
      const md = page.markdown ?? "";
      console.log(md || "(空)");
    }

    const totalChars = pages.reduce((sum, p) => sum + (p.markdown?.length ?? 0), 0);
    console.log("\n--- 4. 解析统计 ---");
    console.log("总页数:", pages.length);
    console.log("总字符数:", totalChars);
  } else {
    console.log("(无页面数据)");
  }

  const hasContent = pages?.some((p) => p.markdown?.trim());
  if (hasContent) {
    console.log("\n✅ 测试通过");
    process.exit(0);
  } else {
    console.error("\n❌ 解析结果为空");
    process.exit(1);
  }
}

run().catch((e) => {
  console.error("\n❌ 测试失败:", e.message);
  process.exit(1);
});
