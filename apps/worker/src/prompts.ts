import type { ReportInput } from "./ai";

type PromptMode = "json" | "markdown";

export const DEFAULT_TEMPLATE = `# 风险评估报告

## 1. 概述

## 2. 目的

## 3. 范围

## 4. 风险评估

### 4.1 风险识别

### 4.2 评估方法

### 4.3 风险评价（FMEA 表）

## 5. 风险控制措施

## 6. 风险评估结论

## 7. 再评估

## 8. 参考文件
`;

export function buildPrompt(
  input: ReportInput,
  mode: PromptMode = "json"
): { system: string; user: string } {
  const template = input.templateContent?.trim() || DEFAULT_TEMPLATE;
  const sopText = input.sopTexts.length > 0 ? input.sopTexts.join("\n\n---\n\n") : "（未提供）";
  const literatureText = input.literatureTexts.length > 0 ? input.literatureTexts.join("\n\n---\n\n") : "（未提供）";
  const searchText = input.searchResults?.length ? input.searchResults.join("\n") : "（未联网检索或无结果）";

  const system = `你是药品生产企业质量管理风险评估专家，擅长为 GMP 合规场景输出专业的风险评估报告。输出必须为中文，风格接近企业 QA 报告，结构化清晰。`;

  const outputRequirement =
    mode === "json"
      ? `【输出 JSON 格式】
{
  "report_markdown": "...",
  "risk_items": [
    { "risk_id": "R1", "dimension": "人员", "failure_mode": "...", "consequence": "..." }
  ],
  "fmea_entries": [
    {
      "risk_id": "R1",
      "dimension": "人员",
      "failure_mode": "...",
      "consequence": "...",
      "s": 9,
      "s_reason": "...",
      "p": 6,
      "p_reason": "...",
      "d": 3,
      "d_reason": "...",
      "rpn": 162,
      "level": "高",
      "conclusion": "不可接受",
      "controls": "..."
    }
  ]
}

仅输出 JSON，不要额外解释。`
      : `【输出格式】
请直接输出完整 Markdown 报告内容，不要 JSON，不要额外解释。`;

  const user = `请基于以下信息生成风险评估报告：

【项目标题】
${input.title}

【评估范围】
${input.scope || "（未填写）"}

【背景信息】
${input.background || "（未填写）"}

【评估目标】
${input.objective || "（未填写）"}

【风险识别方法】
${input.riskMethod || "（未填写）"}

【评估工具】
${input.evalTool || "（未填写）"}

【模板（用户可编辑，无占位符）】
${template}

【SOP 文件内容（视为已有控制措施与管理规定）】
${sopText}

【文献资料内容（用于识别风险点与控制措施）】
${literatureText}

【联网检索结果（若有）】
${searchText}

【硬性要求】
1. 必须按以下章节顺序完整输出：
   1) 概述
   2) 目的
   3) 范围
   4) 风险评估（含 4.1 风险识别 / 4.2 评估方法 / 4.3 风险评价 FMEA 表）
   5) 风险控制措施
   6) 风险评估结论
   7) 再评估
   8) 参考文件
2. 风险识别采用五因素法（人员、设备与设施、物料、法规/程序、环境），每个维度可包含多个风险点。
3. 输出风险识别清单表格，至少包含：序号、风险维度、风险点/失效模式、潜在后果。并为每个风险点提供稳定 risk_id。
4. FMEA 要求：
   - 评分维度：严重性 S、可能性 P、可测性 D；每个维度取值 9/6/3/1。
   - RPN = S × P × D。
   - 风险等级：RPN < 27 极低；27-53 低；54-107 中；≥108 高。
   - 每个风险点必须给出 S/P/D 分值与理由、RPN、风险等级、初步结论。
   - FMEA 表中风险点必须与 4.1 一一对应。
5. RPN ≥ 54 的中/高风险必须给出具体改进/追加控制措施（SOP/培训/监测/数据完整性/双人复核等）。
6. 评估目标仅作为倾向，若结论不可接受必须给出理由与整改建议。
7. 模板无占位符：请遵循模板的标题层级和表达风格，但仍要确保以上章节全部出现。

${outputRequirement}`;

  return { system, user };
}
