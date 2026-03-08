/**
 * 302.ai MinerU PDF 解析 API 测试
 * 创建任务 → 轮询获取解析结果
 *
 * 运行：npm run test:pdf 或 node pdf-mineru.test.js
 */

import "dotenv/config";

const AI_BASE_URL = process.env.AI_BASE_URL || "https://api.302.ai";
const AI_API_KEY = process.env.AI_API_KEY;

if (!AI_API_KEY) {
  console.error("❌ 未设置 AI_API_KEY，请在 .env 中配置");
  process.exit(1);
}

const PDF_MINERU_URL = `${AI_BASE_URL.replace(/\/$/, "")}/302/v2/mineru/task`;

/** PDF 文件 URL */
const PDF_URL =
  process.env.PDF_URL ||
  "https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf";

/** 解析方法：ocr | txt | auto */
const PARSE_METHOD = process.env.PARSE_METHOD || "auto";

/** MinerU 版本：2.0 | 2.5 */
const VERSION = process.env.MINERU_VERSION || "2.5";

/**
 * 创建 PDF 解析任务
 */
async function createPdfParseTask(options = {}) {
  const res = await fetch(PDF_MINERU_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${AI_API_KEY}`,
    },
    body: JSON.stringify({
      pdf_url: options.pdf_url || PDF_URL,
      parse_method: options.parse_method || PARSE_METHOD,
      version: options.version || VERSION,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HTTP ${res.status}: ${text}`);
  }

  const contentType = res.headers.get("content-type");
  if (contentType?.includes("application/json")) {
    return res.json();
  }
  return res.text();
}

/**
 * 查看 PDF 解析任务结果
 */
async function getPdfParseTaskResult(taskId) {
  const url = `${PDF_MINERU_URL}?task_id=${encodeURIComponent(taskId)}`;
  const res = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${AI_API_KEY}`,
    },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HTTP ${res.status}: ${text}`);
  }

  const contentType = res.headers.get("content-type");
  if (contentType?.includes("application/json")) {
    return res.json();
  }
  return res.text();
}

/**
 * 判断任务是否已完成
 */
function isTaskComplete(data) {
  if (data == null) return false;
  if (typeof data === "string") return data.length > 0 && !/pending|processing/i.test(data);
  const status = (data.status ?? data.state ?? "").toLowerCase();
  if (status === "failed" || status === "failure" || status === "error") {
    throw new Error(data.message || data.error || data.detail || "任务失败");
  }
  const hasContent = (data.result ?? data.output ?? data.content) != null;
  return status === "completed" || status === "success" || status === "done" || hasContent;
}

/**
 * 轮询获取解析结果
 */
async function pollForResult(taskId, options = {}) {
  const { intervalMs = 5000, maxAttempts = 120 } = options;

  for (let i = 0; i < maxAttempts; i++) {
    const data = await getPdfParseTaskResult(taskId);

    if (isTaskComplete(data)) {
      return data;
    }

    if (i < maxAttempts - 1) {
      const status = typeof data === "object" ? data.status ?? data.state : "(查询中)";
      console.log(`  等待中... (${i + 1}/${maxAttempts}) 状态: ${status}`);
      await new Promise((r) => setTimeout(r, intervalMs));
    }
  }

  throw new Error("轮询超时，未获取到解析结果");
}

async function run() {
  console.log("302.ai MinerU PDF 解析 API 测试");
  console.log("Base URL:", AI_BASE_URL);

  console.log("\n--- 1. 创建 PDF 解析任务 ---");
  console.log("pdf_url:", PDF_URL);
  console.log("parse_method:", PARSE_METHOD);
  console.log("version:", VERSION);

  try {
    const submitResult = await createPdfParseTask();
    const taskId = typeof submitResult === "string" ? submitResult : submitResult?.task_id;

    if (!taskId) {
      console.error("❌ 响应缺少 task_id:", submitResult);
      process.exit(1);
    }

    console.log("\n--- 2. 提交响应 ---");
    console.log("task_id:", taskId);

    console.log("\n--- 3. 轮询获取解析结果 ---");
    const result = await pollForResult(taskId);

    console.log("\n--- 4. PDF 解析结果 ---");
    if (typeof result === "string") {
      console.log(result);
    } else {
      console.log(JSON.stringify(result, null, 2));
    }

    console.log("\n✅ 测试通过");
    process.exit(0);
  } catch (e) {
    console.error("\n❌ 测试失败:", e.message);
    process.exit(1);
  }
}

run();
