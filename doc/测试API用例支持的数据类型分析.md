# 测试 API 用例支持的数据类型分析

> 分析 `test/` 目录下各测试用例支持的数据传入与解析能力，以及缺失项。  
> 更新日期：2025-03-10

---

## 一、测试用例总览

| 测试文件 | 命令 | 测试对象 | 数据类型 |
|----------|------|----------|----------|
| chat-api.test.js | `npm run test:chat` | 302.ai Chat API | 文本、图片 |
| pdf-mineru.test.js | `npm run test:pdf` | 302.ai MinerU | PDF |
| whisperx.test.js | `npm run test:whisperx` | 302.ai WhisperX | 音频 |
| video-understanding.test.js | `npm run test:video` | 302.ai Video Understanding | 视频 |

---

## 二、各用例支持的数据传入与解析

### 2.1 chat-api.test.js（Chat 对话）

| 项目 | 支持情况 | 说明 |
|------|----------|------|
| **纯文本** | ✅ | `messages: [{ role: "user", content: "..." }]` |
| **文本 + 图片** | ✅ | `content` 为数组：`[{ type: "text", text: "..." }, { type: "image_url", image_url: { url } }]` |
| **图片格式** | ✅ | `data:image/png;base64,<base64>` 或 `data:image/jpeg;base64,...` |
| **流式输出** | ❌ | 测试用 `stream: false`，未测 SSE 流式 |
| **多轮对话** | ❌ | 仅测单轮 |
| **RAG 检索** | ❌ | 未测 |

**传入方式**：JSON body，`messages` 数组。

---

### 2.2 pdf-mineru.test.js（PDF 解析）

| 项目 | 支持情况 | 说明 |
|------|----------|------|
| **PDF 输入** | ✅ | 通过 `pdf_url` 传入 PDF 文件 URL |
| **解析方式** | ✅ | `parse_method`: ocr \| txt \| auto |
| **版本** | ✅ | `version`: 2.0 \| 2.5 |
| **任务模式** | ✅ | 创建任务 → 轮询获取结果 |
| **本地文件上传** | ❌ | 仅支持 URL，不支持 FormData 上传 |
| **与业务 parseService 集成** | ❌ | 独立测试，未接入 server 解析流程 |

**传入方式**：`POST` JSON body `{ pdf_url, parse_method, version }`。

---

### 2.3 whisperx.test.js（音频转文字）

| 项目 | 支持情况 | 说明 |
|------|----------|------|
| **音频输入** | ✅ | base64 或 `data:audio/wav;base64,...` |
| **格式** | ✅ | wav、mp3、m4a |
| **传入方式** | ✅ | FormData `audio_input` 二进制 |
| **时间戳** | ✅ | 返回带时间戳的文本 |
| **processing_type** | ✅ | 可配置处理模式 |
| **本地文件上传** | ❌ | 需先转 base64，无直接传文件路径/URL |
| **与业务 parseService 集成** | ❌ | 独立测试，未接入 server |

**传入方式**：FormData，`audio_input` 为二进制文件。

---

### 2.4 video-understanding.test.js（视频理解）

| 项目 | 支持情况 | 说明 |
|------|----------|------|
| **视频输入** | ✅ | `video_url` 传入视频 URL |
| **Prompt** | ✅ | `prompt` 指定理解任务 |
| **异步模式** | ✅ | 提交 → 返回 request_id → 轮询结果 |
| **本地文件上传** | ❌ | 仅支持 URL，不支持直接上传 |
| **与业务 parseService 集成** | ❌ | 独立测试，未接入 server |

**传入方式**：`POST` JSON body `{ video_url, prompt }`。

---

## 三、业务端 parseService 支持情况（对比）

| 类型 | 测试用例 | 业务 parseService | 说明 |
|------|----------|-------------------|------|
| **txt** | ❌ 无独立测试 | ✅ 原生解析 | 仅通过文档上传 + 向量化间接验证 |
| **md** | ❌ 无独立测试 | ✅ 原生解析 | 同上 |
| **pdf** | ✅ pdf-mineru | ❌ 未接入 | 测试验证 302.ai API，业务未调用 |
| **docx** | ❌ 无 | ❌ 未实现 | 完全缺失 |
| **音频** | ✅ whisperx | ❌ 未接入 | 测试验证 302.ai API，业务未调用 |
| **视频** | ✅ video-understanding | ❌ 未接入 | 同上 |
| **图片** | ✅ chat 多模态 | ❌ 无解析/向量化 | Chat 可传图，知识库无图片解析 |

---

## 四、缺失项汇总

### 4.1 测试用例层面

| 缺失 | 说明 |
|------|------|
| **txt/md 解析** | 无独立测试 `parseService` 或 `GET /api/documents/:id/parse` |
| **文档上传 API** | 无测试 `POST /api/documents/upload`、分片上传、秒传 |
| **向量化流程** | 无测试 parse → embed → POST chunks |
| **DOCX** | 无 302.ai 或 mammoth 等 DOCX 解析测试 |
| **Chat 流式** | 仅测非流式，未测 SSE |
| **RAG** | 无检索 + Chat 联调测试 |
| **conversations/messages** | 无会话持久化相关测试 |

### 4.2 业务集成层面

| 缺失 | 说明 |
|------|------|
| **PDF → parseService** | 需在 parseService 中调用 MinerU，将结果切片写入 chunks |
| **音频 → parseService** | 需调用 WhisperX，产出带时间戳文本再切片 |
| **视频 → parseService** | 需调用 Video Understanding，产出文本再切片 |
| **DOCX** | 需引入 mammoth 或 302.ai DOCX 接口 |
| **图片** | 若要做知识库，需 OCR/多模态理解接口 |

### 4.3 传入方式差异

| 测试用例 | 传入方式 | 业务文档上传 |
|----------|----------|--------------|
| PDF | `pdf_url`（URL） | 用户上传文件 → Storage → 需从 Storage 取 URL 或下载后转给 MinerU |
| 音频 | FormData 二进制 | 用户上传 → Storage → 需下载后转 base64/二进制给 WhisperX |
| 视频 | `video_url`（URL） | 用户上传 → Storage → 需生成 signed URL 给 Video API |

业务需增加「从 Storage 取文件 → 调用外部 API」的桥接逻辑。

---

## 五、建议补充的测试

| 优先级 | 测试内容 | 目的 |
|--------|----------|------|
| 高 | 文档上传 API（直传、秒传、分片） | 验证核心上传链路 |
| 高 | `GET /api/documents/:id/parse`（txt/md） | 验证 parseService |
| 高 | 向量化全流程（parse → embed → chunks） | 验证 RAG 前置链路 |
| 中 | Chat 流式 SSE | 验证生产使用模式 |
| 中 | RAG 检索 + Chat | 验证检索增强对话 |
| 低 | PDF/音频/视频解析与业务集成 | 随功能接入时补充 |
| 低 | DOCX 解析 | 若有 DOCX 需求再补 |

---

## 六、数据流对比图

```
【当前测试覆盖】
chat-api     → 302.ai Chat（文本、图片）
pdf-mineru   → 302.ai MinerU（PDF URL）
whisperx     → 302.ai WhisperX（音频 base64）
video        → 302.ai Video（视频 URL）

【业务实际链路】
用户上传 → Storage → parseService
                ├─ txt/md → textParser（原生）✅
                ├─ pdf    → 未接入 MinerU ❌
                ├─ 音频   → 未接入 WhisperX ❌
                ├─ 视频   → 未接入 Video API ❌
                └─ docx   → 未实现 ❌
```
