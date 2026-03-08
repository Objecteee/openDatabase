/**
 * 302.ai Chat API 测试
 * 支持纯文本对话，以及文本 + 图片多模态输入
 *
 * 运行前：复制 .env.example 为 .env，填入 AI_API_KEY
 * 运行：npm run test:chat 或 node chat-api.test.js
 */

import "dotenv/config";

const AI_BASE_URL = process.env.AI_BASE_URL || "https://api.302.ai";
const AI_API_KEY = process.env.AI_API_KEY;

if (!AI_API_KEY) {
  console.error("❌ 未设置 AI_API_KEY，请在 .env 中配置或执行：");
  console.error("   AI_API_KEY=your_key node chat-api.test.js");
  process.exit(1);
}

const CHAT_URL = `${AI_BASE_URL.replace(/\/$/, "")}/v1/chat/completions`;

/**
 * 调用 Chat API（非流式）
 */
async function chat(messages, options = {}) {
  const res = await fetch(CHAT_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${AI_API_KEY}`,
    },
    body: JSON.stringify({
      model: options.model || "gemini-2.5-flash",
      messages,
      stream: false,
      max_tokens: options.max_tokens ?? 1024,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HTTP ${res.status}: ${text}`);
  }

  return res.json();
}

/**
 * 测试 1：纯文本对话
 */
async function testTextChat() {
  console.log("\n--- 测试 1：纯文本对话 ---");
  const messages = [{ role: "user", content: "你好，请用一句话介绍你自己。" }];
  const data = await chat(messages);
  const content = data?.choices?.[0]?.message?.content ?? "";
  const usage = data?.usage ?? {};
  console.log("回复:", content.trim());
  console.log("Token 使用:", usage);
  return content.length > 0;
}

/**
 * 测试 2：文本 + 图片（多模态）
 * 使用 base64 图片 URL，格式：data:image/jpeg;base64,<base64>
 */
async function testImageChat() {
  console.log("\n--- 测试 2：文本 + 图片（多模态）---");
  // 1x1 透明 PNG 的 base64，仅用于验证接口是否支持图片
  const tinyImageBase64 =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
  const imageUrl = `data:image/png;base64,${tinyImageBase64}`;

  const messages = [
    {
      role: "user",
      content: [
        { type: "text", text: "这张图片里有什么？请简短回答。" },
        {
          type: "image_url",
          image_url: { url: imageUrl },
        },
      ],
    },
  ];

  try {
    const data = await chat(messages);
    const content = data?.choices?.[0]?.message?.content ?? "";
    console.log("回复:", content.trim() || "(空)");
    return true;
  } catch (e) {
    console.warn("图片测试可能不被当前模型支持:", e.message);
    return false;
  }
}

async function run() {
  console.log("302.ai Chat API 测试");
  console.log("Base URL:", AI_BASE_URL);

  try {
    const ok1 = await testTextChat();
    const ok2 = await testImageChat();
    console.log("\n--- 结果 ---");
    console.log("纯文本:", ok1 ? "✅ 通过" : "❌ 失败");
    console.log("文本+图片:", ok2 ? "✅ 通过" : "⚠️ 跳过或失败");
    process.exit(ok1 ? 0 : 1);
  } catch (e) {
    console.error("\n❌ 测试失败:", e.message);
    process.exit(1);
  }
}

run();
