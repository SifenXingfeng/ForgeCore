import { getObjectDef, BUILD_BOUND, type FactoryObject } from './types'
import { occupiedCells, rotatedFootprint } from './grid'
import { FLOOR_HEIGHT_M } from './floorConfig'

export interface DroneNavigationPoint {
  x: number
  y: number
  z: number
}

export interface DroneDynamicObstacle {
  position: DroneNavigationPoint
  radius: number
}

export type DroneDockingRole = 'pickup' | 'dropoff'

export const DRONE_CLEARANCE_M = 1.2
export const DRONE_SEPARATION_M = 3
export const DRONE_HOVER_HEIGHT_M = 2.2
export const DRONE_TOP_AIRSPACE_M = 4

const DIRECTIONS: Array<[number, number, number]> = []
for (let dx = -1; dx <= 1; dx += 1) {
  for (let dy = -1; dy <= 1; dy += 1) {
    for (let dz = -1; dz <= 1; dz += 1) {
      if (dx !== 0 || dy !== 0 || dz !== 0) DIRECTIONS.push([dx, dy, dz])
    }
  }
}

interface GridNode {
  x: number
  y: number
  z: number
}

interface HeapEntry {
  key: string
  score: number
  cost: number
}

const key = (x: number, y: number, z: number) => `${x},${y},${z}`
const pointToNode = (point: DroneNavigationPoint): GridNode => ({
  x: Math.round(point.x - 0.5),
  y: Math.round(point.y),
  z: Math.round(point.z - 0.5),
})
const nodeToPoint = (node: GridNode): DroneNavigationPoint => ({ x: node.x + 0.5, y: node.y, z: node.z + 0.5 })

/** Candidate hover points around a facility on its absolute floor datum. */
export function droneDockCandidates(object: FactoryObject, role: DroneDockingRole): DroneNavigationPoint[] {
  const footprint = rotatedFootprint(getObjectDef(object.type, object.resourceId).footprint, object.rotation)
  const floorY = floorElevation(object.floorId ?? 1)
  const hoverY = Math.round(floorY + DRONE_HOVER_HEIGHT_M)
  const centerX = object.pos.x + footprint.w / 2
  const centerZ = object.pos.z + footprint.d / 2
  const margin = Math.ceil(DRONE_CLEARANCE_M + 0.5)
  const candidates = [
    { x: object.pos.x + footprint.w + margin + 0.5, y: hoverY, z: centerZ },
    { x: object.pos.x - margin + 0.5, y: hoverY, z: centerZ },
    { x: centerX, y: hoverY, z: object.pos.z + footprint.d + margin + 0.5 },
    { x: centerX, y: hoverY, z: object.pos.z - margin + 0.5 },
  ]
  const forwardIndex = object.rotation === 0 ? 0 : object.rotation === 90 ? 2 : object.rotation === 180 ? 1 : 3
  const preferred = role === 'pickup' ? forwardIndex : (forwardIndex + 2) % 4
  return [candidates[preferred], ...candidates.filter((_, index) => index !== preferred)]
}

/** Deterministic 26-neighbour three-dimensional A* across all factory floors. */
export function findDronePath(
  objects: FactoryObject[],
  start: DroneNavigationPoint,
  destination: FactoryObject,
  vehicleId: string,
  role: DroneDockingRole,
  dynamicObstacles: readonly DroneDynamicObstacle[] = [],
): DroneNavigationPoint[] | null {
  const startNode = pointToNode(start)
  const highestFloor = Math.max(1, ...objects.flatMap((object) => [object.floorId ?? 1, object.incline?.upperFloorId ?? 1]))
  const maxY = Math.ceil(floorElevation(highestFloor) + DRONE_TOP_AIRSPACE_M)
  const goals = droneDockCandidates(destination, role)
    .map(pointToNode)
    .filter((node) => insideBounds(node, maxY))
  if (goals.length === 0) return null
  const goalKeys = new Set(goals.map((node) => key(node.x, node.y, node.z)))
  const blocked = createBlockedNodes(objects, vehicleId, dynamicObstacles)
  blocked.delete(key(startNode.x, startNode.y, startNode.z))
  goals.forEach((goal) => blocked.delete(key(goal.x, goal.y, goal.z)))

  const startKey = key(startNode.x, startNode.y, startNode.z)
  if (goalKeys.has(startKey)) return [nodeToPoint(startNode)]
  const open = new MinHeap()
  const cameFrom = new Map<string, string>()
  const nodes = new Map<string, GridNode>([[startKey, startNode]])
  const gScore = new Map<string, number>([[startKey, 0]])
  open.push({ key: startKey, cost: 0, score: heuristic(startNode, goals) })

  while (open.size > 0) {
    const currentEntry = open.pop()!
    if (currentEntry.cost !== (gScore.get(currentEntry.key) ?? Infinity)) continue
    const current = nodes.get(currentEntry.key)!
    if (goalKeys.has(currentEntry.key)) return simplifyPath(reconstructPath(currentEntry.key, cameFrom, nodes))

    for (const [dx, dy, dz] of DIRECTIONS) {
      const next = { x: current.x + dx, y: current.y + dy, z: current.z + dz }
      const nextKey = key(next.x, next.y, next.z)
      if (!insideBounds(next, maxY) || blocked.has(nextKey) || !moveClearsCorners(current, dx, dy, dz, blocked)) continue
      const axes = Number(dx !== 0) + Number(dy !== 0) + Number(dz !== 0)
      const cost = axes === 3 ? Math.sqrt(3) : axes === 2 ? Math.SQRT2 : 1
      const tentative = currentEntry.cost + cost
      if (tentative >= (gScore.get(nextKey) ?? Infinity)) continue
      cameFrom.set(nextKey, currentEntry.key)
      nodes.set(nextKey, next)
      gScore.set(nextKey, tentative)
      open.push({ key: nextKey, cost: tentative, score: tentative + heuristic(next, goals) })
    }
  }
  return null
}

export function dronePathLength(path: readonly DroneNavigationPoint[]) {
  return path.slice(1).reduce((sum, point, index) => sum + Math.hypot(point.x - path[index].x, point.y - path[index].y, point.z - path[index].z), 0)
}

function createBlockedNodes(objects: FactoryObject[], vehicleId: string, dynamicObstacles: readonly DroneDynamicObstacle[]) {
  const blocked = new Set<string>()
  const clearanceCells = Math.ceil(DRONE_CLEARANCE_M)
  objects.forEach((object) => {
    if (object.id === vehicleId || object.type === 'drone' || object.type === 'agv' || object.type === 'conveyor' || object.type === 'inclineUp' || object.type === 'inclineDown') return
    const floorY = floorElevation(object.floorId ?? 1)
    const height = navigationHeight(object)
    const minY = Math.max(1, Math.floor(floorY - DRONE_CLEARANCE_M))
    const maxY = Math.ceil(floorY + height + DRONE_CLEARANCE_M)
    occupiedCells(object).forEach((cell) => {
      for (let dx = -clearanceCells; dx <= clearanceCells; dx += 1) {
        for (let dz = -clearanceCells; dz <= clearanceCells; dz += 1) {
          for (let y = minY; y <= maxY; y += 1) blocked.add(key(cell.x + dx, y, cell.z + dz))
        }
      }
    })
  })
  dynamicObstacles.forEach((obstacle) => {
    const center = pointToNode(obstacle.position)
    const radius = Math.ceil(obstacle.radius)
    for (let dx = -radius; dx <= radius; dx += 1) {
      for (let dy = -radius; dy <= radius; dy += 1) {
        for (let dz = -radius; dz <= radius; dz += 1) {
          if (Math.hypot(dx, dy, dz) < obstacle.radius) blocked.add(key(center.x + dx, center.y + dy, center.z + dz))
        }
      }
    }
  })
  return blocked
}

function navigationHeight(object: FactoryObject) {
  const definition = getObjectDef(object.type, object.resourceId)
  const productionScale = definition.role === 'machine' ? 2.5 : 1.25
  return definition.height * productionScale
}

function insideBounds(node: GridNode, maxY: number) {
  return node.x >= -BUILD_BOUND && node.x <= BUILD_BOUND
    && node.z >= -BUILD_BOUND && node.z <= BUILD_BOUND
    && node.y >= 1 && node.y <= maxY
}

const floorElevation = (floorId: number) => (floorId - 1) * FLOOR_HEIGHT_M

function moveClearsCorners(current: GridNode, dx: number, dy: number, dz: number, blocked: ReadonlySet<string>) {
  const axes = [dx, dy, dz].map((value, index) => ({ value, index })).filter((axis) => axis.value !== 0)
  if (axes.length <= 1) return true
  const fullMask = (1 << axes.length) - 1
  for (let mask = 1; mask < fullMask; mask += 1) {
    const delta = [0, 0, 0]
    axes.forEach((axis, index) => {
      if ((mask & (1 << index)) !== 0) delta[axis.index] = axis.value
    })
    if (blocked.has(key(current.x + delta[0], current.y + delta[1], current.z + delta[2]))) return false
  }
  return true
}

function heuristic(node: GridNode, goals: GridNode[]) {
  return Math.min(...goals.map((goal) => {
    const distances = [Math.abs(goal.x - node.x), Math.abs(goal.y - node.y), Math.abs(goal.z - node.z)].sort((left, right) => left - right)
    return distances[0] * Math.sqrt(3) + (distances[1] - distances[0]) * Math.SQRT2 + distances[2] - distances[1]
  }))
}

function reconstructPath(goalKey: string, cameFrom: Map<string, string>, nodes: Map<string, GridNode>) {
  const path: DroneNavigationPoint[] = []
  let current: string | undefined = goalKey
  while (current) {
    const node = nodes.get(current)
    if (!node) break
    path.push(nodeToPoint(node))
    current = cameFrom.get(current)
  }
  return path.reverse()
}

function simplifyPath(path: DroneNavigationPoint[]) {
  if (path.length < 3) return path
  const simplified = [path[0]]
  for (let index = 1; index < path.length - 1; index += 1) {
    const previous = path[index - 1]
    const current = path[index]
    const next = path[index + 1]
    const before = [Math.sign(current.x - previous.x), Math.sign(current.y - previous.y), Math.sign(current.z - previous.z)]
    const after = [Math.sign(next.x - current.x), Math.sign(next.y - current.y), Math.sign(next.z - current.z)]
    if (before.some((value, axis) => value !== after[axis])) simplified.push(current)
  }
  simplified.push(path[path.length - 1])
  return simplified
}

class MinHeap {
  private values: HeapEntry[] = []

  get size() { return this.values.length }

  push(value: HeapEntry) {
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

  pop(): HeapEntry | undefined {
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

  private compare(left: HeapEntry, right: HeapEntry) {
    return left.score - right.score || left.cost - right.cost || left.key.localeCompare(right.key)
  }
}
