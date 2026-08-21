import type { FactoryFloorId, FactoryObject, Footprint, GridPos, PortSide, Rotation } from './types'
import { BUILD_BOUND, getObjectDef } from './types'
import { rotationToDir } from './dir'
import { inclineInputCell, inclineOutputCell, inclineProjectionCells, isInclineConveyorType } from './inclineConveyor'
import { portMarkerOutwardDistance } from '../scene/industrialVisualScale'

/** 世界坐标 = 格坐标（1 格 = 1 米，格锚点在格中心） */
export function gridToWorld(g: GridPos): { x: number; z: number } {
  return { x: g.x + 0.5, z: g.z + 0.5 }
}

/** The visual anchor for a footprint is its geometric centre, not its min corner. */
export function objectToWorld(obj: Pick<FactoryObject, 'type' | 'resourceId' | 'pos' | 'rotation' | 'incline'>): { x: number; z: number } {
  if (isInclineConveyorType(obj.type) && obj.incline) {
    return {
      x: (obj.incline.lowPos.x + obj.incline.highPos.x) / 2 + 0.5,
      z: (obj.incline.lowPos.z + obj.incline.highPos.z) / 2 + 0.5,
    }
  }
  const fp = rotatedFootprint(getObjectDef(obj.type, obj.resourceId).footprint, obj.rotation)
  return { x: obj.pos.x + fp.w / 2, z: obj.pos.z + fp.d / 2 }
}

/** 旋转后足迹（0/180 不变，90/270 交换宽深） */
export function rotatedFootprint(f: Footprint, r: Rotation): Footprint {
  return r === 90 || r === 270 ? { w: f.d, d: f.w } : f
}

/** 对象占用的所有格坐标 */
export function occupiedCells(obj: FactoryObject): GridPos[] {
  if (isInclineConveyorType(obj.type) && obj.incline) return inclineProjectionCells(obj.incline)
  const def = getObjectDef(obj.type, obj.resourceId)
  const fp = rotatedFootprint(def.footprint, obj.rotation)
  const cells: GridPos[] = []
  for (let dx = 0; dx < fp.w; dx++) {
    for (let dz = 0; dz < fp.d; dz++) {
      cells.push({ x: obj.pos.x + dx, z: obj.pos.z + dz })
    }
  }
  return cells
}

/** 是否越出建造区边界 */
export function isOutOfBounds(pos: GridPos, fp: Footprint): boolean {
  const minX = pos.x
  const minZ = pos.z
  const maxX = pos.x + fp.w - 1
  const maxZ = pos.z + fp.d - 1
  return (
    minX < -BUILD_BOUND ||
    maxX > BUILD_BOUND ||
    minZ < -BUILD_BOUND ||
    maxZ > BUILD_BOUND
  )
}

/** 两组格是否重叠（用于碰撞） */
export function cellsOverlap(a: GridPos[], b: GridPos[]): boolean {
  const key = (c: GridPos) => `${c.x},${c.z}`
  const set = new Set(a.map(key))
  return b.some((c) => set.has(key(c)))
}

/**
 * 放置合法性：界内 + 不与其它对象碰撞。
 * @param pos 锚点格（最小角）
 * @param type 类型
 * @param rotation 旋转
 * @param others 已存在的对象（不含自身）
 */
export function canPlace(
  pos: GridPos,
  type: FactoryObject['type'],
  rotation: Rotation,
  others: FactoryObject[],
  resourceId?: string,
): boolean {
  const def = getObjectDef(type, resourceId)
  const fp = rotatedFootprint(def.footprint, rotation)
  if (isOutOfBounds(pos, fp)) return false
  const cells = occupiedCells({ id: '', type, resourceId, pos, rotation })
  return !others.some((o) => cellsOverlap(cells, occupiedCells(o)))
}

/** Returns the first grid cell immediately outside a machine's named port. */
export function objectPortCell(
  obj: Pick<FactoryObject, 'type' | 'resourceId' | 'pos' | 'rotation'>,
  port: 'input' | 'output',
): GridPos | null {
  return objectPortCells(obj, port)[0] ?? null
}

/** Returns all external cells for a named port. Splitters and mergers expose multiple ports. */
export function objectPortCells(
  obj: Pick<FactoryObject, 'type' | 'resourceId' | 'pos' | 'rotation' | 'incline' | 'portConfig' | 'stationProgram'>,
  port: 'input' | 'output',
): GridPos[] {
  if (isInclineConveyorType(obj.type) && obj.incline) {
    return [port === 'input' ? inclineInputCell(obj) : inclineOutputCell(obj)]
  }
  const def = getObjectDef(obj.type, obj.resourceId)
  if (obj.type === 'source') {
    const mode = obj.stationProgram?.mode ?? 'pickup'
    if ((mode === 'pickup' && port === 'input') || (mode === 'store' && port === 'output')) return []
    return sourceFrontInterfaceCells(obj)
  }
  const side = port === 'input' ? def.inputPort : def.outputPort
  if (!side) return []

  const cells = portCellsBySide(obj)
  if (obj.type === 'splitter') return port === 'output' ? [...cells.front, ...cells.left, ...cells.right] : cells.back
  if (obj.type === 'merger') return port === 'input' ? [...cells.back, ...cells.left, ...cells.right] : cells.front
  // The robotic assembly cell is fed from three independent dock faces. This
  // prevents one saturated material lane from blocking the other BOM inputs.
  if (obj.type === 'assembler' && port === 'input') return selectEvenly(assemblyDockCells(obj), obj.portConfig?.inputCount ?? 3)
  if (obj.type === 'assembler' && port === 'output') return selectEvenly(fullPortCellsBySide(obj).front, obj.portConfig?.outputCount ?? 1)
  if (obj.type === 'machine') {
    const count = port === 'input' ? def.inputPortCount ?? 1 : def.outputPortCount ?? 1
    return selectEvenly(fullPortCellsBySide(obj)[side], count)
  }
  // A single conveyor segment can be the corner of a Manhattan drag route.
  // Its output remains directional, while the inlet may arrive from either
  // side of the segment as well as from the conventional back port.
  if (obj.type === 'conveyor' && port === 'input') return [...cells.back, ...cells.left, ...cells.right]
  return cells[side]
}

/** Returns the external grid cells for one named side of a port. */
export function objectPortCellsForSide(
  obj: Pick<FactoryObject, 'type' | 'resourceId' | 'pos' | 'rotation' | 'incline' | 'portConfig' | 'stationProgram'>,
  port: 'input' | 'output',
  side: PortSide,
): GridPos[] {
  const def = getObjectDef(obj.type, obj.resourceId)
  if (obj.type === 'source') {
    const mode = obj.stationProgram?.mode ?? 'pickup'
    const enabled = (mode === 'pickup' && port === 'output') || (mode === 'store' && port === 'input')
    return enabled && side === 'front' ? sourceFrontInterfaceCells(obj) : []
  }
  const declaredSide = port === 'input' ? def.inputPort : def.outputPort
  if (!declaredSide) return []
  if (obj.type === 'splitter' && port === 'input' && side !== 'back') return []
  if (obj.type === 'splitter' && port === 'output' && !['front', 'left', 'right'].includes(side)) return []
  if (obj.type === 'merger' && port === 'output' && side !== 'front') return []
  if (obj.type === 'merger' && port === 'input' && !['back', 'left', 'right'].includes(side)) return []
  if (obj.type === 'assembler' && port === 'input' && !['back', 'left', 'right'].includes(side)) return []
  if (obj.type !== 'splitter' && obj.type !== 'merger' && obj.type !== 'conveyor' && obj.type !== 'assembler' && side !== declaredSide) return []
  if (obj.type === 'conveyor' && port === 'output' && side !== declaredSide) return []
  if (obj.type === 'conveyor' && port === 'input' && !['back', 'left', 'right'].includes(side)) return []
  const cells = portCellsBySide(obj)[side]
  if (obj.type === 'assembler') return objectPortCells(obj, port).filter((cell) => fullPortCellsBySide(obj)[side].some((candidate) => candidate.x === cell.x && candidate.z === cell.z))
  if (obj.type === 'machine') return side === declaredSide ? objectPortCells(obj, port) : []
  return cells
}

function portSideDirection(rotation: Rotation, side: PortSide): { dx: number; dz: number } {
  const forward = rotationToDir(rotation)
  const left = { dx: -forward.dz, dz: forward.dx }
  if (side === 'front') return forward
  if (side === 'back') return { dx: -forward.dx, dz: -forward.dz }
  if (side === 'left') return left
  return { dx: -left.dx, dz: -left.dz }
}

function uniqueCells(cells: GridPos[]): GridPos[] {
  return Array.from(new Map(cells.map((cell) => [`${cell.x},${cell.z}`, cell])).values())
}

/**
 * Grid cells occupied by the visible blue/yellow interface beacons. Production
 * models are intentionally larger than their collision footprints, so these
 * cells may sit several metres beyond the legacy edge-adjacent topology.
 */
export function objectInterfacePortCellsForSide(
  obj: Pick<FactoryObject, 'type' | 'resourceId' | 'pos' | 'rotation' | 'incline' | 'portConfig' | 'stationProgram'>,
  port: 'input' | 'output',
  side: PortSide,
): GridPos[] {
  const topologyCells = objectPortCellsForSide(obj, port, side)
  if (topologyCells.length === 0 || isInclineConveyorType(obj.type)) return topologyCells

  const centre = objectToWorld(obj)
  const direction = portSideDirection(obj.rotation, side)
  const footprint = getObjectDef(obj.type, obj.resourceId).footprint
  const bodyHalfExtent = side === 'front' || side === 'back' ? footprint.w / 2 : footprint.d / 2
  return uniqueCells(topologyCells.map((cell) => {
    const world = gridToWorld(cell)
    const topologyDistance = (world.x - centre.x) * direction.dx + (world.z - centre.z) * direction.dz
    const markerDistance = portMarkerOutwardDistance(obj.type, bodyHalfExtent, topologyDistance)
    return {
      x: Math.floor(world.x + direction.dx * (markerDistance - topologyDistance)),
      z: Math.floor(world.z + direction.dz * (markerDistance - topologyDistance)),
    }
  }))
}

/** Visible interface cells used by new placement, previews and live routing. */
export function objectInterfacePortCells(
  obj: Pick<FactoryObject, 'type' | 'resourceId' | 'pos' | 'rotation' | 'incline' | 'portConfig' | 'stationProgram'>,
  port: 'input' | 'output',
): GridPos[] {
  return uniqueCells((['front', 'back', 'left', 'right'] as const)
    .flatMap((side) => objectInterfacePortCellsForSide(obj, port, side)))
}

/** Accept old edge-adjacent saves while treating the visible beacon as truth. */
export function objectCompatiblePortCells(
  obj: Pick<FactoryObject, 'type' | 'resourceId' | 'pos' | 'rotation' | 'incline' | 'portConfig' | 'stationProgram'>,
  port: 'input' | 'output',
): GridPos[] {
  const current = objectPortCells(obj, port)
  const legacySourceLane = obj.type === 'source' && current.length > 0
    ? portCellsBySide(obj).front.slice(0, 1)
    : []
  return uniqueCells([...objectInterfacePortCells(obj, port), ...current, ...legacySourceLane])
}

/**
 * Keep the station's single front port on the same local lane as its embedded
 * conveyor. World-space sorting reverses that lane at 90° and 180°.
 */
function sourceFrontInterfaceCells(
  obj: Pick<FactoryObject, 'type' | 'resourceId' | 'pos' | 'rotation' | 'incline' | 'portConfig' | 'stationProgram'>,
): GridPos[] {
  const front = portCellsBySide(obj).front
  if (front.length === 0) return []
  const index = obj.rotation === 90 || obj.rotation === 180 ? front.length - 1 : 0
  return [front[index]]
}

function portCellsBySide(
  obj: Pick<FactoryObject, 'type' | 'resourceId' | 'pos' | 'rotation' | 'incline' | 'portConfig' | 'stationProgram'>,
): Record<PortSide, GridPos[]> {
  const def = getObjectDef(obj.type, obj.resourceId)
  const fp = rotatedFootprint(def.footprint, obj.rotation)
  const forward = rotationToDir(obj.rotation)
  const sideDir = { dx: -forward.dz, dz: forward.dx }

  const central = (length: number): number[] => {
    const middle = Math.floor(length / 2)
    // An even-sized footprint has two equally central lanes. Accept both so
    // a belt can be routed through either middle row/column of a large cell.
    return length % 2 === 0 ? [middle - 1, middle] : [middle]
  }
  const xMiddle = central(fp.w)
  const zMiddle = central(fp.d)
  const minX = obj.pos.x
  const maxX = obj.pos.x + fp.w - 1
  const minZ = obj.pos.z
  const maxZ = obj.pos.z + fp.d - 1
  const edge = (dir: { dx: number; dz: number }, distance: number, varying: number[]): GridPos[] => varying.map((value) => ({
    x: (dir.dx * distance !== 0 ? (dir.dx > 0 ? maxX + 1 : minX - 1) : obj.pos.x + value),
    z: (dir.dz * distance !== 0 ? (dir.dz > 0 ? maxZ + 1 : minZ - 1) : obj.pos.z + value),
  }))

  const front = forward.dx !== 0
    ? edge(forward, 1, zMiddle)
    : edge(forward, 1, xMiddle)
  const back = forward.dx !== 0
    ? edge({ dx: -forward.dx, dz: -forward.dz }, 1, zMiddle)
    : edge({ dx: -forward.dx, dz: -forward.dz }, 1, xMiddle)
  const left = sideDir.dx !== 0
    ? edge(sideDir, 1, zMiddle)
    : edge(sideDir, 1, xMiddle)
  const right = sideDir.dx !== 0
    ? edge({ dx: -sideDir.dx, dz: -sideDir.dz }, 1, zMiddle)
    : edge({ dx: -sideDir.dx, dz: -sideDir.dz }, 1, xMiddle)
  return { front, back, left, right }
}

/** Every external cell along each physical side, used by configurable ports. */
function fullPortCellsBySide(
  obj: Pick<FactoryObject, 'type' | 'resourceId' | 'pos' | 'rotation'>,
): Record<PortSide, GridPos[]> {
  const def = getObjectDef(obj.type, obj.resourceId)
  const fp = rotatedFootprint(def.footprint, obj.rotation)
  const forward = rotationToDir(obj.rotation)
  const left = { dx: -forward.dz, dz: forward.dx }
  const occupied = occupiedCells({ id: '', ...obj })
  const occupiedSet = new Set(occupied.map((cell) => `${cell.x},${cell.z}`))
  const side = (direction: { dx: number; dz: number }) => occupied
    .filter((cell) => !occupiedSet.has(`${cell.x + direction.dx},${cell.z + direction.dz}`))
    .map((cell) => ({ x: cell.x + direction.dx, z: cell.z + direction.dz }))
    .sort((a, b) => forward.dx !== 0 ? a.z - b.z : a.x - b.x)
  void fp
  return {
    front: side(forward),
    back: side({ dx: -forward.dx, dz: -forward.dz }),
    left: side(left),
    right: side({ dx: -left.dx, dz: -left.dz }),
  }
}

function selectEvenly(cells: GridPos[], count: number): GridPos[] {
  const take = Math.max(0, Math.min(cells.length, Math.round(count)))
  if (take === 0) return []
  if (take === cells.length) return cells
  const indices = Array.from({ length: take }, (_, index) => Math.round(((index + 1) * (cells.length + 1)) / (take + 1) - 1))
  return Array.from(new Set(indices)).map((index) => cells[Math.max(0, Math.min(cells.length - 1, index))])
}

/** All rear/side edge cells of the 3x3 robotic cell are valid line-side docks. */
function assemblyDockCells(obj: Pick<FactoryObject, 'type' | 'resourceId' | 'pos' | 'rotation'>): GridPos[] {
  const forward = rotationToDir(obj.rotation)
  const left = { dx: -forward.dz, dz: forward.dx }
  const directions = [
    { dx: -forward.dx, dz: -forward.dz },
    left,
    { dx: -left.dx, dz: -left.dz },
  ]
  const occupied = occupiedCells({ id: '', ...obj })
  const occupiedSet = new Set(occupied.map((cell) => `${cell.x},${cell.z}`))
  const docks = directions.flatMap((direction) => occupied
    .filter((cell) => !occupiedSet.has(`${cell.x + direction.dx},${cell.z + direction.dz}`))
    .map((cell) => ({ x: cell.x + direction.dx, z: cell.z + direction.dz })))
  return Array.from(new Map(docks.map((cell) => [`${cell.x},${cell.z}`, cell])).values())
}

export function portWorldOffset(
  obj: Pick<FactoryObject, 'type' | 'resourceId' | 'pos' | 'rotation'>,
  port: 'input' | 'output',
  side?: PortSide,
): { x: number; z: number } | null {
  const cells = side ? objectPortCellsForSide(obj, port, side) : objectPortCells(obj, port)
  if (cells.length === 0) return null
  const centre = objectToWorld(obj)
  const world = cells.reduce((sum, cell) => {
    const point = gridToWorld(cell)
    return { x: sum.x + point.x / cells.length, z: sum.z + point.z / cells.length }
  }, { x: 0, z: 0 })
  return { x: world.x - centre.x, z: world.z - centre.z }
}

/** 占用格去重合并（用于碰撞加速，MVP 直接线性扫） */
export function allOccupied(objects: FactoryObject[]): GridPos[] {
  return objects.flatMap(occupiedCells)
}

/** Snap a dragged conveyor endpoint to the nearest free blue/yellow port cell. */
export function snapConveyorCellToObjectPort(pos: GridPos, floorId: number, objects: readonly FactoryObject[]): GridPos {
  const occupied = new Set(objects.filter((object) => (object.floorId ?? 1) === floorId).flatMap(occupiedCells).map((cell) => `${cell.x},${cell.z}`))
  const candidates = objects
    .filter((object) => (object.floorId ?? 1) === floorId && object.type !== 'conveyor' && !isInclineConveyorType(object.type))
    .flatMap((object) => [...objectInterfacePortCells(object, 'input'), ...objectInterfacePortCells(object, 'output')])
    .filter((cell) => !occupied.has(`${cell.x},${cell.z}`))
    .map((cell) => ({ cell, distance: Math.hypot(cell.x - pos.x, cell.z - pos.z) }))
    .filter((entry) => entry.distance <= 1.5)
    .sort((left, right) => left.distance - right.distance || left.cell.x - right.cell.x || left.cell.z - right.cell.z)
  return candidates[0]?.cell ?? pos
}

export type StationRackSide = 'back' | 'left' | 'right'

export interface StationRackDock {
  side: StationRackSide
  /** Minimum-corner anchor of the complete 2x2 cargo-rack footprint. */
  anchor: GridPos
  cells: GridPos[]
}

const STATION_RACK_SNAP_DISTANCE = 2.25

function directionForSide(rotation: Rotation, side: StationRackSide): { dx: number; dz: number } {
  const forward = rotationToDir(rotation)
  const left = { dx: -forward.dz, dz: forward.dx }
  if (side === 'back') return { dx: -forward.dx, dz: -forward.dz }
  return side === 'left' ? left : { dx: -left.dx, dz: -left.dz }
}

/** Exact 2x2 rack footprints exposed by a cargo access station. */
export function stationRackDocks(
  station: Pick<FactoryObject, 'type' | 'resourceId' | 'pos' | 'rotation'>,
): StationRackDock[] {
  if (station.type !== 'source') return []
  const fullSides = fullPortCellsBySide(station)
  return (['back', 'left', 'right'] as const).map((side) => {
    const edge = fullSides[side]
    const start = Math.max(0, Math.floor((edge.length - 2) / 2))
    const contact = edge.slice(start, start + 2)
    const outward = directionForSide(station.rotation, side)
    const cells = [...contact, ...contact.map((cell) => ({ x: cell.x + outward.dx, z: cell.z + outward.dz }))]
    return {
      side,
      cells,
      anchor: {
        x: Math.min(...cells.map((cell) => cell.x)),
        z: Math.min(...cells.map((cell) => cell.z)),
      },
    }
  })
}

export function isCargoStorageRack(object: Pick<FactoryObject, 'type'>): boolean {
  // `storage` is retained for migrated v1-v4 projects; newly built racks use
  // oreMiner and both share the merged cargo-rack behavior.
  return object.type === 'oreMiner' || object.type === 'storage'
}

function hasExactCells(object: FactoryObject, cells: readonly GridPos[]): boolean {
  const actual = occupiedCells(object)
  if (actual.length !== cells.length) return false
  const expected = new Set(cells.map((cell) => `${cell.x},${cell.z}`))
  return actual.every((cell) => expected.has(`${cell.x},${cell.z}`))
}

/** Actual station-side to rack-object topology; distance alone never connects. */
export function stationRackConnections(
  station: Pick<FactoryObject, 'id' | 'type' | 'resourceId' | 'pos' | 'rotation' | 'floorId'>,
  objects: readonly FactoryObject[],
): Partial<Record<StationRackSide, FactoryObject>> {
  const result: Partial<Record<StationRackSide, FactoryObject>> = {}
  for (const dock of stationRackDocks(station)) {
    const rack = objects.find((object) => object.id !== station.id
      && (object.floorId ?? 1) === (station.floorId ?? 1)
      && isCargoStorageRack(object)
      && hasExactCells(object, dock.cells))
    if (rack) result[dock.side] = rack
  }
  return result
}

/** Bidirectional placement snap between access stations and 2x2 cargo racks. */
export function snapCargoStoragePlacement(
  pos: GridPos,
  type: FactoryObject['type'],
  rotation: Rotation,
  floorId: FactoryFloorId,
  objects: readonly FactoryObject[],
): GridPos {
  const floorObjects = objects.filter((object) => (object.floorId ?? 1) === floorId)
  const candidates: GridPos[] = []
  if (isCargoStorageRack({ type })) {
    for (const station of floorObjects.filter((object) => object.type === 'source')) {
      for (const dock of stationRackDocks(station)) {
        if (canPlace(dock.anchor, type, rotation, [...objects])) candidates.push(dock.anchor)
      }
    }
  } else if (type === 'source') {
    const prototype: FactoryObject = { id: '__station-snap__', type: 'source', pos: { x: 0, z: 0 }, rotation, floorId }
    for (const rack of floorObjects.filter(isCargoStorageRack)) {
      for (const dock of stationRackDocks(prototype)) {
        const candidate = { x: rack.pos.x - dock.anchor.x, z: rack.pos.z - dock.anchor.z }
        if (canPlace(candidate, type, rotation, [...objects])) candidates.push(candidate)
      }
    }
  }
  const nearest = candidates
    .map((candidate) => ({ candidate, distance: Math.hypot(candidate.x - pos.x, candidate.z - pos.z) }))
    .filter((entry) => entry.distance <= STATION_RACK_SNAP_DISTANCE)
    .sort((left, right) => left.distance - right.distance || left.candidate.x - right.candidate.x || left.candidate.z - right.candidate.z)[0]
  return nearest?.candidate ?? pos
}
