# QRAi

面向药品生产企业质量管理人员的风险评估报告生成工具，支持多用户、多模板、报告版本管理，并输出 Markdown / Word。

## 1 架构（单体应用）

- API：Node + Hono（单进程）
- 前端：Vite + React（构建后由同一服务托管）
- 数据库：SQLite（本地文件）
- 文件存储：本地文件（开发）/ 阿里云 OSS（生产）

## 2 先决条件

- Node.js 20+（本地运行）
- Docker + Docker Compose（部署到 VPS）

## 3 本地运行

### 3.1 安装依赖

```bash
npm install
npm --prefix web install
```

### 3.2 配置环境变量

复制示例文件并编辑：

```bash
cp .env.example .env
```

本地开发推荐配置：

```bash
APP_ENV=local
STORAGE_MODE=local
APP_ORIGIN=http://localhost:8787
ADMIN_BOOTSTRAP_KEY=本地管理员初始化密钥
REPORT_TIMEZONE=Asia/Shanghai
DB_PATH=./data/qrai.sqlite
LOCAL_STORAGE_PATH=./data/files
```

说明：
- `STORAGE_MODE=local` 会把上传文件存到 `LOCAL_STORAGE_PATH`，不会上传到 OSS。
- `data/` 目录已被 `.gitignore` 忽略，不会提交到仓库。

### 3.3 初始化数据库

```bash
npm run migrate
```

如果你以前跑过旧版本，可能会报数据库字段缺失。最简单的解决办法是删除旧数据库文件再重新初始化：

```bash
rm -f ./data/qrai.sqlite
npm run migrate
```

### 3.4 构建前端

```bash
npm --prefix web run build
```

说明：前端有改动时需要重新执行构建。

### 3.5 启动服务

```bash
npm run dev
```

打开 `http://localhost:8787`。

## 4 生产部署（Docker / VPS）

### 4.1 必填环境变量（生产）

生产环境使用 OSS，请设置：

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

### 4.2 启动容器

1) 在服务器创建 `.env`（不要提交到 Git），把上面的生产环境变量写进去。  
   建议 `DB_PATH=/data/qrai.sqlite`，以便数据写入 Docker 挂载卷。  
2) 启动：

```bash
docker compose up -d --build
```

3) 初始化数据库：

```bash
docker compose exec qrai npm run migrate
```

## 5 目录结构

- `src`：后端 API（Hono）
- `src/api`：业务逻辑
- `web`：前端（Vite + React）
- `migrations`：SQLite 初始化脚本
- `resources`：默认模板示例

## 6 管理员账号

首次注册时传入 `ADMIN_BOOTSTRAP_KEY` 即可初始化管理员账号。后续注册默认为普通用户。

## 7 模板规则

- 模板文件为 Markdown。
- 用户可编辑模板，但编辑结果不会回写模板库，仅对本次报告生效。
- 每次生成报告会创建“模板快照”，可追溯。

## 8 扩展点

- 联网检索：`src/api/search.ts` 中实现 `SearchProvider`。
- 向量检索/RAG：可接入 Vectorize 或其他服务。
