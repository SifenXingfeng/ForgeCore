# ForgeMind 当前实现总览

> 更新时间：2026-08-21
> 本文是当前代码的事实索引。产品方案、演示脚本和研究性文档中的“目标架构”不应覆盖本文对已落地行为的描述。

## 1. 项目边界

ForgeMind 是一个 React + Three.js 的数字工厂编辑、生产路线和仿真前端，配套两个可选服务：

| 层 | 代码位置 | 当前职责 |
| --- | --- | --- |
| 前端应用 | `src/` | 页面、工厂状态、编辑器、三维场景、生产路线和浏览器内确定性仿真 |
| Spring Boot | `backend/` | 登录会话、用户工厂存档、物品/配方/设备布局和用户导入资源的 MySQL 持久化 |
| 可选智能服务 | `ai-service/` | 规则助手、可选远程 DeepSeek、工具协议、ASR/TTS 和视觉检测辅助；不进入仿真 tick 链路 |
| 自研渲染层 | `src/engine/daiyu/` | 静态模型批处理、传送带批处理、Panda/嵌入模型和运行时渲染预算 |

当前仿真逻辑仍由 `src/game/simulation.ts` 驱动。Spring Boot 保存的是可恢复的工厂结构，不是每一帧的 `ItemLot`、AGV 或无人机坐标。

## 2. 已落地功能矩阵

| 能力 | 主要入口 | 状态 | 说明 |
| --- | --- | --- | --- |
| 登录与用户隔离 | `src/store/auth.ts`、`src/api/auth.ts` | 已落地 | 用户登录后才读写云端工厂和资源 |
| 网格建造 | `src/components/BuildMenu.tsx`、`src/scene/BuildPlacer.tsx` | 已落地 | 分类、旋转、占地、碰撞、ghost 预览；传送带左键直接拖绘并自动补格/转点/回退，建造时右键取消 |
| 建筑选择与变换 | `src/scene/SelectionController.tsx`、`src/game/selection.ts`、`src/store/forgeMind.ts` | 已落地 | 单选后支持 WASD 单格移动、Q/E 左右旋转及 Delete 删除，继续使用边界与碰撞校验；Shift+左键拖动按屏幕框选当前编辑层多个建筑，Delete 单次批量删除并可一次撤销；只读上下文楼层不进入选择集合 |
| 建造视角控制 | `src/scene/FactoryCanvas.tsx` | 已落地 | 右键只沿水平地面平移，不产生垂直位移；非建造状态保留相机平移 |
| 物品详情 | `src/components/ItemDetailWorkspace.tsx`、`ItemPanel.tsx`、`src/data/forgecoreModelCatalog.ts` | 已落地 | 下栏独立页面是物品库唯一维护入口；空白工厂物品为 0，支持专属 ID、业务编码、名称、分类、36 项基础模型、模型参数、颜色、质量、堆叠与说明的新增、修改和删除 |
| 生产路线 | `src/components/ProductionRouteWorkspace.tsx`、`RecipePanel.tsx`、`src/store/forgeMind.ts` | 已落地 | 保留原“配方目录 / 配方详情 / 当前工艺链”三栏总览；右上角新增和详情编辑通过覆盖层完成，不替换原页面。空白工厂配方为 0，可手动新增、修改、删除多输入/多输出路线、数量、时长、启停和稳定 ID；删除或改 ID 时同步清理机器准入与场景绑定 |
| 机械制造 | `src/components/MachineManufacturingWorkspace.tsx`、`src/game/types.ts`、`src/store/forgeMind.ts` | 已落地 | 下栏独立工作区只维护基础加工机器，不包含物品或工艺编辑子页；支持现有模型或用户 GLB、专属 ID、名称、占地、尺寸、吞吐、能耗、蓝色入货口、黄色出货口，并从“生产路线”引用多条准入工艺。路线种类数不得超过端口数，已加入机器自动进入建造面板“基础加工”。只要建造面板展开，继续选择任意场景建筑时设备详情都会切换为 `310×460px` 上限的高层级短窗并在内部滚动；机械制造工作区展开时沿用相同规则，不再被工作区或底部操作栏遮挡 |
| 精密装配约束 | `src/components/InfoPanel.tsx`、`src/game/grid.ts`、`src/game/simulation.ts` | 已落地 | 精密装配不是机械制造目录项，只允许多合一且单输出路线；场景总览可调三边输入与单边输出数量，端口数量受占地边长限制，完成品按出货口轮询均分 |
| 多楼层 | `src/game/floorConfig.ts`、`src/game/floorVisibility.ts`、`src/scene/FactoryCanvas.tsx`、`src/components/FloorSwitcher.tsx` | 已落地 | 动态楼层可手动追加并逐层命名；点击楼层只切换活动层，不改显示开关，活动层以更高优先级直接显示并可编辑。开关只控制其他楼层的只读建筑/物流上下文；场景只复用一块随活动标高移动的 1m 毛玻璃网格，不生成第二套地面。层高统一为 5.25m |
| L2/L3 工业体系 | `src/game/baseA01.ts` | 已落地 | L2 加工/冲压/绕线/配套，L3 装配/质检/包装/成品缓冲 |
| 传送带与物料流 | `src/game/simulation.ts`、`src/scene/ItemLotMesh.tsx`、`src/scene/ConveyorCornerModel.tsx`、`src/scene/ConveyorMotionStripes.tsx`、`src/engine/daiyu/DaiyuConveyorBatch.tsx` | 已落地 | 固定步长、离散槽位和背压；传送带无方向箭头，以每米约三条的低密度浅灰长方形横纹提示方向，仿真暂停时保持当前相位静止、启动后从原相位继续匀速移动；直线、左右 90° 拐角、跨层坡道和存取站内嵌短带使用统一视觉基准，站内带面与地面传送带处于相同世界高度；存取站短带已抵消站体 `1.25×` 视觉缩放，并按站体局部坐标选择前侧唯一接口中线，`0°/90°/180°/270°` 均与接口同侧、同线且只在端面无缝对接。取货模式条纹向外运行，存货入货模式从当前相位反向朝站内运行，暂停时两种方向都冻结；货物跨段保留 ID 并平滑插值呈现。普通传送带末端没有明确下游时保留货物在段末并形成背压，不再静默删除 |
| 工厂新建与存档 | `src/components/FactoryProjectDialog.tsx`、`src/api/factoryProjects.ts`、`src/game/save.ts` | 已落地 | 登录后在账号项目库新建、删除或加载多份后端工厂；新工厂默认 1 层，只有用户手动保存才覆盖正式项目。自动保存只写账号下唯一的自动恢复槽并反复覆盖，不创建正式存档；JSON 仅作为显式导入/导出辅助，不再注入默认流水线。前端将 v1–v5 迁移为 v6，后端运行 JAR 接受 v1–v6，并包含 V8 自动恢复迁移 |
| 跨层倾斜传送带 | `src/game/inclineConveyor.ts`、`src/scene/InclineConveyorMesh.tsx`、`src/game/simulation.ts` | 已落地 | 向上/向下真实跨层运输；采用当前滚筒传送带模型、75% 坡度、5.25m 高差、7m 水平投影和 8.75m 坡长，支持四向旋转、双层占地碰撞、普通传送带端点双向自动吸附、接口标记、运行条纹与背压 |
| 工业设备视觉比例 | `src/scene/industrialVisualScale.ts`、`src/scene/ConveyorCornerModel.tsx`、`src/engine/daiyu/` | 已落地 | AGV/无人机保持 1 倍；其余普通建筑追加至 1.25 倍、生产机器累计 2.5 倍；直行传送带宽高累计 2.5 倍，拐角直接按最终米制复用同一带面高度与宽度，均保持单格长度及仿真拓扑不变 |
| AGV 导航 | `src/game/agvNavigation.ts`、`src/game/simulation.ts`、`src/components/InfoPanel.tsx`、`src/components/AgvNavigationControl.tsx` | 已落地 | AGV 作为独立运输实体运行，没有建筑蓝黄入/出货接口；直接点击车体显示载具状态和旧版式“起点装货 → 物品/每趟件数 → 终点卸货”三节点编程。窄悬浮窗内的供货方式、起点阈值、终点阈值、策略和优先级按独立行纵向排列，控件保持完整宽度。支持一直运输或起点/终点库存阈值触发，以及策略、优先级、八方向寻路、避让与重规划。普通货架可直接作为起终点，不要求货物存取站；货架必须真实拥有完整每趟数量，否则整趟等待且不产生部分或虚拟载荷。新放置或未完成编程的 AGV 空载待命 |
| 无人机跨层运输 | `src/game/dronePathfinding.ts`、`src/game/simulation.ts`、`src/engine/daiyu/DaiyuStaticModelBatch.tsx`、`src/components/InfoPanel.tsx`、`DroneNavigationControl.tsx`、`DroneRouteVisual.tsx` | 已落地 | 无人机同样是没有建筑入/出货接口的独立载具，当前活动层为每架可见无人机提供随运行坐标更新的独立透明命中体，不依赖第三方 GLB 实例网格即可直接点击机体查看状态和三节点任务；上下文层仍只读。支持一直运输或库存阈值触发，可在任意楼层普通货架或边界仓库间直接取放，不依赖货物存取站。确定性 26 邻域三维 A* 同时改变 X/Y/Z，包含设施净空、动态无人机安全包络、重规划和绝对标高路径呈现，不经过固定升降井；若无人机已处于装卸悬停网格，单节点路径直接执行真实到站装卸，不再永久等待规划。新放置或未编程无人机空载待命，装卸只以真实库存和容量为准 |
| 货物仓储与传送物流 | `src/components/WarehouseWorkspace.tsx`、`src/components/InfoPanel.tsx`、`src/game/grid.ts`、`src/game/simulation.ts`、`src/scene/IncomingStationModel.tsx`、`src/scene/RackInventoryLabels.tsx` | 已落地 | 建造分类更名为“货物仓储/传送物流”；货物仓储包含货物存取站、有限容量的普通仓储架、无限供货的入货仓库和不可逆无限容量的出货仓库，成品缓存仓移除。普通货架、入货仓库和出货仓库均可设置实例显示名称，仓储总览及 AGV/无人机的起终点选择优先显示名称；旧档缺名回退设备类型，旧 `name/customName` 可迁入。活动楼层每个普通货架上方持续显示实际物品种类、数量与总容量，选中详情也显示同一运行时库存。货架没有对应物品或数量不足时不能供货；入货仓库匹配供应物品时才是无限来源。全局消耗只在从入货仓库实际取出时登记，产出只在货物送入出货仓库时登记，机器加工、普通货架搬运和存取站搬运不重复计数。货物存取站只负责实际吸附货架与传送带间的搬运；缺少真实货源、缺货或满仓会阻塞并保留来货 |
| 真实端口与吸附 | `src/game/grid.ts`、`src/game/simulation.ts`、`src/scene/BuildPlacer.tsx`、`src/scene/FactoryObjectMesh.tsx` | 已落地 | 蓝色入货与黄色出货标志由对象端口定义生成；可见外置标志所在格就是拖绘吸附、连接状态和仿真收发货共同使用的实际接口，生产模型放大后不会再出现“图标在外、隐藏拓扑仍在模型边缘”的错位。旧存档贴边线路仍作为兼容端口可运行，新建线路只吸附可见标志；货物存取站另有三面完整货架泊位拓扑 |
| 诊断 | `src/game/factoryDiagnostics.ts`、`InspectionPanel.tsx` | 已落地 | 按楼层筛选诊断，展示阻塞、路线、设备和物流问题；页面可滚动 |
| Generative Factory | `src/game/generativeFactory.ts`、`GenerativeFactoryWorkspace.tsx` | 部分落地 | 需求解析、候选布局、校验、副本仿真和方案对比；新生成布局已改用入货仓库/出货仓库作为真实产销边界，不再用无库存来源的存取站伪造来料。当前独立回归仍会在 A-02 多输入装配的 `coil_1 → assembly_1` 端口路由搜索失败，不能声明 3/3 候选通过 |
| 资源包导入 | `src/game/resourcePack.ts`、`ResourceImportDialog.tsx` | 已落地 | JSON/GLB 拖放或选择、字段校验、模型预览和封面生成 |
| 导入资源用户持久化 | `src/api/resources.ts`、`ImportedResourceController.java` | 已落地 | 资源与用户绑定；同一用户再次登录可恢复，其他用户不可见 |
| 模型预览 | `src/components/Model3DViewer.tsx`、`src/scene/ImportedFactoryModel.tsx` | 已落地 | GLB 归一化、底面归零、预览和设备卡片封面 |
| 视觉检测 | `src/demos/InspectionDemo.tsx`、`src/scene/inspectionDetect.ts` | 已落地 | 独立工作台、相机演示、检测结果和隔离路由 |
| 智能管家与语音 | `src/game/assistantProtocol.ts`、`ai-service/` | 规则模式已落地/服务可选 | 浏览器规则降级、工具白名单和二次校验；ASR/TTS/远程模型显式启用，服务不可用时前端不阻塞 |

## 3. 用户导入资源的真实数据流

```text
建造页面
  → ResourceImportDialog 选择/拖入 project.json + GLB
  → resourcePack.ts 校验并生成 previewDataUrl
  → Zustand 注册资源，立即出现在建造目录
  → 登录态下 POST /api/resources
  → imported_resource(owner_user_id, metadata, project_json, model_blob)
  → 下次同一用户登录 GET /api/resources 并按需 GET /model
```

导入设备放入工厂时，`factory_object.resource_id` 会记录资源 ID。Spring Boot 保存工厂前会检查该资源是否属于当前用户，避免用户通过修改存档引用其他用户的 GLB。

### 支持的导入材料

- 资源定义：`.forgemind-project.json` 或兼容 JSON；字段可覆盖设备名称、编码、类别、占地、尺寸、端口、吞吐量、功率、描述和模型引用。
- 三维模型：`.glb`；前端以浏览器内存 Blob URL 使用，后端以 `LONGBLOB` 保存。
- 封面：由模型预览视角生成 PNG data URL，写入前端资源状态；模型缺失或无法预览时使用设备类型占位图。

## 4. 后端 API 事实表

### 认证

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/api/auth/register` | 注册用户 |
| POST | `/api/auth/login` | 登录并返回 bearer token |
| GET | `/api/auth/me` | 查询当前用户 |
| POST | `/api/auth/logout` | 注销当前会话 |

### 工厂与资源

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/factory` | 旧版单工厂兼容读取 |
| PUT | `/api/factory` | 旧版单工厂兼容保存 |
| GET | `/api/factory/health` | 后端健康检查 |
| GET | `/api/factories` | 列出当前账号的全部工厂存档 |
| POST | `/api/factories` | 新建并保存一份完整工厂项目 |
| GET | `/api/factories/{projectId}` | 读取当前账号指定项目的完整载荷 |
| PUT | `/api/factories/{projectId}` | 覆盖保存当前账号指定项目 |
| GET | `/api/resources` | 当前用户自己的导入资源列表 |
| POST | `/api/resources` | multipart 保存 JSON 元数据、项目 JSON 和 GLB |
| GET | `/api/resources/{resourceId}/model` | 当前用户下载自己的 GLB |

所有需要用户数据的接口使用 `Authorization: Bearer <token>`。资源列表、模型下载和工厂存档均在服务端按用户过滤。

## 5. 数据库迁移

Flyway 迁移位于 `backend/src/main/resources/db/migration/`：

| 迁移 | 内容 |
| --- | --- |
| V1 | 用户、会话、工厂、楼层、物品、配方、端口、设备、连接和仿真快照基础表 |
| V2 | 放宽当前 MVP 的楼层外键约束 |
| V3 | 放宽当前 MVP 的配方/物品绑定外键约束 |
| V4 | 放宽配方端口的物品外键约束 |
| V5 | `imported_resource` 用户资源表，保存资源定义和 GLB 二进制 |
| V6 | `factory_object.resource_id` 资源引用和索引 |
| V7 | `factory.save_json` 完整项目载荷，当前支持 v6，账号下多工厂无损存档 |
| V8 | `factory_autosave` 每账号唯一自动恢复槽；定时写入只覆盖该槽，不修改或堆积正式存档 |

运行态的 `ItemLot`、机器进度、传送带槽位、AGV/无人机当前位置仍在前端仿真运行时，不直接逐 tick 写数据库。

## 6. 运行与验证

```powershell
npm.cmd install
npm.cmd run dev
npm.cmd run build
npm.cmd run sim:smoke
npm.cmd run sim:regression
npm.cmd run interaction:regression
npm.cmd run visual-scale:regression
npm.cmd run multifloor-conveyor:regression
npm.cmd run floor-visibility:regression
npm.cmd run drone-navigation:regression
npm.cmd run manufacturing:regression
npm.cmd run storage:regression
npm.cmd run station-rack:browser-audit
npm.cmd run generative:regression
npm.cmd run assistant:protocol
npm.cmd run save:regression
npm.cmd run models:validate

cd backend
mvn test
```

推荐双击入口会同时启动前端、MySQL 8.4 与 Spring Boot 8080，使注册、登录和持久化可用；显式运行无参数 `start-forgemind.bat` 时仍是仅前端模式。规则/远程智能核心可显式启动 8000，视觉、ASR 与本地 TTS 还需安装完整可选依赖。后端离线时，前端仍可预览和仿真，但认证与云端持久化不可用。

2026-08-19 实测：默认启动器在 5177 返回 ForgeMind HTTP 200，停止后端口释放；`-IncludeAI` 在 5178/8000 启动轻量规则服务，健康检查返回 `provider=rule`、`localModelRequired=false`、`voiceEnabled=false`，状态查询与 2 倍速动作均按协议返回，停止后两个端口释放。

同日认证依赖验收：从 3306/5173/8080 全部关闭开始，通过 `启动ForgeMind.cmd` 冷启动，在 15 秒内恢复 MySQL 8.4、Spring Boot 和前端；健康检查、真实注册、真实登录均通过，验收账号随后从数据库清理。Maven 构建与测试目标成功执行，当前后端仓库没有测试源码。

## 7. 仍然属于边界而非承诺

- 当前 Spring Boot 负责结构化存档和资源存储，不是实时仿真服务器。
- 当前 AI 服务通过 HTTP 被前端显式启用；默认规则模式不要求本地大模型，Redis Stream/Kafka 仍是未来异步部署方案。
- 资源包导入已实现“当前用户私有资源”路径，但还没有公共资源市场、跨用户分享和大文件对象存储。
- 资源封面是浏览器预览视角截图，不是服务端离线渲染农场。
- 高频三维对象可见性、标签遮挡和性能预算仍由自研渲染层与场景组件共同负责，不能把所有渲染状态当作数据库事实。
- 当前本地存档 schema 为 v6：在 v5 工厂名称、动态楼层、机械目录、对象端口和存取站程序之上，新增普通货架容量与分物品库存、入货仓库和出货仓库对象；车辆的运输模式与库存阈值为 v6 内可选字段，旧档缺失时迁移为一直运输。生产构建、smoke、10/10 主仿真、背压、交互、比例、跨层传送带、楼层显隐、无人机、机械制造、仓储物流、助手协议和 v1→v6 存档均有独立回归。2026-08-21 在用户当前 Edge 中实测 L2 无人机机体点击后打开 `VEHICLE / 货运无人机` 详情；其原先的单节点路径不再停于“等待运输任务”，而是进入“取货点 · 等待库存”，当前热更新后的起点实际库存为 0，因此没有宣称该现场完成一趟运输。新增确定性场景已验证同格装货扣减、跨层飞行、终点入库和完成趟数。隔离 `selection:browser-audit` 连续两次在既有“三栋建筑框选”步骤超时，本轮未写成通过；`generative:regression` 当前仍有 A-02 多输入装配的 `coil_1 → assembly_1` 端口路由已知失败。
