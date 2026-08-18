import type { AgvRuntimeState } from '../types'

export type AgvRoutePoint = AgvRuntimeState['position']

export function agvRemainingRoutePoints(
  runtime: Pick<AgvRuntimeState, 'position' | 'path' | 'waypointIndex'>,
): AgvRoutePoint[] {
  const current = { ...runtime.position }
  const futureWaypoints = runtime.path
    .slice(Math.max(0, runtime.waypointIndex))
    .filter((point) => Math.hypot(point.x - current.x, point.z - current.z) > 0.01)
  return [current, ...futureWaypoints]
}
