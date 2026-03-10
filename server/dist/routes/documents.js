/**
 * 文档上传路由
 * 支持：秒传、小文件直传、大文件分片上传（并发 6、断点续传）
 */
import express, { Router } from "express";
import multer from "multer";
import fs from "fs";
import path from "path";
import { createDocument, deleteDocument, findByHash, getDocumentById, updateDocumentStatus } from "../services/documentService.js";
import { supabase } from "../lib/supabase.js";
import { CHUNK_SIZE, SMALL_FILE_THRESHOLD } from "../constants/upload.js";
const router = Router();
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
// 分片上传会话（内存存储，生产可换 Redis）
const uploadSessions = new Map();
const multerUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: SMALL_FILE_THRESHOLD } });
const tempDir = path.join(process.cwd(), "uploads", "temp");
const ensureTempDir = (dir) => {
    if (!fs.existsSync(dir))
        fs.mkdirSync(dir, { recursive: true });
};
// 秒传检查：POST /api/documents/check-upload
router.post("/check-upload", async (req, res) => {
    const { hash } = req.body;
    if (!hash || typeof hash !== "string")
        return res.status(400).json({ error: "hash 必填" });
    try {
        const doc = await findByHash(hash);
        if (doc)
            return res.json({ exists: true, id: doc.id, storage_path: doc.storage_path });
    }
    catch (e) {
        console.error("check-upload DB error:", e);
    }
    res.json({ exists: false });
});
// 小文件直传：POST /api/documents/upload (FormData, file < 5MB)
router.post("/upload", multerUpload.single("file"), async (req, res) => {
    if (!req.file)
        return res.status(400).json({ error: "缺少文件" });
    const { hash } = req.body || {};
    const name = req.file.originalname;
    const ext = (name.split(".").pop() || "").toLowerCase();
    const typeMap = { pdf: "pdf", txt: "txt", md: "md", docx: "docx", mp4: "video", mp3: "audio", wav: "audio" };
    const type = typeMap[ext] || "unknown";
    const storage_path = `documents/${crypto.randomUUID()}_${encodeURIComponent(name)}`;
    if (!supabase)
        return res.status(500).json({ error: "Supabase 未配置" });
    try {
        const docId = await createDocument({
            name,
            type,
            size: req.file.size,
            hash: hash || "",
            storage_path,
            status: "pending",
        });
        const { error } = await supabase.storage.from("documents").upload(storage_path, req.file.buffer, {
            contentType: req.file.mimetype || "application/octet-stream",
        });
        if (error) {
            await updateDocumentStatus(docId, "failed", { error_message: error.message });
            return res.status(500).json({ error: "Storage 上传失败: " + error.message });
        }
        res.json({ id: docId, status: "pending" });
    }
    catch (e) {
        console.error("Upload error:", e);
        res.status(500).json({ error: e instanceof Error ? e.message : "上传失败" });
    }
});
// 分片上传：初始化 POST /api/documents/upload/init
router.post("/upload/init", async (req, res) => {
    const { name, size, hash } = req.body;
    if (!name || typeof name !== "string")
        return res.status(400).json({ error: "name 必填且须为字符串" });
    if (typeof size !== "number" || size <= 0)
        return res.status(400).json({ error: "size 必填且须大于 0" });
    if (!hash || typeof hash !== "string")
        return res.status(400).json({ error: "hash 必填且须为字符串" });
    if (hash.length !== 32 || !/^[a-f0-9]+$/i.test(hash))
        return res.status(400).json({ error: "hash 须为 32 位 MD5 字符串" });
    const totalChunks = Math.ceil(size / CHUNK_SIZE);
    const upload_id = crypto.randomUUID();
    uploadSessions.set(upload_id, { name, size, hash, totalChunks, received: new Set() });
    ensureTempDir(tempDir);
    const sessionDir = path.join(tempDir, upload_id);
    fs.mkdirSync(sessionDir, { recursive: true });
    res.json({ upload_id, chunk_size: CHUNK_SIZE, total_chunks: totalChunks });
});
const validateUploadId = (upload_id) => UUID_REGEX.test(upload_id);
// 分片上传：查询已接收分片 GET /api/documents/upload/status/:upload_id
router.get("/upload/status/:upload_id", (req, res) => {
    const { upload_id } = req.params;
    if (!validateUploadId(upload_id))
        return res.status(400).json({ error: "upload_id 格式无效" });
    const session = uploadSessions.get(upload_id);
    if (!session)
        return res.status(404).json({ error: "upload_id 无效或已过期" });
    res.json({ received: Array.from(session.received).sort((a, b) => a - b), total: session.totalChunks });
});
// 分片上传：上传单个分片 PUT /api/documents/upload/chunk/:upload_id/:chunk_index
router.put("/upload/chunk/:upload_id/:chunk_index", express.raw({ type: "application/octet-stream", limit: CHUNK_SIZE + 1024 }), async (req, res) => {
    const { upload_id, chunk_index } = req.params;
    if (!validateUploadId(upload_id))
        return res.status(400).json({ error: "upload_id 格式无效" });
    const idx = parseInt(chunk_index, 10);
    if (isNaN(idx) || idx < 0)
        return res.status(400).json({ error: "chunk_index 无效" });
    const session = uploadSessions.get(upload_id);
    if (!session)
        return res.status(404).json({ error: "upload_id 无效或已过期" });
    if (idx >= session.totalChunks)
        return res.status(400).json({ error: "chunk_index 超出范围" });
    const body = req.body;
    if (!body || !(body instanceof Buffer))
        return res.status(400).json({ error: "缺少分片数据" });
    const chunkPath = path.join(tempDir, upload_id, `${idx}`);
    fs.writeFileSync(chunkPath, body);
    session.received.add(idx);
    res.json({ ok: true, received: session.received.size, total: session.totalChunks });
});
// 分片上传：完成 POST /api/documents/upload/complete/:upload_id
router.post("/upload/complete/:upload_id", async (req, res) => {
    const { upload_id } = req.params;
    if (!validateUploadId(upload_id))
        return res.status(400).json({ error: "upload_id 格式无效" });
    const { name: overrideName, type } = req.body || {};
    const session = uploadSessions.get(upload_id);
    if (!session)
        return res.status(404).json({ error: "upload_id 无效或已过期" });
    if (session.received.size !== session.totalChunks) {
        return res.status(400).json({ error: "分片未传完", received: session.received.size, total: session.totalChunks });
    }
    const sessionDir = path.join(tempDir, upload_id);
    const name = overrideName || session.name;
    const ext = (name.split(".").pop() || "").toLowerCase();
    const typeMap = { pdf: "pdf", txt: "txt", md: "md", docx: "docx", mp4: "video", mp3: "audio", wav: "audio" };
    const docType = type || typeMap[ext] || "unknown";
    const storage_path = `documents/${crypto.randomUUID()}_${encodeURIComponent(name)}`;
    if (!supabase)
        return res.status(500).json({ error: "Supabase 未配置" });
    const cleanup = () => {
        try {
            for (let i = 0; i < session.totalChunks; i++)
                fs.unlinkSync(path.join(sessionDir, `${i}`));
            fs.rmdirSync(sessionDir);
        }
        catch {
            /* ignore */
        }
        uploadSessions.delete(upload_id);
    };
    try {
        const chunks = [];
        for (let i = 0; i < session.totalChunks; i++) {
            const p = path.join(sessionDir, `${i}`);
            chunks.push(fs.readFileSync(p));
        }
        const fullBuffer = Buffer.concat(chunks);
        const docId = await createDocument({
            name,
            type: docType,
            size: session.size,
            hash: session.hash,
            storage_path,
            status: "pending",
        });
        const { error } = await supabase.storage.from("documents").upload(storage_path, fullBuffer, {
            contentType: "application/octet-stream",
        });
        cleanup();
        if (error) {
            await updateDocumentStatus(docId, "failed", { error_message: error.message });
            return res.status(500).json({ error: "Storage 上传失败: " + error.message });
        }
        res.json({ id: docId, status: "pending" });
    }
    catch (e) {
        console.error("Complete upload error:", e);
        cleanup();
        res.status(500).json({ error: e instanceof Error ? e.message : "合并失败" });
    }
});
// 列表：GET /api/documents
router.get("/", async (_req, res) => {
    if (!supabase)
        return res.status(500).json({ error: "Supabase 未配置" });
    const { data, error } = await supabase
        .from("documents")
        .select("id, name, type, size, status, hash, created_at")
        .order("created_at", { ascending: false });
    if (error)
        return res.status(500).json({ error: error.message });
    res.json(data ?? []);
});
// 预览 URL：GET /api/documents/:id/url
router.get("/:id/url", async (req, res) => {
    const { id } = req.params;
    const expiresIn = 3600; // 1 小时
    try {
        const doc = await getDocumentById(id);
        if (!doc?.storage_path || !supabase)
            return res.status(404).json({ error: "文档不存在" });
        const { data, error } = await supabase.storage.from("documents").createSignedUrl(doc.storage_path, expiresIn);
        if (error)
            return res.status(500).json({ error: error.message });
        res.json({ url: data?.signedUrl });
    }
    catch {
        res.status(404).json({ error: "文档不存在" });
    }
});
// 详情：GET /api/documents/:id
router.get("/:id", async (req, res) => {
    try {
        const doc = await getDocumentById(req.params.id);
        res.json(doc);
    }
    catch {
        res.status(404).json({ error: "文档不存在" });
    }
});
// 删除：DELETE /api/documents/:id
router.delete("/:id", async (req, res) => {
    try {
        await deleteDocument(req.params.id);
        res.json({ ok: true });
    }
    catch {
        res.status(404).json({ error: "文档不存在或删除失败" });
    }
});
export default router;
