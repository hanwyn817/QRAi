import { Hono } from "hono";
import { authMiddleware, clearSession, clearSessionCookie, createSession, hashPassword, requireAdmin, requireAuth, setSessionCookie, verifyPassword } from "./auth";
import type { Env, User } from "./types";
import { nowIso, putR2Json, putR2Text, readR2Text, safeJsonParse } from "./utils";
import { generateReport, generateReportStream } from "./ai";
import { renderDocx } from "./exporters";

const app = new Hono<{ Bindings: Env; Variables: { user: User | null } }>();
const ALLOWED_EVAL_TOOLS = new Set(["FMEA"]);

const normalizeEvalTool = (value: string | null | undefined) => {
  return value && ALLOWED_EVAL_TOOLS.has(value) ? value : "FMEA";
};
const normalizeProcessSteps = (
  raw: unknown
): Array<{ step_id: string; step_name: string }> | null => {
  if (!Array.isArray(raw)) {
    return null;
  }
  const items = raw
    .map((item, index) => {
      if (!item || typeof item !== "object") {
        return null;
      }
      const record = item as Record<string, unknown>;
      const stepName = typeof record.step_name === "string" ? record.step_name.trim() : "";
      if (!stepName) {
        return null;
      }
      const stepId = typeof record.step_id === "string" ? record.step_id.trim() : "";
      return { step_id: stepId || `step_${index + 1}`, step_name: stepName };
    })
    .filter((item): item is { step_id: string; step_name: string } => Boolean(item));
  return items;
};
const parseProcessStepsFromDb = (value: unknown) => {
  if (typeof value !== "string" || !value.trim()) {
    return undefined;
  }
  const parsed = safeJsonParse(value);
  const steps = normalizeProcessSteps(parsed);
  return steps && steps.length > 0 ? steps : [];
};

app.use("*", async (c, next) => {
  const originHeader = c.req.header("Origin");
  const allowedOrigins = c.env.APP_ORIGIN
    ? c.env.APP_ORIGIN.split(",").map((origin) => origin.trim()).filter(Boolean)
    : [];
  if (originHeader && allowedOrigins.includes(originHeader)) {
    c.header("Access-Control-Allow-Origin", originHeader);
    c.header("Access-Control-Allow-Credentials", "true");
    c.header("Vary", "Origin");
  }
  c.header("Access-Control-Allow-Methods", "GET,POST,PATCH,DELETE,OPTIONS");
  c.header("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (c.req.method === "OPTIONS") {
    return c.body(null, 204);
  }
  await next();
});

app.use("*", authMiddleware);

app.get("/api/health", (c) => c.json({ ok: true }));

app.post("/api/auth/register", async (c) => {
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
  await c.env.DB.prepare(
    "INSERT INTO users (id, email, password_hash, password_salt, role, created_at) VALUES (?, ?, ?, ?, ?, ?)"
  )
    .bind(userId, email, hash, salt, role, nowIso())
    .run();

  const session = await createSession(c.env, userId);
  setSessionCookie(c, session.token, session.expiresAt, c.env);

  return c.json({ id: userId, email, role });
});

app.post("/api/auth/login", async (c) => {
  const body = await c.req.json().catch(() => null);
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body?.password === "string" ? body.password : "";

  if (!email || !password) {
    return c.json({ error: "邮箱或密码不能为空" }, 400);
  }

  const userRow = await c.env.DB.prepare(
    "SELECT id, email, role, password_hash, password_salt FROM users WHERE email = ?"
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

  const session = await createSession(c.env, userRow.id as string);
  setSessionCookie(c, session.token, session.expiresAt, c.env);
  return c.json({ id: userRow.id, email: userRow.email, role: userRow.role });
});

app.post("/api/auth/logout", async (c) => {
  await clearSession(c.env, c.req.raw);
  clearSessionCookie(c);
  return c.json({ ok: true });
});

app.get("/api/me", requireAuth, (c) => {
  const user = c.get("user");
  return c.json({ user });
});

app.get("/api/templates", requireAuth, async (c) => {
  const rows = await c.env.DB.prepare(
    "SELECT id, name, description, created_at, updated_at FROM templates WHERE is_active = 1 ORDER BY updated_at DESC"
  ).all();
  return c.json({ templates: rows.results ?? [] });
});

app.get("/api/templates/:id", requireAuth, async (c) => {
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

app.post("/api/admin/templates", requireAdmin, async (c) => {
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

app.delete("/api/admin/templates/:id", requireAdmin, async (c) => {
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

app.post("/api/projects", requireAuth, async (c) => {
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

app.get("/api/projects", requireAuth, async (c) => {
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

app.get("/api/projects/:id", requireAuth, async (c) => {
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
    "SELECT scope, background, objective, risk_method, eval_tool, process_steps, template_id, updated_at FROM project_inputs WHERE project_id = ?"
  )
    .bind(projectId)
    .first();

  const files = await c.env.DB.prepare(
    "SELECT id, type, filename, status, created_at FROM project_files WHERE project_id = ? ORDER BY created_at DESC"
  )
    .bind(projectId)
    .all();

  const reports = await c.env.DB.prepare(
    "SELECT id, version, status, created_at, prompt_tokens, completion_tokens, total_tokens FROM reports WHERE project_id = ? ORDER BY version DESC"
  )
    .bind(projectId)
    .all();

  const normalizedInputs = inputs
    ? { ...inputs, process_steps: parseProcessStepsFromDb((inputs as any).process_steps) }
    : inputs;

  return c.json({ project, inputs: normalizedInputs, files: files.results ?? [], reports: reports.results ?? [] });
});

app.delete("/api/projects/:id", requireAuth, async (c) => {
  const projectId = c.req.param("id");
  const project = await c.env.DB.prepare("SELECT id FROM projects WHERE id = ? AND owner_id = ?")
    .bind(projectId, c.get("user")?.id)
    .first();
  if (!project) {
    return c.json({ error: "项目不存在" }, 404);
  }

  const fileRows = await c.env.DB.prepare(
    "SELECT file_key, text_key FROM project_files WHERE project_id = ?"
  )
    .bind(projectId)
    .all();
  const reportRows = await c.env.DB.prepare(
    "SELECT id, md_key, json_key, template_snapshot_key FROM reports WHERE project_id = ?"
  )
    .bind(projectId)
    .all();
  const exportRows = await c.env.DB.prepare(
    "SELECT re.file_key FROM report_exports re JOIN reports r ON re.report_id = r.id WHERE r.project_id = ?"
  )
    .bind(projectId)
    .all();

  const keysToDelete: string[] = [];
  for (const row of fileRows.results ?? []) {
    if (row.file_key) {
      keysToDelete.push(row.file_key as string);
    }
    if (row.text_key) {
      keysToDelete.push(row.text_key as string);
    }
  }
  for (const row of reportRows.results ?? []) {
    if (row.md_key) {
      keysToDelete.push(row.md_key as string);
    }
    if (row.json_key) {
      keysToDelete.push(row.json_key as string);
    }
    if (row.template_snapshot_key) {
      keysToDelete.push(row.template_snapshot_key as string);
    }
  }
  for (const row of exportRows.results ?? []) {
    if (row.file_key) {
      keysToDelete.push(row.file_key as string);
    }
  }

  for (const key of keysToDelete) {
    await c.env.BUCKET.delete(key);
  }

  await c.env.DB.prepare(
    "DELETE FROM report_exports WHERE report_id IN (SELECT id FROM reports WHERE project_id = ?)"
  )
    .bind(projectId)
    .run();
  await c.env.DB.prepare("DELETE FROM reports WHERE project_id = ?")
    .bind(projectId)
    .run();
  await c.env.DB.prepare("DELETE FROM project_files WHERE project_id = ?")
    .bind(projectId)
    .run();
  await c.env.DB.prepare("DELETE FROM project_inputs WHERE project_id = ?")
    .bind(projectId)
    .run();
  await c.env.DB.prepare("DELETE FROM projects WHERE id = ?")
    .bind(projectId)
    .run();

  return c.json({ ok: true });
});

app.patch("/api/projects/:id/inputs", requireAuth, async (c) => {
  const projectId = c.req.param("id");
  const project = await c.env.DB.prepare("SELECT id FROM projects WHERE id = ? AND owner_id = ?")
    .bind(projectId, c.get("user")?.id)
    .first();
  if (!project) {
    return c.json({ error: "项目不存在" }, 404);
  }

  const body = await c.req.json().catch(() => null);
  const scope = typeof body?.scope === "string" ? body.scope.trim() : null;
  const background = typeof body?.background === "string" ? body.background.trim() : null;
  const objective = typeof body?.objective === "string" ? body.objective.trim() : null;
  const riskMethod = typeof body?.riskMethod === "string" ? body.riskMethod.trim() : null;
  const evalTool = typeof body?.evalTool === "string" ? body.evalTool.trim() : null;
  const hasProcessSteps = Object.prototype.hasOwnProperty.call(body ?? {}, "processSteps");
  const processStepsRaw = hasProcessSteps ? body?.processSteps : null;
  const templateId = typeof body?.templateId === "string" ? body.templateId.trim() : null;

  if (evalTool && !ALLOWED_EVAL_TOOLS.has(evalTool)) {
    return c.json({ error: "评估工具暂未开放" }, 400);
  }
  if (hasProcessSteps && !Array.isArray(processStepsRaw)) {
    return c.json({ error: "流程步骤格式不正确" }, 400);
  }
  const processSteps = hasProcessSteps ? normalizeProcessSteps(processStepsRaw) : null;
  const processStepsJson = hasProcessSteps ? JSON.stringify(processSteps ?? []) : null;

  await c.env.DB.prepare(
    `UPDATE project_inputs SET scope = COALESCE(?, scope), background = COALESCE(?, background), objective = COALESCE(?, objective), risk_method = COALESCE(?, risk_method), eval_tool = COALESCE(?, eval_tool), process_steps = COALESCE(?, process_steps), template_id = COALESCE(?, template_id), updated_at = ? WHERE project_id = ?`
  )
    .bind(
      scope,
      background,
      objective,
      riskMethod,
      evalTool,
      processStepsJson,
      templateId,
      nowIso(),
      projectId
    )
    .run();

  await c.env.DB.prepare("UPDATE projects SET updated_at = ? WHERE id = ?").bind(nowIso(), projectId).run();

  return c.json({ ok: true });
});

app.post("/api/projects/:id/files", requireAuth, async (c) => {
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

app.delete("/api/projects/:id/files/:fileId", requireAuth, async (c) => {
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

app.post("/api/projects/:id/reports", requireAuth, async (c) => {
  const projectId = c.req.param("id");
  const project = await c.env.DB.prepare("SELECT id, title FROM projects WHERE id = ? AND owner_id = ?")
    .bind(projectId, c.get("user")?.id)
    .first();
  if (!project) {
    return c.json({ error: "项目不存在" }, 404);
  }

  const body = await c.req.json().catch(() => null);
  let templateContent = typeof body?.templateContent === "string" ? body.templateContent : null;

  const inputs = await c.env.DB.prepare(
    "SELECT scope, background, objective, risk_method, eval_tool, process_steps, template_id FROM project_inputs WHERE project_id = ?"
  )
    .bind(projectId)
    .first();

  const files = await c.env.DB.prepare(
    "SELECT type, text_key, filename FROM project_files WHERE project_id = ?"
  )
    .bind(projectId)
    .all();

  const sopTexts: string[] = [];
  const literatureTexts: string[] = [];
  const sourceFiles: Array<{ type: string; filename: string }> = [];
  for (const row of files.results ?? []) {
    const textKey = row.text_key as string | null;
    const filename = row.filename as string | null;
    if (filename) {
      sourceFiles.push({ type: row.type as string, filename });
    }
    if (!textKey) {
      continue;
    }
    const text = await readR2Text(c.env.BUCKET, textKey);
    if (!text) {
      continue;
    }
    if (row.type === "sop") {
      sopTexts.push(text);
    } else if (row.type === "literature") {
      literatureTexts.push(text);
    }
  }

  if (!templateContent && inputs?.template_id) {
    const templateRow = await c.env.DB.prepare(
      "SELECT file_key FROM templates WHERE id = ? AND is_active = 1"
    )
      .bind(inputs.template_id)
      .first();
    if (templateRow?.file_key) {
      templateContent = await readR2Text(c.env.BUCKET, templateRow.file_key as string);
    }
  }

  const versionRow = await c.env.DB.prepare(
    "SELECT MAX(version) as max_version FROM reports WHERE project_id = ?"
  )
    .bind(projectId)
    .first();
  const nextVersion = ((versionRow?.max_version as number | null) ?? 0) + 1;

  const reportId = crypto.randomUUID();
  const templateSnapshotKey = `projects/${projectId}/templates/${reportId}.md`;
  await putR2Text(c.env.BUCKET, templateSnapshotKey, templateContent || "");

  await c.env.DB.prepare(
    "INSERT INTO reports (id, project_id, version, status, template_snapshot_key, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
  )
    .bind(reportId, projectId, nextVersion, "running", templateSnapshotKey, c.get("user")?.id, nowIso())
    .run();

  try {
    const report = await generateReport(c.env, {
      title: project.title as string,
      scope: (inputs?.scope as string) ?? null,
      background: (inputs?.background as string) ?? null,
      objective: (inputs?.objective as string) ?? null,
      riskMethod: (inputs?.risk_method as string) ?? null,
      evalTool: normalizeEvalTool((inputs?.eval_tool as string) ?? null),
      processSteps: parseProcessStepsFromDb((inputs as any)?.process_steps),
      templateContent: templateContent ?? null,
      sopTexts,
      literatureTexts,
      sourceFiles
    });

    const reportKey = `projects/${projectId}/reports/${reportId}.md`;
    await putR2Text(c.env.BUCKET, reportKey, report.markdown);

    let jsonKey: string | null = null;
    if (report.json) {
      jsonKey = `projects/${projectId}/reports/${reportId}.json`;
      await putR2Json(c.env.BUCKET, jsonKey, report.json);
    }

    await c.env.DB.prepare(
      "UPDATE reports SET status = ?, md_key = ?, json_key = ?, prompt_tokens = ?, completion_tokens = ?, total_tokens = ? WHERE id = ?"
    )
      .bind(
        "completed",
        reportKey,
        jsonKey,
        report.usage?.prompt_tokens ?? null,
        report.usage?.completion_tokens ?? null,
        report.usage?.total_tokens ?? null,
        reportId
      )
      .run();

    await c.env.DB.prepare("UPDATE projects SET status = ?, updated_at = ? WHERE id = ?")
      .bind("completed", nowIso(), projectId)
      .run();

    return c.json({ id: reportId, version: nextVersion, status: "completed" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "未知错误";
    await c.env.DB.prepare("UPDATE reports SET status = ?, error_message = ? WHERE id = ?")
      .bind("failed", message, reportId)
      .run();
    return c.json({ error: message }, 500);
  }
});

app.post("/api/projects/:id/reports/stream", requireAuth, async (c) => {
  const projectId = c.req.param("id");
  const project = await c.env.DB.prepare("SELECT id, title FROM projects WHERE id = ? AND owner_id = ?")
    .bind(projectId, c.get("user")?.id)
    .first();
  if (!project) {
    return c.json({ error: "项目不存在" }, 404);
  }

  const body = await c.req.json().catch(() => null);
  let templateContent = typeof body?.templateContent === "string" ? body.templateContent : null;

  const inputs = await c.env.DB.prepare(
    "SELECT scope, background, objective, risk_method, eval_tool, process_steps, template_id FROM project_inputs WHERE project_id = ?"
  )
    .bind(projectId)
    .first();

  if (!templateContent && inputs?.template_id) {
    const templateRow = await c.env.DB.prepare(
      "SELECT file_key FROM templates WHERE id = ? AND is_active = 1"
    )
      .bind(inputs.template_id)
      .first();
    if (templateRow?.file_key) {
      templateContent = await readR2Text(c.env.BUCKET, templateRow.file_key as string);
    }
  }

  const files = await c.env.DB.prepare(
    "SELECT type, text_key, filename FROM project_files WHERE project_id = ?"
  )
    .bind(projectId)
    .all();

  const sopTexts: string[] = [];
  const literatureTexts: string[] = [];
  const sourceFiles: Array<{ type: string; filename: string }> = [];
  for (const row of files.results ?? []) {
    const textKey = row.text_key as string | null;
    const filename = row.filename as string | null;
    if (filename) {
      sourceFiles.push({ type: row.type as string, filename });
    }
    if (!textKey) {
      continue;
    }
    const text = await readR2Text(c.env.BUCKET, textKey);
    if (!text) {
      continue;
    }
    if (row.type === "sop") {
      sopTexts.push(text);
    } else if (row.type === "literature") {
      literatureTexts.push(text);
    }
  }

  const versionRow = await c.env.DB.prepare(
    "SELECT MAX(version) as max_version FROM reports WHERE project_id = ?"
  )
    .bind(projectId)
    .first();
  const nextVersion = ((versionRow?.max_version as number | null) ?? 0) + 1;

  const reportId = crypto.randomUUID();
  const templateSnapshotKey = `projects/${projectId}/templates/${reportId}.md`;
  await putR2Text(c.env.BUCKET, templateSnapshotKey, templateContent || "");

  await c.env.DB.prepare(
    "INSERT INTO reports (id, project_id, version, status, template_snapshot_key, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
  )
    .bind(reportId, projectId, nextVersion, "running", templateSnapshotKey, c.get("user")?.id, nowIso())
    .run();

  let aborted = false;
  const abortController = new AbortController();

  const markAborted = async (reason = "客户端断开") => {
    await c.env.DB.prepare(
      "UPDATE reports SET status = ?, error_message = ? WHERE id = ? AND status = 'running'"
    )
      .bind("aborted", reason, reportId)
      .run();
  };

  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();
      const send = (event: string, data: Record<string, unknown>) => {
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
        );
      };

      send("start", { reportId, version: nextVersion, status: "running" });

      (async () => {
        try {
          let report = await generateReportStream(
            c.env,
            {
              title: project.title as string,
              scope: (inputs?.scope as string) ?? null,
              background: (inputs?.background as string) ?? null,
              objective: (inputs?.objective as string) ?? null,
              riskMethod: (inputs?.risk_method as string) ?? null,
              evalTool: normalizeEvalTool((inputs?.eval_tool as string) ?? null),
              processSteps: parseProcessStepsFromDb((inputs as any)?.process_steps),
              templateContent: templateContent ?? null,
              sopTexts,
              literatureTexts,
              sourceFiles
            },
            {
              onDelta: (delta) => {
                send("delta", { delta });
              },
              onUsage: (usage) => {
                send("usage", usage);
              },
              onStep: (step, status) => {
                send("step", { step, status });
              },
              onLlmDelta: (step, delta) => {
                send("llm", { step, delta });
              },
              onContextStage: (message) => {
                send("context", { message });
              },
              onContextStages: (messages) => {
                send("context_stages", { messages });
              },
              onContextMeta: (meta) => {
                send("context_meta", meta);
              },
              onContextEvidence: (items) => {
                send("context_evidence", { items });
              }
            },
            { signal: abortController.signal }
          );

          if (aborted || abortController.signal.aborted) {
            await markAborted();
            return;
          }

          if (aborted || abortController.signal.aborted) {
            await markAborted();
            return;
          }

          const reportKey = `projects/${projectId}/reports/${reportId}.md`;
          await putR2Text(c.env.BUCKET, reportKey, report.markdown);

          await c.env.DB.prepare(
            "UPDATE reports SET status = ?, md_key = ?, json_key = ?, prompt_tokens = ?, completion_tokens = ?, total_tokens = ? WHERE id = ?"
          )
            .bind(
              "completed",
              reportKey,
              null,
              report.usage?.prompt_tokens ?? null,
              report.usage?.completion_tokens ?? null,
              report.usage?.total_tokens ?? null,
              reportId
            )
            .run();

          await c.env.DB.prepare("UPDATE projects SET status = ?, updated_at = ? WHERE id = ?")
            .bind("completed", nowIso(), projectId)
            .run();

          send("done", { reportId, version: nextVersion, status: "completed", usage: report.usage ?? null });
        } catch (error) {
          if (aborted || abortController.signal.aborted) {
            await markAborted();
          } else {
            const message = error instanceof Error ? error.message : "未知错误";
            await c.env.DB.prepare("UPDATE reports SET status = ?, error_message = ? WHERE id = ?")
              .bind("failed", message, reportId)
              .run();
            send("error", { message });
          }
        } finally {
          controller.close();
        }
      })();
    },
    async cancel() {
      aborted = true;
      abortController.abort();
      await markAborted();
    }
  });

  const originHeader = c.req.header("Origin");
  const allowedOrigins = c.env.APP_ORIGIN
    ? c.env.APP_ORIGIN.split(",").map((origin) => origin.trim()).filter(Boolean)
    : [];
  const corsHeaders: Record<string, string> = {};
  if (originHeader && allowedOrigins.includes(originHeader)) {
    corsHeaders["Access-Control-Allow-Origin"] = originHeader;
    corsHeaders["Access-Control-Allow-Credentials"] = "true";
    corsHeaders["Vary"] = "Origin";
  }

  return new Response(stream, {
    headers: {
      ...corsHeaders,
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive"
    }
  });
});

app.get("/api/reports/:id", requireAuth, async (c) => {
  const reportId = c.req.param("id");
  const report = await c.env.DB.prepare(
    "SELECT r.id, r.project_id, r.version, r.status, r.md_key, r.json_key, r.created_at, r.error_message, r.prompt_tokens, r.completion_tokens, r.total_tokens, p.title AS project_title FROM reports r JOIN projects p ON r.project_id = p.id WHERE r.id = ? AND p.owner_id = ?"
  )
    .bind(reportId, c.get("user")?.id)
    .first();
  if (!report) {
    return c.json({ error: "报告不存在" }, 404);
  }
  const includeContent = c.req.query("includeContent") === "1";
  const content = includeContent && report.md_key ? await readR2Text(c.env.BUCKET, report.md_key as string) : null;
  const data = includeContent && report.json_key ? await readR2Text(c.env.BUCKET, report.json_key as string) : null;
  const parsedJson = data ? safeJsonParse(data) : null;
  return c.json({ report, content, data: parsedJson });
});

app.delete("/api/reports/:id", requireAuth, async (c) => {
  const reportId = c.req.param("id");
  const force = c.req.query("force") === "1";
  const report = await c.env.DB.prepare(
    "SELECT r.id, r.project_id, r.status, r.md_key, r.json_key, r.template_snapshot_key, r.created_at FROM reports r JOIN projects p ON r.project_id = p.id WHERE r.id = ? AND p.owner_id = ?"
  )
    .bind(reportId, c.get("user")?.id)
    .first();
  if (!report) {
    return c.json({ error: "报告不存在" }, 404);
  }
  if (report.status === "running") {
    const createdAt = new Date(report.created_at as string).getTime();
    const tooOld = Number.isFinite(createdAt) && Date.now() - createdAt > 30 * 60 * 1000;
    if (!force && !tooOld) {
      return c.json({ error: "评估进行中，无法删除" }, 400);
    }
  }

  const exports = await c.env.DB.prepare(
    "SELECT id, file_key FROM report_exports WHERE report_id = ?"
  )
    .bind(reportId)
    .all();

  const keysToDelete = [
    report.md_key as string | null,
    report.json_key as string | null,
    report.template_snapshot_key as string | null
  ].filter(Boolean) as string[];

  for (const row of exports.results ?? []) {
    if (row.file_key) {
      keysToDelete.push(row.file_key as string);
    }
  }

  for (const key of keysToDelete) {
    await c.env.BUCKET.delete(key);
  }

  await c.env.DB.prepare("DELETE FROM report_exports WHERE report_id = ?").bind(reportId).run();
  await c.env.DB.prepare("DELETE FROM reports WHERE id = ?").bind(reportId).run();

  return c.json({ ok: true });
});

app.post("/api/reports/:id/exports", requireAuth, async (c) => {
  const reportId = c.req.param("id");
  const body = await c.req.json().catch(() => null);
  const format = body?.format === "docx" ? body.format : null;
  if (!format) {
    return c.json({ error: "导出格式不支持" }, 400);
  }

  const report = await c.env.DB.prepare(
    "SELECT r.id, r.project_id, r.md_key, r.status, p.title FROM reports r JOIN projects p ON r.project_id = p.id WHERE r.id = ? AND p.owner_id = ?"
  )
    .bind(reportId, c.get("user")?.id)
    .first();
  if (!report) {
    return c.json({ error: "报告不存在" }, 404);
  }
  if (report.status !== "completed") {
    return c.json({ error: "报告未生成完成" }, 400);
  }
  if (!report.md_key) {
    return c.json({ error: "报告内容缺失" }, 400);
  }

  const exportId = crypto.randomUUID();
  await c.env.DB.prepare(
    "INSERT INTO report_exports (id, report_id, format, status, created_at) VALUES (?, ?, ?, ?, ?)"
  )
    .bind(exportId, reportId, format, "running", nowIso())
    .run();

  try {
    const markdown = await readR2Text(c.env.BUCKET, report.md_key as string);
    if (!markdown) {
      throw new Error("报告内容读取失败");
    }

    const rendered = await renderDocx(markdown, {
      title: typeof report.title === "string" ? report.title : `Report ${report.version ?? ""}`.trim(),
      creator: "QRAi",
      description: `Project ${report.project_id}`
    });
    const fileKey = `projects/${report.project_id}/exports/${exportId}.${format}`;
    await c.env.BUCKET.put(fileKey, rendered, {
      httpMetadata: {
        contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
      }
    });

    await c.env.DB.prepare("UPDATE report_exports SET status = ?, file_key = ? WHERE id = ?")
      .bind("completed", fileKey, exportId)
      .run();

    return c.json({ id: exportId, status: "completed" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "导出失败";
    await c.env.DB.prepare("UPDATE report_exports SET status = ?, error_message = ? WHERE id = ?")
      .bind("failed", message, exportId)
      .run();
    return c.json({ error: message }, 500);
  }
});

app.get("/api/exports/:id/download", requireAuth, async (c) => {
  const exportId = c.req.param("id");
  const exportRow = await c.env.DB.prepare(
    "SELECT e.id, e.format, e.file_key, r.project_id, r.version, p.title FROM report_exports e JOIN reports r ON e.report_id = r.id JOIN projects p ON r.project_id = p.id WHERE e.id = ? AND p.owner_id = ?"
  )
    .bind(exportId, c.get("user")?.id)
    .first();
  if (!exportRow || !exportRow.file_key) {
    return c.json({ error: "导出文件不存在" }, 404);
  }
  const object = await c.env.BUCKET.get(exportRow.file_key as string);
  if (!object) {
    return c.json({ error: "导出文件缺失" }, 404);
  }
  const baseTitle = typeof exportRow.title === "string" && exportRow.title.trim()
    ? exportRow.title.trim()
    : "report";
  const safeTitle = baseTitle.replace(/[^a-zA-Z0-9\u4e00-\u9fa5._-]+/g, "-").slice(0, 80);
  const versionSuffix = Number.isFinite(exportRow.version) ? `-v${exportRow.version}` : "";
  const filename = `${safeTitle}${versionSuffix}.${exportRow.format}`;
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("content-disposition", `attachment; filename="${filename}"`);
  return new Response(object.body, { headers });
});

app.notFound((c) => c.json({ error: "Not Found" }, 404));

export default app;
