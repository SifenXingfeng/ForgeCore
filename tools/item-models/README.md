# ForgeMind / ForgeCore 默认物品模型生成器

本目录保存从 ForgeCore 迁入的原创默认物品模型库确定性生成与验证工具。融合版产品范围、数据关系和路线图以仓库根目录的 `ForgeMind 项目方案.md` 为唯一权威说明；历史来源与迁移状态见 `docs/ForgeCore-融合迁移审计.md`。

## 生成全部默认模型

```powershell
node tools/item-models/build.mjs
```

输出固定写入 `public/models/forgecore/items/`，包括 36 个自包含 GLB、对应 PNG 预览、`catalog.json` 和 `SHA256SUMS`。生成器仅使用 Node.js 标准库，不需要安装 npm 依赖。

## 生成一个参数化变体

```powershell
node tools/item-models/build.mjs --model PART_GEAR --params '{"outerDiameter":0.8,"toothCount":24,"thickness":0.12}' --output .tmp/gear-24t.glb
```

稳定的 `modelId`、默认值、类型、范围、步长、单位、枚举选项和影响域都在 `public/models/forgecore/items/catalog.json` 中。改变标记为 `geometry` 或 `topology` 的参数会重新生成网格；默认 GLB 只代表默认参数形态，不能把非等比缩放当作全部参数化能力。

`activeWhen` 表示条件参数依赖，例如圆柱体只有在 `hollow=true` 时才使用 `wallThickness`，电池只有在 `shape=cylindrical` 时才使用 `diameter`。单模型生成支持 `color`、`metalness`、`roughness`、`opacity` 和 `emission` 的主材质覆盖；`texture` 只是应用层管理的纹理绑定键，离线生成器不会读取网络地址或把外部资源悄悄写入 GLB。

业务层应保存 `baseModelId + parameterOverrides` 并把它分配给 Item。`mass`、`stackSize` 等物品业务属性不属于网格参数，不应写回模型定义。

## 验证

```powershell
node tools/item-models/validate.mjs
```

验证覆盖模型数量与稳定 ID、参数 schema、GLB 2.0 结构、自包含资源、坐标与落地点、法线和索引、三角面/文件体积预算、预览 PNG、目录清单及 SHA-256。生成是确定性的；同一版本、同一参数和同一 Node.js 运行时应得到逐字节一致的输出。

## 运行时约定

- 格式：GLB 2.0，自包含，不引用外部 URI。
- 坐标：右手系、米制、`+Y` 向上、`+Z` 向前。
- 原点：模型底面中心，根节点保持身份变换。
- 用途：几何身份模板，不等同于 Item、SKU、物料或产品身份。
- 性能：普通模型目标 100–800 三角面，复杂模型目标 800–2000，硬上限 3000；场景中优先复用几何并采用实例化渲染。

需求输入文件 `ForgeCore 默认基础 3D 物品模型库设计清单.md` 的 SHA-256 为 `8848a43224a2c4fe8663159a4272694f4353097d76560a7558eceab35ada9b16`。该外部文件仅是导入需求来源，不是后续维护入口。
