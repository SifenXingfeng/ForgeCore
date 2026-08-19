import assert from 'node:assert/strict'
import { createEmptyProjectData } from '../../src/data/emptyProject'
import { runSimulationSteps } from '../../src/domain/advanceSimulation'
import { forgeSimulationKernel, useForgeStore } from '../../src/store/useForgeStore'

const base = createEmptyProjectData({
  factoryId: 'factory-simulation-engine-validation',
  floorId: 'floor-simulation-engine-validation',
  name: 'Shared simulation engine validation',
  widthM: 24,
  lengthM: 18,
  gridSizeM: 1,
})
base.simulation.status = 'running'

const direct = structuredClone(base)
runSimulationSteps(direct, 4, forgeSimulationKernel)

useForgeStore.setState(structuredClone(base))
useForgeStore.getState().tickSimulation(1)
const browserStore = useForgeStore.getState()

assert.deepEqual(browserStore.simulation, direct.simulation)
assert.deepEqual(browserStore.inventory, direct.inventory)
assert.deepEqual(browserStore.metrics, direct.metrics)
assert.deepEqual(browserStore.metricSeries, direct.metricSeries)
assert.deepEqual(browserStore.activities, direct.activities)
assert.equal(direct.simulation.elapsedSimSec, 1)
assert.equal(direct.simulation.tickCount, 4)

console.log(JSON.stringify({
  sharedEngine: true,
  elapsedSimSec: direct.simulation.elapsedSimSec,
  tickCount: direct.simulation.tickCount,
}, null, 2))
