/**
 * 后端入口 - Express 服务
 * 对话 API（SSE 流式）
 */

import "dotenv/config";
import express from "express";
import cors from "cors";
import chatRouter from "./routes/chat.js";
import documentsRouter from "./routes/documents.js";

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

app.use("/api", chatRouter);
app.use("/api/documents", documentsRouter);

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "chat-api" });
});

/** 端口被占用时尝试备用端口 */
function tryListen(port: number, maxAttempts = 5, isFallback = false): void {
  const server = app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
    console.log(`Chat API: POST http://localhost:${port}/api/chat`);
    if (isFallback) {
      console.warn("提示: 若前端 Vite 代理指向 3000，请在 vite.config.ts 中修改 proxy target");
    }
  });
  server.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE" && maxAttempts > 0) {
      console.warn(`Port ${port} in use, trying ${port + 1}...`);
      tryListen(port + 1, maxAttempts - 1, true);
    } else {
      throw err;
    }
  });
}

tryListen(Number(PORT) || 3000);
