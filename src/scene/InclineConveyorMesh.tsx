import { Suspense } from 'react'
import * as THREE from 'three'
import type { ThreeEvent } from '@react-three/fiber'
import type { FactoryFloorId, FactoryObject, GridPos, Rotation } from '../game/types'
import { gridToWorld } from '../game/grid'
import { createInclineObject, inclineEndCell, inclineInterfaces, inclineStartCell, isInclineConveyorType } from '../game/inclineConveyor'
import { getFloorElevation } from './FactoryFloorSystem'
import { FormalConveyorSegment } from './FormalConveyorSegment'
import { CONVEYOR_VISUAL_SURFACE_Y_M, CONVEYOR_VISUAL_WIDTH_M } from './industrialVisualScale'
import { LinearConveyorMotionStripes } from './ConveyorMotionStripes'

export function InclineConveyorMesh({
  object,
  renderFloorId,
  selected = false,
  running = false,
  previewColor,
  onSelect,
}: {
  object: FactoryObject
  renderFloorId: FactoryFloorId
  selected?: boolean
  running?: boolean
  previewColor?: string
  onSelect?: (id: string) => void
}) {
  if (!isInclineConveyorType(object.type) || !object.incline) return null
  const startCell = inclineStartCell(object)
  const endCell = inclineEndCell(object)
  const startWorld = gridToWorld(startCell)
  const endWorld = gridToWorld(endCell)
  const renderBaseY = getFloorElevation(renderFloorId)
  const startY = getFloorElevation(object.floorId ?? 1) - renderBaseY
  const endFloorId = object.incline.direction === 'up' ? object.incline.upperFloorId : object.incline.lowerFloorId
  const endY = getFloorElevation(endFloorId) - renderBaseY
  const vector = new THREE.Vector3(endWorld.x - startWorld.x, endY - startY, endWorld.z - startWorld.z)
  const length = vector.length()
  const quaternion = inclineSlopeQuaternion(vector)
  const segmentCount = Math.max(1, Math.round(length / 1.05))
  const segmentLength = length / segmentCount + 0.04
  const midpoint = new THREE.Vector3(
    (startWorld.x + endWorld.x) / 2,
    (startY + endY) / 2,
    (startWorld.z + endWorld.z) / 2,
  )
  const outline = previewColor ?? '#4fc3f7'
  const interfaces = inclineInterfaces(object)

  const handleClick = (event: ThreeEvent<MouseEvent>) => {
    if (!onSelect) return
    event.stopPropagation()
    onSelect(object.id)
  }

  return (
    <group name={`incline-conveyor:${object.id}`} onClick={onSelect ? handleClick : undefined}>
      <Suspense fallback={<InclineFallback midpoint={midpoint} quaternion={quaternion} length={length} color={outline} />}>
        {Array.from({ length: segmentCount }, (_, index) => {
          const t = (index + 0.5) / segmentCount
          return (
            <group
              key={index}
              position={[
                THREE.MathUtils.lerp(startWorld.x, endWorld.x, t),
                THREE.MathUtils.lerp(startY, endY, t),
                THREE.MathUtils.lerp(startWorld.z, endWorld.z, t),
              ]}
              quaternion={quaternion}
            >
              <FormalConveyorSegment targetFootprint={segmentLength} targetHeight={0.52} />
            </group>
          )
        })}
      </Suspense>

      <group position={midpoint} quaternion={quaternion}>
        <LinearConveyorMotionStripes running={running} length={length} />
      </group>

      {interfaces.map((connection) => {
        const point = gridToWorld(connection.cell)
        const y = getFloorElevation(connection.floorId) - renderBaseY + CONVEYOR_VISUAL_SURFACE_Y_M + 0.025
        const color = connection.role === 'input' ? '#4d9bb1' : '#e6ad26'
        return (
          <group key={connection.role} position={[point.x, y, point.z]}>
            <mesh rotation={[-Math.PI / 2, 0, 0]}>
              <ringGeometry args={[0.16, 0.25, 24]} />
              <meshBasicMaterial color={color} transparent opacity={selected || previewColor ? 0.96 : 0.58} depthWrite={false} />
            </mesh>
          </group>
        )
      })}

      {(selected || previewColor) && (
        <lineSegments position={midpoint} quaternion={quaternion}>
          <edgesGeometry args={[new THREE.BoxGeometry(length, CONVEYOR_VISUAL_SURFACE_Y_M, CONVEYOR_VISUAL_WIDTH_M)]} />
          <lineBasicMaterial color={outline} transparent opacity={previewColor ? 0.92 : 0.78} />
        </lineSegments>
      )}
    </group>
  )
}

/** Yaw first, then pitch around local Z, so the belt width axis never side-rolls. */
export function inclineSlopeQuaternion(vector: THREE.Vector3): THREE.Quaternion {
  const horizontal = Math.hypot(vector.x, vector.z)
  const yaw = Math.atan2(-vector.z, vector.x)
  const pitch = Math.atan2(vector.y, horizontal)
  const yawRotation = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw)
  const pitchRotation = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), pitch)
  return yawRotation.multiply(pitchRotation)
}

export function InclineConveyorPreview({
  type,
  lowPos,
  rotation,
  lowerFloorId,
  valid,
}: {
  type: 'inclineUp' | 'inclineDown'
  lowPos: GridPos
  rotation: Rotation
  lowerFloorId: FactoryFloorId
  valid: boolean
}) {
  const object = createInclineObject('__incline-ghost__', type, lowPos, rotation, lowerFloorId)
  if (!object) return null
  return <InclineConveyorMesh object={object} renderFloorId={lowerFloorId} previewColor={valid ? '#66bb6a' : '#ef5350'} />
}

function InclineFallback({ midpoint, quaternion, length, color }: { midpoint: THREE.Vector3; quaternion: THREE.Quaternion; length: number; color: string }) {
  return (
    <mesh position={midpoint} quaternion={quaternion}>
      <boxGeometry args={[length, 0.18, CONVEYOR_VISUAL_WIDTH_M]} />
      <meshStandardMaterial color={color} transparent opacity={0.34} roughness={0.5} metalness={0.45} />
    </mesh>
  )
}
