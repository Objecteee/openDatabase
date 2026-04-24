/**
 * Chat 对话路由 - RAG 增强 + SSE 流式输出 + 会话持久化
 *
 * 请求体：
 *   messages:         ChatMessage[]   完整对话历史
 *   queryEmbedding:   number[]        前端已计算好的查询向量（384维），不传则纯对话
 *   conversation_id:  string?         可选；不传则服务端创建新会话并在首条事件中返回
 *   document_ids:     string[]?      可选；RAG 检索时仅在这些文档的 chunks 中搜索
 *
 * SSE 事件格式：
 *   data: {"type":"conversation_id","id":"..."}  仅当未传 conversation_id 时首条发送
 *   data: {"type":"citations","chunks":[...]}   引用来源（RAG 时在流开始前发送）
 *   data: <OpenAI delta JSON>                   流式 token
 *   data: [DONE]                                结束标记
 */
import { Router } from "express";
import { createChatStream } from "../services/aiProvider.js";
import { buildRagContext, buildRagSystemPrompt } from "../services/ragService.js";
import { supabase } from "../lib/supabase.js";
import { getDocumentById } from "../services/documentService.js";
import { createConversation, getConversationById, updateConversationTitle, updateConversationUpdatedAt, } from "../services/conversationService.js";
import { createMessage, getMessagesByConversation } from "../services/messageService.js";
import { getConversationDocumentIds } from "../services/conversationDocumentsService.js";
const router = Router();
router.post("/chat", async (req, res) => {
    const { messages, queryEmbedding, conversation_id: bodyConversationId, document_ids: bodyDocumentIds } = req.body;
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
        res.status(400).json({ error: "messages 为必填项，且不能为空数组" });
        return;
    }
    const lastMessage = messages[messages.length - 1];
    const lastUserContent = lastMessage?.role === "user" && typeof lastMessage.content === "string"
        ? lastMessage.content
        : "";
    if (!lastUserContent.trim()) {
        res.status(400).json({ error: "最后一条消息须为用户消息且内容非空" });
        return;
    }
    let conversationId;
    const userId = req.user?.id;
    if (!userId) {
        res.status(401).json({ error: "未登录" });
        return;
    }
    try {
        if (bodyConversationId && typeof bodyConversationId === "string") {
            const conv = await getConversationById(bodyConversationId);
            if (!conv || conv.user_id !== userId) {
                res.status(404).json({ error: "会话不存在" });
                return;
            }
            conversationId = bodyConversationId;
        }
        else {
            conversationId = await createConversation(userId);
        }
    }
    catch (e) {
        console.error("[chat] resolve conversation error:", e);
        res.status(500).json({ error: e instanceof Error ? e.message : "服务器错误" });
        return;
    }
    // ── 提前设置 SSE 响应头（此后只能写 SSE 或 end）────────────────────
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();
    function sendEvent(data) {
        res.write(`data: ${JSON.stringify(data)}\n\n`);
        if (typeof res.flush === "function") {
            res.flush();
        }
    }
    try {
        if (!bodyConversationId) {
            sendEvent({ type: "conversation_id", id: conversationId });
        }
        const existingMessages = await getMessagesByConversation(conversationId);
        const isFirstMessage = existingMessages.length === 0;
        await createMessage({
            conversation_id: conversationId,
            user_id: userId,
            role: "user",
            content: lastUserContent,
        });
        if (isFirstMessage) {
            const title = lastUserContent.trim().slice(0, 50);
            await updateConversationTitle(conversationId, title || "新对话");
        }
        // ── Step 1-3: RAG 流程（仅当前端传入查询向量时执行）────────────
        let ragChunks = [];
        let systemPrompt;
        /** 供流结束后写入 messages 的引用结构（与前端 citations 一致） */
        let citationsForPersist = [];
        const explicitDocumentIds = Array.isArray(bodyDocumentIds)
            ? bodyDocumentIds.filter((id) => typeof id === "string" && /^[0-9a-f-]{36}$/i.test(id))
            : undefined;
        // 若前端未显式传 document_ids，则使用会话绑定文档作为默认检索范围
        const boundDocumentIds = explicitDocumentIds && explicitDocumentIds.length > 0
            ? explicitDocumentIds
            : await getConversationDocumentIds(conversationId, userId).catch(() => []);
        if (Array.isArray(queryEmbedding) && queryEmbedding.length === 384) {
            try {
                const filterIds = boundDocumentIds.length > 0 ? boundDocumentIds : undefined;
                const ragContext = await buildRagContext(messages, queryEmbedding, userId, filterIds);
                if (ragContext.type === "rag" && ragContext.chunks.length > 0) {
                    ragChunks = ragContext.chunks;
                    const fileUrlMap = await buildFileUrlMap(ragChunks);
                    citationsForPersist = ragChunks.map((c) => ({
                        id: c.id,
                        document_id: c.document_id,
                        content: c.content.slice(0, 200),
                        metadata: c.metadata,
                        document_name: c.metadata?.document_name ?? null,
                        pointer: c.metadata?.pointer ?? null,
                        file_url: fileUrlMap.get(c.document_id) ?? null,
                    }));
                    sendEvent({ type: "citations", chunks: citationsForPersist });
                }
                systemPrompt = buildRagSystemPrompt(ragChunks);
            }
            catch (ragErr) {
                console.error("[RAG] 流程失败，降级为纯对话:", ragErr);
                systemPrompt = "你是一个有帮助的助手。请始终使用 Markdown 格式回复。";
            }
        }
        else {
            systemPrompt = "你是一个有帮助的助手。请始终使用 Markdown 格式回复。";
        }
        const messagesWithSystem = [
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
        const reader = stream.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let fullContent = "";
        try {
            while (true) {
                const { done, value } = await reader.read();
                if (done)
                    break;
                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split("\n");
                buffer = lines.pop() || "";
                for (const line of lines) {
                    if (line.startsWith("data: ")) {
                        const data = line.slice(6);
                        if (data === "[DONE]")
                            continue;
                        const content = (() => {
                            try {
                                const j = JSON.parse(data);
                                return j.choices?.[0]?.delta?.content ?? j.choices?.[0]?.message?.content;
                            }
                            catch {
                                return undefined;
                            }
                        })();
                        if (typeof content === "string" && content)
                            fullContent += content;
                        res.write(`data: ${data}\n\n`);
                        if (typeof res.flush === "function") {
                            res.flush();
                        }
                    }
                }
            }
            if (buffer.trim() && buffer.startsWith("data: ")) {
                res.write(buffer + "\n\n");
            }
        }
        finally {
            reader.releaseLock();
        }
        await createMessage({
            conversation_id: conversationId,
            user_id: userId,
            role: "assistant",
            content: fullContent.trim() || "(无回复内容)",
            citations: citationsForPersist.length > 0 ? citationsForPersist : undefined,
        });
        await updateConversationUpdatedAt(conversationId);
        res.write("data: [DONE]\n\n");
        res.end();
    }
    catch (e) {
        console.error("Chat stream error:", e);
        if (!res.headersSent) {
            res.status(500).json({ error: e instanceof Error ? e.message : "服务器内部错误" });
        }
        else {
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
async function buildFileUrlMap(chunks) {
    const urlMap = new Map();
    if (!supabase)
        return urlMap;
    const uniqueDocIds = [...new Set(chunks.map((c) => c.document_id))];
    await Promise.allSettled(uniqueDocIds.map(async (docId) => {
        try {
            const doc = await getDocumentById(docId);
            if (!doc?.storage_path)
                return;
            const { data, error } = await supabase.storage
                .from("documents")
                .createSignedUrl(doc.storage_path, 3600);
            if (!error && data?.signedUrl) {
                urlMap.set(docId, data.signedUrl);
            }
        }
        catch {
            // 静默忽略，不阻断对话
        }
    }));
    return urlMap;
}
