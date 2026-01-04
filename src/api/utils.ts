import type { Bucket } from "./types";

export function nowIso(): string {
  return new Date().toISOString();
}

export function daysFromNow(days: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString();
}

export function parseCookies(cookieHeader: string | null): Record<string, string> {
  if (!cookieHeader) {
    return {};
  }
  return cookieHeader.split(";").reduce((acc, part) => {
    const [rawKey, ...rest] = part.trim().split("=");
    if (!rawKey) {
      return acc;
    }
    acc[rawKey] = decodeURIComponent(rest.join("="));
    return acc;
  }, {} as Record<string, string>);
}

export function toBase64(bytes: Uint8Array): string {
  if (typeof btoa === "function") {
    let binary = "";
    for (const byte of bytes) {
      binary += String.fromCharCode(byte);
    }
    return btoa(binary);
  }
  const nodeBuffer = (globalThis as { Buffer?: { from(data: Uint8Array): { toString(encoding?: string): string } } })
    .Buffer;
  if (!nodeBuffer) {
    throw new Error("Base64 encoding is not supported in this runtime.");
  }
  return nodeBuffer.from(bytes).toString("base64");
}

export function toBase64Url(bytes: Uint8Array): string {
  return toBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function fromBase64(text: string): Uint8Array {
  if (typeof atob === "function") {
    return Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
  }
  const nodeBuffer = (globalThis as { Buffer?: { from(data: string, encoding: string): Uint8Array } }).Buffer;
  if (!nodeBuffer) {
    throw new Error("Base64 decoding is not supported in this runtime.");
  }
  return Uint8Array.from(nodeBuffer.from(text, "base64"));
}

export function randomToken(length = 32): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return toBase64Url(bytes);
}

export function safeJsonParse<T>(text: string): T | null {
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

export function extractJsonBlock(text: string): string | null {
  const fencedMatch = text.match(/```json\s*([\s\S]*?)```/i);
  if (fencedMatch?.[1]) {
    return fencedMatch[1].trim();
  }
  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return text.slice(firstBrace, lastBrace + 1);
  }
  return null;
}

export async function readR2Text(bucket: Bucket, key: string): Promise<string | null> {
  const obj = await bucket.get(key);
  if (!obj) {
    return null;
  }
  return await obj.text();
}

export async function putR2Text(bucket: Bucket, key: string, text: string): Promise<void> {
  await bucket.put(key, text, {
    httpMetadata: {
      contentType: "text/plain; charset=utf-8"
    }
  });
}

export async function putR2Json(bucket: Bucket, key: string, data: unknown): Promise<void> {
  await bucket.put(key, JSON.stringify(data, null, 2), {
    httpMetadata: {
      contentType: "application/json; charset=utf-8"
    }
  });
}

export function pick<T extends Record<string, unknown>, K extends keyof T>(obj: T, keys: K[]): Pick<T, K> {
  return keys.reduce((acc, key) => {
    if (key in obj) {
      acc[key] = obj[key];
    }
    return acc;
  }, {} as Pick<T, K>);
}
