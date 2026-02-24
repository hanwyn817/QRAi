import React from "react";

interface ReportHeaderProps {
    title: string;
    status: string;
    loading: boolean;
    isStreaming: boolean;
    startDisabled: boolean;
    onSaveAll: () => void;
    onCreateReport: () => void;
    onStopReport: () => void;
    modelSelectNode: React.ReactNode;
}

export function ReportHeader({
    title,
    status,
    loading,
    isStreaming,
    startDisabled,
    onSaveAll,
    onCreateReport,
    onStopReport,
    modelSelectNode
}: ReportHeaderProps) {
    return (
        <div className="project-header">
            <div>
                <h2>{title}</h2>
                <p className="muted">状态：{status}</p>
            </div>
            <div className="header-actions">
                <button className="ghost" onClick={onSaveAll} disabled={loading}>
                    保存项目设置
                </button>
                {modelSelectNode}
                <button onClick={onCreateReport} disabled={startDisabled}>
                    {loading ? "评估中..." : "开始评估"}
                </button>
                {isStreaming ? (
                    <button className="danger" onClick={onStopReport}>
                        停止评估
                    </button>
                ) : null}
            </div>
        </div>
    );
}
