export type Env = {
  DB: D1Database;
  BUCKET: R2Bucket;
  OPENAI_API_KEY: string;
  OPENAI_BASE_URL: string;
  OPENAI_MODEL: string;
  APP_ENV: string;
  APP_ORIGIN: string;
  EXPORT_RENDER_URL?: string;
  EXPORT_RENDER_API_KEY?: string;
  EXPORT_RENDER_MODE?: string;
  ADMIN_BOOTSTRAP_KEY?: string;
  REPORT_TIMEZONE?: string;
  DASHSCOPE_API_KEY?: string;
  DASHSCOPE_BASE_URL?: string;
  DASHSCOPE_EMBEDDING_MODEL?: string;
};

export type User = {
  id: string;
  email: string;
  role: "admin" | "user";
};

export type AuthUser = User & { password_hash: string; password_salt: string };
