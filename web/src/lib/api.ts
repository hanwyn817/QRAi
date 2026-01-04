export type ApiResponse<T> = { data: T | null; error: string | null };

const API_BASE = import.meta.env.VITE_API_BASE ?? "";

async function request<T>(path: string, options?: RequestInit): Promise<ApiResponse<T>> {
  const headers: HeadersInit = options?.headers ?? {};
  if (!(options?.body instanceof FormData)) {
    headers["Content-Type"] = "application/json";
  }

  const response = await fetch(`${API_BASE}${path}`, {
    credentials: "include",
    ...options,
    headers
  });

  const text = await response.text();
  let payload: unknown = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = null;
    }
  }

  if (!response.ok) {
    return { data: null, error: payload?.error ?? "请求失败" };
  }

  return { data: payload as T, error: null };
}

export const api = {
  async register(email: string, password: string, adminKey?: string) {
    return request<{ id: string; email: string; role: string; plan?: "free" | "pro" | "max" }>(
      "/api/auth/register",
      {
      method: "POST",
      body: JSON.stringify({ email, password, adminKey })
      }
    );
  },
  async login(email: string, password: string) {
    return request<{ id: string; email: string; role: string; plan?: "free" | "pro" | "max" }>(
      "/api/auth/login",
      {
      method: "POST",
      body: JSON.stringify({ email, password })
      }
    );
  },
  async logout() {
    return request<{ ok: boolean }>("/api/auth/logout", { method: "POST" });
  },
  async getMe() {
    return request<{
      user: { id: string; email: string; role: "admin" | "user"; plan?: "free" | "pro" | "max" };
      quota?: { remaining: number | null; cycleEnd: string; isUnlimited: boolean };
    }>("/api/me");
  },
  async listTemplates() {
    return request<{
      templates: Array<{
        id: string;
        name: string;
        description: string | null;
        created_at?: string;
        updated_at?: string;
      }>;
    }>(
      "/api/templates"
    );
  },
  async getTemplate(id: string) {
    return request<{ id: string; name: string; description: string | null; content: string }>(
      `/api/templates/${id}`
    );
  },
  async uploadTemplate(form: FormData) {
    return request<{ id: string; name: string; description: string | null }>("/api/admin/templates", {
      method: "POST",
      body: form
    });
  },
  async exportTemplates() {
    return request<{
      templates: Array<{
        name: string;
        description: string | null;
        content: string;
        created_at?: string;
        updated_at?: string;
      }>;
    }>("/api/admin/templates/export");
  },
  async importTemplates(data: {
    templates: Array<{ name: string; description?: string | null; content: string }>;
  }) {
    return request<{ count: number }>("/api/admin/templates/import", {
      method: "POST",
      body: JSON.stringify(data)
    });
  },
  async updateTemplate(id: string, data: { name?: string; description?: string; content?: string }) {
    return request<{ ok: boolean }>(`/api/admin/templates/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data)
    });
  },
  async duplicateTemplate(id: string) {
    return request<{ id: string; name: string }>(`/api/admin/templates/${id}/duplicate`, {
      method: "POST"
    });
  },
  async deleteTemplate(id: string) {
    return request<{ ok: boolean }>(`/api/admin/templates/${id}`, { method: "DELETE" });
  },
  async listUsers() {
    return request<{
      users: Array<{
        id: string;
        email: string;
        role: "admin" | "user";
        plan: "free" | "pro" | "max";
        created_at: string;
        project_count?: number;
        quota_remaining?: number | null;
        quota_cycle_end?: string | null;
        quota_is_unlimited?: boolean;
      }>;
    }>("/api/admin/users");
  },
  async createUser(data: { email: string; password: string; plan?: "free" | "pro" | "max" }) {
    return request<{ id: string; email: string; role: string; plan: "free" | "pro" | "max" }>(
      "/api/admin/users",
      {
        method: "POST",
        body: JSON.stringify(data)
      }
    );
  },
  async updateUserPlan(id: string, plan: "free" | "pro" | "max") {
    return request<{ ok: boolean }>(`/api/admin/users/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ plan })
    });
  },
  async updateUserQuotaRemaining(id: string, remaining: number) {
    return request<{ ok: boolean; quota: { remaining: number | null; cycleEnd: string; isUnlimited: boolean } }>(
      `/api/admin/users/${id}/quota`,
      {
        method: "PATCH",
        body: JSON.stringify({ remaining })
      }
    );
  },
  async deleteUser(id: string) {
    return request<{ ok: boolean }>(`/api/admin/users/${id}`, { method: "DELETE" });
  },
  async listProjects() {
    return request<{
      projects: Array<{
        id: string;
        title: string;
        status: string;
        created_at: string;
        updated_at?: string;
        report_count?: number;
        latest_completed_at?: string | null;
      }>;
    }>(
      "/api/projects"
    );
  },
  async createProject(title: string) {
    return request<{ id: string; title: string; status: string }>("/api/projects", {
      method: "POST",
      body: JSON.stringify({ title })
    });
  },
  async deleteProject(id: string) {
    return request<{ ok: boolean }>(`/api/projects/${id}`, { method: "DELETE" });
  },
  async getProject(id: string) {
    return request<{
      project: { id: string; title: string; status: string };
      inputs: {
        scope: string | null;
        background: string | null;
        objective: string | null;
        risk_method: string | null;
        eval_tool: string | null;
        process_steps: Array<{ step_id: string; step_name: string }> | null;
        template_id: string | null;
        text_model_id: string | null;
      };
      files: Array<{ id: string; type: string; filename: string; status: string; created_at: string }>;
      reports: Array<{
        id: string;
        version: number;
        status: string;
        created_at: string;
        prompt_tokens: number | null;
        completion_tokens: number | null;
        total_tokens: number | null;
        model_name?: string | null;
      }>;
    }>(`/api/projects/${id}`);
  },
  async updateProjectInputs(id: string, data: {
    scope?: string;
    background?: string;
    objective?: string;
    riskMethod?: string;
    evalTool?: string;
    processSteps?: Array<{ step_id: string; step_name: string }>;
    templateId?: string;
    textModelId?: string;
  }) {
    return request<{ ok: boolean }>(`/api/projects/${id}/inputs`, {
      method: "PATCH",
      body: JSON.stringify(data)
    });
  },
  async uploadProjectFile(id: string, form: FormData) {
    return request<{ id: string; filename: string; status: string }>(`/api/projects/${id}/files`, {
      method: "POST",
      body: form
    });
  },
  async deleteProjectFile(projectId: string, fileId: string) {
    return request<{ ok: boolean }>(`/api/projects/${projectId}/files/${fileId}`, {
      method: "DELETE"
    });
  },
  async createReport(id: string, templateContent: string) {
    return request<{ id: string; version: number; status: string }>(`/api/projects/${id}/reports`, {
      method: "POST",
      body: JSON.stringify({ templateContent })
    });
  },
  async getReport(id: string, includeContent = false) {
    return request<{ report: Record<string, unknown>; content: string | null; data: unknown }>(
      `/api/reports/${id}?includeContent=${includeContent ? 1 : 0}`
    );
  },
  async exportReport(id: string, format: "docx") {
    return request<{ id: string; status: string }>(`/api/reports/${id}/exports`, {
      method: "POST",
      body: JSON.stringify({ format })
    });
  },
  async deleteReport(id: string, force = false) {
    const query = force ? "?force=1" : "";
    return request<{ ok: boolean }>(`/api/reports/${id}${query}`, { method: "DELETE" });
  },
  async listModels() {
    return request<{
      models: Array<{
        id: string;
        name: string;
        category: "text" | "embedding" | "rerank";
        model_name: string;
        is_default: boolean;
      }>;
      defaults: { text: string | null; embedding: string | null; rerank: string | null };
    }>("/api/models");
  },
  async listModelTiers() {
    return request<{
      tiers: { free: string[]; pro: string[]; max: string[] };
    }>("/api/models/tiers");
  },
  async listAdminModels() {
    return request<{
      models: Array<{
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
      }>;
    }>("/api/admin/models");
  },
  async exportAdminModels() {
    return request<{
      models: Array<{
        name: string;
        category: "text" | "embedding" | "rerank";
        model_name: string;
        base_url: string;
        api_key: string;
        is_default: boolean;
        is_active?: boolean;
        allowed_plans: Array<"free" | "pro" | "max">;
      }>;
    }>("/api/admin/models/export");
  },
  async importAdminModels(data: {
    models: Array<{
      name: string;
      category: "text" | "embedding" | "rerank";
      model_name: string;
      base_url: string;
      api_key: string;
      is_default?: boolean;
      is_active?: boolean;
      allowed_plans?: Array<"free" | "pro" | "max">;
    }>;
  }) {
    return request<{ count: number }>("/api/admin/models/import", {
      method: "POST",
      body: JSON.stringify(data)
    });
  },
  async createModel(data: {
    name: string;
    category: "text" | "embedding" | "rerank";
    modelName: string;
    baseUrl: string;
    apiKey: string;
    isDefault?: boolean;
    allowedPlans?: Array<"free" | "pro" | "max">;
  }) {
    return request<{ id: string }>("/api/admin/models", {
      method: "POST",
      body: JSON.stringify(data)
    });
  },
  async updateModel(
    id: string,
    data: {
      name?: string;
      category?: "text" | "embedding" | "rerank";
      modelName?: string;
      baseUrl?: string;
      apiKey?: string;
      isDefault?: boolean;
      allowedPlans?: Array<"free" | "pro" | "max">;
    }
  ) {
    return request<{ ok: boolean }>(`/api/admin/models/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data)
    });
  },
  async deleteModel(id: string) {
    return request<{ ok: boolean }>(`/api/admin/models/${id}`, { method: "DELETE" });
  }
};
