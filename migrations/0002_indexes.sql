CREATE INDEX IF NOT EXISTS idx_templates_active_updated_at
  ON templates (is_active, updated_at);

CREATE INDEX IF NOT EXISTS idx_projects_owner_updated_at
  ON projects (owner_id, updated_at);

CREATE INDEX IF NOT EXISTS idx_project_files_project_created_at
  ON project_files (project_id, created_at);

CREATE INDEX IF NOT EXISTS idx_reports_project_version
  ON reports (project_id, version);

CREATE INDEX IF NOT EXISTS idx_reports_project_status_created_at
  ON reports (project_id, status, created_at);

CREATE INDEX IF NOT EXISTS idx_report_exports_report_id
  ON report_exports (report_id);

CREATE INDEX IF NOT EXISTS idx_model_access_plan_model_id
  ON model_access (plan, model_id);
