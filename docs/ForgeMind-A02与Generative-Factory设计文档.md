# ForgeMind A-02 与 Generative Factory 设计文档

> 2026-08-19 部署策略更新：本文保留早期 DeepSeek/Ollama 方案比较作为设计过程，但当前实现已取消本地 Qwen/Ollama 依赖。生成器默认由前端规则解析和确定性副本仿真完成；`ai-service` 仅在显式启用时使用规则或远程 DeepSeek，模型不可用时直接回到规则约束。

> 状态：方案整理版
>
> 更新时间：2026-08-19
>
> 当前实现提示：A-02 的诊断和 Generative Factory 已在 `src/components/GenerativeFactoryWorkspace.tsx`、`src/game/factoryDiagnostics.ts` 和 `src/game/generativeFactory.ts` 中落地；诊断支持按 L1/L2/L3 楼层筛选，生成候选经过布局/端口校验和副本仿真。资源导入、仓储导航和无人机跨层运输属于 A-01 运行底座，事实索引见 [当前实现总览](D:/Code/factory/docs/ForgeMind-当前实现总览.md)。
>
> 目标：在保留 A-01 人工搭建产线的基础上，增加可切换的 A-02 AI 生成工厂实验场，并完成诊断与自动生成方案的产品闭环。

## 1. 产品定位

ForgeMind 的主链路从：

```text
用户放置设备 → 用户连接物流 → 启动仿真 → 观察结果
```

升级为：

```text
A-01 人工设计产线
        ↓
读取当前状态 / AI 诊断
        ↓
A-02 Generative Factory
        ↓
输入生产需求 → 自动生成候选产线 → 副本仿真验证 → 选择方案
```

A-02 不是 A-01 的复制页面，而是专门用于“方案生成、比较和验证”的实验场。两个场地之间切换时，布局、仿真进度、选中对象和生成候选方案互不污染。

### 1.1 ForgeMind 双引擎架构

本项目将“看见工厂”和“决定如何设计工厂”明确分成两个协作引擎，但不拆分现有代码仓库或运行时模块：

| 引擎 | 正式职责 | 当前实现 |
| --- | --- | --- |
| **宝钗（Baochai）渲染引擎** | 模型加载、材质与动画、实例化、预热、性能预算、三维场景渲染 | `src/engine/daiyu/` |
| **黛玉（Daiyu）智能工厂思考引擎** | 需求理解、Recipe Graph、设备估算、布局生成、物流路由、碰撞/接入校验、仿真评估、What-if、ROI 与方案解释 | `src/game/generativeFactory.ts` |

宝钗负责把已经确定的工厂状态稳定地呈现出来；黛玉负责从生产目标和当前状态中推导出可执行、可验证、可解释的工厂方案。两者之间通过工厂对象、布局快照和仿真快照协作，避免把自然语言模型直接接入实时渲染或生产仿真主循环。

### 2.3 共享诊断工作区

A-01 和 A-02 使用同一套 `AI FACTORY DIAGNOSTICS` 面板。面板结构、玻璃卡片、生成流程和操作位置保持一致，只根据当前场地替换：

- 场地编号和运行模式
- 当前设备、物流和仿真快照
- 候选布局与应用目标
- 诊断结论和建议动作

切换场地只切换数据，不自动跳转到诊断视图，也不自动弹出诊断面板。用户需要主动点击“诊断”进入共享工作区。

## 2. 场地设计

### 2.1 A-01 / LIVE LINE

- 定位：人工设计和真实示范产线
- 默认加载：当前 `createBaseA01Layout()` 布局
- 允许：放置、旋转、拆除、配方绑定、启动仿真、诊断
- 主要展示：完整的数字孪生工厂、生产流向和设备运行状态
- 不被 AI 自动生成流程直接覆盖

### 2.2 A-02 / GENERATIVE FACTORY LAB

- 定位：AI 自动设计生产线的实验场
- 初始状态：空白 30m × 20m 单层场地，显示生成入口
- 允许：填写生产目标、约束和优化偏好
- 生成结果：机器、输送线、缓存和 AGV 路线自动出现
- 支持：候选方案 A / B / C 比较、预览、仿真和应用
- 生成结果只写入 A-02，不修改 A-01

当前第一版实现将“连接校验”落实为端口驱动的 Manhattan 路由：首段传送带占据上游输出格，末段传送带占据下游输入格，中间每一段按下一格方向生成，并在候选方案生成后执行碰撞、上游接入和下游接入检查。校验不通过的方案不能被标记为可靠候选。

顶部场地切换建议：

```text
[ A-01 / LIVE LINE ]   [ A-02 / GENERATIVE LAB ]
```

切换场地时需要：

1. 保存当前场地的布局和运行状态引用。
2. 加载目标场地的 `objects`、选中对象和仿真快照。
3. 停止当前场地的仿真驱动，避免两个场地同时推进。
4. 清理 ghost 建造状态和路径预览。
5. 保留每个场地独立的撤销 / 重做栈。

建议的数据模型：

```ts
type FactoryId = 'a01' | 'a02'

interface FactoryWorkspace {
  id: FactoryId
  name: string
  mode: 'manual' | 'generated'
  floor: { width: number; depth: number }
  objects: FactoryObject[]
  simSnapshot: SimulationSnapshot
  generatedCandidates: LayoutCandidate[]
}
```

## 3. 诊断页面设计

诊断页的核心不是聊天，而是建立一条可验证的问题链：

```text
异常节点 → 影响路径 → AI 解释 → 调整动作 → 副本仿真对比
```

### 3.1 页面结构

```text
┌──────────────────────────────────────────────────────────────┐
│ 04 / AI FACTORY DIAGNOSTICS      A-01 / LIVE SIGNAL          │
│ Throughput   Utilization   Energy / Unit   Logistics Load    │
├──────────────────────────────┬───────────────────────────────┤
│                              │ AI FACTORY REPORT              │
│       3D 诊断视图             │ 当前瓶颈                        │
│       瓶颈节点高亮             │ 原因                            │
│       物流方向显示             │ 影响                            │
│       背压路径显示             │ 推荐动作                        │
├──────────────────────────────┴───────────────────────────────┤
│ BOTTLENECK CHAIN                                               │
│ CNC-02  →  BUFFER-03  →  WASH-01  →  OUTPUT                   │
├──────────────────────────────────────────────────────────────┤
│ [在副本中应用]       [运行对比]       [忽略建议]                │
└──────────────────────────────────────────────────────────────┘
```

### 3.2 诊断指标

第一版必须从仿真真实计算，不使用固定演示数字：

- `Throughput / h`：单位时间内的合格品产出
- `Equipment Utilization`：设备忙碌时间占比
- `Blocked Time`：设备或输送线被下游阻塞的时间
- `Queue Length`：设备输入前的等待数量
- `Logistics Load`：在途物料和物流节点占用率
- `Energy / Unit`：每件产品的估算能耗
- `Bottleneck Score`：综合利用率、等待时间和下游阻塞的评分

### 3.3 诊断动作

AI 不直接自由修改工厂，只能从动作库选择结构化动作：

```ts
type DiagnosticAction =
  | { type: 'add_buffer'; anchorId: string; length: number }
  | { type: 'add_machine'; machineType: BuildType; count: number }
  | { type: 'move_object'; objectId: string; pos: GridPos }
  | { type: 'reroute_conveyor'; fromId: string; toId: string }
  | { type: 'change_priority'; metric: 'throughput' | 'energy' | 'logistics' }
```

执行动作时必须：

1. 复制当前工厂。
2. 校验设备边界、碰撞和连接合法性。
3. 在副本中运行仿真。
4. 以仿真结果判断建议是否有效。
5. 只在用户确认后应用到当前场地。

## 4. Generative Factory 页面设计

### 4.1 输入示例

```text
我要生产齿轮箱。
每小时目标 120 件。
场地 30m × 20m。
CNC 最多 4 台。
AGV 最多 3 台。
尽量降低能耗。
```

页面将自然语言转换为可编辑的结构化需求：

```text
PRODUCT              GEARBOX
TARGET               120 / H
FLOOR                30 × 20 M
CNC LIMIT            04
AGV LIMIT            03
PRIMARY OBJECTIVE    LOW ENERGY
```

### 4.2 生成过程

```text
01  需求确认
02  Recipe Graph
03  设备需求估算
04  Layout Candidate × 20
05  碰撞与边界校验
06  物流路径规划
07  副本仿真
08  评分与排序
09  选择 Top 3
```

生成中间态必须是真实状态，不应直接伪造最终指标：

```text
PARSING REQUIREMENTS
BUILDING RECIPE GRAPH
SEARCHING LAYOUTS
VALIDATING COLLISIONS
SIMULATING CANDIDATES
RANKING RESULTS
```

### 4.3 Top 3 方案卡片

```text
CANDIDATE 01 / BALANCED FLOW

Throughput          <来自副本仿真的实时值> / h
Utilization           81.4%
Energy / Unit          4.8 kWh
Logistics Efficiency   92.1%
Footprint              86%

优点：吞吐与能耗平衡
风险：装配区物流距离偏长

[查看方案]  [在 A-02 中预览]  [应用方案]
```

只有副本仿真完成后，才显示：

```text
VERIFIED BY FORGEMIND
```

## 5. `glass3d` 卡片规范

诊断报告卡、生成进度卡、候选方案卡和右侧结果面板统一使用 `.glass3d`。卡片必须保留三层结构：

1. 主体内容层：标题、指标、按钮和交互元素。
2. `::before`：玻璃模糊、色彩和噪声材质。
3. `::after`：内边缘高光和玻璃折射感。

推荐基础样式：

```css
.glass3d {
  --filter-glass3d: blur(32px) brightness(0.85) saturate(2.5);
  --color-glass3d: hsl(189 80% 10% / 0.2);
  --noise-glass3d: url("https://www.transparenttextures.com/patterns/egg-shell.png");

  position: relative;
  z-index: 4;
  box-shadow:
    0 0 0.75px hsl(205 20% 10% / 0.2),
    0.7px 0.8px 1.2px -0.4px hsl(205 20% 10% / 0.1),
    1.3px 1.5px 2.2px -0.8px hsl(205 20% 10% / 0.1),
    2.3px 2.6px 3.9px -1.2px hsl(205 20% 10% / 0.1),
    3.9px 4.4px 6.6px -1.7px hsl(205 20% 10% / 0.1),
    6.5px 7.2px 10.9px -2.1px hsl(205 20% 10% / 0.1),
    8px 9px 14px -2.5px hsl(205 20% 10% / 0.2);
}

.glass3d::before {
  content: "";
  position: absolute;
  inset: 0;
  pointer-events: none;
  border-radius: inherit;
  overflow: hidden;
  z-index: 3;
  -webkit-backdrop-filter: var(--filter-glass3d);
  backdrop-filter: var(--filter-glass3d);
  background-color: var(--color-glass3d);
  background-image: var(--noise-glass3d);
  background-size: 100px;
  background-repeat: repeat;
}

.glass3d::after {
  content: "";
  position: absolute;
  inset: 0;
  pointer-events: none;
  border-radius: inherit;
  overflow: hidden;
  z-index: 5;
  box-shadow:
    inset 2px 2px 1px -3px hsl(205 20% 90% / 0.8),
    inset 4px 4px 2px -6px hsl(205 20% 90% / 0.3),
    inset 1.5px 1.5px 1.5px -0.75px hsl(205 20% 90% / 0.15),
    inset 1.5px 1.5px 0.25px hsl(205 20% 90% / 0.03),
    inset 0 0 0.25px 0.5px hsl(205 20% 90% / 0.03);
}

.glass3d > * {
  position: relative;
  z-index: 6;
}
```

使用要求：

- 外层卡片必须设置 `border-radius`，伪元素继承圆角。
- 内容层不能设置低于 `z-index: 6` 的定位层，否则会被玻璃伪元素遮挡。
- 按钮仍需保持 `pointer-events: auto` 和可见 focus 状态。
- 生成动画只作用于内容层，不要让 `.glass3d` 外层整体参与位移动画。
- `prefers-reduced-motion` 下关闭持续闪烁和循环动画。
- 外部噪声图片适合视觉稿；正式部署可改为本地纹理，避免离线时材质缺失。

## 6. AI 模型策略

采用“确定性规则默认 + 远程模型可选”的模式：

```text
前端/服务端规则解析
    ↓ 默认需求约束 / 离线演示 / 基础助手
确定性布局算法
    ↓ 碰撞 / 路径 / 副本仿真 / 评分
可选 DeepSeek API
    ↓ 复杂自然语言提取；输出仍需规则与仿真校验
```

### 6.1 DeepSeek API

适合：

- Generative Factory 的自然语言需求解析
- Recipe Graph 解释和复杂诊断
- JSON Output 与 Tool Calls
- 长上下文工厂状态分析

当前接入时应使用服务端代理，不允许前端暴露 API Key。模型名称通过环境变量配置，不把模型名写死在组件中。

### 6.2 默认规则与降级

规则 Provider 负责普通状态问答、启停/倍率等白名单动作、断网演示和模型失败降级。它不依赖 Python 服务即可在前端工作；显式启动 `ai-service` 时，服务端默认也使用同一类确定性规则。项目不再维护本地语言模型运行链路。

建议环境变量：

```env
FORGEMIND_LLM_PROVIDER=deepseek
DEEPSEEK_API_KEY=...
DEEPSEEK_MODEL=deepseek-chat
FORGEMIND_LLM_TIMEOUT=30
```

模型只负责输出 `GenerationSpec`、诊断解释或动作选择；布局坐标、设备数量、路线和指标必须由黛玉智能工厂思考引擎自己的确定性算法和仿真模块决定。当前实现通过 `POST /api/ai/factory-spec` 提取约束，DeepSeek 由 `FORGEMIND_LLM_PROVIDER=deepseek` 启用；没有 AI 服务时前端规则解析自动接管。生成完成后，方案交给宝钗渲染引擎呈现为三维工厂。

## 7. 技术模块拆分

当前垂直切片将以下职责收敛在可测试的纯逻辑模块中；后续可以按规模再拆分：

```text
src/game/generation/
├─ generationTypes.ts       # GenerationSpec / LayoutCandidate / Score
├─ recipePlanner.ts         # 需求 → Recipe Graph
├─ equipmentEstimator.ts    # 配方 → 设备数量
├─ layoutGenerator.ts       # 生成布局候选
├─ layoutValidator.ts       # 边界 / 碰撞 / 连接校验
├─ routePlanner.ts          # 输送线与 AGV 路线
├─ candidateEvaluator.ts    # 副本仿真和评分
└─ diagnosticsEngine.ts     # 规则诊断和瓶颈链
```

当前对应实现：`src/game/generativeFactory.ts` 负责需求解析、Recipe Graph、端口路由、校验、副本仿真、评分和当前产线调整；`src/game/factoryDiagnostics.ts` 负责 A01/A02 共享实时诊断；`src/game/factoryAI.ts` 与 `ai-service/main.py` 负责默认规则和可选 DeepSeek 约束提取。

核心原则：

- LLM 不直接生成任意 `FactoryObject[]`。
- 每个候选方案必须经过合法性校验。
- 每个最终指标必须来自副本仿真。
- A-02 生成失败时不能污染 A-01。
- 当前工厂优先走 Adjustment Engine：先保留工艺设备，再重建物流层；只有缺少配方锚点或原位路由不可行时才执行完整重构。
- 生成过程可以取消、重试和回滚。

### 7.1 Adjustment Engine

诊断页在 A-01 等已有工厂上不会直接覆盖原布局，而是返回三种干预级别：

1. `CURRENT LINE`：当前布局基线，用于对照吞吐、利用率和开放问题。
2. `MINIMAL REWIRE`：保留原有工艺设备位置，移除陈旧传送带并按 Recipe Graph 重新连接端口；旧缓存、分流器和停放车辆不会遮挡新路线。
3. `FULL REBUILD`：当前工厂缺少完整物料锚点或原位路由搜索失败时，回退到经过碰撞校验和副本仿真的完整生成布局。

每个调整候选都携带可解释的 `AdjustmentAction`，应用前显示“读取当前状态 / 重建端口路由 / 清理陈旧物流资产 / 完整重构”等动作摘要。应用仍然经过 `validation.passed` 门禁，并通过 store 的历史栈支持撤销。

### 7.2 动态产品与多目标搜索

需求中的产品名称会先选择产品配方 Profile。当前已落地：

- 电机：机加工、清洗、冲压、紧固件齐套、线圈、装配、质检、包装。
- 齿轮箱：齿轮切削、齿轮清洗、箱体成型、紧固件齐套、定量润滑、齿轮箱装配、啮合质检、包装。

每个 Profile 会同时提供 `RecipeGraph`、仿真配方和物品定义，应用候选时一并合并到当前工厂，避免只改产品名称但运行时仍使用旧配方。

已有工厂的局部调整会搜索多个邻域动作：原位重布线、装配单元左移、装配单元右移；每个邻居都经过仿真，再与完整重构候选一起评分。评分同时考虑吞吐、利用率、能耗、物流效率、改造成本和结构风险，并标记 Pareto 前沿等级。

### 7.3 四项升级能力

> 引擎归属：以下生成、调整、What-if 和 ROI 能力属于黛玉智能工厂思考引擎；候选方案应用后的模型加载、材质、动画、批处理和性能监控属于宝钗渲染引擎。

当前生成器已经把生成流程从“三个固定策略”升级为可解释的搜索与评估引擎：

1. **自动扩容**：`planMachineCounts()` 根据目标产出和配方节拍估算 `requiredCount`，CNC 与单输入工序使用经过验证的并行路线生成设备；装配等多输入工序会保留需求估算，并在当前场地无无碰撞扩容路线时标记为待扩容，不生成未接通的假设备。
2. **多轮迭代搜索**：`searchRounds` 控制 1～4 轮 Beam Search。每轮从前一轮 Top 候选派生 CNC、AGV 和关键工序邻居，重新执行路由、碰撞校验和 10 分钟副本仿真，再做签名去重和 Pareto 排名。
3. **What-if Lab**：支持 `+/- CNC`、`+/- 装配单元`、`+/- AGV` 的前后对照。试算复用同一确定性仿真；如果变更在当前边界内无法找到安全路线，结果会显示路线不可行，而不是直接改写当前工厂。
4. **ROI / 成本评估**：候选使用电价、月运行小时、单位贡献、设备 CAPEX 和改造成本估算能耗成本、月度收益、增量投资、回本月数和 12 个月 ROI。参数可在诊断页编辑，默认值只用于演示，不替代真实财务报价。

#### 当前扩容边界

CNC 与单输入工序的并行布局已经纳入生成与回归验证；清洗、压机、线圈、装配和质检中的多输入组合仍受 30×20m 版面的端口和路线容量约束。算法会把这类节点作为需求估算和迭代搜索对象，只有通过碰撞与连接校验才允许应用。后续可增加更大的厂房、跨区物流或带容量的多路汇流节点，以释放全部并行计划。

## 8. 实现顺序

### 第一阶段：场地切换

- 增加 `FactoryId` 和场地元数据。
- A01 / A02 独立布局和仿真状态。
- 顶部场地切换控件。
- 右侧状态面板显示当前场地名称和模式。
- A02 空场地状态卡使用 `.glass3d`。

### 第二阶段：诊断闭环

- 补齐吞吐、阻塞、能耗和瓶颈指标。
- 增加规则诊断。
- 增加诊断卡片和瓶颈链高亮。
- 增加“在副本中应用”和“运行对比”。

### 第三阶段：Generative Factory

- 固定齿轮箱 Recipe Graph，覆盖机加工、清洗、冲压、紧固件齐套、线圈、装配和视觉终检。
- 需求表单和结构化约束。
- 3 种布局策略、每种若干候选。
- 碰撞和连线校验。
- 副本仿真、真实指标计算和 Top 3 排名。
- A-02 方案预览和应用。

### 第四阶段：AI 接入

- DeepSeek API Provider。
- 规则 Provider 与 DeepSeek 可选 Provider。
- JSON Schema 校验。
- AI 生成过程流式状态。
- 错误、超时和断网降级。

## 9. 竞赛展示脚本

1. 进入 A-01，展示人工搭建的真实产线。
2. 启动仿真，切换到诊断视图。
3. AI 定位 CNC 出口缓存瓶颈。
4. 点击“在副本中应用”，展示指标对比。
5. 切换到 A-02 / GENERATIVE FACTORY LAB。
6. 输入“生产齿轮箱，每小时 120 件，场地 30m × 20m，最多 4 台 CNC，尽量降低能耗”。
7. 页面依次显示需求解析、配方图、设备估算、布局搜索和副本仿真。
8. 三个候选方案卡片使用 `.glass3d` 展示。
9. 在 A-01 选择最优调整，或在 A-02 选择最优生成方案；机器、输送线和 AGV 路线在当前场地中更新。
10. 最后显示：

```text
GENERATED BY FORGEMIND
VERIFIED BY SIMULATION
Throughput <来自副本仿真的实时值> / h
Utilization <来自副本仿真的实时值>%
Logistics Efficiency <来自副本仿真的实时值>%
```

## 10. 验收标准

- A01 与 A02 可以无刷新切换。
- 修改 A02 不改变 A01。
- 生成方案不出现越界、重叠或无连接设备；每条传送带必须有上游输出和下游设备接口。
- Top 3 指标来自副本仿真，而不是固定文案；候选卡同步显示瓶颈和结构校验结果。
- API 不可用时，浏览器内置规则仍可完成基础助手功能。
- 诊断建议必须能查看原因、影响路径和应用前后对比。
- 所有诊断卡、生成卡和候选方案卡统一使用 `.glass3d` 材质。
