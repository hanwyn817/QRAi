import React from "react";

export interface ProjectInputs {
    scope: string;
    background: string;
    objective: string;
    riskMethod: string;
    evalTool: string;
    processStepsText: string;
    templateId: string;
    textModelId: string;
}

interface ProjectSettingsProps {
    inputs: ProjectInputs;
    onInputChange: (key: keyof ProjectInputs, value: string) => void;
    riskMethods: string[];
    evalTools: { value: string; label: string; disabled: boolean }[];
}

export function ProjectSettings({ inputs, onInputChange, riskMethods, evalTools }: ProjectSettingsProps) {
    return (
        <>
            <div className="form-section span-6">
                <h4>评估范围</h4>
                <textarea
                    value={inputs.scope}
                    onChange={(e) => onInputChange("scope", e.target.value)}
                    placeholder="简要描述本次风险评估覆盖的工艺、区域或系统"
                />
            </div>

            <div className="form-section span-6">
                <h4>评估目标</h4>
                <textarea
                    value={inputs.objective}
                    onChange={(e) => onInputChange("objective", e.target.value)}
                    placeholder="例如期望的风险结论或改进方向"
                />
            </div>

            <div className="form-section span-12">
                <h4>背景信息</h4>
                <textarea
                    value={inputs.background}
                    onChange={(e) => onInputChange("background", e.target.value)}
                    placeholder="例如产品类型、车间类型、评估主题背景"
                />
            </div>

            <div className="form-section span-12 config-panel">
                <h4>评估方法设置</h4>
                <div className="config-grid">
                    <label>
                        危害源识别方法
                        <select
                            value={inputs.riskMethod}
                            onChange={(e) => onInputChange("riskMethod", e.target.value)}
                        >
                            {riskMethods.map((method) => (
                                <option key={method} value={method}>
                                    {method}
                                </option>
                            ))}
                        </select>
                    </label>
                    <label>
                        风险评估工具
                        <select
                            value={inputs.evalTool}
                            onChange={(e) => onInputChange("evalTool", e.target.value)}
                        >
                            {evalTools.map((tool) => (
                                <option key={tool.value} value={tool.value} disabled={tool.disabled}>
                                    {tool.label}
                                </option>
                            ))}
                        </select>
                    </label>
                    {inputs.riskMethod.includes("流程") ? (
                        <label style={{ gridColumn: "1 / -1" }}>
                            流程步骤
                            <textarea
                                value={inputs.processStepsText}
                                onChange={(e) => onInputChange("processStepsText", e.target.value)}
                                placeholder={`每行一个步骤，例如：\n原料接收\n生产准备\n生产操作\n成品放行`}
                            />
                            <span className="muted">每行一个步骤，仅用于流程法危害源识别。</span>
                        </label>
                    ) : null}
                </div>
            </div>
        </>
    );
}
