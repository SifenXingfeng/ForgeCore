import { createBaseA01Layout } from '../src/game/baseA01'
import { DEFAULT_RECIPES } from '../src/game/item'
import { AGV_CENTER_CLEARANCE } from '../src/game/agvNavigation'
import { SimulationEngine } from '../src/game/simulation'

const engine = new SimulationEngine(20260818)
const objects = createBaseA01Layout()
engine.init(objects, DEFAULT_RECIPES)
engine.advance(0.05)
const initial = engine.getSnapshot().agvs
let minSeparation = Number.POSITIVE_INFINITY
let maxYieldCount = 0

for (let second = 0; second < 60; second += 1) {
  engine.advance(1)
  const snapshot = engine.getSnapshot().agvs
  for (let left = 0; left < snapshot.length; left += 1) {
    for (let right = left + 1; right < snapshot.length; right += 1) {
      const a = snapshot[left]
      const b = snapshot[right]
      minSeparation = Math.min(minSeparation, Math.hypot(a.position.x - b.position.x, a.position.z - b.position.z))
    }
    maxYieldCount = Math.max(maxYieldCount, snapshot[left].yieldCount)
  }
}

const final = engine.getSnapshot().agvs
const moved = final.filter((agv) => {
  const start = initial.find((candidate) => candidate.objectId === agv.objectId)
  return start && agv.distanceTravelled > 0 && Math.hypot(agv.position.x - start.position.x, agv.position.z - start.position.z) > 0.1
})

console.log(JSON.stringify(final.map((agv) => ({ id: agv.objectId, pos: { x: Number(agv.position.x.toFixed(1)), z: Number(agv.position.z.toFixed(1)) }, phase: agv.phase, status: agv.motionStatus, decision: agv.decision, distance: Number(agv.distanceTravelled.toFixed(2)), cargo: agv.cargoQuantity, trips: agv.completedTrips })), null, 2))
if (moved.length === 0) throw new Error('AGV 导航没有产生位移')
if (minSeparation + 0.02 < AGV_CENTER_CLEARANCE) {
  throw new Error(`AGV 车身安全距离不足：${minSeparation.toFixed(2)}m < ${AGV_CENTER_CLEARANCE.toFixed(2)}m`)
}
console.log(`✅ AGV 导航检查通过：${moved.length}/${final.length} 台车辆已移动，最小车间距 ${minSeparation.toFixed(2)}m，最大让行次数 ${maxYieldCount}`)
