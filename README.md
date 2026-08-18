# ForgeCore

ForgeCore 是一个面向智能工厂设计、确定性生产仿真、智能物流和资产治理的 Web 3D 平台。仓库包含 React/Three.js 前端、FastAPI 后端、PostgreSQL/Redis 基础设施、36 个原创默认物品模型，以及已审计的第三方工厂资产。

## 环境要求

- Node.js 与 npm
- Python 3.12+
- Docker Desktop 或兼容的 Docker Compose 环境
- Git LFS

首次克隆后拉取 LFS 资产：

```bash
git lfs install
git lfs pull
```

## 启动基础设施

PostgreSQL 和 Redis 使用仓库根目录的 Compose 配置，默认端口分别为 `5440` 和 `6380`：

```bash
docker compose up -d postgres redis
docker compose ps
```

如需修改数据库凭据或端口，可在仓库根目录设置 Compose 环境变量；后端连接配置在 `backend/.env` 中保持一致。

## 启动后端

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -e '.[dev]'
cp .env.example .env
```

开发环境至少应替换 `.env` 中的 `JWT_SECRET_KEY`。初始化或升级数据库后启动 API：

```bash
alembic upgrade head
uvicorn app.main:app --host 127.0.0.1 --port 8010 --reload
```

健康检查地址为 `http://127.0.0.1:8010/api/health`，交互式 API 文档为 `http://127.0.0.1:8010/docs`。

## 启动前端

在另一个终端回到仓库根目录：

```bash
npm ci
npm run dev -- --host 127.0.0.1 --port 4173 --strictPort
```

打开 `http://127.0.0.1:4173/`。Vite 会把 `/api` 代理到 `http://127.0.0.1:8010`。首次进入先注册或登录，再从主菜单新建空白工厂；点击顶部“保存”会同步到后端，并保留账户隔离的浏览器副本供服务不可用时回退。

Windows 用户也可以双击根目录的 `启动ForgeCore.cmd` 只启动前端。完整云端持久化仍需要先按上述步骤启动 PostgreSQL、Redis 和 FastAPI。若 `4173` 被占用，可执行 `启动ForgeCore.cmd 4175` 指定其他前端端口，并同步将该来源加入后端 `CORS_ORIGINS`。

## 默认端口

| 服务 | 地址或端口 |
| --- | --- |
| Web 前端 | `http://127.0.0.1:4173` |
| FastAPI | `http://127.0.0.1:8010` |
| PostgreSQL | `127.0.0.1:5440` |
| Redis | `127.0.0.1:6380` |

## 验证

后端检查需要 PostgreSQL 与 Redis 已启动：

```bash
cd backend
.venv/bin/pytest -q
.venv/bin/ruff check app tests
.venv/bin/mypy app
```

前端与领域回归：

```bash
npm run check
npm run validate:floors
npm run validate:agv
npm run validate:drone
npm run validate:warehouse-dispatch
npm run build
```

## 当前范围

- JWT 注册、登录、刷新和登出，工厂全量同步、仿真状态、指标与活动持久化；
- Redis Pub/Sub 与工厂/Agent SSE 事件流；
- 蓝图保存、公开发现、搜索、标签、热门排序、收藏、fork 及 `.fcbp` 导入导出；
- 七个任务页面、多层 3D 编辑、固定步长仿真、AGV 二维 A* 与无人机三维 A*；
- 36 个 first-party 参数化物品模型和可追溯的第三方资产治理。

仿真引擎当前仍以 TypeScript 在浏览器运行，后端负责用户、项目、历史数据、蓝图和 Agent 编排。Agent 已具备稳定会话与 Suggestion/SSE 契约，真实 LLM provider 和前端 Agent/蓝图工作台属于后续接入范围。权威范围与技术约束以 [ForgeCore 项目方案.md](<ForgeCore 项目方案.md>) 为准。
