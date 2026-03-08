# 后端服务

对话 API（SSE 流式），基于 302.ai Chat API。

## 环境配置

```bash
# 复制 .env.example 为 .env
cp .env.example .env

# 填入 AI_API_KEY（可从 test/.env 复制）
```

## 启动

```bash
npm install
npm run dev
```

## API

### POST /api/chat

流式对话，返回 SSE。

**请求体**:
```json
{
  "messages": [
    { "role": "user", "content": "你好" }
  ]
}
```

**响应**: `text/event-stream`，格式同 OpenAI SSE（`data: {...}\n\n`）
