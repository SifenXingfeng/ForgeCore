# ForgeCore → ForgeMind 融合迁移审计

> 基线日期：2026-08-19  
> 目的：保留旧项目制作方法与验证证据，同时准确区分当前实现和历史能力。

## 1. 历史资料归档

| 归档文件 | SHA-256 | 用途 |
| --- | --- | --- |
| `archive/forgecore/ForgeCore 项目方案（历史基线）.md` | `c24a77a9aa6ec31727523dfefc04fc3d5366cf0adacb7367417f14f1663c4fe9` | 原产品范围、架构和功能演进 |
| `archive/forgecore/ASSET_AUDIT（历史基线）.md` | `8c449517c38facaa864d7970ea00491813eb6860c17bc49226fd9f4fc0a53871` | 原模型来源、许可和导入验证 |
| `archive/forgecore/UI美术风格参考与执行规范（历史基线）.md` | `beda6a24bdf7cd4b3b121dfebd7fe6cedc8f3cd4f9eb492b6d6c58c35b273bf9` | UI 视觉提炼、执行边界和 10 图审计 |
| `archive/forgecore/AGENTS与协作审计（历史基线）.md` | `fa49fcf047903cd8751dd483b934d67dd3b920a2b182833590b02576f4724cdc` | 原开发过程和验证记录 |

以上四份文件从旧目录逐字节复制并核对 SHA-256。10 张 UI 参考图位于 `archive/forgecore/assets/ui-style-reference/`，原文件未重编码。

组员融合包原有的 6 个根级物品 `.glb` 实为 Git LFS 指针，不属于 `catalog.json`。本次将指针原文迁入 `archive/forgemind-lfs-pointers/`，保留来源痕迹，同时让现行 36 物品目录继续接受严格 `SHA256SUMS` 和可重现生成校验。

## 2. 能力迁移矩阵

| ForgeCore 能力 | ForgeMind 当前状态 | 审计结论 |
| --- | --- | --- |
| 36 个参数化物品与预览 | `public/models/forgecore/items/` 已使用 | 完整迁入，72/72 个模型/预览哈希一致 |
| 确定性物品模型生成器 | 原融合包缺失，本次迁入 `tools/item-models/` | 已恢复制作方式并适配新输出目录 |
| Cels AGV 模型 | `forgecore_agv.glb` 已使用 | 原件一致，CC BY 4.0 署名保留 |
| Count Infinity 无人机模型 | `forgecore_drone.glb` 已使用 | 原件一致，CC BY 4.0 署名保留 |
| AGV 八方向最短路 | `src/game/agvNavigation.ts` | 已迁入；含斜线、防切角、动态障碍和安全包络 |
| AGV 多车让行/恢复 | `src/game/simulation.ts` | 已迁入当前仿真内核，采用稳定通行权、让行和恢复路径 |
| AGV 可视化任务编辑 | `AgvNavigationControl.tsx` | 已融合为起终点、货物、数量、中间站、策略和优先级编辑 |
| 固定坡度跨层倾斜传送带 | `src/game/inclineConveyor.ts`、`src/scene/InclineConveyorMesh.tsx`、`src/game/simulation.ts` | 已按当前数据模型重写迁入；使用 ForgeMind 现有滚筒传送带模型，支持向上/向下、75% 坡度、双层碰撞、真实坡长运输、背压以及普通传送带端点双向自动吸附 |
| ForgeCore 通用三维无人机 A* | `src/game/dronePathfinding.ts`、`src/game/simulation.ts`、`DroneNavigationControl.tsx` | 已迁入并适配当前运输任务；使用确定性 26 邻域三维 A*，可在任意楼层仓储点之间同时改变 X/Y/Z 飞行，不再经过固定升降井 |
| 多无人机自由三维避障 | `src/game/dronePathfinding.ts`、`src/game/simulation.ts` | 已建立设施净空与动态无人机安全包络、运行时重规划和恢复；当前 A01 默认仅一台无人机，多机物料预约仍列入路线图 |
| 逐层独立显示开关与动态加层 | `src/components/FloorSwitcher.tsx`、`src/game/floorVisibility.ts`、`src/scene/FactoryCanvas.tsx` | 已迁入并融合为“当前编辑层优先 + 每层独立上下文显隐”；点击楼层不改变显示开关，当前层直接显示并成为唯一可编辑层，切走后恢复按原开关状态呈现。只复用一块当前层毛玻璃网格；其他开启层仅显示建筑且不可选择/修改，不显示楼板、地面或网格。工作台可手动向上追加楼层 |
| 楼层自定义命名 | `src/components/FloorSwitcher.tsx`、`src/game/save.ts`、`src/store/forgeMind.ts` | 已按当前状态模型重写；名称即时用于切换器、上下文开关和 v6 存档，不改变活动层优先级 |
| 旧版独立物品与配方编辑 | `ItemDetailWorkspace.tsx`、`ProductionRouteWorkspace.tsx`、`ItemPanel.tsx`、`RecipePanel.tsx`、`forgecoreModelCatalog.ts` | 已按当前 36 模型目录重新实现并拆成下栏“物品详情”和“生产路线”两个独立页面；空白开局均为 0，支持稳定 ID、业务参数、多输入输出和完整 CRUD |
| 旧版机械库与机器工艺准入 | `MachineManufacturingWorkspace.tsx`、`BuildMenu.tsx`、`InfoPanel.tsx` | 已迁入只管理机器的“机械制造”工作区；不再内嵌物品或路线编辑器。基础加工机器支持现有/自有模型、动态端口，并仅能引用“生产路线”已经建立且容量相容的路线 |
| 机器真实出入口与传送带吸附 | `src/game/grid.ts`、`BuildPlacer.tsx`、`FactoryObjectMesh.tsx` | 已按当前网格模型重写；蓝色入货口和黄色出货口逐端口生成，数量直接决定真实吸附单元和仿真拓扑 |
| 精密装配三向取料与轮询出货 | `InfoPanel.tsx`、`src/game/grid.ts`、`src/game/simulation.ts` | 已实现多合一、三边输入/单边输出容量规则和多出货口轮询；机械臂取料动画与工艺周期联动 |
| 货物存取站三侧货架双向搬运 | `WarehouseWorkspace.tsx`、`IncomingStationModel.tsx`、`PandaArmModel.tsx`、`src/game/simulation.ts` | 已按当前仿真内核实现取货/存货模式、可调节拍、物品到货架映射、未映射首件的确定性分配、后续合并库存和三方向机械臂动画 |
| ForgeCore UI 十图规范 | 历史规范和图片已归档 | 已保留制作依据；当前 ForgeMind token/终末地风格仍以现有 CSS 为事实 |
| Kenney/mastjie 完整 vendor 包 | 未进入当前 `public/models/` | 仅保留历史审计，不视为当前发行资产 |

## 3. 新项目新增并保留的能力

ForgeMind 组员版本提供了旧 ForgeCore 没有或实现方式不同的能力：登录演出、A-01/A-02 双场地、宝钗批处理渲染层、黛玉候选生成与经济性评估、Spring Boot/MySQL 用户存档、用户私有 GLB 导入、独立视觉检测工作台、Panda/工业机器人场景和版本化助手工具协议。这些能力继续保留，当前事实以 `ForgeMind-当前实现总览.md` 为准。

## 4. 后续迁移规则

1. 需要恢复旧功能时，先从历史方案和协作审计确认原业务语义，再按当前 `src/game/simulation.ts`、类型和 UI 重写，不能直接整文件覆盖。
2. 旧验证数字只证明旧实现；迁入后必须建立当前项目的独立回归。
3. 旧第三方资产只有在文件、来源、许可和署名全部进入当前审计后才能成为当前资产。
4. 旧 UI 参考只约束视觉语言，不决定当前信息架构和交互。
5. 迁移结果需更新本文件、根项目方案、当前实现总览和 `AGENTS.md` 审计。

## 5. 唯一维护入口确认

从本审计建立起，开发、文档、资产生成和验证均在当前 ForgeMind 项目目录完成。旧 ForgeCore 目录不再被修改；需要的历史内容已经通过归档和迁移工具进入本项目。
