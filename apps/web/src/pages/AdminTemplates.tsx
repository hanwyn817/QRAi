import React, { useEffect, useState } from "react";
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

  return (
    <div className="admin-templates">
      <header className="admin-templates-header">
        <div>
          <h2>模板管理</h2>
          <p className="muted">上传、维护并管理评估报告模板。</p>
        </div>
        <div className="admin-templates-meta">
          <span className="muted">模板总数</span>
          <strong>{templates.length}</strong>
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
                  <button
                    className="mini-button danger"
                    onClick={() => handleDelete(template.id, template.name)}
                    disabled={loading}
                  >
                    删除
                  </button>
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
      </div>
    </div>
  );
}
