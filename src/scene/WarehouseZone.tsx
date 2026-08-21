import { Html } from '@react-three/drei'
import * as THREE from 'three'
import { WAREHOUSE_NAV_POINTS, WAREHOUSE_ZONE } from '../game/warehouse'

export function WarehouseZone() {
  const centerX = (WAREHOUSE_ZONE.minX + WAREHOUSE_ZONE.maxX) / 2 + 0.5
  const centerZ = (WAREHOUSE_ZONE.minZ + WAREHOUSE_ZONE.maxZ) / 2 + 0.5
  const width = WAREHOUSE_ZONE.maxX - WAREHOUSE_ZONE.minX + 1
  const depth = WAREHOUSE_ZONE.maxZ - WAREHOUSE_ZONE.minZ + 1

  return (
    <group name="a01-warehouse-zone">
      <mesh position={[centerX, 0.012, centerZ]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[width, depth]} />
        <meshBasicMaterial color="#6e948c" transparent opacity={0.16} side={THREE.DoubleSide} />
      </mesh>
      <mesh position={[centerX, 0.028, WAREHOUSE_ZONE.minZ - 0.2]}>
        <boxGeometry args={[width + 0.4, 0.055, 0.08]} />
        <meshBasicMaterial color="#c69b2e" transparent opacity={0.72} />
      </mesh>
      <mesh position={[centerX, 0.028, WAREHOUSE_ZONE.maxZ + 0.2]}>
        <boxGeometry args={[width + 0.4, 0.055, 0.08]} />
        <meshBasicMaterial color="#c69b2e" transparent opacity={0.72} />
      </mesh>
      <mesh position={[WAREHOUSE_ZONE.minX - 0.2, 0.028, centerZ]}>
        <boxGeometry args={[0.08, 0.055, depth + 0.4]} />
        <meshBasicMaterial color="#c69b2e" transparent opacity={0.72} />
      </mesh>
      <mesh position={[WAREHOUSE_ZONE.maxX + 0.2, 0.028, centerZ]}>
        <boxGeometry args={[0.08, 0.055, depth + 0.4]} />
        <meshBasicMaterial color="#c69b2e" transparent opacity={0.72} />
      </mesh>

      {WAREHOUSE_NAV_POINTS.filter((point) => point.kind === 'warehouse').map((point) => (
        <mesh key={point.id} position={[point.position.x, 0.04, point.position.z]}>
          <boxGeometry args={[1.25, 0.06, 1.25]} />
          <meshBasicMaterial color="#d7ad37" transparent opacity={0.52} />
        </mesh>
      ))}
      <mesh position={[-14.5, 0.038, -10.5]}>
        <boxGeometry args={[0.07, 0.05, 5.2]} />
        <meshBasicMaterial color="#7fbbb0" transparent opacity={0.68} />
      </mesh>

      <Html position={[-18.5, 2.25, -5.05]} center distanceFactor={12} style={{ pointerEvents: 'none' }}>
        <div className="fm-warehouse-zone-label">
          <span>ZONE / 07</span>
          <strong>仓储区</strong>
          <small>RAW / BUFFER / AGV DOCK</small>
        </div>
      </Html>
    </group>
  )
}
