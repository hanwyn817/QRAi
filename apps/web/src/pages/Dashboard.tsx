import React, { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";

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

export default function Dashboard() {
  const [projects, setProjects] = useState<
    Array<{
      id: string;
      title: string;
      status: string;
      report_count?: number;
      latest_completed_at?: string | null;
    }>
  >([]);
  const [title, setTitle] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();

  const loadProjects = async () => {
    if (!user) {
      return;
    }
    const result = await api.listProjects();
    if (result.data) {
      setProjects(result.data.projects);
    }
  };

  useEffect(() => {
    if (authLoading) {
      return;
    }
    loadProjects();
  }, [authLoading, user]);

  const handleCreate = async () => {
    if (!user) {
      navigate("/login", { state: { from: "/" } });
      return;
    }
    if (!title.trim()) {
      setError("请填写项目标题");
      return;
    }
    setLoading(true);
    const result = await api.createProject(title.trim());
    setLoading(false);
    if (result.error || !result.data) {
      setError(result.error ?? "创建失败");
      return;
    }
    setTitle("");
    navigate(`/projects/${result.data.id}`);
  };

  const handleDelete = async (projectId: string, projectTitle: string) => {
    if (!window.confirm(`确认删除项目「${projectTitle}」？该操作会删除全部报告与设置。`)) {
      return;
    }
    setLoading(true);
    setError(null);
    const result = await api.deleteProject(projectId);
    setLoading(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    await loadProjects();
  };

  return (
    <div className="dashboard">
      <section className="hero-card">
        <div>
          <h2>AI 驱动的质量风险评估平台</h2>
          <p className="muted">
            基于专业大语言模型（LLM）生成合规报告，覆盖 ICH 与 GMP 规范要求，帮助质量团队快速完成风险评估。
          </p>
        </div>
      </section>
      <section className="hero-card">
        <div>
          <h2>新建风险评估项目</h2>
          <p className="muted">
            {user ? "输入标题后即可进入项目流程，逐步补齐评估信息。" : "登录后即可创建并管理评估项目。"}
          </p>
        </div>
        <div className="hero-actions">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="例如：固体制剂车间洁净区风险评估"
            disabled={!user}
          />
          <button onClick={handleCreate} disabled={loading}>
            {loading ? "创建中..." : user ? "创建报告" : "登录后创建"}
          </button>
        </div>
        {error ? <div className="error">{error}</div> : null}
      </section>

      <section className="card">
        <div className="section-header">
          <h3>我的项目</h3>
          <span className="muted">共 {projects.length} 个</span>
        </div>
        {!user ? (
          <div className="empty">登录后可查看项目列表。</div>
        ) : projects.length === 0 ? (
          <div className="empty">暂无项目，请先创建。</div>
        ) : (
          <div className="project-grid">
            {projects.map((project) => (
              <Link key={project.id} to={`/projects/${project.id}`} className="project-card">
                <div className="project-card-header">
                  <h4>{project.title}</h4>
                  <button
                    className="mini-button danger"
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      handleDelete(project.id, project.title);
                    }}
                  >
                    删除
                  </button>
                </div>
                <div className="project-card-meta">
                  <span className="muted">状态：{project.status}</span>
                  <span className="muted">版本数：{project.report_count ?? 0}</span>
                </div>
                <div className="project-card-meta">
                  <span className="muted">最新完成：{formatMinute(project.latest_completed_at)}</span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
