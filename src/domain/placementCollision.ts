import type { FactoryObject } from '../types'
import { conveyorOccupiesFloor, type GridPoint } from './conveyorPath'

export interface PlacementBounds {
  x: number
  z: number
  width: number
  depth: number
}

interface Rect {
  minX: number
  maxX: number
  minZ: number
  maxZ: number
}

const overlaps = (left: Rect, right: Rect): boolean =>
  left.minX < right.maxX && left.maxX > right.minX
  && left.minZ < right.maxZ && left.maxZ > right.minZ

const footprintRect = (bounds: PlacementBounds): Rect => ({
  minX: bounds.x,
  maxX: bounds.x + bounds.width,
  minZ: bounds.z,
  maxZ: bounds.z + bounds.depth,
})

const segmentRects = (path: GridPoint[], halfWidth = 0.45): Rect[] => path.slice(1).map((end, index) => {
  const start = path[index]
  return {
    minX: Math.min(start.x, end.x) - halfWidth,
    maxX: Math.max(start.x, end.x) + halfWidth,
    minZ: Math.min(start.z, end.z) - halfWidth,
    maxZ: Math.max(start.z, end.z) + halfWidth,
  }
})

export function footprintsOverlap(left: PlacementBounds, right: PlacementBounds): boolean {
  return overlaps(footprintRect(left), footprintRect(right))
}

export function conveyorPathIntersectsFootprint(path: GridPoint[], bounds: PlacementBounds): boolean {
  const target = footprintRect(bounds)
  return segmentRects(path).some((segment) => overlaps(segment, target))
}

export function conveyorPathsOverlap(left: GridPoint[], right: GridPoint[]): boolean {
  const rightSegments = segmentRects(right)
  return segmentRects(left).some((leftSegment) => rightSegments.some((rightSegment) => overlaps(leftSegment, rightSegment)))
}

export function facilityPlacementBlocked(
  bounds: PlacementBounds,
  floorId: string,
  objects: FactoryObject[],
  selfId = '',
): boolean {
  return objects.some((object) => {
    if (object.id === selfId) return false
    if (object.config.kind === 'conveyor') {
      if (!conveyorOccupiesFloor({ floorId: object.floorId, config: object.config }, floorId)) return false
    } else if (object.floorId !== floorId) return false
    if (object.config.kind === 'conveyor') {
      if (object.config.fromObjectId === selfId || object.config.toObjectId === selfId) return false
      return conveyorPathIntersectsFootprint(object.config.path, bounds)
    }
    return footprintsOverlap(bounds, {
      x: object.transform.x,
      z: object.transform.z,
      width: object.footprint.width,
      depth: object.footprint.depth,
    })
  })
}

export function conveyorPlacementBlocked(
  path: GridPoint[],
  floorId: string,
  objects: FactoryObject[],
  fromObjectId: string | null,
  toObjectId: string | null,
  selfId = '',
): boolean {
  return objects.some((object) => {
    if (object.id === selfId) return false
    if (object.config.kind === 'conveyor') {
      if (!conveyorOccupiesFloor({ floorId: object.floorId, config: object.config }, floorId)) return false
      // A snapped continuation is allowed to share the terminal cell with the
      // conveyor it extends. Other conveyors still block the full corridor.
      if (object.id === fromObjectId || object.id === toObjectId) return false
      return conveyorPathsOverlap(path, object.config.path)
    }
    if (object.floorId !== floorId) return false
    if (object.id === fromObjectId || object.id === toObjectId) return false
    return conveyorPathIntersectsFootprint(path, {
      x: object.transform.x,
      z: object.transform.z,
      width: object.footprint.width,
      depth: object.footprint.depth,
    })
  })
}
