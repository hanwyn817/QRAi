CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user',
  created_at TEXT NOT NULL
);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  token TEXT UNIQUE NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY(user_id) REFERENCES users(id)
);

CREATE TABLE templates (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  file_key TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  FOREIGN KEY(created_by) REFERENCES users(id)
);

CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  owner_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(owner_id) REFERENCES users(id)
);

CREATE TABLE project_inputs (
  project_id TEXT PRIMARY KEY,
  scope TEXT,
  background TEXT,
  objective TEXT,
  risk_method TEXT,
  eval_tool TEXT,
  template_id TEXT,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(project_id) REFERENCES projects(id)
);

CREATE TABLE project_files (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  type TEXT NOT NULL,
  filename TEXT NOT NULL,
  file_key TEXT NOT NULL,
  text_key TEXT,
  status TEXT NOT NULL DEFAULT 'uploaded',
  created_at TEXT NOT NULL,
  FOREIGN KEY(project_id) REFERENCES projects(id)
);

CREATE TABLE reports (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  status TEXT NOT NULL,
  template_snapshot_key TEXT NOT NULL,
  md_key TEXT,
  json_key TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  error_message TEXT,
  FOREIGN KEY(project_id) REFERENCES projects(id)
);

CREATE TABLE report_exports (
  id TEXT PRIMARY KEY,
  report_id TEXT NOT NULL,
  format TEXT NOT NULL,
  status TEXT NOT NULL,
  file_key TEXT,
  created_at TEXT NOT NULL,
  error_message TEXT,
  FOREIGN KEY(report_id) REFERENCES reports(id)
);
