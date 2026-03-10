# 本地 Embedding 实施方案

> 使用 @huggingface/transformers（Transformers.js）在**前端 Web Worker** 中运行轻量 embedding 模型，单例加载，不阻塞 UI。

**当前实现**：模型在文档库页加载时于 Worker 内单例初始化，进度条展示，完成后才允许上传。

---

## 一、模型选择

| 模型 | 维度 | 大小 | 中文支持 | 推理速度 |
|------|------|------|----------|----------|
| **paraphrase-multilingual-MiniLM-L12-v2** | 384 | ~120MB | 好（多语言） | 中等 |
| all-MiniLM-L6-v2 | 384 | ~23MB | 一般（英文优化） | 快 |

**推荐**：`Xenova/paraphrase-multilingual-MiniLM-L12-v2`，中文效果更好，与当前需求更契合。

**维度**：384。需将数据库 `vector(1536)` 迁移为 `vector(384)`。

---

## 二、数据库迁移

在 Supabase SQL Editor 执行。**若 chunks 表已有数据**，迁移会清空并重建，需先备份或接受数据丢失。

```sql
-- 1. 清空 chunks（若有数据）
TRUNCATE chunks;

-- 2. 修改 embedding 列：1536 → 384
ALTER TABLE chunks DROP COLUMN embedding;
ALTER TABLE chunks ADD COLUMN embedding vector(384) NOT NULL;

-- 3. 更新 match_chunks 函数签名
CREATE OR REPLACE FUNCTION match_chunks(query_embedding vector(384), match_count int DEFAULT 5)
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

**若 chunks 表当前为空**，可直接执行上述 SQL。

---

## 三、前端实现（已完成）

| 文件 | 职责 |
|------|------|
| `client/src/workers/embedding.worker.ts` | Web Worker 内加载模型，单例，支持 progress_callback、embed、embedBatch |
| `client/src/lib/embeddingClient.ts` | 单例 Worker 管理、initEmbedding、subscribeEmbedding、embed/embedBatch |
| `client/src/hooks/useEmbeddingModel.ts` | Hook：进入文档页自动 init，返回 isReady、progress、error |
| `client/src/pages/DocumentsPage.tsx` | 加载中全屏进度条，完成后才展示上传区 |
| `client/src/components/MultiFileUploadZone.tsx` | disabled 时禁止拖拽/选择 |

---

## 四、安装依赖

```bash
cd client
npm install @huggingface/transformers
```

---

## 五、后续模块设计（切片向量化链路）

### 5.1 与 chunkService 的衔接

- 前端 `embeddingClient.embed(text)` / `embedBatch(texts)` 已在 Worker 内实现
- 后续：解析→切片后，对每个 chunk 调用 `embed`，将向量提交给后端写入 chunks

### 5.2 RAG 检索

- 用户问题时，前端 `embed(question)` 得到 384 维向量
- 提交给后端，调用 Supabase RPC：`match_chunks(query_embedding, 5)`

---

## 六、实现要点

### 6.1 单例与懒加载（Worker 内）（符合 main.mdc）

```ts
// 伪代码
let pipe: FeatureExtractionPipeline | null = null;

async function getPipe() {
  if (!pipe) {
    const { pipeline } = await import('@huggingface/transformers');
    pipe = await pipeline('feature-extraction', 'Xenova/paraphrase-multilingual-MiniLM-L12-v2');
  }
  return pipe;
}
```

### 6.2 输出格式与 Mean Pooling

`feature-extraction` 返回 token 级向量 `[1, seq_len, hidden_dim]`，需做 **mean pooling** 得到句向量：

```ts
// 伪代码：对序列维度取平均
const output = await pipe(text, { pooling: 'mean', normalize: true });
// 若 pipe 不支接 pooling 选项，则手动：对 output.data 在 token 维度平均
```

部分 Xenova 模型（如 sentence-transformers 转换版）可能直接返回句向量，需实测。若为 token 级，则在第 0 维（序列维）取平均即可。

### 6.3 批次推理

- 支持一次传入多个文本，减少模型前向次数
- 注意单次 batch 不宜过大（如 8–16），避免 OOM

### 6.4 首次运行

- 首次会从 Hugging Face 下载模型（约 100MB+）
- 可设置 `HF_HOME` 或 `TRANSFORMERS_CACHE` 指定缓存目录
- 下载完成后后续启动会快很多

---

## 七、实施顺序

| 阶段 | 内容 |
|------|------|
| 1 | ✅ 前端 embedding Worker + useEmbeddingModel + 进度条 |
| 2 | 执行数据库迁移（chunks.embedding → 384，更新 match_chunks） |
| 3 | 实现解析层（txt/md）+ 切片 + 调用 embed → 提交 chunks 到后端 |
| 4 | 后端 chunkService（insertChunks） |
| 5 | RAG 路由：前端 embed(question) → 后端 match_chunks → 注入 context |

---

## 八、常量与配置

在 `client/src/lib/embeddingClient.ts` 中已导出 `EMBEDDING_DIM = 384`，Worker 内使用 `Xenova/paraphrase-multilingual-MiniLM-L12-v2`。

后续若更换模型，只需改此处并确认 DB 维度一致。

---

## 九、可选：环境变量切换

若希望保留「API / 本地」双模式：

```env
# .env
EMBEDDING_MODE=local   # 或 api
# 当 EMBEDDING_MODE=api 时使用 AI_BASE_URL + AI_API_KEY
```

在 embeddingService 内根据 `EMBEDDING_MODE` 选择调用 302.ai 或本地 pipeline。

---

## 十、已知限制

| 项目 | 说明 |
|------|------|
| 维度 | 固定 384，与 302.ai 的 1536 不兼容，需完成 DB 迁移 |
| 首次加载 | 下载 + 初始化约 10–30 秒 |
| 内存 | 约 200–500MB（浏览器/Worker） |
| 质量 | 一般优于同参数量级 API，但弱于 text-embedding-ada-002 等大模型 |
| 离线 | 首次需联网下载模型，之后可离线 |

---

## 十二、进度与缓存问题排查

### 12.1 进度显示 959% 或“归零”

- **原因**：模型含多文件（config、tokenizer、model.onnx），库对每个文件单独回调；`progress` 为 0–100，`loaded/total` 为字节，若混用或切换文件会显示异常。
- **修复**：Worker 内已改为按文件累计、整体平均进度，并 clamp 到 0–100%。

### 12.2 每次刷新都重新下载（缓存不生效）

- **预期**：首次下载后写入 Cache API，刷新应从缓存加载，几乎无网络请求。
- **已实现**：
  - 使用 `env.customCache` 包装 `transformers-cache`，并在控制台输出 `Cache HIT` / `Cache MISS` / `Cache PUT OK`；
  - 启动时输出 `transformers-cache 当前条目数`，刷新后若 >0 说明缓存已持久化；
  - 捕获 `QuotaExceededError` 并提示退出无痕模式或清理存储。
- **排查步骤**：
  1. 看控制台：首次加载应有多个 `Cache PUT OK`；刷新后应有 `Cache HIT` 且 `条目数 > 0`；
  2. 若总是 `Cache MISS` 且 `条目数 = 0`：检查是否无痕模式、存储配额、或尝试 `npm run build && npm run preview` 生产构建；
  3. DevTools > Application > Cache Storage → `transformers-cache` 应有 model/tokenizer 等条目。

---

## 十一、参考链接

- [Transformers.js 文档](https://huggingface.co/docs/transformers.js)
- [paraphrase-multilingual-MiniLM-L12-v2](https://huggingface.co/Xenova/paraphrase-multilingual-MiniLM-L12-v2)
- [Feature Extraction Pipeline](https://huggingface.co/docs/transformers.js/pipelines#feature-extraction)
