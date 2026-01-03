import React, { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";

const PLAN_OPTIONS = [
  { value: "free" as const, label: "Free" },
  { value: "pro" as const, label: "Pro" },
  { value: "max" as const, label: "Max" }
];

type AdminUser = {
  id: string;
  email: string;
  role: "admin" | "user";
  plan: "free" | "pro" | "max";
  created_at: string;
  project_count?: number;
  quota_remaining?: number | null;
  quota_cycle_end?: string | null;
  quota_is_unlimited?: boolean;
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

function formatDate(value?: string | null) {
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
    day: "2-digit"
  }).format(date);
}

function formatQuotaRemaining(user: AdminUser) {
  if (user.plan === "max" || user.quota_is_unlimited) {
    return "不限";
  }
  if (typeof user.quota_remaining === "number") {
    return `${user.quota_remaining}`;
  }
  return "-";
}

export default function AdminUsers() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [form, setForm] = useState({ email: "", password: "", plan: "free" as const });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [quotaEdits, setQuotaEdits] = useState<Record<string, string>>({});

  const loadUsers = async () => {
    const result = await api.listUsers();
    if (result.data) {
      setUsers(result.data.users);
    }
  };

  useEffect(() => {
    loadUsers();
  }, []);

  useEffect(() => {
    setQuotaEdits((prev) => {
      const next: Record<string, string> = { ...prev };
      const seen = new Set<string>();
      users.forEach((user) => {
        seen.add(user.id);
        if (user.plan === "max" || user.quota_is_unlimited) {
          delete next[user.id];
          return;
        }
        const value = typeof user.quota_remaining === "number" ? String(user.quota_remaining) : "0";
        next[user.id] = value;
      });
      Object.keys(next).forEach((key) => {
        if (!seen.has(key)) {
          delete next[key];
        }
      });
      return next;
    });
  }, [users]);

  const handleCreate = async () => {
    if (!form.email.trim() || !form.password.trim()) {
      setError("请输入邮箱与初始密码");
      return;
    }
    setLoading(true);
    setError(null);
    setNotice(null);
    const result = await api.createUser({
      email: form.email.trim(),
      password: form.password.trim(),
      plan: form.plan
    });
    setLoading(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    setForm({ email: "", password: "", plan: "free" });
    setNotice("用户已创建");
    await loadUsers();
  };

  const handlePlanChange = async (userId: string, plan: "free" | "pro" | "max") => {
    setLoading(true);
    setError(null);
    setNotice(null);
    const result = await api.updateUserPlan(userId, plan);
    setLoading(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    setNotice("用户等级已更新");
    await loadUsers();
  };

  const handleDelete = async (userId: string, email: string) => {
    if (!window.confirm(`确认删除用户「${email}」？`)) {
      return;
    }
    setLoading(true);
    setError(null);
    setNotice(null);
    const result = await api.deleteUser(userId);
    setLoading(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    setNotice("用户已删除");
    await loadUsers();
  };

  const handleQuotaUpdate = async (userId: string) => {
    const raw = quotaEdits[userId] ?? "";
    const value = Number(raw);
    if (!Number.isFinite(value) || value < 0 || !Number.isInteger(value)) {
      setError("剩余次数必须为非负整数");
      return;
    }
    setLoading(true);
    setError(null);
    setNotice(null);
    const result = await api.updateUserQuotaRemaining(userId, value);
    setLoading(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    setNotice("剩余次数已更新");
    await loadUsers();
  };

  const userCount = useMemo(() => users.length, [users]);

  return (
    <div className="admin-users">
      <header className="admin-templates-header">
        <div>
          <h2>用户管理</h2>
          <p className="muted">新增、删除用户并配置等级。</p>
        </div>
        <div className="admin-templates-meta">
          <span className="muted">用户总数</span>
          <strong>{userCount}</strong>
        </div>
      </header>

      <div className="admin-users-grid">
        <section className="card">
          <div className="section-header">
            <h3>新增用户</h3>
            <span className="muted">默认为 Free</span>
          </div>
          <div className="form-grid admin-form-grid">
            <label>
              邮箱
              <input value={form.email} onChange={(e) => setForm((prev) => ({ ...prev, email: e.target.value }))} />
            </label>
            <label>
              初始密码
              <input
                type="password"
                value={form.password}
                onChange={(e) => setForm((prev) => ({ ...prev, password: e.target.value }))}
              />
            </label>
            <label>
              等级
              <select
                value={form.plan}
                onChange={(e) => setForm((prev) => ({ ...prev, plan: e.target.value as typeof form.plan }))}
              >
                {PLAN_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {error ? <div className="error">{error}</div> : null}
          {notice ? <div className="info">{notice}</div> : null}
          <div className="admin-actions">
            <button onClick={handleCreate} disabled={loading}>
              {loading ? "保存中..." : "创建用户"}
            </button>
            <span className="muted small">删除用户前需先清理其项目。</span>
          </div>
        </section>

        <section className="card">
          <div className="section-header">
            <h3>用户列表</h3>
            <span className="muted">按创建时间排序</span>
          </div>
          {users.length === 0 ? (
            <div className="empty">暂无用户</div>
          ) : (
            <div className="user-grid">
              {users.map((user) => (
                <div key={user.id} className="user-card">
                  <div className="user-meta">
                    <strong>{user.email}</strong>
                    <div className="muted small">创建：{formatMinute(user.created_at)}</div>
                    <div className="muted small">项目数：{user.project_count ?? 0}</div>
                    <div className="muted small">剩余次数：{formatQuotaRemaining(user)}</div>
                    <div className="muted small">截止：{formatDate(user.quota_cycle_end)}</div>
                  </div>
                  <div className="user-actions">
                    {user.plan === "max" || user.quota_is_unlimited ? (
                      <span className="muted small">Max 用户不限次数</span>
                    ) : (
                      <div className="quota-edit">
                        <input
                          type="number"
                          min="0"
                          step="1"
                          value={quotaEdits[user.id] ?? ""}
                          onChange={(e) =>
                            setQuotaEdits((prev) => ({ ...prev, [user.id]: e.target.value }))
                          }
                          disabled={loading}
                        />
                        <button
                          className="mini-button"
                          onClick={() => handleQuotaUpdate(user.id)}
                          disabled={loading}
                        >
                          更新次数
                        </button>
                      </div>
                    )}
                    <select
                      value={user.plan}
                      onChange={(e) => handlePlanChange(user.id, e.target.value as "free" | "pro" | "max")}
                      disabled={loading}
                    >
                      {PLAN_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                    <button
                      className="mini-button danger"
                      onClick={() => handleDelete(user.id, user.email)}
                      disabled={loading || user.role === "admin"}
                      title={user.role === "admin" ? "管理员账号不可删除" : ""}
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
    </div>
  );
}
