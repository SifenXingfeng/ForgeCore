import * as THREE from 'three'

/**
 * 质检摄像头共享注册表。
 *
 * 摄像头臂每帧更新 `camera`；CameraFeedTarget 读它渲染离屏图；
 * InspectionPanel 用 rAF 轮询 `frame` 画到右面板。
 * 悬空检测流程：夹取爪举货悬空 → 摄像头环绕 → 检测 → 按 verdict 分放。
 */

export interface InspectionFrame {
  pixels: Uint8Array
  width: number
  height: number
  version: number
}

export type GripperPhase = 'idle' | 'picking' | 'inspecting' | 'placing'
export type Verdict = 'pass' | 'fail' | 'error'
export type ManualArm = 'gripper' | 'camera'

/** 质检工作站（无桌子）：夹取爪举货悬空，摄像头臂环绕检测，按结果分放。 */
export const INSPECTION_STATION = {
  /** 站点网格位置（世界坐标，y=0） */
  pos: { x: 9, z: -7 } as { x: number; z: number },
  /** 摄像头臂放在检测位近侧右方，末端可以在货物外圈完整转动 */
  /** 小型摄像头臂靠近检测中心，工作高度高于夹取臂末端。 */
  armLocal: new THREE.Vector3(0.36, 0, -0.22),
  /** 夹取臂放在前左侧，负责取料、转运和分拣 */
  gripperArmLocal: new THREE.Vector3(-0.92, 0, 0.5),
  /** 地面取货点（左前侧产线落料位，无桌子） */
  sourceLocal: new THREE.Vector3(-1.05, 0.1, 0.62),
  /** 从取料区抬高后的安全转运点，先越过两臂之间的低位区域 */
  transferApproachLocal: new THREE.Vector3(-0.72, 1.08, 0.58),
  /** 悬空检测位：夹取爪把货物举到这里让摄像头环绕检查 */
  inspectPoseLocal: new THREE.Vector3(-0.02, 0.82, 0.18),
  /** 分拣前的高位通道，避免放置时横穿摄像头底座 */
  sortApproachLocal: new THREE.Vector3(-0.9, 1.02, 0.9),
  /** 合格品放置区（前侧地面） */
  acceptLocal: new THREE.Vector3(-0.52, 0.1, 1.2),
  /** 不合格品放置区（更靠左的隔离区） */
  rejectLocal: new THREE.Vector3(-1.28, 0.1, 1.2),
}

export const inspectionRegistry: {
  camera: THREE.PerspectiveCamera | null
  /** 视觉取景时临时隐藏的摄像头臂模型，避免拍到自身连杆。 */
  cameraOccluder: THREE.Object3D | null
  /** 夹取臂碰撞外壳，摄像头臂求解失败时用它回滚到上一个安全姿态。 */
  gripperCollider: THREE.Object3D | null
  frame: InspectionFrame | null
  /** 当前被测件编号（决定程序化缺陷） */
  partSeed: number
  /** 夹取爪当前阶段 */
  phase: GripperPhase
  /** 最近一次检测判定（面板写入，夹取爪据此分放） */
  lastVerdict: Verdict | null
  /** 夹取爪当前举着的货物位置（站点局部，供摄像头瞄准/环绕中心） */
  heldPartPos: THREE.Vector3 | null
  /** 自动流程是否暂停；暂停后只有被选中的机械臂接受手柄/WASD。 */
  paused: boolean
  /** 当前人工接管对象；null 表示没有接管。 */
  manualArm: ManualArm | null
} = {
  camera: null,
  cameraOccluder: null,
  gripperCollider: null,
  frame: null,
  partSeed: 1,
  phase: 'idle',
  lastVerdict: null,
  heldPartPos: null,
  paused: false,
  manualArm: null,
}

export function setInspectionPaused(paused: boolean) {
  inspectionRegistry.paused = paused
  if (!paused) inspectionRegistry.manualArm = null
  window.dispatchEvent(new CustomEvent('forgemind:inspection-control', {
    detail: { paused, manualArm: inspectionRegistry.manualArm },
  }))
}

export function setInspectionManualArm(arm: ManualArm | null) {
  inspectionRegistry.paused = arm !== null
  inspectionRegistry.manualArm = arm
  window.dispatchEvent(new CustomEvent('forgemind:inspection-control', {
    detail: { paused: inspectionRegistry.paused, manualArm: arm },
  }))
}

export function requestInspectionArmReset(arm: ManualArm) {
  window.dispatchEvent(new CustomEvent('forgemind:inspection-reset-arm', { detail: { arm } }))
}

/** 请求更换被测件（夹取爪取新货时调用）。 */
export function changeInspectionPart(seed: number) {
  inspectionRegistry.partSeed = seed
  inspectionRegistry.heldPartPos = null
  window.dispatchEvent(new CustomEvent('forgemind:change-part', { detail: { seed } }))
}

// 开发调试：把注册表暴露到 window
if (import.meta.env.DEV) {
  ;(window as unknown as { __inspection?: unknown }).__inspection = inspectionRegistry
}
