# 数据库规格 (SPEC_DATABASE)

> Supabase (PostgreSQL + pgvector)

---

## 1. documents（文档/资产）

存储上传文件的元数据，源文件存于 Supabase Storage。

| 字段 | 类型 | 说明 |
|------|------|------|
| id | uuid | 主键，默认 `gen_random_uuid()` |
| user_id | uuid | 用户 ID（若有多用户），关联 Supabase Auth |
| name | text | 文件名 |
| type | text | 类型：pdf / txt / md / docx / image / video / audio |
| size | bigint | 文件大小（字节） |
| hash | text | MD5，用于秒传 |
| storage_path | text | Supabase Storage 路径 |
| summary | text | AI 摘要（可为空） |
| status | text | 处理状态：pending / processing / completed / failed |
| error_message | text | 失败时错误信息 |
| created_at | timestamptz | 创建时间 |
| updated_at | timestamptz | 更新时间 |

---

## 2. chunks（切片）

RAG 检索单元，存储文档切片文本及向量。

| 字段 | 类型 | 说明 |
|------|------|------|
| id | uuid | 主键 |
| document_id | uuid | 所属文档，外键 documents(id) |
| content | text | 切片文本内容 |
| embedding | vector(1536) | 向量（维度需按 embedding 模型定） |
| metadata | jsonb | 如 { "page": 1, "timestamp": "00:01:30" } |
| chunk_index | int | 文档内序号 |
| created_at | timestamptz | 创建时间 |

---

## 3. conversations（对话会话）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | uuid | 主键 |
| user_id | uuid | 用户 ID（若有多用户） |
| title | text | 会话标题，可为空或首条消息摘要 |
| created_at | timestamptz | 创建时间 |
| updated_at | timestamptz | 更新时间 |

---

## 4. messages（消息）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | uuid | 主键 |
| conversation_id | uuid | 所属会话，外键 conversations(id) |
| role | text | user / assistant / system |
| content | text | 消息内容 |
| citations | jsonb | 引用，如 [{ "chunk_id": "xxx", "pointer": { "page": 1 } }] |
| created_at | timestamptz | 创建时间 |

---

## 5. conversation_documents（可选）

会话与文档关联，用于限定 RAG 检索范围。

| 字段 | 类型 | 说明 |
|------|------|------|
| id | uuid | 主键 |
| conversation_id | uuid | 外键 |
| document_id | uuid | 外键 |
| created_at | timestamptz | 创建时间 |
