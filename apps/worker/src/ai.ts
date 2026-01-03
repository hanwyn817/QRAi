import type { ModelRuntimeConfig } from "./types";
import {
  buildRiskControlPrompt,
  buildControlPlanPrompt,
  buildFmeaScoringPrompt,
  buildMarkdownRenderPrompt,
  buildHazardIdentificationFiveFactorsPrompt,
  buildHazardIdentificationProcessFlowPrompt,
  SYSTEM_QRM,
  SYSTEM_QRM_MARKDOWN
} from "./prompts";
import { extractJsonBlock, safeJsonParse } from "./utils";
import type {
  ActionOutput,
  ControlMeasureOutput,
  FmeaScoringOutput,
  GeneratedReport,
  ReportInput,
  HazardIdentificationOutput,
  ReevaluatedRiskItem,
  RiskItem,
  TokenUsage,
  WorkflowContext,
  ScoredRiskItem
} from "./aiTypes";
import {
  buildWorkflowContext,
  mergeResidualScoring,
  mergeScoring,
  validateActionsOutput,
  validateControlMeasuresOutput,
  validateHazardIdentification
} from "./workflow";

const RISK_ID_PLACEHOLDER = "00000000-0000-0000-0000-000000000000";
const FIVE_FACTOR_DIMENSIONS = ["人员", "设备与设施", "物料", "法规与程序", "环境"];
const ACTION_TYPES = [
  "SOP/规程",
  "培训与资质",
  "设备/系统",
  "监测与报警",
  "数据完整性",
  "双人复核/独立审核",
  "其他"
];

function normalizeFiveFactorDimension(value: string): string | null {
  const normalized = value.replace(/\s+/g, "").replace(/[()（）]/g, "");
  if (!normalized) {
    return null;
  }
  if (normalized === "人员") {
    return "人员";
  }
  if (normalized === "环境") {
    return "环境";
  }
  if (normalized.includes("设备") || normalized.includes("设施")) {
    return "设备与设施";
  }
  if (normalized.includes("物料") || normalized.includes("原料")) {
    return "物料";
  }
  if (normalized.includes("法规") || normalized.includes("程序") || normalized.includes("规程")) {
    return "法规与程序";
  }
  return FIVE_FACTOR_DIMENSIONS.includes(normalized) ? normalized : null;
}

function parseObjectivePolicy(objectiveBias: string): { allowActions: boolean; forceActions: boolean } {
  const normalized = objectiveBias.replace(/\s+/g, "");
  const denyActions =
    /不(需要|需|用|必)(采取)?(任何)?(措施|行动)/.test(normalized) ||
    /无需(采取)?(任何)?(措施|行动)/.test(normalized) ||
    /不采取(任何)?(措施|行动)/.test(normalized) ||
    /无需改进|不需改进/.test(normalized);
  if (denyActions) {
    return { allowActions: false, forceActions: false };
  }
  const forceActions =
    /(希望|需要|必须|计划|拟|想要|要求).{0,8}采取/.test(normalized) ||
    /采取.{0,12}(措施|行动|改进)/.test(normalized);
  return { allowActions: true, forceActions };
}

type StepStatus = "running" | "done";
type StepName =
  | "context"
  | "hazard_identification"
  | "mapping_validation"
  | "fmea_scoring"
  | "action_generation"
  | "control_plan"
  | "rendering";

type StreamHandlers = {
  onDelta: (delta: string) => void;
  onUsage?: (usage: TokenUsage) => void;
  onStep?: (step: StepName, status: StepStatus) => void;
  onLlmDelta?: (step: StepName, delta: string) => void;
  onContextStage?: (message: string) => void;
  onContextStages?: (messages: string[]) => void;
  onContextMeta?: (meta: WorkflowContext["retrievalMeta"]) => void;
  onContextEvidence?: (items: Array<{ source: string; content: string; score: number }>) => void;
};

type ModelContext = {
  llm: ModelRuntimeConfig;
  embedding?: ModelRuntimeConfig | null;
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

function accumulateUsage(total: TokenUsage | undefined, next?: TokenUsage | null): TokenUsage | undefined {
  if (!next) {
    return total;
  }
  const result: TokenUsage = {
    prompt_tokens: (total?.prompt_tokens ?? 0) + (next.prompt_tokens ?? 0),
    completion_tokens: (total?.completion_tokens ?? 0) + (next.completion_tokens ?? 0),
    total_tokens: (total?.total_tokens ?? 0) + (next.total_tokens ?? 0)
  };
  return result;
}

async function callJsonLlm<T>(
  model: ModelRuntimeConfig,
  userPrompt: string,
  signal?: AbortSignal
): Promise<{ data: T; usage?: TokenUsage }> {
  const payload = {
    model: model.model,
    temperature: 0.2,
    messages: [
      { role: "system", content: SYSTEM_QRM },
      { role: "user", content: userPrompt }
    ]
  };

  const response = await fetch(`${model.baseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${model.apiKey}`
    },
    body: JSON.stringify(payload),
    signal
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

  const rawJson = safeJsonParse<T>(content) ?? safeJsonParse<T>(extractJsonBlock(content) ?? "");
  if (!rawJson) {
    throw new Error("LLM 未返回有效 JSON");
  }
  return { data: rawJson, usage: pickUsage(data.usage) };
}

async function callJsonLlmStream<T>(
  model: ModelRuntimeConfig,
  userPrompt: string,
  step: StepName,
  handlers?: StreamHandlers,
  signal?: AbortSignal
): Promise<{ data: T; usage?: TokenUsage }> {
  const payload = {
    model: model.model,
    temperature: 0.2,
    stream: true,
    stream_options: { include_usage: true },
    messages: [
      { role: "system", content: SYSTEM_QRM },
      { role: "user", content: userPrompt }
    ]
  };

  const response = await fetch(`${model.baseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
      Authorization: `Bearer ${model.apiKey}`
    },
    body: JSON.stringify(payload),
    signal
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
  let sseDataLines: string[] = [];

  const applyChunk = (parsed: {
    choices?: Array<{ delta?: { content?: string }; message?: { content?: string } }>;
    usage?: TokenUsage;
  }) => {
    const delta = parsed.choices?.[0]?.delta?.content ?? parsed.choices?.[0]?.message?.content;
    if (delta) {
      fullText += delta;
      handlers?.onLlmDelta?.(step, delta);
    }
    if (parsed.usage) {
      usage = pickUsage(parsed.usage);
      if (usage && handlers?.onUsage) {
        handlers.onUsage(usage);
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

  const parsed = safeJsonParse<T>(fullText.trim()) ?? safeJsonParse<T>(extractJsonBlock(fullText) ?? "");
  if (!parsed) {
    throw new Error("LLM 未返回有效 JSON");
  }
  return { data: parsed, usage };
}

async function callMarkdownLlm(
  model: ModelRuntimeConfig,
  userPrompt: string,
  signal?: AbortSignal
): Promise<{ content: string; usage?: TokenUsage }> {
  const payload = {
    model: model.model,
    temperature: 0.2,
    messages: [
      { role: "system", content: SYSTEM_QRM_MARKDOWN },
      { role: "user", content: userPrompt }
    ]
  };

  const response = await fetch(`${model.baseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${model.apiKey}`
    },
    body: JSON.stringify(payload),
    signal
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

  return { content, usage: pickUsage(data.usage) };
}

async function callMarkdownStream(
  model: ModelRuntimeConfig,
  userPrompt: string,
  handlers?: StreamHandlers,
  signal?: AbortSignal
): Promise<{ content: string; usage?: TokenUsage }> {
  const payload = {
    model: model.model,
    temperature: 0.2,
    stream: true,
    stream_options: { include_usage: true },
    messages: [
      { role: "system", content: SYSTEM_QRM_MARKDOWN },
      { role: "user", content: userPrompt }
    ]
  };

  const response = await fetch(`${model.baseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
      Authorization: `Bearer ${model.apiKey}`
    },
    body: JSON.stringify(payload),
    signal
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
  let sseDataLines: string[] = [];

  const applyChunk = (parsed: {
    choices?: Array<{ delta?: { content?: string }; message?: { content?: string } }>;
    usage?: TokenUsage;
  }) => {
    const delta = parsed.choices?.[0]?.delta?.content ?? parsed.choices?.[0]?.message?.content;
    if (delta) {
      fullText += delta;
      handlers?.onDelta?.(delta);
    }
    if (parsed.usage) {
      usage = pickUsage(parsed.usage);
      if (usage && handlers?.onUsage) {
        handlers.onUsage(usage);
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

  return { content: fullText.trim(), usage };
}

function expectRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} 不是有效对象`);
  }
  return value as Record<string, unknown>;
}

function ensureExactKeys(record: Record<string, unknown>, keys: string[], label: string): void {
  const recordKeys = Object.keys(record);
  for (const key of keys) {
    if (!(key in record)) {
      throw new Error(`${label} 缺少字段: ${key}`);
    }
  }
  for (const key of recordKeys) {
    if (!keys.includes(key)) {
      throw new Error(`${label} 包含非法字段: ${key}`);
    }
  }
}

function parseHazardIdentification(raw: unknown, expectedMode: "five_factors" | "process_flow"): RiskItem[] {
  const record = expectRecord(raw, "危害源识别结果");
  if (!Array.isArray(record.items)) {
    throw new Error("危害源识别结果 items 不是数组");
  }
  const items: RiskItem[] = [];
  record.items.forEach((item, index) => {
    const entry = expectRecord(item, `风险项#${index + 1}`);
    ensureExactKeys(
      entry,
      ["risk_id", "dimension_type", "dimension", "dimension_id", "failure_mode", "consequence"],
      `风险项#${index + 1}`
    );
    const dimensionType = entry.dimension_type;
    if (dimensionType !== expectedMode) {
      throw new Error(`风险项#${index + 1} 的 dimension_type 不匹配`);
    }
    const resolvedDimensionType = expectedMode;
    if (typeof entry.dimension !== "string" || !entry.dimension.trim()) {
      throw new Error(`风险项#${index + 1} dimension 非法`);
    }
    let dimension = entry.dimension.trim();
    if (expectedMode === "five_factors") {
      const normalized = normalizeFiveFactorDimension(dimension);
      if (!normalized) {
        throw new Error(`风险项#${index + 1} dimension 非法`);
      }
      dimension = normalized;
    }
    if (expectedMode === "five_factors" && !FIVE_FACTOR_DIMENSIONS.includes(dimension)) {
      throw new Error(`风险项#${index + 1} dimension 非法`);
    }
    if (expectedMode === "five_factors" && entry.dimension_id !== null) {
      throw new Error(`风险项#${index + 1} dimension_id 必须为 null`);
    }
    if (expectedMode === "process_flow" && typeof entry.dimension_id !== "string") {
      throw new Error(`风险项#${index + 1} dimension_id 必须为字符串`);
    }
    if (typeof entry.failure_mode !== "string" || !entry.failure_mode.trim()) {
      throw new Error(`风险项#${index + 1} failure_mode 为空`);
    }
    if (typeof entry.consequence !== "string" || !entry.consequence.trim()) {
      throw new Error(`风险项#${index + 1} consequence 为空`);
    }
    items.push({
      risk_id: typeof entry.risk_id === "string" ? entry.risk_id : RISK_ID_PLACEHOLDER,
      dimension_type: resolvedDimensionType,
      dimension,
      dimension_id: entry.dimension_id as string | null,
      failure_mode: entry.failure_mode as string,
      consequence: entry.consequence as string
    });
  });
  return items.map((item) => ({
    ...item,
    risk_id: crypto.randomUUID()
  }));
}

function parseFmeaScoring(raw: unknown, riskIds: string[]): FmeaScoringOutput {
  const record = expectRecord(raw, "FMEA评分结果");
  if (!Array.isArray(record.rows)) {
    throw new Error("FMEA评分结果 rows 不是数组");
  }
  const rows = record.rows.map((row, index) => {
    const entry = expectRecord(row, `评分行#${index + 1}`);
    ensureExactKeys(
      entry,
      ["risk_id", "s", "s_reason", "p", "p_reason", "d", "d_reason"],
      `评分行#${index + 1}`
    );
    if (typeof entry.risk_id !== "string" || !entry.risk_id.trim()) {
      throw new Error(`评分行#${index + 1} risk_id 为空`);
    }
    const score = (value: unknown, label: string) => {
      if (value !== 1 && value !== 3 && value !== 6 && value !== 9) {
        throw new Error(`评分行#${index + 1} ${label} 非法`);
      }
      return value as 1 | 3 | 6 | 9;
    };
    const text = (value: unknown, label: string) => {
      if (typeof value !== "string" || !value.trim()) {
        throw new Error(`评分行#${index + 1} ${label} 为空`);
      }
      return value as string;
    };
    return {
      risk_id: entry.risk_id as string,
      s: score(entry.s, "s"),
      s_reason: text(entry.s_reason, "s_reason"),
      p: score(entry.p, "p"),
      p_reason: text(entry.p_reason, "p_reason"),
      d: score(entry.d, "d"),
      d_reason: text(entry.d_reason, "d_reason")
    };
  });
  const rowIds = new Set(rows.map((row) => row.risk_id));
  for (const id of riskIds) {
    if (!rowIds.has(id)) {
      throw new Error(`评分缺失风险项: ${id}`);
    }
  }
  return { rows };
}

function parseRiskControlOutput(raw: unknown, requiredIds: string[]) {
  const record = expectRecord(raw, "风险控制输出");
  if (!Array.isArray(record.rows)) {
    throw new Error("风险控制输出 rows 不是数组");
  }
  const rows = record.rows.map((row, index) => {
    const entry = expectRecord(row, `风险控制行#${index + 1}`);
    ensureExactKeys(entry, ["risk_id", "hazard", "actions", "s", "p", "d"], `风险控制行#${index + 1}`);
    if (typeof entry.risk_id !== "string" || !entry.risk_id.trim()) {
      throw new Error(`风险控制行#${index + 1} risk_id 为空`);
    }
    if (typeof entry.hazard !== "string" || !entry.hazard.trim()) {
      throw new Error(`风险控制行#${index + 1} hazard 为空`);
    }
    if (!Array.isArray(entry.actions)) {
      throw new Error(`风险控制行#${index + 1} actions 不是数组`);
    }
    const score = (value: unknown, label: string) => {
      if (value !== 1 && value !== 3 && value !== 6 && value !== 9) {
        throw new Error(`风险控制行#${index + 1} ${label} 非法`);
      }
      return value as 1 | 3 | 6 | 9;
    };
    const actions = entry.actions.map((action, actionIndex) => {
      const actionRecord = expectRecord(action, `控制措施#${index + 1}.${actionIndex + 1}`);
      ensureExactKeys(actionRecord, ["type", "action_text"], `控制措施#${index + 1}.${actionIndex + 1}`);
      const normalizedType = ACTION_TYPES.includes(actionRecord.type as string)
        ? (actionRecord.type as string)
        : "其他";
      if (typeof actionRecord.action_text !== "string" || !actionRecord.action_text.trim()) {
        throw new Error(`控制措施#${index + 1}.${actionIndex + 1} action_text 为空`);
      }
      return {
        type: normalizedType as ControlMeasureOutput[number]["actions"][number]["type"],
        action_text: actionRecord.action_text as string
      };
    });
    return {
      risk_id: entry.risk_id as string,
      hazard: entry.hazard as string,
      actions,
      s: score(entry.s, "s"),
      p: score(entry.p, "p"),
      d: score(entry.d, "d")
    };
  });
  const rowIds = new Set(rows.map((row) => row.risk_id));
  for (const id of requiredIds) {
    if (!rowIds.has(id)) {
      throw new Error(`风险控制缺失风险项: ${id}`);
    }
  }
  return { rows };
}

function parseControlPlan(raw: unknown, requiredIds: string[], today: string): ActionOutput {
  if (!Array.isArray(raw)) {
    throw new Error("控制措施输出不是数组");
  }
  const output: ActionOutput = raw.map((entry, index) => {
    const record = expectRecord(entry, `措施项#${index + 1}`);
    ensureExactKeys(record, ["risk_id", "actions"], `措施项#${index + 1}`);
    if (typeof record.risk_id !== "string" || !record.risk_id.trim()) {
      throw new Error(`措施项#${index + 1} risk_id 为空`);
    }
    if (!Array.isArray(record.actions)) {
      throw new Error(`措施项#${index + 1} actions 不是数组`);
    }
    const actions = record.actions.map((action, actionIndex) => {
      const actionRecord = expectRecord(action, `措施#${index + 1}.${actionIndex + 1}`);
      ensureExactKeys(
        actionRecord,
        ["type", "action_text", "owner_role", "owner_dept", "planned_date"],
        `措施#${index + 1}.${actionIndex + 1}`
      );
      const normalizedType = ACTION_TYPES.includes(actionRecord.type as string)
        ? (actionRecord.type as string)
        : "其他";
      if (typeof actionRecord.action_text !== "string" || !actionRecord.action_text.trim()) {
        throw new Error(`措施#${index + 1}.${actionIndex + 1} action_text 为空`);
      }
      if (typeof actionRecord.owner_role !== "string" || !actionRecord.owner_role.trim()) {
        throw new Error(`措施#${index + 1}.${actionIndex + 1} owner_role 为空`);
      }
      if (typeof actionRecord.owner_dept !== "string" || !actionRecord.owner_dept.trim()) {
        throw new Error(`措施#${index + 1}.${actionIndex + 1} owner_dept 为空`);
      }
      if (typeof actionRecord.planned_date !== "string" || !actionRecord.planned_date.trim()) {
        throw new Error(`措施#${index + 1}.${actionIndex + 1} planned_date 为空`);
      }
      if (!/^\d{4}-\d{2}-\d{2}$|^TBD$/.test(actionRecord.planned_date as string)) {
        throw new Error(`措施#${index + 1}.${actionIndex + 1} planned_date 格式非法`);
      }
      let plannedDate = actionRecord.planned_date as string;
      if (plannedDate !== "TBD" && plannedDate < today) {
        plannedDate = "TBD";
      }
      return {
        type: normalizedType as ActionOutput[number]["actions"][number]["type"],
        action_text: actionRecord.action_text as string,
        owner_role: actionRecord.owner_role as string,
        owner_dept: actionRecord.owner_dept as string,
        planned_date: plannedDate
      };
    });
    return { risk_id: record.risk_id as string, actions };
  });
  const required = new Set(requiredIds);
  return output.filter((entry) => required.has(entry.risk_id));
}

function mergePlanWithMeasures(measures: ControlMeasureOutput, plan: ActionOutput): ActionOutput {
  const planMap = new Map<string, ActionOutput[number]["actions"]>();
  for (const entry of plan) {
    planMap.set(entry.risk_id, entry.actions);
  }
  return measures.map((entry) => {
    const plannedActions = planMap.get(entry.risk_id) ?? [];
    const mergedActions = entry.actions.map((action) => {
      const matched = plannedActions.find(
        (planAction) => planAction.action_text === action.action_text && planAction.type === action.type
      );
      return {
        type: action.type,
        action_text: action.action_text,
        owner_role: matched?.owner_role ?? "待定",
        owner_dept: matched?.owner_dept ?? "待定",
        planned_date: matched?.planned_date ?? "TBD"
      };
    });
    return { risk_id: entry.risk_id, actions: mergedActions };
  });
}

function formatLocalDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function ensureNotAborted(signal?: AbortSignal) {
  if (signal?.aborted) {
    throw new Error("请求已取消");
  }
}

async function sleep(ms: number, signal?: AbortSignal) {
  if (signal?.aborted) {
    throw new Error("请求已取消");
  }
  await new Promise<void>((resolve) => setTimeout(resolve, ms));
  if (signal?.aborted) {
    throw new Error("请求已取消");
  }
}

async function runWorkflow(
  models: ModelContext,
  input: ReportInput,
  handlers?: StreamHandlers,
  signal?: AbortSignal
): Promise<GeneratedReport> {
  ensureNotAborted(signal);
  handlers?.onStep?.("context", "running");
  const contextStages: string[] = [];
  const context = await buildWorkflowContext(models.embedding ?? null, input, undefined, {
    onStage: (message) => {
      contextStages.push(message);
      handlers?.onContextStage?.(message);
    }
  });
  if (contextStages.length > 0) {
    handlers?.onContextStages?.(contextStages);
  }
  handlers?.onContextMeta?.(context.retrievalMeta);
  handlers?.onContextEvidence?.(
    context.evidenceChunks.map((item) => ({
      source: item.source,
      content: item.content,
      score: item.score,
      filename: item.filename ?? null
    }))
  );
  await sleep(3000, signal);
  handlers?.onStep?.("context", "done");

  ensureNotAborted(signal);
  handlers?.onStep?.("hazard_identification", "running");
  const useProcessFlow = Boolean(input.riskMethod?.includes("流程") && input.processSteps?.length);
  const riskPrompt = useProcessFlow
    ? buildHazardIdentificationProcessFlowPrompt({
        scope: context.scope,
        background: context.background,
        objectiveBias: context.objectiveBias,
        templateRequirements: context.templateRequirements,
        processStepsJson: JSON.stringify(input.processSteps ?? []),
        evidenceBlocks: context.evidenceBlocks
      })
    : buildHazardIdentificationFiveFactorsPrompt({
        scope: context.scope,
        background: context.background,
        objectiveBias: context.objectiveBias,
        templateRequirements: context.templateRequirements,
        evidenceBlocks: context.evidenceBlocks
      });
  const riskResponse = handlers?.onLlmDelta
    ? await callJsonLlmStream<HazardIdentificationOutput>(
        models.llm,
        riskPrompt,
        "hazard_identification",
        handlers,
        signal
      )
    : await callJsonLlm<HazardIdentificationOutput>(models.llm, riskPrompt, signal);
  let usage = accumulateUsage(undefined, riskResponse.usage);
  handlers?.onUsage?.(usage ?? {});
  const riskItems = parseHazardIdentification(riskResponse.data, useProcessFlow ? "process_flow" : "five_factors");
  handlers?.onStep?.("hazard_identification", "done");

  ensureNotAborted(signal);
  handlers?.onStep?.("mapping_validation", "running");
  const mapping = validateHazardIdentification({ items: riskItems }, context.riskMethod);
  if (!mapping.ok) {
    throw new Error(`一致性校验失败: ${mapping.issues.join("；")}`);
  }
  handlers?.onStep?.("mapping_validation", "done");

  ensureNotAborted(signal);
  handlers?.onStep?.("fmea_scoring", "running");
  const scoringPrompt = buildFmeaScoringPrompt({
    riskItemsJson: JSON.stringify({ items: riskItems }),
    evidenceBlocks: context.evidenceBlocks,
    scope: context.scope,
    background: context.background,
    objectiveBias: context.objectiveBias
  });
  const scoringResponse = handlers?.onLlmDelta
    ? await callJsonLlmStream<FmeaScoringOutput>(
        models.llm,
        scoringPrompt,
        "fmea_scoring",
        handlers,
        signal
      )
    : await callJsonLlm<FmeaScoringOutput>(models.llm, scoringPrompt, signal);
  usage = accumulateUsage(usage, scoringResponse.usage);
  handlers?.onUsage?.(usage ?? {});
  const scoring = parseFmeaScoring(scoringResponse.data, riskItems.map((item) => item.risk_id));
  const objectivePolicy = parseObjectivePolicy(context.objectiveBias);
  let scoredItems = mergeScoring(riskItems, scoring);
  if (!objectivePolicy.allowActions) {
    scoredItems = scoredItems.map((item) => ({ ...item, need_actions: false }));
  } else if (objectivePolicy.forceActions) {
    scoredItems = scoredItems.map((item) => ({ ...item, need_actions: true }));
  }
  handlers?.onStep?.("fmea_scoring", "done");

  ensureNotAborted(signal);
  handlers?.onStep?.("action_generation", "running");
  const needActions = scoredItems.filter((item) => item.need_actions);
  let controlMeasures: ControlMeasureOutput = [];
  let reevaluatedItems: ReevaluatedRiskItem[] = [];
  let riskControlRows: Array<{
    risk_id: string;
    hazard: string;
    actions: ControlMeasureOutput[number]["actions"];
    s: number;
    p: number;
    d: number;
    rpn: number;
    level: string;
  }> = [];
  if (needActions.length > 0) {
    const actionPrompt = buildRiskControlPrompt({
      scoredItemsJson: JSON.stringify({
        items: needActions.map((item) => ({
          risk_id: item.risk_id,
          dimension: item.dimension,
          failure_mode: item.failure_mode,
          consequence: item.consequence,
          s: item.s,
          p: item.p,
          d: item.d,
          rpn: item.rpn,
          level: item.level,
          need_actions: item.need_actions
        }))
      }),
      scope: context.scope,
      background: context.background,
      objectiveBias: context.objectiveBias,
      evidenceBlocks: context.evidenceBlocks
    });
    const actionResponse = handlers?.onLlmDelta
      ? await callJsonLlmStream<{ rows: Array<Record<string, unknown>> }>(
          models.llm,
          actionPrompt,
          "action_generation",
          handlers,
          signal
        )
      : await callJsonLlm<{ rows: Array<Record<string, unknown>> }>(models.llm, actionPrompt, signal);
    usage = accumulateUsage(usage, actionResponse.usage);
    handlers?.onUsage?.(usage ?? {});
    const riskControl = parseRiskControlOutput(actionResponse.data, needActions.map((item) => item.risk_id));
    controlMeasures = riskControl.rows.map((row) => ({ risk_id: row.risk_id, actions: row.actions }));
    validateControlMeasuresOutput(controlMeasures, scoredItems);

    const residualItems = mergeResidualScoring(
      needActions.map((item) => ({
        risk_id: item.risk_id,
        dimension_type: item.dimension_type,
        dimension: item.dimension,
        dimension_id: item.dimension_id,
        failure_mode: item.failure_mode,
        consequence: item.consequence
      })),
      {
        rows: riskControl.rows.map((row) => ({
          risk_id: row.risk_id,
          s: row.s,
          p: row.p,
          d: row.d
        }))
      }
    );
    reevaluatedItems = residualItems;

    const controlMeasuresMap = new Map(controlMeasures.map((entry) => [entry.risk_id, entry.actions]));
    const reevaluatedMap = new Map(reevaluatedItems.map((item) => [item.risk_id, item]));
    riskControlRows = needActions.map((item) => {
      const reevaluated = reevaluatedMap.get(item.risk_id);
      return {
        risk_id: item.risk_id,
        hazard: item.failure_mode,
        actions: controlMeasuresMap.get(item.risk_id) ?? [],
        s: reevaluated?.s ?? item.s,
        p: reevaluated?.p ?? item.p,
        d: reevaluated?.d ?? item.d,
        rpn: reevaluated?.rpn ?? item.rpn,
        level: reevaluated?.level ?? item.level
      };
    });
  } else if (handlers?.onLlmDelta) {
    handlers.onLlmDelta("action_generation", JSON.stringify({ rows: [] }));
  }
  handlers?.onStep?.("action_generation", "done");

  ensureNotAborted(signal);
  handlers?.onStep?.("control_plan", "running");
  let actions: ActionOutput = [];
  if (controlMeasures.length > 0) {
    const today = formatLocalDate(new Date());
    const planPrompt = buildControlPlanPrompt({
      controlMeasuresJson: JSON.stringify(controlMeasures),
      scope: context.scope,
      background: context.background,
      objectiveBias: context.objectiveBias,
      today
    });
    const planResponse = handlers?.onLlmDelta
      ? await callJsonLlmStream<ActionOutput>(models.llm, planPrompt, "control_plan", handlers, signal)
      : await callJsonLlm<ActionOutput>(models.llm, planPrompt, signal);
    usage = accumulateUsage(usage, planResponse.usage);
    handlers?.onUsage?.(usage ?? {});
    const rawPlan = parseControlPlan(planResponse.data, controlMeasures.map((item) => item.risk_id), today);
    actions = mergePlanWithMeasures(controlMeasures, rawPlan);
    validateActionsOutput(actions, scoredItems);
  } else if (handlers?.onLlmDelta) {
    handlers.onLlmDelta("control_plan", "[]");
  }
  handlers?.onStep?.("control_plan", "done");

  ensureNotAborted(signal);
  handlers?.onStep?.("rendering", "running");
  const renderItems = scoredItems.map((item, index) => ({
    seq: index + 1,
    dimension: item.dimension,
    failure_mode: item.failure_mode,
    consequence: item.consequence
  }));
  const renderScoredItems = scoredItems.map((item, index) => ({
    seq: index + 1,
    dimension: item.dimension,
    failure_mode: item.failure_mode,
    consequence: item.consequence,
    s: item.s,
    s_reason: item.s_reason,
    p: item.p,
    p_reason: item.p_reason,
    d: item.d,
    d_reason: item.d_reason,
    rpn: item.rpn,
    level: item.level
  }));
  const actionSeqMap = new Map(scoredItems.map((item, index) => [item.risk_id, index + 1]));
  const renderActions = actions.map((entry) => ({
    seq: actionSeqMap.get(entry.risk_id) ?? null,
    actions: entry.actions
  }));
  const methodText = [
    `风险识别方法：${context.riskMethod}。`,
    `评估工具：${context.evalTool}，采用严重性(S)、可能性(P)、可测性(D)三维评分，取值为 9/6/3/1。`,
    `系统按 RPN=S×P×D 计算风险等级：RPN<27 极低，27-53 低，54-107 中，≥108 高。`
  ].join("\n");
  const formatActionsText = (items: Array<{ action_text: string }>) => {
    if (!items.length) {
      return "—";
    }
    return items
      .map((action, index) => {
        const text = action.action_text.replace(/\|/g, "｜").replace(/\s+/g, " ").trim();
        return `${index + 1}. ${text}`;
      })
      .join("<br>");
  };
  const renderReevaluatedItems = riskControlRows.map((row, index) => ({
    seq: index + 1,
    hazard: row.hazard,
    actions_text: formatActionsText(row.actions),
    actions: row.actions.map((action, actionIndex) => ({
      order: actionIndex + 1,
      action_text: action.action_text,
      type: action.type
    })),
    s: row.s,
    p: row.p,
    d: row.d,
    rpn: row.rpn,
    level: row.level
  }));
  const renderPrompt = buildMarkdownRenderPrompt({
    title: input.title,
    templateContent: input.templateContent ?? "",
    scope: context.scope,
    background: context.background,
    objectiveBias: context.objectiveBias,
    methodText,
    riskItemsJson: JSON.stringify(renderItems),
    scoredItemsJson: JSON.stringify(renderScoredItems),
    actionsJson: JSON.stringify(renderActions),
    reevaluatedItemsJson: JSON.stringify(renderReevaluatedItems)
  });
  const renderResult = handlers?.onDelta
    ? await callMarkdownStream(models.llm, renderPrompt, handlers, signal)
    : await callMarkdownLlm(models.llm, renderPrompt, signal);
  usage = accumulateUsage(usage, renderResult.usage);
  handlers?.onUsage?.(usage ?? {});
  const markdown = renderResult.content;
  handlers?.onStep?.("rendering", "done");

  const json = {
    context,
    risk_items: riskItems,
    fmea_rows: scoring.rows,
    scored_items: scoredItems,
    control_measures: controlMeasures,
    reevaluated_items: reevaluatedItems,
    actions,
    mapping_validation: mapping
  };

  return { markdown, json, usage };
}

export async function generateReport(models: ModelContext, input: ReportInput): Promise<GeneratedReport> {
  return runWorkflow(models, input);
}

export async function generateReportMarkdown(models: ModelContext, input: ReportInput): Promise<GeneratedReport> {
  const report = await runWorkflow(models, input);
  return { markdown: report.markdown, usage: report.usage };
}

export async function generateReportStream(
  models: ModelContext,
  input: ReportInput,
  handlers: StreamHandlers,
  options?: { signal?: AbortSignal }
): Promise<GeneratedReport> {
  return runWorkflow(models, input, handlers, options?.signal);
}
