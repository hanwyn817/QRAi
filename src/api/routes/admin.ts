import { Hono } from "hono";
import { requireAdmin, hashPassword } from "../auth";
import { nowIso, readR2Text } from "../utils";
import { getUserQuotaSnapshot, resetUserQuotaForPlan, setUserQuotaRemaining } from "../quota";
import {
    ensureDefaultModel,
    listAdminModels,
    normalizeModelCategory,
    normalizePlanTier,
    sanitizeBaseUrl,
    setDefaultModel,
    setModelAccess
} from "../models";
import { isValidHttpUrl, deleteProjectResources } from "../services/core";
import type { Env, ModelCategory, PlanTier, User } from "../types";

const app = new Hono<{ Bindings: Env; Variables: { user: User | null } }>();

app.get("/templates/export", requireAdmin, async (c) => {
    const rows = await c.env.DB.prepare(
        "SELECT id, name, description, file_key, created_at, updated_at FROM templates WHERE is_active = 1 ORDER BY updated_at DESC"
    ).all();
    const templates = [];
    for (const row of rows.results ?? []) {
        const content = row.file_key ? await readR2Text(c.env.BUCKET, row.file_key as string) : null;
        templates.push({
            name: row.name as string,
            description: (row.description as string | null) ?? null,
            content: content ?? "",
            created_at: row.created_at as string,
            updated_at: row.updated_at as string
        });
    }
    return c.json({ templates });
});

app.post("/templates/import", requireAdmin, async (c) => {
    const body = await c.req.json().catch(() => null);
    const rawTemplates = Array.isArray(body?.templates) ? (body.templates as unknown[]) : null;
    if (!rawTemplates) {
        return c.json({ error: "导入数据格式不正确" }, 400);
    }
    const normalized: Array<{ name: string; description: string | null; content: string }> = [];
    for (const item of rawTemplates) {
        if (!item || typeof item !== "object") {
            return c.json({ error: "导入数据包含无效模板记录" }, 400);
        }
        const record = item as Record<string, unknown>;
        const name = typeof record.name === "string" ? record.name.trim() : "";
        const descriptionRaw = typeof record.description === "string" ? record.description.trim() : null;
        const content = typeof record.content === "string" ? record.content : "";
        const description = descriptionRaw && descriptionRaw.length > 0 ? descriptionRaw : null;
        if (!name) {
            return c.json({ error: "模板名称不能为空" }, 400);
        }
        normalized.push({ name, description, content });
    }

    const now = nowIso();
    for (const template of normalized) {
        const id = crypto.randomUUID();
        const fileKey = `templates/${id}.md`;
        await c.env.BUCKET.put(fileKey, template.content, {
            httpMetadata: { contentType: "text/markdown; charset=utf-8" }
        });
        await c.env.DB.prepare(
            "INSERT INTO templates (id, name, description, file_key, created_by, created_at, updated_at, is_active) VALUES (?, ?, ?, ?, ?, ?, ?, 1)"
        )
            .bind(id, template.name, template.description, fileKey, c.get("user")?.id, now, now)
            .run();
    }

    return c.json({ count: normalized.length });
});

app.get("/models", requireAdmin, async (c) => {
    const models = await listAdminModels(c.env);
    return c.json({ models });
});

app.get("/models/export", requireAdmin, async (c) => {
    const rows = await c.env.DB.prepare(
        "SELECT id, name, category, model_name, base_url, api_key, is_default, is_active, created_at, updated_at FROM models ORDER BY updated_at DESC"
    ).all();
    const accessRows = await c.env.DB.prepare(
        "SELECT model_id, plan FROM model_access"
    ).all();
    const accessMap = new Map<string, PlanTier[]>();
    (accessRows.results ?? []).forEach((row) => {
        const modelId = row.model_id as string;
        const plan = row.plan as PlanTier;
        const list = accessMap.get(modelId) ?? [];
        list.push(plan);
        accessMap.set(modelId, list);
    });
    const models = (rows.results ?? []).map((row) => ({
        name: row.name as string,
        category: row.category as ModelCategory,
        model_name: row.model_name as string,
        base_url: row.base_url as string,
        api_key: row.api_key as string,
        is_default: row.is_default === 1,
        is_active: row.is_active === 1,
        allowed_plans: accessMap.get(row.id as string) ?? [],
        created_at: row.created_at as string,
        updated_at: row.updated_at as string
    }));
    return c.json({ models });
});

app.post("/models/import", requireAdmin, async (c) => {
    const body = await c.req.json().catch(() => null);
    const rawModels = Array.isArray(body?.models) ? (body.models as unknown[]) : null;
    if (!rawModels) {
        return c.json({ error: "导入数据格式不正确" }, 400);
    }
    const normalized: Array<{
        name: string;
        category: ModelCategory;
        modelName: string;
        baseUrl: string;
        apiKey: string;
        isDefault: boolean;
        isActive: boolean;
        allowedPlans: PlanTier[];
    }> = [];
    for (const item of rawModels) {
        if (!item || typeof item !== "object") {
            return c.json({ error: "导入数据包含无效模型记录" }, 400);
        }
        const record = item as Record<string, unknown>;
        const name = typeof record.name === "string" ? record.name.trim() : "";
        const modelName = typeof record.model_name === "string"
            ? (record.model_name as string).trim()
            : typeof record.modelName === "string"
                ? (record.modelName as string).trim()
                : "";
        const baseUrlRaw = typeof record.base_url === "string"
            ? (record.base_url as string).trim()
            : typeof record.baseUrl === "string"
                ? (record.baseUrl as string).trim()
                : "";
        const apiKey = typeof record.api_key === "string"
            ? (record.api_key as string).trim()
            : typeof record.apiKey === "string"
                ? (record.apiKey as string).trim()
                : "";
        const category = normalizeModelCategory(record.category);
        const isDefault = record.is_default === true || record.isDefault === true;
        const isActive = record.is_active === false || record.isActive === false ? false : true;
        const allowedPlansRaw = Array.isArray(record.allowed_plans)
            ? record.allowed_plans
            : Array.isArray(record.allowedPlans)
                ? record.allowedPlans
                : null;
        const allowedPlans: PlanTier[] = allowedPlansRaw
            ? Array.from(
                new Set(
                    (allowedPlansRaw as unknown[])
                        .map((plan: unknown) => normalizePlanTier(plan))
                        .filter((plan): plan is PlanTier => Boolean(plan))
                )
            )
            : ["free"];

        if (!name || !modelName || !baseUrlRaw || !apiKey || !category) {
            return c.json({ error: "模型名称、类别、标识、Base URL 与 API Key 不能为空" }, 400);
        }
        const baseUrl = sanitizeBaseUrl(baseUrlRaw);
        if (!isValidHttpUrl(baseUrl)) {
            return c.json({ error: "Base URL 必须以 http 或 https 开头" }, 400);
        }

        normalized.push({
            name,
            category,
            modelName,
            baseUrl,
            apiKey,
            isDefault,
            isActive,
            allowedPlans: allowedPlans.length > 0 ? allowedPlans : ["free"]
        });
    }

    const now = nowIso();
    const touchedCategories = new Set<ModelCategory>();
    for (const model of normalized) {
        const id = crypto.randomUUID();
        await c.env.DB.prepare(
            "INSERT INTO models (id, name, category, model_name, base_url, api_key, is_default, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
        )
            .bind(
                id,
                model.name,
                model.category,
                model.modelName,
                model.baseUrl,
                model.apiKey,
                model.isDefault && model.isActive ? 1 : 0,
                model.isActive ? 1 : 0,
                now,
                now
            )
            .run();
        await setModelAccess(c.env, id, model.allowedPlans);
        if (model.isDefault && model.isActive) {
            await setDefaultModel(c.env, model.category, id);
        }
        touchedCategories.add(model.category);
    }

    for (const category of touchedCategories) {
        await ensureDefaultModel(c.env, category);
    }

    return c.json({ count: normalized.length });
});

app.post("/models", requireAdmin, async (c) => {
    const body = await c.req.json().catch(() => null);
    const name = typeof body?.name === "string" ? body.name.trim() : "";
    const modelName = typeof body?.modelName === "string" ? body.modelName.trim() : "";
    const baseUrlRaw = typeof body?.baseUrl === "string" ? body.baseUrl.trim() : "";
    const apiKey = typeof body?.apiKey === "string" ? body.apiKey.trim() : "";
    const category = normalizeModelCategory(body?.category);
    const isDefault = body?.isDefault === true;
    const allowedPlansRaw = Array.isArray(body?.allowedPlans) ? (body.allowedPlans as unknown[]) : null;
    const allowedPlans: PlanTier[] = allowedPlansRaw
        ? Array.from(
            new Set(
                allowedPlansRaw
                    .map((plan: unknown) => normalizePlanTier(plan))
                    .filter((plan): plan is PlanTier => Boolean(plan))
            )
        )
        : ["free"];

    if (!name || !modelName || !baseUrlRaw || !apiKey || !category) {
        return c.json({ error: "模型名称、类别、Base URL 与 API Key 不能为空" }, 400);
    }
    const baseUrl = sanitizeBaseUrl(baseUrlRaw);
    if (!isValidHttpUrl(baseUrl)) {
        return c.json({ error: "Base URL 必须以 http 或 https 开头" }, 400);
    }

    const id = crypto.randomUUID();
    const now = nowIso();
    await c.env.DB.prepare(
        "INSERT INTO models (id, name, category, model_name, base_url, api_key, is_default, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)"
    )
        .bind(id, name, category, modelName, baseUrl, apiKey, isDefault ? 1 : 0, now, now)
        .run();

    await setModelAccess(c.env, id, allowedPlans.length > 0 ? allowedPlans : ["free"]);

    if (isDefault) {
        await setDefaultModel(c.env, category, id);
    } else {
        await ensureDefaultModel(c.env, category);
    }

    return c.json({ id, name, category, model_name: modelName, base_url: baseUrl, is_default: isDefault });
});

app.patch("/models/:id", requireAdmin, async (c) => {
    const modelId = c.req.param("id");
    const existing = await c.env.DB.prepare(
        "SELECT id, category, is_default FROM models WHERE id = ?"
    )
        .bind(modelId)
        .first();
    if (!existing) {
        return c.json({ error: "模型不存在" }, 404);
    }

    const body = await c.req.json().catch(() => null);
    const name = typeof body?.name === "string" ? body.name.trim() : null;
    const modelName = typeof body?.modelName === "string" ? body.modelName.trim() : null;
    const baseUrlRaw = typeof body?.baseUrl === "string" ? body.baseUrl.trim() : null;
    const apiKeyRaw = typeof body?.apiKey === "string" ? body.apiKey.trim() : null;
    const category = body?.category ? normalizeModelCategory(body.category) : null;
    const isDefault = typeof body?.isDefault === "boolean" ? body.isDefault : null;
    const allowedPlansRaw = Array.isArray(body?.allowedPlans) ? (body.allowedPlans as unknown[]) : null;
    const allowedPlans: PlanTier[] | null = allowedPlansRaw
        ? Array.from(
            new Set(
                allowedPlansRaw
                    .map((plan: unknown) => normalizePlanTier(plan))
                    .filter((plan): plan is PlanTier => Boolean(plan))
            )
        )
        : null;

    if (body?.name !== undefined && !name) {
        return c.json({ error: "模型名称不能为空" }, 400);
    }
    if (body?.modelName !== undefined && !modelName) {
        return c.json({ error: "模型标识不能为空" }, 400);
    }
    let baseUrl: string | null = null;
    if (body?.baseUrl !== undefined) {
        if (!baseUrlRaw) {
            return c.json({ error: "Base URL 不能为空" }, 400);
        }
        baseUrl = sanitizeBaseUrl(baseUrlRaw);
        if (!isValidHttpUrl(baseUrl)) {
            return c.json({ error: "Base URL 必须以 http 或 https 开头" }, 400);
        }
    }

    if (body?.category !== undefined && !category) {
        return c.json({ error: "模型类别不合法" }, 400);
    }

    const apiKey = apiKeyRaw && apiKeyRaw.trim() ? apiKeyRaw.trim() : null;
    const previousCategory = existing.category as ModelCategory;
    const nextCategory = category ?? previousCategory;
    const wasDefault = existing.is_default === 1;
    const categoryChanged = nextCategory !== previousCategory;
    const nextIsDefault = typeof isDefault === "boolean" ? isDefault : categoryChanged ? false : null;

    await c.env.DB.prepare(
        "UPDATE models SET name = COALESCE(?, name), category = COALESCE(?, category), model_name = COALESCE(?, model_name), base_url = COALESCE(?, base_url), api_key = COALESCE(?, api_key), is_default = COALESCE(?, is_default), updated_at = ? WHERE id = ?"
    )
        .bind(
            name,
            category,
            modelName,
            baseUrl,
            apiKey,
            nextIsDefault === null ? null : nextIsDefault ? 1 : 0,
            nowIso(),
            modelId
        )
        .run();

    if (allowedPlans) {
        await setModelAccess(c.env, modelId, allowedPlans.length > 0 ? allowedPlans : ["free"]);
    }

    if (nextIsDefault) {
        await setDefaultModel(c.env, nextCategory, modelId);
    } else {
        await ensureDefaultModel(c.env, nextCategory);
    }
    if (categoryChanged || (wasDefault && nextIsDefault === false)) {
        await ensureDefaultModel(c.env, previousCategory, modelId);
    }

    return c.json({ ok: true });
});

app.delete("/models/:id", requireAdmin, async (c) => {
    const modelId = c.req.param("id");
    const existing = await c.env.DB.prepare(
        "SELECT id, category, is_default FROM models WHERE id = ? AND is_active = 1"
    )
        .bind(modelId)
        .first();
    if (!existing) {
        return c.json({ error: "模型不存在" }, 404);
    }

    await c.env.DB.prepare("UPDATE models SET is_active = 0, is_default = 0, updated_at = ? WHERE id = ?")
        .bind(nowIso(), modelId)
        .run();

    const category = existing.category as ModelCategory;
    if (existing.is_default === 1) {
        await ensureDefaultModel(c.env, category, modelId);
    }

    return c.json({ ok: true });
});

app.post("/templates", requireAdmin, async (c) => {
    const form = await c.req.formData();
    const file = form.get("file");
    const name = typeof form.get("name") === "string" ? (form.get("name") as string).trim() : "";
    const description = typeof form.get("description") === "string" ? (form.get("description") as string).trim() : null;

    if (!file || !(file instanceof File) || !name) {
        return c.json({ error: "模板名称或文件不能为空" }, 400);
    }

    const id = crypto.randomUUID();
    const fileKey = `templates/${id}.md`;
    const fileBuffer = await file.arrayBuffer();

    await c.env.BUCKET.put(fileKey, fileBuffer, {
        httpMetadata: { contentType: "text/markdown; charset=utf-8" }
    });

    await c.env.DB.prepare(
        "INSERT INTO templates (id, name, description, file_key, created_by, created_at, updated_at, is_active) VALUES (?, ?, ?, ?, ?, ?, ?, 1)"
    )
        .bind(id, name, description, fileKey, c.get("user")?.id, nowIso(), nowIso())
        .run();

    return c.json({ id, name, description });
});

app.delete("/templates/:id", requireAdmin, async (c) => {
    const templateId = c.req.param("id");
    const template = await c.env.DB.prepare(
        "SELECT id, file_key, is_active FROM templates WHERE id = ?"
    )
        .bind(templateId)
        .first();
    if (!template || template.is_active !== 1) {
        return c.json({ error: "模板不存在" }, 404);
    }
    if (template.file_key) {
        await c.env.BUCKET.delete(template.file_key as string);
    }
    await c.env.DB.prepare("UPDATE templates SET is_active = 0, updated_at = ? WHERE id = ?")
        .bind(nowIso(), templateId)
        .run();
    return c.json({ ok: true });
});

app.patch("/templates/:id", requireAdmin, async (c) => {
    const templateId = c.req.param("id");
    const template = await c.env.DB.prepare(
        "SELECT id, name, description, file_key, is_active FROM templates WHERE id = ?"
    )
        .bind(templateId)
        .first();
    if (!template || template.is_active !== 1) {
        return c.json({ error: "模板不存在" }, 404);
    }

    const body = await c.req.json().catch(() => null);
    const name = typeof body?.name === "string" ? body.name.trim() : null;
    const descriptionRaw = typeof body?.description === "string" ? body.description.trim() : null;
    const description = descriptionRaw === "" ? null : descriptionRaw;
    const content = typeof body?.content === "string" ? body.content : null;

    if (body?.name !== undefined && !name) {
        return c.json({ error: "模板名称不能为空" }, 400);
    }

    if (content !== null && template.file_key) {
        await c.env.BUCKET.put(template.file_key as string, content, {
            httpMetadata: { contentType: "text/markdown; charset=utf-8" }
        });
    }

    await c.env.DB.prepare(
        "UPDATE templates SET name = COALESCE(?, name), description = COALESCE(?, description), updated_at = ? WHERE id = ?"
    )
        .bind(name, description, nowIso(), templateId)
        .run();

    return c.json({ ok: true });
});

app.post("/templates/:id/duplicate", requireAdmin, async (c) => {
    const templateId = c.req.param("id");
    const template = await c.env.DB.prepare(
        "SELECT id, name, description, file_key, is_active FROM templates WHERE id = ?"
    )
        .bind(templateId)
        .first();
    if (!template || template.is_active !== 1) {
        return c.json({ error: "模板不存在" }, 404);
    }
    const content = template.file_key
        ? await readR2Text(c.env.BUCKET, template.file_key as string)
        : null;

    const id = crypto.randomUUID();
    const fileKey = `templates/${id}.md`;
    const baseName = typeof template.name === "string" ? template.name.trim() : "模板";
    const duplicateName = baseName.endsWith("副本") ? `${baseName} 2` : `${baseName} 副本`;

    await c.env.BUCKET.put(fileKey, content ?? "", {
        httpMetadata: { contentType: "text/markdown; charset=utf-8" }
    });

    const now = nowIso();
    await c.env.DB.prepare(
        "INSERT INTO templates (id, name, description, file_key, created_by, created_at, updated_at, is_active) VALUES (?, ?, ?, ?, ?, ?, ?, 1)"
    )
        .bind(id, duplicateName, template.description ?? null, fileKey, c.get("user")?.id, now, now)
        .run();

    return c.json({ id, name: duplicateName });
});

app.get("/users", requireAdmin, async (c) => {
    const rows = await c.env.DB.prepare(
        "SELECT u.id, u.email, u.role, u.plan, u.created_at, " +
        "(SELECT COUNT(1) FROM projects p WHERE p.owner_id = u.id) as project_count " +
        "FROM users u ORDER BY u.created_at DESC"
    ).all();
    const users = [];
    for (const row of rows.results ?? []) {
        const plan = normalizePlanTier(row.plan) ?? "free";
        const quota = await getUserQuotaSnapshot(c.env, row.id as string, plan);
        users.push({
            ...row,
            plan,
            quota_remaining: quota.remaining,
            quota_cycle_end: quota.cycleEnd,
            quota_is_unlimited: quota.isUnlimited
        });
    }
    return c.json({ users });
});

app.post("/users", requireAdmin, async (c) => {
    const body = await c.req.json().catch(() => null);
    const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
    const password = typeof body?.password === "string" ? body.password : "";
    const plan = normalizePlanTier(body?.plan) ?? "free";

    if (!email || !password || password.length < 6) {
        return c.json({ error: "邮箱或密码不合法" }, 400);
    }

    const existing = await c.env.DB.prepare("SELECT id FROM users WHERE email = ?").bind(email).first();
    if (existing) {
        return c.json({ error: "邮箱已注册" }, 409);
    }

    const { hash, salt } = await hashPassword(password);
    const userId = crypto.randomUUID();
    const createdAt = nowIso();
    await c.env.DB.prepare(
        "INSERT INTO users (id, email, password_hash, password_salt, role, plan, created_at) VALUES (?, ?, ?, ?, 'user', ?, ?)"
    )
        .bind(userId, email, hash, salt, plan, createdAt)
        .run();
    await resetUserQuotaForPlan(c.env, userId, plan, plan === "free" ? createdAt : undefined);

    return c.json({ id: userId, email, role: "user", plan });
});

app.patch("/users/:id", requireAdmin, async (c) => {
    const userId = c.req.param("id");
    const body = await c.req.json().catch(() => null);
    const plan = normalizePlanTier(body?.plan);
    if (!plan) {
        return c.json({ error: "用户等级不合法" }, 400);
    }
    const row = await c.env.DB.prepare("SELECT id, plan, created_at FROM users WHERE id = ?").bind(userId).first();
    if (!row) {
        return c.json({ error: "用户不存在" }, 404);
    }
    const previousPlan = normalizePlanTier(row.plan) ?? "free";
    await c.env.DB.prepare("UPDATE users SET plan = ? WHERE id = ?").bind(plan, userId).run();
    if (plan !== previousPlan) {
        const createdAt = typeof row.created_at === "string" ? row.created_at : undefined;
        const anchor = plan === "free" ? createdAt : undefined;
        await resetUserQuotaForPlan(c.env, userId, plan, anchor);
    }
    return c.json({ ok: true });
});

app.patch("/users/:id/quota", requireAdmin, async (c) => {
    const userId = c.req.param("id");
    const body = await c.req.json().catch(() => null);
    const remaining = Number(body?.remaining);
    if (!Number.isFinite(remaining) || remaining < 0 || !Number.isInteger(remaining)) {
        return c.json({ error: "剩余次数必须为非负整数" }, 400);
    }
    const row = await c.env.DB.prepare("SELECT id, plan FROM users WHERE id = ?").bind(userId).first();
    if (!row) {
        return c.json({ error: "用户不存在" }, 404);
    }
    const plan = normalizePlanTier(row.plan) ?? "free";
    if (plan === "max") {
        return c.json({ error: "Max 用户不可设置次数" }, 400);
    }
    const result = await setUserQuotaRemaining(c.env, userId, plan, remaining);
    if (!result.ok) {
        return c.json({ error: "Max 用户不可设置次数" }, 400);
    }
    return c.json({ ok: true, quota: result.snapshot });
});

app.delete("/users/:id", requireAdmin, async (c) => {
    const userId = c.req.param("id");
    const row = await c.env.DB.prepare("SELECT id FROM users WHERE id = ?").bind(userId).first();
    if (!row) {
        return c.json({ error: "用户不存在" }, 404);
    }

    const projects = await c.env.DB.prepare("SELECT id FROM projects WHERE owner_id = ?")
        .bind(userId)
        .all();
    for (const project of projects.results ?? []) {
        if (project.id) {
            await deleteProjectResources(c.env, project.id as string);
        }
    }

    await c.env.DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(userId).run();
    await c.env.DB.prepare("DELETE FROM user_quotas WHERE user_id = ?").bind(userId).run();
    await c.env.DB.prepare("DELETE FROM users WHERE id = ?").bind(userId).run();
    return c.json({ ok: true });
});

export default app;
