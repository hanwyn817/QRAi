export type PreparedStatement = {
  bind(...values: unknown[]): PreparedStatement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
  run(): Promise<{ success?: boolean }>;
};

export type Database = {
  prepare(query: string): PreparedStatement;
};

export type BucketObject = {
  body?: ReadableStream | ArrayBuffer | Uint8Array | null;
  text(): Promise<string>;
  arrayBuffer(): Promise<ArrayBuffer>;
  writeHttpMetadata(headers: Headers): void;
};

export type Bucket = {
  get(key: string): Promise<BucketObject | null>;
  put(
    key: string,
    value: ArrayBuffer | ArrayBufferView | string,
    options?: { httpMetadata?: { contentType?: string } }
  ): Promise<void>;
  delete(key: string): Promise<void>;
};

export type Env = {
  DB: Database;
  BUCKET: Bucket;
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
