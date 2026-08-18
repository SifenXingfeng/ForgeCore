import type { DroneNavigationPoint, Factory, FactoryObject, Floor, Id } from '../types'
import { MACHINE_PORT_INDICES, MACHINE_PORT_LANE_OFFSETS_M, facilityCenter, type MachinePortIndex } from './conveyorPath'
import { MinPriorityQueue } from './minPriorityQueue'

export interface DroneDynamicObstacle extends DroneNavigationPoint {
  radiusM: number
}

export interface DronePathRequest {
  factory: Factory
  floors: Floor[]
  objects: FactoryObject[]
  vehicleObjectId: Id
  start: DroneNavigationPoint
  destinationObjectId: Id
  dockingRole?: DroneDockingRole
  dynamicObstacles?: DroneDynamicObstacle[]
}

export type DroneDockingRole = 'pickup' | 'dropoff'

export const DRONE_NAVIGATION_CLEARANCE_M = 1.4
export const DRONE_VEHICLE_SEPARATION_M = 3
export const DRONE_INITIAL_HOVER_M = 2.2
export const DRONE_TOP_AIRSPACE_M = 3
const DRONE_STATIC_GRID_CACHE_LIMIT = 8
const droneStaticGridCache = new Map<string, Set<string>>()
const DRONE_DIRECTIONS: Array<[number, number, number]> = []
for (let dx = -1; dx <= 1; dx += 1) {
  for (let dy = -1; dy <= 1; dy += 1) {
    for (let dz = -1; dz <= 1; dz += 1) {
      if (dx !== 0 || dy !== 0 || dz !== 0) DRONE_DIRECTIONS.push([dx, dy, dz])
    }
  }
}

interface GridNode extends DroneNavigationPoint {
  ix: number
  iy: number
  iz: number
}

interface Box3Bounds {
  minX: number
  maxX: number
  minY: number
  maxY: number
  minZ: number
  maxZ: number
}

const pointKey = (ix: number, iy: number, iz: number): string => `${ix}:${iy}:${iz}`

const facilityHeightM = (object: FactoryObject): number => {
  switch (object.kind) {
    case 'machine':
    case 'rack':
      return 4.8
    case 'shelf':
      return 5.4
    case 'buffer':
      return 1.5
    default:
      return 0
  }
}

const facilityBounds = (object: FactoryObject, floor: Floor): Box3Bounds => ({
  minX: object.transform.x,
  maxX: object.transform.x + object.footprint.width,
  minY: floor.elevationM,
  maxY: floor.elevationM + facilityHeightM(object),
  minZ: object.transform.z,
  maxZ: object.transform.z + object.footprint.depth,
})

const createNavigationGrid = (request: Omit<DronePathRequest, 'destinationObjectId'>) => {
  const stepM = Math.max(1, request.factory.gridSizeM)
  const minIx = Math.ceil(DRONE_NAVIGATION_CLEARANCE_M / stepM)
  const maxIx = Math.floor((request.factory.widthM - DRONE_NAVIGATION_CLEARANCE_M) / stepM)
  const minIz = minIx
  const maxIz = Math.floor((request.factory.lengthM - DRONE_NAVIGATION_CLEARANCE_M) / stepM)
  const highestCeilingM = Math.max(0, ...request.floors.map((floor) => floor.elevationM + floor.heightM))
  const minIy = Math.ceil(DRONE_NAVIGATION_CLEARANCE_M / stepM)
  const maxIy = Math.ceil((highestCeilingM + DRONE_TOP_AIRSPACE_M) / stepM)
  const clampIndex = (value: number, min: number, max: number) => Math.max(min, Math.min(max, Math.round(value / stepM)))
  const start: GridNode = {
    ix: clampIndex(request.start.x, minIx, maxIx),
    iy: clampIndex(request.start.y, minIy, maxIy),
    iz: clampIndex(request.start.z, minIz, maxIz),
    x: 0,
    y: 0,
    z: 0,
  }
  start.x = start.ix * stepM
  start.y = start.iy * stepM
  start.z = start.iz * stepM
  const startKey = pointKey(start.ix, start.iy, start.iz)
  const floorById = new Map(request.floors.map((floor) => [floor.id, floor]))
  const staticBoxes = request.objects.flatMap((object) => {
    if (object.id === request.vehicleObjectId || object.kind === 'drone' || object.kind === 'agv' || object.kind === 'conveyor') return []
    const floor = floorById.get(object.floorId)
    const height = facilityHeightM(object)
    return floor && height > 0 ? [facilityBounds(object, floor)] : []
  })
  const staticGridKey = JSON.stringify({
    widthM: request.factory.widthM,
    lengthM: request.factory.lengthM,
    stepM,
    floors: request.floors
      .map((floor) => ({ id: floor.id, elevationM: floor.elevationM, heightM: floor.heightM }))
      .sort((left, right) => left.id.localeCompare(right.id)),
    objects: request.objects
      .filter((object) => object.kind !== 'drone' && object.kind !== 'agv' && object.kind !== 'conveyor' && facilityHeightM(object) > 0)
      .map((object) => ({ id: object.id, kind: object.kind, floorId: object.floorId, transform: object.transform, footprint: object.footprint }))
      .sort((left, right) => left.id.localeCompare(right.id)),
  })
  let staticBlockedKeys = droneStaticGridCache.get(staticGridKey)
  if (!staticBlockedKeys) {
    staticBlockedKeys = new Set<string>()
    staticBoxes.forEach((box) => {
      const startIx = Math.ceil((box.minX - DRONE_NAVIGATION_CLEARANCE_M + 1e-6) / stepM)
      const endIx = Math.floor((box.maxX + DRONE_NAVIGATION_CLEARANCE_M - 1e-6) / stepM)
      const startIy = Math.ceil((box.minY - DRONE_NAVIGATION_CLEARANCE_M + 1e-6) / stepM)
      const endIy = Math.floor((box.maxY + DRONE_NAVIGATION_CLEARANCE_M - 1e-6) / stepM)
      const startIz = Math.ceil((box.minZ - DRONE_NAVIGATION_CLEARANCE_M + 1e-6) / stepM)
      const endIz = Math.floor((box.maxZ + DRONE_NAVIGATION_CLEARANCE_M - 1e-6) / stepM)
      for (let ix = startIx; ix <= endIx; ix += 1) {
        for (let iy = startIy; iy <= endIy; iy += 1) {
          for (let iz = startIz; iz <= endIz; iz += 1) staticBlockedKeys!.add(pointKey(ix, iy, iz))
        }
      }
    })
    droneStaticGridCache.set(staticGridKey, staticBlockedKeys)
    if (droneStaticGridCache.size > DRONE_STATIC_GRID_CACHE_LIMIT) droneStaticGridCache.delete(droneStaticGridCache.keys().next().value!)
  }
  const nodeAt = (ix: number, iy: number, iz: number): GridNode => ({
    ix,
    iy,
    iz,
    x: ix * stepM,
    y: iy * stepM,
    z: iz * stepM,
  })
  const isBlocked = (node: GridNode): boolean => {
    const key = pointKey(node.ix, node.iy, node.iz)
    if (key === startKey) return false
    if (node.ix < minIx || node.ix > maxIx || node.iy < minIy || node.iy > maxIy || node.iz < minIz || node.iz > maxIz) return true
    if ((request.dynamicObstacles ?? []).some((obstacle) =>
      Math.hypot(node.x - obstacle.x, node.y - obstacle.y, node.z - obstacle.z) < obstacle.radiusM - 1e-6)) return true
    return staticBlockedKeys.has(key)
  }
  return { stepM, minIx, maxIx, minIy, maxIy, minIz, maxIz, start, nodeAt, isBlocked }
}

const reconstructPath = (goalKey: string, cameFrom: Map<string, string>, nodes: Map<string, GridNode>): DroneNavigationPoint[] => {
  const path: DroneNavigationPoint[] = []
  let key: string | undefined = goalKey
  while (key) {
    const node = nodes.get(key)
    if (!node) break
    path.push({ x: node.x, y: node.y, z: node.z })
    key = cameFrom.get(key)
  }
  return path.reverse()
}

const diagonalDistance3d = (left: GridNode, right: GridNode, stepM: number): number => {
  const distances = [Math.abs(left.ix - right.ix), Math.abs(left.iy - right.iy), Math.abs(left.iz - right.iz)].sort((a, b) => a - b)
  return (distances[0] * Math.sqrt(3) + (distances[1] - distances[0]) * Math.SQRT2 + distances[2] - distances[1]) * stepM
}

const moveClearsCorners = (
  grid: ReturnType<typeof createNavigationGrid>,
  current: GridNode,
  dx: number,
  dy: number,
  dz: number,
): boolean => {
  const axes = [dx, dy, dz]
    .map((value, index) => ({ value, index }))
    .filter(({ value }) => value !== 0)
  if (axes.length <= 1) return true
  const fullMask = (1 << axes.length) - 1
  for (let mask = 1; mask < fullMask; mask += 1) {
    const delta = [0, 0, 0]
    axes.forEach((axis, index) => {
      if ((mask & (1 << index)) !== 0) delta[axis.index] = axis.value
    })
    if (grid.isBlocked(grid.nodeAt(current.ix + delta[0], current.iy + delta[1], current.iz + delta[2]))) return false
  }
  return true
}

const aStar = (
  grid: ReturnType<typeof createNavigationGrid>,
  goals: GridNode[],
): DroneNavigationPoint[] | null => {
  const startKey = pointKey(grid.start.ix, grid.start.iy, grid.start.iz)
  const goalKeys = new Set(goals.map((goal) => pointKey(goal.ix, goal.iy, goal.iz)))
  if (goalKeys.has(startKey)) return [{ x: grid.start.x, y: grid.start.y, z: grid.start.z }]
  const heuristic = (node: GridNode): number => Math.min(...goals.map((goal) => diagonalDistance3d(node, goal, grid.stepM)))
  const open = new MinPriorityQueue<GridNode>()
  const nodes = new Map<string, GridNode>([[startKey, grid.start]])
  const cameFrom = new Map<string, string>()
  const gScore = new Map<string, number>([[startKey, 0]])
  const closed = new Set<string>()
  open.push({ value: grid.start, priority: heuristic(grid.start), secondary: 0, key: startKey })

  while (open.size > 0) {
    const entry = open.pop()!
    const currentKey = entry.key
    if (closed.has(currentKey) || entry.secondary > (gScore.get(currentKey) ?? Infinity) + 1e-9) continue
    const current = entry.value
    if (goalKeys.has(currentKey)) return reconstructPath(currentKey, cameFrom, nodes)
    closed.add(currentKey)
    for (const [dx, dy, dz] of DRONE_DIRECTIONS) {
      // 向下跨层只能在无遮挡净空列中垂直下降；向上仍保留完整 26 邻域体对角移动。
      if (dy < 0 && (dx !== 0 || dz !== 0)) continue
      const neighbor = grid.nodeAt(current.ix + dx, current.iy + dy, current.iz + dz)
      const neighborKey = pointKey(neighbor.ix, neighbor.iy, neighbor.iz)
      if (grid.isBlocked(neighbor) || !moveClearsCorners(grid, current, dx, dy, dz)) continue
      const changedAxes = Number(dx !== 0) + Number(dy !== 0) + Number(dz !== 0)
      const movementCost = (changedAxes === 3 ? Math.sqrt(3) : changedAxes === 2 ? Math.SQRT2 : 1) * grid.stepM
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

const dockingGoal = (
  grid: ReturnType<typeof createNavigationGrid>,
  point: DroneNavigationPoint,
): GridNode => {
  return grid.nodeAt(
    Math.round(point.x / grid.stepM),
    Math.round(point.y / grid.stepM),
    Math.round(point.z / grid.stepM),
  )
}

const warehousePortDirection = (
  destination: FactoryObject,
  role: DroneDockingRole,
): { outward: { x: number; z: number }; lane: { x: number; z: number } } => {
  const rotation = ((destination.transform.rotationY % 360) + 360) % 360
  const outputDirection = rotation === 90
    ? { x: 0, z: -1 }
    : rotation === 180
      ? { x: -1, z: 0 }
      : rotation === 270
        ? { x: 0, z: 1 }
        : { x: 1, z: 0 }
  const roleSign = role === 'pickup' ? 1 : -1
  return {
    outward: { x: outputDirection.x * roleSign, z: outputDirection.z * roleSign },
    lane: { x: -outputDirection.z, z: outputDirection.x },
  }
}

const warehouseDockingPoints = (
  request: Pick<DronePathRequest, 'factory' | 'floors' | 'objects' | 'destinationObjectId' | 'dockingRole'>,
  destination: FactoryObject,
  floor: Floor,
): DroneNavigationPoint[] => {
  const stepM = Math.max(1, request.factory.gridSizeM)
  const center = facilityCenter({
    x: destination.transform.x,
    z: destination.transform.z,
    width: destination.footprint.width,
    depth: destination.footprint.depth,
  })
  const { outward, lane } = warehousePortDirection(destination, request.dockingRole ?? 'dropoff')
  const facilityExtentM = Math.abs(outward.x) * destination.footprint.width / 2
    + Math.abs(outward.z) * destination.footprint.depth / 2
  const safeOutsideOffsetM = Math.ceil((facilityExtentM + DRONE_NAVIGATION_CLEARANCE_M) / stepM) * stepM
  const hoverY = Math.round((floor.elevationM + DRONE_INITIAL_HOVER_M) / stepM) * stepM
  const portOrder: readonly MachinePortIndex[] = [1, ...MACHINE_PORT_INDICES.filter((portIndex) => portIndex !== 1)]
  return portOrder.map((portIndex) => {
    const laneOffsetM = MACHINE_PORT_LANE_OFFSETS_M[portIndex]
    return {
      x: center.x + outward.x * safeOutsideOffsetM + lane.x * laneOffsetM,
      y: hoverY,
      z: center.z + outward.z * safeOutsideOffsetM + lane.z * laneOffsetM,
    }
  })
}

export const droneDockingPoints = (
  request: Pick<DronePathRequest, 'factory' | 'floors' | 'objects' | 'destinationObjectId' | 'dockingRole'>,
): DroneNavigationPoint[] => {
  const destination = request.objects.find((object) => object.id === request.destinationObjectId && (object.kind === 'rack' || object.kind === 'shelf'))
  const floor = destination ? request.floors.find((candidate) => candidate.id === destination.floorId) : undefined
  if (!destination || !floor) return []
  if (destination.kind === 'rack') return warehouseDockingPoints(request, destination, floor)
  const stepM = Math.max(1, request.factory.gridSizeM)
  return [{
    x: Math.round((destination.transform.x + destination.footprint.width / 2) / stepM) * stepM,
    y: Math.ceil((floor.elevationM + facilityHeightM(destination) + DRONE_NAVIGATION_CLEARANCE_M) / stepM) * stepM,
    z: Math.round((destination.transform.z + destination.footprint.depth / 2) / stepM) * stepM,
  }]
}

export const droneDockingPoint = (
  request: Pick<DronePathRequest, 'factory' | 'floors' | 'objects' | 'destinationObjectId' | 'dockingRole'>,
): DroneNavigationPoint | null => droneDockingPoints(request)[0] ?? null

export function findShortestDronePath(request: DronePathRequest): DroneNavigationPoint[] | null {
  const dockingPoints = droneDockingPoints(request)
  if (dockingPoints.length === 0) return null
  const grid = createNavigationGrid(request)
  const goals = [...new Map(dockingPoints
    .map((point) => dockingGoal(grid, point))
    .filter((goal) => !grid.isBlocked(goal))
    .map((goal) => [pointKey(goal.ix, goal.iy, goal.iz), goal])).values()]
  if (goals.length === 0) return null
  return aStar(grid, goals)
}

export const dronePathLength = (path: DroneNavigationPoint[]): number => path.slice(1).reduce((sum, point, index) =>
  sum + Math.hypot(point.x - path[index].x, point.y - path[index].y, point.z - path[index].z), 0)
