/**
 * 302.ai Chat API 封装
 * 支持 SSE 流式输出
 */

const AI_BASE_URL = process.env.AI_BASE_URL || "https://api.302.ai";
const AI_API_KEY = process.env.AI_API_KEY;

const CHAT_URL = `${AI_BASE_URL.replace(/\/$/, "")}/v1/chat/completions`;

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatStreamOptions {
  model?: string;
  maxTokens?: number;
}

/**
 * 调用 Chat API，返回 SSE 流（stream: true）
 */
export function createChatStream(
  messages: ChatMessage[],
  options: ChatStreamOptions = {}
): Promise<Response> {
  if (!AI_API_KEY) {
    throw new Error("AI_API_KEY 未配置");
  }

  return fetch(CHAT_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${AI_API_KEY}`,
    },
    body: JSON.stringify({
      model: options.model || process.env.AI_MODEL || "deepseek-chat",
      messages,
      stream: true,
      max_tokens: options.maxTokens ?? 4096,
    }),
  });
}
