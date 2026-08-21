import { BASE_A01_OBJECTS } from '../src/game/baseA01'
import { canPlace } from '../src/game/grid'
import { DEFAULT_RECIPES } from '../src/game/item'
import { SimulationEngine } from '../src/game/simulation'
import type { BuildType } from '../src/game/types'

const requiredTypes: BuildType[] = [
  'source', 'oreMiner', 'agv', 'conveyor', 'smelter', 'press', 'washing',
  'machine', 'assembler', 'inspection', 'splitter', 'storage',
]

for (const [index, object] of BASE_A01_OBJECTS.entries()) {
  const previous = BASE_A01_OBJECTS.slice(0, index)
  if (!canPlace(object.pos, object.type, object.rotation, previous)) {
    throw new Error(`A01 layout collision or boundary violation: ${object.id}`)
  }
}

for (const type of requiredTypes) {
  if (!BASE_A01_OBJECTS.some((object) => object.type === type)) {
    throw new Error(`A01 layout is missing required facility type: ${type}`)
  }
}

const engine = new SimulationEngine(20260814)
engine.init(BASE_A01_OBJECTS, DEFAULT_RECIPES)
engine.advance(300)

const snapshot = engine.getSnapshot()
const completedMotors = snapshot.stats.produced.item_inspected_motor ?? 0
const assembledMotors = snapshot.stats.produced.item_motor ?? 0

if (assembledMotors <= 0 || completedMotors <= 0) {
  console.error(JSON.stringify({ machines: snapshot.machines, produced: snapshot.stats.produced, consumed: snapshot.stats.consumed, lots: snapshot.itemLots }, null, 2))
  throw new Error(`A01 line did not close the production loop: assembled=${assembledMotors}, completed=${completedMotors}`)
}

console.log(`A01 validation passed: ${BASE_A01_OBJECTS.length} facilities, ${assembledMotors} assembled motors, ${completedMotors} inspected/packed motors in 300 s.`)
