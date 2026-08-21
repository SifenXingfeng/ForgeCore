import type { GridPos } from './types'

const sameCell = (left: GridPos | undefined, right: GridPos | undefined) =>
  Boolean(left && right && left.x === right.x && left.z === right.z)

function appendTraceCell(trace: GridPos[], point: GridPos): void {
  if (sameCell(trace[trace.length - 1], point)) return

  // Moving back over the immediately previous cell erases the last stroke,
  // matching the direct-draw behaviour from ForgeCore.
  if (sameCell(trace[trace.length - 2], point)) {
    trace.pop()
    return
  }

  // Re-entering an earlier cell trims the loop instead of creating a
  // self-overlapping conveyor route.
  const previousVisit = trace.findIndex((candidate) => sameCell(candidate, point))
  if (previousVisit >= 0) {
    trace.splice(previousVisit + 1)
    return
  }

  trace.push(point)
}

/**
 * Adds the current pointer cell to a continuous, orthogonal conveyor trace.
 * Fast pointer movement is filled cell by cell. When both axes change, the
 * previous travel axis is kept first so the turn happens naturally at the
 * point where the user changed direction.
 */
export function appendGridTrace(traceValue: GridPos[], pointValue: GridPos): GridPos[] {
  const point = { x: Math.round(pointValue.x), z: Math.round(pointValue.z) }
  if (traceValue.length === 0) return [point]

  const trace = traceValue.map((candidate) => ({ x: Math.round(candidate.x), z: Math.round(candidate.z) }))
  const start = trace[trace.length - 1]!
  if (sameCell(start, point)) return trace

  const previous = trace[trace.length - 2]
  const previousAxis = previous
    ? previous.x !== start.x ? 'x' : previous.z !== start.z ? 'z' : null
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
    while (cursor[axis] !== target) {
      cursor[axis] += Math.sign(target - cursor[axis])
      appendTraceCell(trace, { ...cursor })
    }
  }

  return trace
}
