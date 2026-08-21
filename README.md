# ForgeMind · 智能工厂数字孪生

AI 驱动的智能工厂数字孪生设计、生产路线与仿真平台。项目早期以 1 人 × 7 天为冲刺约束；当前代码已经扩展到多楼层、仓储物流、无人机跨层运输、诊断和用户私有设备资源导入。

## 技术栈

- **前端**：React 18 + TypeScript + Vite + Three.js（React Three Fiber）+ Zustand
- **样式**：TailwindCSS + 自定义设计 token（《明日方舟：终末地》工业机能风）
- **仿真内核**：纯 TS（`src/game/simulation.ts`），与 React/Three 解耦，是唯一真相源
- **后端双栈**：
  - **Spring Boot 3 + MySQL 8.4**（Java 17，`backend/`）—— 用户、工厂结构、物品、配方和用户私有导入资源持久化
  - **FastAPI**（Python 3.10+，`ai-service/`）—— 可选规则/DeepSeek 编排、工具协议、ASR/TTS 与视觉网关

## 快速开始

Windows 推荐直接双击项目根目录的 `启动ForgeMind.cmd`（兼容入口为 `start-forgemind.bat`）。双击入口会启动前端、Spring Boot 和 MySQL，从而保证注册、登录和云端存档可用；脚本不要求 Ollama、Qwen 或其他本地大语言模型。当前机器无 Docker 时会自动使用已安装的 MySQL 8.4 建立项目专用实例。

```powershell
.\启动ForgeMind.cmd                    # 推荐：前端 + Spring Boot + MySQL
.\start-forgemind.bat -NoBrowser       # 仅前端模式，不提供注册/登录
.\start-forgemind.bat -Port 5175       # 指定前端端口
.\start-forgemind.bat -IncludeAI       # 可选规则/远程 AI 核心；不启动本地 LLM
.\start-forgemind.bat -IncludeSpring   # Spring Boot + Docker 或本机 MySQL 8.x
.\start-forgemind.bat -IncludeSpring -SkipMySql # 使用已有外部数据库
.\start-forgemind.bat -IncludeAI -IncludeVoiceChat # 额外尝试启动独立语音控制台
.\stop-forgemind.bat                   # 停止由启动器创建的进程
.\stop-forgemind.bat -StopMySql        # 同时停止 MySQL 容器，保留数据卷
```

默认规则模式不访问模型服务。若要显式启用远程 DeepSeek，可在启动可选 AI 服务前设置：

```powershell
$env:FORGEMIND_LLM_PROVIDER = 'deepseek'
$env:DEEPSEEK_API_KEY = '<仅保存在本机环境变量>'
$env:DEEPSEEK_MODEL = 'deepseek-chat' # 可选
.\start-forgemind.bat -IncludeAI
```

```bash
npm install
npm run dev      # 前端开发服务器 http://localhost:5173
npm run build    # 前端生产构建
```

### 启动后端（可选）

```bash
# MySQL 8.4（Docker）
docker compose up -d mysql

# Spring Boot（端口 8080）
cd backend && mvn package && java -jar target/forgemind-backend-0.1.0.jar

# FastAPI 可选智能服务（端口 8000，默认规则模式，不需要本地 LLM）
cd ai-service && py -3 -m venv .venv && .venv/Scripts/pip install -r requirements-core.txt
.venv/Scripts/python -m uvicorn main:app --port 8000
```

视觉、ASR 或本地 TTS 另行安装 `ai-service/requirements.txt` 并按需启用；规则助手和远程 DeepSeek 均不需要本地语言模型。

登录进入工作台后，“新建空白工厂”会在当前账号的后端项目库创建独立记录；顶部“保存到后端”覆盖当前项目，“项目库”用于加载账号下的多份工厂。JSON 文件只作为项目库中的“导入 JSON / 导出当前 JSON”辅助交换能力。

视觉检测工作台是独立页面：开发环境访问 `http://127.0.0.1:5173/inspection.html`，生产构建会输出 `dist/inspection.html`。主界面的“**双臂视觉质检单元**”设备详情已提供检测入口，会在新标签页打开该工作台。它包含虚拟相机取景、OpenCV 检测结果、语音播报状态和合格/异常隔离路由。

数据库表由 Spring Boot 启动时的 Flyway 迁移自动创建，详细表职责见 [后端数据库设计](docs/ForgeMind-后端数据库设计.md)。

## 设计文档

- [融合版唯一权威项目方案](<ForgeMind 项目方案.md>)
- [文档索引与维护状态](docs/README.md)
- [当前实现总览（事实索引）](docs/ForgeMind-当前实现总览.md)
- [资产与许可审计](docs/资产与许可审计.md)
- [ForgeCore 融合迁移审计](docs/ForgeCore-融合迁移审计.md)
- [后端服务说明](backend/README.md)

- [原方案（67 节）](docs/AI%20驱动的智能工厂数字孪生设计与仿真平台项目方案(1).md)
- [补充设计（历史支持性设计，9 节）](docs/ForgeMind-补充设计.md)
- [A-02 与 Generative Factory 设计文档](docs/ForgeMind-A02与Generative-Factory设计文档.md)
- [功能模块技术文档（当前实现）](docs/ForgeMind-功能模块技术文档.md)
- [宝钗渲染引擎技术文档](docs/daiyu-render-engine.md)
- [黛玉智能工厂思考引擎技术文档](docs/daiyu-intelligence-engine.md)

## 双引擎架构

- **宝钗（Baochai）渲染引擎**：负责高精度模型、材质、动画、批处理、预热、运行时性能预算和三维场景呈现。
- **黛玉（Daiyu）智能工厂思考引擎**：负责从生产需求和当前工厂状态中生成 Recipe Graph、设备配置、可接通布局、物流路线、仿真评估、诊断建议、What-if 和 ROI 方案。

两套能力保持现有代码结构，通过工厂对象、布局和仿真快照协作。`src/engine/daiyu/` 等历史路径暂不改名，仅作为兼容标识；产品正式命名以本文档为准。

## 早期七天里程碑（历史记录）

> 下表保留用于说明项目演进，不代表当前功能边界。当前状态以[当前实现总览](docs/ForgeMind-当前实现总览.md)为准。

| 天 | 能力 |
|---|---|
| Day 1 | Vite + React + TS + Three.js 骨架，网格地面 + 相机 + 终末地 token |
| Day 2 | 网格建造：放置 / 90° 旋转 / 碰撞 / ghost 合法非法高亮 |
| Day 3 | Item / Recipe 定义 + JSON 保存加载（含运行时校验） |
| Day 4 | 仿真内核：固定步长 + 逻辑时钟 + 种子化 PRNG + 机器状态机 |
| Day 5 | 传送带分段模型 + ItemLot 在途运输 + 头堵背压 + Source 产出 |
| Day 6 | 利用率 / 在途 / 产出统计 + 终末地视觉打磨 |
| Day 7 | 演示闭环 + 集成测试 + 修复 |

## 当前增量状态（2026-08-19）

- 新增主界面「生产控制台」（`flow` 视图）：提供工厂俯视地图、设备登记、四段物流流向、产出/消耗统计，以及仿真启动、暂停、倍率和重置操作。
- 网页端语音入口作为可选能力保留：浏览器麦克风 → Paraformer ASR → 规则/远程智能服务 → 可选 TTS；默认前端模式不会请求麦克风或启动语音服务。
- 智能管家已接入 `1.0.0` 工具协议。查询、定位和仿真控制可直接执行；重置仿真、修改配方和绑定来料需要用户确认，服务端与前端各做一次动作校验。
- 设备详情面板完成信息分组和机器人工作区交互优化；页面切换、生产地图节点和语音状态加入 Anime.js 动效，并遵守 `prefers-reduced-motion`。
- 新增 A-02 独立工厂场地与「AI 工厂诊断 / Generative Factory」闭环：自然语言需求 → Recipe Graph → 设备估算 → 端口路由 → 碰撞校验 → 副本仿真 → Top 3 方案；已有 A-01 会优先进入 Adjustment Engine，返回当前基线、最小重布线和完整重构三类候选，审核后再应用。
- 生成器已支持产品 Profile：电机与齿轮箱使用不同物品、配方、终端成品和诊断目标；调整候选会显示改造差异、改造成本和 Pareto 等级。
- Generative Factory 已升级为可迭代的生成调整引擎：自动估算并行设备、基于 Beam Search 迭代候选、What-if 对照 CNC / 装配 / AGV 变更，并在候选卡片显示 CAPEX、月度收益、回本期和 12 个月 ROI。
- 生成器默认使用规则解析 + 本地确定性仿真；AI 约束提取可通过 `FORGEMIND_LLM_PROVIDER=deepseek` 显式切换到远程 DeepSeek，未配置时自动降级，不把 API Key 暴露到浏览器。
- 新增 L1/L2/L3 多楼层工厂：相邻楼层高度统一为 5.25m，上一层楼板底面略高于当前最高的内置可建造机器并保留约 0.42m 空隙；L2 提供加工、冲压、绕线和物料缓冲，L3 提供多输入装配、视觉质检、包装和成品缓冲。
- 建造目录提供向上/向下跨层倾斜传送带，采用现有滚筒传送带模型拼接，按 75% 固定坡度完成真实跨层运输；支持四向旋转、上下两层防穿模、端点续接、背压和三维在途货物显示。
- 仓储控制页已纳入 AGV 导航和无人机导航。无人机固定停靠 L1，通过升降井上升到 L2/L3，再沿高位环线和输入支线执行跨层补给；仿真启动后才推进运输任务。
- 建造页支持导入资源包：可拖入或选择项目 JSON 与 GLB，自动校验字段、归一化模型并生成设备封面；资源会写入 `imported_resource`，按用户隔离恢复，其他用户不能列出、下载或引用。
- 工厂项目库支持同一账号保存多份完整 v6 存档，楼层名称、参数化物品、工艺路线、机器定义、有限货架库存、入/出货仓库和实例配置均以无损 JSON 载荷保存；版本化 JSON 文件仅用于显式导入/导出。

生产控制台中的「生产效率」当前仍是演示读数；设备利用率、在途物料、产出和消耗以仿真快照为准。

## 模型（内置、公模与用户导入）

- **机械臂**：`public/models/robot_arm_6dof_white.glb`，来自 [cobot-atlas](https://huggingface.co/datasets/torusprime/cobot-atlas)（MIT，2023+ 工业机器人 GLB），1 个 mesh、约 2843 三角形。
- 加载时按补充设计 §2.3 规范化：包围盒居中 → 缩放到 1×1 网格足迹 → 底面落 y=0。
- 传送带 / source 用程序化几何（简单几何体，无需公模）。物品实体仍用 InstancedMesh 前的单盒占位。
- 用户导入 GLB 不直接打包进前端：浏览器端用于预览和当前会话，登录后由 Spring Boot 保存到用户自己的资源记录；再次登录时按需下载并生成 Blob URL。

## 演示脚本（§7.1）

```
1. 「物品」tab 建原料（如「铁板」）和成品（如「齿轮」）
2. 「配方」tab 建配方：铁板×1 → 齿轮×1，时长 1s
3. 「建造」tab 依次放置：
   - 原料源（Source），选中后绑定「铁板」
   - 传送带若干（注意 rotation 方向指向下游；按住左键沿网格直接拖绘，轨迹自动转弯；右键取消建造）
   - 通用机器，选中后绑定「铁板→齿轮」配方
4. 右键面板点「启动」，看铁板沿带流动、机器加工、齿轮产出
```

连接语义：每个对象的 `rotation` 即「输出方向」，物品沿它流向 `pos + dir` 那一格的下游对象。Source/机器 → 传送带 → 机器 → 传送带 → 空格（出口）。

## 目录结构

```
src/
├─ game/           # 纯逻辑：类型、网格、仿真引擎、PRNG、方向、存档
│  ├─ simulation.ts    # 仿真引擎（唯一真相源）
│  ├─ SimulationRunner.tsx  # 引擎驱动器（rAF + 低频快照写 store）
│  ├─ grid.ts / dir.ts / rng.ts / item.ts / save.ts / types.ts
├─ store/          # Zustand（低频 UI + 编辑 + 仿真快照）
├─ scene/          # Three.js 场景：画布、网格地面、对象、ItemLot、ghost、交互
├─ components/     # UI 面板：建造/物品/配方/信息/生产控制台/语音入口
└─ utils/          # UI 动效和无障碍降级工具
```

## 集成测试

```bash
npm run sim:regression            # 完整回归：闭环 / 转弯 / 分流 / 汇流 / 头堵
npm run generative:regression     # 生成布局 / 端口连接 / 副本仿真回归
```

也可以单独运行快速检查：

```bash
npm run sim:smoke                   # 闭环验证（Source→带→机→带→出口）
npm run sim:backpressure            # 背压验证（头堵停住不穿透）
```

`sim:regression`、`assistant:protocol`、`save:regression` 和 `models:validate` 是当前稳定回归项。`generative:regression` 的候选生成部分已通过，但 A-01 调整分支仍有“未返回 3 个全部可验证方案”的已知失败，发布前需单独修复生成器调整逻辑。

## 关键设计原则（防翻车）

- **当前运行时真相源在 `src/game/simulation.ts`**，前端内存仿真负责确定性推进；Spring Boot 保存可恢复的静态工厂结构，不逐 tick 接管仿真
- **React 管 UI，Three.js 管渲染**，只在低频层交集；高频仿真实体位置不进响应式 store
- **种子化随机数**，优化结论可复现
- 传送带**离散模型**（槽位 + 头堵背压），不是恒速路径插值
