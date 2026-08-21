# ForgeCore 3D 资产清单与审计

## 当前资产包

### ForgeCore Default Item Models v1

| 项目 | 内容 |
| --- | --- |
| 名称 | ForgeCore 首版默认参数化物品模型库 |
| 资产类型 | ForgeCore 原创 first-party/core；非 vendor，亦非 derived |
| 库 ID / 版本 | `FORGECORE_DEFAULT_ITEM_MODELS` / `1.0.0` |
| 生成日期 | 2026-08-13 |
| 项目内权威路径 | `assets/3d/core/items/v1/` |
| 生成器 | `tools/item-models/`，仅使用 Node.js 内置模块，无 npm/第三方运行时依赖 |
| 权威索引 | `catalog.json` |
| 完整性清单 | `SHA256SUMS` |
| 来源需求 | `D:/Downloads/ForgeCore 默认基础 3D 物品模型库设计清单.md`（仅为导入来源） |
| 来源清单 SHA-256 | `8848a43224a2c4fe8663159a4272694f4353097d76560a7558eceab35ada9b16` |
| 运行时契约 | 自包含 GLB 2.0 only；米制、右手系、Y-up、ground-center；禁止外部 URI |
| 内容来源 | ForgeCore 原创程序几何、PBR 材质和离线预览；未使用或派生于第三方网格、纹理或预览图 |
| 许可状态 | 当前 `assets/3d/core/items/v1/` 根目录无独立许可文件；这不等于公共领域或开源授权，对外分发前必须由项目所有者明确许可 |

本库的 36 个 `modelId` 是数据与 Item 引用契约，版本内不得随意改名或复用。模型参数仅描述几何、材质和渲染外观；`Mass` / 质量与 `Stack Size` / 最大堆叠数是 `Item` 层的业务属性，不存在于模型参数 schema 中。

### Kenney Factory Kit 3.0

| 项目 | 内容 |
| --- | --- |
| 名称 | Kenney Factory Kit |
| 版本 | 3.0 |
| 作者 / 分发方 | Kenney（www.kenney.nl） |
| 上游包创建时间 | 2026-05-01 14:45（来自 `License.txt`） |
| 导入日期 | 2026-08-13 |
| 项目内权威路径 | `assets/3d/vendor/kenney-factory-kit-3.0/` |
| 许可证 | Creative Commons Zero（CC0 1.0） |
| 署名要求 | 不强制；可自愿注明 Kenney 或 www.kenney.nl |

项目内保留上游 `License.txt`，它是许可证内容的权威副本。

### mastjie Low Poly Warehouse Kit

| 项目 | 内容 |
| --- | --- |
| 名称 | Low Poly Warehouse Kit（描述性名称；源包未提供正式名称或版本号） |
| 版本 | 未标注 |
| 作者 / 分发方 | mastjie |
| 导入来源 | `D:/Downloads/warehouse/` |
| 导入日期 | 2026-08-13 |
| 项目内权威路径 | `assets/3d/vendor/mastjie-low-poly-warehouse-kit/` |
| 包内货架主资产（当前运行时使用） | `glb/rack.glb` |
| 配套内容 | warehouse、rack、crate、container、barrel，各含 GLB 与 FBX |
| 许可证 | Creative Commons Zero（CC0 1.0 Universal） |
| 署名要求 | 不强制；项目保留作者与许可证原文便于追溯 |

项目内原样保留上游 `license.txt`。该文件包含作者 mastjie、CC0 1.0 声明及作者公开链接，是本资产包许可证内容的权威副本。

### Cels Industrial 3D AGV Trolley

| 项目 | 内容 |
| --- | --- |
| 名称 | Industrial 3D AGV Trolley Free low-poly 3D model |
| 版本 | 未标注；Sketchfab 页面显示发布于 2023-10-25 |
| 作者 / 分发方 | Cels（Sketchfab：`nguyenngockhanh.nnk`） |
| 导入来源 | `D:/Downloads/industrial_3d_agv_trolley_free_low-poly_3d_model.glb` |
| 来源页面 | [Sketchfab 原模型页](https://sketchfab.com/3d-models/industrial-3d-agv-trolley-free-low-poly-3d-model-016a066401a3489dafa98669d3a4b3f1) |
| 导入日期 | 2026-08-13 |
| 项目内权威路径 | `assets/3d/vendor/cels-industrial-agv-trolley/` |
| 原始 GLB | `industrial_3d_agv_trolley_free_low-poly_3d_model.glb` |
| 许可证 | [Creative Commons Attribution 4.0 International（CC BY 4.0）](https://creativecommons.org/licenses/by/4.0/) |
| 署名要求 | 必须注明作品名称、作者 Cels、原模型链接与 CC BY 4.0；派生版本还必须说明修改内容 |

许可证、作者、标题和来源 URL 同时记录在 GLB 的 `asset.extras` 中，并已与 Sketchfab 原模型页交叉核对。项目分发、产品“关于/许可证”页面和任何衍生资产记录都必须保留上述署名信息，不得将该资产误记为 CC0。

### Count Infinity Futuristic Delivery Drone

| 项目 | 内容 |
| --- | --- |
| 名称 | Futuristic Delivery Drone |
| 模型 UID | `48d0997629ee4cc9836775a523651017` |
| 版本 | 上游未标注；`Sketchfab-12.68.0` 是导出器版本，不是模型版本 |
| 作者 / 分发方 | Count Infinity（Sketchfab：`countinfinity`） |
| 首次发布日期 | 2021-01-25 |
| 导入来源 | `D:/Downloads/futuristic_delivery_drone.glb` |
| 来源页面 | [Sketchfab 原模型页](https://sketchfab.com/3d-models/futuristic-delivery-drone-48d0997629ee4cc9836775a523651017) |
| 导入日期 | 2026-08-13 |
| 项目内权威路径 | `assets/3d/vendor/count-infinity-futuristic-delivery-drone/` |
| 原始 GLB | `futuristic_delivery_drone.glb` |
| 署名记录 | `ATTRIBUTION.md` |
| 许可证 | [Creative Commons Attribution 4.0 International（CC BY 4.0）](https://creativecommons.org/licenses/by/4.0/) |
| 署名要求 | 必须保留作品名、作者 Count Infinity 与作者主页、原模型链接和 CC BY 4.0 链接；派生版本必须说明修改内容 |
| 运行时状态 | vendor 可追溯原件；derived 运行时版本尚未制作，不得标记为已完成仿真适配 |

GLB 的 `asset.extras` 内嵌作品名、作者、来源页面与 CC BY 4.0；这些字段已与 Sketchfab 原模型页和公开模型记录交叉核对。项目根许可证不能覆盖或取消该第三方资产的 CC BY 4.0 义务，且不得把它标为 ForgeCore 原创或 CC0。

## Web 初版实际使用状态（更新至 2026-08-17）

编辑场景采用“真实资产优先、业务语义分离”的运行时策略：

| 场景对象 | 实际加载资产 | 初版使用边界 |
| --- | --- | --- |
| 加工工位 | Kenney `machine-fortified.glb`（候选 E，正式通用机器视觉底座）；`machine.glb` 仅保留在 vendor 原包 | 可作为 CC0 视觉资产；ForgeCore 将其适配到 6×6 业务占地并叠加三条内部输送、两端黑帘、红光、方向标识和编号 1–3 的三进三出端口。设备端口占用、产物分流、配方、碰撞与旧存档迁移均来自 ForgeCore 数据，不从第三方网格推断 |
| 输送路径 | Kenney `conveyor-long-stripe-sides.glb` 按裁切后的正交段重复铺设，拐点使用 1m × 1m `conveyor-stripe-corner.glb` | 弯道原件在 ForgeCore 场景坐标中的未旋转有效接口为 -X/+Z；旋转映射为 `-X/+Z=0°`、`+X/+Z=+90°`、`+X/-Z=180°`、`-X/-Z=-90°`。弯道独占拐点格，直线截到接口边缘并保持原件 1m 宽度，相邻弯道间不足以容纳直线模块时直接衔接，禁止直线穿心、反向弯头和极短缩放碎片。速度、容量和在途 Item 仍来自仿真数据 |
| 货物仓库 | Kenney `machine-window.glb`（候选 F）作为 6×6 外壳，仓内复用 `box-small.glb` / `box-wide.glb`，三条通道复用传送带模型 | Kenney 资产均为已入库 CC0 原件；ForgeCore 运行时叠加两端黑帘、编号 1–3 的三进三出端口和库存标签。纸箱只作为货物容器视觉，库存、容量、端口占用、入库/出库和物料守恒均来自业务数据，不从网格推断 |
| 开放式货架 | mastjie `glb/rack.glb`，组合 Kenney `box-small.glb` / `box-wide.glb` | 作为与货物仓库独立的 8×2 单实例视觉设施；运行时显式执行 `Y +90°` 轴向修正，并在世界轴缩放到约 `7.2 × 5.4 × 1.8m`，避免旋转后非等比缩放交换 X/Z 轴；以 40 个箱体形成四层双排满载陈列，箱体底面按层板顶面标高校准。业务占地、碰撞、无限堆叠库存和逐物品无限状态来自 ForgeCore 数据；货架不设输送端口，陈列箱数不代表 Inventory 数量。规模化实例、物理碰撞或 RackSlot 寻址仍需 derived 适配 |
| AGV | Cels vendor GLB 的 `GeoContainer_572__16_36` 主体子树 | 运行时排除约 41×41 的展示地板，并把编辑器既有目标尺寸从约 `1.75×1.05×1.45m` 整体放大为 `3.5×2.1×2.9m`；4×4 业务占地、2m 导航半安全包络、3.8m 多车间距、A*、库存预约、载荷和调度均来自 ForgeCore 独立数据。业务运输已可运行，但该高面数 vendor 视觉仍为 `derived pending`，不得标记为 derived-ready |
| 货运无人机 | Count Infinity vendor GLB | 单实例、显式目标尺寸的视觉层；绝对高度、真实 Item 载货、26 邻域三维 A*、1.4m 建筑净空、3m 多机中心距、库存预约和调度来自 ForgeCore 独立数据。业务运输已可运行，但 vendor 视觉仍为 `derived pending`，不得虚构旋翼动画或标记为 derived-ready |
| 在途物品 | `assets/3d/core/items/v1/` 中 Item 对应 GLB | 按稳定 `itemModelId` 加载；本次示范链浏览器验收已实际请求 `material/ingot.glb` |
| 缓冲区与辅助语义 | ForgeCore 最小程序化几何 | 只用于确无第三方对应资产的业务区域、选择轮廓、碰撞代理、路径标记、安全包络和加载失败回退 |

浏览器页面资产观测确认上述 vendor GLB 与运行中的核心 Item GLB 均由实际页面请求，而非仅登记文件路径；新增建造验收还确认 `robot-arm-a.glb` 与 `conveyor-stripe-corner.glb` 在对应交互后按需加载。AGV 与无人机的可视化任务、库存触发、固定步长运输、A* 与基础多载具协调均由独立业务层实现，这不改变 vendor/derived 门禁：高密度车群/机群的正式视觉性能、LOD、简化碰撞体、挂点和语义节点仍须在 `assets/3d/derived/` 完成并保留各自 CC BY 4.0 署名与修改声明。

## 文件清单

### ForgeCore Default Item Models v1

目录结构：

```text
assets/3d/core/items/v1/
├ catalog.json
├ SHA256SUMS
├ basic/          # 6 个 GLB
├ material/       # 10 个 GLB
├ mechanical/     # 8 个 GLB
├ electronic/     # 5 个 GLB
├ package/        # 7 个 GLB
└ previews/       # 按五类同构管理的 36 张 PNG
```

`catalog.json` 记录全部定义、默认参数、材质模板、包围盒、几何指标、GLB/PNG 路径与逐文件哈希。`SHA256SUMS` 包含除自身外的每个生成资产，用于检测缺失、额外文件或内容漂移。

当前生成树共 74 个文件、1,913,125 字节：36 个 GLB 合计 1,489,760 字节，36 张 PNG 预览合计 194,097 字节，另含 `catalog.json` 与 `SHA256SUMS`。36 个默认模型合计 36,912 个顶点、12,304 个三角形和 56 个图元；最大单件为 `MATERIAL_WIRE_COIL`，1,536 三角形、162,756 字节，未超过设定预算。

| `modelId` | 相对路径 | 三角形 | 字节 | GLB SHA-256 |
| --- | --- | ---: | ---: | --- |
| `BASIC_BOX` | `basic/box.glb` | 28 | 8,800 | `11a8508f7b5d844dfca2d519f4e60b5fc94e1e730a3384f02f077563674af2bd` |
| `BASIC_CONE` | `basic/cone.glb` | 36 | 9,688 | `a1109027b59dc6f3fa5ad7de7356d726440c0755efd5670b629cc554c8b8fdbb` |
| `BASIC_CYLINDER` | `basic/cylinder.glb` | 64 | 12,544 | `d233a1fb5cf0939a6ab4a74f67ec917351c7a61985febe37b71895455c14fae1` |
| `BASIC_DISC` | `basic/disc.glb` | 80 | 14,164 | `b7a50d4dff7d7e618a8e3df60a65d7041ce2ddb0e7be3df24156602b040e033f` |
| `BASIC_RING` | `basic/ring.glb` | 192 | 25,596 | `90617c37acba6926eeb43a45ec73c7c646ed360e973ff2ff4c0b0a97151bd809` |
| `BASIC_SPHERE` | `basic/sphere.glb` | 224 | 28,856 | `f8141e18b043a4ed1ec5067959ff5e920b8fd1f5eab7301018693a7732154d6f` |
| `CONTAINER_BOTTLE` | `package/bottle.glb` | 288 | 36,300 | `9915f34d5789c6e5186105f76ee90b8af92c1f0bc922c18a2f088576af620443` |
| `CONTAINER_DRUM` | `package/drum.glb` | 912 | 100,792 | `012250a6b6fa669376496c415bf5317503b873d938d04feb2ec308d5d9874bbb` |
| `ELEC_BATTERY` | `electronic/battery.glb` | 52 | 12,972 | `5f16a8f9aaef3b327bbca1a0f4c2a9ce63bda38fa8857a79c6014b4c793bfffa` |
| `ELEC_CHIP` | `electronic/chip.glb` | 252 | 33,436 | `6ee3330dca5b409f5070c3dec1e33f3989e999e699d490a4dec33569acfffaef` |
| `ELEC_MODULE` | `electronic/module.glb` | 220 | 30,972 | `ad8fa7d71f719f64b4cc2afe434b8a65479975aff3e8c140c7be05cafcfc5779` |
| `ELEC_MOTOR` | `electronic/motor.glb` | 1,192 | 129,372 | `76941142f5ba4a7bcb28c0f8caced745b857dcefd65f7d439f73eef9d97c2563` |
| `ELEC_PCB` | `electronic/pcb.glb` | 176 | 25,700 | `69aefbdf12783bc1de7d6d5c4948a70a01b37733c192fdc079cd079ed22e5d58` |
| `MATERIAL_BEAM` | `material/beam.glb` | 36 | 9,676 | `a89bddf64a1c74e9023cc94bb6f59c7ecb3bff287f4f6693af0d30f624e1a226` |
| `MATERIAL_COIL` | `material/coil.glb` | 224 | 28,864 | `e609640f36281448f453b5eaf9c8edb3909de93f8492ddaaa037f31c83236dea` |
| `MATERIAL_PIPE` | `material/pipe.glb` | 160 | 22,360 | `f7643b1b94f31e5cdc9754f1409ea86029d787023f25257e48528136f9332b8e` |
| `MATERIAL_PLATE` | `material/plate.glb` | 28 | 8,856 | `7eb44928ff8a11b083129c83134a87fd7bfa2ecdf957d292e2b9b1247aabfdf4` |
| `MATERIAL_ROD` | `material/rod.glb` | 72 | 13,360 | `4f47ecadefdefa3c9c59165472f36d64b5d83178eac7bbd099e9487c3cac3ff5` |
| `MATERIAL_WIRE_COIL` | `material/wire-coil.glb` | 1,536 | 162,756 | `effb68211427228c4d8f4abf58c0c8e4347b78909b4aa24a3ea2114d19d1e7d1` |
| `PACK_BIN` | `package/bin.glb` | 108 | 17,068 | `26bedea245968b8d9d7d593d2c0fb0862ddef1d3cf30536a4e5647afd22b822f` |
| `PACK_BOX` | `package/box.glb` | 24 | 9,268 | `8ef6b2a86d8c23b77eb6048569b72fcd449827ba98caea4f0444bb4397e344d9` |
| `PACK_CRATE` | `package/crate.glb` | 252 | 31,692 | `9b217d043ab50ed7e2bbeb269a414ec01e63359a5fcc00ed2a6eb3f890f9e527` |
| `PACK_PALLET` | `package/pallet.glb` | 228 | 29,344 | `494407dbad7667d83229d3d1791f540c8ea5b28641c50a6a0cb1abb66cb7bd59` |
| `PACK_SACK` | `package/sack.glb` | 336 | 41,204 | `341ae682b5e35da038fcf69f43b6c1dd87fdaf575ed33ee2eee43cc46d7cee2a` |
| `PART_BEARING` | `mechanical/bearing.glb` | 896 | 98,272 | `5e6f588a951b5574bbddf750813d4527624c269fff9038adecf42084cf765cc9` |
| `PART_BOLT` | `mechanical/bolt.glb` | 560 | 63,248 | `dc2e907019dd42e13c73ff25f3272763ec7d1dca380290bd5ad67a3021e29184` |
| `PART_FLANGE` | `mechanical/flange.glb` | 464 | 54,236 | `60e3b1274d4ee0e01c443d945a516c42e112a244d33781535d0365caa3f2a03f` |
| `PART_GEAR` | `mechanical/gear.glb` | 504 | 57,544 | `5b287cd2dadca1dff8277ea37a289c9ab274da8935af31487dcb6f5bf11a9c67` |
| `PART_NUT` | `mechanical/nut.glb` | 48 | 10,956 | `cdced252ba339b82d82e2306316b208a5569b56381593429d61355b2cf28b685` |
| `PART_SHAFT` | `mechanical/shaft.glb` | 216 | 28,196 | `ad2b7ed1467ba42fab3902264c57ebc6483eed21b8aaecba2a421d53d8e1ca0f` |
| `PART_SPRING` | `mechanical/spring.glb` | 852 | 93,084 | `e2f2fa15b711abf067ba7ad1aea12f781e922834be71982cc17194d09e2bfac9` |
| `PART_WHEEL` | `mechanical/wheel.glb` | 528 | 60,720 | `97a306546d93b8a0e802790fba548aad4cc413410bc5919d2a98075a40e07438` |
| `RAW_CHUNK` | `material/chunk.glb` | 100 | 16,344 | `115716458f519ae4ae88ba84942c65813db5d8e086f5e9e632cb4e3526a0e872` |
| `RAW_GRANULE` | `material/granule.glb` | 324 | 39,224 | `ed0aca6c3779da43c2d6c810fce1a5123dfbadf26c98c13c0877cf88fb57556a` |
| `RAW_INGOT` | `material/ingot.glb` | 28 | 8,836 | `7bd5385f8ec424bb805d1c40554300d672f5a55fdcad0c7a931077e1cca2f193` |
| `RAW_LOG` | `material/log.glb` | 1,064 | 115,460 | `73251f189e95fb09f55efdea03d075b77fbe847713fcf2c2dce5723f55b89abf` |

### Kenney Factory Kit 3.0

| 类型 | 数量 | 用途 |
| --- | ---: | --- |
| GLB | 143 | ForgeCore Web 3D 运行时首选格式 |
| FBX | 143 | DCC / 游戏引擎交换格式 |
| OBJ | 143 | 通用几何交换格式 |
| MTL | 143 | OBJ 材质定义 |
| PNG | 150 | 模型预览、套件预览和颜色贴图 |
| HTML | 1 | 上游模型总览 |
| TXT | 1 | 上游许可证 |
| URL | 3 | 上游文档与网站快捷方式 |
| **合计** | **727** | **12,180,437 字节（约 11.62 MiB）** |

三种模型格式各有 143 个同名模型，模型集合一一对应。GLB 文件位于：

`assets/3d/vendor/kenney-factory-kit-3.0/Models/GLB format/`

### mastjie Low Poly Warehouse Kit

| 类型 | 数量 | 字节数 | 用途 |
| --- | ---: | ---: | --- |
| GLB | 5 | 255,800 | ForgeCore Web 3D 运行时首选格式 |
| FBX | 5 | 146,348 | DCC / 游戏引擎交换与兼容性备份 |
| TXT | 1 | 458 | 上游许可证与作者信息 |
| **合计** | **11** | **402,606** | 原包逐文件保留 |

逐文件审计：

| 相对路径 | 字节数 | SHA-256 |
| --- | ---: | --- |
| `fbx/barrel.fbx` | 19,852 | `99e809164636d1f158338924c529a4634c74dd639e07c6926e020413315f40eb` |
| `fbx/container.fbx` | 20,748 | `7f56ffa95816b2864cbbfe7d3ae5acd3f7e5ff27a3045affaca7a4bf23ad14ea` |
| `fbx/crate.fbx` | 18,028 | `faa007b51d78b261fe4b6a0302820a3ae83befdd44e4686811e8f4bcd510b4d6` |
| `fbx/rack.fbx` | 20,508 | `58cfd5dc2532f23f07aa0927ab5d6aa5e8e920d2335e95b98eb8e1f67f36ac97` |
| `fbx/warehouse.fbx` | 67,212 | `7296ede352b827ad18571d52f292a7933e98527a813a0b2dbe6f4d2445737d7b` |
| `glb/barrel.glb` | 20,872 | `f407958b8bbeae32993ff30625574ee5e9dd84ed774da56e03be48a9391342bf` |
| `glb/container.glb` | 23,584 | `04a827c65e24b2bbc30e5ce3b878d516e711013d080c0f204f4f15eab9b9bfc9` |
| `glb/crate.glb` | 13,620 | `3a082965c6a79222260f0a755d8e6c0299408d9005603b9ef58f2600cc2a5b5b` |
| `glb/rack.glb` | 22,588 | `8d9bdc5752d93058d687c70135ac369bfa509b7cc710b324a7200f586aa0d4e4` |
| `glb/warehouse.glb` | 175,136 | `ac1ea1d16027bbb5c0c965d5c01f37b0278236bc652e786338909eccdf3eab06` |
| `license.txt` | 458 | `5df5f54bfd2bb1bbee50048a1168f17b5f5289e1bad2a8c20d4f54e58a908004` |

### Cels Industrial 3D AGV Trolley

| 相对路径 | 字节数 | SHA-256 |
| --- | ---: | --- |
| `industrial_3d_agv_trolley_free_low-poly_3d_model.glb` | 3,239,608 | `3e4e26a90d89ee0449d654f99a40129aeb35924037ba5acc0f4ebd1b40c636c4` |

### Count Infinity Futuristic Delivery Drone

| 相对路径 | 字节数 | SHA-256 |
| --- | ---: | --- |
| `ATTRIBUTION.md` | 1,090 | `616aaba581bfefef8289b07e0ed2cc410abd60f975842194967649dce1d4c20a` |
| `futuristic_delivery_drone.glb` | 6,386,908 | `41baaee6c1b2a067c9c68e5cc5d5dea81d191e3844044cea48bfbc62c01f1004` |

## 导入完整性验证

### ForgeCore Default Item Models v1

本库不是外部原包导入，而是可确定性重生成的 first-party/core 资产。生成与验证命令均为零第三方包依赖：

```powershell
node tools/item-models/build.mjs
node tools/item-models/validate.mjs
```

`validate.mjs` 已覆盖以下门禁：

- `MODEL_DEFINITIONS`、`catalog.json` 均为 36 项，`modelId` 唯一且与分类相对路径一致
- 参数 schema 的类型、默认值、上下限、可选值、`affects` 和 `activeWhen` 条件依赖声明有效
- 每个默认模型都能重建有限非空几何，不超过 3,000 三角形硬上限、4 个图元/材质槽上限及相应目标预算
- 所有包围盒均为 X/Z 居中、`minY = 0` 的 ground-center 轴点
- 每个 GLB 均为有效 glTF 2.0，只有一个默认场景、身份变换根节点和网格，内嵌 `modelId`、米制元数据和二进制数据，不含外部 URI、图片、纹理、动画、蒙皮、相机或任何 glTF 扩展
- POSITION、NORMAL、UV 与索引可完整回读，数值有限，法线归一，索引不越界，Accessor 包围盒与实际顶点一致
- 每个 GLB 均不超过 256 KiB，每张预览均为有效 PNG，GLB/PNG 哈希均与 catalog 一致
- `SHA256SUMS` 覆盖除自身以外的所有文件，无缺失、无额外路径、无哈希差异

另已直接审查 `catalog.json` 与模型定义的参数键，确认不包含 `Mass`、`Stack Size`、`mass` 或 `stackSize`等 Item 业务属性。

加强参数及可重现性验证结果：共审查 436 个参数 schema，其中 184 个几何相关参数逐项生成变体，**184/184 均改变几何指纹**；所有变体均通过有限坐标、索引边界、包围盒一致与 ground-center 检查。两次独立临时目录全库生成均得到 74 个文件、1,913,125 字节，逐字节一致；生成树 SHA-256 为 `20aa8c29252b6d1f31ade4bde2aa9a27bcea6e258f69caa43df6d07eca061d6d`。

完整 36 项的 `modelId`、运行时相对路径、三角形数、字节数和 GLB SHA-256 见本文件“ForgeCore Default Item Models v1”逐文件表，数据由当前 `catalog.json` 转录。

### Kenney Factory Kit 3.0

导入时执行了以下检查：

- 源目录与项目目录均为 727 个文件
- 相对路径无缺失、无额外文件
- 所有文件逐项进行 SHA-256 对比，差异为 0
- 143 个 GLB 文件均通过 `glTF` 文件头检查
- GLB、FBX、OBJ 三种格式的模型基础名差异为 0
- 未发现空文件

### mastjie Low Poly Warehouse Kit

- 源目录与项目目录均为 11 个文件、402,606 字节
- 相对目录、文件名和文件数量完全一致，没有覆盖或改名
- 11 个文件逐项进行 SHA-256 对比，差异为 0
- 5 个 GLB 均为 glTF 2.0，容器声明长度与实际文件长度一致
- 5 个 GLB 均没有外部 URI、贴图、动画、蒙皮、相机或扩展依赖，可作为自包含 Web 资产加载
- 5 个 FBX 均通过 `Kaydara FBX Binary` 文件头检查，作为交换格式保留
- `rack.glb` 离线解析结果：1 个场景、1 个节点、1 个网格、1 个三角形图元、605 个顶点、344 个三角面、1 个不透明双面材质
- `rack.glb` 包围盒约为 `4.9777 × 9.5955 × 19.9950`（X × Y × Z，模型单位），底部最小 Y 约为 `0.0008`，原点位置适合后续落地校准
- 离线外观检查确认其为灰色低多边形四层长跨货架，几何结构完整，未发现明显缺面或错位
- 当前原包未提供 LOD、碰撞体、货位语义节点或 ForgeCore 网格尺度声明；这些属于项目适配工作，不应直接修改 vendor 原包

### Cels Industrial 3D AGV Trolley

- 源文件与项目副本均为 1 个文件、3,239,608 字节，SHA-256 完全一致
- GLB 为有效 glTF 2.0，容器声明长度与实际长度一致，包含 JSON 与内嵌二进制两个标准块
- 作者、作品名、CC BY 4.0 和 Sketchfab 原模型 URL 均存在于 `asset.extras`，并与原模型页一致
- 模型为自包含 GLB：无外部 URI、贴图、动画、蒙皮、相机或扩展依赖
- 全场景包含 1 个场景、68 个节点、31 个网格/图元、72,645 个 POSITION 顶点记录、73,645 个三角面和 23 个不透明双面材质
- 原文件包含约 `41.3024 × 0.9781 × 40.5943` 的完整展示场景包围盒，其中大部分范围来自单独的展示地板
- AGV 主体子树 `GeoContainer_572__16_36` 约为 `1.0560 × 0.8884 × 0.8108`（X × Y × Z，模型单位），包含 18 个网格与约 70,187 个三角面
- 除 AGV 主体外，场景还包含两层输送机构和 8 个纸箱；这些对象采用独立节点，可在派生处理中按产品需要保留或移除
- 离线外观检查确认其为带围栏、双层辊道/载台、车轮和警示细节的工业 AGV 小车，主体结构完整
- 模型虽然名称含“low-poly”，但约 7.36 万三角面且以材质拆分为主，不应直接作为大规模 AGV 实例的最终运行时资产
- 原始场景未提供 LOD、简化碰撞体、轮组/转向/载台动画、导航锚点或 ForgeCore AGV 语义节点，并且模型整体未居中；必须通过 derived 派生流程适配
- 2026-08-17 的 Web 运行层只提取主体子树，并按明确目标尺寸 `3.5 × 2.1 × 2.9m` 展示；没有修改、覆盖或重新导出 vendor GLB。业务层另设 4×4 网格占地、2m 保守导航半安全包络与 3.8m 多车间距，均为产品参数而非模型审计所得物理尺寸
- 同次运行层已接入同层仓库/货架任务编程、库存阈值触发、起终点预约、A* 最短路、动态车辆占用、稳定 ID 通行权和让行点协调；这些结论只表示 ForgeCore 业务仿真可用，不表示 Cels 网格已完成 LOD、动画、碰撞体或 derived 语义适配

### Count Infinity Futuristic Delivery Drone

- 来源文件与项目内 vendor GLB 均为 6,386,908 字节，SHA-256 均为 `41baaee6c1b2a067c9c68e5cc5d5dea81d191e3844044cea48bfbc62c01f1004`，确认是逐字节未修改副本
- GLB 为有效 glTF 2.0，容器声明长度与实际长度一致；JSON/BIN 块边界、4-byte 对齐、bufferView 范围、Accessor 数值与索引范围均通过离线结构检查
- `asset.extras` 的作品名、作者 Count Infinity、CC BY 4.0 与 Sketchfab 原模型 URL 已和上游发布页交叉核对；同目录 `ATTRIBUTION.md` 固化署名、来源、哈希与“未修改”声明
- 文件包含 1 个场景、5 个节点、3 个网格/图元和 3 个材质；材质分组为 `Cargo`、`Drone`、`Flaps`
- 全模型包含 12,066 个 POSITION 顶点记录、37,308 个索引和 12,436 个三角形；其中 Cargo 2,180、Drone 9,776、Flaps 480 个三角形
- POSITION、NORMAL、TANGENT 与 UV 均完整，数值有限；法线/切线单位长度、UV 位于 0–1，未发现退化三角形或索引越界
- 3 个材质均为不透明双面 PBR；10 张 1024×1024 PNG 和 10 个纹理全部嵌入 GLB，无外部 URI。图片二进制约占文件 88.5%，未压缩时可能占约 40 MiB GPU RGBA 内存，不适合未经优化的大规模机群
- 无动画、蒙皮、相机、morph target、Draco、Meshopt、KTX2 或其他 glTF 扩展；原件没有可独立驱动的旋翼、襟翼或装卸节点
- 根节点只含绕 X 轴 -90° 旋转，使场景成为 Y-up；应用节点变换后的总包围盒约为 `33.318 × 58.059 × 52.500` 原始单位，原点位于机体附近而非地面
- 文件未声明单位和前向轴；直接把原始单位当米会产生约 33×58×52 米的模型，因此必须在 derived 阶段验证真实尺度，不能把 `0.01` 等推测比例写成既定事实
- 未发现展示地板、背景或相机；下方大型 `Cargo` 几何属于明确的货舱/货物材质组，不应误删为展示底座
- 离线单视角外观检查确认其为深蓝灰/黑色未来飞行器，带封闭圆形推进舱、翼面、橙色细节及大型橙褐色下挂货舱；整模完整入镜，未发现明显缺面、错位、异常穿插或裁切。无传统外露桨叶，圆形部件的推进器/传感器语义与动画轴心仍须在 derived 阶段确认
- 2026-08-17 的 Web 运行层把 Count Infinity vendor 原件作为单实例视觉主体按显式目标尺寸加载，没有修改、覆盖或重新导出源 GLB；绝对飞行高度、30kg 默认载荷、1.4m 建筑净空、3m 多机中心距、库存预约与装卸、26 邻域三维 A*、净空列下降和稳定 ID 通行权均由 ForgeCore 独立业务层提供，不代表 vendor 网格已经完成尺度、碰撞、LOD、动画或 derived 语义适配
- 2026-08-18 根据场景可见机头校正 Web 视觉朝向：运行时对完整 vendor 视觉主体额外施加 `Y +180°` 固有旋转，建造预览与运行实体共用 `COUNT_INFINITY_DRONE_INTRINSIC_ROTATION_Y`。该适配没有修改、覆盖或重新导出 vendor GLB，也不改变 ForgeCore 的业务航向、三维路径、碰撞体或导航安全包络；正式 derived 版本仍须独立确认并固化 +Z 前向
- 当前验证为项目离线结构审计，未运行独立 Khronos glTF Validator；vendor 原件虽可技术加载，但未通过 ForgeCore 运行时尺度、轴点、碰撞、LOD 和语义门禁

## 使用与维护约定

- `assets/3d/core/items/v1/` 是 ForgeCore first-party/core 资产根，不得将第三方原件放入此处，也不得将它记为 vendor 或 derived。
- 运行时仅加载 `catalog.json` 登记的自包含 GLB；PNG 只作为模型选择器预览，不是模型贴图依赖。
- `catalog.json`、`SHA256SUMS`、GLB 和 PNG 都是生成物，不手工编辑；任何几何、参数 schema、材质或预览变更都通过 `node tools/item-models/build.mjs` 重生成，再运行 `node tools/item-models/validate.mjs`。
- 保持稳定 `modelId` 与五类路径契约。删除、改名或语义变更必须升级模型库版本，为已有 Item 提供迁移映射，并重新登记哈希。
- `Mass` 和 `Stack Size` 仅存于 Item 业务数据；不得为它们增加模型参数，也不得用它们改变网格或材质。
- v1 当前不包含第三方网格或纹理，且资产根尚无独立许可文件。未由项目所有者设定和记录许可前，不得将该库对外标注为 CC0、CC BY 或任何其他开放许可。
- 运行时优先加载 GLB，避免在 Web 客户端直接解析 FBX 或 OBJ。
- 首版可运行货物仓库使用 Kenney `machine-window.glb`、`box-small.glb`、`box-wide.glb` 与传送带模型的运行时组合；这些原件仍保留在 vendor 目录，不生成或覆盖第三方网格。
- mastjie 套件中的 `glb/rack.glb` 已作为独立开放式货架的单实例视觉主体；`warehouse.glb`、`crate.glb`、`container.glb` 与 `barrel.glb` 继续作为未启用的可选仓储资源。mastjie 货架不替代使用 Kenney 候选 F 的货物仓库。
- `vendor` 目录用于保存可追溯的上游原包，不在其中直接制作项目定制版本。
- 派生、压缩、合批、碰撞体或材质调整后的模型统一放到 `assets/3d/derived/`。
- mastjie 货架当前只以显式尺度/轴向适配的 vendor 单实例视觉接入编辑器，业务占地、碰撞和库存语义均不从网格推断；该设施明确没有输送端口。进入规模化实例、正式物理碰撞、导航或货位/格口寻址前，必须在 `assets/3d/derived/` 中固化尺度和朝向，完成材质风格统一、LOD、简化碰撞体与语义挂点配置，并记录其与 `glb/rack.glb` 的来源关系。
- Cels AGV 的 vendor 文件只作为可追溯原件。正式运行时版本必须在 `assets/3d/derived/` 中剥离展示地板、重新居中与定轴、确认米制尺度、减少材质与三角面、生成 LOD 和简化碰撞体，并补充车体、轮组、载台、导航锚点等语义层；派生记录必须注明修改内容。
- 使用或分发 Cels AGV 及其派生版本时，必须保留作品名、作者 Cels、Sketchfab 原模型链接、CC BY 4.0 链接和修改声明。
- Count Infinity 无人机的 vendor GLB 只作为可追溯原件，不覆盖、不改名、不直接标记为正式运行时资产。derived 版本必须记录源相对路径和源 SHA-256，确认米制、Y-up、+Z 前向与飞行枢轴，压缩/降采样贴图，生成 LOD、简化碰撞体与独立导航安全包络，并登记 `bodyRoot`、`navigationOrigin`、`cargoMount` 及经验证存在的可动节点。
- 无人机的渲染网格、物理碰撞体与飞行规划安全包络必须分离；`pickup`、`dropoff`、`landing`、`approach` 属于设施端锚点，不得全部固化到无人机模型。原件没有动画，derived 必须把动画来源登记为 existing clip、程序驱动或 unavailable，不得虚构。
- 使用或分发 Futuristic Delivery Drone 及其派生版本时，必须保留作品名、作者 Count Infinity 与作者主页、Sketchfab 原模型链接、CC BY 4.0 链接和修改声明；不得将其描述为 ForgeCore 原创或 CC0。
- 若升级套件版本，使用新的版本化目录并重新执行文件数量、格式对应、GLB 文件头和 SHA-256 验证；确认迁移完成前保留旧版本。
- 新增资产包或版本变更时，同步更新本文件、根目录 `AGENTS.md` 及 `ForgeCore 项目方案.md`。
