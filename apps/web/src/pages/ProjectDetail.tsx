import React, { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { api } from "../lib/api";
import { extractTextFromFile } from "../lib/fileText";
import { renderMarkdown } from "../lib/markdown";

const RISK_METHODS = ["五因素法"];
const EVAL_TOOLS = ["FMEA", "FMECA", "HAZOP"];

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

export default function ProjectDetail() {
  const { id } = useParams();
  const projectId = id ?? "";
  const apiBase = import.meta.env.VITE_API_BASE ?? "";

  const [projectTitle, setProjectTitle] = useState("");
  const [status, setStatus] = useState("");
  const [inputs, setInputs] = useState({
    scope: "",
    background: "",
    objective: "",
    riskMethod: "五因素法",
    evalTool: "FMEA",
    templateId: ""
  });
  const [templates, setTemplates] = useState<Array<{ id: string; name: string; description: string | null }>>([]);
  const [templateDraft, setTemplateDraft] = useState("");
  const [files, setFiles] = useState<Array<{ id: string; type: string; filename: string; status: string }>>([]);
  const [reports, setReports] = useState<
    Array<{
      id: string;
      version: number;
      status: string;
      created_at: string;
      prompt_tokens: number | null;
      completion_tokens: number | null;
      total_tokens: number | null;
    }>
  >([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamContent, setStreamContent] = useState("");
  const [streamStats, setStreamStats] = useState({ totalChars: 0, speed: "0.0" });
  const [uploadState, setUploadState] = useState({
    sop: { total: 0, done: 0, active: false },
    literature: { total: 0, done: 0, active: false }
  });
  const [dragOver, setDragOver] = useState({ sop: false, literature: false });
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const streamRef = useRef<HTMLDivElement | null>(null);
  const autoScrollRef = useRef(true);
  const streamStartedAtRef = useRef<number | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const selectedTemplate = useMemo(() => {
    return templates.find((template) => template.id === inputs.templateId) ?? null;
  }, [templates, inputs.templateId]);
  const streamHtml = useMemo(() => renderMarkdown(streamContent), [streamContent]);

  const sopProgress = uploadState.sop.total
    ? Math.round((uploadState.sop.done / uploadState.sop.total) * 100)
    : 0;
  const literatureProgress = uploadState.literature.total
    ? Math.round((uploadState.literature.done / uploadState.literature.total) * 100)
    : 0;

  useEffect(() => {
    if (!isStreaming) {
      return;
    }
    const el = streamRef.current;
    if (!el || !autoScrollRef.current) {
      return;
    }
    el.scrollTop = el.scrollHeight;
  }, [isStreaming, streamContent]);

  const loadProject = async () => {
    if (!projectId) {
      return;
    }
    const result = await api.getProject(projectId);
    if (!result.data) {
      return;
    }
    setProjectTitle(result.data.project.title);
    setStatus(result.data.project.status);
    setFiles(result.data.files);
    setReports(result.data.reports);
    setInputs({
      scope: result.data.inputs?.scope ?? "",
      background: result.data.inputs?.background ?? "",
      objective: result.data.inputs?.objective ?? "",
      riskMethod: result.data.inputs?.risk_method ?? "五因素法",
      evalTool: result.data.inputs?.eval_tool ?? "FMEA",
      templateId: result.data.inputs?.template_id ?? ""
    });
  };

  const loadTemplates = async () => {
    const result = await api.listTemplates();
    if (result.data) {
      setTemplates(result.data.templates);
    }
  };

  useEffect(() => {
    loadProject();
    loadTemplates();
  }, [projectId]);

  useEffect(() => {
    if (!inputs.templateId || templateDraft) {
      return;
    }
    api.getTemplate(inputs.templateId).then((result) => {
      if (result.data?.content) {
        setTemplateDraft(result.data.content);
      }
    });
  }, [inputs.templateId, templateDraft]);

  const handleSaveInputs = async (patch: Partial<typeof inputs>) => {
    if (!projectId) {
      return false;
    }
    setLoading(true);
    const result = await api.updateProjectInputs(projectId, {
      scope: patch.scope,
      background: patch.background,
      objective: patch.objective,
      riskMethod: patch.riskMethod,
      evalTool: patch.evalTool,
      templateId: patch.templateId
    });
    setLoading(false);
    if (result.error) {
      setMessage(result.error);
      return false;
    }
    setInputs((prev) => ({ ...prev, ...patch }));
    setMessage("已保存");
    return true;
  };

  const handleSaveAll = async () => {
    await handleSaveInputs({
      scope: inputs.scope,
      background: inputs.background,
      objective: inputs.objective,
      riskMethod: inputs.riskMethod,
      evalTool: inputs.evalTool,
      templateId: inputs.templateId
    });
  };

  const handleTemplateSelect = async (templateId: string) => {
    setInputs((prev) => ({ ...prev, templateId }));
    const template = await api.getTemplate(templateId);
    if (template.data?.content) {
      setTemplateDraft(template.data.content);
    }
  };

  const handleUploadFiles = async (type: "sop" | "literature", fileList: FileList) => {
    if (!projectId) {
      return;
    }
    const filesArray = Array.from(fileList);
    if (filesArray.length === 0) {
      return;
    }
    setLoading(true);
    setMessage(null);
    setUploadState((prev) => ({
      ...prev,
      [type]: { total: filesArray.length, done: 0, active: true }
    }));
    for (const file of filesArray) {
      let extractedText = "";
      try {
        extractedText = await extractTextFromFile(file);
      } catch {
        extractedText = "";
      }
      const form = new FormData();
      form.append("file", file);
      form.append("type", type);
      if (extractedText) {
        form.append("extractedText", extractedText);
      }
      const result = await api.uploadProjectFile(projectId, form);
      if (result.error) {
        setMessage(result.error);
      }
      setUploadState((prev) => ({
        ...prev,
        [type]: {
          ...prev[type],
          done: Math.min(prev[type].done + 1, prev[type].total)
        }
      }));
    }
    setLoading(false);
    setUploadState((prev) => ({
      ...prev,
      [type]: { ...prev[type], active: false }
    }));
    await loadProject();
  };

  const handleDeleteFile = async (fileId: string, filename: string) => {
    if (!projectId) {
      return;
    }
    if (!window.confirm(`确认删除 ${filename} ?`)) {
      return;
    }
    setLoading(true);
    const result = await api.deleteProjectFile(projectId, fileId);
    setLoading(false);
    if (result.error) {
      setMessage(result.error);
      return;
    }
    await loadProject();
  };

  const handleCreateReport = async () => {
    if (!projectId) {
      return;
    }
    setLoading(true);
    setIsStreaming(true);
    setStreamContent("");
    setStreamStats({ totalChars: 0, speed: "0.0" });
    streamStartedAtRef.current = Date.now();
    autoScrollRef.current = true;
    abortControllerRef.current?.abort();
    const abortController = new AbortController();
    abortControllerRef.current = abortController;
    setMessage(null);
    let finished = false;

    try {
      const response = await fetch(`${apiBase}/api/projects/${projectId}/reports/stream`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ templateContent: templateDraft }),
        signal: abortController.signal
      });

      if (!response.ok || !response.body) {
        const text = await response.text();
        setLoading(false);
        setIsStreaming(false);
        setMessage(text || "启动评估失败");
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      const handleEvent = (raw: string) => {
        const lines = raw.split(/\r?\n/);
        let eventName = "message";
        let data = "";
        for (const line of lines) {
          if (line.startsWith("event:")) {
            eventName = line.slice(6).trim();
          }
          if (line.startsWith("data:")) {
            data += line.slice(5).trim();
          }
        }
        if (!data) {
          return;
        }
        let payload: any = null;
        try {
          payload = JSON.parse(data);
        } catch {
          payload = null;
        }
        if (!payload) {
          return;
        }
        if (eventName === "start") {
          setMessage("评估已开始，报告生成中...");
        }
        if (eventName === "delta") {
          const delta = typeof payload.delta === "string" ? payload.delta : "";
          if (!delta) {
            return;
          }
          setStreamContent((prev) => prev + delta);
          setStreamStats((prev) => {
            const totalChars = prev.totalChars + delta.length;
            const startedAt = streamStartedAtRef.current ?? Date.now();
            const elapsedSeconds = Math.max((Date.now() - startedAt) / 1000, 0.5);
            const speed = (totalChars / elapsedSeconds).toFixed(1);
            return { totalChars, speed };
          });
          return;
        }
        if (eventName === "usage") {
          setMessage(`生成中，已统计 Token：${payload.total_tokens ?? "-"}`);
        }
        if (eventName === "done") {
          finished = true;
          setMessage("评估完成");
          setLoading(false);
          setIsStreaming(false);
          abortControllerRef.current = null;
          loadProject();
        }
        if (eventName === "error") {
          finished = true;
          setMessage(payload.message ?? "评估失败");
          setLoading(false);
          setIsStreaming(false);
          abortControllerRef.current = null;
        }
      };

      while (true) {
        const { value, done } = await reader.read();
        if (done) {
          break;
        }
        buffer += decoder.decode(value, { stream: true });
        let boundary = buffer.indexOf("\n\n");
        let boundarySize = 2;
        const crlfBoundary = buffer.indexOf("\r\n\r\n");
        if (crlfBoundary !== -1 && (boundary === -1 || crlfBoundary < boundary)) {
          boundary = crlfBoundary;
          boundarySize = 4;
        }
        while (boundary !== -1) {
          const chunk = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + boundarySize);
          handleEvent(chunk);
          boundary = buffer.indexOf("\n\n");
          boundarySize = 2;
          const nextCrlf = buffer.indexOf("\r\n\r\n");
          if (nextCrlf !== -1 && (boundary === -1 || nextCrlf < boundary)) {
            boundary = nextCrlf;
            boundarySize = 4;
          }
        }
      }
      if (!finished) {
        setLoading(false);
        setIsStreaming(false);
        abortControllerRef.current = null;
        loadProject();
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        setMessage("评估已停止");
        setLoading(false);
        setIsStreaming(false);
        abortControllerRef.current = null;
        loadProject();
        return;
      }
      setLoading(false);
      setIsStreaming(false);
      abortControllerRef.current = null;
      setMessage(error instanceof Error ? error.message : "启动评估失败");
    }
  };

  const handleStopReport = () => {
    if (!isStreaming) {
      return;
    }
    setMessage("正在停止评估...");
    abortControllerRef.current?.abort();
  };

  const handleOpenReport = (reportId: string) => {
    const url = `/reports/${reportId}`;
    window.open(url, "_blank", "noopener,noreferrer");
  };

  const handleDeleteReport = async (reportId: string, version: number) => {
    if (!window.confirm(`确认删除版本 ${version} ?`)) {
      return;
    }
    setLoading(true);
    let result = await api.deleteReport(reportId);
    if (result.error === "评估进行中，无法删除") {
      setLoading(false);
      const force = window.confirm("该版本标记为运行中，是否强制删除？");
      if (!force) {
        return;
      }
      setLoading(true);
      result = await api.deleteReport(reportId, true);
    }
    setLoading(false);
    if (result.error) {
      setMessage(result.error);
      return;
    }
    await loadProject();
  };

  return (
    <div className="project-detail">
      <div className="project-header">
        <div>
          <h2>{projectTitle}</h2>
          <p className="muted">状态：{status}</p>
        </div>
        <div className="header-actions">
          <button className="ghost" onClick={handleSaveAll} disabled={loading}>
            保存项目设置
          </button>
          <button onClick={handleCreateReport} disabled={loading}>
            {loading ? "评估中..." : "开始评估"}
          </button>
          {isStreaming ? (
            <button className="danger" onClick={handleStopReport}>
              停止评估
            </button>
          ) : null}
        </div>
      </div>
      {message ? <div className="info">{message}</div> : null}

      <section className="card">
        <div className="section-header tight">
          <div>
            <h3>评估输入</h3>
          </div>
        </div>

        <div className="input-grid">
          <div className="form-section span-6">
            <h4>评估范围</h4>
            <textarea
              value={inputs.scope}
              onChange={(e) => setInputs((prev) => ({ ...prev, scope: e.target.value }))}
              placeholder="简要描述本次风险评估覆盖的工艺、区域或系统"
            />
          </div>

          <div className="form-section span-6">
            <h4>评估目标</h4>
            <textarea
              value={inputs.objective}
              onChange={(e) => setInputs((prev) => ({ ...prev, objective: e.target.value }))}
              placeholder="例如期望的风险结论或改进方向"
            />
          </div>

          <div className="form-section span-12">
            <h4>背景信息</h4>
            <textarea
              value={inputs.background}
              onChange={(e) => setInputs((prev) => ({ ...prev, background: e.target.value }))}
              placeholder="例如产品类型、车间类型、评估主题背景"
            />
          </div>

          <div className="form-section span-12 config-panel">
            <h4>评估方法设置</h4>
            <div className="config-grid">
              <label>
                风险识别方法
                <select
                  value={inputs.riskMethod}
                  onChange={(e) => setInputs((prev) => ({ ...prev, riskMethod: e.target.value }))}
                >
                  {RISK_METHODS.map((method) => (
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
                  onChange={(e) => setInputs((prev) => ({ ...prev, evalTool: e.target.value }))}
                >
                  {EVAL_TOOLS.map((tool) => (
                    <option key={tool} value={tool}>
                      {tool}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </div>

          <div className="form-section file-panel span-6">
            <h4>上传 SOP 文件</h4>
            <p className="muted">用于体现现有控制措施与管理规定，可选上传。</p>
            <div
              className={`drop-zone ${dragOver.sop ? "active" : ""}`}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver((prev) => ({ ...prev, sop: true }));
              }}
              onDragLeave={() => setDragOver((prev) => ({ ...prev, sop: false }))}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver((prev) => ({ ...prev, sop: false }));
                if (e.dataTransfer.files.length > 0) {
                  handleUploadFiles("sop", e.dataTransfer.files);
                }
              }}
            >
              <input
                className="file-input"
                type="file"
                accept=".pdf,.docx,.txt,.md"
                multiple
                onChange={(e) => {
                  const selected = e.target.files;
                  if (selected) {
                    handleUploadFiles("sop", selected);
                  }
                  e.currentTarget.value = "";
                }}
              />
              <div className="drop-hint">拖拽文件到此处，或点击选择</div>
              {uploadState.sop.active ? (
                <div className="upload-progress">
                  <div className="upload-label">
                    正在上传 {uploadState.sop.done}/{uploadState.sop.total}
                  </div>
                  <div className="upload-track">
                    <div className="upload-bar" style={{ width: `${sopProgress}%` }} />
                  </div>
                </div>
              ) : null}
            </div>
            <div className="file-list">
              {files.filter((f) => f.type === "sop").map((file) => (
                <div key={file.id} className="file-item">
                  <div>
                    <span>{file.filename}</span>
                    <span className="muted"> · {file.status}</span>
                  </div>
                  <button className="text-button" onClick={() => handleDeleteFile(file.id, file.filename)}>
                    删除
                  </button>
                </div>
              ))}
            </div>
          </div>

          <div className="form-section file-panel span-6">
            <h4>上传文献资料</h4>
            <p className="muted">用于识别风险点与控制措施，可选上传。</p>
            <div
              className={`drop-zone ${dragOver.literature ? "active" : ""}`}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver((prev) => ({ ...prev, literature: true }));
              }}
              onDragLeave={() => setDragOver((prev) => ({ ...prev, literature: false }))}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver((prev) => ({ ...prev, literature: false }));
                if (e.dataTransfer.files.length > 0) {
                  handleUploadFiles("literature", e.dataTransfer.files);
                }
              }}
            >
              <input
                className="file-input"
                type="file"
                accept=".pdf,.docx,.txt,.md"
                multiple
                onChange={(e) => {
                  const selected = e.target.files;
                  if (selected) {
                    handleUploadFiles("literature", selected);
                  }
                  e.currentTarget.value = "";
                }}
              />
              <div className="drop-hint">拖拽文件到此处，或点击选择</div>
              {uploadState.literature.active ? (
                <div className="upload-progress">
                  <div className="upload-label">
                    正在上传 {uploadState.literature.done}/{uploadState.literature.total}
                  </div>
                  <div className="upload-track">
                    <div className="upload-bar" style={{ width: `${literatureProgress}%` }} />
                  </div>
                </div>
              ) : null}
            </div>
            <div className="file-list">
              {files.filter((f) => f.type === "literature").map((file) => (
                <div key={file.id} className="file-item">
                  <div>
                    <span>{file.filename}</span>
                    <span className="muted"> · {file.status}</span>
                  </div>
                  <button className="text-button" onClick={() => handleDeleteFile(file.id, file.filename)}>
                    删除
                  </button>
                </div>
              ))}
            </div>
          </div>

          <div className="form-section span-12">
            <div className="section-header compact">
              <div>
                <h4>模板选择与编辑</h4>
                <p className="muted">编辑结果仅对当前项目生效，不回写模板库。</p>
              </div>
            </div>
            <div className="template-picker">
              <div className="template-list">
                {templates.length === 0 ? (
                  <div className="muted">暂无可用模板，请联系管理员上传。</div>
                ) : (
                  templates.map((template) => (
                    <button
                      key={template.id}
                      className={inputs.templateId === template.id ? "template-item active" : "template-item"}
                      onClick={() => handleTemplateSelect(template.id)}
                    >
                      <strong>{template.name}</strong>
                      <span className="muted">{template.description || "无描述"}</span>
                    </button>
                  ))
                )}
              </div>
              <div className="template-editor">
                <label>
                  模板内容（可编辑）
                  <textarea
                    value={templateDraft}
                    onChange={(e) => setTemplateDraft(e.target.value)}
                    placeholder="选择模板后可在此编辑"
                  />
                </label>
              </div>
            </div>
          </div>

          <div className="form-section span-8 action-panel">
            <div className="summary">
              <div>
                <strong>当前项目：</strong>
                <span>{projectTitle}</span>
              </div>
              <div>
                <strong>方法/工具：</strong>
                <span>
                  {inputs.riskMethod} + {inputs.evalTool}
                </span>
              </div>
              <div>
                <strong>模板：</strong>
                <span>{selectedTemplate ? selectedTemplate.name : "未选择模板"}</span>
              </div>
            </div>
          </div>
          <div className="form-section span-4 action-panel">
            <div className="action-buttons">
              <button className="ghost" onClick={handleSaveAll} disabled={loading}>
                保存项目设置
              </button>
              <button onClick={handleCreateReport} disabled={loading}>
                {loading ? "评估中..." : "开始评估"}
              </button>
              {isStreaming ? (
                <button className="danger" onClick={handleStopReport}>
                  停止评估
                </button>
              ) : null}
            </div>
          </div>
        </div>
      </section>

      <section className="card">
        <div className="section-header">
          <h3>报告版本</h3>
          <span className="muted">点击版本在新窗口查看详情</span>
        </div>
        {isStreaming ? (
          <div className="stream-panel">
            <div className="stream-header">
              <strong>实时生成预览</strong>
              <span className="stream-meta">
                <span className="muted">· 平均速度 {streamStats.speed} 字/秒</span>
                <span className="muted">· 已生成 {streamStats.totalChars} 字</span>
              </span>
            </div>
            <div
              className="stream-body"
              ref={streamRef}
              onScroll={() => {
                const el = streamRef.current;
                if (!el) {
                  return;
                }
                const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
                autoScrollRef.current = atBottom;
              }}
            >
              {streamContent ? (
                <div className="markdown-body" dangerouslySetInnerHTML={{ __html: streamHtml }} />
              ) : (
                <div className="stream-hint">评估进行中，内容生成中...</div>
              )}
            </div>
          </div>
        ) : null}
        {reports.length === 0 ? (
          <div className="empty">暂无报告版本</div>
        ) : (
          <div className="report-list">
            {reports.map((report) => (
              <div
                key={report.id}
                className="report-item"
                onClick={() => handleOpenReport(report.id)}
                role="button"
                tabIndex={0}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    handleOpenReport(report.id);
                  }
                }}
              >
                <div className="report-meta">
                  <span>版本 {report.version}</span>
                  <span className="muted">{formatMinute(report.created_at)}</span>
                  <span className="muted">
                    Token: {report.total_tokens ?? "-"}{" "}
                    {report.prompt_tokens || report.completion_tokens
                      ? `(${report.prompt_tokens ?? "-"} / ${report.completion_tokens ?? "-"})`
                      : ""}
                  </span>
                </div>
                <div className="report-actions">
                  <span className={`status-pill status-${report.status}`}>{report.status}</span>
                  <button
                    className="mini-button"
                    onClick={(event) => {
                      event.stopPropagation();
                      handleDeleteReport(report.id, report.version);
                    }}
                  >
                    删除
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
