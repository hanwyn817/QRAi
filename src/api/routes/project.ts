import { Hono } from "hono";
import { requireAuth } from "../auth";
import { nowIso, putR2Text, readR2Text } from "../utils";
import {
    deleteProjectResources,
    normalizeProcessSteps,
    parseProcessStepsFromDb,
    ALLOWED_EVAL_TOOLS,
    resolveUserPlan,
} from "../services/core";
import { fetchModelByIdForPlan } from "../models";
import type { Env, User } from "../types";

const app = new Hono<{ Bindings: Env; Variables: { user: User | null } }>();

app.post("/", requireAuth, async (c) => {
    const body = await c.req.json().catch(() => null);
    const title = typeof body?.title === "string" ? body.title.trim() : "";
    if (!title) {
        return c.json({ error: "标题不能为空" }, 400);
    }
    const id = crypto.randomUUID();
    const now = nowIso();
    await c.env.DB.prepare(
        "INSERT INTO projects (id, title, status, owner_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)"
    )
        .bind(id, title, "draft", c.get("user")?.id, now, now)
        .run();
    await c.env.DB.prepare("INSERT INTO project_inputs (project_id, updated_at) VALUES (?, ?)").bind(id, now).run();
    return c.json({ id, title, status: "draft" });
});

app.get("/", requireAuth, async (c) => {
    const rows = await c.env.DB.prepare(
        "SELECT id, title, status, created_at, updated_at, " +
        "(SELECT COUNT(1) FROM reports r WHERE r.project_id = projects.id) as report_count, " +
        "(SELECT MAX(created_at) FROM reports r WHERE r.project_id = projects.id AND r.status = 'completed') as latest_completed_at " +
        "FROM projects WHERE owner_id = ? ORDER BY updated_at DESC"
    )
        .bind(c.get("user")?.id)
        .all();
    return c.json({ projects: rows.results ?? [] });
});

app.get("/:id", requireAuth, async (c) => {
    const projectId = c.req.param("id");
    const project = await c.env.DB.prepare(
        "SELECT id, title, status, created_at, updated_at FROM projects WHERE id = ? AND owner_id = ?"
    )
        .bind(projectId, c.get("user")?.id)
        .first();
    if (!project) {
        return c.json({ error: "项目不存在" }, 404);
    }

    const inputs = await c.env.DB.prepare(
        "SELECT scope, background, objective, risk_method, eval_tool, process_steps, template_id, text_model_id, updated_at FROM project_inputs WHERE project_id = ?"
    )
        .bind(projectId)
        .first();

    const files = await c.env.DB.prepare(
        "SELECT id, type, filename, status, created_at FROM project_files WHERE project_id = ? ORDER BY created_at DESC"
    )
        .bind(projectId)
        .all();

    const reports = await c.env.DB.prepare(
        "SELECT id, version, status, created_at, prompt_tokens, completion_tokens, total_tokens, model_name FROM reports WHERE project_id = ? ORDER BY version DESC"
    )
        .bind(projectId)
        .all();

    const normalizedInputs = inputs
        ? { ...inputs, process_steps: parseProcessStepsFromDb((inputs as any).process_steps) }
        : inputs;

    return c.json({ project, inputs: normalizedInputs, files: files.results ?? [], reports: reports.results ?? [] });
});

app.delete("/:id", requireAuth, async (c) => {
    const projectId = c.req.param("id");
    const project = await c.env.DB.prepare("SELECT id FROM projects WHERE id = ? AND owner_id = ?")
        .bind(projectId, c.get("user")?.id)
        .first();
    if (!project) {
        return c.json({ error: "项目不存在" }, 404);
    }

    await deleteProjectResources(c.env, projectId);

    return c.json({ ok: true });
});

app.patch("/:id/inputs", requireAuth, async (c) => {
    const projectId = c.req.param("id");
    const project = await c.env.DB.prepare("SELECT id FROM projects WHERE id = ? AND owner_id = ?")
        .bind(projectId, c.get("user")?.id)
        .first();
    if (!project) {
        return c.json({ error: "项目不存在" }, 404);
    }

    const user = c.get("user");
    const plan = resolveUserPlan(user);

    const body = await c.req.json().catch(() => null);
    const scope = typeof body?.scope === "string" ? body.scope.trim() : null;
    const background = typeof body?.background === "string" ? body.background.trim() : null;
    const objective = typeof body?.objective === "string" ? body.objective.trim() : null;
    const riskMethod = typeof body?.riskMethod === "string" ? body.riskMethod.trim() : null;
    const evalTool = typeof body?.evalTool === "string" ? body.evalTool.trim() : null;
    const hasProcessSteps = Object.prototype.hasOwnProperty.call(body ?? {}, "processSteps");
    const processStepsRaw = hasProcessSteps ? body?.processSteps : null;
    const templateId = typeof body?.templateId === "string" ? body.templateId.trim() : null;
    const hasTextModelId = Object.prototype.hasOwnProperty.call(body ?? {}, "textModelId");
    const textModelIdRaw = hasTextModelId ? body?.textModelId : null;
    let textModelId = typeof textModelIdRaw === "string" ? textModelIdRaw.trim() : null;
    if (textModelId === "") {
        textModelId = null;
    }

    if (evalTool && !ALLOWED_EVAL_TOOLS.has(evalTool)) {
        return c.json({ error: "评估工具暂未开放" }, 400);
    }
    if (hasProcessSteps && !Array.isArray(processStepsRaw)) {
        return c.json({ error: "流程步骤格式不正确" }, 400);
    }
    if (hasTextModelId && textModelId) {
        const model = await fetchModelByIdForPlan(c.env, textModelId, plan, "text");
        if (!model) {
            return c.json({ error: "选择的模型不存在或不可用" }, 400);
        }
    }
    const processSteps = hasProcessSteps ? normalizeProcessSteps(processStepsRaw) : null;
    const processStepsJson = hasProcessSteps ? JSON.stringify(processSteps ?? []) : null;

    await c.env.DB.prepare(
        `UPDATE project_inputs SET scope = COALESCE(?, scope), background = COALESCE(?, background), objective = COALESCE(?, objective), risk_method = COALESCE(?, risk_method), eval_tool = COALESCE(?, eval_tool), process_steps = COALESCE(?, process_steps), template_id = COALESCE(?, template_id), text_model_id = COALESCE(?, text_model_id), updated_at = ? WHERE project_id = ?`
    )
        .bind(
            scope,
            background,
            objective,
            riskMethod,
            evalTool,
            processStepsJson,
            templateId,
            hasTextModelId ? textModelId : null,
            nowIso(),
            projectId
        )
        .run();

    await c.env.DB.prepare("UPDATE projects SET updated_at = ? WHERE id = ?").bind(nowIso(), projectId).run();

    return c.json({ ok: true });
});

app.post("/:id/files", requireAuth, async (c) => {
    const projectId = c.req.param("id");
    const project = await c.env.DB.prepare("SELECT id FROM projects WHERE id = ? AND owner_id = ?")
        .bind(projectId, c.get("user")?.id)
        .first();
    if (!project) {
        return c.json({ error: "项目不存在" }, 404);
    }

    const form = await c.req.formData();
    const file = form.get("file");
    const type = typeof form.get("type") === "string" ? (form.get("type") as string).trim() : "";
    const extractedText = typeof form.get("extractedText") === "string" ? (form.get("extractedText") as string).trim() : "";

    if (!file || !(file instanceof File) || !type) {
        return c.json({ error: "文件或类型不能为空" }, 400);
    }
    if (!['sop', 'literature'].includes(type)) {
        return c.json({ error: "文件类型不支持" }, 400);
    }

    const id = crypto.randomUUID();
    const fileKey = `projects/${projectId}/files/${id}-${file.name}`;
    await c.env.BUCKET.put(fileKey, await file.arrayBuffer(), {
        httpMetadata: { contentType: file.type || "application/octet-stream" }
    });

    let textKey: string | null = null;
    let status = "uploaded";
    if (extractedText) {
        textKey = `projects/${projectId}/texts/${id}.txt`;
        await putR2Text(c.env.BUCKET, textKey, extractedText);
        status = "parsed";
    }

    await c.env.DB.prepare(
        "INSERT INTO project_files (id, project_id, type, filename, file_key, text_key, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    )
        .bind(id, projectId, type, file.name, fileKey, textKey, status, nowIso())
        .run();

    return c.json({ id, filename: file.name, status });
});

app.delete("/:id/files/:fileId", requireAuth, async (c) => {
    const projectId = c.req.param("id");
    const fileId = c.req.param("fileId");
    const row = await c.env.DB.prepare(
        "SELECT pf.file_key as file_key, pf.text_key as text_key FROM project_files pf JOIN projects p ON pf.project_id = p.id WHERE pf.id = ? AND p.id = ? AND p.owner_id = ?"
    )
        .bind(fileId, projectId, c.get("user")?.id)
        .first();

    if (!row) {
        return c.json({ error: "文件不存在" }, 404);
    }

    const fileKey = row.file_key as string | null;
    const textKey = row.text_key as string | null;

    if (fileKey) {
        await c.env.BUCKET.delete(fileKey);
    }
    if (textKey) {
        await c.env.BUCKET.delete(textKey);
    }

    await c.env.DB.prepare("DELETE FROM project_files WHERE id = ?").bind(fileId).run();
    return c.json({ ok: true });
});

export default app;
