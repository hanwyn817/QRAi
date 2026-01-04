import type { Context, MiddlewareHandler } from "hono";
import type { Env, User } from "./types";
import { normalizePlanTier } from "./plan";
import { daysFromNow, fromBase64, nowIso, parseCookies, randomToken, toBase64 } from "./utils";

const encoder = new TextEncoder();
const PASSWORD_ITERATIONS = 100_000;

export async function hashPassword(password: string): Promise<{ hash: string; salt: string }> {
  const saltBytes = new Uint8Array(16);
  crypto.getRandomValues(saltBytes);
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: saltBytes,
      iterations: PASSWORD_ITERATIONS,
      hash: "SHA-256"
    },
    key,
    256
  );
  return {
    hash: toBase64(new Uint8Array(bits)),
    salt: toBase64(saltBytes)
  };
}

export async function verifyPassword(password: string, hash: string, salt: string): Promise<boolean> {
  const saltBytes = fromBase64(salt);
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: saltBytes,
      iterations: PASSWORD_ITERATIONS,
      hash: "SHA-256"
    },
    key,
    256
  );
  const computed = toBase64(new Uint8Array(bits));
  return computed === hash;
}

export async function createSession(env: Env, userId: string): Promise<{ token: string; expiresAt: string }> {
  const token = randomToken(32);
  const expiresAt = daysFromNow(7);
  const sessionId = crypto.randomUUID();
  await env.DB.prepare(
    "INSERT INTO sessions (id, user_id, token, expires_at, created_at) VALUES (?, ?, ?, ?, ?)"
  ).bind(sessionId, userId, token, expiresAt, nowIso()).run();
  return { token, expiresAt };
}

export async function getUserFromSession(env: Env, request: Request): Promise<User | null> {
  const cookies = parseCookies(request.headers.get("Cookie"));
  const token = cookies["qr_session"];
  if (!token) {
    return null;
  }
  const session = await env.DB.prepare(
    "SELECT s.expires_at as expires_at, u.id as id, u.email as email, u.role as role, u.plan as plan FROM sessions s JOIN users u ON s.user_id = u.id WHERE s.token = ?"
  )
    .bind(token)
    .first();
  if (!session) {
    return null;
  }
  const expiresAt = new Date(session.expires_at as string).getTime();
  if (Number.isNaN(expiresAt) || expiresAt < Date.now()) {
    await env.DB.prepare("DELETE FROM sessions WHERE token = ?").bind(token).run();
    return null;
  }
  return {
    id: session.id as string,
    email: session.email as string,
    role: (session.role as "admin" | "user") ?? "user",
    plan: normalizePlanTier(session.plan) ?? "free"
  };
}

export function setSessionCookie(context: Context, token: string, expiresAt: string, env: Env): void {
  const cookieParts = [
    `qr_session=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Expires=${new Date(expiresAt).toUTCString()}`
  ];
  const envMode = env.APP_ENV?.toLowerCase();
  if (envMode !== "dev" && envMode !== "local") {
    cookieParts.push("Secure");
  }
  context.header("Set-Cookie", cookieParts.join("; "));
}

export const authMiddleware: MiddlewareHandler<{ Bindings: Env; Variables: { user: User | null } }> = async (c, next) => {
  const user = await getUserFromSession(c.env, c.req.raw);
  c.set("user", user);
  await next();
};

export const requireAuth: MiddlewareHandler<{ Bindings: Env; Variables: { user: User | null } }> = async (c, next) => {
  const user = c.get("user");
  if (!user) {
    return c.json({ error: "未登录或会话失效" }, 401);
  }
  await next();
};

export const requireAdmin: MiddlewareHandler<{ Bindings: Env; Variables: { user: User | null } }> = async (c, next) => {
  const user = c.get("user");
  if (!user) {
    return c.json({ error: "未登录或会话失效" }, 401);
  }
  if (user.role !== "admin") {
    return c.json({ error: "需要管理员权限" }, 403);
  }
  await next();
};

export async function clearSession(env: Env, request: Request): Promise<void> {
  const cookies = parseCookies(request.headers.get("Cookie"));
  const token = cookies["qr_session"];
  if (token) {
    await env.DB.prepare("DELETE FROM sessions WHERE token = ?").bind(token).run();
  }
}

export function clearSessionCookie(context: Context): void {
  context.header(
    "Set-Cookie",
    "qr_session=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; SameSite=Lax"
  );
}
