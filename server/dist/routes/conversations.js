/**
 * 会话路由 - CRUD 会话与消息
 *
 * POST   /api/conversations          创建会话，返回 { id }
 * GET   /api/conversations          会话列表（按 updated_at 倒序）
 * GET   /api/conversations/:id       会话详情（可选，用于校验存在）
 * GET   /api/conversations/:id/messages  该会话的消息列表
 * PATCH /api/conversations/:id      更新会话标题
 * DELETE /api/conversations/:id     删除会话（级联删 messages）
 */
import { Router } from "express";
import { createConversation, getConversationById, getConversations, updateConversationTitle, deleteConversation, } from "../services/conversationService.js";
import { getMessagesByConversation } from "../services/messageService.js";
import { addConversationDocument, getConversationDocumentIds, removeConversationDocument, } from "../services/conversationDocumentsService.js";
import { getDocumentById } from "../services/documentService.js";
const router = Router();
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function isValidUuid(id) {
    return UUID_REGEX.test(id);
}
/** 校验 params.id 为合法 UUID，非法则 400 */
function validateId(req, res, next) {
    const id = req.params.id;
    if (!id || !isValidUuid(id)) {
        res.status(400).json({ error: "无效的会话 ID" });
        return;
    }
    next();
}
// ─── 创建会话 ─────────────────────────────────────────────────────────
router.post("/", async (_req, res) => {
    try {
        const userId = _req.user?.id;
        if (!userId)
            return res.status(401).json({ error: "未登录" });
        const id = await createConversation(userId);
        res.status(201).json({ id });
    }
    catch (e) {
        console.error("[conversations] create error:", e);
        res.status(500).json({ error: e instanceof Error ? e.message : "创建失败" });
    }
});
// ─── 会话列表 ─────────────────────────────────────────────────────────
router.get("/", async (_req, res) => {
    try {
        const userId = _req.user?.id;
        if (!userId)
            return res.status(401).json({ error: "未登录" });
        const list = await getConversations(userId, 50);
        res.json(list);
    }
    catch (e) {
        console.error("[conversations] list error:", e);
        res.status(500).json({ error: e instanceof Error ? e.message : "获取列表失败" });
    }
});
// ─── 会话详情（可选，用于前端校验或展示）─────────────────────────────
router.get("/:id", validateId, async (req, res) => {
    try {
        const conv = await getConversationById(req.params.id);
        const userId = req.user?.id;
        if (!userId || !conv || conv.user_id !== userId) {
            res.status(404).json({ error: "会话不存在" });
            return;
        }
        res.json(conv);
    }
    catch (e) {
        console.error("[conversations] get error:", e);
        res.status(500).json({ error: e instanceof Error ? e.message : "获取失败" });
    }
});
// ─── 会话消息列表 ─────────────────────────────────────────────────────
router.get("/:id/messages", validateId, async (req, res) => {
    try {
        const id = req.params.id;
        const exists = await getConversationById(id);
        const userId = req.user?.id;
        if (!userId || !exists || exists.user_id !== userId) {
            res.status(404).json({ error: "会话不存在" });
            return;
        }
        const msgs = await getMessagesByConversation(id);
        res.json(msgs);
    }
    catch (e) {
        console.error("[conversations] getMessages error:", e);
        res.status(500).json({ error: e instanceof Error ? e.message : "获取消息失败" });
    }
});
// ─── 会话关联文档（conversation_documents）──────────────────────────────
// GET /api/conversations/:id/documents
router.get("/:id/documents", validateId, async (req, res) => {
    try {
        const id = req.params.id;
        const exists = await getConversationById(id);
        const userId = req.user?.id;
        if (!userId || !exists || exists.user_id !== userId) {
            res.status(404).json({ error: "会话不存在" });
            return;
        }
        const document_ids = await getConversationDocumentIds(id, userId);
        res.json({ document_ids });
    }
    catch (e) {
        console.error("[conversations] getDocuments error:", e);
        res.status(500).json({ error: e instanceof Error ? e.message : "获取关联文档失败" });
    }
});
// POST /api/conversations/:id/documents  body: { document_id: string }
router.post("/:id/documents", validateId, async (req, res) => {
    const { document_id } = req.body;
    if (typeof document_id !== "string" || !document_id.trim()) {
        res.status(400).json({ error: "document_id 必填且为字符串" });
        return;
    }
    try {
        const id = req.params.id;
        const exists = await getConversationById(id);
        const userId = req.user?.id;
        if (!userId || !exists || exists.user_id !== userId) {
            res.status(404).json({ error: "会话不存在" });
            return;
        }
        // 校验文档归属当前用户，避免跨租户关联
        const doc = await getDocumentById(document_id.trim());
        if (!doc || doc.user_id !== userId) {
            res.status(404).json({ error: "文档不存在" });
            return;
        }
        await addConversationDocument(id, document_id.trim(), userId);
        const document_ids = await getConversationDocumentIds(id, userId);
        res.json({ ok: true, document_ids });
    }
    catch (e) {
        console.error("[conversations] addDocument error:", e);
        res.status(500).json({ error: e instanceof Error ? e.message : "关联失败" });
    }
});
// DELETE /api/conversations/:id/documents/:docId
router.delete("/:id/documents/:docId", validateId, async (req, res) => {
    const { docId } = req.params;
    if (!docId || !UUID_REGEX.test(docId)) {
        res.status(400).json({ error: "无效的文档 ID" });
        return;
    }
    try {
        const id = req.params.id;
        const exists = await getConversationById(id);
        const userId = req.user?.id;
        if (!userId || !exists || exists.user_id !== userId) {
            res.status(404).json({ error: "会话不存在" });
            return;
        }
        await removeConversationDocument(id, docId, userId);
        const document_ids = await getConversationDocumentIds(id, userId);
        res.json({ ok: true, document_ids });
    }
    catch (e) {
        console.error("[conversations] removeDocument error:", e);
        res.status(500).json({ error: e instanceof Error ? e.message : "取消关联失败" });
    }
});
// ─── 更新会话标题 ─────────────────────────────────────────────────────
router.patch("/:id", validateId, async (req, res) => {
    const { title } = req.body;
    if (typeof title !== "string" || !title.trim()) {
        res.status(400).json({ error: "title 必填且为非空字符串" });
        return;
    }
    try {
        const exists = await getConversationById(req.params.id);
        const userId = req.user?.id;
        if (!userId || !exists || exists.user_id !== userId) {
            res.status(404).json({ error: "会话不存在" });
            return;
        }
        await updateConversationTitle(req.params.id, title.trim().slice(0, 200));
        res.json({ ok: true });
    }
    catch (e) {
        console.error("[conversations] patch error:", e);
        res.status(500).json({ error: e instanceof Error ? e.message : "更新失败" });
    }
});
// ─── 删除会话 ─────────────────────────────────────────────────────────
router.delete("/:id", validateId, async (req, res) => {
    try {
        const exists = await getConversationById(req.params.id);
        const userId = req.user?.id;
        if (!userId || !exists || exists.user_id !== userId) {
            res.status(404).json({ error: "会话不存在" });
            return;
        }
        await deleteConversation(req.params.id);
        res.json({ ok: true });
    }
    catch (e) {
        console.error("[conversations] delete error:", e);
        res.status(500).json({ error: e instanceof Error ? e.message : "删除失败" });
    }
});
export default router;
