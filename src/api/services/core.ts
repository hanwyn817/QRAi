import type { Env, ModelRuntimeConfig, PlanTier, User } from "../types";
import { fetchDefaultModelForPlan, fetchModelByIdForPlan, normalizePlanTier } from "../models";
import { safeJsonParse } from "../utils";

export const ALLOWED_EVAL_TOOLS = new Set(["FMEA"]);

export const normalizeEvalTool = (value: string | null | undefined) => {
  return value && ALLOWED_EVAL_TOOLS.has(value) ? value : "FMEA";
};

export const resolveUserPlan = (user: User | null | undefined): PlanTier => {
  return normalizePlanTier(user?.plan) ?? "free";
};

export const normalizeProcessSteps = (
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

export const parseProcessStepsFromDb = (value: unknown) => {
  if (typeof value !== "string" || !value.trim()) {
    return undefined;
  }
  const parsed = safeJsonParse(value);
  const steps = normalizeProcessSteps(parsed);
  return steps && steps.length > 0 ? steps : [];
};

export const isValidHttpUrl = (value: string) => {
  return /^https?:\/\//i.test(value);
};

export const deleteProjectResources = async (env: Env, projectId: string) => {
  const fileRows = await env.DB.prepare(
    "SELECT file_key, text_key FROM project_files WHERE project_id = ?"
  )
    .bind(projectId)
    .all();
  const reportRows = await env.DB.prepare(
    "SELECT id, md_key, json_key, template_snapshot_key FROM reports WHERE project_id = ?"
  )
    .bind(projectId)
    .all();
  const exportRows = await env.DB.prepare(
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
    await env.BUCKET.delete(key);
  }

  await env.DB.prepare(
    "DELETE FROM report_exports WHERE report_id IN (SELECT id FROM reports WHERE project_id = ?)"
  )
    .bind(projectId)
    .run();
  await env.DB.prepare("DELETE FROM reports WHERE project_id = ?")
    .bind(projectId)
    .run();
  await env.DB.prepare("DELETE FROM project_files WHERE project_id = ?")
    .bind(projectId)
    .run();
  await env.DB.prepare("DELETE FROM project_inputs WHERE project_id = ?")
    .bind(projectId)
    .run();
  await env.DB.prepare("DELETE FROM projects WHERE id = ?")
    .bind(projectId)
    .run();
};

export const resolveTextModel = async (
  env: Env,
  requestedId: string | null,
  storedId: string | null,
  plan: "free" | "pro" | "max"
): Promise<{ model: ModelRuntimeConfig | null; error?: string }> => {
  if (requestedId) {
    const model = await fetchModelByIdForPlan(env, requestedId, plan, "text");
    if (!model) {
      return { model: null, error: "指定模型不存在或无权限使用" };
    }
    return { model };
  }
  if (storedId) {
    const model = await fetchModelByIdForPlan(env, storedId, plan, "text");
    if (model) {
      return { model };
    }
  }
  const fallback = await fetchDefaultModelForPlan(env, "text", plan);
  if (!fallback) {
    return { model: null, error: "当前账号暂无可用文本生成模型，请联系管理员" };
  }
  return { model: fallback };
};
