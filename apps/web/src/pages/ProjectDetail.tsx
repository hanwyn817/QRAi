import React, { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { api } from "../lib/api";
import { extractTextFromFile } from "../lib/fileText";
import { renderMarkdown } from "../lib/markdown";

const RISK_METHODS = ["五因素法"];
const EVAL_TOOLS = ["FMEA", "FMECA", "HAZOP"];
const WORKFLOW_STEPS = [
  { id: "context", label: "准备上下文" },
  { id: "risk_identification", label: "风险识别" },
  { id: "fmea_scoring", label: "风险评价" },
  { id: "action_generation", label: "生成改进措施" },
  { id: "rendering", label: "报告渲染" }
];
type WorkflowStepStatus = "pending" | "running" | "done" | "error";
const VISIBLE_STEP_IDS = new Set(WORKFLOW_STEPS.map((step) => step.id));
type StepOutput = { raw: string; parsed: any | null };

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
  const [stepStats, setStepStats] = useState<Record<string, { totalChars: number; speed: string }>>({});
  const [stepOutputs, setStepOutputs] = useState<Record<string, StepOutput>>({});
  const [activeStepId, setActiveStepId] = useState<string | null>(null);
  const [stepErrors, setStepErrors] = useState<Record<string, string>>({});
  const [globalErrorMessage, setGlobalErrorMessage] = useState<string | null>(null);
  const [workflowSteps, setWorkflowSteps] = useState(
    WORKFLOW_STEPS.map((step) => ({ ...step, status: "pending" as WorkflowStepStatus }))
  );
  const [uploadState, setUploadState] = useState({
    sop: { total: 0, done: 0, active: false },
    literature: { total: 0, done: 0, active: false }
  });
  const [dragOver, setDragOver] = useState({ sop: false, literature: false });
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [highlightedReportId, setHighlightedReportId] = useState<string | null>(null);
  const streamRef = useRef<HTMLDivElement | null>(null);
  const streamPanelRef = useRef<HTMLDivElement | null>(null);
  const stepsRef = useRef<HTMLDivElement | null>(null);
  const autoScrollRef = useRef(true);
  const stepStartTimesRef = useRef<Record<string, number>>({});
  const abortControllerRef = useRef<AbortController | null>(null);
  const hasReportContentRef = useRef(false);
  const hasWorkflowActivity = workflowSteps.some((step) => step.status !== "pending");
  const hasLlmOutput = Object.keys(stepOutputs).length > 0;
  const showWorkflowPanel = isStreaming || Boolean(streamContent) || hasLlmOutput || hasWorkflowActivity;
  const activeStats = stepStats[activeStepId ?? "rendering"] ?? { totalChars: 0, speed: "0.0" };
  const [stepsHeight, setStepsHeight] = useState(0);
  const stepsObserverRef = useRef<ResizeObserver | null>(null);
  const runningStepId = useMemo(
    () => workflowSteps.find((step) => step.status === "running")?.id ?? null,
    [workflowSteps]
  );

  const activeOutputLength = useMemo(() => {
    if (!activeStepId || activeStepId === "rendering") {
      return streamContent.length;
    }
    return stepOutputs[activeStepId]?.raw.length ?? 0;
  }, [activeStepId, stepOutputs, streamContent]);

  const getStepOutputLength = (stepId: string | null) => {
    if (!stepId) {
      return 0;
    }
    if (stepId === "rendering") {
      return streamContent.length;
    }
    return stepOutputs[stepId]?.raw.length ?? 0;
  };

  const updateStatsForStep = (stepId: string, totalChars: number) => {
    const startedAt = stepStartTimesRef.current[stepId] ?? Date.now();
    const elapsedSeconds = Math.max((Date.now() - startedAt) / 1000, 0.5);
    const speed = (totalChars / elapsedSeconds).toFixed(1);
    setStepStats((prev) => ({
      ...prev,
      [stepId]: { totalChars, speed }
    }));
  };

  const selectedTemplate = useMemo(() => {
    return templates.find((template) => template.id === inputs.templateId) ?? null;
  }, [templates, inputs.templateId]);
  const streamHtml = useMemo(() => renderMarkdown(streamContent), [streamContent]);
  const activeStepLabel = useMemo(() => {
    return WORKFLOW_STEPS.find((step) => step.id === activeStepId)?.label ?? "";
  }, [activeStepId]);

  const activeStructuredOutput = useMemo(() => {
    if (!activeStepId || activeStepId === "rendering") {
      return null;
    }
    return stepOutputs[activeStepId]?.parsed ?? null;
  }, [activeStepId, stepOutputs]);

  const activePartialOutput = useMemo(() => {
    if (!activeStepId || activeStepId === "rendering") {
      return null;
    }
    const raw = stepOutputs[activeStepId]?.raw ?? "";
    if (!raw) {
      return null;
    }
    const extractObjects = (text: string) => {
      const objects: Array<Record<string, any>> = [];
      const stack: number[] = [];
      let inString = false;
      let escaped = false;
      for (let i = 0; i < text.length; i += 1) {
        const char = text[i];
        if (escaped) {
          escaped = false;
          continue;
        }
        if (char === "\\") {
          if (inString) {
            escaped = true;
          }
          continue;
        }
        if (char === "\"") {
          inString = !inString;
          continue;
        }
        if (inString) {
          continue;
        }
        if (char === "{") {
          stack.push(i);
        } else if (char === "}") {
          const start = stack.pop();
          if (start !== undefined) {
            const fragment = text.slice(start, i + 1);
            try {
              const parsed = JSON.parse(fragment);
              if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
                objects.push(parsed as Record<string, any>);
              }
            } catch {
              // ignore
            }
          }
        }
      }
      const openStart = stack.length ? stack[stack.length - 1] : -1;
      return { objects, openFragment: openStart >= 0 ? text.slice(openStart) : "" };
    };

    const readStringValue = (fragment: string, key: string) => {
      const keyIndex = fragment.lastIndexOf(`"${key}"`);
      if (keyIndex === -1) {
        return null;
      }
      let cursor = fragment.indexOf(":", keyIndex);
      if (cursor === -1) {
        return null;
      }
      cursor += 1;
      while (cursor < fragment.length && /\s/.test(fragment[cursor])) {
        cursor += 1;
      }
      if (fragment[cursor] !== "\"") {
        return null;
      }
      cursor += 1;
      let value = "";
      let escaped = false;
      for (; cursor < fragment.length; cursor += 1) {
        const ch = fragment[cursor];
        if (escaped) {
          value += ch;
          escaped = false;
          continue;
        }
        if (ch === "\\") {
          escaped = true;
          continue;
        }
        if (ch === "\"") {
          break;
        }
        value += ch;
      }
      return value || null;
    };

    const readNumberValue = (fragment: string, key: string) => {
      const keyIndex = fragment.lastIndexOf(`"${key}"`);
      if (keyIndex === -1) {
        return null;
      }
      let cursor = fragment.indexOf(":", keyIndex);
      if (cursor === -1) {
        return null;
      }
      const match = fragment.slice(cursor + 1).match(/-?\d+/);
      if (!match) {
        return null;
      }
      const num = Number(match[0]);
      return Number.isFinite(num) ? num : null;
    };

    const buildDraft = (fragment: string) => {
      if (!fragment) {
        return null;
      }
      if (activeStepId === "risk_identification") {
        const draft = {
          dimension: readStringValue(fragment, "dimension"),
          failure_mode: readStringValue(fragment, "failure_mode"),
          consequence: readStringValue(fragment, "consequence")
        };
        return draft.dimension || draft.failure_mode || draft.consequence ? { ...draft, _partial: true } : null;
      }
      if (activeStepId === "fmea_scoring") {
        const draft = {
          s: readNumberValue(fragment, "s"),
          s_reason: readStringValue(fragment, "s_reason"),
          p: readNumberValue(fragment, "p"),
          p_reason: readStringValue(fragment, "p_reason"),
          d: readNumberValue(fragment, "d"),
          d_reason: readStringValue(fragment, "d_reason")
        };
        return draft.s || draft.s_reason || draft.p || draft.p_reason || draft.d || draft.d_reason
          ? { ...draft, _partial: true }
          : null;
      }
      if (activeStepId === "action_generation") {
        const draft = {
          type: readStringValue(fragment, "type"),
          action_text: readStringValue(fragment, "action_text"),
          owner_role: readStringValue(fragment, "owner_role"),
          owner_dept: readStringValue(fragment, "owner_dept"),
          planned_date: readStringValue(fragment, "planned_date")
        };
        return draft.type || draft.action_text || draft.owner_role || draft.owner_dept || draft.planned_date
          ? { ...draft, _partial: true }
          : null;
      }
      return null;
    };

    const { objects, openFragment } = extractObjects(raw);
    const draft = buildDraft(openFragment);
    if (activeStepId === "risk_identification") {
      const items = objects.filter((obj) => "failure_mode" in obj && "consequence" in obj && "dimension" in obj);
      const uniq = new Map<string, Record<string, any>>();
      items.forEach((item) => {
        const key = `${item.dimension ?? ""}|${item.failure_mode ?? ""}|${item.consequence ?? ""}`;
        if (!uniq.has(key)) {
          uniq.set(key, item);
        }
      });
      const results = Array.from(uniq.values());
      return { items: draft ? [...results, draft] : results };
    }
    if (activeStepId === "fmea_scoring") {
      const rows = objects.filter((obj) => "s" in obj && "p" in obj && "d" in obj);
      const uniq = new Map<string, Record<string, any>>();
      rows.forEach((row) => {
        const key = String(row.risk_id ?? `${row.s}-${row.p}-${row.d}`);
        if (!uniq.has(key)) {
          uniq.set(key, row);
        }
      });
      const results = Array.from(uniq.values());
      return { rows: draft ? [...results, draft] : results };
    }
    if (activeStepId === "action_generation") {
      const rows = objects.filter((obj) => Array.isArray((obj as any).actions));
      const uniq = new Map<string, Record<string, any>>();
      rows.forEach((row) => {
        const key = String(row.risk_id ?? rows.indexOf(row));
        if (!uniq.has(key)) {
          uniq.set(key, row);
        }
      });
      const results = Array.from(uniq.values());
      return draft ? [...results, { actions: [draft], _partial: true }] : results;
    }
    return null;
  }, [activeStepId, stepOutputs]);

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
  }, [isStreaming, activeOutputLength]);

  useEffect(() => {
    if (!showWorkflowPanel) {
      return;
    }
    const el = stepsRef.current;
    if (!el) {
      return;
    }
    const updateHeight = () => {
      const nextHeight = Math.max(el.getBoundingClientRect().height, 0);
      if (Number.isFinite(nextHeight) && nextHeight > 0) {
        setStepsHeight(Math.round(nextHeight));
      }
    };
    updateHeight();
    if (typeof ResizeObserver === "undefined") {
      return;
    }
    stepsObserverRef.current?.disconnect();
    const observer = new ResizeObserver(() => updateHeight());
    observer.observe(el);
    stepsObserverRef.current = observer;
    return () => observer.disconnect();
  }, [showWorkflowPanel, workflowSteps.length]);

  useEffect(() => {
    if (!activeStepId) {
      return;
    }
    const length = getStepOutputLength(activeStepId);
    updateStatsForStep(activeStepId, length);
  }, [activeStepId, streamContent, stepOutputs]);

  useEffect(() => {
    if (!highlightedReportId) {
      return;
    }
    const timer = window.setTimeout(() => {
      setHighlightedReportId(null);
    }, 6000);
    return () => window.clearTimeout(timer);
  }, [highlightedReportId]);

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

  const resetWorkflowSteps = () => {
    setWorkflowSteps(WORKFLOW_STEPS.map((step) => ({ ...step, status: "pending" as WorkflowStepStatus })));
  };

  const updateWorkflowStep = (stepId: string, status: WorkflowStepStatus) => {
    setWorkflowSteps((prev) =>
      prev.map((step) => (step.id === stepId ? { ...step, status } : step))
    );
  };

  const appendStreamText = (text: string, options?: { replace?: boolean; resetTimer?: boolean }) => {
    if (!text) {
      return;
    }
    if (options?.resetTimer) {
      stepStartTimesRef.current.rendering = Date.now();
    }
    setStreamContent((prev) => {
      const next = options?.replace ? text : prev + text;
      updateStatsForStep("rendering", next.length);
      return next;
    });
  };

  const renderStructuredTable = () => {
    const output = activeStructuredOutput ?? activePartialOutput;
    if (!output) {
      return (
        <div className="stream-hint">
          {activeStepLabel ? `${activeStepLabel} 输出生成中...` : "结构化输出生成中..."}
        </div>
      );
    }
    if (activeStepId === "risk_identification") {
      const items = Array.isArray((output as any).items) ? (output as any).items : [];
      if (items.length === 0) {
        return <div className="stream-hint">正在输出风险识别结果...</div>;
      }
      return (
        <table className="workflow-table">
          <thead>
            <tr>
              <th>序号</th>
              <th>风险维度</th>
              <th>风险点/失效模式</th>
              <th>潜在后果</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item: any, index: number) => (
              <tr key={`${item?.risk_id ?? index}`} className={item?._partial ? "partial" : ""}>
                <td>{index + 1}</td>
                <td>{item?.dimension ?? "-"}</td>
                <td>{item?.failure_mode ?? (item?._partial ? "…" : "-")}</td>
                <td>{item?.consequence ?? (item?._partial ? "…" : "-")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      );
    }
    if (activeStepId === "fmea_scoring") {
      const rows = Array.isArray((output as any).rows) ? (output as any).rows : [];
      if (rows.length === 0) {
        return <div className="stream-hint">正在输出 FMEA 评分...</div>;
      }
      return (
        <table className="workflow-table">
          <thead>
            <tr>
              <th>序号</th>
              <th>S</th>
              <th>S理由</th>
              <th>P</th>
              <th>P理由</th>
              <th>D</th>
              <th>D理由</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row: any, index: number) => (
              <tr key={`${row?.risk_id ?? index}`} className={row?._partial ? "partial" : ""}>
                <td>{index + 1}</td>
                <td>{row?.s ?? "-"}</td>
                <td>{row?.s_reason ?? (row?._partial ? "…" : "-")}</td>
                <td>{row?.p ?? "-"}</td>
                <td>{row?.p_reason ?? (row?._partial ? "…" : "-")}</td>
                <td>{row?.d ?? "-"}</td>
                <td>{row?.d_reason ?? (row?._partial ? "…" : "-")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      );
    }
    if (activeStepId === "action_generation") {
      const rows = Array.isArray(output as any) ? (output as any) : [];
      const flattened: Array<{ seq: number; action: any; partial?: boolean }> = [];
      rows.forEach((entry: any, index: number) => {
        const actions = Array.isArray(entry?.actions) ? entry.actions : [];
        actions.forEach((action: any) => {
          flattened.push({ seq: index + 1, action, partial: Boolean(entry?._partial || action?._partial) });
        });
      });
      if (flattened.length === 0) {
        return <div className="stream-hint">正在输出控制措施...</div>;
      }
      return (
        <table className="workflow-table">
          <thead>
            <tr>
              <th>序号</th>
              <th>动作类型</th>
              <th>措施</th>
              <th>责任角色</th>
              <th>责任部门</th>
              <th>计划完成</th>
            </tr>
          </thead>
          <tbody>
            {flattened.map((item, index) => (
              <tr key={`${item.seq}-${index}`} className={item.partial ? "partial" : ""}>
                <td>{item.seq}</td>
                <td>{item.action?.type ?? "-"}</td>
                <td>{item.action?.action_text ?? (item.partial ? "…" : "-")}</td>
                <td>{item.action?.owner_role ?? (item.partial ? "…" : "-")}</td>
                <td>{item.action?.owner_dept ?? (item.partial ? "…" : "-")}</td>
                <td>{item.action?.planned_date ?? (item.partial ? "…" : "-")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      );
    }
    return <div className="stream-hint">该阶段暂无可展示的结构化输出。</div>;
  };

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
    setStepStats({});
    setStepOutputs({});
    setActiveStepId(null);
    setStepErrors({});
    setGlobalErrorMessage(null);
    resetWorkflowSteps();
    hasReportContentRef.current = false;
    stepStartTimesRef.current = {};
    autoScrollRef.current = true;
    requestAnimationFrame(() => {
      streamPanelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
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
        if (eventName === "step") {
          const stepId = typeof payload.step === "string" ? payload.step : "";
          const status =
            payload.status === "running" || payload.status === "done" || payload.status === "error"
              ? (payload.status as WorkflowStepStatus)
              : null;
          if (!stepId || !status) {
            return;
          }
          if (!VISIBLE_STEP_IDS.has(stepId)) {
            return;
          }
          updateWorkflowStep(stepId, status);
          if (status === "running") {
            const label = WORKFLOW_STEPS.find((step) => step.id === stepId)?.label ?? stepId;
            setMessage(`正在执行：${label}`);
            setActiveStepId(stepId);
            stepStartTimesRef.current[stepId] = Date.now();
          }
          return;
        }
        if (eventName === "delta") {
          const delta = typeof payload.delta === "string" ? payload.delta : "";
          if (!delta) {
            return;
          }
          if (!hasReportContentRef.current) {
            hasReportContentRef.current = true;
            appendStreamText(delta, { replace: true, resetTimer: true });
            return;
          }
          appendStreamText(delta);
          return;
        }
        if (eventName === "llm") {
          const delta = typeof payload.delta === "string" ? payload.delta : "";
          const stepId = typeof payload.step === "string" ? payload.step : "";
          if (!delta) {
            return;
          }
          setStepOutputs((prev) => {
            const current = prev[stepId] ?? { raw: "", parsed: null };
            const raw = current.raw + delta;
            let parsed = current.parsed;
            if (!parsed) {
              try {
                parsed = JSON.parse(raw);
              } catch {
                parsed = null;
              }
            }
            if (activeStepId === stepId) {
              updateStatsForStep(stepId, raw.length);
            }
            return { ...prev, [stepId]: { raw, parsed } };
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
          if (typeof payload.reportId === "string") {
            setHighlightedReportId(payload.reportId);
          }
          setWorkflowSteps((prev) =>
            prev.map((step) => (step.status === "running" ? { ...step, status: "done" } : step))
          );
          loadProject();
        }
        if (eventName === "error") {
          finished = true;
          const errorMessage = typeof payload.message === "string" ? payload.message : "评估失败";
          setMessage(errorMessage);
          setLoading(false);
          setIsStreaming(false);
          abortControllerRef.current = null;
          setWorkflowSteps((prev) =>
            prev.map((step) => (step.status === "running" ? { ...step, status: "error" } : step))
          );
          const targetStep = activeStepId ?? runningStepId ?? "unknown";
          setStepErrors((prev) => ({ ...prev, [targetStep]: errorMessage }));
          setGlobalErrorMessage(errorMessage);
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
        setWorkflowSteps((prev) =>
          prev.map((step) => (step.status === "running" ? { ...step, status: "error" } : step))
        );
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
        {showWorkflowPanel ? (
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
                    onClick={() => {
                      setActiveStepId(step.id);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        setActiveStepId(step.id);
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
                            ? "进行中"
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
        ) : null}
        {reports.length === 0 ? (
          <div className="empty">暂无报告版本</div>
        ) : (
          <div className="report-list">
            {reports.map((report) => (
              <div
                key={report.id}
                className={`report-item ${highlightedReportId === report.id ? "highlight" : ""}`}
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
