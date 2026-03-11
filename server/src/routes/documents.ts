/**
 * 文档上传路由
 * 支持：秒传、小文件直传、大文件分片上传（并发 6、断点续传）
 */

import express, { Router, Request, Response } from "express";
import multer from "multer";
import fs from "fs";
import path from "path";
import { createDocument, deleteDocument, findByHash, getDocumentById, updateDocumentStatus } from "../services/documentService.js";
import { insertMultiVectorChunks, deleteChunksByDocumentId } from "../services/chunkService.js";
import { parseDocument } from "../services/parseService.js";
import { supabase } from "../lib/supabase.js";
import { CHUNK_SIZE, SMALL_FILE_THRESHOLD } from "../constants/upload.js";

const router = Router();
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// 分片上传会话（内存存储，生产可换 Redis）
const uploadSessions = new Map<
  string,
  { name: string; size: number; hash: string; totalChunks: number; received: Set<number> }
>();

const multerUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: SMALL_FILE_THRESHOLD },
  defParamCharset: "utf8", // 正确解析中文等 UTF-8 文件名，避免 å½é³ 乱码
});

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
  } catch (e) {
    console.error("check-upload DB error:", e);
  }
  res.json({ exists: false });
});

/** 生成仅含 UUID+扩展名的 storage key，避免中文/Unicode 导致 Supabase Invalid key */
const safeStoragePath = (originalName: string) => {
  const raw = (originalName.split(".").pop() || "bin").toLowerCase();
  const safeExt = raw.replace(/[^a-z0-9]/g, "") || "bin";
  return `documents/${crypto.randomUUID()}.${safeExt}`;
};

// 小文件直传：POST /api/documents/upload (FormData, file < 5MB)
router.post("/upload", multerUpload.single("file"), async (req: Request, res: Response) => {
  if (!req.file) return res.status(400).json({ error: "缺少文件" });
  const { hash } = (req.body as Record<string, string>) || {};
  const name = req.file.originalname;
  const ext = (name.split(".").pop() || "").toLowerCase();
  const typeMap: Record<string, string> = {
    pdf: "pdf", txt: "txt", md: "md",
    docx: "docx", xlsx: "xlsx", xls: "xls", pptx: "pptx",
    csv: "csv", json: "json", html: "html", xml: "xml",
    jpg: "jpg", jpeg: "jpeg", png: "png",
    mp4: "video", mp3: "audio", wav: "audio", m4a: "audio",
  };
  const type = typeMap[ext] || ext || "unknown";
  const storage_path = safeStoragePath(name);

  if (!supabase) return res.status(500).json({ error: "Supabase 未配置" });

  try {
    if (hash) {
      const existing = await findByHash(hash);
      if (existing) return res.json({ id: existing.id, status: "pending" });
    }
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
  if (!name || typeof name !== "string") return res.status(400).json({ error: "name 必填且须为字符串" });
  if (typeof size !== "number" || size <= 0) return res.status(400).json({ error: "size 必填且须大于 0" });
  if (!hash || typeof hash !== "string") return res.status(400).json({ error: "hash 必填且须为字符串" });
  if (hash.length !== 32 || !/^[a-f0-9]+$/i.test(hash)) return res.status(400).json({ error: "hash 须为 32 位 MD5 字符串" });

  const totalChunks = Math.ceil(size / CHUNK_SIZE);
  const upload_id = crypto.randomUUID();

  uploadSessions.set(upload_id, { name, size, hash, totalChunks, received: new Set() });
  ensureTempDir(tempDir);
  const sessionDir = path.join(tempDir, upload_id);
  fs.mkdirSync(sessionDir, { recursive: true });

  res.json({ upload_id, chunk_size: CHUNK_SIZE, total_chunks: totalChunks });
});

const validateUploadId = (upload_id: string): boolean => UUID_REGEX.test(upload_id);

// 分片上传：查询已接收分片 GET /api/documents/upload/status/:upload_id
router.get("/upload/status/:upload_id", (req: Request, res: Response) => {
  const { upload_id } = req.params;
  if (!validateUploadId(upload_id)) return res.status(400).json({ error: "upload_id 格式无效" });
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
    if (!validateUploadId(upload_id)) return res.status(400).json({ error: "upload_id 格式无效" });
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
  if (!validateUploadId(upload_id)) return res.status(400).json({ error: "upload_id 格式无效" });
  const { name: overrideName, type } = (req.body as { name?: string; type?: string }) || {};
  const session = uploadSessions.get(upload_id);
  if (!session) return res.status(404).json({ error: "upload_id 无效或已过期" });

  if (session.received.size !== session.totalChunks) {
    return res.status(400).json({ error: "分片未传完", received: session.received.size, total: session.totalChunks });
  }

  const sessionDir = path.join(tempDir, upload_id);
  const name = overrideName || session.name;
  const ext = (name.split(".").pop() || "").toLowerCase();
  const typeMap: Record<string, string> = {
    pdf: "pdf", txt: "txt", md: "md",
    docx: "docx", xlsx: "xlsx", xls: "xls", pptx: "pptx",
    csv: "csv", json: "json", html: "html", xml: "xml",
    jpg: "jpg", jpeg: "jpeg", png: "png",
    mp4: "video", mp3: "audio", wav: "audio", m4a: "audio",
  };
  const docType = type || typeMap[ext] || ext || "unknown";
  const storage_path = safeStoragePath(name);

  if (!supabase) return res.status(500).json({ error: "Supabase 未配置" });

  const cleanup = () => {
    try {
      for (let i = 0; i < session.totalChunks; i++) fs.unlinkSync(path.join(sessionDir, `${i}`));
      fs.rmdirSync(sessionDir);
    } catch {
      /* ignore */
    }
    uploadSessions.delete(upload_id);
  };

  try {
    const existing = await findByHash(session.hash);
    if (existing) {
      cleanup();
      return res.json({ id: existing.id, status: "pending" });
    }
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

    cleanup();

    if (error) {
      await updateDocumentStatus(docId, "failed", { error_message: error.message });
      return res.status(500).json({ error: "Storage 上传失败: " + error.message });
    }

    res.json({ id: docId, status: "pending" });
  } catch (e) {
    console.error("Complete upload error:", e);
    cleanup();
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

// 预览 URL：GET /api/documents/:id/url
router.get("/:id/url", async (req: Request, res: Response) => {
  const { id } = req.params;
  const expiresIn = 3600; // 1 小时
  try {
    const doc = await getDocumentById(id);
    if (!doc?.storage_path || !supabase) return res.status(404).json({ error: "文档不存在" });
    const { data, error } = await supabase.storage.from("documents").createSignedUrl(doc.storage_path, expiresIn);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ url: data?.signedUrl });
  } catch {
    res.status(404).json({ error: "文档不存在" });
  }
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

// 删除：DELETE /api/documents/:id
router.delete("/:id", async (req: Request, res: Response) => {
  try {
    await deleteDocument(req.params.id);
    res.json({ ok: true });
  } catch {
    res.status(404).json({ error: "文档不存在或删除失败" });
  }
});

// 解析文档，返回待向量化的切片（供前端 embed 后提交）
// GET /api/documents/:id/parse
router.get("/:id/parse", async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    const doc = await getDocumentById(id);
    if (!doc) return res.status(404).json({ error: "文档不存在" });

    await updateDocumentStatus(id, "processing");
    const { chunks } = await parseDocument(id, doc.storage_path, doc.type);
    res.json({ chunks, document_id: id, document_type: doc.type, document_name: doc.name });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "解析失败";
    try {
      await updateDocumentStatus(req.params.id, "failed", { error_message: msg });
    } catch {
      /* ignore */
    }
    res.status(500).json({ error: msg });
  }
});

// 提交向量化后的 chunks（支持单 ID 多向量：enriched_main + qa_hypothetical x2）
// POST /api/documents/:id/chunks
router.post("/:id/chunks", async (req: Request, res: Response) => {
  const { id } = req.params;
  const { chunks } = req.body as {
    chunks?: Array<{
      chunk_index: number;
      content: string;
      metadata?: Record<string, unknown>;
      chunk_group_id: string;
      embeddings: Array<{ type: "enriched_main" | "qa_hypothetical"; embedding: number[] }>;
    }>;
  };
  if (!Array.isArray(chunks) || chunks.length === 0)
    return res.status(400).json({ error: "chunks 必填且须为非空数组" });

  const EMBEDDING_DIM = 384;
  for (const c of chunks) {
    if (!c.chunk_group_id || typeof c.chunk_group_id !== "string")
      return res.status(400).json({ error: "chunk_group_id 必填" });
    if (!Array.isArray(c.embeddings) || c.embeddings.length < 3)
      return res.status(400).json({ error: "每逻辑切片需 3 个向量：enriched_main + 2 qa_hypothetical" });
    const hasEnriched = c.embeddings.some((e) => e.type === "enriched_main");
    const hydeCount = c.embeddings.filter((e) => e.type === "qa_hypothetical").length;
    if (!hasEnriched || hydeCount < 2)
      return res.status(400).json({ error: "embeddings 须含 1 个 enriched_main 和 2 个 qa_hypothetical" });
    for (const e of c.embeddings) {
      if (!Array.isArray(e.embedding) || e.embedding.length !== EMBEDDING_DIM)
        return res.status(400).json({ error: `embedding 须为 ${EMBEDDING_DIM} 维向量` });
    }
  }

  try {
    const doc = await getDocumentById(id);
    if (!doc) return res.status(404).json({ error: "文档不存在" });

    await deleteChunksByDocumentId(id);
    await insertMultiVectorChunks(
      chunks.map((c) => ({
        document_id: id,
        chunk_group_id: c.chunk_group_id,
        content: String(c.content),
        metadata: { ...(c.metadata ?? {}), document_type: doc.type },
        chunk_index: Number(c.chunk_index),
        embeddings: c.embeddings.map((e) => ({ type: e.type, embedding: e.embedding })),
      }))
    );
    const totalRows = chunks.length * 3;
    await updateDocumentStatus(id, "completed");
    res.json({ ok: true, count: chunks.length, total_vectors: totalRows });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "写入失败";
    try {
      await updateDocumentStatus(id, "failed", { error_message: msg });
    } catch {
      /* ignore */
    }
    res.status(500).json({ error: msg });
  }
});

export default router;
