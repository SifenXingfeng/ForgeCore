# ForgeMind 视觉检测工作台 — 设计文档

> 目标：双机械臂人机协作质检演示。抓取臂取件 → 摄像头臂（可手柄遥控）检查 → 真视觉检测（OpenCV）→ 规则/可选 AI 解读与语音播报 → 人机分拣。复用既有 Panda 机械臂、手柄控制、语音管线。

> 当前落地：视觉检测工作台以独立 `inspection.html` 运行，并由主工厂中的“**双臂视觉质检单元**”设备详情打开。P1/P2 的虚拟相机、OpenCV 检测接口、结果面板和 P4 的安全隔离路由已完成；结果可通过 `/api/ai/tts` 播报。LLM 对检测结果的自然语言解读和手柄全流程控制仍是后续增强项。

## 0. 现状盘点（已存在，不重造）

| 能力 | 位置 | 说明 |
|---|---|---|
| Panda 7 轴 URDF + **DLS IK** | `src/scene/PandaArmModel.tsx` | `createDlsIk`，末端目标位姿→关节角 |
| 夹爪控制 | `setGripper(robot, open)` | `panda_finger_joint1/2` |
| **手柄 + 键盘控制** | `readInput()` | 遥杆移动末端目标、按钮抓/复位 |
| auto/manual 双模式 | `control.current.mode` | manual=手柄直接控末端；auto=循环动作 |
| 任务类型 | `RobotTask = 'sort'\|'weld'\|'assemble'` | 已有 sort 分拣雏形 |
| 外部指令 | `window` 上 `forgemind:robot-command` CustomEvent | `{mode, task, action:'grip'\|'reset'}` |
| 传送带取料/搬运 | `PandaArmBehavior = 'infeed'` | payload 跟随、夹爪开合、搬运到站 |
| 另一机械臂 | `RobotArmModel.tsx`（IRB2400 GLB） | 仅作展示，监听同一事件 |
| 语音管线 | 可选 ai-service + BT TTS(8001) | 默认规则解读；可选远程 DeepSeek 与 BT-7274 播报 |
| 主布局 | `App.tsx` `.fm-shell/.fm-body/.fm-rail` | 左导航 + 画布区，右面板可加 |

---

## 1. 目标与故事线

**一句话**：两个机械臂，一个夹取一个检查，人用手柄遥控摄像头臂找缺陷，AI 语音判定，人机分拣合格/不合格。

**演示流程**：
1. 抓取臂自动/手动从来料位取件
2. 摄像头臂（自动或手柄遥控）对准工件
3. 触发检测 → 虚拟相机渲染 → OpenCV 真检出缺陷（划痕/毛刺/尺寸）
4. LLM 解读 + BT-7274 语音播报（"检测到表面划痕，判定不合格"）
5. 摄像头臂回原位
6. 用户选**手动**（手柄控抓取臂）或**自动**，把不合格件分拣到废品道、合格件送成品道

---

## 2. 场景布局

```
┌────────────────────────────────────────────────┐
│  topbar（品牌 / 视角切换 / 用户）                │
├──────────┬─────────────────────────────────────┤
│          │  Three.js 画布（俯视工作区）          │
│  fm-rail │  ┌──────────┐   ┌──────────┐        │
│  （左导航）│  │ 抓取臂     │   │ 摄像头臂   │        │
│          │  │(夹爪+payload)│  │(末端挂相机) │        │
│          │  └──────────┘   └──────────┘        │
│          │  来料位  检测位  废品道  成品道        │
├──────────┴─────────────────────────────────────┤
│  右面板：摄像头实时画面 + 检测结果卡片 + 手柄提示   │
└────────────────────────────────────────────────┘
```

- 工作区：网格约 4×3，两臂对称布置，中间是检测位（工件放置台）。
- 右面板新组件：`InspectionPanel`（实时画面 + 结果 + 操作按钮），挂到 `.fm-body` 右侧。

---

## 3. 组件架构（新增/改动文件）

### 新增
| 文件 | 职责 |
|---|---|
| `src/scene/InspectionCameraArm.tsx` | 摄像头机械臂：Panda 模板复用 + 末端挂相机 + 手柄控制 |
| `src/scene/CameraFeedTarget.tsx` | 虚拟相机离屏渲染：`WebGLRenderTarget` 每帧渲染主场景 |
| `src/components/InspectionPanel.tsx` | 右面板：实时画面 + 检测结果 + 按钮 + 手柄提示 |
| `src/game/inspection.ts` | 检测流程状态机 + 调 ai-service `/api/vision/detect` |
| `ai-service/vision.py` | OpenCV 检测逻辑（可独立测） |

### 改动
| 文件 | 改动 |
|---|---|
| `PandaArmModel.tsx` | 加 `variant?: 'gripper'\|'camera'`（camera 时隐藏夹爪，暴露末端世界位姿） |
| `App.tsx` / 布局 CSS | 画布区两臂 + 右面板挂载 |
| `ai-service/main.py` | 加 `POST /api/vision/detect` |
| `src/game/api.ts` | 加 `detectDefects(imageBase64, context)` |

---

## 4. 核心数据流（检测管线）

```
摄像头臂末端相机（3D 相机，跟随臂端）
  → CameraFeedTarget 每帧渲染主场景到 WebGLRenderTarget（实时，右面板显示）
  → 用户按"检测" 或 自动触发：
       gl.readRenderTargetPixels → canvas → PNG base64
  → POST ai-service /api/vision/detect {image, partId}
  → Python OpenCV：
       尺寸测量（轮廓/边界 vs 标称）→ 缺陷检测（划痕/毛刺 blob）→ 判定
  → 返回 {verdict, defects[], dimension, confidence}
  → 前端展示 + 调 LLM(BT人设) 生成一句话 → BT TTS(8001) 播放
  → 进入分拣流程
```

**性能要求**：实时画面 30fps+（离屏渲染分辨率 512×384 足够，右面板小屏显示）；检测截图按需（不逐帧发后端）。

---

## 5. 缺陷生成方案（让 CV "真有东西可查"）

**核心原则：缺陷必须真实渲染进像素，CV 才检得出。** 程序化在工件表面生成：

| 缺陷 | 渲染方式 | CV 检测法 |
|---|---|---|
| 划痕 | 工件贴图上画 1-2 条暗细线（CanvasTexture 程序生成） | 直线检测（HoughLinesP）+ 亮度突变 |
| 毛刺/压痕 | 工件边缘加 2-4 个暗色小凸点 | 斑点检测（SimpleBlobDetector）+ 边缘凸起 |
| 尺寸偏差 | 部分工件几何尺寸偏小 5-8% | 轮廓最小外接矩形 vs 标称 → 公差判定 |

- 每个工件 `partId` 关联一个"缺陷配方"（确定性生成，`seed = hash(partId)`），保证同一工件每次检测结果一致、可复现。
- 检测位背景纯色（深色工作台），工件亮色，方便 CV 分割。
- 离屏渲染分辨率过低会导致小缺陷糊掉——用 512×384 + 相机对焦工件，划痕宽度 ≥2px。

---

## 6. 接口契约

### 6.1 ai-service `POST /api/vision/detect`

```
请求: {
  "image": "<PNG base64>",
  "partId": "part_0007",
  "expected": {"width": 0.6, "height": 0.4}   // 标称尺寸，可选
}
响应: {
  "verdict": "pass" | "fail",
  "defects": [
    {"type": "scratch" | "burr" | "dimension", "x": 120, "y": 80, "size": 14, "severity": 0.7}
  ],
  "dimension": {"width": 0.58, "height": 0.39, "deviationPct": -3.3},
  "confidence": 0.91
}
```

依赖：`opencv-python`（国内镜像有 wheel）。可先用纯 numpy 简单分割做 MVP，再上 OpenCV。

### 6.2 相机臂控制（复用 `forgemind:robot-command`）

新增 `action` 值：
- `action:'inspect'` → 触发一次检测截图
- `action:'autoInspect'` → 自动对位检测（臂按预置检测位序列走）
- 相机臂自身用手柄时：左摇杆=XY 平移末端、右摇杆=Z+姿态、`A/抓取键`=检测、`Back/复位`=回原位

### 6.3 相机臂对外暴露

`InspectionCameraArm` 通过 `forgemind:camera-feed` 事件向外广播当前渲染画面（或通过 ref 由 InspectionPanel 拉取），避免 React 重渲染风暴（帧数据走事件/ref，不 setState 每帧）。

### 6.4 分拣

```
不合格 → 抓取臂（手动或 auto）→ 废品道（标记 red）
合格   → 抓取臂 → 成品道（标记 green）
```
复用 `infeed` 搬运逻辑 + `RobotTask='sort'`。

---

## 7. 手柄映射（沿用 `readInput()` 模式）

| 输入 | 摄像头臂 | 抓取臂（manual） |
|---|---|---|
| 左摇杆 | 末端 X/Y 平移 | 末端 X/Y 平移 |
| 右摇杆 | Z + 末端俯仰/偏航 | Z + 末端俯仰/偏航 |
| A（或 grip 键） | 触发检测 | 夹爪开合 |
| Back（或 reset 键） | 回原位 | 回原位 |
| 右扳机 | 移动加速 | 移动加速 |

死区/阻尼沿用 `DEADZONE=0.16, DAMPING=0.12`。

---

## 8. 实施阶段拆分

| 阶段 | 内容 | 出口标准 |
|---|---|---|
| **P1 相机臂+实时画面** | `InspectionCameraArm` + `CameraFeedTarget` + 右面板实时画面 | 摄像头臂末端画面实时显示在右面板，手柄能转视角 |
| **P2 真视觉检测** | ai-service `/api/vision/detect` + 缺陷生成 + 检测按钮 | 截图→后端→返回 defect/verdict 卡片 |
| **P3 语音播报** | 检测结果→LLM(BT)→TTS | BT 语音报"检测到划痕，不合格" |
| **P4 分拣闭环** | 抓取臂取件 + 手动/自动分拣 | 不合格件进废品道，合格进成品道 |
| **P5 整合+手柄全流程** | 自动检查/手动检查双路径 + 验收 | §9 全过 |

**推荐先做 P1**：虚拟相机实时画面是最大卖点，也是其他一切的地基。

---

## 9. 验收标准

- [ ] 摄像头臂末端画面在右面板 **30fps+** 实时显示，手柄能移动视角
- [ ] 点"检测"→ 画面 → CV 返回缺陷，**缺陷类型/坐标/判定正确**（同一工件重复检测结果一致）
- [ ] BT 语音播报检测结果，中文清晰、风格是 BT
- [ ] 抓取臂能取件（自动或手动），不合格件分到废品道、合格件送成品道
- [ ] 手柄全程可操作（视角、检测、抓取、复位）
- [ ] 整流程跑通：取件→检查→判定→语音→分拣，无卡死无穿模

---

## 10. 风险与取舍

| 风险 | 影响 | 缓解 |
|---|---|---|
| 离屏渲染读像素慢 | 截图卡顿 | 仅按需截图，实时画面只显示纹理不读像素 |
| 小缺陷在低分辨率下检出难 | 误判 | 缺陷最小 2px，检测位固定对焦，MVP 先用确定性模板匹配 |
| IK 抓取穿模 | 穿帮 | 抓取位硬编码精确坐标，检测位用夹具限位 |
| 手柄不可用时演示卡住 | 演示风险 | 键盘全程可替代（现有 `__forgeKeys`），UI 提示按键 |
| 实时画面与主渲染抢帧 | 掉帧 | 离屏分辨率低 + 渲染优先级低，必要时隔帧渲染 |

---

## 11. 关联文档

- 语音模块历史接入：`docs/ForgeMind-语音控制模块-接入文档.md`（当前以 `ai-service/README.md` 的规则/可选远程配置为准）
- 补充设计 §8.1：动作库 + 副本仿真红线
