# 高精度模型导入记录

> 更新时间：2026-08-19。下列是仓库内高精度资产的导入记录；用户上传的 GLB 不加入此清单，也不进入公共 `public/models/industrial/`，而是写入用户私有资源表并按需下载。

本次导入使用 `realvirtual-WEB` 的公开模型库，来源为：

- https://github.com/game4automation/realvirtual-WEB
- https://realvirtual.io/doc/web/viewer/scenes-and-models/

已落地到 `public/models/industrial/`：

| 文件 | 用途 | 公开源文件 |
| --- | --- | --- |
| `realvirtual_roll_conveyor_1m.glb` | 直线传送带的高精度替代模型 | `public/library/PalletHandling/RollConveyor-1m.glb` |
| `realvirtual_turntable.glb` | 传送带转弯处的转台模型 | `public/library/PalletHandling/Turntable.glb` |
| `realvirtual_chain_transfer_left.glb` | 左侧链式转移备用模型 | `public/library/PalletHandling/ChainTransferLeft.glb` |
| `realvirtual_chain_transfer_right.glb` | 右侧链式转移备用模型 | `public/library/PalletHandling/ChainTransferRight.glb` |
| `realvirtual_high_detail.glb` | 42.7MB 的单网格 CAD/PBR 高精度通用工艺设备 | `public/models/library/imports/dc8539c917b79f6c72cef3ca63d3b8f2.glb` |

当前渲染映射已经切换为：

- 普通传送带 → 恢复使用原来的 `roller_conveyor_segment.glb`
- 检测到 90° 转弯的传送带 → 恢复使用原来的程序化 `ConveyorCorner`
- 通用工艺工作站 → `realvirtual_high_detail.glb`

`realvirtual_high_detail.glb` 只有一个匿名根节点，但包含约 30.6 万个顶点和 PBR 纹理，当前作为“通用工艺工作站”实际加载；如果后续确认了更具体的设备语义，可以再把它拆分或重新映射。

这些模型仅用于本项目的学习和本地演示。若后续要公开发布或商用，应重新核对上游仓库与各模型文件的许可，并替换为明确允许再分发的资产。

## 用户导入模型的封面与存储

建造页的资源导入器会在浏览器内加载 GLB，使用稳定预览相机生成封面 data URL，并将模型与资源定义一起提交到 `/api/resources`。封面用于设备目录卡片；真实 GLB 下载由 `/api/resources/{resourceId}/model` 提供，接口按 bearer token 校验资源归属。该流程不改变本目录中内置资产的授权和分发边界。
