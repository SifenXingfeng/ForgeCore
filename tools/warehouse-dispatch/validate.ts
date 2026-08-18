import assert from 'node:assert/strict'
import { createEmptyProjectData } from '../../src/data/emptyProject'
import { useForgeStore } from '../../src/store/useForgeStore'
import type { FactoryObject, Item, MachinePortIndex } from '../../src/types'

const project = createEmptyProjectData({
  factoryId: 'factory-warehouse-dispatch-validation',
  floorId: 'floor-warehouse-dispatch-validation',
  name: 'Warehouse dispatch validation',
  widthM: 30,
  lengthM: 20,
  gridSizeM: 1,
})
const now = '2026-08-18T00:00:00.000Z'
const item: Item = {
  id: 'item-warehouse-dispatch-validation',
  code: 'WAREHOUSE-DISPATCH',
  name: '仓库出货节拍验证物品',
  category: 'raw-material',
  description: 'Per-output-port dispatch interval regression fixture',
  itemModelId: 'BASIC_BOX',
  modelParameters: {},
  icon: null,
  massKg: 1,
  maxStackSize: 100,
}
const warehouse: FactoryObject = {
  id: 'warehouse-dispatch-validation',
  factoryId: project.factory.id,
  floorId: project.floors[0].id,
  kind: 'rack',
  name: '独立节拍仓库',
  modelRef: null,
  transform: { x: 2, z: 2, rotationY: 0 },
  footprint: { width: 6, depth: 6 },
  status: 'ready',
  config: {
    kind: 'rack',
    slotCount: 18,
    slotCapacity: 100,
    dispatchIntervalSecByPort: [0.5, 1, 2],
    storageType: 'mixed',
    runtimeAssetStatus: 'proxy',
    inputPortCount: 3,
    outputPortCount: 3,
  },
  createdAt: now,
  updatedAt: now,
}
const conveyors = ([0, 1, 2] as MachinePortIndex[]).map((portIndex): FactoryObject => ({
  id: `warehouse-output-${portIndex}`,
  factoryId: project.factory.id,
  floorId: project.floors[0].id,
  kind: 'conveyor',
  name: `出货口 ${portIndex + 1} 验证传送带`,
  modelRef: null,
  transform: { x: 8, z: 3 + portIndex * 2, rotationY: 0 },
  footprint: { width: 1, depth: 1 },
  status: 'ready',
  config: {
    kind: 'conveyor',
    conveyorType: 'flat',
    fromObjectId: warehouse.id,
    toObjectId: 'finished-goods',
    fromPortIndex: portIndex,
    toPortIndex: null,
    fromFloorId: project.floors[0].id,
    toFloorId: project.floors[0].id,
    riseM: 0,
    outputItemId: item.id,
    speedMps: 10,
    capacity: 12,
    path: [{ x: 8, z: 3 + portIndex * 2 }, { x: 9, z: 3 + portIndex * 2 }],
  },
  createdAt: now,
  updatedAt: now,
}))

project.objects = [warehouse, ...conveyors]
project.items = [item]
project.inventory = [{
  id: 'inventory-warehouse-dispatch-validation',
  locationType: 'rack-slot',
  locationId: `${warehouse.id}:bulk`,
  itemId: item.id,
  quantity: 0,
  initialQuantity: 0,
  capacity: 1800,
  reservedOutboundQuantity: 0,
  reservedInboundCapacity: 0,
  infiniteSupply: true,
}]
project.simulation.status = 'running'

useForgeStore.setState(project)
const seenTransitIds = new Set<string>()
const dispatchCountByPort = [0, 0, 0]
for (let step = 0; step < 9; step += 1) {
  useForgeStore.getState().tickSimulation(0.25)
  for (const transit of useForgeStore.getState().simulation.transitItems) {
    if (seenTransitIds.has(transit.id)) continue
    seenTransitIds.add(transit.id)
    const portIndex = conveyors.findIndex((conveyor) => conveyor.id === transit.conveyorObjectId)
    if (portIndex >= 0) dispatchCountByPort[portIndex] += 1
  }
}

assert.deepEqual(dispatchCountByPort, [5, 3, 2], 'each output port must dispatch on its own 0.5s / 1s / 2s cadence')
assert.deepEqual(
  useForgeStore.getState().simulation.warehouseDispatchCooldownSecByPort[warehouse.id].map((value) => Number(value.toFixed(2))),
  [0.5, 1, 2],
  'each port should reset only its own cooldown after dispatching',
)

const runFiniteReservationScenario = (
  scenarioName: string,
  reservedOutboundQuantity: number,
  reservedInboundCapacity: number,
) => {
  const scenario = createEmptyProjectData({
    factoryId: project.factory.id,
    floorId: project.floors[0].id,
    name: scenarioName,
    widthM: 30,
    lengthM: 20,
    gridSizeM: 1,
  })
  scenario.objects = structuredClone([warehouse, ...conveyors])
  scenario.items = [structuredClone(item)]
  scenario.inventory = [{
    id: `inventory-${scenarioName}`,
    locationType: 'rack-slot',
    locationId: `${warehouse.id}:bulk`,
    itemId: item.id,
    quantity: 3,
    initialQuantity: 3,
    capacity: 1800,
    reservedOutboundQuantity,
    reservedInboundCapacity,
    infiniteSupply: false,
  }]
  scenario.simulation.status = 'running'

  useForgeStore.setState(scenario)
  useForgeStore.getState().tickSimulation(0.25)
  const state = useForgeStore.getState()
  return {
    inventory: state.inventory[0],
    transitCount: state.simulation.transitItems.length,
  }
}

const inboundReservation = runFiniteReservationScenario('inbound-capacity-does-not-freeze-stock', 0, 3)
assert.equal(inboundReservation.transitCount, 3, 'three inbound capacity reservations must not block three existing items from dispatching')
assert.equal(inboundReservation.inventory.quantity, 0, 'all three existing items should enter the three outgoing conveyors')
assert.equal(inboundReservation.inventory.reservedInboundCapacity, 3, 'dispatching existing stock must not consume an inbound capacity reservation')

const outboundReservation = runFiniteReservationScenario('outbound-reservation-protects-stock', 3, 0)
assert.equal(outboundReservation.transitCount, 0, 'three outbound stock reservations must protect all three existing items from conveyor dispatch')
assert.equal(outboundReservation.inventory.quantity, 3, 'outbound-reserved stock must remain in the warehouse until its vehicle picks it up')

console.log(JSON.stringify({
  configuredIntervalsSec: warehouse.config.kind === 'rack' ? warehouse.config.dispatchIntervalSecByPort : [],
  dispatchCountByPort,
  elapsedSimSec: useForgeStore.getState().simulation.elapsedSimSec,
  inboundReservation: {
    dispatched: inboundReservation.transitCount,
    remainingQuantity: inboundReservation.inventory.quantity,
    reservedInboundCapacity: inboundReservation.inventory.reservedInboundCapacity,
  },
  outboundReservation: {
    dispatched: outboundReservation.transitCount,
    remainingQuantity: outboundReservation.inventory.quantity,
    reservedOutboundQuantity: outboundReservation.inventory.reservedOutboundQuantity,
  },
}, null, 2))
