# RAG 接入实施方案

> 基于现有架构，给出 RAG（检索增强生成）的完整接入方案与实施顺序。  
> 更新日期：2025-03-10

---

## 一、现状与目标

### 1.1 已有能力

| 模块 | 状态 | 说明 |
|------|------|------|
| 文档上传 | ✅ | txt/md/pdf/video/audio 可上传至 Storage |
| txt/md 解析 | ✅ | textParser 切片，parseService 解析 |
| 向量化 | ✅ | 前端 embedding.worker（384 维）→ chunks 表 |
| 向量检索 | ✅ | chunkService.searchChunks、match_chunks RPC |
| Chat 流式 | ✅ | 302.ai SSE，无 RAG、无会话 |
| PDF/视频/音频解析 | ⚠️ | 有 test 脚本（Mistral OCR、方舟视频、WhisperX），未接入 parseService |

### 1.2 目标

- 用户提问时，从 chunks 中检索相关片段，注入 context，再调用 Chat
- 回复可溯源到具体文档与位置（PDF 页码 / 视频时间戳）
- 支持会话持久化（可选，与 RAG 可并行）

---

## 二、RAG 数据流

```
用户提问
    │
    ├─ 1. embed(question)           ← 前端 embedding.worker（已有）
    │
    ├─ 2. POST /api/chat/rag
    │       body: { messages, query_embedding, document_ids? }
    │
    ├─ 3. 后端 searchChunks(embedding, { limit: 5, document_ids? })
    │       → 返回 top K chunks（content + metadata + document_id）
    │
    ├─ 4. 构建 system prompt：
    │       "根据以下知识库内容回答，若无法回答请说明。\n\n---\n{chunk1}\n---\n{chunk2}..."
    │
    └─ 5. createChatStream([system, ...messages])
            → SSE 流式返回
```

---

## 三、方案 A：最小可行 RAG（推荐优先）

**目标**：最快打通「提问 → 检索 → 增强回复」链路，不依赖会话改造。

### 3.1 新增接口

**POST /api/chat** 扩展（或新建 **POST /api/chat/rag**）

```ts
// 请求体
{
  messages: ChatMessage[];           // 必填，对话历史
  query_embedding?: number[];       // 可选，用户最后一问的 384 维向量
  document_ids?: string[];          // 可选，限定检索范围
  top_k?: number;                   // 可选，默认 5
}
```

**逻辑**：

1. 若有 `query_embedding`：调用 `searchChunks(embedding, { limit: top_k, document_ids })`
2. 若有检索结果：将 chunks 拼成 context，注入 system prompt
3. 调用 `createChatStream`，返回 SSE

### 3.2 前端改造

1. **ChatPage 发送前**：对用户最后一条消息调用 `embed(message)`，得到 `query_embedding`
2. **请求体**：`{ messages, query_embedding }`
3. **可选**：文档库选择「当前会话关联文档」→ 传 `document_ids`

### 3.3 依赖检查

- [ ] `match_chunks` 为 `vector(384)`（与本地模型一致）
- [ ] chunks 表已有向量数据（先对 txt/md 做向量化）

### 3.4 预估工时

**1–2 天**（后端 0.5 天 + 前端 0.5–1 天）

---

## 四、方案 B：完整 RAG（含会话与溯源）

在方案 A 基础上增加：

### 4.1 会话持久化

- 挂载 `conversations` 路由
- Chat 请求体增加 `conversation_id`
- 流式结束后写入 `messages` 表
- 前端：新建会话、切换会话、加载历史

### 4.2 溯源引用 (Citation)

**main.mdc 要求**：AI 回复携带 `[source_id, pointer]`，pointer 为 PDF 页码或视频时间戳 hh:mm:ss。

**实现思路**：

1. **chunks.metadata** 必须包含：
   - `page`：PDF 页码（若有）
   - `timestamp`：视频/音频时间戳 hh:mm:ss（若有）
   - `document_id`：来源文档

2. **检索返回**：将 `chunk_id`、`document_id`、`metadata` 一并返回给前端

3. **System prompt 约束**：
   ```
   回答时，若引用某段内容，请在句末标注 [文档ID, 页码或时间戳]。
   例如：[doc-xxx, 第3页] 或 [doc-yyy, 00:01:23]
   ```

4. **前端展示**：解析回复中的 `[doc-id, pointer]`，渲染为可点击引用，跳转到文档预览或时间点

### 4.3 预估工时

**2–3 天**（会话 0.5–1 天 + 溯源 1 天）

---

## 五、方案 C：多格式解析扩展（PDF/视频/音频入库）

将 test 目录下的解析能力接入 parseService，使 PDF、视频、音频也能切片入库参与 RAG。

### 5.1 解析路由扩展

| 类型 | 解析方案 | 输入 | 输出 chunks |
|------|----------|------|-------------|
| txt/md | textParser | Storage Blob | 按段落+固定长度 |
| pdf | Mistral OCR | document_url（需公网 URL） | pages[].markdown → 按页或按段 |
| video | 方舟 Responses API | video_url | segments[].content + metadata.timestamp |
| audio | WhisperX | base64 | 带时间戳文本 → 按段切片 |

### 5.2 关键点

- **PDF**：需从 Storage 生成 signed URL 或上传到临时可访问地址，供 Mistral OCR 使用
- **视频**：方舟返回的 segments 直接作为 chunks，metadata 写入 `timestamp`
- **音频**：WhisperX 返回带时间戳文本，按时间窗或段落切片，metadata 写入 `timestamp`

### 5.3 预估工时

**3–5 天**（每种格式约 1 天，含联调）

---

## 六、实施顺序建议

| 阶段 | 内容 | 工时 | 产出 |
|------|------|------|------|
| **1** | 方案 A：最小 RAG | 1–2 天 | 提问 → 检索 → 增强回复 |
| **2** | 方案 B：会话 + 溯源 | 2–3 天 | 会话持久化、引用可点击 |
| **3** | 方案 C：多格式解析 | 3–5 天 | PDF/视频/音频可向量化入库 |

**建议**：先完成阶段 1，验证 RAG 链路与效果，再迭代 2、3。

---

## 七、技术细节补充

### 7.1 检索范围过滤

若需按 `document_ids` 过滤，需扩展 `match_chunks` 或在后端过滤：

```sql
-- 可选：match_chunks_filtered(document_ids uuid[], query_embedding, match_count)
```

或检索后在后端按 `document_id` 过滤（简单但可能不足 top_k）。

### 7.2 Context 长度控制

- 单 chunk 约 500 字符，5 个 chunk ≈ 2500 字符
- 需预留 system + context + messages 的总 token，避免超出模型上下文
- 可配置 `top_k`（如 3–8）按需调整

### 7.3 Embedding 一致性

- 检索与入库必须使用**同一模型**（paraphrase-multilingual-MiniLM-L12-v2，384 维）
- 若未来改用云端 embedding，需全量重新向量化并迁移 DB

---

## 八、验收标准

- [ ] 有 chunks 时，提问能返回基于知识库的回复
- [ ] 无 chunks 或检索为空时，正常对话（不报错）
- [ ] 流式输出正常，无卡顿
- [ ] （阶段 2）会话可新建、切换，历史消息可加载
- [ ] （阶段 2）回复中的引用可解析并展示来源
