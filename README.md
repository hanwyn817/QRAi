# QRAi

面向药品生产企业质量管理人员的风险评估报告生成工具，支持多用户、多模板、报告版本管理，并输出 Markdown / Word。

## 1 技术架构

- 前端：Cloudflare Pages（Vite + React）
- 后端：Cloudflare Workers（Hono）
- 数据库：Cloudflare D1（生产环境）
- 文件存储：Cloudflare R2（生产环境）
- 导出服务：Worker 本地渲染（DOCX）

## 2 本地开发（不依赖 Cloudflare 云端服务）

本地开发使用 Wrangler 的本地模拟（D1 + R2 本地持久化），不需要创建/调用 Cloudflare 云端服务。

### 2.1 安装依赖

```bash
npm install
```

### 2.2 配置后端本地变量

在 `apps/worker/` 下创建 `.dev.vars`（建议直接复制模板）：

```bash
cp apps/worker/.env.example apps/worker/.dev.vars
```

然后编辑 `apps/worker/.dev.vars`：

```bash
APP_ENV=local
APP_ORIGIN=http://localhost:5173
ADMIN_BOOTSTRAP_KEY=本地管理员初始化密钥
REPORT_TIMEZONE=Asia/Shanghai
```

说明：
- `APP_ENV=local` 会禁用 Secure Cookie，便于本地 http 调试（本地保持 `local`）。
- `APP_ORIGIN` 是前端地址（用于 CORS 与 Cookie）。本地默认 `http://localhost:5173`；只有当前端端口/域名变了才需要改（例如 Vite 改成 3000，就写 `http://localhost:3000`）。
- `ADMIN_BOOTSTRAP_KEY` 用于创建管理员账号（注册页面有“管理员密钥”输入框），本地可随便设置一个字符串。
- `REPORT_TIMEZONE` 是报告时间的时区，默认 `Asia/Shanghai`，不需要就不要改。

### 2.3 本地 D1 初始化

```bash
npm --workspace apps/worker run d1:local:init
```

说明：
- 使用迁移版本表 `schema_migrations` 记录已执行脚本，仅执行未执行的迁移。

### 2.4 启动后端（本地模拟）

```bash
npm run dev:worker:local
```

说明：
- 脚本会使用 `wrangler dev --local --persist-to .wrangler/state`，本地持久化 D1/R2 数据。

### 2.5 配置前端 API 地址

在 `apps/web/` 下创建 `.env`：

```bash
VITE_API_BASE=http://localhost:8787
```

### 2.6 启动前端

```bash
npm run dev:web
```

### 2.7 初始化模型

1. 打开前端注册页，填写“管理员密钥”为 `ADMIN_BOOTSTRAP_KEY`，完成管理员创建。
2. 以管理员登录后，在「模型管理」中新增 OpenAI 兼容模型，并为每个类别设置默认模型（需要 Base URL / API Key / 模型标识）。

## 3 生产部署（Cloudflare）

### 3.1 前置准备

- 安装并登录 Wrangler：`npm i -g wrangler`，`wrangler login`
- 确保 Cloudflare 账号已开通 Workers / D1 / R2 / Pages

### 3.2 创建 D1 与 R2 资源

```bash
wrangler d1 create qrai-db
wrangler r2 bucket create qrai-bucket
```

将输出的 `database_id` 与 `bucket_name` 写入 `apps/worker/wrangler.toml`：

```toml
[[d1_databases]]
binding = "DB"
database_name = "qrai-db"
database_id = "你的真实D1 ID"

[[r2_buckets]]
binding = "BUCKET"
bucket_name = "qrai-bucket"
```

### 3.3 生产数据库迁移

```bash
npm --workspace apps/worker run d1:prod:init
```

说明：
- 采用常规迁移策略，按顺序执行未执行的迁移文件（基于 `schema_migrations` 判断）。
- 默认执行远程生产 D1；本地迁移请使用 `npm --workspace apps/worker run d1:local:init`。
- 如果以后新增了字段/表：
  1. 在 `apps/worker/migrations/` 新建一个递增编号的 SQL 文件（例如 `0010_add_xxx.sql`，按现有最大编号继续递增）。
  2. 把需要的 `ALTER TABLE` / `CREATE TABLE` 写进去。
  3. 线上执行一次：`wrangler d1 execute qrai-db --remote --env production --file apps/worker/migrations/0008_add_xxx.sql`，或直接运行 `npm --workspace apps/worker run d1:prod:init`。

### 3.4 配置 Workers 环境变量与密钥

推荐使用 Secrets 管理敏感信息（用于生产环境）：

```bash
cd apps/worker
wrangler secret put ADMIN_BOOTSTRAP_KEY --env production
```

执行后会提示你输入密钥，直接在终端输入（例如 `123456`）并回车即可。

说明：
- 需要在 `apps/worker` 目录执行（或使用 `--config apps/worker/wrangler.toml`）。
- `--env production` 需要 `apps/worker/wrangler.toml` 存在 `[env.production]` 区块。

非敏感变量建议写入 `apps/worker/wrangler.toml` 的 `[env.production].vars`（如果没有该区块就手动新增）：

```toml
[env.production]
vars = { APP_ENV = "production", APP_ORIGIN = "https://your-domain.com" }
```

### 3.5 部署 Workers

```bash
npm --workspace apps/worker run deploy -- --env production
```

部署成功后会输出 Worker 的访问域名（通常是 `https://<name>.<account>.workers.dev`），下一步会用它配置前端的 `VITE_API_BASE`。

### 3.6 部署 Pages（前端）

在 Cloudflare Pages 新建项目并关联仓库，构建配置：

- 构建命令：`npm --workspace apps/web run build`
- 输出目录：`apps/web/dist`
- 环境变量：`VITE_API_BASE=https://your-worker-domain`

说明：
- `npm --workspace apps/web run build` 只是本地构建，不会生成域名。
- 只有在 Cloudflare Pages 触发部署并成功完成后，才会分配 `https://xxx.pages.dev` 域名。
- 若希望自动部署，请在 Pages 中连接仓库，或使用下方的 GitHub Actions 流程（见 3.8）。

首次部署完成后会得到一个 Pages 域名（例如 `https://xxx.pages.dev`）。
拿到域名后：
1. 把该域名写入 `apps/worker/wrangler.toml` 的 `[env.production].vars` 里 `APP_ORIGIN`。
2. 重新部署 Worker（执行 `npm --workspace apps/worker run deploy`）。
3. 如果你绑定了自定义域名，记得把 `APP_ORIGIN` 更新为自定义域名并再次部署 Worker。

### 3.7 初始化管理员与模型

1. 访问前端注册页，在“管理员密钥”里填写 `ADMIN_BOOTSTRAP_KEY`，完成管理员初始化。
2. 以管理员登录后，进入「模型管理」配置 OpenAI 兼容模型，并为每类模型设置默认值。

## 3.8 自动部署（GitHub Actions）

本仓库已提供自动部署流程（`.github/workflows/deploy.yml`），推送到 `main` 分支会自动部署 Worker 与 Pages。

首次启用需要在 GitHub 仓库设置以下 Secrets：

- `CLOUDFLARE_API_TOKEN`：需要包含 Workers 与 Pages 的发布权限。
- `CLOUDFLARE_ACCOUNT_ID`：Cloudflare 账号 ID。
- `CLOUDFLARE_PAGES_PROJECT_NAME`：Pages 项目名称（不是域名）。
- `VITE_API_BASE`：前端请求后端的地址（例如 `https://<name>.<account>.workers.dev` 或你自己的域名）。
- `D1_DATABASE_NAME`：生产 D1 数据库名称（例如 `qrai-db`，与 `wrangler d1 create` 时的名字一致）。

注意：
- 如果你的默认分支不是 `main`，请修改 `.github/workflows/deploy.yml` 中的分支配置。
- `VITE_API_BASE` 必须与后端实际访问地址一致，否则前端无法请求接口。
- 自动迁移会基于 `schema_migrations` 判断未执行脚本，请不要修改已上线的旧迁移文件。

如何设置 GitHub Secrets：
1. 打开你的 GitHub 仓库页面。
2. 进入 `Settings` → `Secrets and variables` → `Actions`。
3. 点击 `New repository secret`。
4. 按上面的名称逐个添加（Name 填变量名，Secret 填值）。

## 4 配置文件说明（重点）

### 4.1 `apps/worker/.env.example`

作用：
- 这是 **环境变量模板**，用于告诉你 Worker 需要哪些配置项。
- **不会被 Wrangler 自动加载**，仅用于复制参考。

应该在什么情况下修改：
- 当新增/删除环境变量（例如新增搜索服务的 API Key）时，应该同步更新该文件，保持文档与实际需求一致。

如何使用：
- 本地开发：复制为 `.dev.vars`，内容为 `KEY=VALUE` 形式（Wrangler 会自动读取）。
- 生产环境：不要直接把敏感信息写进仓库；用 Cloudflare Dashboard 或 `wrangler secret put` 设置。
- 模型配置（Base URL / API Key / 模型标识）通过管理后台维护，不在 `.env` 中配置。
- `ADMIN_BOOTSTRAP_KEY` 是敏感密钥，**不要写进 `apps/worker/wrangler.toml` 并提交到仓库**；请用 Dashboard 或 `wrangler secret put` 配置。

常见字段说明：
- `APP_ENV`：运行环境标记；本地用 `local`，生产用 `production`（写在 `[env.production].vars` 或 Dashboard）。
- `APP_ORIGIN`：前端访问地址；本地默认用 `http://localhost:5173`，通常**不需要改**。生产环境需要先在 Pages 首次部署拿到域名（如 `https://xxx.pages.dev`），再把这个域名写到 `apps/worker/wrangler.toml` 的 `[env.production].vars` 或 Cloudflare Dashboard，并重新部署 Worker（多个域名用英文逗号分隔）。
- `ADMIN_BOOTSTRAP_KEY`：初始化管理员用的一次性“钥匙”；第一次注册管理员时需要，之后可更换或留空。
- `REPORT_TIMEZONE`：报告显示时间的时区；不改就用 `Asia/Shanghai`。

示例（本地）：
```bash
cp apps/worker/.env.example apps/worker/.dev.vars
```

### 4.2 `apps/worker/wrangler.toml`

作用：
- **Worker 构建与部署的核心配置文件**，包括入口文件、兼容日期、D1/R2 绑定、默认变量等。
- 本地模式（`wrangler dev --local`）也会读取该文件，用于确定绑定名称。

应该在什么情况下修改：
- 需要更换 Worker 入口文件或名称。
- 新增/调整 D1、R2、KV、Vectorize 等绑定。
- 需要增加路由、环境分组（`[env.production]` / `[env.staging]`）。
- 修改默认变量（如 `APP_ORIGIN` 的默认值）。

如何修改（常见操作）：
- 绑定 D1/R2：将 `database_id` 与 `bucket_name` 改成你真实的资源 ID/名称。
- 添加多环境配置：使用 `[env.production]` 覆盖生产变量，避免与本地混用。
- **不要**在 `wrangler.toml` 内写入敏感信息；模型 API Key 请通过管理后台维护。

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

## 5 管理员账号

首次注册时传入 `ADMIN_BOOTSTRAP_KEY` 即可初始化管理员账号。后续注册默认为普通用户。

## 6 模板规则

- 模板文件为 Markdown。
- 用户可编辑模板，但编辑结果不会回写模板库，仅对本次报告生效。
- 每次生成报告会创建“模板快照”，可追溯。

## 7 目录结构

- `apps/web` 前端
- `apps/worker` 后端
- `apps/worker/migrations` D1 初始化脚本
- `apps/worker/resources` 默认模板示例

## 8 扩展点

- 联网检索：`apps/worker/src/search.ts` 中实现 `SearchProvider`。
- 向量检索/RAG：可接入 Cloudflare Vectorize 或其他服务。

## 9 TODO

- 增加用户用量管理
