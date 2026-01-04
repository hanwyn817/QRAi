import React from "react";
import { Link, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { AuthProvider, useAuth } from "./lib/auth";
import Dashboard from "./pages/Dashboard";
import Login from "./pages/Login";
import Register from "./pages/Register";
import ProjectDetail from "./pages/ProjectDetail";
import AdminTemplates from "./pages/AdminTemplates";
import AdminModels from "./pages/AdminModels";
import AdminUsers from "./pages/AdminUsers";
import ReportPreview from "./pages/ReportPreview";
import Pricing from "./pages/Pricing";

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) {
    return <div className="loading">正在加载...</div>;
  }
  if (!user) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  return <>{children}</>;
}

function RequireAdmin({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  if (!user || user.role !== "admin") {
    return <Navigate to="/" replace />;
  }
  return <>{children}</>;
}

function Layout({ children }: { children: React.ReactNode }) {
  const { user, logout } = useAuth();
  const plan = user?.plan ?? "free";
  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="brand">
          <span className="brand-mark">QRAi</span>
          <span className="brand-tag">AI质量风险评估工作台</span>
        </div>
        <nav className="app-nav">
          <Link to="/">首页</Link>
          <Link to="/pricing">价格</Link>
          {user?.role === "admin" ? (
            <>
              <Link to="/admin/templates">模板管理</Link>
              <Link to="/admin/models">模型管理</Link>
              <Link to="/admin/users">用户管理</Link>
            </>
          ) : null}
        </nav>
        <div className="app-user">
          {user ? (
            <>
              <span className={`plan-badge plan-${plan}`}>{plan.toUpperCase()}</span>
              <span className="user-email">{user.email}</span>
              <button className="ghost" onClick={logout}>退出</button>
            </>
          ) : (
            <>
              <Link className="ghost" to="/login">登录</Link>
              <Link className="ghost" to="/register">注册</Link>
            </>
          )}
        </div>
      </header>
      <main className="app-main">{children}</main>
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route
          path="/"
          element={
            <Layout>
              <Dashboard />
            </Layout>
          }
        />
        <Route
          path="/projects/:id"
          element={
            <RequireAuth>
              <Layout>
                <ProjectDetail />
              </Layout>
            </RequireAuth>
          }
        />
        <Route
          path="/reports/:id"
          element={
            <RequireAuth>
              <Layout>
                <ReportPreview />
              </Layout>
            </RequireAuth>
          }
        />
        <Route
          path="/pricing"
          element={
            <Layout>
              <Pricing />
            </Layout>
          }
        />
        <Route
          path="/admin/templates"
          element={
            <RequireAuth>
              <RequireAdmin>
                <Layout>
                  <AdminTemplates />
                </Layout>
              </RequireAdmin>
            </RequireAuth>
          }
        />
        <Route
          path="/admin/models"
          element={
            <RequireAuth>
              <RequireAdmin>
                <Layout>
                  <AdminModels />
                </Layout>
              </RequireAdmin>
            </RequireAuth>
          }
        />
        <Route
          path="/admin/users"
          element={
            <RequireAuth>
              <RequireAdmin>
                <Layout>
                  <AdminUsers />
                </Layout>
              </RequireAdmin>
            </RequireAuth>
          }
        />
      </Routes>
    </AuthProvider>
  );
}
