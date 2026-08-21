import { Line } from '@react-three/drei'
import type { BuildType, FactoryFloorId, FactoryObject } from '../game/types'
import { FLOOR_HEIGHT_M, getFactoryFloors } from '../game/floorConfig'
export type { FactoryFloorId } from '../game/types'

export const FACTORY_FLOORS = getFactoryFloors(3)

const PLATFORM_CENTER: [number, number] = [-2, -2]

export function getFloorElevation(floorId: FactoryFloorId): number {
  return Math.max(0, Math.round(floorId) - 1) * FLOOR_HEIGHT_M
}

/** Existing production objects and the drone dock stay on L1; upper-floor objects carry floorId. */
export function getObjectFloor(object: Pick<FactoryObject, 'type' | 'floorId'> | BuildType): FactoryFloorId {
  if (typeof object === 'string') return 1
  return object.floorId ?? 1
}

export function FactoryFloorSystem({ floorCount = 1 }: { floorCount?: number }) {
  return (
    <group name="forgecore-floor-system">
      <VerticalCore floorCount={floorCount} />
    </group>
  )
}

function VerticalCore({ floorCount }: { floorCount: number }) {
  const columns: Array<[number, number]> = [[-24, -18], [20, -18], [-24, 14], [20, 14]]
  const height = Math.max(FLOOR_HEIGHT_M * Math.max(0, floorCount - 1), 0.12)
  return (
    <group name="factory-vertical-core">
      {columns.map(([x, z]) => (
        <mesh key={`${x}-${z}`} position={[x, height / 2, z]}>
          <boxGeometry args={[0.12, height + 0.1, 0.12]} />
          <meshBasicMaterial color="#6e9690" transparent opacity={0.3} />
        </mesh>
      ))}
      <Line points={[[PLATFORM_CENTER[0] - 24, 0.03, PLATFORM_CENTER[1] - 16], [PLATFORM_CENTER[0] + 24, 0.03, PLATFORM_CENTER[1] - 16]]} color="#d3af3c" lineWidth={1.1} transparent opacity={0.58} />
    </group>
  )
}
