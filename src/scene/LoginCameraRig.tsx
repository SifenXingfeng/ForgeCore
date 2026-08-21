import { useFrame, useThree } from '@react-three/fiber'
import { useRef } from 'react'
import * as THREE from 'three'
import { useAuthStore } from '../store/auth'
import { doorState } from './ElevatorCabin'

/** 舱内相机起点（站在门前，略后撤以便门框入画） */
const CABIN_CAM = new THREE.Vector3(-15.75, 1.88, 0)
const CABIN_LOOK = new THREE.Vector3(-11.85, 1.72, 0)
/** 推镜终点 = overview 相机预设，与 FactoryCanvas 一致，切换零跳变 */
const FACTORY_CAM = new THREE.Vector3(17, 19, 17)
const FACTORY_LOOK = new THREE.Vector3(0, 0, 0)

const tmpLook = new THREE.Vector3()

const smoothstep = (t: number) => t * t * (3 - 2 * t)
const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)

const DOOR_MS = 1350 // 舱门液压滑开时长
const HOLD_MS = 360 // 门开后确认通道
const DOLLY_MS = 2100 // 相机推镜时长

/**
 * 登录相机控制器：
 * - elevator：相机锁定舱内看门（独占相机，OrbitControls 未挂载）。
 * - entering：门开 → 停顿 → 相机推镜到工厂总览位；完成后 setPhase('factory') 停用。
 */
export function LoginCameraRig() {
  const { camera } = useThree()
  const phase = useAuthStore((s) => s.phase)
  const setPhase = useAuthStore((s) => s.setPhase)
  const started = useRef(false)
  const t0 = useRef(0)

  useFrame(() => {
    if (phase === 'elevator') {
      doorState.t = 0
      started.current = false
      const vibration = performance.now() * 0.001
      camera.position.set(
        CABIN_CAM.x,
        CABIN_CAM.y + Math.sin(vibration * 7.3) * 0.0035,
        CABIN_CAM.z + Math.sin(vibration * 5.1) * 0.0025,
      )
      camera.lookAt(CABIN_LOOK)
      return
    }
    if (phase !== 'entering') return

    if (!started.current) {
      started.current = true
      t0.current = performance.now()
    }
    const elapsed = performance.now() - t0.current

    // 舱门平滑打开
    doorState.t = smoothstep(Math.min(elapsed / DOOR_MS, 1))

    // 相机推镜（HOLD_MS 后开始，DOLLY_MS 内到工厂总览位）
    const moveT = Math.min(Math.max(elapsed - DOOR_MS - HOLD_MS, 0) / DOLLY_MS, 1)
    const ease = easeInOut(moveT)
    camera.position.lerpVectors(CABIN_CAM, FACTORY_CAM, ease)
    tmpLook.lerpVectors(CABIN_LOOK, FACTORY_LOOK, ease)
    camera.lookAt(tmpLook)

    if (moveT >= 1) setPhase('factory')
  })

  return null
}
