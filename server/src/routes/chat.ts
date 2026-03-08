/**
 * Chat 对话路由 - SSE 流式输出
 */

import { Router, Request, Response } from "express";
import { createChatStream, type ChatMessage } from "../services/aiProvider.js";

const router = Router();

router.post("/chat", async (req: Request, res: Response) => {
  const { messages } = req.body as { messages?: ChatMessage[] };

  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    res.status(400).json({ error: "messages 为必填项，且不能为空数组" });
    return;
  }

  const systemPrompt: ChatMessage = {
    role: "system",
    content:
      "你是一个有帮助的助手。请始终使用 Markdown 格式回复，包括标题、列表、代码块、加粗、链接等，以便更好地呈现内容。",
  };

  const messagesWithSystem = [systemPrompt, ...messages];

  try {
    const streamRes = await createChatStream(messagesWithSystem);

    if (!streamRes.ok) {
      const text = await streamRes.text();
      res.status(streamRes.status).json({ error: text || "AI 服务请求失败" });
      return;
    }

    const stream = streamRes.body;
    if (!stream) {
      res.status(500).json({ error: "无法获取响应流" });
      return;
    }

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();

    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const data = line.slice(6);
            if (data === "[DONE]") continue;
            res.write(`data: ${data}\n\n`);
            if (typeof (res as any).flush === "function") {
              (res as any).flush();
            }
          }
        }
      }
      if (buffer.trim()) {
        if (buffer.startsWith("data: ")) res.write(buffer + "\n\n");
      }
    } finally {
      reader.releaseLock();
    }

    res.write("data: [DONE]\n\n");
    res.end();
  } catch (e) {
    console.error("Chat stream error:", e);
    if (!res.headersSent) {
      res.status(500).json({
        error: e instanceof Error ? e.message : "服务器内部错误",
      });
    }
  }
});

export default router;
