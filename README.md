# QRAi

面向药品生产企业质量管理人员的风险评估报告生成工具，支持多用户、多模板、报告版本管理，并输出 Markdown / Word / PDF。

## 技术架构

- 前端：Cloudflare Pages（Vite + React）
- 后端：Cloudflare Workers（Hono）
- 数据库：Cloudflare D1（生产环境）
- 文件存储：Cloudflare R2（生产环境）
- 导出服务：外部渲染服务（PDF/DOCX）

## 本地开发（不依赖 Cloudflare 云端服务）

本地开发使用 Wrangler 的本地模拟（D1 + R2 本地持久化），不需要创建/调用 Cloudflare 云端服务。

### 1) 安装依赖

```bash
npm install
```

### 2) 配置后端本地变量

在 `apps/worker/` 下创建 `.dev.vars`：

```bash
OPENAI_API_KEY=你的Key
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_MODEL=gpt-4o-mini
APP_ENV=local
APP_ORIGIN=http://localhost:5173
EXPORT_RENDER_URL=你的外部渲染服务
EXPORT_RENDER_API_KEY=
EXPORT_RENDER_MODE=markdown
ADMIN_BOOTSTRAP_KEY=本地管理员初始化密钥
REPORT_TIMEZONE=Asia/Shanghai
```

说明：
- `APP_ENV=local` 会禁用 Secure Cookie，便于本地 http 调试。
- `EXPORT_RENDER_URL` 未配置时，导出会返回错误（可先留空）。

### 3) 初始化本地 D1

```bash
npm --workspace apps/worker run d1:local:init
```

### 4) 启动后端（本地模拟）

```bash
npm run dev:worker:local
```

说明：
- 脚本会使用 `wrangler dev --local --persist-to .wrangler/state`，本地持久化 D1/R2 数据。

### 5) 配置前端 API 地址

在 `apps/web/` 下创建 `.env`：

```bash
VITE_API_BASE=http://localhost:8787
```

### 6) 启动前端

```bash
npm run dev:web
```

## 生产部署（Cloudflare）

1. 创建 D1 数据库与 R2 Bucket，并将 ID/名称写入 `apps/worker/wrangler.toml`。
2. 设置 Workers 环境变量（如 `OPENAI_API_KEY`、`EXPORT_RENDER_URL` 等）。
3. 部署 Workers：

```bash
npm --workspace apps/worker run deploy
```

4. 部署 Pages（构建输出目录 `apps/web/dist`）。

## 配置文件说明（重点）

### 1) `apps/worker/.env.example`

作用：
- 这是 **环境变量模板**，用于告诉你 Worker 需要哪些配置项。
- **不会被 Wrangler 自动加载**，仅用于复制参考。

应该在什么情况下修改：
- 当新增/删除环境变量（例如新增搜索服务的 API Key）时，应该同步更新该文件，保持文档与实际需求一致。

如何使用：
- 本地开发：复制为 `.dev.vars`，内容为 `KEY=VALUE` 形式（Wrangler 会自动读取）。
- 生产环境：不要直接把敏感信息写进仓库；用 Cloudflare Dashboard 或 `wrangler secret put` 设置。

示例（本地）：
```bash
cp apps/worker/.env.example apps/worker/.dev.vars
```

### 2) `apps/worker/wrangler.toml`

作用：
- **Worker 构建与部署的核心配置文件**，包括入口文件、兼容日期、D1/R2 绑定、默认变量等。
- 本地模式（`wrangler dev --local`）也会读取该文件，用于确定绑定名称。

应该在什么情况下修改：
- 需要更换 Worker 入口文件或名称。
- 新增/调整 D1、R2、KV、Vectorize 等绑定。
- 需要增加路由、环境分组（`[env.production]` / `[env.staging]`）。
- 修改默认变量（如 `APP_ORIGIN`、`OPENAI_MODEL` 的默认值）。

如何修改（常见操作）：
- 绑定 D1/R2：将 `database_id` 与 `bucket_name` 改成你真实的资源 ID/名称。
- 添加多环境配置：使用 `[env.production]` 覆盖生产变量，避免与本地混用。
- **不要**在 `wrangler.toml` 内写入敏感信息（如 `OPENAI_API_KEY`）；用 `wrangler secret put`。

示例（生产环境绑定）：
```toml
[[d1_databases]]
binding = "DB"
database_name = "qrai"
database_id = "你的真实D1 ID"

[[r2_buckets]]
binding = "BUCKET"
bucket_name = "你的真实R2名称"
```

示例（生产环境变量）：
```toml
[env.production]
vars = { APP_ENV = "production", APP_ORIGIN = "https://your-domain.com" }
```

## 管理员账号

首次注册时传入 `ADMIN_BOOTSTRAP_KEY` 即可初始化管理员账号。后续注册默认为普通用户。

## 模板规则

- 模板文件为 Markdown。
- 用户可编辑模板，但编辑结果不会回写模板库，仅对本次报告生效。
- 每次生成报告会创建“模板快照”，可追溯。

## 外部渲染服务协议

后端会向 `EXPORT_RENDER_URL` 发送 JSON：

```json
{
  "format": "pdf",
  "content": "...",
  "contentType": "markdown"
}
```

支持 `format = pdf | docx`，`contentType = markdown | html`。

## 目录结构

- `apps/web` 前端
- `apps/worker` 后端
- `apps/worker/migrations` D1 初始化脚本
- `apps/worker/resources` 默认模板示例

## 扩展点

- 联网检索：`apps/worker/src/search.ts` 中实现 `SearchProvider`。
- 向量检索/RAG：可接入 Cloudflare Vectorize 或其他服务。
