import { useRef } from 'react'
import * as THREE from 'three'
import { Text } from '@react-three/drei'

/**
 * 网格地面 —— Day 1 的 CAD 网格基底（§1.3「CAD 坐标系参考线」）
 * 后续网格建造系统（Day 2）直接在它上面做放置与碰撞。
 *
 * 结构：一块接收阴影的地面 + 主网格线 + 十字坐标轴（X 红 / Z 蓝 / Y 绿）。
 */
export function GridFloor({ showZones = true }: { showZones?: boolean }) {
  const groundRef = useRef<THREE.Mesh>(null)

  return (
    <group>
      {/* 地面底 —— 只接收阴影，不遮挡网格线 */}
      <mesh
        ref={groundRef}
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, -0.01, 0]}
        receiveShadow
      >
        <planeGeometry args={[50, 34]} />
        <meshPhysicalMaterial color="#b9c9c4" roughness={0.82} metalness={0.06} transparent opacity={0.48} transmission={0.08} thickness={0.18} depthWrite />
      </mesh>

      {/* 主网格 —— 每格 1m，中心十字线用强调色 */}
      <gridHelper
        args={[50, 50, '#71877f', '#aab9b3']}
        position={[0, 0, 0]}
      />

      {/* 十字坐标轴 —— 暗示「工业数模软件」 */}
      {/* The build HUD already exposes coordinates; keep debug axes out of the
          player-facing AIC view so the scene reads as an industrial site. */}
      <axesHelper args={[6]} position={[0, 0.01, 0]} visible={false} />

      {/* Real factory zoning: process islands, clearance outlines and a
          dedicated vehicle aisle make the plant read as an operating site. */}
      {showZones && <><ZonePad label="RECEIVING / RAW" position={[-19, 3.7]} size={[10, 7]} color="#70827c" />
      <ZonePad label="MACHINING" position={[-8.5, 3.7]} size={[11, 7]} color="#5d7778" />
      <ZonePad label="LINE-SIDE KITTING" position={[-1.5, -5]} size={[15, 4]} color="#7d8175" />
      <ZonePad label="FORMING CELL" position={[5.7, 8]} size={[4.5, 9]} color="#777b78" />
      <ZonePad label="ELECTRICAL CELL" position={[5.7, -6]} size={[4.5, 9]} color="#5f7878" />
      <ZonePad label="ROBOT ASSEMBLY" position={[5.2, 1]} size={[7.5, 8]} color="#597475" />
      <ZonePad label="QA / PACK" position={[11, 1]} size={[7, 8]} color="#71817c" />
      <ZonePad label="FINISHED GOODS" position={[17, 1]} size={[6, 8]} color="#788077" />

      <AgvAisle /></>}
    </group>
  )
}

function ZonePad({ label, position, size, color }: { label: string; position: [number, number]; size: [number, number]; color: string }) {
  const [width, depth] = size
  return (
    <group position={[position[0], 0, position[1]]}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.004, 0]}>
        <planeGeometry args={[width, depth]} />
        <meshBasicMaterial color={color} transparent opacity={0.09} depthWrite={false} />
      </mesh>
      <mesh position={[0, 0.012, -depth / 2]}><boxGeometry args={[width, 0.016, 0.055]} /><meshBasicMaterial color="#8d9d97" transparent opacity={0.58} /></mesh>
      <mesh position={[0, 0.012, depth / 2]}><boxGeometry args={[width, 0.016, 0.055]} /><meshBasicMaterial color="#8d9d97" transparent opacity={0.58} /></mesh>
      <mesh position={[-width / 2, 0.012, 0]}><boxGeometry args={[0.055, 0.016, depth]} /><meshBasicMaterial color="#8d9d97" transparent opacity={0.58} /></mesh>
      <mesh position={[width / 2, 0.012, 0]}><boxGeometry args={[0.055, 0.016, depth]} /><meshBasicMaterial color="#8d9d97" transparent opacity={0.58} /></mesh>
      <Text
        position={[-width / 2 + 0.35, 0.026, -depth / 2 + 0.28]}
        rotation={[-Math.PI / 2, 0, 0]}
        font="/fonts/forgemind/Doto-SemiBold.ttf"
        fontSize={0.24}
        color="#53625e"
        anchorX="left"
        anchorY="middle"
        letterSpacing={0.08}
      >
        {label}
      </Text>
    </group>
  )
}

function AgvAisle() {
  const dashes = Array.from({ length: 23 }, (_, index) => -22 + index * 2)
  return (
    <group position={[0, 0, -13.3]}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.006, 0]}>
        <planeGeometry args={[48, 2.6]} />
        <meshBasicMaterial color="#596965" transparent opacity={0.18} depthWrite={false} />
      </mesh>
      <mesh position={[0, 0.018, -1.3]}><boxGeometry args={[48, 0.022, 0.09]} /><meshBasicMaterial color="#c2a649" /></mesh>
      <mesh position={[0, 0.018, 1.3]}><boxGeometry args={[48, 0.022, 0.09]} /><meshBasicMaterial color="#c2a649" /></mesh>
      {dashes.map((x) => (
        <mesh key={x} position={[x, 0.018, 0]}><boxGeometry args={[0.8, 0.018, 0.055]} /><meshBasicMaterial color="#a7b4af" transparent opacity={0.72} /></mesh>
      ))}
      <Text
        position={[-22.8, 0.03, -0.78]}
        rotation={[-Math.PI / 2, 0, 0]}
        font="/fonts/forgemind/Doto-SemiBold.ttf"
        fontSize={0.28}
        color="#4c5c58"
        anchorX="left"
        anchorY="middle"
        letterSpacing={0.1}
      >
        AGV LOGISTICS AISLE / KEEP CLEAR
      </Text>
    </group>
  )
}
