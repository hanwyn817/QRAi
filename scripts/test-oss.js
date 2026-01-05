import "dotenv/config";
import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import OSS from "ali-oss";

const env = process.env;

const mask = (value, start = 4, end = 2) => {
  if (!value) return "";
  if (value.length <= start + end) return "*".repeat(value.length);
  return `${value.slice(0, start)}***${value.slice(-end)}`;
};

const info = (label, value) => {
  console.log(`${label}: ${value}`);
};

const warn = (label, value) => {
  console.warn(`${label}: ${value}`);
};

const required = ["OSS_BUCKET", "OSS_ACCESS_KEY_ID", "OSS_ACCESS_KEY_SECRET"];
const missing = required.filter((key) => !env[key]);

console.log("OSS env check");
info("env file", existsSync(".env") ? "found" : "missing");
info("APP_ENV", env.APP_ENV ?? "");
info("STORAGE_MODE", env.STORAGE_MODE ?? "");
info("OSS_BUCKET", env.OSS_BUCKET ?? "");
info("OSS_REGION", env.OSS_REGION ?? "oss-cn-hangzhou");
info("OSS_ENDPOINT", env.OSS_ENDPOINT ?? "");
info("OSS_ACCESS_KEY_ID", mask(env.OSS_ACCESS_KEY_ID));
info("OSS_ACCESS_KEY_SECRET", mask(env.OSS_ACCESS_KEY_SECRET, 2, 2));

if (missing.length > 0) {
  warn("missing required env", missing.join(", "));
  process.exit(1);
}

const endpoint = env.OSS_ENDPOINT
  ? env.OSS_ENDPOINT.startsWith("http")
    ? env.OSS_ENDPOINT
    : `https://${env.OSS_ENDPOINT}`
  : undefined;

const client = new OSS({
  bucket: env.OSS_BUCKET,
  region: env.OSS_REGION ?? "oss-cn-hangzhou",
  endpoint,
  accessKeyId: env.OSS_ACCESS_KEY_ID,
  accessKeySecret: env.OSS_ACCESS_KEY_SECRET
});

const key = `healthcheck/${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID()}.txt`;
const payload = `qrai-oss-test ${new Date().toISOString()}`;

let failed = false;

const run = async () => {
  try {
    await client.put(key, Buffer.from(payload), {
      headers: { "Content-Type": "text/plain; charset=utf-8" }
    });
    info("upload", "ok");
  } catch (error) {
    failed = true;
    warn("upload", error instanceof Error ? error.message : String(error));
    return;
  }

  try {
    const result = await client.get(key);
    const content = Buffer.isBuffer(result.content)
      ? result.content.toString("utf8")
      : String(result.content ?? "");
    if (!content.includes(payload)) {
      failed = true;
      warn("download", "content mismatch");
    } else {
      info("download", "ok");
    }
  } catch (error) {
    failed = true;
    warn("download", error instanceof Error ? error.message : String(error));
  }

  try {
    await client.delete(key);
    info("delete", "ok");
  } catch (error) {
    failed = true;
    warn("delete", error instanceof Error ? error.message : String(error));
    return;
  }

  try {
    await client.get(key);
    failed = true;
    warn("verify delete", "object still exists");
  } catch (error) {
    const code = error && typeof error === "object" ? error.code : null;
    if (code === "NoSuchKey" || code === "NoSuchObject") {
      info("verify delete", "ok");
    } else {
      failed = true;
      warn("verify delete", error instanceof Error ? error.message : String(error));
    }
  }
};

run()
  .catch((error) => {
    failed = true;
    warn("unexpected", error instanceof Error ? error.message : String(error));
  })
  .finally(() => {
    if (failed) {
      process.exitCode = 1;
    }
  });
