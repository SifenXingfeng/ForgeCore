import assert from 'node:assert/strict'
import {
  DRONE_NAVIGATION_CLEARANCE_M,
  DRONE_VEHICLE_SEPARATION_M,
  droneDockingPoints,
  dronePathLength,
  findShortestDronePath,
} from '../../src/domain/dronePathfinding'
import { useForgeStore } from '../../src/store/useForgeStore'
import type { Factory, FactoryObject, Floor, Item } from '../../src/types'

const now = '2026-08-17T00:00:00.000Z'
const factory: Factory = {
  id: 'factory-drone-validation',
  name: 'Drone 3D navigation validation',
  widthM: 44,
  lengthM: 36,
  gridSizeM: 1,
  schemaVersion: 3,
  createdAt: now,
  updatedAt: now,
}
const floors: Floor[] = [
  { id: 'floor-1', factoryId: factory.id, level: 1, name: '1F', elevationM: 0, heightM: 4.5 },
  { id: 'floor-2', factoryId: factory.id, level: 2, name: '2F', elevationM: 4.5, heightM: 4.5 },
  { id: 'floor-3', factoryId: factory.id, level: 3, name: '3F', elevationM: 9, heightM: 4.5 },
]
const object = (patch: Partial<FactoryObject> & Pick<FactoryObject, 'id' | 'kind' | 'floorId' | 'transform' | 'footprint'>): FactoryObject => ({
  factoryId: factory.id,
  name: patch.id,
  modelRef: null,
  status: 'ready',
  config: patch.kind === 'shelf'
    ? { kind: 'shelf', storageType: 'unbounded', runtimeAssetStatus: 'proxy' }
    : patch.kind === 'rack'
      ? { kind: 'rack', slotCount: 18, slotCapacity: 100, dispatchIntervalSecByPort: [2.5, 2.5, 2.5], storageType: 'mixed', runtimeAssetStatus: 'proxy', inputPortCount: 3, outputPortCount: 3 }
    : patch.kind === 'drone'
      ? { kind: 'vehicle', vehicleType: 'drone', capabilityId: 'capability-drone', runtimeAssetStatus: 'vendor-only', maxPayloadKg: 30, speedMps: 4, batteryLevelPercent: null }
      : { kind: 'buffer', capacity: 1 },
  createdAt: now,
  updatedAt: now,
  ...patch,
})

const drone = object({ id: 'drone-path-test', kind: 'drone', floorId: 'floor-1', transform: { x: 2, z: 2, rotationY: 0 }, footprint: { width: 3, depth: 3 } })
const upperDestination = object({ id: 'upper-shelf', kind: 'shelf', floorId: 'floor-3', transform: { x: 28, z: 24, rotationY: 0 }, footprint: { width: 8, depth: 2 } })
const open3dPath = findShortestDronePath({
  factory,
  floors,
  objects: [drone, upperDestination],
  vehicleObjectId: drone.id,
  start: { x: 4, y: 2, z: 4 },
  destinationObjectId: upperDestination.id,
})
assert(open3dPath, 'an unobstructed upper-floor destination should be reachable')
assert(open3dPath.slice(1).some((point, index) => {
  const previous = open3dPath[index]
  return Math.abs(point.x - previous.x) > 0.5
    && Math.abs(point.y - previous.y) > 0.5
    && Math.abs(point.z - previous.z) > 0.5
}), 'the 26-neighbor route should use cube/body-diagonal movement when it is shortest')
const openEnd = open3dPath.at(-1)!
const axisOnlyLength = Math.abs(openEnd.x - open3dPath[0].x) + Math.abs(openEnd.y - open3dPath[0].y) + Math.abs(openEnd.z - open3dPath[0].z)
assert(dronePathLength(open3dPath) < axisOnlyLength - 1, '3D diagonals should beat an axis-only route')

const portWarehouse = object({ id: 'port-warehouse', kind: 'rack', floorId: 'floor-2', transform: { x: 20, z: 10, rotationY: 0 }, footprint: { width: 6, depth: 6 } })
const overheadWarehouse = object({ id: 'overhead-warehouse', kind: 'machine', floorId: 'floor-3', transform: { x: 20, z: 10, rotationY: 0 }, footprint: { width: 6, depth: 6 } })
const pickupPortPath = findShortestDronePath({
  factory,
  floors,
  objects: [drone, portWarehouse, overheadWarehouse],
  vehicleObjectId: drone.id,
  start: { x: 4, y: 2, z: 13 },
  destinationObjectId: portWarehouse.id,
  dockingRole: 'pickup',
})
const dropoffPortPath = findShortestDronePath({
  factory,
  floors,
  objects: [drone, portWarehouse, overheadWarehouse],
  vehicleObjectId: drone.id,
  start: { x: 38, y: 2, z: 13 },
  destinationObjectId: portWarehouse.id,
  dockingRole: 'dropoff',
})
assert(pickupPortPath && dropoffPortPath, 'warehouse port docking should stay reachable when an upper-floor building blocks the roof')
assert.equal(pickupPortPath.at(-1)?.x, 28, '0° warehouse pickup must finish outside the +X output ports')
assert.equal(dropoffPortPath.at(-1)?.x, 18, '0° warehouse dropoff must finish outside the -X input ports')
assert.equal(pickupPortPath.at(-1)?.y, 7, 'warehouse port docking should hover at the owning floor flight height')
const rotatedWarehouse = object({ id: 'rotated-port-warehouse', kind: 'rack', floorId: 'floor-1', transform: { x: 30, z: 15, rotationY: 90 }, footprint: { width: 6, depth: 6 } })
const rotatedPickupPorts = droneDockingPoints({ factory, floors, objects: [rotatedWarehouse], destinationObjectId: rotatedWarehouse.id, dockingRole: 'pickup' })
const rotatedDropoffPorts = droneDockingPoints({ factory, floors, objects: [rotatedWarehouse], destinationObjectId: rotatedWarehouse.id, dockingRole: 'dropoff' })
assert(rotatedPickupPorts.every((point) => point.z === 13), '90° warehouse pickup ports must rotate to the -Z output side')
assert(rotatedDropoffPorts.every((point) => point.z === 23), '90° warehouse dropoff ports must rotate to the +Z input side')

const lowerDestination = object({ id: 'lower-shelf', kind: 'shelf', floorId: 'floor-1', transform: { x: 30, z: 25, rotationY: 0 }, footprint: { width: 8, depth: 2 } })
const upperBuilding = object({ id: 'upper-buffer', kind: 'buffer', floorId: 'floor-2', transform: { x: 1, z: 1, rotationY: 0 }, footprint: { width: 7, depth: 7 } })
const descendingPath = findShortestDronePath({
  factory,
  floors,
  objects: [drone, lowerDestination, upperBuilding],
  vehicleObjectId: drone.id,
  start: { x: 4, y: 12, z: 4 },
  destinationObjectId: lowerDestination.id,
})
assert(descendingPath, 'a lower-floor destination should be reachable after leaving the obstructed column')
let firstDescentIndex = -1
descendingPath.slice(1).forEach((point, index) => {
  const previous = descendingPath[index]
  if (point.y < previous.y) {
    if (firstDescentIndex < 0) firstDescentIndex = index + 1
    assert.equal(point.x, previous.x, 'descending steps must stay in one clear x column')
    assert.equal(point.z, previous.z, 'descending steps must stay in one clear z column')
  }
})
assert(firstDescentIndex > 1, 'the drone should move horizontally out of an obstructed column before descending')

const store = useForgeStore
store.getState().createFactory({ name: 'Drone cross-floor transport validation', widthM: 52, lengthM: 38, gridSizeM: 1 })
const floor1Id = store.getState().floors[0].id
const floor2Id = store.getState().addFloor(4.5)
const floor3Id = store.getState().addFloor(4.5)
const item: Item = {
  id: 'item-drone-validation',
  code: 'DRONE-VALIDATION',
  name: '无人机验证货物',
  category: 'raw-material',
  description: 'Drone transport regression fixture',
  itemModelId: 'BASIC_BOX',
  modelParameters: {},
  icon: null,
  massKg: 5,
  maxStackSize: 100,
}
assert(store.getState().upsertItem(item), 'validation item should be accepted')
const upperSourceId = store.getState().addObject({ kind: 'rack', floorId: floor2Id, name: '2F Source Warehouse', transform: { x: 2, z: 4, rotationY: 0 } })
const lowerDestinationId = store.getState().addObject({ kind: 'rack', floorId: floor1Id, name: '1F Destination Warehouse', transform: { x: 40, z: 28, rotationY: 0 } })
const overheadSourceId = store.getState().addObject({ kind: 'machine', floorId: floor3Id, name: '3F Overhead Building', transform: { x: 2, z: 4, rotationY: 0 } })
const droneId = store.getState().addObject({ kind: 'drone', floorId: floor1Id, name: 'Cross-floor Drone', transform: { x: 15, z: 10, rotationY: 0 } })
const rejectedUpperAgvId = store.getState().addObject({ kind: 'agv', floorId: floor2Id, name: 'Illegal upper AGV', transform: { x: 15, z: 10, rotationY: 0 } })
assert(upperSourceId && lowerDestinationId && overheadSourceId && droneId, 'cross-floor warehouse fixtures should be placed')
assert.equal(rejectedUpperAgvId, '', 'AGVs must be rejected outside floor 1')
const sourceInventory = store.getState().inventory.find((record) => record.locationId.startsWith(`${upperSourceId}:`) && record.itemId === item.id)
assert(sourceInventory, 'source inventory record should exist')
assert(store.getState().adjustInventory(sourceInventory.id, 7), 'source inventory should be filled')
store.getState().updateObjectConfig(droneId, {
  maxPayloadKg: 12,
  speedMps: 8,
  transportProgram: {
    enabled: true,
    sourceObjectId: upperSourceId,
    destinationObjectId: lowerDestinationId,
    itemId: item.id,
    loadQuantity: 5,
    triggerLocation: 'source',
    triggerComparator: 'at-least',
    triggerQuantity: 5,
  },
})
store.getState().playSimulation()
store.getState().setSimulationSpeed(10)
let crossFloorMinimumY = Number.POSITIVE_INFINITY
let crossFloorMaximumY = Number.NEGATIVE_INFINITY
for (let tick = 0; tick < 1600; tick += 1) {
  store.getState().tickSimulation(0.025)
  const runtime = store.getState().simulation.droneRuntime[droneId]
  crossFloorMinimumY = Math.min(crossFloorMinimumY, runtime.position.y)
  crossFloorMaximumY = Math.max(crossFloorMaximumY, runtime.position.y)
  if (runtime.completedTrips >= 1) break
}
const transportedState = store.getState()
const transportedRuntime = transportedState.simulation.droneRuntime[droneId]
const transportedDestinationInventory = transportedState.inventory.find((record) => record.locationId.startsWith(`${lowerDestinationId}:`) && record.itemId === item.id)
assert.equal(transportedRuntime.completedTrips, 1, 'the drone should complete a real cross-floor trip')
assert.equal(transportedDestinationInventory?.quantity, 2, '12kg payload should limit a 5kg item to two units per trip')
assert.equal(transportedState.inventory.find((record) => record.id === sourceInventory.id)?.quantity, 5, 'loading should deduct the actual payload from source inventory')
assert(crossFloorMaximumY - crossFloorMinimumY >= 4, 'the runtime should visibly traverse different absolute elevations')

store.getState().createFactory({ name: 'Drone coordination validation', widthM: 52, lengthM: 38, gridSizeM: 1 })
const coordinationFloor = store.getState().floors[0].id
assert(store.getState().upsertItem({ ...item, id: 'item-drone-a', code: 'DRONE-A', name: 'A 向空运货物', massKg: 1 }))
assert(store.getState().upsertItem({ ...item, id: 'item-drone-b', code: 'DRONE-B', name: 'B 向空运货物', massKg: 1 }))
const leftShelfId = store.getState().addObject({ kind: 'shelf', floorId: coordinationFloor, name: 'Left air shelf', transform: { x: 2, z: 17, rotationY: 0 } })
const rightShelfId = store.getState().addObject({ kind: 'shelf', floorId: coordinationFloor, name: 'Right air shelf', transform: { x: 42, z: 17, rotationY: 0 } })
const droneAId = store.getState().addObject({ kind: 'drone', floorId: coordinationFloor, name: 'Drone-A', transform: { x: 12, z: 13, rotationY: 0 } })
const droneBId = store.getState().addObject({ kind: 'drone', floorId: coordinationFloor, name: 'Drone-B', transform: { x: 36, z: 22, rotationY: 180 } })
assert(leftShelfId && rightShelfId && droneAId && droneBId, 'coordination fixtures should be placed')
const itemAInventory = store.getState().inventory.find((record) => record.locationId.startsWith(`${leftShelfId}:`) && record.itemId === 'item-drone-a')
const itemBInventory = store.getState().inventory.find((record) => record.locationId.startsWith(`${rightShelfId}:`) && record.itemId === 'item-drone-b')
assert(itemAInventory && itemBInventory)
assert(store.getState().adjustInventory(itemAInventory.id, 4) && store.getState().adjustInventory(itemBInventory.id, 4))
store.getState().updateObjectConfig(droneAId, { speedMps: 8, transportProgram: { enabled: true, sourceObjectId: leftShelfId, destinationObjectId: rightShelfId, itemId: 'item-drone-a', loadQuantity: 4, triggerLocation: 'source', triggerComparator: 'at-least', triggerQuantity: 4 } })
store.getState().updateObjectConfig(droneBId, { speedMps: 8, transportProgram: { enabled: true, sourceObjectId: rightShelfId, destinationObjectId: leftShelfId, itemId: 'item-drone-b', loadQuantity: 4, triggerLocation: 'source', triggerComparator: 'at-least', triggerQuantity: 4 } })
store.getState().playSimulation()
store.getState().setSimulationSpeed(10)
let minimumDroneSeparation = Number.POSITIVE_INFINITY
let maximumConsecutiveBlockedTicks = 0
let blockedTicksA = 0
let blockedTicksB = 0
let sawYield = false
for (let tick = 0; tick < 2000; tick += 1) {
  store.getState().tickSimulation(0.025)
  const state = store.getState()
  const runtimeA = state.simulation.droneRuntime[droneAId]
  const runtimeB = state.simulation.droneRuntime[droneBId]
  minimumDroneSeparation = Math.min(minimumDroneSeparation, Math.hypot(runtimeA.position.x - runtimeB.position.x, runtimeA.position.y - runtimeB.position.y, runtimeA.position.z - runtimeB.position.z))
  blockedTicksA = runtimeA.motionStatus === 'blocked' ? blockedTicksA + 1 : 0
  blockedTicksB = runtimeB.motionStatus === 'blocked' ? blockedTicksB + 1 : 0
  maximumConsecutiveBlockedTicks = Math.max(maximumConsecutiveBlockedTicks, blockedTicksA, blockedTicksB)
  sawYield ||= runtimeA.motionStatus === 'yielding' || runtimeB.motionStatus === 'yielding'
  if (runtimeA.completedTrips >= 1 && runtimeB.completedTrips >= 1) break
}
const coordinatedState = store.getState()
const runtimeA = coordinatedState.simulation.droneRuntime[droneAId]
const runtimeB = coordinatedState.simulation.droneRuntime[droneBId]
assert.equal(runtimeA.completedTrips, 1, 'Drone-A should complete its coordinated transport')
assert.equal(runtimeB.completedTrips, 1, 'Drone-B should complete its coordinated transport')
assert(minimumDroneSeparation >= DRONE_VEHICLE_SEPARATION_M - 1e-6, 'drones must maintain the configured 3D center separation')
assert(maximumConsecutiveBlockedTicks < 80, 'stable priority coordination must not deadlock')

store.getState().createFactory({ name: 'Shared drone dock validation', widthM: 64, lengthM: 44, gridSizeM: 1 })
const sharedDockFloor = store.getState().floors[0].id
assert(store.getState().upsertItem({ ...item, id: 'item-shared-dock-a', code: 'DOCK-A', name: '共享货架货物 A', massKg: 1 }))
assert(store.getState().upsertItem({ ...item, id: 'item-shared-dock-b', code: 'DOCK-B', name: '共享货架货物 B', massKg: 1 }))
const sourceAId = store.getState().addObject({ kind: 'shelf', floorId: sharedDockFloor, name: 'Shared dock source A', transform: { x: 2, z: 5, rotationY: 0 } })
const sourceBId = store.getState().addObject({ kind: 'shelf', floorId: sharedDockFloor, name: 'Shared dock source B', transform: { x: 2, z: 34, rotationY: 0 } })
const sharedDestinationId = store.getState().addObject({ kind: 'rack', floorId: sharedDockFloor, name: 'Shared destination warehouse', transform: { x: 52, z: 20, rotationY: 0 } })
const sharedDroneAId = store.getState().addObject({ kind: 'drone', floorId: sharedDockFloor, name: 'Shared Dock Drone-A', transform: { x: 14, z: 6, rotationY: 0 } })
const sharedDroneBId = store.getState().addObject({ kind: 'drone', floorId: sharedDockFloor, name: 'Shared Dock Drone-B', transform: { x: 14, z: 33, rotationY: 0 } })
assert(sourceAId && sourceBId && sharedDestinationId && sharedDroneAId && sharedDroneBId, 'shared dock fixtures should be placed')
const sharedSourceAInventory = store.getState().inventory.find((record) => record.locationId.startsWith(`${sourceAId}:`) && record.itemId === 'item-shared-dock-a')
const sharedSourceBInventory = store.getState().inventory.find((record) => record.locationId.startsWith(`${sourceBId}:`) && record.itemId === 'item-shared-dock-b')
assert(sharedSourceAInventory && sharedSourceBInventory, 'both shared-dock source inventory records should exist')
assert(store.getState().adjustInventory(sharedSourceAInventory.id, 4) && store.getState().adjustInventory(sharedSourceBInventory.id, 4))
store.getState().updateObjectConfig(sharedDroneAId, { speedMps: 8, transportProgram: { enabled: true, sourceObjectId: sourceAId, destinationObjectId: sharedDestinationId, itemId: 'item-shared-dock-a', loadQuantity: 4, triggerLocation: 'source', triggerComparator: 'at-least', triggerQuantity: 4 } })
store.getState().updateObjectConfig(sharedDroneBId, { speedMps: 8, transportProgram: { enabled: true, sourceObjectId: sourceBId, destinationObjectId: sharedDestinationId, itemId: 'item-shared-dock-b', loadQuantity: 4, triggerLocation: 'source', triggerComparator: 'at-least', triggerQuantity: 4 } })
store.getState().playSimulation()
store.getState().setSimulationSpeed(10)
let sharedDockMinimumSeparation = Number.POSITIVE_INFINITY
let sawSharedDockQueue = false
for (let tick = 0; tick < 3000; tick += 1) {
  store.getState().tickSimulation(0.025)
  const state = store.getState()
  const sharedRuntimeA = state.simulation.droneRuntime[sharedDroneAId]
  const sharedRuntimeB = state.simulation.droneRuntime[sharedDroneBId]
  sharedDockMinimumSeparation = Math.min(sharedDockMinimumSeparation, Math.hypot(
    sharedRuntimeA.position.x - sharedRuntimeB.position.x,
    sharedRuntimeA.position.y - sharedRuntimeB.position.y,
    sharedRuntimeA.position.z - sharedRuntimeB.position.z,
  ))
  sawSharedDockQueue ||= sharedRuntimeA.blockedReason?.includes('共享装卸位') === true || sharedRuntimeB.blockedReason?.includes('共享装卸位') === true
  if (sharedRuntimeA.completedTrips >= 1 && sharedRuntimeB.completedTrips >= 1) break
}
const sharedDockState = store.getState()
const sharedRuntimeA = sharedDockState.simulation.droneRuntime[sharedDroneAId]
const sharedRuntimeB = sharedDockState.simulation.droneRuntime[sharedDroneBId]
const sharedDestinationAInventory = sharedDockState.inventory.find((record) => record.locationId.startsWith(`${sharedDestinationId}:`) && record.itemId === 'item-shared-dock-a')
const sharedDestinationBInventory = sharedDockState.inventory.find((record) => record.locationId.startsWith(`${sharedDestinationId}:`) && record.itemId === 'item-shared-dock-b')
assert.equal(sharedRuntimeA.completedTrips, 1, 'the first drone should finish storing at the shared warehouse input ports')
assert.equal(sharedRuntimeB.completedTrips, 1, 'the queued drone should enter after warehouse dock egress and finish storing')
assert.equal(sharedDestinationAInventory?.quantity, 4, 'the shared warehouse should receive Drone-A cargo exactly once')
assert.equal(sharedDestinationBInventory?.quantity, 4, 'the shared warehouse should receive Drone-B cargo exactly once')
assert(sawSharedDockQueue, 'one drone should visibly queue outside the shared docking radius')
assert(sharedDockMinimumSeparation >= DRONE_VEHICLE_SEPARATION_M - 1e-6, 'shared-dock coordination must preserve drone separation')

console.log(JSON.stringify({
  clearanceM: DRONE_NAVIGATION_CLEARANCE_M,
  open3dPathLengthM: Number(dronePathLength(open3dPath).toFixed(3)),
  axisOnlyLengthM: axisOnlyLength,
  bodyDiagonalUsed: true,
  safeDescentStartedAtWaypoint: firstDescentIndex,
  warehousePickupEndpoint: pickupPortPath.at(-1),
  warehouseDropoffEndpoint: dropoffPortPath.at(-1),
  rotatedWarehousePickupZ: rotatedPickupPorts[0]?.z,
  rotatedWarehouseDropoffZ: rotatedDropoffPorts[0]?.z,
  crossFloorAltitudeRangeM: Number((crossFloorMaximumY - crossFloorMinimumY).toFixed(3)),
  crossFloorCompletedTrips: transportedRuntime.completedTrips,
  payloadLimitedQuantity: transportedDestinationInventory?.quantity ?? 0,
  minimumDroneSeparationM: Number(minimumDroneSeparation.toFixed(3)),
  maximumConsecutiveBlockedTicks,
  sawYield,
  coordinatedCompletedTrips: [runtimeA.completedTrips, runtimeB.completedTrips],
  sharedDockMinimumSeparationM: Number(sharedDockMinimumSeparation.toFixed(3)),
  sharedDockQueueObserved: sawSharedDockQueue,
  sharedDockCompletedTrips: [sharedRuntimeA.completedTrips, sharedRuntimeB.completedTrips],
}, null, 2))
