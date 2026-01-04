import React, { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth";

export default function Register() {
  const { register } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [adminKey, setAdminKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setLoading(true);
    const err = await register(email, password, adminKey || undefined);
    setLoading(false);
    if (err) {
      setError(err);
      return;
    }
    navigate("/");
  };

  return (
    <div className="auth-page">
      <div className="auth-card">
        <h1>创建 QRAi 账户</h1>
        <p className="muted">开启你的风险评估项目，模板与报告集中管理。</p>
        <form onSubmit={handleSubmit} className="form">
          <label>
            邮箱
            <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" required />
          </label>
          <label>
            密码（至少 6 位）
            <input
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              type="password"
              required
            />
          </label>
          <label>
            管理员密钥（可选）
            <input value={adminKey} onChange={(e) => setAdminKey(e.target.value)} type="password" />
          </label>
          {error ? <div className="error">{error}</div> : null}
          <button type="submit" disabled={loading}>
            {loading ? "创建中..." : "创建账户"}
          </button>
        </form>
        <div className="auth-footer">
          <span>已有账号？</span>
          <Link to="/login">立即登录</Link>
        </div>
      </div>
    </div>
  );
}
