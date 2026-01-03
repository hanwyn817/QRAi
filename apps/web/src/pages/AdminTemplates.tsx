import React, { useEffect, useRef, useState } from "react";
import { api } from "../lib/api";

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

export default function AdminTemplates() {
  const [templates, setTemplates] = useState<
    Array<{ id: string; name: string; description: string | null; updated_at?: string }>
  >([]);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editContent, setEditContent] = useState("");
  const editSectionRef = useRef<HTMLDivElement | null>(null);
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const loadTemplates = async () => {
    const result = await api.listTemplates();
    if (result.data) {
      setTemplates(result.data.templates);
    }
  };

  useEffect(() => {
    loadTemplates();
  }, []);

  const handleUpload = async () => {
    if (!name.trim() || !file) {
      setError("请填写模板名称并选择文件");
      return;
    }
    setError(null);
    setNotice(null);
    setLoading(true);
    const form = new FormData();
    form.append("name", name.trim());
    form.append("description", description.trim());
    form.append("file", file);
    const result = await api.uploadTemplate(form);
    setLoading(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    setName("");
    setDescription("");
    setFile(null);
    setNotice("模板已上传");
    await loadTemplates();
  };

  const handleEditStart = async (id: string) => {
    setLoading(true);
    setError(null);
    setNotice(null);
    const result = await api.getTemplate(id);
    setLoading(false);
    if (!result.data) {
      setError(result.error ?? "模板加载失败");
      return;
    }
    setEditingId(id);
    setEditName(result.data.name);
    setEditDescription(result.data.description ?? "");
    setEditContent(result.data.content ?? "");
    requestAnimationFrame(() => {
      editSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  };

  const handleEditCancel = () => {
    setEditingId(null);
    setEditName("");
    setEditDescription("");
    setEditContent("");
  };

  const handleEditSave = async () => {
    if (!editingId) {
      return;
    }
    if (!editName.trim()) {
      setError("模板名称不能为空");
      return;
    }
    setLoading(true);
    setError(null);
    setNotice(null);
    const result = await api.updateTemplate(editingId, {
      name: editName.trim(),
      description: editDescription.trim(),
      content: editContent
    });
    setLoading(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    setNotice("模板已更新");
    handleEditCancel();
    await loadTemplates();
  };

  const handleDuplicate = async (id: string, templateName: string) => {
    if (!window.confirm(`确认复制模板「${templateName}」？`)) {
      return;
    }
    setLoading(true);
    setError(null);
    setNotice(null);
    const result = await api.duplicateTemplate(id);
    setLoading(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    setNotice("模板副本已创建");
    await loadTemplates();
  };

  const handleDelete = async (id: string, templateName: string) => {
    if (!window.confirm(`确认删除模板「${templateName}」？删除后不可恢复。`)) {
      return;
    }
    setLoading(true);
    setError(null);
    setNotice(null);
    const result = await api.deleteTemplate(id);
    setLoading(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    setNotice("模板已删除");
    await loadTemplates();
  };

  const handleExport = async () => {
    setLoading(true);
    setError(null);
    setNotice(null);
    const result = await api.exportTemplates();
    setLoading(false);
    if (!result.data) {
      setError(result.error ?? "模板导出失败");
      return;
    }
    const payload = { templates: result.data.templates };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `templates-export-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    setNotice("模板已导出");
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
    const templates = Array.isArray((payload as { templates?: unknown }).templates)
      ? ((payload as { templates: Array<{ name: string; description?: string | null; content: string }> }).templates ?? [])
      : null;
    if (!templates) {
      setLoading(false);
      setError("导入文件缺少 templates 字段");
      return;
    }
    const result = await api.importTemplates({ templates });
    setLoading(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    setNotice(`模板已导入（${result.data?.count ?? 0} 条）`);
    await loadTemplates();
  };

  return (
    <div className="admin-templates">
      <header className="admin-templates-header">
        <div>
          <h2>模板管理</h2>
          <p className="muted">上传、维护并管理评估报告模板。</p>
        </div>
        <div className="admin-templates-side">
          <div className="admin-templates-meta">
            <span className="muted">模板总数</span>
            <strong>{templates.length}</strong>
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

      <div className="admin-templates-grid">
      <section className="card">
        <div className="section-header">
          <h3>上传模板</h3>
          <span className="muted">仅管理员可见</span>
        </div>
        <div className="form-grid admin-form-grid">
          <label>
            模板名称
            <input value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label>
            模板描述
            <input value={description} onChange={(e) => setDescription(e.target.value)} />
          </label>
          <label>
            Markdown 文件
            <input
              type="file"
              accept=".md"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
            <span className="muted small">{file ? `已选择：${file.name}` : "仅支持 .md 文件"}</span>
          </label>
        </div>
        {error ? <div className="error">{error}</div> : null}
        {notice ? <div className="info">{notice}</div> : null}
        <div className="admin-actions">
          <button onClick={handleUpload} disabled={loading}>
            {loading ? "上传中..." : "上传模板"}
          </button>
          <span className="muted small">上传后模板可在项目中直接选择。</span>
        </div>
      </section>

      <section className="card">
        <div className="section-header">
          <h3>模板列表</h3>
          <span className="muted">按更新时间排序</span>
        </div>
        {templates.length === 0 ? (
          <div className="empty">暂无模板</div>
        ) : (
          <div className="template-grid">
            {templates.map((template) => (
              <div key={template.id} className="template-card">
                <div className="template-card-header">
                  <h4>{template.name}</h4>
                  <div className="inline-actions">
                    <button
                      className="mini-button"
                      onClick={() => handleEditStart(template.id)}
                      disabled={loading}
                    >
                      编辑
                    </button>
                    <button
                      className="mini-button"
                      onClick={() => handleDuplicate(template.id, template.name)}
                      disabled={loading}
                    >
                      复制
                    </button>
                    <button
                      className="mini-button danger"
                      onClick={() => handleDelete(template.id, template.name)}
                      disabled={loading}
                    >
                      删除
                    </button>
                  </div>
                </div>
                <p className="muted">{template.description || "无描述"}</p>
                <div className="template-meta">
                  <span className="muted">更新：{formatMinute(template.updated_at)}</span>
                  <code className="muted">{template.id}</code>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
      {editingId ? (
        <section className="card" ref={editSectionRef}>
          <div className="section-header">
            <h3>编辑模板</h3>
            <span className="muted">修改名称、描述或内容</span>
          </div>
          <div className="form-grid admin-form-grid">
            <label>
              模板名称
              <input value={editName} onChange={(e) => setEditName(e.target.value)} />
            </label>
            <label>
              模板描述
              <input value={editDescription} onChange={(e) => setEditDescription(e.target.value)} />
            </label>
            <label className="span-full">
              模板内容
              <textarea
                value={editContent}
                onChange={(e) => setEditContent(e.target.value)}
                placeholder="编辑模板内容"
              />
            </label>
          </div>
          {error ? <div className="error">{error}</div> : null}
          {notice ? <div className="info">{notice}</div> : null}
          <div className="admin-actions">
            <button onClick={handleEditSave} disabled={loading}>
              {loading ? "保存中..." : "保存修改"}
            </button>
            <button className="ghost" onClick={handleEditCancel} disabled={loading}>
              取消
            </button>
          </div>
        </section>
      ) : null}
      </div>
    </div>
  );
}
