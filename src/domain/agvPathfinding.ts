import type { Factory, FactoryObject, Id } from '../types'
import { MinPriorityQueue } from './minPriorityQueue'

export interface AgvNavigationPoint {
  x: number
  z: number
}

export interface AgvDynamicObstacle extends AgvNavigationPoint {
  radiusM: number
}

export interface AgvPathRequest {
  factory: Factory
  objects: FactoryObject[]
  floorId: Id
  vehicleObjectId: Id
  start: AgvNavigationPoint
  destinationObjectId: Id
  dynamicObstacles?: AgvDynamicObstacle[]
}

export interface AgvYieldPathRequest extends Omit<AgvPathRequest, 'destinationObjectId'> {
  avoidPoints: AgvNavigationPoint[]
}

export interface AgvPointPathRequest extends Omit<AgvPathRequest, 'destinationObjectId'> {
  target: AgvNavigationPoint
}

/**
 * The visible AGV is 3.5m wide after the requested 2x scale-up. A 2m
 * conservative half-envelope keeps its body and a 0.25m safety margin clear
 * of facilities, conveyors and the factory boundary without deriving any
 * physical meaning from the vendor mesh.
 */
export const AGV_NAVIGATION_CLEARANCE_M = 2
export const AGV_VEHICLE_SEPARATION_M = 3.8
const AGV_STATIC_GRID_CACHE_LIMIT = 8
const agvStaticGridCache = new Map<string, Set<string>>()

interface GridNode extends AgvNavigationPoint {
  ix: number
  iz: number
}

interface Rect {
  minX: number
  maxX: number
  minZ: number
  maxZ: number
}

const pointKey = (ix: number, iz: number): string => `${ix}:${iz}`

const distanceToSegment = (
  point: AgvNavigationPoint,
  start: AgvNavigationPoint,
  end: AgvNavigationPoint,
): number => {
  const dx = end.x - start.x
  const dz = end.z - start.z
  const lengthSquared = dx * dx + dz * dz
  if (lengthSquared <= 1e-9) return Math.hypot(point.x - start.x, point.z - start.z)
  const t = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.z - start.z) * dz) / lengthSquared))
  return Math.hypot(point.x - (start.x + dx * t), point.z - (start.z + dz * t))
}

const facilityRect = (object: FactoryObject): Rect => ({
  minX: object.transform.x,
  maxX: object.transform.x + object.footprint.width,
  minZ: object.transform.z,
  maxZ: object.transform.z + object.footprint.depth,
})

const nodeInsideInflatedRect = (point: AgvNavigationPoint, rect: Rect, clearanceM: number): boolean =>
  point.x > rect.minX - clearanceM + 1e-6
  && point.x < rect.maxX + clearanceM - 1e-6
  && point.z > rect.minZ - clearanceM + 1e-6
  && point.z < rect.maxZ + clearanceM - 1e-6

const createNavigationGrid = (
  request: Omit<AgvPathRequest, 'destinationObjectId'>,
  allowStart = true,
) => {
  const gridSizeM = Math.max(0.25, request.factory.gridSizeM)
  const minIx = Math.ceil(AGV_NAVIGATION_CLEARANCE_M / gridSizeM)
  const minIz = minIx
  const maxIx = Math.floor((request.factory.widthM - AGV_NAVIGATION_CLEARANCE_M) / gridSizeM)
  const maxIz = Math.floor((request.factory.lengthM - AGV_NAVIGATION_CLEARANCE_M) / gridSizeM)
  const clampIndex = (value: number, min: number, max: number) => Math.max(min, Math.min(max, Math.round(value / gridSizeM)))
  const start: GridNode = {
    ix: clampIndex(request.start.x, minIx, maxIx),
    iz: clampIndex(request.start.z, minIz, maxIz),
    x: 0,
    z: 0,
  }
  start.x = start.ix * gridSizeM
  start.z = start.iz * gridSizeM
  const startKey = pointKey(start.ix, start.iz)
  const staticObjects = request.objects.filter((object) => {
    if (object.id === request.vehicleObjectId || object.floorId !== request.floorId) return false
    return object.kind !== 'agv' && object.kind !== 'drone'
  })
  const staticGridKey = JSON.stringify({
    widthM: request.factory.widthM,
    lengthM: request.factory.lengthM,
    gridSizeM,
    floorId: request.floorId,
    objects: staticObjects
      .map((object) => ({
        id: object.id,
        kind: object.kind,
        transform: object.transform,
        footprint: object.footprint,
        path: object.config.kind === 'conveyor' ? object.config.path : null,
      }))
      .sort((left, right) => left.id.localeCompare(right.id)),
  })
  let staticBlockedKeys = agvStaticGridCache.get(staticGridKey)
  if (!staticBlockedKeys) {
    staticBlockedKeys = new Set<string>()
    for (let ix = minIx; ix <= maxIx; ix += 1) {
      for (let iz = minIz; iz <= maxIz; iz += 1) {
        const point = { x: ix * gridSizeM, z: iz * gridSizeM }
        const blocked = staticObjects.some((object) => {
          if (object.config.kind !== 'conveyor') {
            return nodeInsideInflatedRect(point, facilityRect(object), AGV_NAVIGATION_CLEARANCE_M)
          }
          return object.config.path.slice(1).some((end, index) =>
            distanceToSegment(point, object.config.kind === 'conveyor' ? object.config.path[index] : end, end)
              < AGV_NAVIGATION_CLEARANCE_M + 0.5 - 1e-6)
        })
        if (blocked) staticBlockedKeys.add(pointKey(ix, iz))
      }
    }
    agvStaticGridCache.set(staticGridKey, staticBlockedKeys)
    if (agvStaticGridCache.size > AGV_STATIC_GRID_CACHE_LIMIT) agvStaticGridCache.delete(agvStaticGridCache.keys().next().value!)
  }

  const isBlocked = (node: GridNode): boolean => {
    const key = pointKey(node.ix, node.iz)
    if (allowStart && key === startKey) return false
    if (node.ix < minIx || node.ix > maxIx || node.iz < minIz || node.iz > maxIz) return true
    if ((request.dynamicObstacles ?? []).some((obstacle) =>
      Math.hypot(node.x - obstacle.x, node.z - obstacle.z) < obstacle.radiusM - 1e-6)) return true
    return staticBlockedKeys.has(key)
  }

  const nodeAt = (ix: number, iz: number): GridNode => ({ ix, iz, x: ix * gridSizeM, z: iz * gridSizeM })
  return { gridSizeM, minIx, minIz, maxIx, maxIz, start, isBlocked, nodeAt }
}

const reconstructPath = (goalKey: string, cameFrom: Map<string, string>, nodes: Map<string, GridNode>): AgvNavigationPoint[] => {
  const path: AgvNavigationPoint[] = []
  let key: string | undefined = goalKey
  while (key) {
    const node = nodes.get(key)
    if (!node) break
    path.push({ x: node.x, z: node.z })
    key = cameFrom.get(key)
  }
  return path.reverse()
}

const aStarToAny = (
  grid: ReturnType<typeof createNavigationGrid>,
  goalKeys: Set<string>,
): AgvNavigationPoint[] | null => {
  if (goalKeys.size === 0) return null
  const startKey = pointKey(grid.start.ix, grid.start.iz)
  if (goalKeys.has(startKey)) return [{ x: grid.start.x, z: grid.start.z }]
  const open = new MinPriorityQueue<GridNode>()
  const nodes = new Map<string, GridNode>([[startKey, grid.start]])
  const cameFrom = new Map<string, string>()
  const gScore = new Map<string, number>([[startKey, 0]])
  const closed = new Set<string>()
  const goalNodes = [...goalKeys].map((key) => {
    const [ix, iz] = key.split(':').map(Number)
    return { ix, iz }
  })
  const heuristic = (node: GridNode) => Math.min(...goalNodes.map((goal) => {
    const dx = Math.abs(goal.ix - node.ix)
    const dz = Math.abs(goal.iz - node.iz)
    const diagonalSteps = Math.min(dx, dz)
    const straightSteps = Math.max(dx, dz) - diagonalSteps
    return (diagonalSteps * Math.SQRT2 + straightSteps) * grid.gridSizeM
  }))
  open.push({ value: grid.start, priority: heuristic(grid.start), secondary: 0, key: startKey })
  const directions = [
    [1, 0], [0, 1], [-1, 0], [0, -1],
    [1, 1], [-1, 1], [-1, -1], [1, -1],
  ] as const

  while (open.size > 0) {
    const entry = open.pop()!
    const currentKey = entry.key
    if (closed.has(currentKey) || entry.secondary > (gScore.get(currentKey) ?? Infinity) + 1e-9) continue
    const current = entry.value
    if (goalKeys.has(currentKey)) return reconstructPath(currentKey, cameFrom, nodes)
    closed.add(currentKey)
    for (const [dx, dz] of directions) {
      const neighbor = grid.nodeAt(current.ix + dx, current.iz + dz)
      const neighborKey = pointKey(neighbor.ix, neighbor.iz)
      if (grid.isBlocked(neighbor)) continue
      const isDiagonal = dx !== 0 && dz !== 0
      if (isDiagonal) {
        const horizontalNeighbor = grid.nodeAt(current.ix + dx, current.iz)
        const verticalNeighbor = grid.nodeAt(current.ix, current.iz + dz)
        if (grid.isBlocked(horizontalNeighbor) || grid.isBlocked(verticalNeighbor)) continue
      }
      const movementCost = (isDiagonal ? Math.SQRT2 : 1) * grid.gridSizeM
      const tentative = (gScore.get(currentKey) ?? Infinity) + movementCost
      if (tentative >= (gScore.get(neighborKey) ?? Infinity)) continue
      cameFrom.set(neighborKey, currentKey)
      nodes.set(neighborKey, neighbor)
      gScore.set(neighborKey, tentative)
      open.push({ value: neighbor, priority: tentative + heuristic(neighbor), secondary: tentative, key: neighborKey })
    }
  }
  return null
}

const dockingGoalKeys = (
  grid: ReturnType<typeof createNavigationGrid>,
  destination: FactoryObject,
): Set<string> => {
  const rect = facilityRect(destination)
  const minIx = Math.round((rect.minX - AGV_NAVIGATION_CLEARANCE_M) / grid.gridSizeM)
  const maxIx = Math.round((rect.maxX + AGV_NAVIGATION_CLEARANCE_M) / grid.gridSizeM)
  const minIz = Math.round((rect.minZ - AGV_NAVIGATION_CLEARANCE_M) / grid.gridSizeM)
  const maxIz = Math.round((rect.maxZ + AGV_NAVIGATION_CLEARANCE_M) / grid.gridSizeM)
  const facilityMinIx = Math.floor(rect.minX / grid.gridSizeM)
  const facilityMaxIx = Math.ceil(rect.maxX / grid.gridSizeM)
  const facilityMinIz = Math.floor(rect.minZ / grid.gridSizeM)
  const facilityMaxIz = Math.ceil(rect.maxZ / grid.gridSizeM)
  const candidates: GridNode[] = []
  for (let ix = facilityMinIx; ix <= facilityMaxIx; ix += 1) {
    candidates.push(grid.nodeAt(ix, minIz), grid.nodeAt(ix, maxIz))
  }
  for (let iz = facilityMinIz; iz <= facilityMaxIz; iz += 1) {
    candidates.push(grid.nodeAt(minIx, iz), grid.nodeAt(maxIx, iz))
  }
  return new Set(candidates.filter((node) => !grid.isBlocked(node)).map((node) => pointKey(node.ix, node.iz)))
}

export function findShortestAgvPath(request: AgvPathRequest): AgvNavigationPoint[] | null {
  const destination = request.objects.find((object) => object.id === request.destinationObjectId && object.floorId === request.floorId)
  if (!destination || (destination.kind !== 'rack' && destination.kind !== 'shelf')) return null
  const grid = createNavigationGrid(request)
  return aStarToAny(grid, dockingGoalKeys(grid, destination))
}

export function findShortestAgvPathToPoint(request: AgvPointPathRequest): AgvNavigationPoint[] | null {
  const grid = createNavigationGrid(request)
  const target = grid.nodeAt(
    Math.round(request.target.x / grid.gridSizeM),
    Math.round(request.target.z / grid.gridSizeM),
  )
  if (grid.isBlocked(target)) return null
  return aStarToAny(grid, new Set([pointKey(target.ix, target.iz)]))
}

export function findAgvYieldPath(request: AgvYieldPathRequest): AgvNavigationPoint[] | null {
  const grid = createNavigationGrid(request)
  const minimumDistance = AGV_VEHICLE_SEPARATION_M + grid.gridSizeM
  const goals = new Set<string>()
  for (let ix = grid.minIx; ix <= grid.maxIx; ix += 1) {
    for (let iz = grid.minIz; iz <= grid.maxIz; iz += 1) {
      const node = grid.nodeAt(ix, iz)
      if (grid.isBlocked(node)) continue
      if (request.avoidPoints.every((point) => Math.hypot(node.x - point.x, node.z - point.z) >= minimumDistance)) {
        goals.add(pointKey(ix, iz))
      }
    }
  }
  return aStarToAny(grid, goals)
}

export const agvPathLength = (path: AgvNavigationPoint[]): number => path.slice(1).reduce((sum, point, index) =>
  sum + Math.hypot(point.x - path[index].x, point.z - path[index].z), 0)
