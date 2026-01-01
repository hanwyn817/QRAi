import type {
  ActionOutput,
  EvidenceChunk,
  FmeaScoringOutput,
  MappingValidation,
  ReportInput,
  RiskIdentificationOutput,
  RiskItem,
  ScoredRiskItem,
  WorkflowContext
} from "./aiTypes";
import { DEFAULT_TEMPLATE } from "./prompts";
import type { Env } from "./types";

const FIVE_FACTOR_DIMENSIONS = ["人员", "设备与设施", "物料", "法规/程序", "环境"];
const ACTION_TYPES = [
  "SOP/规程",
  "培训与资质",
  "设备/系统",
  "监测与报警",
  "数据完整性",
  "双人复核/独立审核",
  "其他"
];
const EMBEDDING_CACHE = new Map<string, number[]>();

export function summarizeTemplateRequirements(templateContent: string | null): string {
  const raw = templateContent?.trim();
  if (!raw) {
    return "（未提供模板要求）";
  }
  const headings = raw
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("#"))
    .slice(0, 12);
  if (headings.length > 0) {
    return headings.join(" / ");
  }
  return raw.length > 240 ? `${raw.slice(0, 240)}...` : raw;
}

export async function buildWorkflowContext(
  env: Env,
  input: ReportInput,
  evidenceTopK = 4,
  options?: { onStage?: (message: string) => void }
): Promise<WorkflowContext> {
  const scope = input.scope?.trim() || "（未填写）";
  const background = input.background?.trim() || "（未填写）";
  const objectiveBias = input.objective?.trim() || "（未填写）";
  const riskMethod = input.riskMethod?.trim() || "五因素法";
  const evalTool = input.evalTool?.trim() || "FMEA";
  const templateRequirements = summarizeTemplateRequirements(input.templateContent || DEFAULT_TEMPLATE);

  const query = [scope, background, objectiveBias].filter(Boolean).join(" ");
  const evidenceChunks = await buildEvidenceChunks(
    env,
    input.sopTexts,
    input.literatureTexts,
    query,
    evidenceTopK,
    options
  );
  options?.onStage?.("上下文拼装中...");
  const evidenceBlocks = formatEvidenceBlocks(evidenceChunks);

  return {
    scope,
    background,
    objectiveBias,
    templateRequirements,
    riskMethod,
    evalTool,
    evidenceBlocks,
    evidenceChunks,
    retrievalMeta: {
      usedEmbedding: hasEmbeddingConfig(env),
      sopTextCount: input.sopTexts.length,
      literatureTextCount: input.literatureTexts.length,
      evidenceChunkCount: evidenceChunks.length
    }
  };
}

async function buildEvidenceChunks(
  env: Env,
  sopTexts: string[],
  literatureTexts: string[],
  query: string,
  topK: number,
  options?: { onStage?: (message: string) => void }
): Promise<EvidenceChunk[]> {
  if (hasEmbeddingConfig(env)) {
    return await buildEmbeddingEvidence(env, sopTexts, literatureTexts, query, topK, options);
  }
  options?.onStage?.("关键词检索中...");
  const queryTokens = extractKeywords(query);
  const sopChunks = collectChunks("sop", sopTexts, queryTokens, topK);
  const literatureChunks = collectChunks("literature", literatureTexts, queryTokens, topK);
  return [...sopChunks, ...literatureChunks];
}

function hasEmbeddingConfig(env: Env): boolean {
  return Boolean(env.DASHSCOPE_API_KEY);
}

async function buildEmbeddingEvidence(
  env: Env,
  sopTexts: string[],
  literatureTexts: string[],
  query: string,
  topK: number,
  options?: { onStage?: (message: string) => void }
): Promise<EvidenceChunk[]> {
  options?.onStage?.("向量化中...");
  const queryEmbedding = await getEmbeddings(env, [query]);
  if (queryEmbedding.length === 0) {
    return [];
  }
  const [vector] = queryEmbedding;
  options?.onStage?.("向量检索中...");
  const sopChunks = await collectChunksByEmbedding(env, "sop", sopTexts, vector, topK);
  const literatureChunks = await collectChunksByEmbedding(env, "literature", literatureTexts, vector, topK);
  return [...sopChunks, ...literatureChunks];
}

async function collectChunksByEmbedding(
  env: Env,
  source: "sop" | "literature",
  texts: string[],
  queryEmbedding: number[],
  topK: number
): Promise<EvidenceChunk[]> {
  const chunks: EvidenceChunk[] = [];
  const chunkTexts: string[] = [];
  for (const text of texts) {
    for (const chunk of chunkText(text)) {
      chunkTexts.push(chunk);
    }
  }
  if (chunkTexts.length === 0) {
    return [];
  }
  const embeddings = await getEmbeddings(env, chunkTexts);
  if (embeddings.length !== chunkTexts.length) {
    throw new Error("Embedding 返回数量不匹配");
  }
  embeddings.forEach((embedding, index) => {
    const score = cosineSimilarity(queryEmbedding, embedding);
    chunks.push({ source, content: chunkTexts[index], score });
  });
  const sorted = chunks.sort((a, b) => b.score - a.score || b.content.length - a.content.length);
  return sorted.slice(0, topK);
}

async function getEmbeddings(env: Env, inputs: string[]): Promise<number[][]> {
  if (inputs.length === 0) {
    return [];
  }
  const apiKey = env.DASHSCOPE_API_KEY;
  if (!apiKey) {
    return [];
  }
  const baseUrl = (env.DASHSCOPE_BASE_URL || "https://dashscope.aliyuncs.com/compatible-mode/v1").replace(/\/$/, "");
  const model = env.DASHSCOPE_EMBEDDING_MODEL || "text-embedding-v4";
  const prefix = `${baseUrl}|${model}|`;
  const keys = await Promise.all(inputs.map((text) => hashText(`${prefix}${text}`)));
  const results: number[][] = new Array(inputs.length);
  const missingInputs: string[] = [];
  const missingIndices: number[] = [];

  keys.forEach((key, index) => {
    const cached = EMBEDDING_CACHE.get(key);
    if (cached) {
      results[index] = cached;
    } else {
      missingInputs.push(inputs[index]);
      missingIndices.push(index);
    }
  });

  if (missingInputs.length === 0) {
    return results;
  }

  const batchSize = 10;
  for (let i = 0; i < missingInputs.length; i += batchSize) {
    const batch = missingInputs.slice(i, i + batchSize);
    const response = await fetch(`${baseUrl}/embeddings`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({ model, input: batch })
    });
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Embedding 请求失败: ${response.status} ${errorText}`);
    }
    const data = (await response.json()) as {
      data?: Array<{ embedding?: number[] }>;
    };
    const batchEmbeddings = data.data?.map((item) => item.embedding ?? []) ?? [];
    if (batchEmbeddings.length !== batch.length) {
      throw new Error("Embedding 返回缺失");
    }
    batchEmbeddings.forEach((embedding, offset) => {
      const originalIndex = missingIndices[i + offset];
      const key = keys[originalIndex];
      results[originalIndex] = embedding;
      EMBEDDING_CACHE.set(key, embedding);
    });
  }

  return results;
}

async function hashText(text: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(text);
  const digest = await crypto.subtle.digest("SHA-256", data);
  const bytes = new Uint8Array(digest);
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length === 0 || b.length === 0 || a.length !== b.length) {
    return 0;
  }
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i += 1) {
    const ai = a[i];
    const bi = b[i];
    dot += ai * bi;
    normA += ai * ai;
    normB += bi * bi;
  }
  if (!normA || !normB) {
    return 0;
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

function collectChunks(
  source: "sop" | "literature",
  texts: string[],
  queryTokens: string[],
  topK: number
): EvidenceChunk[] {
  const chunks: EvidenceChunk[] = [];
  for (const text of texts) {
    for (const chunk of chunkText(text)) {
      const score = scoreChunk(chunk, queryTokens);
      chunks.push({ source, content: chunk, score });
    }
  }
  if (chunks.length === 0) {
    return [];
  }
  const sorted = chunks.sort((a, b) => b.score - a.score || b.content.length - a.content.length);
  return sorted.slice(0, topK);
}

function chunkText(text: string, maxLen = 560, maxChunks = 36): string[] {
  const normalized = text.replace(/\r\n/g, "\n").trim();
  if (!normalized) {
    return [];
  }
  const lines = normalized.split(/\n+/).map((part) => part.trim()).filter(Boolean);
  const baseText = lines.join(" ");
  const sentenceMatches = baseText.match(/[^。！？；;]+[。！？；;]?/g) ?? [];
  const sentences = sentenceMatches.map((part) => part.trim()).filter(Boolean);
  const units = sentences.length > 0 ? sentences : [baseText];
  const chunks: string[] = [];
  let buffer = "";
  for (const unit of units) {
    if (!buffer) {
      buffer = unit;
      continue;
    }
    if (buffer.length + unit.length + 1 <= maxLen) {
      buffer += ` ${unit}`;
      continue;
    }
    chunks.push(buffer.slice(0, maxLen));
    buffer = unit;
    if (chunks.length >= maxChunks) {
      return chunks;
    }
  }
  if (buffer && chunks.length < maxChunks) {
    chunks.push(buffer.slice(0, maxLen));
  }
  return chunks.slice(0, maxChunks);
}

function extractKeywords(text: string): string[] {
  const tokens = text.match(/[A-Za-z0-9]+|[\u4e00-\u9fa5]{2,}/g) ?? [];
  return Array.from(new Set(tokens.map((token) => token.toLowerCase()))).slice(0, 24);
}

function scoreChunk(chunk: string, tokens: string[]): number {
  if (tokens.length === 0) {
    return 1;
  }
  const lower = chunk.toLowerCase();
  let score = 0;
  for (const token of tokens) {
    if (!token) {
      continue;
    }
    if (lower.includes(token)) {
      score += 2;
    }
  }
  return score || 1;
}

function formatEvidenceBlocks(chunks: EvidenceChunk[]): string {
  if (chunks.length === 0) {
    return "（无可用片段）";
  }
  return chunks
    .map((chunk, index) => {
      const label = chunk.source === "sop" ? "SOP" : "文献";
      return `[${label}#${index + 1}] ${chunk.content}`;
    })
    .join("\n\n");
}

export function validateRiskIdentification(
  output: RiskIdentificationOutput,
  riskMethod: string
): MappingValidation {
  const issues: string[] = [];
  if (!output.items || output.items.length === 0) {
    issues.push("风险清单为空");
    return { ok: false, issues };
  }
  const idSet = new Set<string>();
  for (const item of output.items) {
    if (!item.failure_mode?.trim()) {
      issues.push("存在缺失 failure_mode 的风险项");
      break;
    }
    if (!item.consequence?.trim()) {
      issues.push("存在缺失 consequence 的风险项");
      break;
    }
    if (idSet.has(item.risk_id)) {
      issues.push("存在重复 risk_id");
      break;
    }
    idSet.add(item.risk_id);
  }
  if (riskMethod.includes("五因素")) {
    const dims = new Set(output.items.map((item) => item.dimension));
    for (const dim of FIVE_FACTOR_DIMENSIONS) {
      if (!dims.has(dim)) {
        issues.push(`缺失维度：${dim}`);
      }
    }
  }
  return { ok: issues.length === 0, issues };
}

export function computeRpnLevel(rpn: number): "极低" | "低" | "中" | "高" {
  if (rpn < 27) {
    return "极低";
  }
  if (rpn < 54) {
    return "低";
  }
  if (rpn < 108) {
    return "中";
  }
  return "高";
}

export function mergeScoring(items: RiskItem[], scoring: FmeaScoringOutput): ScoredRiskItem[] {
  const rowMap = new Map(scoring.rows.map((row) => [row.risk_id, row]));
  return items.map((item) => {
    const row = rowMap.get(item.risk_id);
    if (!row) {
      throw new Error(`缺失风险评分: ${item.risk_id}`);
    }
    const rpn = row.s * row.p * row.d;
    const level = computeRpnLevel(rpn);
    return {
      ...item,
      s: row.s,
      s_reason: row.s_reason,
      p: row.p,
      p_reason: row.p_reason,
      d: row.d,
      d_reason: row.d_reason,
      rpn,
      level,
      need_actions: rpn >= 54
    };
  });
}

export function validateActionsOutput(actions: ActionOutput, scoredItems: ScoredRiskItem[]): void {
  const needed = scoredItems.filter((item) => item.need_actions).map((item) => item.risk_id);
  const requiredSet = new Set(needed);
  const outputSet = new Set(actions.map((item) => item.risk_id));
  for (const id of requiredSet) {
    if (!outputSet.has(id)) {
      throw new Error(`缺失风险控制措施: ${id}`);
    }
  }
  for (const entry of actions) {
    if (!requiredSet.has(entry.risk_id)) {
      throw new Error(`出现不需要措施的 risk_id: ${entry.risk_id}`);
    }
    if (!entry.actions || entry.actions.length === 0) {
      throw new Error(`风险 ${entry.risk_id} 未提供具体措施`);
    }
    for (const action of entry.actions) {
      if (!ACTION_TYPES.includes(action.type)) {
        throw new Error(`动作类型非法: ${action.type}`);
      }
    }
  }
}

export function renderReportMarkdown(params: {
  title: string;
  templateContent: string | null;
  context: WorkflowContext;
  items: ScoredRiskItem[];
  actions: ActionOutput;
  sources: Array<{ type: string; filename: string }>;
}): string {
  const title = params.title || "风险评估报告";
  const header = extractTemplateTitle(params.templateContent) || "风险评估报告";
  const overview = mergeSectionContent(
    extractSectionContent(params.templateContent, "1. 概述", 2),
    buildOverview(title, params.context)
  );
  const purpose = mergeSectionContent(
    extractSectionContent(params.templateContent, "2. 目的", 2),
    params.context.objectiveBias
  );
  const scope = mergeSectionContent(
    extractSectionContent(params.templateContent, "3. 范围", 2),
    params.context.scope
  );
  const riskAssessmentIntro = extractSectionContent(params.templateContent, "4. 风险评估", 2);
  const methodText = buildMethodText(params.context);
  const riskTable = mergeSectionContent(
    extractSectionContent(params.templateContent, "4.1 风险识别", 3),
    renderRiskTable(params.items)
  );
  const methodSection = mergeSectionContent(
    extractSectionContent(params.templateContent, "4.2 评估方法", 3),
    methodText
  );
  const fmeaTable = mergeSectionContent(
    extractSectionContent(params.templateContent, "4.3 风险评价", 3),
    renderFmeaTable(params.items)
  );
  const actionTable = mergeSectionContent(
    extractSectionContent(params.templateContent, "5. 风险控制措施", 2),
    renderActionTable(params.actions, params.items)
  );
  const conclusion = mergeSectionContent(
    extractSectionContent(params.templateContent, "6. 风险评估结论", 2),
    buildConclusion(params.items, params.context.objectiveBias)
  );
  const reeval = mergeSectionContent(
    extractSectionContent(params.templateContent, "7. 再评估", 2),
    "建议在措施实施完成后 3-6 个月内复核，再评估风险等级与残余风险。"
  );
  const references = mergeSectionContent(
    extractSectionContent(params.templateContent, "8. 参考文件", 2),
    buildReferences(params.sources)
  );

  return `# ${header}

## 1. 概述
${overview}

## 2. 目的
${purpose}

## 3. 范围
${scope}

## 4. 风险评估
${riskAssessmentIntro ? `\n${riskAssessmentIntro}\n` : ""}

### 4.1 风险识别
${riskTable}

### 4.2 评估方法
${methodSection}

### 4.3 风险评价（FMEA 表）
${fmeaTable}

## 5. 风险控制措施
${actionTable}

## 6. 风险评估结论
${conclusion}

## 7. 再评估
${reeval}

## 8. 参考文件
${references}
`;
}

function extractSectionContent(templateContent: string | null, headingText: string, level: number): string {
  if (!templateContent) {
    return "";
  }
  const lines = templateContent.replace(/\r\n/g, "\n").split("\n");
  const headingPrefix = "#".repeat(level) + " ";
  let startIndex = -1;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i].trim();
    if (line.startsWith(headingPrefix) && line.includes(headingText)) {
      startIndex = i + 1;
      break;
    }
  }
  if (startIndex < 0) {
    return "";
  }
  const content: string[] = [];
  for (let i = startIndex; i < lines.length; i += 1) {
    const line = lines[i];
    const match = line.trim().match(/^(#+)\s+/);
    if (match && match[1].length <= level) {
      break;
    }
    content.push(line);
  }
  return content.join("\n").trim();
}

function mergeSectionContent(templateContent: string, generatedContent: string): string {
  if (templateContent) {
    return `${templateContent}\n\n${generatedContent}`.trim();
  }
  return generatedContent;
}

function extractTemplateTitle(templateContent: string | null): string | null {
  if (!templateContent) {
    return null;
  }
  const line = templateContent
    .split("\n")
    .map((item) => item.trim())
    .find((item) => item.startsWith("# "));
  return line ? line.replace(/^#\s+/, "").trim() : null;
}

function buildOverview(title: string, context: WorkflowContext): string {
  const prefix = title ? `项目名称：${title}。` : "";
  if (context.background && context.background !== "（未填写）") {
    return `${prefix}${context.background}`;
  }
  return `${prefix}本报告基于项目既有信息，围绕评估范围与目标倾向完成风险识别与FMEA评分。`;
}

function buildMethodText(context: WorkflowContext): string {
  return [
    `风险识别方法：${context.riskMethod}。`,
    `评估工具：${context.evalTool}，采用严重性(S)、可能性(P)、可测性(D)三维评分，取值为 9/6/3/1。`,
    `系统按 RPN=S×P×D 计算风险等级：RPN<27 极低，27-53 低，54-107 中，≥108 高。`
  ].join("\n");
}

function renderRiskTable(items: ScoredRiskItem[]): string {
  const header = `| 序号 | 风险维度 | 风险点/失效模式 | 潜在后果 |\n| --- | --- | --- | --- |`;
  const rows = items.map((item, index) => {
    return `| ${index + 1} | ${item.dimension} | ${escapeTable(item.failure_mode)} | ${escapeTable(
      item.consequence
    )} |`;
  });
  return [header, ...rows].join("\n");
}

function renderFmeaTable(items: ScoredRiskItem[]): string {
  const header =
    "| 序号 | 风险维度 | 失效模式 | 后果 | S | S理由 | P | P理由 | D | D理由 | RPN | 等级 |\n" +
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |";
  const rows = items.map((item, index) => {
    return `| ${index + 1} | ${item.dimension} | ${escapeTable(item.failure_mode)} | ${escapeTable(
      item.consequence
    )} | ${item.s} | ${escapeTable(item.s_reason)} | ${item.p} | ${escapeTable(item.p_reason)} | ${
      item.d
    } | ${escapeTable(item.d_reason)} | ${item.rpn} | ${item.level} |`;
  });
  return [header, ...rows].join("\n");
}

function renderActionTable(actions: ActionOutput, items: ScoredRiskItem[]): string {
  const required = new Set(items.filter((item) => item.need_actions).map((item) => item.risk_id));
  if (required.size === 0) {
    return "未识别出需要新增控制措施的中/高风险项。";
  }
  const header =
    "| 序号 | 动作类型 | 措施 | 责任角色 | 责任部门 | 计划完成 |\n| --- | --- | --- | --- | --- | --- |";
  const indexMap = new Map(items.map((item, index) => [item.risk_id, index + 1]));
  const rows: string[] = [];
  for (const entry of actions) {
    const order = indexMap.get(entry.risk_id);
    for (const action of entry.actions) {
      rows.push(
        `| ${order ?? "-"} | ${action.type} | ${escapeTable(action.action_text)} | ${escapeTable(
          action.owner_role
        )} | ${escapeTable(action.owner_dept)} | ${action.planned_date} |`
      );
    }
  }
  if (rows.length === 0) {
    return "未输出可执行措施，请复核评分结果。";
  }
  return [header, ...rows].join("\n");
}

function buildConclusion(items: ScoredRiskItem[], objectiveBias: string): string {
  const summary = {
    high: items.filter((item) => item.level === "高").length,
    medium: items.filter((item) => item.level === "中").length,
    low: items.filter((item) => item.level === "低").length,
    veryLow: items.filter((item) => item.level === "极低").length
  };
  const headline =
    summary.high > 0
      ? "存在高风险项，当前结论为不可接受，需优先整改。"
      : summary.medium > 0
        ? "存在中风险项，结论为有条件可接受，需落实改进措施。"
        : "未识别中高风险项，结论为可接受。";
  const biasLine = objectiveBias && objectiveBias !== "（未填写）" ? `评估目标倾向：${objectiveBias}` : "";
  return [headline, biasLine, `风险等级分布：高 ${summary.high} / 中 ${summary.medium} / 低 ${summary.low} / 极低 ${summary.veryLow}`]
    .filter(Boolean)
    .join("\n");
}

function buildReferences(sources: Array<{ type: string; filename: string }>): string {
  if (!sources.length) {
    return "（未提供）";
  }
  const lines = sources.map((file, index) => {
    const label = file.type === "sop" ? "SOP" : file.type === "literature" ? "文献" : file.type;
    return `${index + 1}. [${label}] ${file.filename}`;
  });
  return lines.join("\n");
}

function escapeTable(text: string): string {
  return text.replace(/\|/g, "｜").replace(/\n/g, " ");
}
