import MarkdownIt from "markdown-it";
import type { Env } from "./types";

const md = new MarkdownIt({ html: false, linkify: true });

function buildPayload(env: Env, markdown: string, format: "pdf" | "docx") {
  const mode = env.EXPORT_RENDER_MODE === "html" ? "html" : "markdown";
  const content = mode === "html" ? md.render(markdown) : markdown;
  return { format, content, contentType: mode };
}

export async function renderExternal(env: Env, markdown: string, format: "pdf" | "docx"): Promise<ArrayBuffer> {
  if (!env.EXPORT_RENDER_URL) {
    throw new Error("未配置外部渲染服务 (EXPORT_RENDER_URL)");
  }
  const payload = buildPayload(env, markdown, format);
  const response = await fetch(env.EXPORT_RENDER_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(env.EXPORT_RENDER_API_KEY ? { Authorization: `Bearer ${env.EXPORT_RENDER_API_KEY}` } : {})
    },
    body: JSON.stringify(payload)
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`外部渲染失败: ${response.status} ${text}`);
  }
  return await response.arrayBuffer();
}
