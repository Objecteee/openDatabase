# AI 对话前后端逻辑与实现记录

> 本文档描述「实现 AI 对话的前后端逻辑」的架构、数据流及实现过程中的对话记录。

---

## 一、功能概览

**目标**：实现简单的 SSE 流式 AI 对话，不包含 RAG，使用 302.ai Chat API。

**范围**：
- 后端：Express 接收消息，调用 302.ai，以 SSE 流式转发
- 前端：React 发送消息，解析 SSE 流，打字机效果展示，Markdown 渲染

---

## 二、后端逻辑

### 2.1 架构

```
前端 POST /api/chat { messages }
    ↓
Express (server/src/routes/chat.ts)
    ↓
aiProvider.createChatStream(messages) → 302.ai /v1/chat/completions (stream: true)
    ↓
302.ai 返回 SSE 流
    ↓
chat.ts 原样转发给前端 (Content-Type: text/event-stream)
```

### 2.2 核心文件

| 文件 | 职责 |
|------|------|
| `server/src/index.ts` | Express 入口，挂载 `/api` 下的 chat 路由 |
| `server/src/routes/chat.ts` | `POST /api/chat`，接收 `messages`，调用 AI，转发 SSE |
| `server/src/services/aiProvider.ts` | 封装 302.ai Chat API，`createChatStream(messages)` |

### 2.3 请求与响应

**请求体**：
```json
{
  "messages": [
    { "role": "user", "content": "你好" }
  ]
}
```

**校验**：`messages` 必填且非空数组，否则返回 400。

**响应**：
- `Content-Type: text/event-stream`
- 每行格式：`data: {...}\n\n`，与 OpenAI SSE 一致
- 结束标记：`data: [DONE]\n\n`
- 每块 JSON 中 `choices[0].delta.content` 为增量文本

### 2.4 系统提示

在 `chat.ts` 中注入系统消息，要求 AI 使用 Markdown 回复：

```
你是一个有帮助的助手。请始终使用 Markdown 格式回复，包括标题、列表、代码块、加粗、链接等，以便更好地呈现内容。
```

### 2.5 环境变量

- `AI_API_KEY`：302.ai API 密钥
- `AI_BASE_URL`：默认 `https://api.302.ai`
- `PORT`：服务端口，默认 3000

---

## 三、前端逻辑

### 3.1 架构

```
用户输入 → 发送 POST /api/chat
    ↓
fetch 返回 ReadableStream
    ↓
按行解析 data: {...}，提取 choices[0].delta.content
    ↓
pendingChunksRef 累积 → requestAnimationFrame 定时合并
    ↓
setMessages 更新 assistant 消息 content
    ↓
流结束后：streaming=false → 用 ReactMarkdown 渲染
```

### 3.2 核心文件

| 文件 | 职责 |
|------|------|
| `client/src/App.tsx` | 对话页面、消息列表、输入框、流式解析、Markdown 渲染 |
| `client/vite.config.ts` | 将 `/api` 代理到后端 `http://localhost:3000` |

### 3.3 流式渲染策略

- **流式阶段**（`streaming: true`）：用纯文本展示，`whitespace-pre-wrap` 保留换行，**不解析 Markdown**，避免 `**`、`#` 等符号造成闪烁
- **流式结束**（`streaming: false`）：再交给 `ReactMarkdown` + `remark-gfm` 做完整 Markdown 渲染

### 3.4 打字机效果实现

- 使用 `pendingChunksRef` 暂存 SSE 解析出的增量文本
- `requestAnimationFrame` 循环：定期将 `pendingChunksRef` 合并到当前 assistant 消息的 `content`，并滚动到底部
- 流结束后停止 `requestAnimationFrame`，做最后一次 flush

### 3.5 依赖

- `react-markdown`：Markdown 渲染
- `remark-gfm`：GFM 扩展（表格、删除线等）
- `@tailwindcss/typography`：`prose` 排版

---

## 四、协议与数据流

### 4.1 SSE 格式

与 OpenAI Chat Completions 流式格式兼容：
- 每行：`data: <JSON>\n\n`
- 结束：`data: [DONE]\n\n`
- 增量内容：`json.choices[0].delta.content`

### 4.2 整体链路

```
302.ai Chat API (stream) → Express /api/chat → 前端 fetch + ReadableStream
```

---

## 五、实现过程中的对话记录

以下为在实现该功能时的关键对话摘录（完整对话见 Cursor agent-transcripts：`bc57ef64-f80c-4fb0-a688-1c3454e13871`）。

### 5.1 需求提出

**用户**：我们下来先来完成简单的 SSE 流式输出的对话逻辑，这里我们先不加入 RAG 相关的内容，先来搭建这个页面的后端逻辑，API 就是用之前测试通过的对话 API。

**助手**：后端已搭建完成。结构：`server/src/index.ts`、`routes/chat.ts`、`services/aiProvider.ts`。API：`POST /api/chat`，流式对话，使用 SSE。

---

### 5.2 前端搭建

**用户**：接下来，搭建流式输出的前端。

**助手**：流式对话前端已搭建完成。实现内容：流式 SSE 解析、`requestAnimationFrame` 打字机效果、用户/助手消息区分、输入框与发送按钮、`/api` 代理到后端。

---

### 5.3 依赖与协议说明

**用户**：（询问流式输出依赖的接口和协议）

**助手**：1. 外部 AI：302.ai Chat API，`POST https://api.302.ai/v1/chat/completions`，`stream: true`；2. 本地后端：Express `POST /api/chat`，转发 SSE；3. 协议：SSE，与 OpenAI 流式格式兼容。链路：302.ai → Express /api/chat → 前端 fetch + ReadableStream。

---

### 5.4 Markdown 渲染

**用户**：（希望 AI 回复支持 Markdown 渲染）

**助手**：1. 后端：在 system prompt 中要求「始终使用 Markdown 格式回复」；2. 前端：安装 `react-markdown`、`remark-gfm`、`@tailwindcss/typography`，助手消息用 ReactMarkdown 渲染。

---

### 5.5 流式阶段 Markdown 闪烁问题

**用户**：（流式输出时 Markdown 符号如 `**` 导致渲染异常或闪烁）

**助手**：已修改。流式阶段（`streaming: true`）用纯文本展示，不解析 Markdown；流式结束后再交给 ReactMarkdown 做完整渲染，避免中间状态导致的视觉抖动。

---

### 5.6 网络错误排查

**用户**：（报错 `getaddrinfo ENOTFOUND api.302.ai`）

**助手**：该错误表示无法解析 `api.302.ai` 域名，通常为网络或 DNS 问题。可尝试：1. 检查网络连接；2. 使用国内中转 `AI_BASE_URL=https://api.302ai.cn`；3. 检查代理或防火墙设置。

---

## 六、运行方式

```bash
# 1. 启动后端
cd server && npm install && npm run dev

# 2. 启动前端（新终端）
cd client && npm install && npm run dev
```

浏览器访问 http://localhost:5173 ，输入并发送消息即可测试流式对话。

---

## 七、关联文件索引

| 类型 | 路径 |
|------|------|
| 后端入口 | `server/src/index.ts` |
| Chat 路由 | `server/src/routes/chat.ts` |
| AI 封装 | `server/src/services/aiProvider.ts` |
| 前端主组件 | `client/src/App.tsx` |
| Chat API 测试 | `test/chat-api.test.js` |
