import React from "react";

export type WorkflowStepStatus = "pending" | "running" | "done" | "error";

export interface WorkflowStep {
    id: string;
    status: WorkflowStepStatus;
    label: string;
}

interface GenerationPanelProps {
    isStreaming: boolean;
    activeStats: { speed: number | string; totalChars: number };
    workflowSteps: WorkflowStep[];
    activeStepId: string | null;
    onStepSelect: (id: string) => void;
    contextStageMessage: string | null;
    stepErrors: Record<string, string>;
    globalErrorMessage: string | null;
    stepsHeight: number | null;
    streamContent: string;
    streamHtml: string;
    stepsRef: React.RefObject<HTMLDivElement>;
    streamRef: React.RefObject<HTMLDivElement>;
    autoScrollRef: React.MutableRefObject<boolean>;
    streamPanelRef: React.RefObject<HTMLDivElement>;
    renderStructuredTable: () => React.ReactNode;
}

export function GenerationPanel({
    isStreaming,
    activeStats,
    workflowSteps,
    activeStepId,
    onStepSelect,
    contextStageMessage,
    stepErrors,
    globalErrorMessage,
    stepsHeight,
    streamContent,
    streamHtml,
    stepsRef,
    streamRef,
    autoScrollRef,
    streamPanelRef,
    renderStructuredTable
}: GenerationPanelProps) {
    return (
        <div className="stream-panel" ref={streamPanelRef}>
            <div className="stream-header">
                <strong>{isStreaming ? "实时生成预览" : "评估流程回顾"}</strong>
                <span className="stream-meta">
                    <span className="muted">· 平均速度 {activeStats.speed} 字/秒</span>
                    <span className="muted">· 已生成 {activeStats.totalChars} 字</span>
                </span>
            </div>
            <div className="workflow-grid">
                <div className="workflow-steps" ref={stepsRef}>
                    {workflowSteps.map((step) => (
                        <div
                            key={step.id}
                            className={`workflow-step ${step.status} ${activeStepId === step.id ? "selected" : ""}`}
                            role="button"
                            tabIndex={0}
                            onClick={() => onStepSelect(step.id)}
                            onKeyDown={(event) => {
                                if (event.key === "Enter") {
                                    onStepSelect(step.id);
                                }
                            }}
                        >
                            <span className="step-dot" />
                            <div className="step-info">
                                <strong>{step.label}</strong>
                                <span className="muted">
                                    {step.status === "pending"
                                        ? "待执行"
                                        : step.status === "running"
                                            ? step.id === "context" && contextStageMessage
                                                ? `进行中：${contextStageMessage}`
                                                : "进行中"
                                            : step.status === "error"
                                                ? `异常：${stepErrors[step.id] ?? globalErrorMessage ?? "未知错误"}`
                                                : "完成"}
                                </span>
                            </div>
                        </div>
                    ))}
                </div>
                <div
                    className="stream-body"
                    ref={streamRef}
                    style={stepsHeight ? { height: `${stepsHeight}px`, maxHeight: `${stepsHeight}px` } : undefined}
                    onScroll={() => {
                        const el = streamRef.current;
                        if (!el) {
                            return;
                        }
                        const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
                        autoScrollRef.current = atBottom;
                    }}
                >
                    {activeStepId === "rendering" ? (
                        streamContent ? (
                            <div className="markdown-body" dangerouslySetInnerHTML={{ __html: streamHtml }} />
                        ) : (
                            <div className="stream-hint">工作流执行中，报告生成中...</div>
                        )
                    ) : (
                        renderStructuredTable()
                    )}
                </div>
            </div>
        </div>
    );
}
