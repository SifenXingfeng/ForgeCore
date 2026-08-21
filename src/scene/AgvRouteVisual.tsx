import { Html, Line } from '@react-three/drei'
import type { AgvRuntimeSnapshot } from '../game/simulation'

export function AgvRouteVisual({ agvs }: { agvs: AgvRuntimeSnapshot[] }) {
  return (
    <group name="a01-agv-navigation">
      {agvs.map((agv) => (
        <group key={agv.objectId}>
          {agv.path.length > 1 && (
            <Line
              points={agv.path.map((point) => [point.x, 0.075, point.z] as [number, number, number])}
              color={agv.phase === 'to-warehouse' || agv.phase === 'to-source' ? '#e3b335' : '#70c7bd'}
              lineWidth={1.2}
              dashed
              dashSize={0.35}
              gapSize={0.2}
            />
          )}
          {agv.motionStatus === 'moving' && (
            <Html position={[agv.position.x, 1.25, agv.position.z]} center distanceFactor={13} style={{ pointerEvents: 'none' }}>
              <div className="fm-agv-nav-label">
                <b>{agv.phase === 'to-warehouse' ? '→ 仓储' : agv.phase === 'to-source' ? '→ 起点' : agv.phase === 'to-destination' ? '→ 终点' : '→ 产线'}</b>
                <span>{agv.cargoQuantity > 0 ? `任务货物 ×${agv.cargoQuantity}` : '空载调度'}</span>
              </div>
            </Html>
          )}
        </group>
      ))}
    </group>
  )
}
