import type { Env, ModelCategory, ModelRuntimeConfig, PlanTier } from "./types";
import { nowIso } from "./utils";

const MODEL_CATEGORIES: ModelCategory[] = ["text", "embedding", "rerank"];
export { normalizePlanTier } from "./plan";

export function normalizeModelCategory(value: unknown): ModelCategory | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return MODEL_CATEGORIES.includes(trimmed as ModelCategory) ? (trimmed as ModelCategory) : null;
}

export function sanitizeBaseUrl(value: string): string {
  return value.trim().replace(/\/$/, "");
}

export function maskApiKey(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }
  if (trimmed.length <= 6) {
    return `${trimmed.slice(0, 1)}***`;
  }
  return `${trimmed.slice(0, 4)}...${trimmed.slice(-4)}`;
}

function toRuntimeConfig(row: Record<string, unknown>): ModelRuntimeConfig {
  return {
    id: row.id as string,
    name: row.name as string,
    category: row.category as ModelCategory,
    model: row.model_name as string,
    baseUrl: row.base_url as string,
    apiKey: row.api_key as string
  };
}

export async function fetchModelById(
  env: Env,
  id: string,
  category?: ModelCategory
): Promise<ModelRuntimeConfig | null> {
  if (!id) {
    return null;
  }
  const query = category
    ? "SELECT id, name, category, model_name, base_url, api_key FROM models WHERE id = ? AND category = ? AND is_active = 1"
    : "SELECT id, name, category, model_name, base_url, api_key FROM models WHERE id = ? AND is_active = 1";
  const row = category
    ? await env.DB.prepare(query).bind(id, category).first()
    : await env.DB.prepare(query).bind(id).first();
  if (!row) {
    return null;
  }
  return toRuntimeConfig(row as Record<string, unknown>);
}

export async function fetchModelByIdForPlan(
  env: Env,
  id: string,
  plan: PlanTier,
  category?: ModelCategory
): Promise<ModelRuntimeConfig | null> {
  if (!id) {
    return null;
  }
  const base = category
    ? "SELECT m.id, m.name, m.category, m.model_name, m.base_url, m.api_key FROM models m JOIN model_access ma ON ma.model_id = m.id WHERE m.id = ? AND m.category = ? AND m.is_active = 1 AND ma.plan = ?"
    : "SELECT m.id, m.name, m.category, m.model_name, m.base_url, m.api_key FROM models m JOIN model_access ma ON ma.model_id = m.id WHERE m.id = ? AND m.is_active = 1 AND ma.plan = ?";
  const row = category
    ? await env.DB.prepare(base).bind(id, category, plan).first()
    : await env.DB.prepare(base).bind(id, plan).first();
  if (!row) {
    return null;
  }
  return toRuntimeConfig(row as Record<string, unknown>);
}

export async function fetchDefaultModelForPlan(
  env: Env,
  category: ModelCategory,
  plan: PlanTier
): Promise<ModelRuntimeConfig | null> {
  const row = await env.DB.prepare(
    "SELECT m.id, m.name, m.category, m.model_name, m.base_url, m.api_key FROM models m JOIN model_access ma ON ma.model_id = m.id WHERE m.category = ? AND m.is_default = 1 AND m.is_active = 1 AND ma.plan = ? ORDER BY m.updated_at DESC LIMIT 1"
  )
    .bind(category, plan)
    .first();
  if (row) {
    return toRuntimeConfig(row as Record<string, unknown>);
  }
  const fallback = await env.DB.prepare(
    "SELECT m.id, m.name, m.category, m.model_name, m.base_url, m.api_key FROM models m JOIN model_access ma ON ma.model_id = m.id WHERE m.category = ? AND m.is_active = 1 AND ma.plan = ? ORDER BY m.updated_at DESC LIMIT 1"
  )
    .bind(category, plan)
    .first();
  if (!fallback) {
    return null;
  }
  return toRuntimeConfig(fallback as Record<string, unknown>);
}

export async function setDefaultModel(env: Env, category: ModelCategory, id: string): Promise<void> {
  await env.DB.prepare("UPDATE models SET is_default = 0 WHERE category = ? AND is_active = 1")
    .bind(category)
    .run();
  await env.DB.prepare("UPDATE models SET is_default = 1, updated_at = ? WHERE id = ?")
    .bind(nowIso(), id)
    .run();
}

export async function ensureDefaultModel(
  env: Env,
  category: ModelCategory,
  excludeId?: string
): Promise<string | null> {
  const existing = await env.DB.prepare(
    "SELECT id FROM models WHERE category = ? AND is_default = 1 AND is_active = 1 LIMIT 1"
  )
    .bind(category)
    .first();
  if (existing?.id) {
    return existing.id as string;
  }

  const replacement = excludeId
    ? await env.DB.prepare(
        "SELECT id FROM models WHERE category = ? AND is_active = 1 AND id != ? ORDER BY updated_at DESC LIMIT 1"
      )
        .bind(category, excludeId)
        .first()
    : await env.DB.prepare(
        "SELECT id FROM models WHERE category = ? AND is_active = 1 ORDER BY updated_at DESC LIMIT 1"
      )
        .bind(category)
        .first();
  if (!replacement?.id) {
    return null;
  }
  const replacementId = replacement.id as string;
  await setDefaultModel(env, category, replacementId);
  return replacementId;
}

export async function listPublicModels(env: Env): Promise<{
  models: Array<{ id: string; name: string; category: ModelCategory; model_name: string; is_default: boolean }>;
  defaults: Record<ModelCategory, string | null>;
}> {
  const rows = await env.DB.prepare(
    "SELECT m.id, m.name, m.category, m.model_name, m.is_default FROM models m JOIN model_access ma ON ma.model_id = m.id WHERE m.is_active = 1 AND ma.plan = ? ORDER BY m.updated_at DESC"
  )
    .bind("free")
    .all();
  const models = (rows.results ?? []).map((row) => ({
    id: row.id as string,
    name: row.name as string,
    category: row.category as ModelCategory,
    model_name: row.model_name as string,
    is_default: row.is_default === 1
  }));
  const defaults: Record<ModelCategory, string | null> = {
    text: null,
    embedding: null,
    rerank: null
  };
  for (const model of models) {
    if (model.is_default) {
      defaults[model.category] = model.id;
    }
  }
  return { models, defaults };
}

export async function listPublicModelsForPlan(
  env: Env,
  plan: PlanTier
): Promise<{
  models: Array<{ id: string; name: string; category: ModelCategory; model_name: string; is_default: boolean }>;
  defaults: Record<ModelCategory, string | null>;
}> {
  const rows = await env.DB.prepare(
    "SELECT m.id, m.name, m.category, m.model_name, m.is_default FROM models m JOIN model_access ma ON ma.model_id = m.id WHERE m.is_active = 1 AND ma.plan = ? ORDER BY m.updated_at DESC"
  )
    .bind(plan)
    .all();
  const models = (rows.results ?? []).map((row) => ({
    id: row.id as string,
    name: row.name as string,
    category: row.category as ModelCategory,
    model_name: row.model_name as string,
    is_default: row.is_default === 1
  }));
  const defaults: Record<ModelCategory, string | null> = {
    text: null,
    embedding: null,
    rerank: null
  };
  for (const model of models) {
    if (model.is_default) {
      defaults[model.category] = model.id;
    }
  }
  return { models, defaults };
}

export async function listAdminModels(env: Env): Promise<
  Array<{
    id: string;
    name: string;
    category: ModelCategory;
    model_name: string;
    base_url: string;
    api_key_masked: string;
    is_default: boolean;
    is_active: boolean;
    updated_at: string;
    allowed_plans: PlanTier[];
  }>
> {
  const rows = await env.DB.prepare(
    "SELECT id, name, category, model_name, base_url, api_key, is_default, is_active, updated_at FROM models ORDER BY updated_at DESC"
  ).all();
  const accessRows = await env.DB.prepare(
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
  return (rows.results ?? []).map((row) => ({
    id: row.id as string,
    name: row.name as string,
    category: row.category as ModelCategory,
    model_name: row.model_name as string,
    base_url: row.base_url as string,
    api_key_masked: maskApiKey((row.api_key as string) ?? ""),
    is_default: row.is_default === 1,
    is_active: row.is_active === 1,
    updated_at: row.updated_at as string,
    allowed_plans: accessMap.get(row.id as string) ?? []
  }));
}

export async function setModelAccess(env: Env, modelId: string, plans: PlanTier[]): Promise<void> {
  await env.DB.prepare("DELETE FROM model_access WHERE model_id = ?")
    .bind(modelId)
    .run();
  for (const plan of plans) {
    await env.DB.prepare("INSERT INTO model_access (model_id, plan) VALUES (?, ?)")
      .bind(modelId, plan)
      .run();
  }
}

export async function listModelNamesByPlan(env: Env): Promise<Record<PlanTier, string[]>> {
  const rows = await env.DB.prepare(
    "SELECT m.name as name, ma.plan as plan FROM models m JOIN model_access ma ON ma.model_id = m.id WHERE m.is_active = 1 ORDER BY m.updated_at DESC"
  ).all();
  const result: Record<PlanTier, string[]> = { free: [], pro: [], max: [] };
  const seen = {
    free: new Set<string>(),
    pro: new Set<string>(),
    max: new Set<string>()
  };
  (rows.results ?? []).forEach((row) => {
    const plan = row.plan as PlanTier;
    const modelName = (row.name as string) ?? "";
    if (!modelName || !seen[plan]) {
      return;
    }
    if (seen[plan].has(modelName)) {
      return;
    }
    seen[plan].add(modelName);
    result[plan].push(modelName);
  });
  return result;
}
