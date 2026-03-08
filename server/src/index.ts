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

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
  console.log(`Chat API: POST http://localhost:${PORT}/api/chat`);
});
