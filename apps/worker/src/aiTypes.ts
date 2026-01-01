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
  sourceFiles?: Array<{ type: string; filename: string }>;
  processSteps?: Array<{ step_id: string; step_name: string }>;
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

export type EvidenceChunk = {
  source: "sop" | "literature";
  content: string;
  score: number;
};

export type WorkflowContext = {
  scope: string;
  background: string;
  objectiveBias: string;
  templateRequirements: string;
  riskMethod: string;
  evalTool: string;
  evidenceBlocks: string;
  evidenceChunks: EvidenceChunk[];
};

export type RiskItem = {
  risk_id: string;
  dimension_type: "five_factors" | "process_flow";
  dimension: string;
  dimension_id: string | null;
  failure_mode: string;
  consequence: string;
};

export type RiskIdentificationOutput = {
  items: RiskItem[];
};

export type FmeaScoringRow = {
  risk_id: string;
  s: 1 | 3 | 6 | 9;
  s_reason: string;
  p: 1 | 3 | 6 | 9;
  p_reason: string;
  d: 1 | 3 | 6 | 9;
  d_reason: string;
};

export type FmeaScoringOutput = {
  rows: FmeaScoringRow[];
};

export type ScoredRiskItem = RiskItem & {
  s: 1 | 3 | 6 | 9;
  s_reason: string;
  p: 1 | 3 | 6 | 9;
  p_reason: string;
  d: 1 | 3 | 6 | 9;
  d_reason: string;
  rpn: number;
  level: "极低" | "低" | "中" | "高";
  need_actions: boolean;
};

export type ActionItem = {
  type:
    | "SOP/规程"
    | "培训与资质"
    | "设备/系统"
    | "监测与报警"
    | "数据完整性"
    | "双人复核/独立审核"
    | "其他";
  action_text: string;
  owner_role: string;
  owner_dept: string;
  planned_date: string;
};

export type ActionOutput = Array<{
  risk_id: string;
  actions: ActionItem[];
}>;

export type MappingValidation = {
  ok: boolean;
  issues: string[];
};
