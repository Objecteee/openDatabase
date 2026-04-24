/**
 * 后端入口 - Express 服务
 * 对话 API（SSE 流式）
 */

import "dotenv/config";
import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import path from "node:path";
import { fileURLToPath } from "node:url";
import chatRouter from "./routes/chat.js";
import documentsRouter from "./routes/documents.js";
import conversationsRouter from "./routes/conversations.js";
import authRouter from "./routes/auth.js";
import statsRouter from "./routes/stats.js";
import { requireAuth } from "./middleware/authMiddleware.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors({ origin: true, credentials: true }));
app.use(cookieParser());
app.use(express.json({ limit: "10mb" }));

app.use("/api", authRouter);

// 需要登录的 API（未登录会被 401 拦截）
app.use("/api", requireAuth, chatRouter);
app.use("/api/documents", requireAuth, documentsRouter);
app.use("/api/conversations", requireAuth, conversationsRouter);
app.use("/api", requireAuth, statsRouter);

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "chat-api" });
});

if (process.env.NODE_ENV === "production") {
  const publicDir = path.join(__dirname, "public");
  app.use(express.static(publicDir));
  app.get("*", (req, res, next) => {
    if (req.path.startsWith("/api") || req.path === "/health") {
      return next();
    }
    return res.sendFile(path.join(publicDir, "index.html"));
  });
}

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
