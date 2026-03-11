import jwt from "jsonwebtoken";
import type { Request, Response, NextFunction } from "express";

const JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET ?? "";

export interface AuthedRequest extends Request {
  user?: { id: string; username?: string; email?: string };
}

export function requireAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  if (!JWT_ACCESS_SECRET) return res.status(500).json({ error: "JWT_ACCESS_SECRET 未配置" });

  const auth = req.header("Authorization") ?? "";
  const m = auth.match(/^Bearer\s+(.+)$/i);
  if (!m) return res.status(401).json({ error: "未登录" });

  try {
    const payload = jwt.verify(m[1], JWT_ACCESS_SECRET) as { sub?: string; username?: string; email?: string; typ?: string };
    if (!payload?.sub || payload.typ !== "access") return res.status(401).json({ error: "token 无效" });
    req.user = { id: payload.sub, username: payload.username, email: payload.email };
    next();
  } catch {
    return res.status(401).json({ error: "token 已过期或无效" });
  }
}

