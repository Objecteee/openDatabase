/**
 * 302.ai Video Understanding API 测试
 * 异步接口：提交视频理解任务，返回 request_id
 *
 * 运行：npm run test:video 或 node video-understanding.test.js
 */

import "dotenv/config";

const AI_BASE_URL = process.env.AI_BASE_URL || "https://api.302.ai";
const AI_API_KEY = process.env.AI_API_KEY;

if (!AI_API_KEY) {
  console.error("❌ 未设置 AI_API_KEY，请在 .env 中配置");
  process.exit(1);
}

const VIDEO_UNDERSTANDING_URL = `${AI_BASE_URL.replace(/\/$/, "")}/302/submit/video-understanding`;

/**
 * 提交视频理解任务
 */
async function submitVideoUnderstanding(videoUrl, prompt) {
  const res = await fetch(VIDEO_UNDERSTANDING_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${AI_API_KEY}`,
    },
    body: JSON.stringify({ video_url: videoUrl, prompt }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HTTP ${res.status}: ${text}`);
  }

  return res.json();
}

/**
 * 获取视频理解结果（轮询直到有 output）
 */
async function getVideoUnderstandingResult(requestId) {
  const url = `${VIDEO_UNDERSTANDING_URL}?request_id=${encodeURIComponent(requestId)}`;
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

  return res.json();
}

/**
 * 轮询获取结果，直到有 output 或超时
 */
async function pollForResult(requestId, options = {}) {
  const { intervalMs = 3000, maxAttempts = 60 } = options;

  for (let i = 0; i < maxAttempts; i++) {
    const data = await getVideoUnderstandingResult(requestId);

    if (data.output != null && data.output !== "") {
      return data.output;
    }

    if (i < maxAttempts - 1) {
      console.log(`  等待中... (${i + 1}/${maxAttempts})`);
      await new Promise((r) => setTimeout(r, intervalMs));
    }
  }

  throw new Error("轮询超时，未获取到 output");
}

async function run() {
  console.log("302.ai Video Understanding API 测试");
  console.log("Base URL:", AI_BASE_URL);

  const videoUrl =
    "https://file.302.ai/gpt/imgs/20250722/fcdc31fe86da4091a7795189ab2614f6.mp4";
  const prompt = "What is happening in this video?";

  console.log("\n--- 1. 提交视频理解任务 ---");
  console.log("视频 URL:", videoUrl);
  console.log("Prompt:", prompt);

  try {
    const submitData = await submitVideoUnderstanding(videoUrl, prompt);
    const { request_id, status, queue_position } = submitData;

    if (!request_id) {
      console.error("❌ 响应缺少 request_id:", submitData);
      process.exit(1);
    }

    console.log("\n--- 2. 提交响应 ---");
    console.log("request_id:", request_id);
    console.log("status:", status);
    console.log("queue_position:", queue_position ?? "(无)");

    console.log("\n--- 3. 轮询获取结果 ---");
    const output = await pollForResult(request_id);

    console.log("\n--- 4. 视频理解结果 ---");
    console.log(output);
    console.log("\n✅ 测试通过");
    process.exit(0);
  } catch (e) {
    console.error("\n❌ 测试失败:", e.message);
    process.exit(1);
  }
}

run();
