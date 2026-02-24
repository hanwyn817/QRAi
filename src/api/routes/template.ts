import { Hono } from "hono";
import { requireAuth } from "../auth";
import { readR2Text } from "../utils";
import type { Env, User } from "../types";

const app = new Hono<{ Bindings: Env; Variables: { user: User | null } }>();

app.get("/", requireAuth, async (c) => {
    const rows = await c.env.DB.prepare(
        "SELECT id, name, description, created_at, updated_at FROM templates WHERE is_active = 1 ORDER BY updated_at DESC"
    ).all();
    return c.json({ templates: rows.results ?? [] });
});

app.get("/:id", requireAuth, async (c) => {
    const templateId = c.req.param("id");
    const template = await c.env.DB.prepare(
        "SELECT id, name, description, file_key FROM templates WHERE id = ? AND is_active = 1"
    )
        .bind(templateId)
        .first();
    if (!template) {
        return c.json({ error: "模板不存在" }, 404);
    }
    const content = await readR2Text(c.env.BUCKET, template.file_key as string);
    return c.json({
        id: template.id,
        name: template.name,
        description: template.description,
        content: content ?? ""
    });
});

export default app;
