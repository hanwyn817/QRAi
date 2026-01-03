export type Env = {
  DB: D1Database;
  BUCKET: R2Bucket;
  APP_ENV: string;
  APP_ORIGIN: string;
  ADMIN_BOOTSTRAP_KEY?: string;
  REPORT_TIMEZONE?: string;
};

export type ModelCategory = "text" | "embedding" | "rerank";
export type PlanTier = "free" | "pro" | "max";

export type ModelRuntimeConfig = {
  id: string;
  name: string;
  category: ModelCategory;
  model: string;
  baseUrl: string;
  apiKey: string;
};

export type User = {
  id: string;
  email: string;
  role: "admin" | "user";
  plan?: PlanTier;
};

export type AuthUser = User & { password_hash: string; password_salt: string };
