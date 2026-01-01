import React, { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth";

export default function Login() {
  const { login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setLoading(true);
    const err = await login(email, password);
    setLoading(false);
    if (err) {
      setError(err);
      return;
    }
    const target = (location.state as { from?: string } | null)?.from ?? "/";
    navigate(target);
  };

  return (
    <div className="auth-page">
      <div className="auth-card">
        <h1>欢迎回到 QRAi</h1>
        <p className="muted">进入质量风险评估工作台，继续你的评估项目。</p>
        <form onSubmit={handleSubmit} className="form">
          <label>
            邮箱
            <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" required />
          </label>
          <label>
            密码
            <input
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              type="password"
              required
            />
          </label>
          {error ? <div className="error">{error}</div> : null}
          <button type="submit" disabled={loading}>
            {loading ? "登录中..." : "登录"}
          </button>
        </form>
        <div className="auth-footer">
          <span>还没有账号？</span>
          <Link to="/register">创建账户</Link>
        </div>
      </div>
    </div>
  );
}
