# RAG 高标准完整实施方案

> 以高质量、全格式、可溯源为目标，制定 RAG 模块的完整实施方案。  
> 更新日期：2025-03-10

---

## 一、质量目标与验收标准

### 1.1 核心质量指标

| 指标 | 目标 | 实现手段 |
|------|------|----------|
| **检索精度** | 问题与相关 chunk 语义匹配度高 | 合理切片、metadata 过滤、可选重排序 |
| **回复准确性** | 基于知识库回答，少幻觉 | context 充足、prompt 约束、强制引用 |
| **溯源完整** | 每处引用可追溯到具体位置 | metadata 含 page/timestamp，citation 格式统一 |
| **多模态一致** | 各类文件统一入库与检索 | 统一 chunks 表、统一 metadata 结构 |

### 1.2 验收标准

- [ ] 任意类型文档（txt/md/pdf/docx/视频/音频）可解析、切片、向量化入库
- [ ] 提问能检索到相关 chunk，回复基于 context，无明显幻觉
- [ ] 回复中的引用可解析并跳转（PDF 页码 / 视频时间戳）
- [ ] 无 chunks 或检索为空时，正常对话不报错
- [ ] 会话可新建、切换，历史消息可加载，conversation_documents 可限定检索范围

---

## 二、分类型 RAG 方案

### 2.1 文本类（txt / md）

| 项目 | 方案 | 说明 |
|------|------|------|
| **解析** | `textParser`（已有） | UTF-8 解码，段落优先 |
| **切片策略** | 段落优先 + 固定长度 + 重叠 | CHUNK_SIZE=500，OVERLAP=50；超长段落再切 |
| **metadata** | `{}` | 无页码/时间戳，溯源用 document_id |
| **溯源格式** | `[doc-id, 文档名]` | 无精确 pointer 时用文档名 |
| **质量增强** | 保持段落完整性 | 不跨段落切分，避免语义断裂 |

**切片参数建议**（可配置）：
- `CHUNK_SIZE`: 384–512 字符（与 embedding 模型 token 能力匹配）
- `OVERLAP`: 50–100 字符，保证上下文连贯

---

### 2.2 PDF 类

| 项目 | 方案 | 说明 |
|------|------|------|
| **解析选项** | 三选一或分级策略 | 见下表 |
| **切片策略** | **按页为主**，长页再分段 | 保留页码，便于溯源 |
| **metadata** | `{ page: number }` 必填 | 用于 citation `[doc-id, 第N页]` |
| **溯源格式** | `[doc-id, 第N页]` | 点击可跳转 PDF 预览页 |

**PDF 解析能力对比**：

| 能力 | Mistral OCR | 302.ai MinerU | 302.ai Sophnet doc-parse |
|------|-------------|---------------|--------------------------|
| **输入** | document_url（公网 URL） | pdf_url | FormData 二进制 |
| **输出** | pages[].markdown | 需解析 result 结构 | data 纯文本 |
| **OCR** | ✅ 强 | ✅ ocr/txt/auto | ❌ 纯文字提取 |
| **表格/公式** | 较好 | 较好 | 一般 |
| **适用** | 扫描版、复杂排版 | 学术 PDF、多版式 | 纯文本 PDF、快速 |
| **成本** | 0.002 PTC/页 | 按任务计费 | 按调用计费 |

**推荐策略**：
1. **默认**：MinerU（pdf_url，从 Storage 生成 signed URL）
2. **备选**：Mistral OCR（需公网 URL，signed URL 可复用）
3. **轻量**：Sophnet doc-parse（直传 Buffer，无 URL 依赖）

**切片逻辑**：
```
每页 markdown → 单页 ≤ 500 字符：1 chunk，metadata: { page }
             → 单页 > 500 字符：按段落/固定长度切，每 chunk metadata: { page }
```

---

### 2.3 Word 类（docx）

| 项目 | 方案 | 说明 |
|------|------|------|
| **解析** | mammoth（Node）或 302.ai Sophnet | mammoth 转 HTML→文本，Sophnet 直出 text |
| **切片策略** | 按标题/段落切，保留层级 | 若有 heading 结构，按 section 分 chunk |
| **metadata** | `{ section?: string }` | 可选，用于「来自第X节」 |
| **溯源格式** | `[doc-id, 第X节]` 或 `[doc-id, 文档名]` | 无页码时用 section |

**实现路径**：
- 方案 A：`mammoth.extractRawText()` 或 `mammoth.convertToMarkdown()` → 按 `\n\n` 分段
- 方案 B：Sophnet doc-parse 支持 `.docx`，与 PDF 共用接口

---

### 2.4 视频类（mp4 等）

| 项目 | 方案 | 说明 |
|------|------|------|
| **解析** | 302.ai Video / 方舟 Responses | 见下表 |
| **切片策略** | **按时间段**，每 segment 一 chunk | 不二次切分，保持时序完整 |
| **metadata** | `{ start_time: "HH:mm:ss", end_time: "HH:mm:ss" }` | 必填，用于 citation |
| **溯源格式** | `[doc-id, 00:01:23]` | 点击跳转视频该时间点 |

**视频解析能力对比**：

| 能力 | 302.ai Video Understanding | 方舟 Responses API |
|------|-----------------------------|---------------------|
| **输入** | video_url + prompt | video_url + prompt + fps |
| **输出** | 纯文本描述 | 可指定 JSON（summary + segments） |
| **时间戳** | ❌ 无结构化 | ✅ segments[].start_time/end_time |
| **RAG 适配** | 需后处理分段 | 可直接入库，metadata 齐全 |
| **推荐** | 简单理解任务 | **RAG 首选**，结构化强 |

**方舟 Prompt 示例**（知识库专用）：
```json
{
  "summary": { "title", "overview", "theme", "keywords" },
  "segments": [
    { "start_time": "00:00:05", "end_time": "00:00:30", "content": "该时间段详细描述" }
  ]
}
```

每 segment 的 `content` 作为 chunk 文本，metadata 写入 `start_time`、`end_time`。

---

### 2.5 音频类（mp3 / wav / m4a）

| 项目 | 方案 | 说明 |
|------|------|------|
| **解析** | 302.ai WhisperX | FormData 或 base64，返回带时间戳文本 |
| **切片策略** | 按句/按时间窗（如 30s） | 保留每段 start/end |
| **metadata** | `{ start_time: "HH:mm:ss", end_time: "HH:mm:ss" }` | 与视频一致 |
| **溯源格式** | `[doc-id, 00:01:23]` | 跳转音频播放器时间点 |

**WhisperX 输出**：通常为 `[{ start, end, text }]` 结构，每个 segment 一条 chunk。

---

### 2.6 分类型能力矩阵

| 类型 | 解析 | 切片 | metadata | 溯源 pointer |
|------|------|------|----------|--------------|
| txt | textParser | 段落+固定长度 | {} | 文档名 |
| md | textParser | 同上 | {} | 文档名 |
| pdf | Mistral/MinerU/Sophnet | 按页+超长再切 | page | 第N页 |
| docx | mammoth / Sophnet | 按段/节 | section? | 第X节 |
| video | 方舟/302.ai | 按 segment | start_time,end_time | HH:mm:ss |
| audio | WhisperX | 按 segment | start_time,end_time | HH:mm:ss |

---

## 三、检索质量保障

### 3.1 向量检索增强

| 手段 | 实现 | 优先级 |
|------|------|--------|
| **metadata 过滤** | `document_ids` 限定检索范围 | P0，已有设计 |
| **top_k 可调** | 默认 5，可配 3–10 | P0 |
| **相似度阈值** | 可选：过滤 score < 阈值的 chunk | P1 |
| **重排序（Rerank）** | 检索后用小模型/轻量 rerank 模型重排 | P2 |
| **混合检索** | vector + 关键词 BM25（需 pg_trgm 或外部） | P2 |

### 3.2 查询侧增强（可选）

- **Query 扩展**：同义词、多语言改写，扩大召回
- **多轮改写**：结合对话历史，将当前问题改写为 standalone 问题

### 3.3 match_chunks 扩展

**当前**：`match_chunks(query_embedding, match_count)`

**扩展**：支持 `document_ids` 过滤

```sql
CREATE OR REPLACE FUNCTION match_chunks_filtered(
  query_embedding vector(384),
  filter_document_ids uuid[] DEFAULT NULL,
  match_count int DEFAULT 5
)
RETURNS TABLE (id uuid, document_id uuid, content text, metadata jsonb)
LANGUAGE plpgsql AS $$
BEGIN
  RETURN QUERY
  SELECT c.id, c.document_id, c.content, c.metadata
  FROM chunks c
  WHERE (filter_document_ids IS NULL OR c.document_id = ANY(filter_document_ids))
  ORDER BY c.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;
```

---

## 四、Context 组装与 Prompt 规范

### 4.1 Context 格式

```
根据以下知识库内容回答用户问题。若无法从给定内容中找到答案，请明确说明「根据现有知识库无法回答」，不要编造。

---
【来源：文档A · 第3页】
chunk 内容...
---
【来源：文档B · 00:01:23】
chunk 内容...
---

请基于上述内容回答，并在引用处标注 [文档ID, 页码或时间戳]。例如：[doc-xxx, 第3页] 或 [doc-yyy, 00:01:23]。
```

### 4.2 Token 预算

| 部分 | 建议 | 说明 |
|------|------|------|
| system 固定 | ~200 tokens | 规则说明 |
| context | 1500–2500 tokens | 约 3–6 个 chunk，单 chunk ~500 字符 |
| messages 历史 | 按模型上限留余量 | 如 8K 模型，预留 5K 给历史 |
| 用户当前问题 | ~200 tokens | 一般足够 |

总 context 建议不超过 3000 tokens，避免截断与噪音。

### 4.3 Chunk 去重与排序

- **去重**：相同 `document_id` + 重叠 `content` 可合并或只保留一条
- **排序**：按 `document_id` 分组，组内按 chunk_index 或 metadata.page 排序，保证上下文连贯

---

## 五、溯源引用规范

### 5.1 格式约定

| 场景 | 格式 | 示例 |
|------|------|------|
| PDF | `[doc-id, 第N页]` | `[abc-123, 第5页]` |
| 视频/音频 | `[doc-id, HH:mm:ss]` | `[abc-123, 00:01:23]` |
| 文本/无精确位置 | `[doc-id, 文档名]` | `[abc-123, 产品说明书.txt]` |

### 5.2 后端输出

检索返回的 chunk 需包含：
- `id`, `document_id`, `content`, `metadata`
- 前端组装 context 时，将 `document_id`、`metadata.page` 或 `metadata.start_time` 写入「来源」标注

### 5.3 前端展示

1. 解析回复中的 `[doc-id, pointer]` 正则
2. 渲染为可点击标签，如 `<a href="/documents/{id}?page=5">[文档A, 第5页]</a>`
3. 视频/音频：`?t=83`（秒数）跳转播放器

---

## 六、数据流与接口

### 6.1 RAG 请求流

```
用户提问
    │
    ├─ 1. embed(question)  ← 前端 embedding.worker
    │
    ├─ 2. POST /api/chat
    │       body: {
    │         messages,
    │         query_embedding?: number[],  // 384 维
    │         document_ids?: string[],      // 限定范围
    │         conversation_id?: string,
    │         top_k?: number
    │       }
    │
    ├─ 3. searchChunks(embedding, { limit: top_k, document_ids })
    │
    ├─ 4. 组装 system + context，注入 messages
    │
    └─ 5. createChatStream → SSE
```

### 6.2 接口定义

**POST /api/chat**（扩展）

```ts
// 请求体
{
  messages: { role: string; content: string }[];  // 必填
  query_embedding?: number[];   // 384 维，可选，无则不走 RAG
  document_ids?: string[];     // 限定检索文档
  conversation_id?: string;     // 会话 ID，有则写 messages
  top_k?: number;               // 默认 5
}
```

**响应**：SSE 流式，与现有一致。

### 6.3 会话与文档关联

- `conversation_documents` 表：记录会话绑定的文档
- RAG 时：若有 `conversation_id`，从 `conversation_documents` 取 `document_ids` 传给 `match_chunks_filtered`
- 若无绑定：`document_ids` 为空，全局检索

---

## 七、分类型解析接入清单

### 7.1 解析服务扩展

| 类型 | 解析入口 | 依赖 | 产出 chunks |
|------|----------|------|-------------|
| txt/md | parseService + textParser | 无 | content, metadata: {} |
| pdf | pdfParser（新建） | Storage signed URL → Mistral/MinerU/Sophnet | content, metadata: { page } |
| docx | docxParser（新建） | mammoth 或 Sophnet | content, metadata: { section? } |
| video | videoParser（新建） | Storage signed URL → 方舟/302.ai | content, metadata: { start_time, end_time } |
| audio | audioParser（新建） | Storage 下载 → WhisperX | content, metadata: { start_time, end_time } |

### 7.2 parseService 分支

```ts
switch (type) {
  case "txt":
  case "md":
    return parseTextToChunks(text);
  case "pdf":
    return await parsePdf(documentId, storagePath);  // 内部生成 signed URL
  case "docx":
    return await parseDocx(data);  // 二进制 Buffer
  case "video":
    return await parseVideo(storagePath);  // signed URL → 方舟
  case "audio":
    return await parseAudio(data);  // Buffer → WhisperX
  default:
    throw new Error(`暂不支持: ${type}`);
}
```

---

## 八、实施阶段与优先级

### 阶段 1：RAG 核心（1–2 天）

| 任务 | 内容 | 产出 |
|------|------|------|
| 1.1 | 扩展 searchChunks 支持 document_ids | match_chunks_filtered 或后端过滤 |
| 1.2 | Chat 路由接受 query_embedding、document_ids、top_k | POST /api/chat 新字段 |
| 1.3 | 有 embedding 时：检索 → 组装 context → 注入 system prompt | 完整 RAG 流 |
| 1.4 | ChatPage：embed(最后一条) → 请求体带 query_embedding | 前端联调 |

**依赖**：chunks 表为 vector(384)，match_chunks 已存在。

---

### 阶段 2：溯源与会话（2–3 天）

| 任务 | 内容 | 产出 |
|------|------|------|
| 2.1 | 挂载 conversations 路由 | CRUD 会话 |
| 2.2 | Chat 接入 conversation_id，写 messages | 会话持久化 |
| 2.3 | 检索返回带 metadata，context 含来源标注 | 后端溯源 |
| 2.4 | 前端解析 `[doc-id, pointer]`，可点击跳转 | 溯源 UI |
| 2.5 | conversation_documents 接口，限定检索范围 | 可选 |

---

### 阶段 3：PDF 解析（2–3 天）

| 任务 | 内容 | 产出 |
|------|------|------|
| 3.1 | pdfParser：Storage → signed URL → MinerU 或 Mistral | PDF 可解析 |
| 3.2 | 按页切片，metadata: { page } | chunks 含页码 |
| 3.3 | DocumentList 对 pdf 显示「向量化」 | 全链路打通 |

---

### 阶段 4：视频 / 音频解析（3–4 天）

| 任务 | 内容 | 产出 |
|------|------|------|
| 4.1 | videoParser：signed URL → 方舟 Responses（推荐） | 结构化 segments |
| 4.2 | audioParser：Buffer → WhisperX | 带时间戳文本 |
| 4.3 | 按 segment 入库，metadata: start_time/end_time | 可溯源到时间点 |
| 4.4 | DocumentList 对 video/audio 显示「向量化」 | 全模态入库 |

---

### 阶段 5：DOCX 解析（1–2 天）

| 任务 | 内容 | 产出 |
|------|------|------|
| 5.1 | docxParser：mammoth 或 Sophnet | DOCX 可解析 |
| 5.2 | 按段落/节切片，metadata: { section? } | 完整支持 |

---

### 阶段 6：质量增强（可选）

| 任务 | 内容 |
|------|------|
| 6.1 | 相似度阈值过滤 |
| 6.2 | Rerank 重排序 |
| 6.3 | Query 扩展 / 改写 |
| 6.4 | 混合检索（vector + keyword） |

---

## 九、文件路径索引

| 模块 | 路径 |
|------|------|
| 文本解析 | `server/src/parsers/textParser.ts` |
| 解析服务 | `server/src/services/parseService.ts` |
| Chunk 服务 | `server/src/services/chunkService.ts` |
| Chat 路由 | `server/src/routes/chat.ts` |
| AI 封装 | `server/src/services/aiProvider.ts` |
| 前端 Embedding | `client/src/lib/embeddingClient.ts` |
| 向量化服务 | `client/src/lib/vectorizeService.ts` |
| 对话页 | `client/src/pages/ChatPage.tsx` |
| 文档列表 | `client/src/components/DocumentList.tsx` |
| 会话服务 | `server/src/services/conversationService.ts` |
| 消息服务 | `server/src/services/messageService.ts` |
| Mistral OCR 测试 | `test/mistral-ocr.test.js` |
| MinerU 测试 | `test/pdf-mineru.test.js` |
| Sophnet 测试 | `test/doc-parse.test.js` |
| 方舟视频测试 | `test/ark-video-understanding.test.js` |
| 302 视频测试 | `test/video-understanding.test.js` |
| WhisperX 测试 | `test/whisperx.test.js` |

---

## 十、配置与环境

| 变量 | 用途 |
|------|------|
| AI_API_KEY | 302.ai / Mistral / Sophnet / WhisperX / Video |
| AI_BASE_URL | 302.ai 基地址 |
| ARK_API_KEY | 方舟视频理解（若用方舟） |
| ARK_BASE_URL | 方舟 API 基地址 |
| SUPABASE_URL / SUPABASE_SERVICE_KEY | 数据库与 Storage |

---

## 十一、总结

本方案以**高质量、全格式、可溯源**为目标：

1. **分类型 RAG**：txt/md、PDF、DOCX、视频、音频各有解析与切片策略
2. **metadata 统一**：page / start_time / end_time / section 支持精确溯源
3. **检索增强**：document_ids 过滤、top_k 可调、可扩展 match_chunks_filtered
4. **Context 规范**：来源标注、token 预算、chunk 排序
5. **实施分阶段**：先 RAG 核心 → 溯源与会话 → PDF → 视频/音频 → DOCX → 质量增强

建议按阶段 1 → 2 → 3 顺序推进，先打通 txt/md + PDF 的完整链路，再扩展音视频与 DOCX。
