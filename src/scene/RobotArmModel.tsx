import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useGLTF } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'

/**
 * 高精度公模加载器（补充设计 §2.3 规范化流水线的运行时实现）。
 *
 * 加载 GLB → 计算包围盒 → 居中 → 缩放到 1×1 网格足迹 → 底面落 y=0。
 * 复用 useGLTF 的缓存，同一模型只加载一次。
 */

// High-detail industrial IRB 2400 cell from the public realvirtual WEB model pack.
const MODEL_PATH = '/models/robot_irb2400.glb'

export function RobotArmModel() {
  const gltf = useGLTF(MODEL_PATH)
  const group = useRef<THREE.Group>(null)
  const control = useRef({ mode: 'auto', task: 'sort', grip: 0 })

  useEffect(() => {
    const onCommand = (event: Event) => {
      const detail = (event as CustomEvent<{ mode?: string; task?: string; action?: string }>).detail
      if (detail.mode) control.current.mode = detail.mode
      if (detail.task) control.current.task = detail.task
      if (detail.action === 'grip') control.current.grip += 1
    }
    window.addEventListener('forgemind:robot-command', onCommand)
    return () => window.removeEventListener('forgemind:robot-command', onCommand)
  }, [])

  // 归一化：居中 + 缩放到 1 格足迹 + 底面落 y=0
  const normalized = useMemo(() => {
    const scene = gltf.scene.clone(true)

    // 计算包围盒（含所有子 mesh）
    const box = new THREE.Box3().setFromObject(scene)
    const size = box.getSize(new THREE.Vector3())

    // 目标足迹：1×1 格，高按比例（高度限制 1.2m）
    const targetFootprint = 1.0
    const targetHeight = 1.2
    const scaleXZ = targetFootprint / Math.max(size.x, size.z, 0.0001)
    const scaleY = targetHeight / Math.max(size.y, 0.0001)
    const scale = Math.min(scaleXZ, scaleY)

    scene.scale.setScalar(scale)

    // 重新计算缩放后的包围盒，居中 + 底面落 y=0
    const box2 = new THREE.Box3().setFromObject(scene)
    const center2 = box2.getCenter(new THREE.Vector3())
    const min2 = box2.min
    scene.position.x -= center2.x
    scene.position.z -= center2.z
    scene.position.y -= min2.y

    // 让阴影正确投射
    scene.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.castShadow = true
        o.receiveShadow = true
      }
    })

    return scene
  }, [gltf])

  useFrame(({ clock }) => {
    if (!group.current) return
    const t = clock.getElapsedTime()
    const state = control.current
    const taskRate = state.task === 'weld' ? 4.4 : state.task === 'assemble' ? 2.8 : 2.1
    const gamepad = state.mode === 'manual' ? Array.from(navigator.getGamepads?.() ?? []).find((pad) => pad?.connected) : null
    const stickX = gamepad?.axes[0] ?? 0
    const stickY = gamepad?.axes[1] ?? 0
    const targetYaw = state.mode === 'manual' ? stickX * 0.28 : Math.sin(t * taskRate) * 0.1
    const targetLift = state.mode === 'manual' ? -stickY * 0.025 : Math.sin(t * taskRate * 0.5) * 0.012
    group.current.rotation.y = THREE.MathUtils.lerp(group.current.rotation.y, targetYaw, 0.12)
    group.current.position.y = THREE.MathUtils.lerp(group.current.position.y, targetLift, 0.12)
  })

  return <group ref={group}><primitive object={normalized} /></group>
}
