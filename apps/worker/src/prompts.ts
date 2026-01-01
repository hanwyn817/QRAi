export const DEFAULT_TEMPLATE = `# 风险评估报告

## 1. 概述

## 2. 目的

## 3. 范围

## 4. 风险评估

### 4.1 风险识别

### 4.2 评估方法

### 4.3 风险评价（评估表）

## 5. 控制措施

## 6. 风险评估结论

## 7. 再评估

## 8. 参考文件
`;

export const SYSTEM_QRM = `你是药品生产领域质量风险管理（QRM）专家，熟悉 ICH Q9、GMP 与常见监管缺陷逻辑。
你必须严格依据用户提供的评估范围、背景信息，以及（若提供）SOP/文献片段开展推理，不得编造“已提供的内部制度细节”。

SOP/文献使用规则：
1) SOP 代表企业既有管理手段与控制措施，不得虚构未提供的内部制度细节。
2) 文献片段代表外部监管/行业建议，可用于识别风险与提出改进措施。
3) 在风险评价中，SOP 可用于下调 P（可能性）与 D（可测性），但不应改变 S（严重性）。
4) 评估目标倾向为最高优先级约束：若明确“不需要采取措施”，后续不得输出新增措施；若明确指定/希望采取某类措施，需在相关输出中体现。

强约束输出规则：
1) 你输出必须是【有效JSON】，不得包含任何额外文本、解释、Markdown、代码块标记。
2) 你必须严格遵守用户提示中给定的字段、枚举和值域，不得新增字段、不得遗漏字段。
3) 若某风险点无法从提供的SOP/文献片段直接支撑，你仍可提出“通用监管常见风险”，但必须在 failure_mode 或 consequence 中明确标注“基于通用GMP/监管常见缺陷推导”。
4) 评分与计算边界：你不得计算RPN或风险等级；只输出S/P/D及理由。RPN与等级由系统代码计算。`;

export const SYSTEM_QRM_MARKDOWN = `你是药品生产领域质量风险管理（QRM）专家，熟悉 ICH Q9、GMP 与常见监管缺陷逻辑。
你必须严格依据用户提供的评估范围、背景信息，以及（若提供）SOP/文献片段开展推理，不得编造“已提供的内部制度细节”。

输出规则：
1) 输出必须是完整 Markdown 报告，不得输出 JSON、解释或其他文本。
2) 报告必须包含并严格按顺序输出：概述、目的、范围、风险评估（含4.1/4.2/4.3）、风险控制措施、风险评估结论、再评估、参考文件。
3) 表格中的风险点使用“序号”对齐，不展示 risk_id。`;

export function buildRiskIdentificationFiveFactorsPrompt(input: {
  scope: string;
  background: string;
  objectiveBias: string;
  templateRequirements: string;
  evidenceBlocks: string;
}): string {
  return `任务：基于给定上下文，使用五因素法（人员/设备与设施/物料/法规/程序/环境）输出“风险识别清单”。

输出要求（严格）：
- 输出JSON对象：{"items":[...]}。
- items中每个item必须包含字段：
  - risk_id: UUID占位符字符串（固定写"00000000-0000-0000-0000-000000000000"，系统会替换为真实UUID）
  - dimension_type: 固定为 "five_factors"
  - dimension: 必须为以下枚举之一：人员 / 设备与设施 / 物料 / 法规/程序 / 环境
  - dimension_id: 固定为 null
  - failure_mode: 风险点/失效模式（必须具体、可审计、可用于后续逐条FMEA评分）
  - consequence: 潜在后果（需体现对产品质量/患者安全/数据完整性/合规性中相关项的影响；避免泛泛而谈）
- 不得输出任何其他字段（例如 evidence 等）

覆盖性要求：
- 每个dimension至少给出1条（除非范围明显不涉及；此时仍建议输出该维度下“边界条件风险/不适用说明”，并在consequence中写明“不涉及的理由/边界条件”）
- 风险识别应包含依据文献片段中的要求/控制建议反推风险点；SOP 仅用于确认既有控制，不作为新增风险来源。

上下文（用户输入）：
[范围] ${input.scope}
[背景] ${input.background}
[模板要求摘要] ${input.templateRequirements}

SOP/文献片段（向量库召回，已按相关性排序；用于辅助推理，不需要在输出中引用）：
${input.evidenceBlocks}
`;
}

export function buildRiskIdentificationProcessFlowPrompt(input: {
  scope: string;
  background: string;
  objectiveBias: string;
  templateRequirements: string;
  processStepsJson: string;
  evidenceBlocks: string;
}): string {
  return `任务：基于给定上下文，使用流程图法（按流程阶段/步骤逐个分析）输出“风险识别清单”。

你将获得一份“流程步骤清单”，你必须在该清单的范围内进行风险识别，不得发明不存在的步骤。

输出要求（严格）：
- 输出JSON对象：{"items":[...]}。
- items中每个item必须包含字段：
  - risk_id: UUID占位符字符串（固定写"00000000-0000-0000-0000-000000000000"，系统会替换为真实UUID）
  - dimension_type: 固定为 "process_flow"
  - dimension: 必须严格等于某个流程步骤的 step_name（见下方流程步骤清单）
  - dimension_id: 必须严格等于该步骤的 step_id（UUID字符串）
  - failure_mode: 该步骤下的风险点/失效模式（必须具体、可审计、可用于后续逐条FMEA评分）
  - consequence: 潜在后果（需体现对产品质量/患者安全/数据完整性/合规性中相关项的影响，并说明为何与该步骤相关）
- 不得输出任何其他字段（例如 evidence 等）

覆盖性要求（目标导向）：
- 你应优先覆盖关键步骤（对质量/患者/DI/合规影响大的步骤），并尽量覆盖全部步骤。
- 若某步骤确实与评估范围无关，你可以不为该步骤输出风险条目，但整体必须满足系统最小条目数要求（由系统校验）。
- 风险识别应包含依据文献片段中的要求/控制建议反推风险点；SOP 仅用于确认既有控制，不作为新增风险来源。

上下文（用户输入）：
[范围] ${input.scope}
[背景] ${input.background}
[评估目标倾向] ${input.objectiveBias}
[模板要求摘要] ${input.templateRequirements}

流程步骤清单（仅允许使用这些 step_id/step_name；不得自创）：
${input.processStepsJson}

SOP/文献片段（向量库召回；用于辅助推理，不需要在输出中引用）：
${input.evidenceBlocks}
`;
}

export function buildFmeaScoringPrompt(input: {
  riskItemsJson: string;
  evidenceBlocks: string;
  scope: string;
  background: string;
  objectiveBias: string;
}): string {
  return `任务：对给定风险清单逐条进行FMEA评分（S/P/D），并给出理由。

评分规则（严格）：
- 维度：严重性S、可能性P、可测性D（越难发现分值越高）
- 分值只能从：9 / 6 / 3 / 1 中选择（高/中/低/极低）
- 输出JSON对象：{"rows":[...]}，每行字段必须包含：
  - risk_id
  - s, s_reason
  - p, p_reason
  - d, d_reason
- 不要计算RPN，不要输出风险等级
- 理由必须基于：风险描述 + 用户上下文（范围/背景/目标倾向）+（若提供）SOP/文献片段的支持性信息
  - 注意：你不需要、也不得输出 evidence 或 chunk_id 等结构化引用
- SOP 用于体现既有控制措施对 P 与 D 的影响：若 SOP 明确规定监测/复核/控制手段，可下调 P 或 D。
- 文献片段作为外部要求/建议：若文献提出控制但 SOP 未覆盖，不得因 SOP 下调 P/D；S 由后果严重性决定，不因 SOP 变化。
- 若评估目标倾向明确“风险可控/不需要措施”，可下调 P 或 D，但仍需遵循事实。

风险清单（结构化JSON；包含dimension_type/dimension等上下文）：
${input.riskItemsJson}

上下文（用户输入）：
[范围] ${input.scope}
[背景] ${input.background}
[评估目标倾向] ${input.objectiveBias}

可用SOP/文献片段摘要（用于辅助评分理由，不需要在输出中引用）：
${input.evidenceBlocks}
`;
}

export function buildActionsPrompt(input: {
  scoredItemsJson: string;
  scope: string;
  background: string;
  objectiveBias: string;
  evidenceBlocks: string;
}): string {
  return `任务：仅针对中、高风险（系统在输入中标注 need_actions=true 的项）提出改进/追加控制措施。

输出要求（严格）：
- 输出JSON数组，每个元素：{"risk_id":"...","actions":[...]}
- 每条action必须包含字段：
  - type: SOP/规程 | 培训与资质 | 设备/系统 | 监测与报警 | 数据完整性 | 双人复核/独立审核 | 其他
  - action_text: 具体可执行动作（必须包含“做什么/怎么做”，并尽量写明输出/留存的记录或证据）
  - owner_role: 责任角色（例如：QA、QC、生产主管、验证、工程/设备、自动化、IT、CSV等）
  - owner_dept: 责任部门（例如：质量保证部、质量控制部、生产部、工程部、信息部等）
  - planned_date: 计划完成日期（YYYY-MM-DD）
- 措施必须与该风险的 failure_mode 强关联，避免泛泛而谈
- 文献片段用于提出改进措施的依据与方向，优先采用文献中的建议/要求。
- 若 SOP 已覆盖相关控制，仅在存在执行/有效性风险时提出“强化执行/补充记录/复核/培训”等措施，避免重复已有制度。
- 若评估目标倾向中明确指定措施/行动（例如“采取xx措施”），必须在 actions 中体现。
- 若输入中某 risk_id 的 need_actions=false，你不得为其输出 actions

输入（带评分、RPN、是否需要措施标记；scored_items_json由系统生成，你只负责补全actions）：
${input.scoredItemsJson}

上下文（用户输入）：
[范围] ${input.scope}
[背景] ${input.background}
[评估目标倾向] ${input.objectiveBias}

可用SOP/文献片段摘要（用于提出措施，不需要在输出中引用）：
${input.evidenceBlocks}
`;
}

export function buildMarkdownRenderPrompt(input: {
  title: string;
  templateContent: string;
  scope: string;
  background: string;
  objectiveBias: string;
  riskItemsJson: string;
  scoredItemsJson: string;
  actionsJson: string;
}): string {
  return `任务：根据模板与结构化输入，输出完整的 Markdown 风险评估报告。

强制规则：
- 风险识别表、风险评价表、控制措施表均使用“序号”，不要输出 risk_id。
- 风险评价表须展示 S/P/D、理由、RPN、等级，并在最后一列给出对应的控制/改进措施（基于序号与控制措施数据匹配，每条控制措施前增加序号；若无措施填“—”）。
- 中/高风险（RPN>=54）必须有控制措施。
- 若评估目标倾向明确“不需要采取措施”，控制措施章节可说明“无需新增措施”并保持表格为空或填“—”。

项目标题：${input.title}

上下文（用户输入）：
[范围] ${input.scope}
[背景] ${input.background}
[评估目标倾向] ${input.objectiveBias}

模板（必须按照模版中给定的章节标题按顺序输出，且不能省略）：
${input.templateContent}

风险识别清单（含序号）：
${input.riskItemsJson}

风险评价表（含序号、RPN、等级）：
${input.scoredItemsJson}

控制措施（含序号）：
${input.actionsJson}
`;
}
