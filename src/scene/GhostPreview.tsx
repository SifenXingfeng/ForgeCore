import * as THREE from 'three'
import { getObjectDef } from '../game/types'
import { dirToRotation } from '../game/dir'
import { objectToWorld, rotatedFootprint } from '../game/grid'
import { useForgeMindStore, type Ghost } from '../store/forgeMind'
import { EquipmentModel } from './EquipmentModel'
import type { GridPos, Rotation } from '../game/types'
import { buildingVisualScaleForType, CONVEYOR_VISUAL_SURFACE_Y_M, CONVEYOR_VISUAL_WIDTH_M } from './industrialVisualScale'
import { isInclineConveyorType } from '../game/inclineConveyor'
import { InclineConveyorPreview } from './InclineConveyorMesh'

export function GhostPreview({ ghost }: { ghost: Ghost }) {
  const ghostPath = useForgeMindStore((state) => state.ghostPath)
  const ghostPathValid = useForgeMindStore((state) => state.ghostPathValid)
  if (!ghost.pos) return null
  if (isInclineConveyorType(ghost.type)) {
    return <InclineConveyorPreview type={ghost.type} lowPos={ghost.pos} rotation={ghost.rotation} lowerFloorId={ghost.floorId ?? 1} valid={ghost.valid} />
  }
  if (ghost.type === 'conveyor' && ghostPath.length > 0) {
    return <group>{ghostPath.map((pos, index) => <ConveyorGhost key={`${pos.x}:${pos.z}`} pos={pos} rotation={pathRotation(ghostPath, index, ghost.rotation)} valid={ghostPathValid[index] ?? ghost.valid} index={index} />)}</group>
  }

  const def = getObjectDef(ghost.type, ghost.resourceId)
  const fp = rotatedFootprint(def.footprint, ghost.rotation)
  const { x, z } = objectToWorld({ type: ghost.type, resourceId: ghost.resourceId, pos: ghost.pos, rotation: ghost.rotation })
  const color = ghost.valid ? '#66bb6a' : '#ef5350'
  const hasSplitAsset = Boolean(def.assetPath)
  const visualScale = buildingVisualScaleForType(ghost.type)

  return <group position={[x, 0, z]} rotation={[0, rotationAngle(ghost.rotation), 0]}>
    {hasSplitAsset ? <EquipmentModel type={ghost.type} resourceId={ghost.resourceId} color={def.color} accent={def.accent} height={def.height} /> : <PreviewVolume footprint={fp} height={def.height} color={color} visualScale={visualScale} />}
    <lineSegments position={[0, def.height * visualScale / 2, 0]}><edgesGeometry args={[new THREE.BoxGeometry(fp.w * visualScale, def.height * visualScale, fp.d * visualScale)]} /><lineBasicMaterial color={color} /></lineSegments>
  </group>
}

function ConveyorGhost({ pos, rotation, valid }: { pos: GridPos; rotation: Rotation; valid: boolean; index: number }) {
  const { x, z } = objectToWorld({ type: 'conveyor', pos, rotation })
  const color = valid ? '#e4b52b' : '#ef5350'
  return <group position={[x, 0, z]} rotation={[0, rotationAngle(rotation), 0]}>
    <mesh position={[0, CONVEYOR_VISUAL_SURFACE_Y_M, 0]}>
      <boxGeometry args={[0.86, 0.035, CONVEYOR_VISUAL_WIDTH_M]} />
      <meshStandardMaterial color={color} transparent opacity={0.22} emissive={color} emissiveIntensity={0.35} />
    </mesh>
    <lineSegments position={[0, CONVEYOR_VISUAL_SURFACE_Y_M / 2, 0]}><edgesGeometry args={[new THREE.BoxGeometry(0.96, CONVEYOR_VISUAL_SURFACE_Y_M, CONVEYOR_VISUAL_WIDTH_M)]} /><lineBasicMaterial color={color} transparent opacity={0.9} /></lineSegments>
  </group>
}

function PreviewVolume({ footprint, height, color, visualScale }: { footprint: { w: number; d: number }; height: number; color: string; visualScale: number }) {
  return <mesh position={[0, height * visualScale / 2, 0]}><boxGeometry args={[footprint.w * visualScale, height * visualScale, footprint.d * visualScale]} /><meshStandardMaterial color={color} transparent opacity={0.42} roughness={0.3} metalness={0.3} /></mesh>
}

function pathRotation(path: GridPos[], index: number, fallback: Rotation): Rotation {
  const current = path[index]
  const next = path[index + 1] ?? path[index - 1]
  if (!current || !next) return fallback
  const forward = index < path.length - 1
  return dirToRotation({ dx: forward ? next.x - current.x : current.x - next.x, dz: forward ? next.z - current.z : current.z - next.z })
}

function rotationAngle(rotation: Rotation) {
  return rotation === 90 ? -Math.PI / 2 : rotation === 180 ? Math.PI : rotation === 270 ? Math.PI / 2 : 0
}
