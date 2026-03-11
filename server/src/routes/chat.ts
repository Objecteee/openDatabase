/**
 * Chat 对话路由 - RAG 增强 + SSE 流式输出
 *
 * 请求体：
 *   messages:       ChatMessage[]   完整对话历史
 *   queryEmbedding: number[]        前端已计算好的查询向量（384维）
 *                                   若不传，退化为纯对话模式
 *
 * SSE 事件格式：
 *   data: <OpenAI delta JSON>       流式 token（标准格式）
 *   data: {"type":"citations","chunks":[...]}  引用来源（在流开始前发送）
 *   data: [DONE]                    结束标记
 */

import { Router, Request, Response } from "express";
import { createChatStream, type ChatMessage } from "../services/aiProvider.js";
import { buildRagContext, buildRagSystemPrompt, type RagChunk } from "../services/ragService.js";
import { supabase } from "../lib/supabase.js";
import { getDocumentById } from "../services/documentService.js";

const router = Router();

router.post("/chat", async (req: Request, res: Response) => {
  const { messages, queryEmbedding } = req.body as {
    messages?: ChatMessage[];
    queryEmbedding?: number[];
  };

  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    res.status(400).json({ error: "messages 为必填项，且不能为空数组" });
    return;
  }

  // ── 提前设置 SSE 响应头 ──────────────────────────────────────────
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  function sendEvent(data: unknown) {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
    if (typeof (res as unknown as { flush?: () => void }).flush === "function") {
      (res as unknown as { flush: () => void }).flush();
    }
  }

  try {
    // ── Step 1-3: RAG 流程（仅当前端传入查询向量时执行）────────────
    let ragChunks: RagChunk[] = [];
    let systemPrompt: string;

    if (Array.isArray(queryEmbedding) && queryEmbedding.length === 384) {
      try {
        const ragContext = await buildRagContext(messages, queryEmbedding);

        if (ragContext.type === "rag" && ragContext.chunks.length > 0) {
          ragChunks = ragContext.chunks;

          // 为每个 chunk 的来源文档生成签名 URL（1 小时有效），供前端跳转源文件
          const fileUrlMap = await buildFileUrlMap(ragChunks);

          // 在流式 token 之前先发送引用来源事件，前端可立即渲染来源卡片
          sendEvent({
            type: "citations",
            chunks: ragChunks.map((c) => ({
              id: c.id,
              document_id: c.document_id,
              content: c.content.slice(0, 200),
              metadata: c.metadata,
              // 从 metadata 中提取溯源字段，方便前端直接读取
              document_name: (c.metadata?.document_name as string | undefined) ?? null,
              pointer: (c.metadata?.pointer as string | undefined) ?? null,
              file_url: fileUrlMap.get(c.document_id) ?? null,
            })),
          });
        }

        systemPrompt = buildRagSystemPrompt(ragChunks);
      } catch (ragErr) {
        // RAG 流程失败，降级为纯对话，不中断响应
        console.error("[RAG] 流程失败，降级为纯对话:", ragErr);
        systemPrompt = "你是一个有帮助的助手。请始终使用 Markdown 格式回复。";
      }
    } else {
      // 未传入向量，纯对话模式
      systemPrompt = "你是一个有帮助的助手。请始终使用 Markdown 格式回复。";
    }

    // ── 调用 AI 生成回答 ─────────────────────────────────────────────
    const messagesWithSystem: ChatMessage[] = [
      { role: "system", content: systemPrompt },
      ...messages,
    ];

    const streamRes = await createChatStream(messagesWithSystem);

    if (!streamRes.ok) {
      const text = await streamRes.text();
      sendEvent({ type: "error", error: text || "AI 服务请求失败" });
      res.end();
      return;
    }

    const stream = streamRes.body;
    if (!stream) {
      sendEvent({ type: "error", error: "无法获取响应流" });
      res.end();
      return;
    }

    // ── 转发 SSE 流 ──────────────────────────────────────────────────
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
            if (typeof (res as unknown as { flush?: () => void }).flush === "function") {
              (res as unknown as { flush: () => void }).flush();
            }
          }
        }
      }

      if (buffer.trim() && buffer.startsWith("data: ")) {
        res.write(buffer + "\n\n");
      }
    } finally {
      reader.releaseLock();
    }

    res.write("data: [DONE]\n\n");
    res.end();
  } catch (e) {
    console.error("Chat stream error:", e);
    if (!res.headersSent) {
      res.status(500).json({ error: e instanceof Error ? e.message : "服务器内部错误" });
    } else {
      sendEvent({ type: "error", error: e instanceof Error ? e.message : "服务器内部错误" });
      res.end();
    }
  }
});

export default router;

// ─── 辅助函数 ─────────────────────────────────────────────────────────

/**
 * 为 RAG chunks 涉及的文档批量生成 Supabase Storage 签名 URL（1 小时有效）。
 * 同一文档只请求一次，返回 Map<document_id, signedUrl>。
 * 失败时静默忽略，不影响对话流程。
 */
async function buildFileUrlMap(chunks: RagChunk[]): Promise<Map<string, string>> {
  const urlMap = new Map<string, string>();
  if (!supabase) return urlMap;

  const uniqueDocIds = [...new Set(chunks.map((c) => c.document_id))];

  await Promise.allSettled(
    uniqueDocIds.map(async (docId) => {
      try {
        const doc = await getDocumentById(docId);
        if (!doc?.storage_path) return;
        const { data, error } = await supabase!.storage
          .from("documents")
          .createSignedUrl(doc.storage_path, 3600);
        if (!error && data?.signedUrl) {
          urlMap.set(docId, data.signedUrl);
        }
      } catch {
        // 静默忽略，不阻断对话
      }
    }),
  );

  return urlMap;
}
