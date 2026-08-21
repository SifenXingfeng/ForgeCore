import { useFrame } from '@react-three/fiber'
import { useTexture } from '@react-three/drei'
import { useMemo, useRef } from 'react'
import * as THREE from 'three'

/** 滑门开度 0..1，由 LoginCameraRig 驱动，本组件读取。 */
export const doorState = { t: 0 }

const PANEL_HALF = 0.93
const PANEL_OPEN = 2.28
const CABIN_HIDE_X = -11.92

function HullPanel({ position, size, rotation, color = '#17201e', emissive = '#000000', emissiveIntensity = 0, metalness = 0.72, roughness = 0.34 }: {
  position: [number, number, number]
  size: [number, number, number]
  rotation?: [number, number, number]
  color?: string
  emissive?: string
  emissiveIntensity?: number
  metalness?: number
  roughness?: number
}) {
  return (
    <mesh position={position} rotation={rotation} receiveShadow castShadow>
      <boxGeometry args={size} />
      <meshStandardMaterial color={color} metalness={metalness} roughness={roughness} emissive={emissive} emissiveIntensity={emissiveIntensity} />
    </mesh>
  )
}

function DoorLeaf({ side, groupRef }: { side: -1 | 1; groupRef: React.RefObject<THREE.Group> }) {
  const source = useTexture('/textures/login/forgemind-airlock-v2.png')
  const surface = useMemo(() => {
    const texture = source.clone()
    texture.colorSpace = THREE.SRGBColorSpace
    texture.wrapS = THREE.ClampToEdgeWrapping
    texture.wrapT = THREE.ClampToEdgeWrapping
    texture.repeat.set(0.5, 1)
    texture.offset.set(side === -1 ? 0 : 0.5, 0)
    texture.anisotropy = 8
    texture.needsUpdate = true
    return texture
  }, [side, source])

  return (
    <group ref={groupRef} position={[1.89, 1.72, side * PANEL_HALF]}>
      {/* 真实厚度由底板负责，视觉细节来自 ForgeMind 专用门面纹理。 */}
      <HullPanel position={[0, 0, 0]} size={[0.18, 3.28, 1.86]} color="#65716e" metalness={0.9} roughness={0.24} />
      <mesh position={[-0.096, 0, 0]} rotation={[0, Math.PI / 2, 0]}>
        <planeGeometry args={[1.84, 3.24]} />
        <meshBasicMaterial map={surface} side={THREE.DoubleSide} toneMapped={false} />
      </mesh>
    </group>
  )
}

/**
 * ForgeMind 轨道升降舰桥。上升运动来自门框两侧竖井观察窗中高速下掠的
 * 楼层梁与灯组；相机越过门槛后整舱立即隐藏，避免从工厂里看到外壳。
 */
export function ElevatorCabin() {
  const rootRef = useRef<THREE.Group>(null)
  const leftRef = useRef<THREE.Group>(null)
  const rightRef = useRef<THREE.Group>(null)
  const lightRef = useRef<THREE.PointLight>(null)
  const portalRef = useRef<THREE.Mesh>(null)
  const floorTracksRef = useRef<THREE.Group>(null)

  useFrame((state) => {
    if (rootRef.current) rootRef.current.visible = state.camera.position.x < CABIN_HIDE_X

    const t = doorState.t
    if (leftRef.current) leftRef.current.position.z = -(PANEL_HALF + PANEL_OPEN * t)
    if (rightRef.current) rightRef.current.position.z = PANEL_HALF + PANEL_OPEN * t
    if (lightRef.current) lightRef.current.intensity = 0.9 + 2.8 * t
    if (portalRef.current) {
      const material = portalRef.current.material as THREE.MeshBasicMaterial
      material.opacity = 0.04 + t * 0.18
    }

    const travel = (state.clock.elapsedTime * 0.58) % 1
    floorTracksRef.current?.children.forEach((track, index) => {
      track.position.x = -1.9 + ((index / 7 - travel + 1) % 1) * 3.8
    })
  })

  return (
    <group ref={rootRef} position={[-14, 0, 0]}>
      {/* 舱体：石墨骨架、冷银工作面。 */}
      <HullPanel position={[-2.28, 1.86, 0]} size={[0.18, 3.72, 6.2]} color="#0c1211" />
      <HullPanel position={[-0.15, 1.86, -3.02]} size={[4.45, 3.72, 0.16]} color="#17201e" />
      <HullPanel position={[-0.15, 1.86, 3.02]} size={[4.45, 3.72, 0.16]} color="#17201e" />
      <HullPanel position={[-0.15, 3.68, 0]} size={[4.45, 0.2, 6.2]} color="#0d1412" />
      <HullPanel position={[-0.15, -0.05, 0]} size={[4.45, 0.17, 6.2]} color="#28322f" roughness={0.62} />

      {/* 顶部照明与舱内结构梁。 */}
      <HullPanel position={[-0.25, 3.54, 0]} size={[3.25, 0.06, 0.78]} color="#dce7e3" emissive="#dce7e3" emissiveIntensity={1.35} />
      <HullPanel position={[-0.25, 3.49, -2.46]} size={[3.45, 0.1, 0.14]} color="#6e9691" emissive="#72b8b0" emissiveIntensity={0.42} />
      <HullPanel position={[-0.25, 3.49, 2.46]} size={[3.45, 0.1, 0.14]} color="#6e9691" emissive="#72b8b0" emissiveIntensity={0.42} />

      {/* 井道运动改由屏幕两侧的写实循环纹理承担；舱内只保留静态深槽。 */}
      <HullPanel position={[1.66, 1.74, -2.58]} size={[0.18, 3.35, 0.72]} color="#050908" metalness={0.42} roughness={0.78} />
      <HullPanel position={[1.66, 1.74, 2.58]} size={[0.18, 3.35, 0.72]} color="#050908" metalness={0.42} roughness={0.78} />

      {/* 地板导轨以较慢视差滑动，和竖井形成两层速度。 */}
      <HullPanel position={[-0.18, 0.055, -1.96]} size={[3.7, 0.025, 0.05]} color="#88aaa5" emissive="#72b8b0" emissiveIntensity={0.32} />
      <HullPanel position={[-0.18, 0.055, 1.96]} size={[3.7, 0.025, 0.05]} color="#88aaa5" emissive="#72b8b0" emissiveIntensity={0.32} />
      <group ref={floorTracksRef}>
        {Array.from({ length: 7 }, (_, index) => (
          <group key={index} position={[-1.8 + index * 0.55, 0, 0]}>
            <HullPanel position={[0, 0.075, -1.96]} size={[0.18, 0.035, 0.3]} color="#b9c6c2" />
            <HullPanel position={[0, 0.075, 1.96]} size={[0.18, 0.035, 0.3]} color="#b9c6c2" />
          </group>
        ))}
      </group>

      {/* 多层门套：外柱、内轨、斜撑和顶部联锁箱。 */}
      <HullPanel position={[1.91, 1.72, -2.28]} size={[0.46, 3.48, 0.42]} color="#24302d" />
      <HullPanel position={[1.91, 1.72, 2.28]} size={[0.46, 3.48, 0.42]} color="#24302d" />
      <HullPanel position={[1.91, 3.45, 0]} size={[0.46, 0.34, 4.76]} color="#1a2422" />
      <HullPanel position={[1.91, 0.09, 0]} size={[0.46, 0.24, 4.76]} color="#1a2422" />
      <HullPanel position={[1.68, 1.72, -2.04]} size={[0.09, 3.18, 0.08]} color="#a9b8b4" metalness={0.9} />
      <HullPanel position={[1.68, 1.72, 2.04]} size={[0.09, 3.18, 0.08]} color="#a9b8b4" metalness={0.9} />
      <HullPanel position={[1.7, 3.15, -1.88]} size={[0.1, 0.13, 0.78]} rotation={[-0.38, 0, 0]} color="#758682" />
      <HullPanel position={[1.7, 3.15, 1.88]} size={[0.1, 0.13, 0.78]} rotation={[0.38, 0, 0]} color="#758682" />
      <HullPanel position={[1.65, 3.22, 0]} size={[0.12, 0.13, 1.2]} color="#b8c6c2" emissive="#72b8b0" emissiveIntensity={0.45} />

      <mesh ref={portalRef} position={[2.08, 1.72, 0]} rotation={[0, Math.PI / 2, 0]}>
        <planeGeometry args={[3.74, 3.04]} />
        <meshBasicMaterial color="#d8fff7" transparent opacity={0.04} depthWrite={false} />
      </mesh>

      <DoorLeaf side={-1} groupRef={leftRef} />
      <DoorLeaf side={1} groupRef={rightRef} />

      <pointLight ref={lightRef} position={[0.75, 2.55, 0]} intensity={0.9} distance={8} color="#d9fff6" />
      <pointLight position={[-1.55, 1.1, 0]} intensity={0.32} distance={5} color="#9ec7c1" />
    </group>
  )
}
