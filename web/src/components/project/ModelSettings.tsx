import React from "react";

export interface ModelOption {
    id: string;
    name: string;
    model_name: string;
    is_default: boolean;
}

interface ModelSettingsProps {
    className?: string;
    models: ModelOption[];
    value: string;
    onChange: (value: string) => void;
    disabled?: boolean;
}

export function ModelSettings({ className, models, value, onChange, disabled }: ModelSettingsProps) {
    const noModels = models.length === 0;
    return (
        <div className={`model-select ${className ?? ""}`.trim()}>
            <span className="muted small">评估模型（OpenAI 兼容）</span>
            <select
                value={value}
                onChange={(e) => onChange(e.target.value)}
                disabled={noModels || disabled}
            >
                {noModels ? (
                    <option value="">暂无可用模型</option>
                ) : (
                    models.map((model) => (
                        <option key={model.id} value={model.id}>
                            {model.name} · {model.model_name}
                            {model.is_default ? "（默认）" : ""}
                        </option>
                    ))
                )}
            </select>
        </div>
    );
}
