import type { Floor, FloorVisibilityMode, Id } from '../types'

export interface FloorVisibilityRange {
  lowestElevationM: number
  highestElevationM: number
  lowerDepthM: number
  upperHeightM: number
  verticalSpanM: number
  centerOffsetM: number
  hasContextFloors: boolean
}

export function floorObjectsVisible(
  floorId: Id,
  activeFloorId: Id,
  mode: FloorVisibilityMode,
  enabledFloorIds: ReadonlySet<Id>,
): boolean {
  if (!enabledFloorIds.has(floorId)) return false
  return mode !== 'current-only' || floorId === activeFloorId
}

export function conveyorFloorsVisible(
  fromFloorId: Id,
  toFloorId: Id,
  activeFloorId: Id,
  mode: FloorVisibilityMode,
  enabledFloorIds: ReadonlySet<Id>,
): boolean {
  if (!enabledFloorIds.has(fromFloorId) || !enabledFloorIds.has(toFloorId)) return false
  return mode !== 'current-only' || fromFloorId === activeFloorId || toFloorId === activeFloorId
}

export function floorVisibilityRange(
  floors: Floor[],
  activeFloorId: Id,
  mode: FloorVisibilityMode,
  enabledFloorIds: ReadonlySet<Id>,
): FloorVisibilityRange {
  const activeElevationM = floors.find((floor) => floor.id === activeFloorId)?.elevationM ?? 0
  const contextFloors = mode === 'current-only'
    ? []
    : floors.filter((floor) => floor.id !== activeFloorId && enabledFloorIds.has(floor.id))
  const elevations = [activeElevationM, ...contextFloors.map((floor) => floor.elevationM)]
  const lowestElevationM = Math.min(...elevations)
  const highestElevationM = Math.max(...elevations)
  return {
    lowestElevationM,
    highestElevationM,
    lowerDepthM: Math.max(0, activeElevationM - lowestElevationM),
    upperHeightM: Math.max(0, highestElevationM - activeElevationM),
    verticalSpanM: highestElevationM - lowestElevationM,
    centerOffsetM: (lowestElevationM + highestElevationM) / 2 - activeElevationM,
    hasContextFloors: contextFloors.length > 0,
  }
}
