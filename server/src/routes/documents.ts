/**
 * 文档上传路由
 * 支持：秒传、小文件直传、大文件分片上传（并发 6、断点续传）
 */

import express, { Router, Request, Response } from "express";
import multer from "multer";
import fs from "fs";
import path from "path";
import { createDocument, findByHash, getDocumentById, updateDocumentStatus } from "../services/documentService.js";
import { supabase } from "../lib/supabase.js";

const router = Router();
const CHUNK_SIZE = 2 * 1024 * 1024; // 2MB
const SMALL_FILE_THRESHOLD = 5 * 1024 * 1024; // 5MB 以下直传
const MAX_CONCURRENT = 6;

// 分片上传会话（内存存储，生产可换 Redis）
const uploadSessions = new Map<
  string,
  { name: string; size: number; hash: string; totalChunks: number; received: Set<number> }
>();

const multerUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: SMALL_FILE_THRESHOLD } });

const tempDir = path.join(process.cwd(), "uploads", "temp");
const ensureTempDir = (dir: string) => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
};

// 秒传检查：POST /api/documents/check-upload
router.post("/check-upload", async (req: Request, res: Response) => {
  const { hash } = req.body as { hash?: string };
  if (!hash || typeof hash !== "string") return res.status(400).json({ error: "hash 必填" });
  try {
    const doc = await findByHash(hash);
    if (doc) return res.json({ exists: true, id: doc.id, storage_path: doc.storage_path });
  } catch {
    /* DB error */
  }
  res.json({ exists: false });
});

// 小文件直传：POST /api/documents/upload (FormData, file < 5MB)
router.post("/upload", multerUpload.single("file"), async (req: Request, res: Response) => {
  if (!req.file) return res.status(400).json({ error: "缺少文件" });
  const { hash } = (req.body as Record<string, string>) || {};
  const name = req.file.originalname;
  const ext = (name.split(".").pop() || "").toLowerCase();
  const typeMap: Record<string, string> = { pdf: "pdf", txt: "txt", md: "md", docx: "docx", mp4: "video", mp3: "audio", wav: "audio" };
  const type = typeMap[ext] || "unknown";
  const storage_path = `documents/${crypto.randomUUID()}_${encodeURIComponent(name)}`;

  if (!supabase) return res.status(500).json({ error: "Supabase 未配置" });

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
  } catch (e) {
    console.error("Upload error:", e);
    res.status(500).json({ error: e instanceof Error ? e.message : "上传失败" });
  }
});

// 分片上传：初始化 POST /api/documents/upload/init
router.post("/upload/init", async (req: Request, res: Response) => {
  const { name, size, hash } = req.body as { name?: string; size?: number; hash?: string };
  if (!name || !size || !hash) return res.status(400).json({ error: "name, size, hash 必填" });
  const totalChunks = Math.ceil(size / CHUNK_SIZE);
  const upload_id = crypto.randomUUID();

  uploadSessions.set(upload_id, { name, size, hash, totalChunks, received: new Set() });
  ensureTempDir(tempDir);
  const sessionDir = path.join(tempDir, upload_id);
  fs.mkdirSync(sessionDir, { recursive: true });

  res.json({ upload_id, chunk_size: CHUNK_SIZE, total_chunks: totalChunks });
});

// 分片上传：查询已接收分片 GET /api/documents/upload/status/:upload_id
router.get("/upload/status/:upload_id", (req: Request, res: Response) => {
  const { upload_id } = req.params;
  const session = uploadSessions.get(upload_id);
  if (!session) return res.status(404).json({ error: "upload_id 无效或已过期" });
  res.json({ received: Array.from(session.received).sort((a, b) => a - b), total: session.totalChunks });
});

// 分片上传：上传单个分片 PUT /api/documents/upload/chunk/:upload_id/:chunk_index
router.put(
  "/upload/chunk/:upload_id/:chunk_index",
  express.raw({ type: "application/octet-stream", limit: CHUNK_SIZE + 1024 }),
  async (req: Request, res: Response) => {
  const { upload_id, chunk_index } = req.params;
  const idx = parseInt(chunk_index, 10);
  if (isNaN(idx) || idx < 0) return res.status(400).json({ error: "chunk_index 无效" });

  const session = uploadSessions.get(upload_id);
  if (!session) return res.status(404).json({ error: "upload_id 无效或已过期" });
  if (idx >= session.totalChunks) return res.status(400).json({ error: "chunk_index 超出范围" });

  const body = req.body;
  if (!body || !(body instanceof Buffer)) return res.status(400).json({ error: "缺少分片数据" });

  const chunkPath = path.join(tempDir, upload_id, `${idx}`);
  fs.writeFileSync(chunkPath, body);
  session.received.add(idx);

  res.json({ ok: true, received: session.received.size, total: session.totalChunks });
  }
);

// 分片上传：完成 POST /api/documents/upload/complete/:upload_id
router.post("/upload/complete/:upload_id", async (req: Request, res: Response) => {
  const { upload_id } = req.params;
  const { name: overrideName, type } = (req.body as { name?: string; type?: string }) || {};
  const session = uploadSessions.get(upload_id);
  if (!session) return res.status(404).json({ error: "upload_id 无效或已过期" });

  if (session.received.size !== session.totalChunks) {
    return res.status(400).json({ error: "分片未传完", received: session.received.size, total: session.totalChunks });
  }

  const sessionDir = path.join(tempDir, upload_id);
  const name = overrideName || session.name;
  const ext = (name.split(".").pop() || "").toLowerCase();
  const typeMap: Record<string, string> = { pdf: "pdf", txt: "txt", md: "md", docx: "docx", mp4: "video", mp3: "audio", wav: "audio" };
  const docType = type || typeMap[ext] || "unknown";
  const storage_path = `documents/${crypto.randomUUID()}_${encodeURIComponent(name)}`;

  if (!supabase) return res.status(500).json({ error: "Supabase 未配置" });

  try {
    const chunks: Buffer[] = [];
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

    // 清理临时分片
    try {
      for (let i = 0; i < session.totalChunks; i++) fs.unlinkSync(path.join(sessionDir, `${i}`));
      fs.rmdirSync(sessionDir);
    } catch {
      /* ignore */
    }
    uploadSessions.delete(upload_id);

    if (error) {
      await updateDocumentStatus(docId, "failed", { error_message: error.message });
      return res.status(500).json({ error: "Storage 上传失败: " + error.message });
    }

    res.json({ id: docId, status: "pending" });
  } catch (e) {
    console.error("Complete upload error:", e);
    res.status(500).json({ error: e instanceof Error ? e.message : "合并失败" });
  }
});

// 列表：GET /api/documents
router.get("/", async (_req: Request, res: Response) => {
  if (!supabase) return res.status(500).json({ error: "Supabase 未配置" });
  const { data, error } = await supabase
    .from("documents")
    .select("id, name, type, size, status, hash, created_at")
    .order("created_at", { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data ?? []);
});

// 详情：GET /api/documents/:id
router.get("/:id", async (req: Request, res: Response) => {
  try {
    const doc = await getDocumentById(req.params.id);
    res.json(doc);
  } catch {
    res.status(404).json({ error: "文档不存在" });
  }
});

export default router;
