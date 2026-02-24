# QRAi

面向药品生产企业质量管理人员的风险评估报告生成工具，支持多用户、多模板、报告版本管理，并输出 Markdown / Word。

## 1 架构设计

- **API 端**：Node + Hono（单进程）。采用**分层架构（Layered Architecture）**，业务逻辑封装于 `Services` 层，API 路由按领域拆分。
- **前端页面**：Vite + React。构建后由同一 Node 服务进行托管（Mono-server）。具有高度组件化的项目视图。
- **数据库**：SQLite（本地文件 `better-sqlite3`）。
- **文件存储**：本地文件（开发） / 阿里云 OSS（生产）。

## 2 先决条件

- Node.js 20+（本地运行）
- Docker + Docker Compose（部署到 VPS）

## 3 本地运行

### 3.1 安装依赖

前端和后端分别管理依赖：

```bash
npm install
npm --prefix web install
```

### 3.2 配置环境变量

复制示例文件并编辑：

```bash
cp .env.example .env
```

**本地开发推荐配置**：

```bash
APP_ENV=local
STORAGE_MODE=local
# 【注意】本地开发必须配置允许前端开发服务器(5173)和后端单体服务(8787)跨域携带凭证，否则会导致无法保持登录状态
APP_ORIGIN=http://localhost:5173,http://localhost:8787
ADMIN_BOOTSTRAP_KEY=本地管理员初始化密钥
REPORT_TIMEZONE=Asia/Shanghai
DB_PATH=./data/qrai.sqlite
LOCAL_STORAGE_PATH=./data/files
```

说明：
- `STORAGE_MODE=local` 会把上传文件存到 `LOCAL_STORAGE_PATH`，不会上传到 OSS。
- `data/` 目录已被 `.gitignore` 忽略，不会提交到代码仓库中。

### 3.3 初始化数据库

```bash
npm run migrate
```

如果你以前跑过旧版本，大概率会报数据库字段缺失。最简单的解决办法是直接删除旧数据库文件，再重新初始化：

```bash
rm -f ./data/qrai.sqlite
npm run migrate
```

### 3.4 构建前端

如果你修改了前端 `web/` 的代码，或者首次运行不想启动双端开发服务器，可以先 Build：

```bash
npm --prefix web run build
```

### 3.5 启动服务

启动单体后端（兼顾 API 和已 Build 的静态资源兜底）：

```bash
npm run dev
```

打开 `http://localhost:8787` 即可访问完整项目（如果你也开了 Vite 开发服务器，可以直接访问 `http://localhost:5173` 进行前端调试）。

## 4 生产部署（Docker / VPS）

### 4.1 必填环境变量（生产）

生产环境使用 OSS，请在服务器的 `.env` 中设置：

```bash
APP_ENV=production
STORAGE_MODE=oss
APP_ORIGIN=https://your-domain.com
ADMIN_BOOTSTRAP_KEY=your-admin-bootstrap-key
REPORT_TIMEZONE=Asia/Shanghai
DB_PATH=/data/qrai.sqlite
OSS_REGION=oss-cn-hangzhou
OSS_ENDPOINT=oss-cn-hangzhou.aliyuncs.com
OSS_BUCKET=your-oss-bucket
OSS_ACCESS_KEY_ID=your-oss-access-key-id
OSS_ACCESS_KEY_SECRET=your-oss-access-key-secret
```

### 4.2 构建并推送镜像（可选）

本地构建并推送到 Docker Hub 方便面板拉取：

```bash
docker buildx build --platform linux/amd64 -t yourdockerhub/qrai:latest --push .
```

### 4.3 启动容器

1) 在服务器项目目录下创建 `.env` 文件。
   建议 `DB_PATH=/data/qrai.sqlite`，以便持久化数据写入 Docker 的挂载卷中。
2) 启动（`docker-compose.yml` 默认带有构建和持久化映射）：

```bash
docker compose up -d --build
```

3) 初始化数据库（在宿主机执行即可，`qrai` 为默认的 compose 服务名）：

```bash
docker compose exec qrai npm run migrate
```

### 4.4 测试 OSS 连接与读写

在已配置 `.env` 的环境中验证 OSS 功能：

```bash
npm run test:oss
```

## 5 目录结构与架构边界

本项目为单一仓库多包结构（Mono-repo style）：
- `src/`：后端服务（Hono）
  - `src/api/routes`：分离的业务领域 API 路由（如 auth, project, report）。
  - `src/api/services`：核心后端抽象服务层（AI 处理队列，鉴权策略等）。
- `web/`：前端应用（Vite + React）
  - `web/src/components`：解耦的前端 UI 组件和业务面板组件。
  - `web/src/pages`：各应用路由主页面。
- `migrations/`：SQLite 初始化脚本字典。
- `resources/`：默认模板存放。

## 6 管理员账号初始化

首次注册时，只要在注册界面填入与 `.env` 中配置的 `ADMIN_BOOTSTRAP_KEY` 相同的字符串，账号即可自动提升管理员权限。后续正常用户注册无需此项。

## 7 模板规则

- 模板采用 Markdown 格式。
- 用户可在网页端直接修改模板（编辑草稿），编辑结果**不回写模板库**，仅对保存的本次项目评估生效，保障安全性。
- 每次生成评估报告，系统会生成一份冻结的基于当前评估的“模板快照”。

## 8 扩展点（未来架构）

- 本地知识库 / RAG 检索：可接入自定义的向量库。
- 联网检索：在 `src/api/search.ts` 中可桥接多种 SearchProvider。
