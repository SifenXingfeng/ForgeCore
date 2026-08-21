import { Suspense } from 'react'
import { PandaArmModel } from './PandaArmModel'
import { FormalConveyorSegment } from './FormalConveyorSegment'
import type { SourceRuntimeSnapshot } from '../game/simulation'
import {
  BASE_CONVEYOR_CROSS_SECTION_SCALE,
  NON_VEHICLE_BUILDING_VISUAL_SCALE,
  SOURCE_EMBEDDED_CONVEYOR_FRONT_EDGE_LOCAL_X_M,
  SOURCE_EMBEDDED_CONVEYOR_LOCAL_POSITION,
} from './industrialVisualScale'
import { LinearConveyorMotionStripes } from './ConveyorMotionStripes'

interface IncomingStationModelProps {
  color: string
  accent: string
  active?: boolean
  running?: boolean
  runtime?: SourceRuntimeSnapshot
  stationMode?: 'pickup' | 'store'
  castShadows?: boolean
  suppressPanda?: boolean
  suppressConveyor?: boolean
}

/**
 * A compound cargo access station: three external rack docks share one arm
 * and one lowered front conveyor, with the runtime selecting the real dock.
 */
export function IncomingStationModel({ color, accent, active = false, running = false, runtime, stationMode = 'pickup', castShadows = true, suppressPanda = false, suppressConveyor = false }: IncomingStationModelProps) {
  const transferring = runtime?.state === 'picking' || runtime?.state === 'placing'
  const blocked = runtime?.state === 'blocked'
  const mode = runtime?.mode ?? stationMode

  return (
    <group>
      <mesh position={[0, 0.08, 0]} castShadow={castShadows} receiveShadow>
        <boxGeometry args={[2.85, 0.16, 1.9]} />
        <meshStandardMaterial color="#566761" roughness={0.68} metalness={0.42} />
      </mesh>
      <mesh position={[0, 0.175, 0]} receiveShadow>
        <boxGeometry args={[2.62, 0.025, 1.66]} />
        <meshStandardMaterial color="#b9c4be" roughness={0.52} metalness={0.34} />
      </mesh>

      {/* Final edge of the lowered embedded belt meets the 4x4 front dock. */}
      <group position={SOURCE_EMBEDDED_CONVEYOR_LOCAL_POSITION}>
        {!suppressConveyor && (
          <Suspense fallback={<FormalConveyorFallback color={color} />}>
            <FormalConveyorSegment targetFootprint={1.05} targetHeight={0.52} crossSectionScale={BASE_CONVEYOR_CROSS_SECTION_SCALE} />
          </Suspense>
        )}
        {/* Cancel the station's outer 1.25x scale so the bars use the exact
            same world-space height, width, density and speed as floor belts. */}
        <group scale={1 / NON_VEHICLE_BUILDING_VISUAL_SCALE}>
          <LinearConveyorMotionStripes running={running} length={1.2} direction={mode === 'store' ? -1 : 1} />
        </group>
      </group>

      <RackTransferGuide side={runtime?.rackSide ?? 'back'} active={transferring} accent={accent} />

      <group position={[-0.25, 0.18, -0.05]} scale={1.14}>
        {!suppressPanda && <PandaArmModel behavior="infeed" active={active} running={running} progress={runtime?.progress ?? 0} rackSide={runtime?.rackSide ?? 'back'} reverse={mode === 'store'} castShadows={castShadows} />}
      </group>

      <mesh position={[-0.25, 0.205, -0.05]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.34, 0.39, 24]} />
        <meshBasicMaterial color={active ? accent : '#80918b'} transparent opacity={active ? 0.72 : 0.24} />
      </mesh>

      <mesh position={[SOURCE_EMBEDDED_CONVEYOR_FRONT_EDGE_LOCAL_X_M, 0.27, SOURCE_EMBEDDED_CONVEYOR_LOCAL_POSITION[2]]} castShadow>
        <boxGeometry args={[0.1, 0.14, 0.58]} />
        <meshStandardMaterial color="#1a2825" roughness={0.66} metalness={0.42} />
      </mesh>

      <mesh position={[0, 0.39, -0.84]}>
        <boxGeometry args={[1.72, 0.028, 0.035]} />
        <meshBasicMaterial color={blocked ? '#c95b54' : accent} transparent opacity={blocked ? 0.9 : transferring ? 0.84 : 0.28} />
      </mesh>
    </group>
  )
}

function FormalConveyorFallback({ color }: { color: string }) {
  return <group>
    <mesh position={[0, 0.08, 0]} castShadow receiveShadow>
      <boxGeometry args={[1.05, 0.16, 0.72]} />
      <meshStandardMaterial color="#182522" roughness={0.76} metalness={0.36} />
    </mesh>
    <mesh position={[0, 0.18, 0]} receiveShadow>
      <boxGeometry args={[0.92, 0.025, 0.52]} />
      <meshStandardMaterial color="#273633" roughness={0.72} metalness={0.2} />
    </mesh>
    {[-0.38, -0.13, 0.13, 0.38].map((x) => <mesh key={x} position={[x, 0.22, 0]} rotation={[0, 0, Math.PI / 2]}>
      <cylinderGeometry args={[0.055, 0.055, 0.58, 12]} />
      <meshStandardMaterial color="#a6b0aa" roughness={0.42} metalness={0.78} />
    </mesh>)}
    <mesh position={[0, 0.26, 0]}>
      <boxGeometry args={[0.9, 0.012, 0.022]} />
      <meshBasicMaterial color={color} transparent opacity={0.28} />
    </mesh>
  </group>
}

function RackTransferGuide({ side, active, accent }: { side: 'back' | 'left' | 'right'; active: boolean; accent: string }) {
  const placement: Record<typeof side, { position: [number, number, number]; size: [number, number, number] }> = {
    back: { position: [-1.52, 0.22, 0], size: [1.1, 0.025, 0.09] },
    left: { position: [-0.18, 0.22, 1.52], size: [0.09, 0.025, 1.1] },
    right: { position: [-0.18, 0.22, -1.52], size: [0.09, 0.025, 1.1] },
  }
  const guide = placement[side]
  return <mesh position={guide.position}>
    <boxGeometry args={guide.size} />
    <meshBasicMaterial color={active ? accent : '#71817b'} transparent opacity={active ? 0.75 : 0.18} />
  </mesh>
}
