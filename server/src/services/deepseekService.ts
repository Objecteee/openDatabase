/**
 * DeepSeek 模型服务：用于智能切片与语义增强
 * API 文档：https://platform.deepseek.com/api-docs/
 */

const DEEPSEEK_BASE_URL = process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com";
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;

const CHAT_URL = `${DEEPSEEK_BASE_URL.replace(/\/$/, "")}/v1/chat/completions`;

export async function callDeepSeek(
  messages: Array<{ role: "user" | "assistant" | "system"; content: string }>,
  options?: { temperature?: number; max_tokens?: number }
): Promise<string> {
  if (!DEEPSEEK_API_KEY) throw new Error("DEEPSEEK_API_KEY 未配置，请在 .env 中设置");

  const res = await fetch(CHAT_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${DEEPSEEK_API_KEY}`,
    },
    body: JSON.stringify({
      model: "deepseek-chat",
      messages,
      temperature: options?.temperature ?? 0.3,
      max_tokens: options?.max_tokens ?? 4096,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`DeepSeek API 错误 ${res.status}: ${text}`);
  }

  const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const content = json.choices?.[0]?.message?.content ?? "";
  return content.trim();
}
