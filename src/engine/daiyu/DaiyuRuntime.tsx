import { useEffect, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { daiyuEngine } from './DaiyuEngine'
import { DAIYU_WARMUP_DELAYS_MS } from './config'

/** 每帧只采样底层 renderer.info，不触发 React 重渲染。 */
export function DaiyuRuntime({ running }: { running: boolean }) {
  const { gl, scene } = useThree()
  const lastAuditAt = useRef(0)

  useEffect(() => {
    daiyuEngine.setPhase(running ? 'running' : 'prewarming')
    ;(window as Window & { __DAIYU__?: typeof daiyuEngine }).__DAIYU__ = daiyuEngine
    document.documentElement.dataset.daiyuEngine = `${daiyuEngine.name}@${daiyuEngine.version}`
    const unsubscribe = daiyuEngine.subscribe((snapshot) => {
      document.documentElement.dataset.daiyuSnapshot = JSON.stringify(snapshot)
    })
    return () => {
      unsubscribe()
      delete document.documentElement.dataset.daiyuEngine
      delete document.documentElement.dataset.daiyuSnapshot
    }
  }, [running])

  useFrame(({ clock }, delta) => {
    daiyuEngine.sampleFrame(delta, gl)
    const now = clock.getElapsedTime()
    if (now - lastAuditAt.current >= 2) {
      lastAuditAt.current = now
      document.documentElement.dataset.daiyuSceneAudit = JSON.stringify(auditScene(scene))
    }
  }, -100)

  return null
}

function auditScene(scene: THREE.Scene) {
  const groups: Record<string, { meshes: number; instances: number; triangles: number; shadowCasters: number }> = {}
  scene.traverse((node) => {
    if (!(node instanceof THREE.Mesh) || !isHierarchyVisible(node)) return
    let owner: THREE.Object3D | null = node
    while (owner && !owner.name.startsWith('factory-object:') && !owner.name.startsWith('daiyu-batch:')) owner = owner.parent
    const key = owner?.name.split(':').slice(0, 2).join(':') ?? 'scene:other'
    const entry = groups[key] ??= { meshes: 0, instances: 0, triangles: 0, shadowCasters: 0 }
    const count = node instanceof THREE.InstancedMesh ? node.count : 1
    const geometry = node.geometry
    const triangles = geometry.index
      ? geometry.index.count / 3
      : (geometry.attributes.position?.count ?? 0) / 3
    entry.meshes += 1
    entry.instances += count
    entry.triangles += Math.round(triangles * count)
    if (node.castShadow) entry.shadowCasters += 1
  })
  return groups
}

function isHierarchyVisible(object: THREE.Object3D) {
  let current: THREE.Object3D | null = object
  while (current) {
    if (!current.visible) return false
    current = current.parent
  }
  return true
}

/**
 * 在电梯门关闭期间挂载但隐藏工厂，并分阶段预编译已经到达的材质。
 * root 的模型与正式场景是同一批对象，不创建低模或替换模型。
 */
export function DaiyuScenePrewarmer({
  rootRef,
  enabled,
  preload,
}: {
  rootRef: React.RefObject<THREE.Group>
  enabled: boolean
  preload?: () => void
}) {
  const { gl, scene, camera } = useThree()

  useEffect(() => {
    if (!enabled) return
    daiyuEngine.setPhase('prewarming')
    preload?.()
    let cancelled = false

    const warm = async () => {
      const root = rootRef.current
      if (!root || cancelled) return
      const wasVisible = root.visible
      root.visible = true
      try {
        if ('compileAsync' in gl && typeof gl.compileAsync === 'function') await gl.compileAsync(scene, camera)
        else gl.compile(scene, camera)
      } finally {
        if (!cancelled) root.visible = wasVisible
      }
    }

    const timers = DAIYU_WARMUP_DELAYS_MS.map((delay, index) => window.setTimeout(() => {
      void warm().then(() => {
        if (index === DAIYU_WARMUP_DELAYS_MS.length - 1 && !cancelled) daiyuEngine.setPhase('ready')
      })
    }, delay))

    return () => {
      cancelled = true
      timers.forEach(window.clearTimeout)
    }
  }, [camera, enabled, gl, preload, rootRef, scene])

  return null
}
