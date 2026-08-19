import assert from 'node:assert/strict'
import { createEmptyProjectData } from '../../src/data/emptyProject'
import { useForgeStore } from '../../src/store/useForgeStore'

const base = createEmptyProjectData({
  factoryId: 'agent-workflow-factory',
  floorId: 'agent-workflow-floor',
  widthM: 24,
  lengthM: 18,
})
useForgeStore.setState({ ...structuredClone(base), selectedObjectId: null, saveStatus: 'idle' })

const floorId = base.floors[0].id
const agv = (id: string, x: number) => ({
  id,
  kind: 'agv',
  floorId,
  name: `Agent ${id}`,
  transform: { x, z: 0, rotationY: 0 },
  footprint: { width: 4, depth: 4 },
  config: {
    kind: 'vehicle',
    vehicleType: 'agv',
    capabilityId: 'capability-agv',
    runtimeAssetStatus: 'vendor-only',
    maxPayloadKg: 500,
    speedMps: 2,
    batteryLevelPercent: null,
  },
})

const committed = useForgeStore.getState().commitAgentDesign({
  factory: { ...base.factory, designVersion: 1 },
  objects: [agv('obj-agv-1', 0), agv('obj-agv-2', 6)],
  inventory: [],
})
assert.equal(committed, true)
assert.equal(useForgeStore.getState().objects.length, 2)
assert.equal(Object.keys(useForgeStore.getState().simulation.agvRuntime).length, 2)

const beforeInvalid = structuredClone(useForgeStore.getState().objects)
const rejected = useForgeStore.getState().commitAgentDesign({
  factory: { ...base.factory, designVersion: 2 },
  objects: [agv('obj-agv-1', 0), { id: 'bad-object', kind: 'unsupported', transform: { x: 0, z: 0 } }],
  inventory: [],
})
assert.equal(rejected, false)
assert.deepEqual(useForgeStore.getState().objects, beforeInvalid)

const updated = useForgeStore.getState().commitAgentDesign({
  factory: { ...base.factory, designVersion: 2 },
  objects: [{ ...agv('obj-agv-1', 0), name: '更新后的 AGV', config: { ...agv('obj-agv-1', 0).config, speedMps: 3 } }],
  inventory: [],
})
assert.equal(updated, true)
assert.equal(useForgeStore.getState().objects.length, 1)
assert.equal(useForgeStore.getState().objects[0].name, '更新后的 AGV')
assert.equal(useForgeStore.getState().objects[0].config.kind, 'vehicle')
assert.equal(Object.keys(useForgeStore.getState().simulation.agvRuntime).length, 1)

console.log(JSON.stringify({
  atomicCommit: true,
  invalidCandidatePreservedState: true,
  remainingObjects: useForgeStore.getState().objects.length,
  remainingAgvRuntimes: Object.keys(useForgeStore.getState().simulation.agvRuntime).length,
}, null, 2))
