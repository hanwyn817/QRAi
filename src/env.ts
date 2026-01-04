import { existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import OSS from "ali-oss";
import type { Env } from "./api/types";
import { LocalBucket } from "./localBucket";
import { OssBucket } from "./oss";
import { SqliteDatabase } from "./sqlite";

type OssEnv = {
  OSS_BUCKET?: string;
  OSS_ENDPOINT?: string;
  OSS_REGION?: string;
  OSS_ACCESS_KEY_ID?: string;
  OSS_ACCESS_KEY_SECRET?: string;
};

const requireEnv = (value: string | undefined, name: string): string => {
  if (!value) {
    throw new Error(`Missing required env: ${name}`);
  }
  return value;
};

export const resolveDbPath = (): string => {
  const rawPath = process.env.DB_PATH ?? "./data/qrai.sqlite";
  const absolute = resolve(rawPath);
  const dir = dirname(absolute);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return absolute;
};

export const createEnv = (): Env => {
  const appEnv = (process.env.APP_ENV ?? "production").toLowerCase();
  const storageMode = (process.env.STORAGE_MODE ?? "").toLowerCase();
  const useLocalStorage = appEnv === "local" || storageMode === "local";
  const dbPath = resolveDbPath();

  const env: Env = {
    DB: new SqliteDatabase(dbPath),
    BUCKET: useLocalStorage
      ? new LocalBucket(process.env.LOCAL_STORAGE_PATH ?? "./data/files")
      : buildOssBucket(),
    APP_ENV: process.env.APP_ENV ?? "production",
    APP_ORIGIN: process.env.APP_ORIGIN ?? `http://localhost:${process.env.PORT ?? 8787}`,
    ADMIN_BOOTSTRAP_KEY: process.env.ADMIN_BOOTSTRAP_KEY,
    REPORT_TIMEZONE: process.env.REPORT_TIMEZONE
  };

  return env;
};

const buildOssBucket = (): OssBucket => {
  const ossEnv = process.env as OssEnv;
  const bucketName = requireEnv(ossEnv.OSS_BUCKET, "OSS_BUCKET");
  const accessKeyId = requireEnv(ossEnv.OSS_ACCESS_KEY_ID, "OSS_ACCESS_KEY_ID");
  const accessKeySecret = requireEnv(ossEnv.OSS_ACCESS_KEY_SECRET, "OSS_ACCESS_KEY_SECRET");
  const region = ossEnv.OSS_REGION ?? "oss-cn-hangzhou";
  const endpoint = ossEnv.OSS_ENDPOINT
    ? ossEnv.OSS_ENDPOINT.startsWith("http")
      ? ossEnv.OSS_ENDPOINT
      : `https://${ossEnv.OSS_ENDPOINT}`
    : undefined;

  const client = new OSS({
    bucket: bucketName,
    region,
    endpoint,
    accessKeyId,
    accessKeySecret
  });

  return new OssBucket(client);
};
