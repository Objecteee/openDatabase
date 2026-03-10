/**
 * 302.ai Sophnet 文档识别 API 测试
 * 支持 PDF、Word 等格式，纯文字提取（不支持 OCR）
 *
 * 运行：npm run test:doc-parse 或 node doc-parse.test.js [文件路径]
 *
 * 用法：
 *   1. 默认：优先使用 samples/complex-sample.pdf（需先运行 node scripts/generate-sample-pdf.js）
 *   2. 若无本地样本：从 URL 下载测试 PDF
 *   3. 指定文件：node doc-parse.test.js ./your.pdf
 *   4. 环境变量 SAMPLE_FILE=./xxx.pdf
 */

import "dotenv/config";
import FormData from "form-data";
import fs from "fs";
import path from "path";

const AI_BASE_URL = process.env.AI_BASE_URL || "https://api.302.ai";
const AI_API_KEY = process.env.AI_API_KEY;

if (!AI_API_KEY) {
  console.error("❌ 未设置 AI_API_KEY，请在 .env 中配置");
  process.exit(1);
}

const DOC_PARSE_URL = `${AI_BASE_URL.replace(/\/$/, "")}/sophnet/doc-parse`;

/** 测试 PDF URL 列表（按优先级尝试，复杂文档优先） */
const PDF_URLS = [
  "https://unec.edu.az/application/uploads/2014/12/pdf-sample.pdf", // 复杂：多页、多段落、列表
  "https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf", // 简单：单页
];
const SAMPLE_PDF_URL = process.env.SAMPLE_PDF_URL;

/**
 * 将 FormData 流转为 Buffer（form-data 包无 getBuffer 时使用）
 */
async function streamToBuffer(form) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    form.on("data", (c) => chunks.push(c));
    form.on("end", () => resolve(Buffer.concat(chunks)));
    form.on("error", reject);
  });
}

/**
 * 解析文档
 * @param {Buffer} fileBuffer - 文件二进制
 * @param {string} filename - 文件名（用于 Content-Disposition）
 */
async function parseDocument(fileBuffer, filename = "document.pdf") {
  const form = new FormData();
  form.append("file", fileBuffer, {
    filename,
    contentType: getContentType(filename),
  });

  const res = await fetch(DOC_PARSE_URL, {
    method: "POST",
    headers: {
      ...form.getHeaders(),
      Authorization: `Bearer ${AI_API_KEY}`,
    },
    body: form.getBuffer ? form.getBuffer() : await streamToBuffer(form),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HTTP ${res.status}: ${text}`);
  }

  return res.json();
}

function getContentType(filename) {
  const ext = (path.extname(filename) || "").toLowerCase();
  const map = {
    ".pdf": "application/pdf",
    ".doc": "application/msword",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  };
  return map[ext] || "application/octet-stream";
}

async function run() {
  console.log("302.ai Sophnet 文档识别 API 测试");
  console.log("Base URL:", AI_BASE_URL);
  console.log("接口: POST /sophnet/doc-parse");
  console.log("说明: 支持 PDF、Word，纯文字提取（不支持 OCR）");

  let buffer;
  let filename;

  const defaultComplexPdf = path.join(process.cwd(), "samples", "complex-sample.pdf");
  const filePath = process.env.SAMPLE_FILE || process.argv[2] || (fs.existsSync(defaultComplexPdf) ? defaultComplexPdf : null);

  if (filePath && fs.existsSync(filePath)) {
    console.log("\n--- 1. 读取本地文件 ---");
    console.log("文件路径:", filePath);
    buffer = fs.readFileSync(filePath);
    filename = path.basename(filePath);
  } else {
    console.log("\n--- 1. 获取测试 PDF ---");
    const urlsToTry = SAMPLE_PDF_URL ? [SAMPLE_PDF_URL] : PDF_URLS;
    let lastError;
    for (const url of urlsToTry) {
      console.log("尝试 URL:", url);
      try {
        const pdfRes = await fetch(url, { signal: AbortSignal.timeout(15000) });
        if (!pdfRes.ok) throw new Error(`HTTP ${pdfRes.status}`);
        buffer = Buffer.from(await pdfRes.arrayBuffer());
        filename = url.includes("pdf-sample") ? "pdf-sample.pdf" : "dummy.pdf";
        console.log("✓ 获取成功");
        break;
      } catch (e) {
        lastError = e;
        console.log("  失败:", e.message);
      }
    }
    if (!buffer) {
      console.error("❌ 无法获取测试 PDF，请使用本地文件: node doc-parse.test.js ./your.pdf");
      process.exit(1);
    }
  }

  console.log("文件大小:", (buffer.length / 1024).toFixed(1), "KB");

  console.log("\n--- 2. 提交文档解析 ---");
  const result = await parseDocument(buffer, filename);

  console.log("\n--- 3. 解析结果 ---");
  const text = result?.data ?? "";
  if (text) {
    console.log(text);
    // 简单统计：便于观察复杂文档的处理效果
    const paragraphs = text.split(/\n\s*\n/).filter((p) => p.trim());
    const lines = text.split(/\n/).filter((l) => l.trim());
    console.log("\n--- 4. 解析统计 ---");
    console.log("输出字符数:", text.length);
    console.log("段落数:", paragraphs.length);
    console.log("非空行数:", lines.length);
  } else {
    console.log("(空)");
    console.log("\n输出字符数: 0");
  }

  const hasContent = typeof text === "string" && text.trim().length > 0;
  if (hasContent) {
    if (process.env.SAVE_OUTPUT) {
      const outPath = path.join(process.cwd(), process.env.SAVE_OUTPUT);
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      fs.writeFileSync(outPath, text, "utf-8");
      console.log("\n解析结果已保存至:", outPath);
    }
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
