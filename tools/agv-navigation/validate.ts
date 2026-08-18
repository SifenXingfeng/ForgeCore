import assert from 'node:assert/strict'
import { AGV_VEHICLE_SEPARATION_M, agvPathLength, findShortestAgvPath } from '../../src/domain/agvPathfinding'
import { agvRemainingRoutePoints } from '../../src/domain/agvRouteVisual'
import { useForgeStore } from '../../src/store/useForgeStore'
import type { Factory, FactoryObject, Item } from '../../src/types'

const now = '2026-08-17T00:00:00.000Z'

const routeVisualPoints = agvRemainingRoutePoints({
  position: { x: 1.5, z: 0 },
  path: [{ x: 0, z: 0 }, { x: 1, z: 0 }, { x: 2, z: 0 }, { x: 3, z: 0 }],
  waypointIndex: 2,
})
assert.deepEqual(routeVisualPoints, [
  { x: 1.5, z: 0 },
  { x: 2, z: 0 },
  { x: 3, z: 0 },
], 'route visual should start at the vehicle and continue toward unvisited waypoints without reconnecting the previous waypoint')

const factory: Factory = {
  id: 'factory-agv-validation',
  name: 'AGV navigation validation',
  widthM: 40,
  lengthM: 40,
  gridSizeM: 1,
  schemaVersion: 3,
  createdAt: now,
  updatedAt: now,
}

const vehicle: FactoryObject = {
  id: 'agv-validation',
  factoryId: factory.id,
  floorId: 'floor-1',
  kind: 'agv',
  name: 'AGV validation',
  modelRef: null,
  transform: { x: 2, z: 2, rotationY: 0 },
  footprint: { width: 4, depth: 4 },
  status: 'ready',
  config: {
    kind: 'vehicle',
    vehicleType: 'agv',
    capabilityId: 'capability-agv',
    runtimeAssetStatus: 'vendor-only',
    maxPayloadKg: 500,
    speedMps: 2,
    batteryLevelPercent: null,
  },
  createdAt: now,
  updatedAt: now,
}

const destination: FactoryObject = {
  id: 'shelf-destination',
  factoryId: factory.id,
  floorId: 'floor-1',
  kind: 'shelf',
  name: 'Destination shelf',
  modelRef: null,
  transform: { x: 26, z: 26, rotationY: 0 },
  footprint: { width: 8, depth: 2 },
  status: 'ready',
  config: { kind: 'shelf', storageType: 'unbounded', runtimeAssetStatus: 'proxy' },
  createdAt: now,
  updatedAt: now,
}

const diagonalPath = findShortestAgvPath({
  factory,
  objects: [vehicle, destination],
  floorId: 'floor-1',
  vehicleObjectId: vehicle.id,
  start: { x: 4, z: 4 },
  destinationObjectId: destination.id,
})
assert(diagonalPath, 'open-floor route should be reachable')
assert(diagonalPath.slice(1).some((point, index) => {
  const previous = diagonalPath[index]
  return Math.abs(point.x - previous.x) > 0.5 && Math.abs(point.z - previous.z) > 0.5
}), 'open-floor shortest route should contain diagonal steps')
const diagonalEnd = diagonalPath.at(-1)!
const fourDirectionLength = Math.abs(diagonalEnd.x - diagonalPath[0].x) + Math.abs(diagonalEnd.z - diagonalPath[0].z)
assert(agvPathLength(diagonalPath) < fourDirectionLength - 1, 'diagonal route should be shorter than a four-direction route')

const cornerSafePath = findShortestAgvPath({
  factory,
  objects: [vehicle, destination],
  floorId: 'floor-1',
  vehicleObjectId: vehicle.id,
  start: { x: 4, z: 4 },
  destinationObjectId: destination.id,
  dynamicObstacles: [
    { x: 5, z: 4, radiusM: 0.75 },
    { x: 4, z: 5, radiusM: 0.75 },
  ],
})
assert(cornerSafePath, 'corner test route should still find a detour')
assert.notDeepEqual(cornerSafePath[1], { x: 5, z: 5 }, 'diagonal path must not cut between two blocked orthogonal cells')

const store = useForgeStore
store.getState().createFactory({ name: 'AGV dynamic reroute validation', widthM: 52, lengthM: 32, gridSizeM: 1 })
const item: Item = {
  id: 'item-agv-validation',
  code: 'AGV-VALIDATION',
  name: 'AGV 验证货物',
  category: 'raw-material',
  description: 'AGV navigation regression fixture',
  itemModelId: 'BASIC_BOX',
  modelParameters: {},
  icon: null,
  massKg: 1,
  maxStackSize: 100,
}
assert(store.getState().upsertItem(item), 'validation item should be accepted')
const sourceId = store.getState().addObject({ kind: 'shelf', name: 'Source', transform: { x: 2, z: 14, rotationY: 0 } })
const destinationId = store.getState().addObject({ kind: 'shelf', name: 'Destination', transform: { x: 42, z: 14, rotationY: 0 } })
const activeAgvId = store.getState().addObject({ kind: 'agv', name: 'Active AGV', transform: { x: 10, z: 13, rotationY: 0 } })
const parkedAgvId = store.getState().addObject({ kind: 'agv', name: 'Parked AGV', transform: { x: 24, z: 3, rotationY: 0 } })
assert(sourceId && destinationId && activeAgvId && parkedAgvId, 'validation objects should be placed')
const sourceInventory = store.getState().inventory.find((record) => record.locationId.startsWith(`${sourceId}:`) && record.itemId === item.id)
assert(sourceInventory, 'source inventory record should exist')
assert(store.getState().adjustInventory(sourceInventory.id, 20), 'source inventory should be filled')
store.getState().updateObjectConfig(activeAgvId, {
  agvProgram: {
    enabled: true,
    sourceObjectId: sourceId,
    destinationObjectId: destinationId,
    itemId: item.id,
    loadQuantity: 20,
    triggerLocation: 'source',
    triggerComparator: 'at-least',
    triggerQuantity: 20,
  },
})
store.getState().playSimulation()
store.getState().setSimulationSpeed(10)

let loaded = false
for (let tick = 0; tick < 20; tick += 1) {
  store.getState().tickSimulation(0.025)
  if (store.getState().simulation.agvRuntime[activeAgvId]?.phase === 'to-destination') {
    loaded = true
    break
  }
}
assert(loaded, 'active AGV should load and begin its destination route')
assert(store.getState().moveObject(parkedAgvId, { x: 24, z: 13 }), 'parked AGV should be moved onto the already planned route')
const parkedPosition = { ...store.getState().simulation.agvRuntime[parkedAgvId].position }
let minSeparation = Number.POSITIVE_INFINITY
let maximumLateralDetour = 0
let maximumConsecutiveBlockedTicks = 0
let consecutiveBlockedTicks = 0
for (let tick = 0; tick < 800; tick += 1) {
  store.getState().tickSimulation(0.025)
  const state = store.getState()
  const active = state.simulation.agvRuntime[activeAgvId]
  const parked = state.simulation.agvRuntime[parkedAgvId]
  minSeparation = Math.min(minSeparation, Math.hypot(active.position.x - parked.position.x, active.position.z - parked.position.z))
  maximumLateralDetour = Math.max(maximumLateralDetour, Math.abs(active.position.z - 15))
  consecutiveBlockedTicks = active.motionStatus === 'blocked' ? consecutiveBlockedTicks + 1 : 0
  maximumConsecutiveBlockedTicks = Math.max(maximumConsecutiveBlockedTicks, consecutiveBlockedTicks)
  if (active.completedTrips >= 1) break
}
const finalState = store.getState()
const activeRuntime = finalState.simulation.agvRuntime[activeAgvId]
const parkedRuntime = finalState.simulation.agvRuntime[parkedAgvId]
const destinationInventory = finalState.inventory.find((record) => record.locationId.startsWith(`${destinationId}:`) && record.itemId === item.id)
assert.equal(activeRuntime.completedTrips, 1, 'active AGV should complete transport instead of stopping behind the parked vehicle')
assert.equal(destinationInventory?.quantity, 20, 'transported inventory should arrive at the destination')
assert.deepEqual(parkedRuntime.position, parkedPosition, 'parked AGV should not be moved by the coordinator')
assert(minSeparation >= AGV_VEHICLE_SEPARATION_M - 1e-6, 'vehicles must maintain the required center separation')
assert(maximumLateralDetour >= 3, 'active AGV should visibly route around the parked vehicle')
assert(maximumConsecutiveBlockedTicks < 8, 'dynamic rerouting should prevent an indefinite stop')

store.getState().createFactory({ name: 'AGV bidirectional coordination validation', widthM: 52, lengthM: 32, gridSizeM: 1 })
const itemA: Item = { ...item, id: 'item-agv-a', code: 'AGV-A', name: 'A 向货物' }
const itemB: Item = { ...item, id: 'item-agv-b', code: 'AGV-B', name: 'B 向货物' }
assert(store.getState().upsertItem(itemA) && store.getState().upsertItem(itemB), 'coordination items should be accepted')
const leftShelfId = store.getState().addObject({ kind: 'shelf', name: 'Left shelf', transform: { x: 2, z: 14, rotationY: 0 } })
const rightShelfId = store.getState().addObject({ kind: 'shelf', name: 'Right shelf', transform: { x: 42, z: 14, rotationY: 0 } })
const agvAId = store.getState().addObject({ kind: 'agv', name: 'AGV-A', transform: { x: 10, z: 13, rotationY: 0 } })
const agvBId = store.getState().addObject({ kind: 'agv', name: 'AGV-B', transform: { x: 38, z: 13, rotationY: 180 } })
assert(leftShelfId && rightShelfId && agvAId && agvBId, 'coordination objects should be placed')
const leftA = store.getState().inventory.find((record) => record.locationId.startsWith(`${leftShelfId}:`) && record.itemId === itemA.id)
const rightB = store.getState().inventory.find((record) => record.locationId.startsWith(`${rightShelfId}:`) && record.itemId === itemB.id)
assert(leftA && rightB, 'coordination source inventory should exist')
assert(store.getState().adjustInventory(leftA.id, 20) && store.getState().adjustInventory(rightB.id, 20), 'coordination source inventory should be filled')
store.getState().updateObjectConfig(agvAId, {
  agvProgram: {
    enabled: true,
    sourceObjectId: leftShelfId,
    destinationObjectId: rightShelfId,
    itemId: itemA.id,
    loadQuantity: 20,
    triggerLocation: 'source',
    triggerComparator: 'at-least',
    triggerQuantity: 20,
  },
})
store.getState().updateObjectConfig(agvBId, {
  agvProgram: {
    enabled: true,
    sourceObjectId: rightShelfId,
    destinationObjectId: leftShelfId,
    itemId: itemB.id,
    loadQuantity: 20,
    triggerLocation: 'source',
    triggerComparator: 'at-least',
    triggerQuantity: 20,
  },
})
store.getState().playSimulation()
store.getState().setSimulationSpeed(10)
let bidirectionalMinimumSeparation = Number.POSITIVE_INFINITY
let bidirectionalMaximumBlockedTicks = 0
let agvABlockedTicks = 0
let agvBBlockedTicks = 0
let sawCoordinatedYield = false
for (let tick = 0; tick < 1600; tick += 1) {
  store.getState().tickSimulation(0.025)
  const state = store.getState()
  const runtimeA = state.simulation.agvRuntime[agvAId]
  const runtimeB = state.simulation.agvRuntime[agvBId]
  bidirectionalMinimumSeparation = Math.min(
    bidirectionalMinimumSeparation,
    Math.hypot(runtimeA.position.x - runtimeB.position.x, runtimeA.position.z - runtimeB.position.z),
  )
  agvABlockedTicks = runtimeA.motionStatus === 'blocked' ? agvABlockedTicks + 1 : 0
  agvBBlockedTicks = runtimeB.motionStatus === 'blocked' ? agvBBlockedTicks + 1 : 0
  bidirectionalMaximumBlockedTicks = Math.max(bidirectionalMaximumBlockedTicks, agvABlockedTicks, agvBBlockedTicks)
  sawCoordinatedYield ||= runtimeA.motionStatus === 'yielding' || runtimeB.motionStatus === 'yielding'
  if (runtimeA.completedTrips >= 1 && runtimeB.completedTrips >= 1) break
}
const coordinationState = store.getState()
const runtimeA = coordinationState.simulation.agvRuntime[agvAId]
const runtimeB = coordinationState.simulation.agvRuntime[agvBId]
assert.equal(runtimeA.completedTrips, 1, 'AGV-A should finish the bidirectional transport')
assert.equal(runtimeB.completedTrips, 1, 'AGV-B should finish the bidirectional transport')
assert(bidirectionalMinimumSeparation >= AGV_VEHICLE_SEPARATION_M - 1e-6, 'bidirectional vehicles must maintain the required center separation')
assert(bidirectionalMaximumBlockedTicks < 40, 'fixed priority coordination should not deadlock')

store.getState().createFactory({ name: 'AGV shared dock validation', widthM: 68, lengthM: 46, gridSizeM: 1 })
const sharedDockItemA: Item = { ...item, id: 'item-agv-shared-a', code: 'AGV-DOCK-A', name: 'AGV 共享货架货物 A' }
const sharedDockItemB: Item = { ...item, id: 'item-agv-shared-b', code: 'AGV-DOCK-B', name: 'AGV 共享货架货物 B' }
assert(store.getState().upsertItem(sharedDockItemA) && store.getState().upsertItem(sharedDockItemB), 'shared-dock items should be accepted')
const sharedSourceAId = store.getState().addObject({ kind: 'shelf', name: 'AGV shared source A', transform: { x: 2, z: 7, rotationY: 0 } })
const sharedSourceBId = store.getState().addObject({ kind: 'shelf', name: 'AGV shared source B', transform: { x: 2, z: 35, rotationY: 0 } })
const sharedDestinationId = store.getState().addObject({ kind: 'shelf', name: 'AGV shared destination', transform: { x: 56, z: 21, rotationY: 0 } })
const sharedAgvAId = store.getState().addObject({ kind: 'agv', name: 'Shared Dock AGV-A', transform: { x: 14, z: 7, rotationY: 0 } })
const sharedAgvBId = store.getState().addObject({ kind: 'agv', name: 'Shared Dock AGV-B', transform: { x: 14, z: 34, rotationY: 0 } })
assert(sharedSourceAId && sharedSourceBId && sharedDestinationId && sharedAgvAId && sharedAgvBId, 'AGV shared-dock fixtures should be placed')
const sharedSourceAInventory = store.getState().inventory.find((record) => record.locationId.startsWith(`${sharedSourceAId}:`) && record.itemId === sharedDockItemA.id)
const sharedSourceBInventory = store.getState().inventory.find((record) => record.locationId.startsWith(`${sharedSourceBId}:`) && record.itemId === sharedDockItemB.id)
assert(sharedSourceAInventory && sharedSourceBInventory, 'AGV shared-dock source inventories should exist')
assert(store.getState().adjustInventory(sharedSourceAInventory.id, 8) && store.getState().adjustInventory(sharedSourceBInventory.id, 8), 'AGV shared-dock sources should be filled')
store.getState().updateObjectConfig(sharedAgvAId, {
  speedMps: 6,
  agvProgram: { enabled: true, sourceObjectId: sharedSourceAId, destinationObjectId: sharedDestinationId, itemId: sharedDockItemA.id, loadQuantity: 8, triggerLocation: 'source', triggerComparator: 'at-least', triggerQuantity: 8 },
})
store.getState().updateObjectConfig(sharedAgvBId, {
  speedMps: 6,
  agvProgram: { enabled: true, sourceObjectId: sharedSourceBId, destinationObjectId: sharedDestinationId, itemId: sharedDockItemB.id, loadQuantity: 8, triggerLocation: 'source', triggerComparator: 'at-least', triggerQuantity: 8 },
})
store.getState().playSimulation()
store.getState().setSimulationSpeed(10)
let sharedDockMinimumSeparation = Number.POSITIVE_INFINITY
let sawSharedDockQueue = false
for (let tick = 0; tick < 4000; tick += 1) {
  store.getState().tickSimulation(0.025)
  const state = store.getState()
  const sharedRuntimeA = state.simulation.agvRuntime[sharedAgvAId]
  const sharedRuntimeB = state.simulation.agvRuntime[sharedAgvBId]
  sharedDockMinimumSeparation = Math.min(
    sharedDockMinimumSeparation,
    Math.hypot(sharedRuntimeA.position.x - sharedRuntimeB.position.x, sharedRuntimeA.position.z - sharedRuntimeB.position.z),
  )
  sawSharedDockQueue ||= sharedRuntimeA.blockedReason?.includes('共享装卸位') === true || sharedRuntimeB.blockedReason?.includes('共享装卸位') === true
  if (sharedRuntimeA.completedTrips >= 1 && sharedRuntimeB.completedTrips >= 1) break
}
const sharedDockState = store.getState()
const sharedRuntimeA = sharedDockState.simulation.agvRuntime[sharedAgvAId]
const sharedRuntimeB = sharedDockState.simulation.agvRuntime[sharedAgvBId]
const sharedDestinationAInventory = sharedDockState.inventory.find((record) => record.locationId.startsWith(`${sharedDestinationId}:`) && record.itemId === sharedDockItemA.id)
const sharedDestinationBInventory = sharedDockState.inventory.find((record) => record.locationId.startsWith(`${sharedDestinationId}:`) && record.itemId === sharedDockItemB.id)
assert.equal(sharedRuntimeA.completedTrips, 1, 'the first AGV should finish storing at the shared shelf')
assert.equal(sharedRuntimeB.completedTrips, 1, 'the queued AGV should enter after dock egress and finish storing')
assert.equal(sharedDestinationAInventory?.quantity, 8, 'the shared shelf should receive AGV-A cargo exactly once')
assert.equal(sharedDestinationBInventory?.quantity, 8, 'the shared shelf should receive AGV-B cargo exactly once')
assert(sawSharedDockQueue, 'one AGV should visibly queue outside the shared docking area')
assert(sharedDockMinimumSeparation >= AGV_VEHICLE_SEPARATION_M - 1e-6, 'AGV shared-dock coordination must preserve vehicle separation')

console.log(JSON.stringify({
  diagonalPathLengthM: Number(agvPathLength(diagonalPath).toFixed(3)),
  fourDirectionLengthM: fourDirectionLength,
  diagonalSteps: diagonalPath.length - 1,
  parkedVehicleDetourM: Number(maximumLateralDetour.toFixed(3)),
  minimumVehicleSeparationM: Number(minSeparation.toFixed(3)),
  maximumConsecutiveBlockedTicks,
  completedTrips: activeRuntime.completedTrips,
  destinationQuantity: destinationInventory?.quantity ?? 0,
  bidirectionalMinimumSeparationM: Number(bidirectionalMinimumSeparation.toFixed(3)),
  bidirectionalMaximumBlockedTicks,
  sawCoordinatedYield,
  bidirectionalCompletedTrips: [runtimeA.completedTrips, runtimeB.completedTrips],
  sharedDockMinimumSeparationM: Number(sharedDockMinimumSeparation.toFixed(3)),
  sharedDockQueueObserved: sawSharedDockQueue,
  sharedDockCompletedTrips: [sharedRuntimeA.completedTrips, sharedRuntimeB.completedTrips],
}, null, 2))
