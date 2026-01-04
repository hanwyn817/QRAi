import React, { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../lib/api";

const CATEGORY_OPTIONS = [
  { value: "text" as const, label: "文本生成模型", hint: "用于报告生成与评估推理" },
  { value: "embedding" as const, label: "Embedding 模型", hint: "用于向量检索与上下文构建" },
  { value: "rerank" as const, label: "Rerank 模型", hint: "用于候选排序（预留）" }
];
const PLAN_OPTIONS = [
  { value: "free" as const, label: "Free" },
  { value: "pro" as const, label: "Pro" },
  { value: "max" as const, label: "Max" }
];

type AdminModel = {
  id: string;
  name: string;
  category: "text" | "embedding" | "rerank";
  model_name: string;
  base_url: string;
  api_key_masked: string;
  is_default: boolean;
  is_active: boolean;
  updated_at: string;
  allowed_plans: Array<"free" | "pro" | "max">;
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

export default function AdminModels() {
  const [models, setModels] = useState<AdminModel[]>([]);
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const [form, setForm] = useState({
    name: "",
    category: "text" as const,
    modelName: "",
    baseUrl: "",
    apiKey: "",
    isDefault: false,
    allowedPlans: ["free"] as Array<"free" | "pro" | "max">
  });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({
    name: "",
    category: "text" as const,
    modelName: "",
    baseUrl: "",
    apiKey: "",
    isDefault: false,
    allowedPlans: ["free"] as Array<"free" | "pro" | "max">
  });
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const activeModels = useMemo(() => models.filter((model) => model.is_active), [models]);
  const modelsByCategory = useMemo(() => {
    return CATEGORY_OPTIONS.reduce(
      (acc, option) => {
        acc[option.value] = activeModels.filter((model) => model.category === option.value);
        return acc;
      },
      {
        text: [] as AdminModel[],
        embedding: [] as AdminModel[],
        rerank: [] as AdminModel[]
      }
    );
  }, [activeModels]);

  const defaultByCategory = useMemo(() => {
    const defaults = { text: "", embedding: "", rerank: "" } as Record<
      "text" | "embedding" | "rerank",
      string
    >;
    activeModels.forEach((model) => {
      if (model.is_default) {
        defaults[model.category] = model.id;
      }
    });
    return defaults;
  }, [activeModels]);

  const loadModels = async () => {
    const result = await api.listAdminModels();
    if (result.data) {
      setModels(result.data.models);
    }
  };

  useEffect(() => {
    loadModels();
  }, []);

  const handleCreate = async () => {
    if (!form.name.trim() || !form.modelName.trim() || !form.baseUrl.trim() || !form.apiKey.trim()) {
      setError("请完整填写模型名称、标识、Base URL 与 API Key");
      return;
    }
    setLoading(true);
    setError(null);
    setNotice(null);
    const result = await api.createModel({
      name: form.name.trim(),
      category: form.category,
      modelName: form.modelName.trim(),
      baseUrl: form.baseUrl.trim(),
      apiKey: form.apiKey.trim(),
      isDefault: form.isDefault,
      allowedPlans: form.allowedPlans
    });
    setLoading(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    setForm({
      name: "",
      category: "text",
      modelName: "",
      baseUrl: "",
      apiKey: "",
      isDefault: false,
      allowedPlans: ["free"]
    });
    setNotice("模型已保存");
    await loadModels();
  };

  const togglePlan = (
    plans: Array<"free" | "pro" | "max">,
    plan: "free" | "pro" | "max"
  ) => {
    if (plans.includes(plan)) {
      const next = plans.filter((item) => item !== plan);
      return next.length > 0 ? next : plans;
    }
    return [...plans, plan];
  };

  const handleEditStart = (model: AdminModel) => {
    setEditingId(model.id);
    setEditForm({
      name: model.name,
      category: model.category,
      modelName: model.model_name,
      baseUrl: model.base_url,
      apiKey: "",
      isDefault: model.is_default,
      allowedPlans: model.allowed_plans.length > 0 ? model.allowed_plans : ["free"]
    });
    setError(null);
    setNotice(null);
  };

  const handleEditCancel = () => {
    setEditingId(null);
    setEditForm({
      name: "",
      category: "text",
      modelName: "",
      baseUrl: "",
      apiKey: "",
      isDefault: false,
      allowedPlans: ["free"]
    });
  };

  const handleEditSave = async () => {
    if (!editingId) {
      return;
    }
    if (!editForm.name.trim() || !editForm.modelName.trim() || !editForm.baseUrl.trim()) {
      setError("请完整填写模型名称、标识与 Base URL");
      return;
    }
    setLoading(true);
    setError(null);
    setNotice(null);
    const payload: {
      name: string;
      category: "text" | "embedding" | "rerank";
      modelName: string;
      baseUrl: string;
      apiKey?: string;
      isDefault?: boolean;
      allowedPlans?: Array<"free" | "pro" | "max">;
    } = {
      name: editForm.name.trim(),
      category: editForm.category,
      modelName: editForm.modelName.trim(),
      baseUrl: editForm.baseUrl.trim(),
      isDefault: editForm.isDefault,
      allowedPlans: editForm.allowedPlans
    };
    if (editForm.apiKey.trim()) {
      payload.apiKey = editForm.apiKey.trim();
    }
    const result = await api.updateModel(editingId, payload);
    setLoading(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    setEditingId(null);
    setNotice("模型已更新");
    await loadModels();
  };

  const handleSetDefault = async (modelId: string) => {
    setLoading(true);
    setError(null);
    setNotice(null);
    const result = await api.updateModel(modelId, { isDefault: true });
    setLoading(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    setNotice("默认模型已更新");
    await loadModels();
  };

  const handleDelete = async (modelId: string, modelName: string) => {
    if (!window.confirm(`确认删除模型「${modelName}」？删除后不可恢复。`)) {
      return;
    }
    setLoading(true);
    setError(null);
    setNotice(null);
    const result = await api.deleteModel(modelId);
    setLoading(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    setNotice("模型已删除");
    await loadModels();
  };

  const handleExport = async () => {
    setLoading(true);
    setError(null);
    setNotice(null);
    const result = await api.exportAdminModels();
    setLoading(false);
    if (!result.data) {
      setError(result.error ?? "模型导出失败");
      return;
    }
    const payload = { models: result.data.models };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `models-export-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    setNotice("模型已导出");
  };

  const handleImportFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const selected = event.target.files?.[0] ?? null;
    event.target.value = "";
    if (!selected) {
      return;
    }
    setLoading(true);
    setError(null);
    setNotice(null);
    let payload: unknown = null;
    try {
      const text = await selected.text();
      payload = JSON.parse(text);
    } catch {
      setLoading(false);
      setError("导入文件不是有效的 JSON");
      return;
    }
    const rawModels = Array.isArray((payload as { models?: unknown }).models)
      ? ((payload as { models: Array<Record<string, unknown>> }).models ?? [])
      : null;
    if (!rawModels) {
      setLoading(false);
      setError("导入文件缺少 models 字段");
      return;
    }
    const modelsPayload = rawModels.map((model) => ({
      name: typeof model.name === "string" ? model.name : "",
      category: model.category as "text" | "embedding" | "rerank",
      model_name: typeof model.model_name === "string" ? model.model_name : typeof model.modelName === "string" ? model.modelName : "",
      base_url: typeof model.base_url === "string" ? model.base_url : typeof model.baseUrl === "string" ? model.baseUrl : "",
      api_key: typeof model.api_key === "string" ? model.api_key : typeof model.apiKey === "string" ? model.apiKey : "",
      is_default: typeof model.is_default === "boolean" ? model.is_default : typeof model.isDefault === "boolean" ? model.isDefault : undefined,
      is_active: typeof model.is_active === "boolean" ? model.is_active : typeof model.isActive === "boolean" ? model.isActive : undefined,
      allowed_plans: Array.isArray(model.allowed_plans)
        ? (model.allowed_plans as Array<"free" | "pro" | "max">)
        : Array.isArray(model.allowedPlans)
          ? (model.allowedPlans as Array<"free" | "pro" | "max">)
          : undefined
    }));
    const result = await api.importAdminModels({ models: modelsPayload });
    setLoading(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    setNotice(`模型已导入（${result.data?.count ?? 0} 条）`);
    await loadModels();
  };

  return (
    <div className="admin-models">
      <header className="admin-templates-header">
        <div>
          <h2>模型管理</h2>
          <p className="muted">管理 OpenAI 兼容模型，按类别设置默认模型。</p>
        </div>
        <div className="admin-templates-side">
          <div className="admin-templates-meta">
            <span className="muted">模型总数</span>
            <strong>{activeModels.length}</strong>
          </div>
          <div className="admin-actions">
            <button className="mini-button" onClick={handleExport} disabled={loading}>
              导出
            </button>
            <button
              className="mini-button"
              onClick={() => importInputRef.current?.click()}
              disabled={loading}
            >
              导入
            </button>
            <input
              ref={importInputRef}
              type="file"
              accept="application/json"
              onChange={handleImportFile}
              style={{ display: "none" }}
            />
          </div>
        </div>
      </header>

      <div className="admin-models-grid">
        <section className="card">
          <div className="section-header">
            <h3>新增模型</h3>
            <span className="muted">仅管理员可见</span>
          </div>
          <div className="form-grid admin-form-grid">
            <label>
              模型名称
              <input value={form.name} onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))} />
            </label>
            <label>
              模型类别
              <select
                value={form.category}
                onChange={(e) => setForm((prev) => ({ ...prev, category: e.target.value as typeof form.category }))}
              >
                {CATEGORY_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              模型标识（OpenAI compatible model）
              <input
                value={form.modelName}
                onChange={(e) => setForm((prev) => ({ ...prev, modelName: e.target.value }))}
                placeholder="例如 gpt-4o-mini"
              />
            </label>
            <label>
              Base URL（OpenAI 兼容）
              <input
                value={form.baseUrl}
                onChange={(e) => setForm((prev) => ({ ...prev, baseUrl: e.target.value }))}
                placeholder="https://api.openai.com/v1"
              />
            </label>
            <label>
              API Key
              <input
                type="password"
                value={form.apiKey}
                onChange={(e) => setForm((prev) => ({ ...prev, apiKey: e.target.value }))}
                placeholder="仅保存到服务器，不回传"
              />
            </label>
            <label className="span-full">
              可用等级
              <div className="pill-group">
                {PLAN_OPTIONS.map((option) => (
                  <label key={option.value} className="pill">
                    <input
                      type="checkbox"
                      checked={form.allowedPlans.includes(option.value)}
                      onChange={() =>
                        setForm((prev) => ({
                          ...prev,
                          allowedPlans: togglePlan(prev.allowedPlans, option.value)
                        }))
                      }
                    />
                    {option.label}
                  </label>
                ))}
              </div>
            </label>
          </div>
          <div className="admin-actions">
            <button onClick={handleCreate} disabled={loading}>
              {loading ? "保存中..." : "保存模型"}
            </button>
            <label className="toggle">
              <input
                type="checkbox"
                checked={form.isDefault}
                onChange={(e) => setForm((prev) => ({ ...prev, isDefault: e.target.checked }))}
              />
              设为默认模型
            </label>
            <span className="muted small">将使用 /chat/completions 与 /embeddings 接口。</span>
          </div>
          {error ? <div className="error">{error}</div> : null}
          {notice ? <div className="info">{notice}</div> : null}
        </section>

        {CATEGORY_OPTIONS.map((category) => {
          const items = modelsByCategory[category.value];
          const defaultId = defaultByCategory[category.value];
          return (
            <section key={category.value} className="card">
              <div className="section-header">
                <div>
                  <h3>{category.label}</h3>
                  <p className="muted">{category.hint}</p>
                </div>
                <div className="muted small">
                  默认：{defaultId ? items.find((item) => item.id === defaultId)?.name ?? "-" : "未设置"}
                </div>
              </div>
              {items.length === 0 ? (
                <div className="empty">暂无模型</div>
              ) : (
                <div className="model-grid">
                  {items.map((model) => (
                    <div key={model.id} className={`model-card ${model.is_default ? "default" : ""}`}>
                      <div className="model-card-header">
                        <div>
                          <h4>{model.name}</h4>
                          <span className="muted small">{model.model_name}</span>
                        </div>
                        {model.is_default ? <span className="model-badge">默认</span> : null}
                      </div>
                      <div className="model-meta">
                        <span className="muted">Base URL：{model.base_url}</span>
                        <span className="muted">API Key：{model.api_key_masked || "已保存"}</span>
                        <span className="muted">可用等级：{model.allowed_plans.join(" / ") || "Free"}</span>
                        <span className="muted">更新：{formatMinute(model.updated_at)}</span>
                      </div>
                      <div className="admin-actions">
                        <button
                          className="mini-button"
                          onClick={() => handleSetDefault(model.id)}
                          disabled={loading || model.is_default}
                        >
                          设为默认
                        </button>
                        <button className="mini-button" onClick={() => handleEditStart(model)} disabled={loading}>
                          编辑
                        </button>
                        <button
                          className="mini-button danger"
                          onClick={() => handleDelete(model.id, model.name)}
                          disabled={loading}
                        >
                          删除
                        </button>
                      </div>
                      {editingId === model.id ? (
                        <div className="model-edit">
                          <div className="form-grid admin-form-grid">
                            <label>
                              模型名称
                              <input
                                value={editForm.name}
                                onChange={(e) => setEditForm((prev) => ({ ...prev, name: e.target.value }))}
                              />
                            </label>
                            <label>
                              模型类别
                              <select
                                value={editForm.category}
                                onChange={(e) =>
                                  setEditForm((prev) => ({ ...prev, category: e.target.value as typeof editForm.category }))
                                }
                              >
                                {CATEGORY_OPTIONS.map((option) => (
                                  <option key={option.value} value={option.value}>
                                    {option.label}
                                  </option>
                                ))}
                              </select>
                            </label>
                            <label>
                              模型标识
                              <input
                                value={editForm.modelName}
                                onChange={(e) => setEditForm((prev) => ({ ...prev, modelName: e.target.value }))}
                              />
                            </label>
                            <label>
                              Base URL
                              <input
                                value={editForm.baseUrl}
                                onChange={(e) => setEditForm((prev) => ({ ...prev, baseUrl: e.target.value }))}
                              />
                            </label>
                            <label>
                              API Key（留空保持不变）
                              <input
                                type="password"
                                value={editForm.apiKey}
                                onChange={(e) => setEditForm((prev) => ({ ...prev, apiKey: e.target.value }))}
                              />
                            </label>
                            <label className="span-full">
                              可用等级
                              <div className="pill-group">
                                {PLAN_OPTIONS.map((option) => (
                                  <label key={option.value} className="pill">
                                    <input
                                      type="checkbox"
                                      checked={editForm.allowedPlans.includes(option.value)}
                                      onChange={() =>
                                        setEditForm((prev) => ({
                                          ...prev,
                                          allowedPlans: togglePlan(prev.allowedPlans, option.value)
                                        }))
                                      }
                                    />
                                    {option.label}
                                  </label>
                                ))}
                              </div>
                            </label>
                          </div>
                          <div className="admin-actions">
                            <label className="toggle">
                              <input
                                type="checkbox"
                                checked={editForm.isDefault}
                                onChange={(e) => setEditForm((prev) => ({ ...prev, isDefault: e.target.checked }))}
                              />
                              设为默认模型
                            </label>
                            <button onClick={handleEditSave} disabled={loading}>
                              {loading ? "保存中..." : "保存修改"}
                            </button>
                            <button className="ghost" onClick={handleEditCancel} disabled={loading}>
                              取消
                            </button>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}
