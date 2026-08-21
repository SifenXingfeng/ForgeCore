import { memo, useEffect, useLayoutEffect, useRef } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import { getObjectDef, objectRole } from '../game/types'
import { gridToWorld, objectCompatiblePortCells, objectInterfacePortCellsForSide, objectToWorld, occupiedCells, rotatedFootprint } from '../game/grid'
import { rotationToDir } from '../game/dir'
import { EquipmentModel, RuntimeDetailSignal } from './EquipmentModel'
import { buildingVisualScaleForType } from './industrialVisualScale'
import { CornerConveyorMotionStripes, LinearConveyorMotionStripes } from './ConveyorMotionStripes'
import type { FactoryObject, PortSide } from '../game/types'
import type { MachineRuntime, SourceRuntimeSnapshot } from '../game/simulation'

/**
 * 单个已放置对象的渲染。
 * - machine：高精度公模（机械臂）+ 状态色底座 + 进度条
 * - conveyor/source：程序化几何（简单几何体，无需公模）
 */
export const FactoryObjectMesh = memo(function FactoryObjectMesh({
  obj,
  objects,
  selected,
  active = false,
  running = false,
  runtime,
  sourceRuntime,
  suppressEquipmentModel = false,
  showPortMarkers = true,
  castShadows = true,
  suppressPanda = false,
  suppressConveyor = false,
  onClick,
}: {
  obj: FactoryObject
  objects: FactoryObject[]
  selected: boolean
  active?: boolean
  running?: boolean
  runtime?: MachineRuntime
  sourceRuntime?: SourceRuntimeSnapshot
  suppressEquipmentModel?: boolean
  showPortMarkers?: boolean
  castShadows?: boolean
  suppressPanda?: boolean
  suppressConveyor?: boolean
  onClick?: (id: string) => void
}) {
  const def = getObjectDef(obj.type, obj.resourceId)
  const fp = rotatedFootprint(def.footprint, obj.rotation)
  const { x, z } = objectToWorld(obj)
  const group = useRef<THREE.Group>(null)

  const stateColor = machineStateColor(runtime)
  const visualScale = buildingVisualScaleForType(obj.type)
  const conveyorLinks = def.role === 'conveyor' && obj.type === 'conveyor'
    ? getConveyorLinks(obj, objects)
    : null
  // 选中态低强度发光脉冲
  useFrame(({ clock }) => {
    if (!group.current || !selected) return
    const t = clock.getElapsedTime()
    const pulse = 0.5 + 0.5 * Math.sin(t * 3)
    group.current.scale.setScalar(1 + pulse * 0.03)
  })

  useEffect(() => {
    if (!selected) group.current?.scale.setScalar(1)
  }, [selected])

  useLayoutEffect(() => {
    group.current?.traverse((node) => {
      if (!(node instanceof THREE.Mesh)) return
      if (node.userData.daiyuOriginalCastShadow === undefined) node.userData.daiyuOriginalCastShadow = node.castShadow
      node.castShadow = castShadows && Boolean(node.userData.daiyuOriginalCastShadow)
    })
  }, [castShadows])

  const isMachine = def.role === 'machine'

  return (
    <group
      ref={group}
      name={`factory-object:${obj.type}:${obj.id}`}
      position={[x, 0, z]}
      rotation={[0, obj.rotation === 90 ? -Math.PI / 2 : obj.rotation === 180 ? Math.PI : obj.rotation === 270 ? Math.PI / 2 : 0, 0]}
      onClick={onClick ? (e) => {
        e.stopPropagation()
        onClick(obj.id)
      } : undefined}
    >
      {isMachine ? (
        <>
        {!suppressEquipmentModel && <EquipmentModel type={obj.type} resourceId={obj.resourceId} color={def.color} accent={def.accent} height={def.height} active={active} runtime={runtime} castShadows={castShadows} suppressPanda={suppressPanda} suppressConveyor={suppressConveyor} />}
          {/* 状态色底座（显示机器状态，模型上方不遮挡） */}
          <mesh position={[0, 0.025, 0]} receiveShadow>
            <boxGeometry args={[fp.w, 0.04, fp.d]} />
            <meshStandardMaterial
              color="#697773"
              roughness={0.72}
              metalness={0.35}
            />
          </mesh>
          <mesh position={[0, 0.048, 0]} receiveShadow>
            <boxGeometry args={[Math.max(fp.w - 0.14, 0.2), 0.012, Math.max(fp.d - 0.14, 0.2)]} />
            <meshStandardMaterial color="#a4b0aa" roughness={0.55} metalness={0.5} emissive={stateColor} emissiveIntensity={selected ? 0.16 : 0.035} />
          </mesh>
        </>
      ) : def.role === 'conveyor' || def.role === 'storage' ? (
        !suppressEquipmentModel && <EquipmentModel type={obj.type} resourceId={obj.resourceId} color={def.color} accent={def.accent} height={def.height} active={def.role === 'conveyor' ? running && active : active} running={running} runtime={runtime} sourceRuntime={sourceRuntime} stationMode={obj.stationProgram?.mode} conveyorCorner={Boolean(conveyorLinks?.corner)} conveyorCornerInput={conveyorLinks?.inputSide} castShadows={castShadows} suppressPanda={suppressPanda} suppressConveyor={suppressConveyor} />
      ) : (
        !suppressEquipmentModel && <EquipmentModel type={obj.type} resourceId={obj.resourceId} color={def.color} accent={def.accent} height={def.height} active={active} running={running} runtime={runtime} sourceRuntime={sourceRuntime} stationMode={obj.stationProgram?.mode} conveyorCorner={Boolean(conveyorLinks?.corner)} castShadows={castShadows} suppressPanda={suppressPanda} suppressConveyor={suppressConveyor} />
      )}

      {suppressEquipmentModel && obj.type === 'press' && (
        <RuntimeDetailSignal accent={def.accent} active={runtime?.state === 'processing' || runtime?.state === 'loading'} kind="press" />
      )}
      {suppressEquipmentModel && obj.type === 'washing' && (
        <RuntimeDetailSignal accent={def.accent} active={runtime?.state === 'processing' || runtime?.state === 'loading'} kind="wash" />
      )}
      {suppressEquipmentModel && obj.type === 'storage' && (
        <RuntimeDetailSignal accent={def.accent} active={active} kind="storage" />
      )}

      {/* 机器进度条（加工/收料/出料阶段） */}
      {runtime && runtime.progress > 0 && runtime.progress < 1 && (
        <mesh position={[0, 1.3, 0]}>
          <planeGeometry args={[fp.w * runtime.progress, 0.06]} />
          <meshBasicMaterial color="#4fc3f7" />
        </mesh>
      )}

      {obj.type === 'conveyor' && conveyorLinks?.corner
        ? <CornerConveyorMotionStripes running={running} inputSide={conveyorLinks.inputSide ?? 'left'} />
        : obj.type === 'conveyor' && <LinearConveyorMotionStripes running={running} />}

      {showPortMarkers && (
        <PortMarkers
          obj={obj}
          input={def.inputPort}
          output={def.outputPort}
          hideInput={Boolean(conveyorLinks?.inputConnected)}
          hideOutput={Boolean(conveyorLinks?.outputConnected)}
        />
      )}

      {/* 选中描边（按足迹高度） */}
      {selected && (
        <lineSegments position={[0, def.height * visualScale / 2, 0]}>
          <edgesGeometry args={[new THREE.BoxGeometry(fp.w * visualScale, def.height * visualScale, fp.d * visualScale)]} />
          <lineBasicMaterial color="#4fc3f7" linewidth={1} />
        </lineSegments>
      )}
    </group>
  )
})

export function getConveyorLinks(obj: FactoryObject, objects: FactoryObject[]) {
  const sharesCell = (cells: { x: number; z: number }[], target: { x: number; z: number }[]) => cells.some((a) => target.some((b) => a.x === b.x && a.z === b.z))
  const isConnected = (upstream: FactoryObject, downstream: FactoryObject) => {
    const inputCells = objectCompatiblePortCells(downstream, 'input')
    const outputHitsDownstream = sharesCell(objectCompatiblePortCells(upstream, 'output'), occupiedCells(downstream))
    const upstreamOccupiesInput = inputCells.length === 0 || sharesCell(occupiedCells(upstream), inputCells)
    if (objectRole(upstream.type, upstream.resourceId) === 'machine') return outputHitsDownstream
    if (objectRole(downstream.type, downstream.resourceId) === 'machine') return upstreamOccupiesInput
    return outputHitsDownstream && upstreamOccupiesInput
  }
  // A belt is placed on the upstream output cell. Therefore the visual link
  // must compare that output with the belt footprint, not with its external
  // input marker. The latter is one cell further upstream and made every
  // valid generated segment look disconnected.
  const incoming = objects.find((other) => other.id !== obj.id && isConnected(other, obj))
  const outgoing = objects.find((other) => other.id !== obj.id && isConnected(obj, other))
  const incomingConveyor = objects.find((other) => other.id !== obj.id && other.type === 'conveyor' && isConnected(other, obj))
  const outgoingConveyor = objects.find((other) => other.id !== obj.id && other.type === 'conveyor' && isConnected(obj, other))
  const directionBetween = (from: FactoryObject, to: FactoryObject) => ({
    dx: Math.sign(to.pos.x - from.pos.x),
    dz: Math.sign(to.pos.z - from.pos.z),
  })
  const incomingDir = incomingConveyor ? directionBetween(obj, incomingConveyor) : null
  const outgoingDir = outgoingConveyor ? directionBetween(obj, outgoingConveyor) : null
  const corner = Boolean(
    incomingDir && outgoingDir &&
    incomingDir.dx * outgoingDir.dx + incomingDir.dz * outgoingDir.dz === 0,
  )
  const forward = rotationToDir(obj.rotation)
  const left = { dx: -forward.dz, dz: forward.dx }
  const inputSide = incomingConveyor && incomingDir
    ? incomingDir.dx === left.dx && incomingDir.dz === left.dz ? 'left' as const : 'right' as const
    : undefined
  return {
    inputConnected: Boolean(incoming),
    outputConnected: Boolean(outgoing),
    corner,
    inputSide,
  }
}

function PortMarkers({ obj, input, output, hideInput = false, hideOutput = false }: { obj: FactoryObject; input: PortSide | null; output: PortSide | null; hideInput?: boolean; hideOutput?: boolean }) {
  // Conveyors communicate direction through the belt flow. Rendering a full
  // input/output marker pair on every 1x1 segment creates floating dots at
  // every joint, especially where a route turns.
  if (obj.type === 'conveyor') return null
  const sides: PortSide[] = ['front', 'back', 'left', 'right']
  const markers = (port: 'input' | 'output', kind: 'input' | 'output', color: string) => sides.flatMap((side) => objectInterfacePortCellsForSide(obj, port, side).map((cell, index) => <PortMarker key={`${port}-${side}-${cell.x}-${cell.z}-${index}`} kind={kind} side={side} obj={obj} cell={cell} color={color} />))
  void input; void output
  return <>{!hideInput && markers('input', 'input', '#4d9bb1')}{!hideOutput && markers('output', 'output', '#e6ad26')}</>
}

function PortMarker({ kind, side, obj, cell, color }: { kind: 'input' | 'output'; side: PortSide; obj: FactoryObject; cell: { x: number; z: number }; color: string }) {
  const beacon = useRef<THREE.Group>(null)
  useFrame(({ clock }) => {
    if (!beacon.current) return
    const pulse = 0.92 + Math.sin(clock.getElapsedTime() * 3.2 + (kind === 'output' ? 0.8 : 0)) * 0.08
    beacon.current.scale.setScalar(pulse)
  })
  const world = gridToWorld(cell)
  const centre = objectToWorld(obj)
  const angle = rotationAngle(obj.rotation)
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  const worldOffset = { x: world.x - centre.x, z: world.z - centre.z }
  const edge = {
    x: cos * worldOffset.x - sin * worldOffset.z,
    z: sin * worldOffset.x + cos * worldOffset.z,
  }
  const sideData: Record<PortSide, { dx: number; dz: number }> = {
    front: { dx: 1, dz: 0 },
    back: { dx: -1, dz: 0 },
    left: { dx: 0, dz: 1 },
    right: { dx: 0, dz: -1 },
  }
  const sideDirection = sideData[side]
  const arrow = kind === 'output' ? sideDirection : { dx: -sideDirection.dx, dz: -sideDirection.dz }
  // `edge` is already transformed back into the rotated object's local
  // frame, so the unrotated definition footprint is the correct envelope.
  const footprint = getObjectDef(obj.type, obj.resourceId).footprint
  const bodyEdgeDistance = side === 'front' || side === 'back' ? footprint.w / 2 : footprint.d / 2
  const markerDistance = Math.abs(side === 'front' || side === 'back' ? edge.x : edge.z)
  const markerPosition = edge
  const bridgeLength = Math.max(0.32, markerDistance - bodyEdgeDistance)
  const bridgeCentre = bodyEdgeDistance + bridgeLength / 2
  const bridgePosition = {
    x: sideDirection.dx !== 0 ? sideDirection.dx * bridgeCentre : edge.x,
    z: sideDirection.dz !== 0 ? sideDirection.dz * bridgeCentre : edge.z,
  }
  return (
    <>
      <mesh
        position={[bridgePosition.x, 0.16, bridgePosition.z]}
      >
        <boxGeometry args={sideDirection.dx !== 0 ? [bridgeLength, 0.026, 0.12] : [0.12, 0.026, bridgeLength]} />
        <meshBasicMaterial color={color} transparent opacity={0.52} />
      </mesh>
      <group ref={beacon} position={[markerPosition.x, 0.31, markerPosition.z]}>
        <mesh position={[0, -0.18, 0]}>
          <cylinderGeometry args={[0.245, 0.245, 0.032, 8]} />
          <meshStandardMaterial color="#172526" roughness={0.64} metalness={0.72} />
        </mesh>
        <mesh position={[0, -0.155, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[0.19, 0.025, 8, 24]} />
          <meshBasicMaterial color={color} transparent opacity={0.92} />
        </mesh>
        <mesh position={[0, -0.145, 0]}>
          <boxGeometry args={[0.16, 0.028, 0.16]} />
          <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.38} roughness={0.35} metalness={0.5} />
        </mesh>
        <mesh position={[arrow.dx * 0.14, 0.015, arrow.dz * 0.14]} rotation={arrowRotation(arrow.dx, arrow.dz)}>
          <coneGeometry args={[0.105, 0.24, 8]} />
          <meshBasicMaterial color={color} />
        </mesh>
        <mesh position={[0, 0.03, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <ringGeometry args={[0.27, 0.285, 24]} />
          <meshBasicMaterial color={color} transparent opacity={0.18} />
        </mesh>
      </group>
    </>
  )
}

function rotationAngle(rotation: FactoryObject['rotation']): number {
  return rotation === 90 ? -Math.PI / 2 : rotation === 180 ? Math.PI : rotation === 270 ? Math.PI / 2 : 0
}

function arrowRotation(dx: number, dz: number): [number, number, number] {
  if (dx === 1) return [0, 0, -Math.PI / 2]
  if (dx === -1) return [0, 0, Math.PI / 2]
  if (dz === 1) return [Math.PI / 2, 0, 0]
  return [-Math.PI / 2, 0, 0]
}

/** 机器状态 → 颜色 */
function machineStateColor(runtime?: MachineRuntime): string {
  if (!runtime) return '#4fc3f7'
  switch (runtime.state) {
    case 'idle':
      return '#4fc3f7'
    case 'loading':
      return '#fbc02d'
    case 'processing':
      return '#29b6f6'
    case 'output':
      return '#66bb6a'
    default:
      return '#4fc3f7'
  }
}
