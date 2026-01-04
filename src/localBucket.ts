import { createReadStream, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { Bucket, BucketObject } from "./api/types";

const ensureDir = (path: string) => {
  if (!existsSync(path)) {
    mkdirSync(path, { recursive: true });
  }
};

const buildObject = (filePath: string, contentType?: string): BucketObject => {
  return {
    body: createReadStream(filePath),
    async text() {
      return readFileSync(filePath, "utf8");
    },
    async arrayBuffer() {
      const buffer = readFileSync(filePath);
      return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
    },
    writeHttpMetadata(headers) {
      if (contentType) {
        headers.set("content-type", contentType);
      }
    }
  };
};

export class LocalBucket implements Bucket {
  private root: string;
  private metadata: Map<string, { contentType?: string }> = new Map();

  constructor(root: string) {
    this.root = resolve(root);
    ensureDir(this.root);
  }

  private resolvePath(key: string): string {
    return resolve(this.root, key);
  }

  async get(key: string): Promise<BucketObject | null> {
    const filePath = this.resolvePath(key);
    if (!existsSync(filePath)) {
      return null;
    }
    const meta = this.metadata.get(key);
    return buildObject(filePath, meta?.contentType);
  }

  async put(
    key: string,
    value: ArrayBuffer | ArrayBufferView | string,
    options?: { httpMetadata?: { contentType?: string } }
  ): Promise<void> {
    const filePath = this.resolvePath(key);
    ensureDir(dirname(filePath));
    const payload =
      typeof value === "string"
        ? value
        : Buffer.isBuffer(value)
          ? value
          : Buffer.from(
              value instanceof ArrayBuffer ? value : value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength)
            );
    writeFileSync(filePath, payload);
    if (options?.httpMetadata?.contentType) {
      this.metadata.set(key, { contentType: options.httpMetadata.contentType });
    }
  }

  async delete(key: string): Promise<void> {
    const filePath = this.resolvePath(key);
    if (existsSync(filePath)) {
      rmSync(filePath);
    }
    this.metadata.delete(key);
  }
}
