import type { Env } from "./types";
import { buildPrompt } from "./prompts";
import { extractJsonBlock, safeJsonParse } from "./utils";

export type ReportInput = {
  title: string;
  scope: string | null;
  background: string | null;
  objective: string | null;
  riskMethod: string | null;
  evalTool: string | null;
  templateContent: string | null;
  sopTexts: string[];
  literatureTexts: string[];
  searchResults?: string[];
};

export type TokenUsage = {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
};

export type GeneratedReport = {
  markdown: string;
  json?: unknown;
  usage?: TokenUsage;
};

function pickUsage(usage?: TokenUsage | null): TokenUsage | undefined {
  if (!usage) {
    return undefined;
  }
  return {
    prompt_tokens: usage.prompt_tokens ?? undefined,
    completion_tokens: usage.completion_tokens ?? undefined,
    total_tokens: usage.total_tokens ?? undefined
  };
}

export async function generateReport(env: Env, input: ReportInput): Promise<GeneratedReport> {
  const { system, user } = buildPrompt(input, "json");
  const payload = {
    model: env.OPENAI_MODEL,
    temperature: 0.2,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user }
    ]
  };

  const response = await fetch(`${env.OPENAI_BASE_URL.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.OPENAI_API_KEY}`
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`LLM 请求失败: ${response.status} ${errorText}`);
  }

  const data = (await response.json()) as {
    choices?: { message?: { content?: string } }[];
    usage?: TokenUsage;
  };
  const content = data.choices?.[0]?.message?.content?.trim();
  if (!content) {
    throw new Error("LLM 返回为空");
  }

  const jsonBlock = extractJsonBlock(content);
  const parsed = jsonBlock ? safeJsonParse<Record<string, unknown>>(jsonBlock) : null;
  if (parsed && typeof parsed.report_markdown === "string") {
    return { markdown: parsed.report_markdown, json: parsed, usage: pickUsage(data.usage) };
  }

  return { markdown: content, json: parsed ?? undefined, usage: pickUsage(data.usage) };
}

export async function generateReportMarkdown(env: Env, input: ReportInput): Promise<GeneratedReport> {
  const { system, user } = buildPrompt(input, "markdown");
  const payload = {
    model: env.OPENAI_MODEL,
    temperature: 0.2,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user }
    ]
  };

  const response = await fetch(`${env.OPENAI_BASE_URL.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.OPENAI_API_KEY}`
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`LLM 请求失败: ${response.status} ${errorText}`);
  }

  const data = (await response.json()) as {
    choices?: { message?: { content?: string } }[];
    usage?: TokenUsage;
  };
  const content = data.choices?.[0]?.message?.content?.trim();
  if (!content) {
    throw new Error("LLM 返回为空");
  }

  return { markdown: content, usage: pickUsage(data.usage) };
}

export async function generateReportStream(
  env: Env,
  input: ReportInput,
  onDelta: (delta: string) => void,
  onUsage?: (usage: TokenUsage) => void,
  options?: { signal?: AbortSignal }
): Promise<GeneratedReport> {
  const { system, user } = buildPrompt(input, "markdown");
  const payload = {
    model: env.OPENAI_MODEL,
    temperature: 0.2,
    stream: true,
    stream_options: { include_usage: true },
    messages: [
      { role: "system", content: system },
      { role: "user", content: user }
    ]
  };

  const response = await fetch(`${env.OPENAI_BASE_URL.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
      Authorization: `Bearer ${env.OPENAI_API_KEY}`
    },
    body: JSON.stringify(payload),
    signal: options?.signal
  });

  if (!response.ok || !response.body) {
    const errorText = await response.text();
    throw new Error(`LLM 请求失败: ${response.status} ${errorText}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let fullText = "";
  let usage: TokenUsage | undefined;

  const applyChunk = (parsed: {
    choices?: Array<{ delta?: { content?: string }; message?: { content?: string } }>;
    usage?: TokenUsage;
  }) => {
    const delta = parsed.choices?.[0]?.delta?.content ?? parsed.choices?.[0]?.message?.content;
    if (delta) {
      fullText += delta;
      onDelta(delta);
    }
    if (parsed.usage) {
      usage = pickUsage(parsed.usage);
      if (usage && onUsage) {
        onUsage(usage);
      }
    }
  };

  const handleData = (raw: string) => {
    const parsed = safeJsonParse<{
      choices?: Array<{ delta?: { content?: string }; message?: { content?: string } }>;
      usage?: TokenUsage;
    }>(raw);
    if (!parsed) {
      return;
    }
    applyChunk(parsed);
  };

  let sseDataLines: string[] = [];

  const flushSseEvent = () => {
    if (sseDataLines.length === 0) {
      return;
    }
    const data = sseDataLines.join("\n").trim();
    sseDataLines = [];
    if (!data || data === "[DONE]") {
      return;
    }
    handleData(data);
  };

  while (true) {
    const { value, done } = await reader.read();
    if (done) {
      break;
    }
    buffer += decoder.decode(value, { stream: true });
    let lineEnd = buffer.indexOf("\n");
    while (lineEnd !== -1) {
      const rawLine = buffer.slice(0, lineEnd);
      const line = rawLine.trim();
      buffer = buffer.slice(lineEnd + 1);
      lineEnd = buffer.indexOf("\n");

      if (!line) {
        flushSseEvent();
        continue;
      }
      if (line.startsWith("event:") || line.startsWith("id:") || line.startsWith("retry:")) {
        continue;
      }
      if (line.startsWith("data:")) {
        const data = line.slice(5).trim();
        sseDataLines.push(data);
        continue;
      }
      if (line.startsWith("{")) {
        handleData(line);
      }
    }
  }

  flushSseEvent();
  const tail = buffer.trim();
  if (tail.startsWith("{")) {
    handleData(tail);
  }

  return { markdown: fullText.trim(), usage };
}
