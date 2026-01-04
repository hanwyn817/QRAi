import OSS from "ali-oss";
import type { Bucket, BucketObject } from "./api/types";

type OssHeaders = Record<string, string | string[] | undefined>;

const asBuffer = (content: Buffer | ArrayBuffer | Uint8Array): Buffer => {
  if (Buffer.isBuffer(content)) {
    return content;
  }
  if (content instanceof ArrayBuffer) {
    return Buffer.from(content);
  }
  return Buffer.from(content);
};

export class OssBucket implements Bucket {
  private client: OSS;

  constructor(client: OSS) {
    this.client = client;
  }

  async get(key: string): Promise<BucketObject | null> {
    try {
      const result = await this.client.get(key);
      const buffer = asBuffer(result.content as Buffer | ArrayBuffer | Uint8Array);
      const headers = (result.res?.headers ?? {}) as OssHeaders;
      return {
        body: buffer,
        async text() {
          return buffer.toString("utf8");
        },
        async arrayBuffer() {
          return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
        },
        writeHttpMetadata(target) {
          const contentType = headers["content-type"] ?? headers["Content-Type"];
          if (typeof contentType === "string" && contentType.trim()) {
            target.set("content-type", contentType);
          }
        }
      };
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code === "NoSuchKey" || code === "NoSuchBucket") {
        return null;
      }
      throw error;
    }
  }

  async put(
    key: string,
    value: ArrayBuffer | ArrayBufferView | string,
    options?: { httpMetadata?: { contentType?: string } }
  ): Promise<void> {
    const headers: Record<string, string> = {};
    if (options?.httpMetadata?.contentType) {
      headers["Content-Type"] = options.httpMetadata.contentType;
    }
    const payload =
      typeof value === "string"
        ? value
        : Buffer.isBuffer(value)
          ? value
          : Buffer.from(
              value instanceof ArrayBuffer ? value : value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength)
            );
    await this.client.put(key, payload, { headers });
  }

  async delete(key: string): Promise<void> {
    try {
      await this.client.delete(key);
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code === "NoSuchKey" || code === "NoSuchBucket") {
        return;
      }
      throw error;
    }
  }
}
