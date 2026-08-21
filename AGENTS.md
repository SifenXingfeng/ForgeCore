# ForgeMind 项目协作约定

## 唯一维护目录

- 从 2026-08-19 起，只修改本文件所在的 ForgeMind 项目目录。
- `D:/Desktop/ForgeCore智慧工厂/` 及其他旧目录仅为历史来源，不再作为实现或文档维护入口。
- 已迁入的 ForgeCore 原始资料位于 `docs/archive/forgecore/`；归档文件不得直接改写为当前事实。

## 权威方案与文档

- 根目录 `ForgeMind 项目方案.md` 是唯一权威项目方案。
- 变更产品范围、架构、技术选型、数据模型、UI、资产规范、启动方式、AI 策略或路线图时，先更新该文件。
- `docs/ForgeMind-当前实现总览.md` 只记录实际代码状态；设计稿、宣传片、历史方案不能覆盖代码事实。
- 文档分类、阅读顺序和维护状态见 `docs/README.md`。
- 新旧能力的继承、替代和缺口见 `docs/ForgeCore-融合迁移审计.md`。

## AI 依赖约定

- 默认启动不得要求 Ollama、Qwen 或任何本地部署的大语言模型。
- 前端、确定性仿真、寻路、诊断和生成式工厂规则规划必须在无 AI 服务时可运行。
- `ai-service` 是可选网关，默认使用 `rule`；远程模型只允许由服务端环境变量显式启用，密钥不得进入浏览器或仓库。
- 不得让大语言模型直接决定布局坐标、碰撞结论、物料数量、寻路结果或仿真指标。

## 资产与制作约定

- ForgeCore 36 个默认物品位于 `public/models/forgecore/items/`，生成器位于 `tools/item-models/`。
- 修改默认物品几何、参数、材质或预览时，必须由生成器重建，不手工编辑生成产物；随后执行完整模型验证。
- Cels AGV 与 Count Infinity 无人机均为 CC BY 4.0，必须保留署名、来源链接和修改声明。
- 工业、公模和用户私有模型不得混同；未知或限制性许可资产不得声明为 ForgeMind 原创或可自由商用。
- 资产变更需同步更新 `docs/资产与许可审计.md` 和下方协作审计。

## 验证与审计

- 交付前按 `ForgeMind 项目方案.md` 的验证门禁运行对应检查。
- 已知失败要明确记录，不得写成全量通过。
- 每次形成可交付变更时，在下表追加日期、变更、权威位置和实际验证。

## 协作审计

| 日期 | 变更 | 权威位置 | 验证 |
| --- | --- | --- | --- |
| 2026-08-19 | 建立 ForgeMind/ForgeCore 融合文档基线并切换唯一维护目录 | `ForgeMind 项目方案.md`、`docs/README.md`、`docs/ForgeCore-融合迁移审计.md`、`docs/archive/forgecore/` | 4 份历史文档逐文件 SHA-256 一致，10 张 UI 参考图和 8 个确定性物品生成器文件已迁入；旧目录保持只读 |
| 2026-08-19 | 取消默认本地 LLM 依赖，改为浏览器/服务端规则默认与远程 DeepSeek 可选 | `src/game/api.ts`、`src/game/assistantRuntime.ts`、`src/game/factoryAI.ts`、`ai-service/main.py`、`ai-service/requirements-core.txt` | TypeScript 生产构建、Python 语法编译和协议回归通过；规则服务实测 `provider=rule`、`localModelRequired=false`、语音默认关闭，状态查询和 2 倍速动作正确返回 |
| 2026-08-19 | 建立默认仅前端的一键启停并修复 Windows 子进程残留与脚本编码 | `启动ForgeMind.cmd`、`scripts/start-forgemind.ps1`、`scripts/stop-forgemind.ps1` | 默认模式在测试端口 5177/5179、可选 AI 模式在 5178 实测 HTTP 200；停止后 5177/5178/5179/8000 均释放；默认启动未启动 Python、Java、Docker 或模型服务 |
| 2026-08-19 | 恢复 ForgeCore 物品可重现制作链并清理非运行时 LFS 指针 | `tools/item-models/`、`public/models/forgecore/items/`、`docs/archive/forgemind-lfs-pointers/`、`docs/资产与许可审计.md` | 36 个 modelId、436 项参数 schema、184 项几何参数、74 文件双次重建字节一致；严格模型审计通过 |
| 2026-08-19 | 完成融合版基线回归 | `docs/ForgeMind-当前实现总览.md`、`ForgeMind 项目方案.md` | build、smoke、8/8 仿真、背压、助手协议、178 对象存档和两套模型校验通过；`generative:regression` 的生成布局 3/3 通过，但 A-01 调整仍因不足 3 个可验证候选失败，已列为现存缺口 |
| 2026-08-19 | 补齐认证后端依赖并让推荐双击入口启动完整注册链路 | `启动ForgeMind.cmd`、`scripts/start-forgemind.ps1`、`scripts/stop-forgemind.ps1`、`backend/.mvn/forgemind-global-settings.xml` | Maven/JDK 17 构建与测试目标成功；MySQL 8.4 项目实例初始化并完成 Flyway 迁移；三端口全停后的冷启动、8080 健康检查、真实注册和登录通过，测试账号已清理 |
| 2026-08-20 | 按 ForgeCore 历史观感重新校准生产机器、传送带与运输载具比例 | `src/scene/industrialVisualScale.ts`、`src/scene/EquipmentModel.tsx`、`src/engine/daiyu/`、`src/scene/GhostPreview.tsx`、`src/scene/ItemLotMesh.tsx`、`ForgeMind 项目方案.md` | 机器 `2×`、传送带横截面 `2×` 且单格长度不变；通用机器/AGV 宽度比由约 0.70 提升至 1.41，接近旧版 1.54；TypeScript 与生产构建通过 |
| 2026-08-20 | 恢复 ForgeCore 式建造交互：水平右键平移、传送带左键直接拖绘自动转点、建造右键取消 | `src/game/conveyorTrace.ts`、`src/scene/BuildPlacer.tsx`、`src/scene/FactoryCanvas.tsx`、`scripts/interaction-regression.ts`、`ForgeMind 项目方案.md` | 自动补格、转点、回拖和闭环裁切回归通过；TypeScript/生产构建、闭环 smoke、8/8 仿真、背压、助手协议、178 对象存档与 36 项严格模型审计通过 |
| 2026-08-20 | 将 AGV/无人机之外的全部可建造建筑再次统一放大一档 | `src/scene/industrialVisualScale.ts`、`src/scene/EquipmentModel.tsx`、`src/engine/daiyu/`、`src/scene/GhostPreview.tsx`、`scripts/visual-scale-regression.ts`、`ForgeMind 项目方案.md` | 普通建筑额外 `1.25×`、生产机器累计 `2.5×`、传送带宽高累计 `2.5×` 且长度不变，AGV/无人机保持 `1×`；生产构建、比例契约、闭环 smoke、8/8 仿真、背压、交互、助手协议、178 对象存档及 36 项严格模型审计通过 |
| 2026-08-20 | 压缩三层楼层高度并恢复真实向上/向下跨层倾斜传送带 | `src/game/floorConfig.ts`、`src/game/inclineConveyor.ts`、`src/scene/InclineConveyorMesh.tsx`、`src/game/simulation.ts`、`src/game/save.ts`、`scripts/multifloor-conveyor-regression.ts`、`ForgeMind 项目方案.md` | 层高 `5.25m`、最高内置机器约 `4.75m`、楼板底净空约 `0.42m`；当前滚筒模型按 `75%` 坡度、`7m` 水平投影和 `8.75m` 坡长拼接，上下双向真实运输、四向无侧滚、双层碰撞、背压和 v1→v3 存档迁移通过；生产构建、闭环 smoke、8/8 仿真、背压、交互、比例、跨层、助手协议、178 对象存档及 36 项严格模型审计全部通过 |
| 2026-08-20 | 恢复 ForgeCore 式跨层接口吸附、单一楼层网格、只读上下文楼层与无人机任意方向三维运输 | `src/game/inclineConveyor.ts`、`src/game/floorVisibility.ts`、`src/game/dronePathfinding.ts`、`src/game/simulation.ts`、`src/scene/BuildPlacer.tsx`、`src/scene/FactoryCanvas.tsx`、`src/scene/FactoryFloorSystem.tsx`、`src/scene/InclineConveyorMesh.tsx`、`src/scene/DroneRouteVisual.tsx`、`src/components/FloorSwitcher.tsx`、`src/components/DroneNavigationControl.tsx`、`scripts/*-regression.ts`、`ForgeMind 项目方案.md` | 坡道和平面输送带可在兼容方向双向吸附；点击楼层自动开启并成为唯一可编辑层，只复用原 `GridFloor` 的一块 1m 毛玻璃网格，额外开启层仅显示建筑/物流且不可选择修改，不显示楼板、地面或网格；无人机改为任意楼层起终点和 26 邻域三维 A*。界面验收确认关闭 L2 后直接点击可自动开启切换、活动层只有一块地面、上下文只有只读建筑且浏览器零错误；相关回归、生产构建、存档及严格模型审计通过 |
| 2026-08-20 | 修正楼层显示优先级并引入空白工厂存档工作流 | `src/game/floorVisibility.ts`、`src/components/FloorSwitcher.tsx`、`src/components/FactoryProjectDialog.tsx`、`src/game/save.ts`、`src/store/forgeMind.ts`、`src/game/simulation.ts`、`src/scene/`、`src/engine/daiyu/`、`ForgeMind 项目方案.md` | 活动楼层高优先级直接显示但不改逐层开关，可手动加层；登录后新建空白工厂或加载 v4 存档；去除传送带箭头，停止仿真时停止滚动，货物跨段保持 ID 并平滑呈现。生产构建、smoke、8/8 仿真、背压、交互、比例、跨层、楼层显隐、无人机、助手协议、v1→v4 存档和 36 项严格模型审计通过；本地界面验收确认 0 设备空白开局、动态加层、开关状态不随选层变化、v4 加载和暂停/运行运动层切换，控制台零错误。生成布局 3/3 通过，既有 A-01 调整阶段仍因不足 3 个可验证候选失败 |
| 2026-08-20 | 恢复旧版参数化业务库、机械制造、真实端口与三向仓储/装配物流 | `src/components/ItemPanel.tsx`、`RecipePanel.tsx`、`MachineManufacturingWorkspace.tsx`、`BuildMenu.tsx`、`InfoPanel.tsx`、`WarehouseWorkspace.tsx`、`src/game/item.ts`、`types.ts`、`grid.ts`、`save.ts`、`simulation.ts`、`src/store/forgeMind.ts`、`src/scene/FactoryObjectMesh.tsx`、`IncomingStationModel.tsx`、`PandaArmModel.tsx`、`scripts/manufacturing-regression.ts`、`ForgeMind 项目方案.md` | 空白工厂物品/配方/机器均为 0；楼层可命名；独立物品与工艺 CRUD、机械制造机器 CRUD、现有/自有模型、路线容量门禁、基础加工目录注入、精密装配多合一、逐端口蓝/黄标志与传送带吸附、货物存取站三侧双向机械臂及 v5 存档已落地。生产构建与全部相关回归通过；浏览器验收完成 0 开局→楼层命名/加层→参数化物品→双入单出工艺→2 入 1 出机器→基础加工目录的完整链路 |
| 2026-08-20 | 纠正物品、生产路线与机械制造的工作区职责 | `src/components/ItemDetailWorkspace.tsx`、`ProductionRouteWorkspace.tsx`、`MachineManufacturingWorkspace.tsx`、`src/App.tsx`、`src/index.css`、`src/production.css`、`ForgeMind 项目方案.md` | 下栏新增独立“物品详情”作为物品 CRUD 唯一入口；“生产路线”保留原配方目录/详情/工艺链三栏总览，并以覆盖层恢复新增和编辑；“机械制造”移除物品/路线子标签，只管理机器并引用已存在路线。生产构建、交互/机械制造/v5 存档回归和浏览器验收通过 |
| 2026-08-20 | 将货物存取站改为三面真实货架吸附、货架对象库存与双向动画，并统一站内带面和外置接口标识 | `src/game/grid.ts`、`src/game/simulation.ts`、`src/game/types.ts`、`src/scene/IncomingStationModel.tsx`、`PandaArmModel.tsx`、`FactoryObjectMesh.tsx`、`FactoryCanvas.tsx`、`industrialVisualScale.ts`、`src/components/InfoPanel.tsx`、`WarehouseWorkspace.tsx`、`scripts/manufacturing-regression.ts`、`scripts/station-rack-browser-audit.mjs`、`ForgeMind 项目方案.md` | 存取站改为 `4×4`，后/左/右各有居中 `2×2` 泊位且站/架可双向放置吸附；库存按实际货架 ID 增减，缺架取货阻塞、缺架存货保留传送带来货；取/存动画使用正反路径，内嵌传送带降至地面带高并复用暂停静态/运行移动灰纹，蓝黄标识位于缩放后模型包络之外。生产构建、smoke、8/8 仿真、背压、交互、选择、比例、机械制造、跨层传送带、楼层显隐、无人机、v5 存档、助手协议和 36 项严格模型审计通过；隔离 Edge 浏览器验收三面连接、左架 `24→23`、暂停进度冻结与零 JavaScript 错误通过，留存暂停/运行截图 |
| 2026-08-20 | 校准货物存取站内嵌传送带与前侧吸附传送带的实际模型接缝 | `src/scene/industrialVisualScale.ts`、`IncomingStationModel.tsx`、`FactoryCanvas.tsx`、`PandaArmModel.tsx`、`scripts/visual-scale-regression.ts`、`scripts/station-rack-browser-audit.mjs`、`ForgeMind 项目方案.md` | 抵消站体 `1.25×` 缩放造成的 `0.125m` 横向偏移并移除约 `0.53m` 半段叠压；非合批/合批模型、灰色条纹、末端护挡和机械臂交接点共用校准位置。生产构建、比例、机械制造、交互回归及隔离 Edge 三向仓储浏览器验收通过；近景截图确认站内短带与两段外部带共中心线、同床宽且端面对接，浏览器零 JavaScript 错误 |
| 2026-08-20 | 修复机械制造展开时设备详情遮挡与外置机器端口只显示不参与仿真的断链 | `src/App.tsx`、`src/index.css`、`src/game/grid.ts`、`simulation.ts`、`generativeFactory.ts`、`src/scene/FactoryObjectMesh.tsx`、`scripts/sim-regression.ts`、`manufacturing-regression.ts`、`ForgeMind 项目方案.md` | 设备详情在机械制造工作区内改为 `310×460px` 高层级短窗和内部滚动；蓝/黄可见标记格统一成为吸附、连接与仿真端口，同时兼容旧贴边线路；未连接末端改为堵停保货。生产构建、10/10 仿真、smoke、背压、机械制造、交互、选择、比例、跨层传送带和 v5 存档回归通过；用户当前 Edge 的 21 设施工厂实测 36.7 秒消耗 5、产出 4、利用率 61.3%，随后暂停且未保存 |
| 2026-08-20 | 让货物存取站内嵌短带始终对正实际接口并按存取模式双向运行 | `src/game/grid.ts`、`simulation.ts`、`factoryDiagnostics.ts`、`src/scene/IncomingStationModel.tsx`、`ConveyorMotionStripes.tsx`、`EquipmentModel.tsx`、`FactoryObjectMesh.tsx`、`industrialVisualScale.ts`、`scripts/visual-scale-regression.ts`、`manufacturing-regression.ts`、`ForgeMind 项目方案.md` | 存取站单接口改为稳定的局部中线选择，修复 90°/180° 后站内短带与接口分居两条中线；四个朝向均验证同侧、同线和端面对接，旧旋转存档的第一中线仍作为兼容接口。取货条纹向外、存货入货条纹从当前相位反向朝内，暂停冻结；生产构建、视觉比例、机械制造/仓储、10/10 仿真及 v1→v5 存档回归通过。用户 Edge 扩展在最终视觉复查时已断开，未以电脑控制或其他浏览器替代 |
| 2026-08-20 | 补齐建造态详情短窗、仓储边界和 AGV/无人机悬浮编程 | `src/App.tsx`、`src/index.css`、`src/components/InfoPanel.tsx`、`WarehouseWorkspace.tsx`、`StorageContentOverlay.tsx`、`AgvNavigationControl.tsx`、`DroneNavigationControl.tsx`、`src/game/types.ts`、`simulation.ts`、`save.ts`、`src/store/forgeMind.ts`、`src/scene/EquipmentModel.tsx`、`backend/src/main/java/com/forgemind/repository/FactoryProjectDbStore.java`、`scripts/storage-logistics-regression.ts`、`ForgeMind 项目方案.md` | 建造面板展开即启用 `310×460px` 建筑详情短窗；原生下拉框改为深色字/高对比底色；普通货架采用有限容量与真实库存，入货仓库无限供货并记消耗，出货仓库不可逆接收并记产出；AGV/无人机选中悬浮窗提供三节点编程，新放置车辆无默认路线或货物；前后端存档统一升至 v6。生产构建、仿真、仓储账本、无人机、交互、机械制造和存档回归通过；应用内浏览器为未登录新会话，仅确认登录入口可达，未绕过认证伪造视觉验收 |
| 2026-08-21 | 修复运行 JAR 版本错位并加入仓储实例命名与旧档迁移 | `src/game/types.ts`、`save.ts`、`src/store/forgeMind.ts`、`src/components/InfoPanel.tsx`、`WarehouseWorkspace.tsx`、`AgvNavigationControl.tsx`、`DroneNavigationControl.tsx`、`scripts/save-regression.ts`、`backend/target/forgemind-backend-0.1.0.jar`、`ForgeMind 项目方案.md` | 普通货架、入货仓库和出货仓库可设置 40 字符显示名称，仓储总览与 AGV/无人机起终点选择统一优先显示；v1–v6 缺名合法、旧 `name/customName` 迁入，旧货架生成有限容量。重新执行 `mvn package` 并只重启 8080，JAR 内 `MAX_SAVE_VERSION=6` 且包含 V8；真实注册隔离测试完成 v1 创建、v6 名称往返、自动恢复写入，测试存档与账号已清理。应用内浏览器连接未建立，因此未声明本轮场景截图验收 |
| 2026-08-21 | 纠正真实供货来源、车辆实体语义与边界产销账本 | `src/game/types.ts`、`save.ts`、`simulation.ts`、`generativeFactory.ts`、`src/store/forgeMind.ts`、`src/components/InfoPanel.tsx`、`AgvNavigationControl.tsx`、`DroneNavigationControl.tsx`、`WarehouseWorkspace.tsx`、`ProductionWorkspace.tsx`、`src/scene/RackInventoryLabels.tsx`、`FactoryCanvas.tsx`、`scripts/*-regression.ts`、`ForgeMind 项目方案.md` | 普通货架无需存取站即可被 AGV/无人机直接取放，但必须真实拥有完整每趟数量；缺货/不足时阻塞且不半载、不凭空供货。车辆改为无蓝黄建筑接口的独立角色，直接选中显示状态，恢复一直运输/库存阈值触发。每个活动层货架显示实际种类、数量和容量；消耗仅登记入货仓库实际取出，产出仅登记出货仓库实际入库，生成布局同步改用入/出货边界。生产构建、smoke、10/10 仿真、背压、仓储、机械制造、跨层、无人机和 v1→v6 存档回归通过；`generative:regression` 仍在 A-02 的 `coil_1 → assembly_1` 端口路由失败；未声明浏览器视觉验收 |
| 2026-08-21 | 修正载具悬浮窗设置项横向挤压 | `src/index.css`、`ForgeMind 项目方案.md`、`docs/ForgeMind-当前实现总览.md` | 供货方式、起点库存阈值、终点库存阈值、策略和优先级改为一项一行，标签固定可读宽度、输入控件占满剩余空间；生产构建通过 |
| 2026-08-21 | 修复无人机无法点选与停靠点单节点路径不运输 | `src/engine/daiyu/DaiyuStaticModelBatch.tsx`、`src/game/simulation.ts`、`scripts/drone-navigation-regression.ts`、`ForgeMind 项目方案.md` | 活动层无人机使用随运行坐标同步的独立透明命中体；已在装卸悬停格时直接执行真实到站装卸。生产构建、smoke、10/10 仿真、背压、交互/选择、比例、机械制造、跨层传送带、楼层显隐、无人机、仓储、助手协议、v1→v6 存档及 36 项严格模型审计通过；用户当前 Edge 点击机体已打开载具详情，零距离任务进入实际库存等待。隔离 `selection:browser-audit` 连续两次在既有三建筑框选步骤超时，未声明通过 |
