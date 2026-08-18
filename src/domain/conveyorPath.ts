export interface GridPoint {
  x: number
  z: number
}

export interface SpatialPoint extends GridPoint {
  y: number
}

export interface ConveyorFloorConfig {
  conveyorType?: 'flat' | 'incline'
  fromFloorId?: string
  toFloorId?: string
  riseM?: number
  path: GridPoint[]
}

export interface ConveyorFloorObject {
  floorId: string
  config: ConveyorFloorConfig
}

export interface TrimmedPathSegment {
  start: GridPoint
  end: GridPoint
  length: number
  sourceIndex: number
}

export interface GridFacilityBounds {
  x: number
  z: number
  width: number
  depth: number
}

export interface ConveyorPortFacility {
  id: string
  kind: string
  transform: {
    x: number
    z: number
    rotationY: number
  }
  footprint: {
    width: number
    depth: number
  }
}

export const supportsTripleConveyorPorts = (facility: Pick<ConveyorPortFacility, 'kind'>): boolean =>
  facility.kind === 'machine' || facility.kind === 'rack'

export type ConveyorPortRole = 'input' | 'output'
export type MachinePortIndex = 0 | 1 | 2

export const MACHINE_PORT_INDICES: readonly MachinePortIndex[] = [0, 1, 2]
export const MACHINE_PORT_LANE_OFFSETS_M: Record<MachinePortIndex, number> = {
  0: -1,
  1: 0,
  2: 1,
}

/**
 * Metre-space channel dimensions for the 6×6 generic machine. The former 4×4
 * visual composition is scaled by 1.5 so three one-metre conveyor lanes fit
 * through the shared opening while retaining a one-cell margin between lanes.
 */
export const GENERIC_MACHINE_CHANNEL_LAYOUT = {
  internalConveyorLengthM: 4.32,
  curtainOffsetM: 2.37,
  portAnchorOffsetM: 2,
} as const

export const SHELF_LAYOUT = {
  widthM: 8,
  depthM: 2,
  visualWidthM: 7.2,
  visualHeightM: 5.4,
  visualDepthM: 1.8,
} as const

export const INCLINE_REFERENCE_RISE_M = 4.5
export const INCLINE_REFERENCE_RUN_M = 6
export const INCLINE_GRADE = INCLINE_REFERENCE_RISE_M / INCLINE_REFERENCE_RUN_M

/** Keeps every cross-floor conveyor at the reference 36.87° incline. */
export function inclineHorizontalRun(riseM: number): number {
  return Math.max(1, Math.abs(riseM) / INCLINE_GRADE)
}

export interface ConveyorEndpointSnap<TFacility extends ConveyorPortFacility = ConveyorPortFacility> {
  object: TFacility
  role: ConveyorPortRole | 'generic'
  portIndex: MachinePortIndex | null
  point: GridPoint
  distance: number
}

export function facilityCenter(bounds: GridFacilityBounds): GridPoint {
  return { x: bounds.x + bounds.width / 2, z: bounds.z + bounds.depth / 2 }
}

/** Returns the midpoint of the facility side facing the path direction. */
export function centeredFacilityAnchor(bounds: GridFacilityBounds, toward: GridPoint): GridPoint {
  const center = facilityCenter(bounds)
  const dx = toward.x - center.x
  const dz = toward.z - center.z
  if (Math.abs(dx) >= Math.abs(dz)) {
    return { x: center.x + (dx < 0 ? -bounds.width / 2 : bounds.width / 2), z: center.z }
  }
  return { x: center.x, z: center.z + (dz < 0 ? -bounds.depth / 2 : bounds.depth / 2) }
}

/**
 * The generic machine processes material along its local X axis. Rotation is
 * applied with the same convention as Three.js, so the logical port and the
 * rendered opening always remain aligned.
 */
export function machinePortAnchor(
  facility: Pick<ConveyorPortFacility, 'kind' | 'transform' | 'footprint'>,
  role: ConveyorPortRole,
  portIndex: MachinePortIndex = 1,
): GridPoint {
  const center = facilityCenter({
    x: facility.transform.x,
    z: facility.transform.z,
    width: facility.footprint.width,
    depth: facility.footprint.depth,
  })
  const localX = role === 'output' ? 1 : -1
  const rotation = ((facility.transform.rotationY % 360) + 360) % 360
  const outputDirection = rotation === 90
    ? { x: 0, z: -1 }
    : rotation === 180
      ? { x: -1, z: 0 }
      : rotation === 270
        ? { x: 0, z: 1 }
        : { x: 1, z: 0 }
  const direction = { x: outputDirection.x * localX, z: outputDirection.z * localX }
  const laneDirection = { x: -outputDirection.z, z: outputDirection.x }
  const laneOffset = MACHINE_PORT_LANE_OFFSETS_M[portIndex]
  const extent = Math.abs(direction.x) * facility.footprint.width / 2
    + Math.abs(direction.z) * facility.footprint.depth / 2
  // Finish behind the black curtain rather than at the logical footprint edge.
  // Construction remains on the 1m grid while the terminal continues under
  // the curtain and overlaps the internal belt inside the enlarged shell.
  const portExtent = Math.min(extent, GENERIC_MACHINE_CHANNEL_LAYOUT.portAnchorOffsetM)
  return {
    x: center.x + direction.x * portExtent + laneDirection.x * laneOffset,
    z: center.z + direction.z * portExtent + laneDirection.z * laneOffset,
  }
}

/** Uses directional machine ports and side-center anchors for other facilities. */
export function conveyorPortAnchor(
  facility: ConveyorPortFacility,
  role: ConveyorPortRole,
  toward: GridPoint,
  portIndex: MachinePortIndex = 1,
): GridPoint {
  if (supportsTripleConveyorPorts(facility)) return machinePortAnchor(facility, role, portIndex)
  return centeredFacilityAnchor({
    x: facility.transform.x,
    z: facility.transform.z,
    width: facility.footprint.width,
    depth: facility.footprint.depth,
  }, toward)
}

export function nearestConveyorPort<TFacility extends ConveyorPortFacility>(
  point: GridPoint,
  endpoint: 'start' | 'end',
  facilities: TFacility[],
  maxDistance: number,
  isAvailable: (object: TFacility, role: ConveyorPortRole, portIndex: MachinePortIndex | null) => boolean = () => true,
): ConveyorEndpointSnap<TFacility> | null {
  const role: ConveyorPortRole = endpoint === 'start' ? 'output' : 'input'
  return facilities
    .flatMap((object): ConveyorEndpointSnap<TFacility>[] => {
      const indices: Array<MachinePortIndex | null> = supportsTripleConveyorPorts(object) ? [...MACHINE_PORT_INDICES] : [null]
      return indices
        .filter((portIndex) => isAvailable(object, role, portIndex))
        .map((portIndex) => {
          const anchor = conveyorPortAnchor(object, role, point, portIndex ?? 1)
          return {
            object,
            role: supportsTripleConveyorPorts(object) ? role : 'generic',
            portIndex,
            point: anchor,
            distance: Math.hypot(point.x - anchor.x, point.z - anchor.z),
          }
        })
    })
    .filter((candidate) => candidate.distance <= maxDistance)
    .sort((left, right) => left.distance - right.distance)[0] ?? null
}

/** Rebuilds only the first/last path legs so connected conveyors meet side centers. */
export function alignPathToFacilityCenters(
  pathValue: GridPoint[],
  startFacility?: GridFacilityBounds | null,
  endFacility?: GridFacilityBounds | null,
  gridSize = 1,
): GridPoint[] {
  let path = compactPath(pathValue.map((point) => snapPoint(point, gridSize)))
  if (path.length < 2) return path

  if (startFacility) {
    const anchor = centeredFacilityAnchor(startFacility, path[1])
    const bridge = samePoint(anchor, path[1]) ? [anchor] : buildOrthogonalPath(anchor, path[1], gridSize)
    path = compactPath([...bridge, ...path.slice(2)])
  }
  if (endFacility && path.length >= 2) {
    const previous = path.at(-2)!
    const anchor = centeredFacilityAnchor(endFacility, previous)
    const bridge = samePoint(previous, anchor) ? [anchor] : buildOrthogonalPath(previous, anchor, gridSize)
    path = compactPath([...path.slice(0, -2), ...bridge])
  }
  return path
}

export function snapPoint(point: GridPoint, gridSize = 1): GridPoint {
  const size = Math.max(0.25, gridSize)
  return {
    x: Math.round(point.x / size) * size,
    z: Math.round(point.z / size) * size,
  }
}

export function buildOrthogonalPath(startValue: GridPoint, endValue: GridPoint, gridSize = 1): GridPoint[] {
  const start = snapPoint(startValue, gridSize)
  const end = snapPoint(endValue, gridSize)
  if (start.x === end.x && start.z === end.z) return [start, { x: start.x + gridSize, z: start.z }]
  if (start.x === end.x || start.z === end.z) return [start, end]

  const dx = Math.abs(end.x - start.x)
  const dz = Math.abs(end.z - start.z)
  const corner = dx >= dz
    ? { x: end.x, z: start.z }
    : { x: start.x, z: end.z }
  return compactPath([start, corner, end])
}

/** Builds an orthogonal connector without rounding its terminal anchors. */
export function buildOrthogonalConnectorPath(start: GridPoint, end: GridPoint): GridPoint[] {
  if (samePoint(start, end)) return [start]
  if (start.x === end.x || start.z === end.z) return [start, end]

  const dx = Math.abs(end.x - start.x)
  const dz = Math.abs(end.z - start.z)
  const corner = dx >= dz
    ? { x: end.x, z: start.z }
    : { x: start.x, z: end.z }
  return compactPath([start, corner, end])
}

/**
 * Replaces a grid-drawn route's first and/or last point with exact facility
 * ports, adding a short orthogonal bridge when a machine has rotated.
 */
export function alignPathToPorts(
  pathValue: GridPoint[],
  startPort?: GridPoint | null,
  endPort?: GridPoint | null,
): GridPoint[] {
  const path = compactPath(pathValue)
  if (path.length < 2) return path
  if (startPort && endPort && path.length === 2) return buildOrthogonalConnectorPath(startPort, endPort)

  let aligned = path
  if (startPort) {
    const bridge = buildOrthogonalConnectorPath(startPort, aligned[1])
    aligned = compactPath([...bridge.slice(0, -1), ...aligned.slice(1)])
  }
  if (endPort && aligned.length >= 2) {
    const bridge = buildOrthogonalConnectorPath(aligned.at(-2)!, endPort)
    aligned = compactPath([...aligned.slice(0, -1), ...bridge.slice(1)])
  }
  return aligned
}

function samePoint(left: GridPoint | undefined, right: GridPoint | undefined): boolean {
  return Boolean(left && right && left.x === right.x && left.z === right.z)
}

function appendTraceCell(trace: GridPoint[], point: GridPoint): void {
  if (samePoint(trace.at(-1), point)) return
  if (samePoint(trace.at(-2), point)) {
    trace.pop()
    return
  }
  const previousVisit = trace.findIndex((candidate) => samePoint(candidate, point))
  if (previousVisit >= 0) {
    trace.splice(previousVisit + 1)
    return
  }
  trace.push(point)
}

/**
 * Adds a sampled pointer position to a cell-by-cell conveyor trace. Gaps caused
 * by fast pointer movement are filled on the grid while preserving the user's
 * previous travel direction where possible.
 */
export function appendGridTrace(traceValue: GridPoint[], pointValue: GridPoint, gridSize = 1): GridPoint[] {
  const size = Math.max(0.25, gridSize)
  const point = snapPoint(pointValue, size)
  if (traceValue.length === 0) return [point]

  const trace = traceValue.map((candidate) => snapPoint(candidate, size))
  const start = trace.at(-1)!
  if (samePoint(start, point)) return trace

  const previous = trace.at(-2)
  const previousAxis = previous
    ? (previous.x !== start.x ? 'x' : previous.z !== start.z ? 'z' : null)
    : null
  const deltaX = point.x - start.x
  const deltaZ = point.z - start.z
  const axisOrder: Array<'x' | 'z'> = deltaX !== 0 && deltaZ !== 0
    ? previousAxis === 'x' || previousAxis === 'z'
      ? [previousAxis, previousAxis === 'x' ? 'z' : 'x']
      : Math.abs(deltaX) >= Math.abs(deltaZ) ? ['x', 'z'] : ['z', 'x']
    : deltaX !== 0 ? ['x'] : ['z']

  const cursor = { ...start }
  for (const axis of axisOrder) {
    const target = point[axis]
    while (Math.abs(target - cursor[axis]) > size / 2) {
      cursor[axis] += Math.sign(target - cursor[axis]) * size
      appendTraceCell(trace, { ...cursor })
    }
  }
  return trace
}

/** Converts the sampled cell trace into the minimal straight/turn polyline. */
export function pathFromGridTrace(trace: GridPoint[]): GridPoint[] {
  return compactPath(trace)
}

/**
 * Reserves the square around every turn for the corner model and returns only
 * the portions that may be occupied by straight conveyor meshes.
 */
export function trimPathForCorners(
  path: GridPoint[],
  cornerHalfExtent = 0.46,
  endpointCorners: { start?: boolean; end?: boolean } = {},
): TrimmedPathSegment[] {
  return path.slice(1).flatMap((end, sourceIndex) => {
    const start = path[sourceIndex]
    const dx = end.x - start.x
    const dz = end.z - start.z
    const length = Math.hypot(dx, dz)
    if (length <= 0.0001) return []

    const needsStartInset = sourceIndex > 0 || (sourceIndex === 0 && endpointCorners.start === true)
    const needsEndInset = sourceIndex < path.length - 2 || (sourceIndex === path.length - 2 && endpointCorners.end === true)
    const insetCount = Number(needsStartInset) + Number(needsEndInset)
    const availableInset = insetCount > 0 ? Math.max(0, length - 0.04) / insetCount : 0
    const inset = Math.min(Math.max(0, cornerHalfExtent), availableInset)
    const ux = dx / length
    const uz = dz / length
    const trimmedStart = needsStartInset
      ? { x: start.x + ux * inset, z: start.z + uz * inset }
      : start
    const trimmedEnd = needsEndInset
      ? { x: end.x - ux * inset, z: end.z - uz * inset }
      : end
    const trimmedLength = Math.hypot(trimmedEnd.x - trimmedStart.x, trimmedEnd.z - trimmedStart.z)
    return trimmedLength >= 0.12
      ? [{ start: trimmedStart, end: trimmedEnd, length: trimmedLength, sourceIndex }]
      : []
  })
}

export function isOrthogonalConveyorTurn(previous: GridPoint, corner: GridPoint, next: GridPoint): boolean {
  const incoming = { x: corner.x - previous.x, z: corner.z - previous.z }
  const outgoing = { x: next.x - corner.x, z: next.z - corner.z }
  const incomingLength = Math.hypot(incoming.x, incoming.z)
  const outgoingLength = Math.hypot(outgoing.x, outgoing.z)
  if (incomingLength <= 0.0001 || outgoingLength <= 0.0001) return false
  const dot = incoming.x * outgoing.x + incoming.z * outgoing.z
  return Math.abs(dot) <= 0.0001
}

/** Rotation for Kenney's corner whose unrotated open interfaces are -X/+Z. */
export function kenneyCornerRotationY(previous: GridPoint, corner: GridPoint, next: GridPoint): number {
  const directions = [
    { x: Math.sign(previous.x - corner.x), z: Math.sign(previous.z - corner.z) },
    { x: Math.sign(next.x - corner.x), z: Math.sign(next.z - corner.z) },
  ]
  const has = (x: number, z: number) => directions.some((direction) => direction.x === x && direction.z === z)
  if (has(-1, 0) && has(0, 1)) return 0
  if (has(0, 1) && has(1, 0)) return Math.PI / 2
  if (has(1, 0) && has(0, -1)) return Math.PI
  return -Math.PI / 2
}

export function compactPath(path: GridPoint[]): GridPoint[] {
  const result: GridPoint[] = []
  for (const point of path) {
    const previous = result.at(-1)
    if (previous && previous.x === point.x && previous.z === point.z) continue
    if (result.length >= 2 && samePoint(result.at(-2), point)) {
      result.pop()
      continue
    }
    if (result.length >= 2) {
      const before = result.at(-2)!
      const sameX = before.x === previous!.x && previous!.x === point.x
      const sameZ = before.z === previous!.z && previous!.z === point.z
      if (sameX || sameZ) {
        result[result.length - 1] = point
        continue
      }
    }
    result.push(point)
  }
  return result
}

export function polylineLength(path: GridPoint[]): number {
  return path.slice(1).reduce((sum, point, index) => {
    const previous = path[index]
    return sum + Math.hypot(point.x - previous.x, point.z - previous.z)
  }, 0)
}

export function conveyorEndpointFloorId(
  conveyor: ConveyorFloorObject,
  endpoint: 'start' | 'end',
): string {
  return endpoint === 'start'
    ? conveyor.config.fromFloorId ?? conveyor.floorId
    : conveyor.config.toFloorId ?? conveyor.floorId
}

export function conveyorOccupiesFloor(conveyor: ConveyorFloorObject, floorId: string): boolean {
  return conveyorEndpointFloorId(conveyor, 'start') === floorId
    || conveyorEndpointFloorId(conveyor, 'end') === floorId
}

export function conveyorSpatialLength(path: GridPoint[], riseM = 0): number {
  return Math.hypot(polylineLength(path), Math.abs(riseM))
}

export function pointAlongSpatialPath(
  path: GridPoint[],
  progressValue: number,
  fromY = 0,
  toY = fromY,
): SpatialPoint {
  const progress = Math.min(1, Math.max(0, progressValue))
  const point = pointAlongPath(path, progress)
  return { ...point, y: fromY + (toY - fromY) * progress }
}

export function directionAlongSpatialPath(
  path: GridPoint[],
  progressValue: number,
  fromY = 0,
  toY = fromY,
): SpatialPoint {
  const horizontal = directionAlongPath(path, progressValue)
  const horizontalLength = Math.max(0.0001, polylineLength(path))
  const rise = toY - fromY
  const length = Math.max(0.0001, Math.hypot(horizontalLength, rise))
  return {
    x: horizontal.x * horizontalLength / length,
    y: rise / length,
    z: horizontal.z * horizontalLength / length,
  }
}

export function pointAlongPath(path: GridPoint[], progressValue: number): GridPoint {
  if (path.length < 2) return path[0] ?? { x: 0, z: 0 }
  const total = Math.max(0.0001, polylineLength(path))
  let remaining = Math.min(1, Math.max(0, progressValue)) * total
  for (let index = 1; index < path.length; index += 1) {
    const start = path[index - 1]
    const end = path[index]
    const length = Math.hypot(end.x - start.x, end.z - start.z)
    if (remaining <= length || index === path.length - 1) {
      const t = length > 0 ? Math.min(1, remaining / length) : 0
      return { x: start.x + (end.x - start.x) * t, z: start.z + (end.z - start.z) * t }
    }
    remaining -= length
  }
  return path.at(-1)!
}

export function directionAlongPath(path: GridPoint[], progressValue: number): GridPoint {
  if (path.length < 2) return { x: 1, z: 0 }
  const total = Math.max(0.0001, polylineLength(path))
  let remaining = Math.min(1, Math.max(0, progressValue)) * total
  for (let index = 1; index < path.length; index += 1) {
    const start = path[index - 1]
    const end = path[index]
    const dx = end.x - start.x
    const dz = end.z - start.z
    const length = Math.hypot(dx, dz)
    if (remaining <= length || index === path.length - 1) {
      return length > 0 ? { x: dx / length, z: dz / length } : { x: 1, z: 0 }
    }
    remaining -= length
  }
  return { x: 1, z: 0 }
}
