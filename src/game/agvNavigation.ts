import { BUILD_BOUND, getObjectDef, type FactoryObject } from './types'
import { occupiedCells, rotatedFootprint } from './grid'

export interface AgvNavigationPoint {
  x: number
  z: number
}

export interface AgvDynamicObstacle {
  position: AgvNavigationPoint
  /** Center-to-edge safety radius in world/grid meters. */
  radius?: number
}

const CLEARANCE_CELLS = 1
/**
 * Measured from the ForgeCore AGV body after the renderer's 1.35m height
 * normalization: roughly 1.60m x 1.23m. Keep navigation aligned with the
 * visible vehicle instead of the larger 2m catalogue grid footprint.
 */
export const AGV_MODEL_FOOTPRINT = { w: 1.60, d: 1.23 }
export const AGV_BODY_HALF_WIDTH = AGV_MODEL_FOOTPRINT.w / 2
export const AGV_BODY_HALF_DEPTH = AGV_MODEL_FOOTPRINT.d / 2
export const AGV_NAV_RADIUS = AGV_BODY_HALF_WIDTH + 0.05
export const AGV_CENTER_CLEARANCE = AGV_NAV_RADIUS * 2
export const AGV_DOCK_MARGIN = 0.08
const DIRECTIONS = [
  [1, 0], [0, 1], [-1, 0], [0, -1],
  [1, 1], [-1, 1], [-1, -1], [1, -1],
] as const

const key = (x: number, z: number) => `${x},${z}`
const pointToCell = (point: AgvNavigationPoint) => ({ x: Math.round(point.x - 0.5), z: Math.round(point.z - 0.5) })
const cellToPoint = (x: number, z: number): AgvNavigationPoint => ({ x: x + 0.5, z: z + 0.5 })

/**
 * A small deterministic A* navigator for the ground fleet. Facilities receive
 * a one-cell safety envelope; AGVs and drones stay dynamic and do not become
 * permanent walls in the warehouse aisle.
 */
export function findAgvPath(objects: FactoryObject[], start: AgvNavigationPoint, target: AgvNavigationPoint, vehicleId: string, dynamicObstacles: readonly AgvDynamicObstacle[] = []): AgvNavigationPoint[] | null {
  const startCell = pointToCell(start)
  const targetCell = pointToCell(target)
  const dynamicBlocked = createDynamicBlockedCells(dynamicObstacles)
  const blocked = createBlockedCells(objects, vehicleId, dynamicBlocked)
  blocked.delete(key(startCell.x, startCell.z))
  if (!dynamicBlocked.has(key(targetCell.x, targetCell.z))) blocked.delete(key(targetCell.x, targetCell.z))

  const startKey = key(startCell.x, startCell.z)
  const targetKey = key(targetCell.x, targetCell.z)
  const cameFrom = new Map<string, string>()
  const gScore = new Map([[startKey, 0]])
  const fScore = new Map([[startKey, heuristic(startCell.x, startCell.z, targetCell.x, targetCell.z)]])
  const open = new MinHeap()
  open.push({ key: startKey, score: fScore.get(startKey)! })

  while (open.size > 0) {
    const current = open.pop()!
    const currentKey = current.key
    // A node can be queued more than once; stale entries are discarded in O(1).
    if (current.score !== (fScore.get(currentKey) ?? Infinity)) continue
    if (currentKey === targetKey) return simplifyPath(reconstructPath(currentKey, cameFrom))
    const [currentX, currentZ] = currentKey.split(',').map(Number)

    for (const [dx, dz] of DIRECTIONS) {
      const nextX = currentX + dx
      const nextZ = currentZ + dz
      if (!insideBounds(nextX, nextZ) || blocked.has(key(nextX, nextZ))) continue
      if (dx !== 0 && dz !== 0 && (blocked.has(key(currentX + dx, currentZ)) || blocked.has(key(currentX, currentZ + dz)))) continue

      const nextKey = key(nextX, nextZ)
      const tentative = (gScore.get(currentKey) ?? Infinity) + (dx !== 0 && dz !== 0 ? Math.SQRT2 : 1)
      if (tentative >= (gScore.get(nextKey) ?? Infinity)) continue
      cameFrom.set(nextKey, currentKey)
      gScore.set(nextKey, tentative)
      fScore.set(nextKey, tentative + heuristic(nextX, nextZ, targetCell.x, targetCell.z))
      open.push({ key: nextKey, score: fScore.get(nextKey)! })
    }
  }

  return null
}

interface HeapNode {
  key: string
  score: number
}

class MinHeap {
  private values: HeapNode[] = []

  get size() {
    return this.values.length
  }

  push(value: HeapNode) {
    this.values.push(value)
    let index = this.values.length - 1
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2)
      if (this.compare(this.values[parent], value) <= 0) break
      this.values[index] = this.values[parent]
      index = parent
    }
    this.values[index] = value
  }

  pop(): HeapNode | undefined {
    const first = this.values[0]
    const last = this.values.pop()
    if (!first || !last || this.values.length === 0) return first
    let index = 0
    while (true) {
      const left = index * 2 + 1
      const right = left + 1
      let smallest = index
      if (left < this.values.length && this.compare(this.values[left], last) < 0) smallest = left
      if (right < this.values.length && this.compare(this.values[right], smallest === index ? last : this.values[smallest]) < 0) smallest = right
      if (smallest === index) break
      this.values[index] = this.values[smallest]
      index = smallest
    }
    this.values[index] = last
    return first
  }

  private compare(left: HeapNode, right: HeapNode) {
    return left.score - right.score || left.key.localeCompare(right.key)
  }
}

function createBlockedCells(objects: FactoryObject[], vehicleId: string, dynamicBlocked: Set<string>) {
  const blocked = new Set<string>()
  objects.forEach((object) => {
    if (object.id === vehicleId || object.type === 'agv' || object.type === 'drone') return
    occupiedCells(object).forEach((cell) => {
      for (let dx = -CLEARANCE_CELLS; dx <= CLEARANCE_CELLS; dx += 1) {
        for (let dz = -CLEARANCE_CELLS; dz <= CLEARANCE_CELLS; dz += 1) blocked.add(key(cell.x + dx, cell.z + dz))
      }
    })
  })
  dynamicBlocked.forEach((cell) => blocked.add(cell))
  return blocked
}

function createDynamicBlockedCells(obstacles: readonly AgvDynamicObstacle[]) {
  const blocked = new Set<string>()
  obstacles.forEach((obstacle) => {
    const center = pointToCell(obstacle.position)
    // Dynamic vehicles use the measured ForgeCore body envelope plus a small
    // margin. A stopped AGV therefore occupies its visible collision envelope
    // instead of being treated as a single point in the global planner.
    const radius = Math.max(0, Math.ceil((obstacle.radius ?? 0) - 0.25))
    for (let dx = -radius; dx <= radius; dx += 1) {
      for (let dz = -radius; dz <= radius; dz += 1) {
        if (Math.hypot(dx, dz) <= radius + 0.25) blocked.add(key(center.x + dx, center.z + dz))
      }
    }
  })
  return blocked
}

function insideBounds(x: number, z: number) {
  return x >= -BUILD_BOUND && x <= BUILD_BOUND && z >= -BUILD_BOUND && z <= BUILD_BOUND
}

function heuristic(x: number, z: number, targetX: number, targetZ: number) {
  return Math.hypot(targetX - x, targetZ - z)
}

function reconstructPath(goalKey: string, cameFrom: Map<string, string>) {
  const cells: Array<{ x: number; z: number }> = []
  let current: string | undefined = goalKey
  while (current) {
    const [x, z] = current.split(',').map(Number)
    cells.push({ x, z })
    current = cameFrom.get(current)
  }
  return cells.reverse().map((cell) => cellToPoint(cell.x, cell.z))
}

function simplifyPath(path: AgvNavigationPoint[]) {
  if (path.length < 3) return path
  const simplified = [path[0]]
  for (let index = 1; index < path.length - 1; index += 1) {
    const previous = path[index - 1]
    const current = path[index]
    const next = path[index + 1]
    const previousDirection = { x: Math.sign(current.x - previous.x), z: Math.sign(current.z - previous.z) }
    const nextDirection = { x: Math.sign(next.x - current.x), z: Math.sign(next.z - current.z) }
    if (previousDirection.x !== nextDirection.x || previousDirection.z !== nextDirection.z) simplified.push(current)
  }
  simplified.push(path[path.length - 1])
  return simplified
}

export function agvPathLength(path: AgvNavigationPoint[]) {
  return path.slice(1).reduce((total, point, index) => total + Math.hypot(point.x - path[index].x, point.z - path[index].z), 0)
}

/** Return a safe, shared loading point just outside an equipment footprint. */
export function agvDockPoint(object: FactoryObject): AgvNavigationPoint {
  return agvDockCandidates(object)[0]
}

/** Candidate docks let the planner choose the open side when racks are dense. */
export function agvDockCandidates(object: FactoryObject): AgvNavigationPoint[] {
  const footprint = rotatedFootprint(getObjectDef(object.type, object.resourceId).footprint, object.rotation)
  const centerX = object.pos.x + Math.max(0, footprint.w / 2 - 0.5)
  const centerZ = object.pos.z + Math.max(0, footprint.d / 2 - 0.5)
  const dockX = AGV_BODY_HALF_WIDTH + AGV_DOCK_MARGIN
  const dockZ = AGV_BODY_HALF_DEPTH + AGV_DOCK_MARGIN
  return [
    { x: object.pos.x + footprint.w + dockX, z: centerZ },
    { x: object.pos.x - dockX, z: centerZ },
    { x: centerX, z: object.pos.z + footprint.d + dockZ },
    { x: centerX, z: object.pos.z - dockZ },
  ]
}
