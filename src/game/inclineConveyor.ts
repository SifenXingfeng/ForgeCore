import { rotationToDir } from './dir'
import { BUILD_BOUND, getObjectDef } from './types'
import type { BuildType, FactoryFloorId, FactoryObject, GridPos, InclineConveyorConfig, Rotation } from './types'
import { FLOOR_HEIGHT_M, INCLINE_CONVEYOR_LENGTH_M, INCLINE_CONVEYOR_RUN_M, MAX_FACTORY_FLOORS } from './floorConfig'

export type InclineConveyorType = 'inclineUp' | 'inclineDown'

export interface InclineInterface {
  role: 'input' | 'output'
  floorId: FactoryFloorId
  cell: GridPos
  travelRotation: Rotation
}

export interface InclinePlacementSnap {
  lowPos: GridPos
  uphillRotation: Rotation
  snapped: boolean
  interfaceRole?: InclineInterface['role']
  conveyorId?: string
}

export function isInclineConveyorType(type: BuildType): type is InclineConveyorType {
  return type === 'inclineUp' || type === 'inclineDown'
}

export function createInclineConfig(lowPos: GridPos, uphillRotation: Rotation, lowerFloorId: FactoryFloorId): InclineConveyorConfig | null {
  if (!Number.isInteger(lowerFloorId) || lowerFloorId < 1 || lowerFloorId >= MAX_FACTORY_FLOORS) return null
  const direction = rotationToDir(uphillRotation)
  const runCells = Math.round(INCLINE_CONVEYOR_RUN_M)
  return {
    direction: 'up',
    lowerFloorId,
    upperFloorId: lowerFloorId + 1,
    lowPos: { ...lowPos },
    highPos: { x: lowPos.x + direction.dx * runCells, z: lowPos.z + direction.dz * runCells },
    riseM: FLOOR_HEIGHT_M,
    runM: INCLINE_CONVEYOR_RUN_M,
  }
}

export function createInclineObject(
  id: string,
  type: InclineConveyorType,
  lowPos: GridPos,
  uphillRotation: Rotation,
  lowerFloorId: FactoryFloorId,
): FactoryObject | null {
  const incline = createInclineConfig(lowPos, uphillRotation, lowerFloorId)
  if (!incline) return null
  incline.direction = type === 'inclineUp' ? 'up' : 'down'
  const downRotation = oppositeRotation(uphillRotation)
  return {
    id,
    type,
    pos: incline.direction === 'up' ? { ...incline.lowPos } : { ...incline.highPos },
    rotation: incline.direction === 'up' ? uphillRotation : downRotation,
    floorId: incline.direction === 'up' ? incline.lowerFloorId : incline.upperFloorId,
    incline,
  }
}

export function inclineProjectionCells(config: InclineConveyorConfig): GridPos[] {
  const dx = Math.sign(config.highPos.x - config.lowPos.x)
  const dz = Math.sign(config.highPos.z - config.lowPos.z)
  const steps = Math.max(Math.abs(config.highPos.x - config.lowPos.x), Math.abs(config.highPos.z - config.lowPos.z))
  return Array.from({ length: steps + 1 }, (_, index) => ({
    x: config.lowPos.x + dx * index,
    z: config.lowPos.z + dz * index,
  }))
}

export function inclineTouchesFloor(object: Pick<FactoryObject, 'type' | 'floorId' | 'incline'>, floorId: FactoryFloorId): boolean {
  if (!isInclineConveyorType(object.type) || !object.incline) return (object.floorId ?? 1) === floorId
  return object.incline.lowerFloorId === floorId || object.incline.upperFloorId === floorId
}

export function objectsTouchingFloor(objects: FactoryObject[], floorId: FactoryFloorId): FactoryObject[] {
  return objects.filter((object) => inclineTouchesFloor(object, floorId))
}

export function inclineStartFloor(object: Pick<FactoryObject, 'floorId' | 'incline'>): FactoryFloorId {
  return object.incline?.direction === 'down' ? object.incline.upperFloorId : object.incline?.lowerFloorId ?? object.floorId ?? 1
}

export function inclineTargetFloor(object: Pick<FactoryObject, 'floorId' | 'incline'>): FactoryFloorId {
  return object.incline?.direction === 'down' ? object.incline.lowerFloorId : object.incline?.upperFloorId ?? object.floorId ?? 1
}

export function inclineStartCell(object: Pick<FactoryObject, 'pos' | 'incline'>): GridPos {
  if (!object.incline) return object.pos
  return object.incline.direction === 'up' ? object.incline.lowPos : object.incline.highPos
}

export function inclineEndCell(object: Pick<FactoryObject, 'pos' | 'incline'>): GridPos {
  if (!object.incline) return object.pos
  return object.incline.direction === 'up' ? object.incline.highPos : object.incline.lowPos
}

export function inclineInputCell(object: Pick<FactoryObject, 'pos' | 'rotation' | 'incline'>): GridPos {
  const start = inclineStartCell(object)
  const direction = rotationToDir(object.rotation)
  return { x: start.x - direction.dx, z: start.z - direction.dz }
}

export function inclineOutputCell(object: Pick<FactoryObject, 'pos' | 'rotation' | 'incline'>): GridPos {
  const end = inclineEndCell(object)
  const direction = rotationToDir(object.rotation)
  return { x: end.x + direction.dx, z: end.z + direction.dz }
}

/** Exact normal-conveyor cells exposed by both ends of an incline. */
export function inclineInterfaces(object: Pick<FactoryObject, 'pos' | 'rotation' | 'floorId' | 'incline'>): InclineInterface[] {
  return [
    {
      role: 'input',
      floorId: inclineStartFloor(object),
      cell: inclineInputCell(object),
      travelRotation: object.rotation,
    },
    {
      role: 'output',
      floorId: inclineTargetFloor(object),
      cell: inclineOutputCell(object),
      travelRotation: object.rotation,
    },
  ]
}

/**
 * Pull an incline's low anchor onto a compatible normal belt when the pointer
 * is within a small grid radius. Rotation remains user-controlled; only belts
 * that already travel in the incline's material direction can claim the snap.
 */
export function snapInclinePlacement(
  pointerLowPos: GridPos,
  type: InclineConveyorType,
  uphillRotation: Rotation,
  lowerFloorId: FactoryFloorId,
  objects: FactoryObject[],
  maxDistanceCells = 2,
): InclinePlacementSnap {
  const preview = createInclineObject('__incline-snap__', type, pointerLowPos, uphillRotation, lowerFloorId)
  if (!preview?.incline) return { lowPos: pointerLowPos, uphillRotation, snapped: false }

  const candidates = objects.flatMap((conveyor) => {
    if (conveyor.type !== 'conveyor' || conveyor.rotation !== preview.rotation) return []
    return inclineInterfaces(preview).flatMap((connection) => {
      if ((conveyor.floorId ?? 1) !== connection.floorId) return []
      const shift = {
        x: conveyor.pos.x - connection.cell.x,
        z: conveyor.pos.z - connection.cell.z,
      }
      const distance = Math.abs(shift.x) + Math.abs(shift.z)
      if (distance > maxDistanceCells) return []
      const lowPos = { x: pointerLowPos.x + shift.x, z: pointerLowPos.z + shift.z }
      if (!canPlaceIncline(lowPos, type, uphillRotation, lowerFloorId, objects)) return []
      return [{ lowPos, distance, connection, conveyor }]
    })
  }).sort((left, right) => left.distance - right.distance || left.conveyor.id.localeCompare(right.conveyor.id))

  const best = candidates[0]
  return best
    ? { lowPos: best.lowPos, uphillRotation, snapped: true, interfaceRole: best.connection.role, conveyorId: best.conveyor.id }
    : { lowPos: pointerLowPos, uphillRotation, snapped: false }
}

/** Snap a normal belt stroke onto the nearest exposed incline interface. */
export function snapConveyorCellToIncline(
  pointer: GridPos,
  floorId: FactoryFloorId,
  objects: FactoryObject[],
  maxDistanceCells = 1,
): GridPos {
  const candidates = objects.flatMap((object) => {
    if (!isInclineConveyorType(object.type) || !object.incline) return []
    return inclineInterfaces(object).flatMap((connection) => {
      if (connection.floorId !== floorId) return []
      const distance = Math.abs(connection.cell.x - pointer.x) + Math.abs(connection.cell.z - pointer.z)
      return distance <= maxDistanceCells ? [{ cell: connection.cell, distance, objectId: object.id, role: connection.role }] : []
    })
  }).sort((left, right) => left.distance - right.distance || left.objectId.localeCompare(right.objectId) || left.role.localeCompare(right.role))
  return candidates[0] ? { ...candidates[0].cell } : pointer
}

export function inclineTravelLength(object: Pick<FactoryObject, 'incline'>): number {
  return object.incline ? Math.hypot(object.incline.runM, object.incline.riseM) : INCLINE_CONVEYOR_LENGTH_M
}

export function canPlaceIncline(
  lowPos: GridPos,
  type: InclineConveyorType,
  uphillRotation: Rotation,
  lowerFloorId: FactoryFloorId,
  objects: FactoryObject[],
): boolean {
  const candidate = createInclineObject('__incline-preview__', type, lowPos, uphillRotation, lowerFloorId)
  if (!candidate?.incline) return false
  const projection = inclineProjectionCells(candidate.incline)
  if (projection.some((cell) => cell.x < -BUILD_BOUND || cell.x > BUILD_BOUND || cell.z < -BUILD_BOUND || cell.z > BUILD_BOUND)) return false

  return ![candidate.incline.lowerFloorId, candidate.incline.upperFloorId].some((floorId) => objects.some((object) => {
    if (!inclineTouchesFloor(object, floorId)) return false
    const occupied = object.incline ? inclineProjectionCells(object.incline) : regularOccupiedCells(object)
    return overlaps(projection, occupied)
  }))
}

function regularOccupiedCells(object: FactoryObject): GridPos[] {
  const def = getObjectDef(object.type, object.resourceId)
  const footprint = object.rotation === 90 || object.rotation === 270
    ? { w: def.footprint.d, d: def.footprint.w }
    : def.footprint
  const cells: GridPos[] = []
  for (let x = 0; x < footprint.w; x += 1) {
    for (let z = 0; z < footprint.d; z += 1) cells.push({ x: object.pos.x + x, z: object.pos.z + z })
  }
  return cells
}

function overlaps(left: GridPos[], right: GridPos[]): boolean {
  const keys = new Set(left.map((cell) => `${cell.x}:${cell.z}`))
  return right.some((cell) => keys.has(`${cell.x}:${cell.z}`))
}

function oppositeRotation(rotation: Rotation): Rotation {
  return ((rotation + 180) % 360) as Rotation
}
