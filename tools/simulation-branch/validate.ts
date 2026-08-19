import assert from 'node:assert/strict'
import { createEmptyProjectData } from '../../src/data/emptyProject'
import { compareSimulationBranches } from '../../src/domain/simulationBranch'
import { simulationBranchRepository } from '../../src/repository/simulationBranchRepository'
import { forgeSimulationKernel } from '../../src/store/useForgeStore'
import type { FactoryObject, Item, Recipe } from '../../src/types'

const project = createEmptyProjectData({ factoryId: 'branch-factory', floorId: 'branch-floor', widthM: 24, lengthM: 18 })
const now = '2026-08-19T00:00:00.000Z'
const raw: Item = { id: 'raw', code: 'RAW', name: '原料', category: 'raw-material', description: '', itemModelId: 'BASIC_BOX', modelParameters: {}, icon: null, massKg: 1, maxStackSize: 100 }
const finished: Item = { ...raw, id: 'finished', code: 'FINISHED', name: '成品', category: 'finished-good' }
const recipe: Recipe = { id: 'recipe', code: 'R-1', name: '加工', description: '', inputs: [{ itemId: raw.id, quantity: 1 }], outputs: [{ itemId: finished.id, quantity: 1 }], processingTimeSec: 2, enabled: true }
const machine: FactoryObject = {
  id: 'machine', factoryId: project.factory.id, floorId: project.floors[0].id, kind: 'machine', name: '机器', modelRef: null,
  transform: { x: 2, z: 2, rotationY: 0 }, footprint: { width: 6, depth: 6 }, status: 'ready', createdAt: now, updatedAt: now,
  config: { kind: 'machine', recipeId: recipe.id, inputCapacity: 100, outputCapacity: 100, speedMultiplier: 1, inputPortCount: 3, outputPortCount: 3 },
}
const conveyor: FactoryObject = {
  id: 'conveyor', factoryId: project.factory.id, floorId: project.floors[0].id, kind: 'conveyor', name: '出货带', modelRef: null,
  transform: { x: 8, z: 5, rotationY: 0 }, footprint: { width: 4, depth: 1 }, status: 'ready', createdAt: now, updatedAt: now,
  config: { kind: 'conveyor', conveyorType: 'flat', fromObjectId: machine.id, toObjectId: 'finished-goods', fromPortIndex: 1, toPortIndex: null, fromFloorId: project.floors[0].id, toFloorId: project.floors[0].id, riseM: 0, outputItemId: finished.id, speedMps: 8, capacity: 20, path: [{ x: 8, z: 5 }, { x: 12, z: 5 }] },
}
project.items = [raw, finished]
project.recipes = [recipe]
project.objects = [machine, conveyor]
project.inventory = [{ id: 'finished-stock', locationType: 'finished-goods', locationId: 'finished-goods', itemId: finished.id, quantity: 0, initialQuantity: 0, capacity: 10_000, reservedOutboundQuantity: 0, reservedInboundCapacity: 0 }]
project.simulation.machineRuntime[machine.id] = { machineObjectId: machine.id, recipeId: recipe.id, state: 'waiting-input', progress: 0, cycleRemainingSec: 0, inputBuffer: { [raw.id]: 100 }, outputBuffer: { [finished.id]: 0 }, processedCycles: 0, busySeconds: 0, idleSeconds: 0, blockedSeconds: 0 }

const result = compareSimulationBranches(project, [{ op: 'update_object', object_id: machine.id, changes: { config: { speedMultiplier: 2 } } }], 30, forgeSimulationKernel)
assert.ok(result.proposal.totalProduced > result.baseline.totalProduced)
assert.ok(result.delta.throughputPerMin > 0)
assert.equal(result.recommendation, 'apply')
assert.equal(result.steps, 120)

const originalWorker = globalThis.Worker
Object.defineProperty(globalThis, 'Worker', {
  configurable: true,
  value: class BrokenWorker {
    constructor() { throw new Error('worker construction failed') }
  } as unknown as typeof Worker,
})
const fallbackResult = await simulationBranchRepository.compare(project, [{ op: 'update_object', object_id: machine.id, changes: { config: { speedMultiplier: 2 } } }], 30)
if (originalWorker === undefined) delete (globalThis as { Worker?: typeof Worker }).Worker
else Object.defineProperty(globalThis, 'Worker', { configurable: true, value: originalWorker })
assert.deepEqual(fallbackResult.baseline, result.baseline)
assert.deepEqual(fallbackResult.proposal, result.proposal)
assert.equal(fallbackResult.recommendation, 'apply')

console.log(JSON.stringify({ ...result, workerConstructionFallback: true }, null, 2))
