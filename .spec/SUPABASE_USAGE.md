# Supabase 使用方案

> 如何在项目中连接并使用 Supabase 表

**完整实施步骤**：见 [IMPLEMENTATION_PLAN.md](./IMPLEMENTATION_PLAN.md)，含路由代码、数据流、验证清单。

---

## 一、整体架构

```
前端 ──HTTP──► Express 后端 ──@supabase/supabase-js──► Supabase
                    │
                    ├── documents  (上传元数据、状态)
                    ├── chunks     (向量检索)
                    ├── conversations / messages (对话)
                    └── Storage    (文件存储)
```

---

## 二、环境配置

### 1. 获取 Supabase 凭证

Supabase 控制台 → **Project Settings** → **API**：

- **Project URL**：`https://xxxx.supabase.co`
- **anon public**：公开 key（前端用，受 RLS 限制）
- **service_role**：服务端 key（ bypass RLS，后端用）

### 2. 后端 .env 增加

```
SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_SERVICE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

---

## 三、各表使用场景与 API

### 1. documents

| 操作 | 时机 | 说明 |
|------|------|------|
| INSERT | 用户上传文件 | 先插 pending，拿到 id 后再上传 Storage |
| 秒传校验 | 上传前 | `SELECT id, storage_path FROM documents WHERE hash = ? AND status = 'completed' LIMIT 1` |
| UPDATE status | 解析中/完成/失败 | 更新 status、error_message、summary |
| SELECT | 列表、详情 | 按 user_id 查，支持分页 |

**推荐接口**：`POST /api/documents/upload`，`GET /api/documents`，`GET /api/documents/:id`

---

### 2. chunks

| 操作 | 时机 | 说明 |
|------|------|------|
| INSERT 批量 | 文档解析+embedding 完成后 | 每个 chunk 一条，含 embedding |
| 向量检索 | 用户提问（RAG） | `ORDER BY embedding <=> query_vector LIMIT 5` |
| DELETE | 文档删除时 | 外键 CASCADE 会自动删，或手动按 document_id 删 |

**推荐接口**：RAG 时在内部调用，不单独对外；必要时可加 `GET /api/documents/:id/chunks` 调试。

---

### 3. conversations

| 操作 | 时机 | 说明 |
|------|------|------|
| INSERT | 用户新建对话 | 返回 id 供前端存 |
| SELECT | 侧边栏会话列表 | 按 user_id，按 updated_at 排序 |
| UPDATE title | 首条消息后 | 用首条消息摘要或前 20 字 |
| DELETE | 用户删除会话 | 会级联删 messages |

**推荐接口**：`POST /api/conversations`，`GET /api/conversations`，`PATCH /api/conversations/:id`，`DELETE /api/conversations/:id`

---

### 4. messages

| 操作 | 时机 | 说明 |
|------|------|------|
| INSERT user | 用户发送消息 | role=user，content=用户输入 |
| INSERT assistant | AI 回复结束时 | role=assistant，content=完整回复，citations 可选 |
| SELECT | 进入某会话 | 按 conversation_id，按 created_at 排序 |

**推荐接口**：`POST /api/chat` 改为「可选 conversation_id，发送后写 messages」；`GET /api/conversations/:id/messages`

---

### 5. conversation_documents

| 操作 | 时机 | 说明 |
|------|------|------|
| INSERT | 用户为会话选择文档 | 建立会话↔文档关联 |
| SELECT | RAG 检索时 | 若有此表，只在该会话关联的文档的 chunks 中检索 |
| DELETE | 用户取消关联 | 按 conversation_id + document_id 删 |

**推荐接口**：`POST /api/conversations/:id/documents`，`DELETE /api/conversations/:id/documents/:docId`

---

## 四、数据流串联

### 文档上传 → 解析 → chunks

```
1. 前端算 MD5 → 调 POST /api/documents/check-upload 秒传
2. 若无秒传：上传文件 → POST /api/documents/upload
   - 写入 Storage，插入 documents（status=pending）
3. 后台任务：解析（MinerU/WhisperX/视频理解）
4. 切分、embedding → INSERT chunks
5. UPDATE documents 设置 status=completed、summary
```

### RAG 对话

```
1. 用户发消息 → POST /api/chat { conversation_id?, message, document_ids? }
2. 若有 conversation_id：INSERT messages (user)
3. 问题 embedding
4. 向量检索 chunks（若有 conversation_documents 则限定文档）
5. top K chunks 拼进 prompt → 调 Chat API
6. 流式返回，结束时 INSERT messages (assistant)，UPDATE conversations.updated_at
```

---

## 五、实施顺序建议

| 阶段 | 内容 |
|------|------|
| 1 | 接入 Supabase 客户端，写 documents 的增删改查 + Storage 上传 |
| 2 | 接入 conversations、messages，把现有 chat 改为「可绑 conversation」 |
| 3 | 实现文档解析与 embedding 流程，写入 chunks |
| 4 | 实现 RAG：向量检索 + 拼 prompt，再接 Chat API |
| 5 | 可选：conversation_documents，限定 RAG 检索范围 |

---

## 六、向量检索函数（必建）

若尚未执行，在 Supabase SQL Editor 中运行（见 `SUPABASE_SETUP.md` 第十节）：

```sql
CREATE OR REPLACE FUNCTION match_chunks(query_embedding vector(1536), match_count int DEFAULT 5)
RETURNS TABLE (id uuid, document_id uuid, content text, metadata jsonb)
LANGUAGE plpgsql AS $$
BEGIN
  RETURN QUERY
  SELECT c.id, c.document_id, c.content, c.metadata
  FROM chunks c
  ORDER BY c.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;
```

---

## 七、后端目录结构（已实现）

```
server/src/
├── lib/
│   └── supabase.ts           # Supabase 客户端
├── services/
│   ├── aiProvider.ts         # 已有
│   ├── documentService.ts    # documents 增删改查、秒传
│   ├── chunkService.ts       # chunks 写入 + 向量检索
│   ├── conversationService.ts
│   └── messageService.ts
├── routes/
│   └── chat.ts               # 已有
└── index.ts
```

**调用示例**：

```ts
import { createDocument, findByHash, updateDocumentStatus } from "./services/documentService.js";
import { insertChunks, searchChunks } from "./services/chunkService.js";
import { createConversation } from "./services/conversationService.js";
import { createMessage } from "./services/messageService.js";

// 秒传
const existing = await findByHash(md5Hash);

// 新建文档
const docId = await createDocument({ name, type, size, hash, storage_path });

// 写入 chunks
await insertChunks([{ document_id: docId, content, embedding, chunk_index: 0 }]);

// 向量检索
const chunks = await searchChunks(questionEmbedding, { limit: 5 });

// 对话
const convId = await createConversation();
await createMessage({ conversation_id: convId, role: "user", content: "你好" });
```
