import { Hono } from "hono";
import { requireAuth } from "../auth";
import { nowIso, putR2Json, putR2Text, readR2Text, safeJsonParse } from "../utils";
import { generateReport, generateReportStream } from "../ai";
import { renderDocx } from "../exporters";
import { fetchDefaultModelForPlan } from "../models";
import { consumeUserQuota } from "../quota";
import {
    normalizeEvalTool,
    parseProcessStepsFromDb,
    resolveUserPlan,
    resolveTextModel
} from "../services/core";
import { withReportSlot } from "../services/reportQueue";
import type { Env, User } from "../types";

const app = new Hono<{ Bindings: Env; Variables: { user: User | null } }>();

app.post("/projects/:id/reports", requireAuth, async (c) => {
    const projectId = c.req.param("id");
    const project = await c.env.DB.prepare("SELECT id, title FROM projects WHERE id = ? AND owner_id = ?")
        .bind(projectId, c.get("user")?.id)
        .first();
    if (!project) {
        return c.json({ error: "项目不存在" }, 404);
    }

    const body = await c.req.json().catch(() => null);
    let templateContent = typeof body?.templateContent === "string" ? body.templateContent : null;
    const requestedTextModelId = typeof body?.textModelId === "string" ? body.textModelId.trim() : null;
    const user = c.get("user");
    const plan = resolveUserPlan(user);

    const inputs = await c.env.DB.prepare(
        "SELECT scope, background, objective, risk_method, eval_tool, process_steps, template_id, text_model_id FROM project_inputs WHERE project_id = ?"
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
    const sopSources: Array<{ text: string; filename: string | null }> = [];
    const literatureSources: Array<{ text: string; filename: string | null }> = [];
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
            sopSources.push({ text, filename });
        } else if (row.type === "literature") {
            literatureTexts.push(text);
            literatureSources.push({ text, filename });
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

    const storedTextModelId = typeof inputs?.text_model_id === "string" ? inputs.text_model_id.trim() : null;
    const { model: textModel, error: modelError } = await resolveTextModel(
        c.env,
        requestedTextModelId,
        storedTextModelId,
        plan
    );
    if (!textModel) {
        return c.json({ error: modelError ?? "模型不可用" }, 400);
    }
    const userId = c.get("user")?.id as string;
    const quotaResult = await consumeUserQuota(c.env, userId, plan);
    if (!quotaResult.ok) {
        return c.json({ error: "本月评估次数已用完", quota: quotaResult.snapshot }, 429);
    }
    if (requestedTextModelId && requestedTextModelId !== storedTextModelId) {
        await c.env.DB.prepare("UPDATE project_inputs SET text_model_id = ?, updated_at = ? WHERE project_id = ?")
            .bind(textModel.id, nowIso(), projectId)
            .run();
    }
    const embeddingModel = await fetchDefaultModelForPlan(c.env, "embedding", plan);

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
        "INSERT INTO reports (id, project_id, version, status, template_snapshot_key, created_by, created_at, model_name) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    )
        .bind(
            reportId,
            projectId,
            nextVersion,
            "running",
            templateSnapshotKey,
            c.get("user")?.id,
            nowIso(),
            textModel.name
        )
        .run();

    try {
        const report = await withReportSlot(c.req.raw.signal, () =>
            generateReport({ llm: textModel, embedding: embeddingModel }, {
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
                sopSources,
                literatureSources,
                sourceFiles
            })
        );

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

        return c.json({ id: reportId, version: nextVersion, status: "completed", quota: quotaResult.snapshot });
    } catch (error) {
        const message = error instanceof Error ? error.message : "未知错误";
        await c.env.DB.prepare("UPDATE reports SET status = ?, error_message = ? WHERE id = ?")
            .bind("failed", message, reportId)
            .run();
        return c.json({ error: message }, 500);
    }
});

app.post("/projects/:id/reports/stream", requireAuth, async (c) => {
    const projectId = c.req.param("id");
    const project = await c.env.DB.prepare("SELECT id, title FROM projects WHERE id = ? AND owner_id = ?")
        .bind(projectId, c.get("user")?.id)
        .first();
    if (!project) {
        return c.json({ error: "项目不存在" }, 404);
    }

    const body = await c.req.json().catch(() => null);
    let templateContent = typeof body?.templateContent === "string" ? body.templateContent : null;
    const requestedTextModelId = typeof body?.textModelId === "string" ? body.textModelId.trim() : null;
    const user = c.get("user");
    const plan = resolveUserPlan(user);

    const inputs = await c.env.DB.prepare(
        "SELECT scope, background, objective, risk_method, eval_tool, process_steps, template_id, text_model_id FROM project_inputs WHERE project_id = ?"
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

    const storedTextModelId = typeof inputs?.text_model_id === "string" ? inputs.text_model_id.trim() : null;
    const { model: textModel, error: modelError } = await resolveTextModel(
        c.env,
        requestedTextModelId,
        storedTextModelId,
        plan
    );
    if (!textModel) {
        return c.json({ error: modelError ?? "模型不可用" }, 400);
    }
    const userId = c.get("user")?.id as string;
    const quotaResult = await consumeUserQuota(c.env, userId, plan);
    if (!quotaResult.ok) {
        return c.json({ error: "本月评估次数已用完", quota: quotaResult.snapshot }, 429);
    }
    if (requestedTextModelId && requestedTextModelId !== storedTextModelId) {
        await c.env.DB.prepare("UPDATE project_inputs SET text_model_id = ?, updated_at = ? WHERE project_id = ?")
            .bind(textModel.id, nowIso(), projectId)
            .run();
    }
    const embeddingModel = await fetchDefaultModelForPlan(c.env, "embedding", plan);

    const files = await c.env.DB.prepare(
        "SELECT type, text_key, filename FROM project_files WHERE project_id = ?"
    )
        .bind(projectId)
        .all();

    const sopTexts: string[] = [];
    const literatureTexts: string[] = [];
    const sopSources: Array<{ text: string; filename: string | null }> = [];
    const literatureSources: Array<{ text: string; filename: string | null }> = [];
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
            sopSources.push({ text, filename });
        } else if (row.type === "literature") {
            literatureTexts.push(text);
            literatureSources.push({ text, filename });
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
        "INSERT INTO reports (id, project_id, version, status, template_snapshot_key, created_by, created_at, model_name) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    )
        .bind(
            reportId,
            projectId,
            nextVersion,
            "running",
            templateSnapshotKey,
            c.get("user")?.id,
            nowIso(),
            textModel.name
        )
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
            let closed = false;
            const closeStream = () => {
                if (closed) {
                    return;
                }
                closed = true;
                try {
                    controller.close();
                } catch {
                }
            };
            const send = (event: string, data: Record<string, unknown>) => {
                controller.enqueue(
                    encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
                );
            };

            (async () => {
                try {
                    await withReportSlot(abortController.signal, async () => {
                        send("start", { reportId, version: nextVersion, status: "running", quota: quotaResult.snapshot });
                        const report = await generateReportStream(
                            { llm: textModel, embedding: embeddingModel },
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
                                sopSources,
                                literatureSources,
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
                    }, (info) => {
                        send("queued", {
                            position: info.position,
                            totalQueued: info.totalQueued,
                            concurrency: info.concurrency
                        });
                    });
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
                    closeStream();
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

app.get("/reports/:id", requireAuth, async (c) => {
    const reportId = c.req.param("id");
    const report = await c.env.DB.prepare(
        "SELECT r.id, r.project_id, r.version, r.status, r.md_key, r.json_key, r.created_at, r.error_message, r.prompt_tokens, r.completion_tokens, r.total_tokens, r.model_name, p.title AS project_title FROM reports r JOIN projects p ON r.project_id = p.id WHERE r.id = ? AND p.owner_id = ?"
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

app.delete("/reports/:id", requireAuth, async (c) => {
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

app.post("/reports/:id/exports", requireAuth, async (c) => {
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

app.get("/exports/:id/download", requireAuth, async (c) => {
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
    const asciiFallback = `report${versionSuffix}.${exportRow.format}`;
    const encodedFilename = encodeURIComponent(filename).replace(/%20/g, "%20");
    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set(
        "content-disposition",
        `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodedFilename}`
    );
    return new Response(object.body as ReadableStream<any>, { headers });
});

export default app;
