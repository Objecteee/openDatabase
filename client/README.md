# 前端 - 流式对话

React + Vite + Tailwind，对接 `/api/chat` SSE 流式输出。

## 启动

```bash
# 确保后端已启动 (cd server && npm run dev)
npm install
npm run dev
```

访问 http://localhost:5173

## 功能

- 流式对话：SSE 实时输出
- 打字机效果：requestAnimationFrame 平滑渲染
- API 代理：/api 转发到 localhost:3000
