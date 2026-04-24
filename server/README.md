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

## 线上部署（Express 单服务）

生产模式下，后端会托管前端静态文件：
- 前端产物来源：`client/dist`
- 发布目录：`server/dist/public`
- API 路径：`/api/**`

### 1) 构建

在 `server` 目录执行：

```bash
npm install
npm run build
```

`npm run build` 会自动完成：
1. 构建前端（`../client`）
2. 编译后端 TypeScript 到 `server/dist`
3. 复制前端产物到 `server/dist/public`

### 2) 启动（生产）

```bash
NODE_ENV=production npm start
```

### 3) systemd 服务重启（服务器）

如果线上使用了 `deepcall.service`：

```bash
sudo systemctl daemon-reload
sudo systemctl restart deepcall.service
sudo systemctl status deepcall.service --no-pager -l
```

### 4) 部署后验证

```bash
curl -i http://127.0.0.1:3000/health
curl -I http://127.0.0.1:3000/
```

还需要手动验证：
- 访问前端路由（如 `/dashboard`）可正常返回页面
- `/api/*` 接口正常返回，不被前端路由兜底覆盖

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
