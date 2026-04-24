/**
 * Auth Service：用户名/邮箱/密码注册登录 + JWT access/refresh 双 token
 *
 * 约定：
 * - access token：短期（默认 15min），用于 Authorization: Bearer <token>
 * - refresh token：长期（默认 30d），仅存 httpOnly cookie；服务端仅保存其 hash（可轮换/吊销）
 */
import crypto from "crypto";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { supabase } from "../lib/supabase.js";
const ACCESS_TTL_SECONDS = 15 * 60;
const REFRESH_TTL_DAYS = 30;
const JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET ?? "";
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET ?? "";
function requireSecrets() {
    if (!JWT_ACCESS_SECRET || !JWT_REFRESH_SECRET) {
        throw new Error("JWT_ACCESS_SECRET / JWT_REFRESH_SECRET 未配置");
    }
}
function sha256(text) {
    return crypto.createHash("sha256").update(text).digest("hex");
}
function nowIso() {
    return new Date().toISOString();
}
function refreshExpiresAt() {
    const d = new Date();
    d.setDate(d.getDate() + REFRESH_TTL_DAYS);
    return d.toISOString();
}
export async function createUser(input) {
    if (!supabase)
        throw new Error("Supabase 未配置");
    const password_hash = await bcrypt.hash(input.password, 12);
    const { data, error } = await supabase
        .from("users")
        .insert({
        username: input.username,
        email: input.email,
        password_hash,
        updated_at: nowIso(),
    })
        .select("id, username, email")
        .single();
    if (error)
        throw error;
    return data;
}
export async function verifyPasswordByEmail(email, password) {
    if (!supabase)
        throw new Error("Supabase 未配置");
    const { data, error } = await supabase
        .from("users")
        .select("id, username, email, password_hash")
        .ilike("email", email)
        .maybeSingle();
    if (error)
        throw error;
    if (!data)
        return null;
    const ok = await bcrypt.compare(password, String(data.password_hash));
    if (!ok)
        return null;
    return { id: String(data.id), username: String(data.username), email: String(data.email) };
}
export function signAccessToken(user) {
    requireSecrets();
    const token = jwt.sign({ sub: user.id, username: user.username, email: user.email, typ: "access" }, JWT_ACCESS_SECRET, { expiresIn: ACCESS_TTL_SECONDS });
    return { token, expires_in: ACCESS_TTL_SECONDS };
}
export function signRefreshToken(user) {
    requireSecrets();
    const expires_at = refreshExpiresAt();
    const token = jwt.sign({ sub: user.id, typ: "refresh", jti: crypto.randomUUID() }, JWT_REFRESH_SECRET, { expiresIn: `${REFRESH_TTL_DAYS}d` });
    return { token, expires_at };
}
export async function persistRefreshToken(userId, refreshToken, expiresAtIso) {
    if (!supabase)
        throw new Error("Supabase 未配置");
    const token_hash = sha256(refreshToken);
    const { error } = await supabase.from("refresh_tokens").insert({
        user_id: userId,
        token_hash,
        expires_at: expiresAtIso,
    });
    if (error)
        throw error;
}
export async function revokeRefreshToken(refreshToken) {
    if (!supabase)
        throw new Error("Supabase 未配置");
    const token_hash = sha256(refreshToken);
    const { error } = await supabase
        .from("refresh_tokens")
        .update({ revoked_at: nowIso() })
        .eq("token_hash", token_hash);
    if (error)
        throw error;
}
const REVOKE_GRACE_PERIOD_MS = 60_000;
export async function verifyAndRotateRefreshToken(refreshToken) {
    requireSecrets();
    if (!supabase)
        throw new Error("Supabase 未配置");
    const payload = jwt.verify(refreshToken, JWT_REFRESH_SECRET);
    if (payload.typ !== "refresh" || !payload.sub)
        throw new Error("refresh token 无效");
    const token_hash = sha256(refreshToken);
    const { data: row, error } = await supabase
        .from("refresh_tokens")
        .select("id, user_id, expires_at, revoked_at")
        .eq("token_hash", token_hash)
        .maybeSingle();
    if (error)
        throw error;
    if (!row)
        throw new Error("refresh token 不存在");
    const revokedAt = row.revoked_at;
    if (revokedAt) {
        const revokedMs = new Date(revokedAt).getTime();
        if (Date.now() - revokedMs > REVOKE_GRACE_PERIOD_MS) {
            throw new Error("refresh token 已吊销");
        }
    }
    if (new Date(String(row.expires_at)).getTime() < Date.now())
        throw new Error("refresh token 已过期");
    if (!revokedAt) {
        const revokeErr = await supabase
            .from("refresh_tokens")
            .update({ revoked_at: nowIso() })
            .eq("id", String(row.id));
        if (revokeErr.error)
            throw revokeErr.error;
    }
    const { data: userRow, error: userErr } = await supabase
        .from("users")
        .select("id, username, email")
        .eq("id", String(row.user_id))
        .single();
    if (userErr)
        throw userErr;
    const user = userRow;
    const access = signAccessToken(user);
    const refresh = signRefreshToken(user);
    await persistRefreshToken(user.id, refresh.token, refresh.expires_at);
    return {
        user,
        newRefreshToken: refresh.token,
        newRefreshExpiresAt: refresh.expires_at,
        accessToken: access.token,
        accessExpiresIn: access.expires_in,
    };
}
