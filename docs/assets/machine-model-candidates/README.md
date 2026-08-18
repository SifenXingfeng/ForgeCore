# ForgeCore 机器模型候选

本目录保存机器模型选择阶段的统一视角对比图。候选均复用项目内已审计的 Kenney Factory Kit 3.0（CC0）资产。用户已确认采用第五个候选 E 作为通用机器；第六个候选 F 现作为货物仓库外壳，运行时加入三条内部输送、纸箱、两端黑帘和三进三出端口。旧机器与旧货架存档分别迁移到对应外壳。

| 编号 | 候选 | 资产构成 | 说明 |
| --- | --- | --- | --- |
| A | 工业机械臂 A | `robot-arm-a.glb` | 单模型，机械结构与动作语义最明确 |
| B | 工业机械臂 B | `robot-arm-b.glb` | 单模型，轮廓更紧凑 |
| C | 平台机械臂单元 | `machine-bed.glb` + `robot-arm-a.glb` | 未采用的运行时组合候选 |
| D | 紧凑机械臂单元 | `machine-bed.glb` + `robot-arm-b.glb` | 运行时组合方案，占地观感更轻 |
| E | 强化加工设备（已选用） | `machine-fortified.glb` | ForgeCore 正式通用机器视觉底座；内部输送、黑帘、红光、箭头和端口语义仍由运行时组合 |
| F | 可视化加工舱（货物仓库已选用） | `machine-window.glb` | ForgeCore 货物仓库视觉外壳；纸箱、黑帘、内部输送、库存和端口语义由运行时组合 |

对比图：`machine-model-options.jpg`。候选 C、D 是已入库模型的场景组合，不是新的独立网格文件。
