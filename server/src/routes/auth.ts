/**
 * Auth 路由：注册 / 登录 / 刷新 / 登出 / 当前用户
 */

import { Router, Request, Response } from "express";
import { z } from "zod";
import jwt from "jsonwebtoken";
import { createUser, persistRefreshToken, signAccessToken, signRefreshToken, verifyAndRotateRefreshToken, verifyPasswordByEmail, revokeRefreshToken } from "../services/authService.js";
import { requireAuth, type AuthedRequest } from "../middleware/authMiddleware.js";

const router = Router();

const cookieName = "refresh_token";

function getErrMessage(e: unknown): { message: string; code?: string; details?: string } {
  if (e instanceof Error) return { message: e.message };
  if (e && typeof e === "object") {
    const anyE = e as Record<string, unknown>;
    const message = typeof anyE.message === "string" ? anyE.message : JSON.stringify(anyE);
    const code = typeof anyE.code === "string" ? anyE.code : undefined;
    const details = typeof anyE.details === "string" ? anyE.details : undefined;
    return { message, code, details };
  }
  return { message: String(e ?? "未知错误") };
}

function refreshCookieOptions() {
  const isProd = process.env.NODE_ENV === "production";
  const cookieSecureEnv = process.env.COOKIE_SECURE?.toLowerCase();
  const secure =
    cookieSecureEnv === "true"
      ? true
      : cookieSecureEnv === "false"
        ? false
        : isProd;
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure,
    path: "/api/auth",
  };
}

const RegisterSchema = z.object({
  username: z.string().trim().min(3).max(30).regex(/^[a-zA-Z0-9_]+$/, "用户名仅允许字母/数字/下划线"),
  email: z.string().trim().email().max(254),
  password: z.string().min(8).max(72),
});

const LoginSchema = z.object({
  email: z.string().trim().email().max(254),
  password: z.string().min(8).max(72),
});

router.post("/auth/register", async (req: Request, res: Response) => {
  const parsed = RegisterSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "参数错误" });

  try {
    const user = await createUser(parsed.data);
    const access = signAccessToken(user);
    const refresh = signRefreshToken(user);
    await persistRefreshToken(user.id, refresh.token, refresh.expires_at);
    res.cookie(cookieName, refresh.token, refreshCookieOptions());
    res.json({ user, access_token: access.token, expires_in: access.expires_in });
  } catch (e) {
    const err = getErrMessage(e);
    console.error("[auth/register] error:", err);

    // 唯一约束冲突：邮箱/用户名已存在（Postgres 常见提示包含 duplicate key）
    const lowerMsg = err.message.toLowerCase();
    if (lowerMsg.includes("duplicate") || lowerMsg.includes("unique")) {
      return res.status(400).json({ error: "用户名或邮箱已存在" });
    }

    // 表未创建/迁移未执行的常见提示
    if (lowerMsg.includes("relation") && lowerMsg.includes("does not exist")) {
      return res.status(500).json({ error: "数据库表未初始化，请先在 Supabase 执行 auth_users_refresh_tokens.sql" });
    }

    return res.status(500).json({ error: "注册失败：" + err.message });
  }
});

router.post("/auth/login", async (req: Request, res: Response) => {
  const parsed = LoginSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "参数错误" });

  try {
    const user = await verifyPasswordByEmail(parsed.data.email, parsed.data.password);
    if (!user) return res.status(401).json({ error: "邮箱或密码错误" });

    const access = signAccessToken(user);
    const refresh = signRefreshToken(user);
    await persistRefreshToken(user.id, refresh.token, refresh.expires_at);
    res.cookie(cookieName, refresh.token, refreshCookieOptions());
    res.json({ user, access_token: access.token, expires_in: access.expires_in });
  } catch (e) {
    const err = getErrMessage(e);
    console.error("[auth/login] error:", err);
    res.status(500).json({ error: "登录失败：" + err.message });
  }
});

router.post("/auth/refresh", async (req: Request, res: Response) => {
  const token = req.cookies?.[cookieName] as string | undefined;
  if (!token) return res.status(401).json({ error: "无 refresh token" });

  try {
    const rotated = await verifyAndRotateRefreshToken(token);
    res.cookie(cookieName, rotated.newRefreshToken, refreshCookieOptions());
    res.json({ user: rotated.user, access_token: rotated.accessToken, expires_in: rotated.accessExpiresIn });
  } catch (e) {
    const err = getErrMessage(e);
    console.error("[auth/refresh] error:", err);

    const fatal = ["无效", "不存在", "已吊销", "已过期", "invalid", "expired"].some(
      (k) => err.message.toLowerCase().includes(k),
    );
    if (fatal) {
      res.clearCookie(cookieName, refreshCookieOptions());
    }

    res.status(401).json({ error: err.message || "刷新失败" });
  }
});

router.post("/auth/logout", async (req: Request, res: Response) => {
  const token = req.cookies?.[cookieName] as string | undefined;
  if (token) {
    try {
      // 尽力吊销（不阻断 logout）
      await revokeRefreshToken(token);
    } catch {
      // ignore
    }
  }
  res.clearCookie(cookieName, refreshCookieOptions());
  res.json({ ok: true });
});

router.get("/auth/me", requireAuth, async (req: AuthedRequest, res: Response) => {
  res.json({ user: req.user ?? null });
});

// 便于前端快速验证 refresh cookie 是否设置成功（非必须）
router.get("/auth/_debug/refresh-cookie", (req: Request, res: Response) => {
  const token = req.cookies?.[cookieName] as string | undefined;
  if (!token) return res.status(404).json({ ok: false });
  try {
    const payload = jwt.decode(token) as Record<string, unknown> | null;
    res.json({ ok: true, payload });
  } catch {
    res.json({ ok: true });
  }
});

export default router;

