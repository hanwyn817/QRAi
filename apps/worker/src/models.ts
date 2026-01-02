import type { Env, ModelCategory, ModelRuntimeConfig } from "./types";
import { nowIso } from "./utils";

const MODEL_CATEGORIES: ModelCategory[] = ["text", "embedding", "rerank"];

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

export async function fetchDefaultModel(env: Env, category: ModelCategory): Promise<ModelRuntimeConfig | null> {
  const row = await env.DB.prepare(
    "SELECT id, name, category, model_name, base_url, api_key FROM models WHERE category = ? AND is_default = 1 AND is_active = 1 ORDER BY updated_at DESC LIMIT 1"
  )
    .bind(category)
    .first();
  if (!row) {
    return null;
  }
  return toRuntimeConfig(row as Record<string, unknown>);
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
    "SELECT id, name, category, model_name, is_default FROM models WHERE is_active = 1 ORDER BY updated_at DESC"
  ).all();
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
  }>
> {
  const rows = await env.DB.prepare(
    "SELECT id, name, category, model_name, base_url, api_key, is_default, is_active, updated_at FROM models ORDER BY updated_at DESC"
  ).all();
  return (rows.results ?? []).map((row) => ({
    id: row.id as string,
    name: row.name as string,
    category: row.category as ModelCategory,
    model_name: row.model_name as string,
    base_url: row.base_url as string,
    api_key_masked: maskApiKey((row.api_key as string) ?? ""),
    is_default: row.is_default === 1,
    is_active: row.is_active === 1,
    updated_at: row.updated_at as string
  }));
}
