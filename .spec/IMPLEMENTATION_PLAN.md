# Supabase 表使用完整实施方案

> **目标**：将已创建的 5 张 Supabase 表接入前后端，实现文档上传、会话持久化、RAG 检索对话的完整链路。

**当前状态**：
- ✅ 表已创建（documents / chunks / conversations / messages / conversation_documents）
- ✅ Supabase 客户端 + 4 个 Service 已就绪
- ⬜ 路由未挂载，Chat 未接数据库
- ⬜ 文档解析 + embedding 流程未实现
- ⬜ RAG 未接入

---

## 前置检查

1. **确认 `match_chunks` 函数已创建**  
   Supabase SQL Editor 执行 `SUPABASE_SETUP.md` 第十节的一键 SQL，或单独执行第六节中的 `match_chunks` 函数。

2. **后端 .env**  
   ```
   SUPABASE_URL=https://xxxx.supabase.co
   SUPABASE_SERVICE_KEY=eyJ...
   ```

---

## 阶段一：文档上传与 Storage（约 1–2 天）

### 1.1 创建 Storage Bucket

Supabase 控制台 → **Storage** → **New Bucket**：
- 名称：`documents`
- Public：可关（用 signed URL 访问）
- File size limit：按需（如 50MB）

### 1.2 新增文档路由

**新建**：`server/src/routes/documents.ts`

```ts
import { Router, Request, Response } from "express";
import multer from "multer";
import { createDocument, findByHash, getDocumentById, updateDocumentStatus } from "../services/documentService.js";
import { supabase } from "../lib/supabase.js";

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

// 秒传检查：POST /api/documents/check-upload
router.post("/check-upload", async (req: Request, res: Response) => {
  const { hash } = req.body;
  if (!hash) return res.status(400).json({ error: "hash 必填" });
  const doc = await findByHash(hash);
  if (doc) return res.json({ exists: true, id: doc.id, storage_path: doc.storage_path });
  res.json({ exists: false });
});

// 上传：POST /api/documents/upload
router.post("/upload", upload.single("file"), async (req: Request, res: Response) => {
  if (!req.file) return res.status(400).json({ error: "缺少文件" });
  const { hash } = req.body as { hash?: string };
  const name = req.file.originalname;
  const ext = (name.split(".").pop() || "").toLowerCase();
  const type = ["pdf", "txt", "md", "docx"].includes(ext) ? ext : "unknown";
  const storage_path = `documents/${crypto.randomUUID()}_${name}`;

  if (!supabase) return res.status(500).json({ error: "Supabase 未配置" });

  const docId = await createDocument({
    name,
    type,
    size: req.file.size,
    hash: hash || "", // 前端传入 MD5
    storage_path,
    status: "pending",
  });

  const { error } = await supabase.storage.from("documents").upload(storage_path, req.file.buffer, {
    contentType: req.file.mimetype,
  });
  if (error) {
    await updateDocumentStatus(docId, "failed", { error_message: error.message });
    return res.status(500).json({ error: "Storage 上传失败" });
  }

  res.json({ id: docId, status: "pending" });
});

// 列表：GET /api/documents
router.get("/", async (_req: Request, res: Response) => {
  const { data, error } = await supabase!.from("documents").select("id, name, type, status, created_at").order("created_at", { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data ?? []);
});

// 详情：GET /api/documents/:id
router.get("/:id", async (req: Request, res: Response) => {
  const doc = await getDocumentById(req.params.id);
  res.json(doc);
});

export default router;
```

**修改**：`server/src/index.ts`  
- 增加 `import documentsRouter from "./routes/documents.js";`
- 增加 `app.use("/api/documents", documentsRouter);`

**依赖**：`npm install multer @types/multer`

---

## 阶段二：会话与消息持久化（约 0.5–1 天）

### 2.1 新增会话路由

**新建**：`server/src/routes/conversations.ts`

```ts
import { Router, Request, Response } from "express";
import {
  createConversation,
  getConversations,
  updateConversationTitle,
  deleteConversation,
} from "../services/conversationService.js";
import { getMessagesByConversation } from "../services/messageService.js";

const router = Router();

router.post("/", async (_req: Request, res: Response) => {
  const id = await createConversation();
  res.json({ id });
});

router.get("/", async (_req: Request, res: Response) => {
  const list = await getConversations();
  res.json(list);
});

router.get("/:id/messages", async (req: Request, res: Response) => {
  const msgs = await getMessagesByConversation(req.params.id);
  res.json(msgs);
});

router.patch("/:id", async (req: Request, res: Response) => {
  const { title } = req.body;
  if (!title) return res.status(400).json({ error: "title 必填" });
  await updateConversationTitle(req.params.id, title);
  res.json({ ok: true });
});

router.delete("/:id", async (req: Request, res: Response) => {
  await deleteConversation(req.params.id);
  res.json({ ok: true });
});

export default router;
```

**修改**：`server/src/index.ts`  
- `import conversationsRouter from "./routes/conversations.js";`
- `app.use("/api/conversations", conversationsRouter);`

### 2.2 改造 Chat 路由，接入 conversations + messages

**修改**：`server/src/routes/chat.ts`

- 请求体增加：`conversation_id?: string`
- 若有 `conversation_id`：  
  1. 调用 `createMessage({ conversation_id, role: "user", content })` 写入 user 消息  
  2. 流式结束后：`createMessage({ conversation_id, role: "assistant", content })`  
  3. 首条 assistant 消息时：`updateConversationTitle(conversation_id, content.slice(0, 50))`
- 若无 `conversation_id`：保持当前逻辑，不写库

**参考实现**：

```ts
// 在 router.post("/chat"...) 内部
const { messages, conversation_id } = req.body;

// ... 流式处理循环中累积 fullContent ...

// 流结束后（res.write("data: [DONE]\n\n") 之前）
if (conversation_id && fullContent) {
  await createMessage({ conversation_id, role: "assistant", content: fullContent });
  const msgs = [...messages, { role: "user", content: lastUserMessage }];
  if (msgs.length === 1) {
    await updateConversationTitle(conversation_id, fullContent.slice(0, 50));
  }
}
```

---

## 阶段三：文档解析与 embedding（约 2–3 天）

### 3.1 解析任务队列（或轮询）

- 上传完成后，启动后台任务：根据 `type` 调用对应解析（MinerU PDF、WhisperX 音频等）
- 解析前：`updateDocumentStatus(id, "processing")`
- 解析后：切分 text → 调用 302.ai Embedding API → `insertChunks`

### 3.2 Embedding 调用

302.ai 若提供 embedding 接口，新增 `server/src/services/embeddingService.ts`：

```ts
export async function getEmbedding(text: string): Promise<number[]> {
  const res = await fetch(`${process.env.AI_BASE_URL}/embedding`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.AI_API_KEY}` },
    body: JSON.stringify({ input: text }),
  });
  const json = await res.json();
  return json.data?.[0]?.embedding ?? [];
}
```

（具体路径需对照 302.ai 文档）

### 3.3 分块策略

- 文本：按段落或固定长度（如 512 token）切分
- PDF：MinerU 返回的 blocks → 合并为 chunk
- 音频/视频：按时间戳分句，每句一个 chunk，metadata 存 `{ timestamp: "00:01:30" }`

### 3.4 流程串联

```
createDocument → Storage.upload → 入队/触发任务
  → MinerU/WhisperX 解析 → 切分 → getEmbedding(每块)
  → insertChunks → updateDocumentStatus(id, "completed", { summary })
```

---

## 阶段四：RAG 对话（约 1–2 天）

### 4.1 Chat 路由接入 RAG

1. 请求体增加：`document_ids?: string[]`（或从 conversation_documents 查）
2. 对用户问题做 `getEmbedding(question)` → `searchChunks(embedding, { limit: 5 })`
3. 若有 document_ids：修改 `match_chunks` 或 `chunkService.searchChunks`，限定 `document_id IN (document_ids)`
4. 将 top K chunks 的 content 拼进 system prompt：

```ts
const context = chunks.map((c) => c.content).join("\n\n---\n\n");
const systemPrompt = `根据以下参考资料回答问题。若参考中无相关内容，请说明。\n\n参考资料：\n${context}`;
```

5. 调用 `createChatStream([system, ...messages])`，流式返回

### 4.2 扩展 match_chunks（可选）

若需限定文档范围，在 Supabase 中新增函数：

```sql
CREATE OR REPLACE FUNCTION match_chunks_filtered(
  query_embedding vector(1536),
  doc_ids uuid[],
  match_count int DEFAULT 5
)
RETURNS TABLE (id uuid, document_id uuid, content text, metadata jsonb)
LANGUAGE plpgsql AS $$
BEGIN
  RETURN QUERY
  SELECT c.id, c.document_id, c.content, c.metadata
  FROM chunks c
  WHERE c.document_id = ANY(doc_ids)
  ORDER BY c.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;
```

---

## 阶段五：conversation_documents（可选）

- 前端：会话内可「选择关联文档」
- 接口：`POST /api/conversations/:id/documents`，`DELETE /api/conversations/:id/documents/:docId`
- RAG 时：从 conversation_documents 取 document_ids，传给 `match_chunks_filtered`

---

## 实施顺序总览

| 顺序 | 内容 | 依赖 |
|------|------|------|
| 1 | Storage Bucket + documents 路由 | 无 |
| 2 | conversations 路由 | 无 |
| 3 | Chat 接入 conversation_id + messages | 2 |
| 4 | 解析 + embedding + chunks | 1 |
| 5 | RAG 接入 Chat | 3、4 |
| 6 | conversation_documents（可选） | 5 |

---

## 验证清单

- [ ] `POST /api/documents/upload` 能上传并写入 documents
- [ ] `GET /api/documents` 能列出文档
- [ ] `POST /api/conversations` 创建会话，`GET /api/conversations/:id/messages` 能拉消息
- [ ] Chat 带 `conversation_id` 时，messages 表有 user/assistant 记录
- [ ] 有 chunks 后，带问题的 Chat 能返回基于检索的回复
