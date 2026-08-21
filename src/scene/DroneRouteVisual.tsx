import { Html, Line } from '@react-three/drei'
import type { DroneRuntimeSnapshot } from '../game/simulation'

export function DroneRouteVisual({ drones }: { drones: DroneRuntimeSnapshot[] }) {
  return (
    <group name="drone-free-flight-routes">
      {drones.map((drone) => {
        const remaining = [drone.position, ...drone.path.slice(Math.max(1, drone.waypointIndex))]
        const color = drone.phase === 'to-destination' ? '#70cbc2' : '#e2b12e'
        return (
          <group key={drone.objectId}>
            {remaining.length > 1 && <>
              <Line points={remaining.map((point) => [point.x, point.y + 0.18, point.z] as [number, number, number])} color="#294c48" lineWidth={2.2} transparent opacity={0.16} />
              <Line points={remaining.map((point) => [point.x, point.y + 0.18, point.z] as [number, number, number])} color={color} lineWidth={1.15} dashed dashSize={0.42} gapSize={0.24} transparent opacity={0.62} />
            </>}
            {drone.motionStatus === 'moving' && (
              <Html position={[drone.position.x, drone.position.y + 1.65, drone.position.z]} center distanceFactor={14} style={{ pointerEvents: 'none' }}>
                <div className="fm-drone-nav-label is-route"><b>{drone.phase === 'to-destination' ? `→ L${drone.targetFloor} 卸货` : `→ L${drone.targetFloor} 取货`}</b><span>{drone.cargoQuantity > 0 ? `跨层载货 ×${drone.cargoQuantity}` : '三维空载调度'}</span></div>
              </Html>
            )}
          </group>
        )
      })}
    </group>
  )
}
