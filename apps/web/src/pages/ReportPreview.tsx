import React, { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { api } from "../lib/api";
import { renderMarkdown } from "../lib/markdown";

type ReportInfo = {
  id: string;
  project_id: string;
  project_title?: string | null;
  version: number;
  status: string;
  created_at: string;
  error_message: string | null;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  total_tokens: number | null;
};

function formatMinute(value?: string | null) {
  if (!value) {
    return "-";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

export default function ReportPreview() {
  const { id } = useParams();
  const reportId = id ?? "";
  const apiBase = import.meta.env.VITE_API_BASE ?? "";

  const [report, setReport] = useState<ReportInfo | null>(null);
  const [content, setContent] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [exportLink, setExportLink] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const reportHtml = useMemo(() => (content ? renderMarkdown(content) : ""), [content]);

  const loadReport = async () => {
    if (!reportId) {
      setMessage("报告 ID 无效");
      return;
    }
    setLoading(true);
    setMessage(null);
    setExportLink(null);
    const result = await api.getReport(reportId, true);
    setLoading(false);
    if (result.error || !result.data) {
      setMessage(result.error ?? "报告加载失败");
      return;
    }
    setReport(result.data.report as ReportInfo);
    setContent(result.data.content ?? "");
  };

  useEffect(() => {
    loadReport();
  }, [reportId]);

  const handleExport = async () => {
    if (!reportId) {
      return;
    }
    setLoading(true);
    const result = await api.exportReport(reportId, "docx");
    setLoading(false);
    if (result.error || !result.data) {
      setMessage(result.error ?? "导出失败");
      return;
    }
    setExportLink(`${apiBase}/api/exports/${result.data.id}/download`);
  };

  const tokenSummary = report
    ? `总计 ${report.total_tokens ?? "-"}（提示 ${report.prompt_tokens ?? "-"} / 生成 ${
        report.completion_tokens ?? "-"
      }）`
    : "-";
  const reportTitle = report?.project_title?.trim() ? `${report.project_title} ` : "";

  return (
    <div className="report-page">
      <div className="report-header">
        <div>
          <h2>{report ? `${reportTitle}报告版本 ${report.version}` : "报告版本"}</h2>
          <p className="muted">
            状态：{" "}
            <span className={`status-pill status-${report?.status ?? "unknown"}`}>
              {report?.status ?? "-"}
            </span>
          </p>
        </div>
        <div className="report-header-actions">
          <button className="ghost" onClick={handleExport} disabled={loading}>
            导出 Word
          </button>
          {exportLink ? (
            <a className="link" href={exportLink} target="_blank" rel="noreferrer">
              下载导出文件
            </a>
          ) : null}
        </div>
      </div>

      {message ? <div className="info">{message}</div> : null}

      <section className="card">
        <div className="section-header">
          <h3>版本信息</h3>
        </div>
        <div className="report-info-grid">
          <div className="report-info-item">
            <strong>生成时间</strong>
            <span>{formatMinute(report?.created_at)}</span>
          </div>
          <div className="report-info-item">
            <strong>Token 消耗</strong>
            <span>{tokenSummary}</span>
          </div>
          {report?.error_message ? (
            <div className="report-info-item">
              <strong>错误信息</strong>
              <span>{report.error_message}</span>
            </div>
          ) : null}
        </div>
      </section>

      <section className="card">
        <div className="section-header">
          <h3>报告内容</h3>
          {loading ? <span className="muted">加载中...</span> : null}
        </div>
        <div className="report-preview">
          {content ? (
            <div className="markdown-body" dangerouslySetInnerHTML={{ __html: reportHtml }} />
          ) : (
            <div className="muted">暂无报告内容</div>
          )}
        </div>
      </section>
    </div>
  );
}
