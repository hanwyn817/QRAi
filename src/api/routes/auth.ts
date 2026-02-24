import { Hono } from "hono";
import {
    clearSession,
    clearSessionCookie,
    createSession,
    hashPassword,
    requireAuth,
    setSessionCookie,
    verifyPassword
} from "../auth";
import { nowIso } from "../utils";
import { getUserQuotaSnapshot, resetUserQuotaForPlan } from "../quota";
import { normalizePlanTier } from "../models";
import { resolveUserPlan } from "../services/core";
import type { Env, User } from "../types";

const app = new Hono<{ Bindings: Env; Variables: { user: User | null } }>();

app.post("/register", async (c) => {
    const body = await c.req.json().catch(() => null);
    const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
    const password = typeof body?.password === "string" ? body.password : "";
    const adminKey = typeof body?.adminKey === "string" ? body.adminKey.trim() : "";

    if (!email || !password || password.length < 6) {
        return c.json({ error: "邮箱或密码不合法" }, 400);
    }

    const existing = await c.env.DB.prepare("SELECT id FROM users WHERE email = ?").bind(email).first();
    if (existing) {
        return c.json({ error: "邮箱已注册" }, 409);
    }

    const { hash, salt } = await hashPassword(password);
    const userId = crypto.randomUUID();
    const role = adminKey && c.env.ADMIN_BOOTSTRAP_KEY && adminKey === c.env.ADMIN_BOOTSTRAP_KEY ? "admin" : "user";
    const plan = "free";
    const createdAt = nowIso();
    await c.env.DB.prepare(
        "INSERT INTO users (id, email, password_hash, password_salt, role, plan, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
    )
        .bind(userId, email, hash, salt, role, plan, createdAt)
        .run();
    await resetUserQuotaForPlan(c.env, userId, plan, createdAt);

    const session = await createSession(c.env, userId);
    setSessionCookie(c, session.token, session.expiresAt, c.env);

    return c.json({ id: userId, email, role, plan });
});

app.post("/login", async (c) => {
    const body = await c.req.json().catch(() => null);
    const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
    const password = typeof body?.password === "string" ? body.password : "";

    if (!email || !password) {
        return c.json({ error: "邮箱或密码不能为空" }, 400);
    }

    const userRow = await c.env.DB.prepare(
        "SELECT id, email, role, plan, password_hash, password_salt FROM users WHERE email = ?"
    )
        .bind(email)
        .first();

    if (!userRow) {
        return c.json({ error: "邮箱或密码错误" }, 401);
    }

    const ok = await verifyPassword(
        password,
        userRow.password_hash as string,
        userRow.password_salt as string
    );
    if (!ok) {
        return c.json({ error: "邮箱或密码错误" }, 401);
    }

    const plan = normalizePlanTier(userRow.plan) ?? "free";
    const session = await createSession(c.env, userRow.id as string);
    setSessionCookie(c, session.token, session.expiresAt, c.env);
    return c.json({ id: userRow.id, email: userRow.email, role: userRow.role, plan });
});

app.post("/logout", async (c) => {
    await clearSession(c.env, c.req.raw);
    clearSessionCookie(c);
    return c.json({ ok: true });
});

app.get("/me", requireAuth, async (c) => {
    const user = c.get("user");
    if (!user) {
        return c.json({ user: null }, 401);
    }
    const plan = resolveUserPlan(user);
    const quota = await getUserQuotaSnapshot(c.env, user.id, plan);
    return c.json({ user: { ...user, plan }, quota });
});

export default app;
