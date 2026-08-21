import assert from 'node:assert/strict'
import { SimulationEngine } from '../src/game/simulation'
import { OBJECT_DEFS, type FactoryObject } from '../src/game/types'

const itemId = 'item_boundary_test'

assert.equal(OBJECT_DEFS.agv.inputPort, null, 'AGV 不应有建筑入货口')
assert.equal(OBJECT_DEFS.agv.outputPort, null, 'AGV 不应有建筑出货口')
assert.equal(OBJECT_DEFS.drone.inputPort, null, '无人机不应有建筑入货口')
assert.equal(OBJECT_DEFS.drone.outputPort, null, '无人机不应有建筑出货口')

// Newly placed vehicles have no implicit route or cargo. They must remain
// parked until the user saves a complete program.
{
  const engine = new SimulationEngine(20260820)
  engine.init([
    { id: 'agv-empty', type: 'agv', pos: { x: -4, z: 8 }, rotation: 0, floorId: 1 },
    { id: 'drone-empty', type: 'drone', pos: { x: 4, z: 8 }, rotation: 0, floorId: 1 },
  ], [])
  engine.advance(8)
  const snapshot = engine.getSnapshot()
  assert.equal(snapshot.agvs[0].cargoQuantity, 0, '未编程 AGV 不应自带货物')
  assert.equal(snapshot.agvs[0].distanceTravelled, 0, '未编程 AGV 不应运行演示路线')
  assert.equal(snapshot.drones[0].cargoQuantity, 0, '未编程无人机不应自带货物')
  assert.equal(snapshot.drones[0].distanceTravelled, 0, '未编程无人机不应自行起飞')
}

// Boundary warehouses also work with a physical conveyor: withdrawal from an
// inbound warehouse is consumption, while irreversible outbound receipt is
// production.
{
  const inbound: FactoryObject = { id: 'inbound-belt', type: 'inboundWarehouse', itemId, pos: { x: -10, z: 0 }, rotation: 0, floorId: 1 }
  const outbound: FactoryObject = { id: 'outbound-belt', type: 'outboundWarehouse', pos: { x: 5, z: 0 }, rotation: 0, floorId: 1 }
  const belts: FactoryObject[] = Array.from({ length: 12 }, (_, index) => ({ id: `belt-${index}`, type: 'conveyor', pos: { x: -7 + index, z: 1 }, rotation: 0, floorId: 1 }))
  const engine = new SimulationEngine(20260820)
  engine.init([inbound, ...belts, outbound], [])
  engine.advance(12)
  const snapshot = engine.getSnapshot()
  assert.ok((snapshot.stats.consumed[itemId] ?? 0) > 0, '入货仓库经传送带供货没有计入消耗')
  assert.ok((snapshot.stats.produced[itemId] ?? 0) > 0, '出货仓库经传送带收货没有计入产出')
  const inTransit = snapshot.itemLots.filter((lot) => lot.itemId === itemId).length
  assert.equal(snapshot.stats.consumed[itemId], snapshot.stats.produced[itemId] + inTransit, '边界仓库传送链物料数量不守恒')
}

// AGV shares the same ledger and inventory service as the conveyor path.
{
  const inbound: FactoryObject = { id: 'inbound-agv', type: 'inboundWarehouse', itemId, pos: { x: -12, z: -3 }, rotation: 0, floorId: 1 }
  const outbound: FactoryObject = { id: 'outbound-agv', type: 'outboundWarehouse', pos: { x: 10, z: -3 }, rotation: 180, floorId: 1 }
  const agv: FactoryObject = {
    id: 'agv-boundary', type: 'agv', pos: { x: -2, z: 10 }, rotation: 0, floorId: 1,
    agvProgram: { enabled: true, sourceObjectId: inbound.id, destinationObjectId: outbound.id, itemId, loadQuantity: 4 },
  }
  const engine = new SimulationEngine(20260820)
  engine.init([inbound, outbound, agv], [])
  engine.advance(45)
  const snapshot = engine.getSnapshot()
  assert.ok(snapshot.agvs[0].completedTrips >= 1, 'AGV 未完成入货仓库到出货仓库任务')
  assert.ok((snapshot.stats.consumed[itemId] ?? 0) >= 4, 'AGV 从入货仓库取货没有登记消耗')
  assert.ok((snapshot.stats.produced[itemId] ?? 0) >= 4, 'AGV 向出货仓库卸货没有登记产出')
  assert.equal(snapshot.stats.consumed[itemId], snapshot.stats.produced[itemId] + snapshot.agvs[0].cargoQuantity, 'AGV 边界运输的库存与车载数量不守恒')
}

// A normal rack is finite on both sides: loading deducts its inventory and a
// full destination retains excess cargo instead of swallowing it.
{
  const source: FactoryObject = { id: 'rack-source', type: 'oreMiner', pos: { x: -12, z: -3 }, rotation: 0, floorId: 1, storageConfig: { capacity: 3, initialInventory: { [itemId]: 3 } } }
  const destination: FactoryObject = { id: 'rack-destination', type: 'oreMiner', pos: { x: 10, z: -3 }, rotation: 180, floorId: 1, storageConfig: { capacity: 2, initialInventory: {} } }
  const agv: FactoryObject = {
    id: 'agv-capacity', type: 'agv', pos: { x: -2, z: 10 }, rotation: 0, floorId: 1,
    agvProgram: { enabled: true, sourceObjectId: source.id, destinationObjectId: destination.id, itemId, loadQuantity: 3 },
  }
  const engine = new SimulationEngine(20260820)
  engine.init([source, destination, agv], [])
  engine.advance(45)
  const snapshot = engine.getSnapshot()
  const sourceQuantity = snapshot.racks.find((rack) => rack.objectId === source.id)?.inventory[itemId] ?? 0
  const destinationQuantity = snapshot.racks.find((rack) => rack.objectId === destination.id)?.inventory[itemId] ?? 0
  assert.equal(sourceQuantity, 0, '普通货架装货后没有扣减库存')
  assert.equal(destinationQuantity, 2, '普通货架超过容量上限')
  assert.equal(snapshot.agvs[0].cargoQuantity, 1, '目标货架满载后多余货物没有保留在 AGV 上')
  assert.equal(sourceQuantity + destinationQuantity + snapshot.agvs[0].cargoQuantity, 3, '有限货架运输不守恒')
  assert.deepEqual(snapshot.stats, { consumed: {}, produced: {} }, '普通货架之间搬运不得计入边界产出或消耗')
}

// A rack is a direct vehicle endpoint and needs no cargo access station, but
// the selected item and the complete per-trip quantity must really exist.
{
  const source: FactoryObject = { id: 'rack-insufficient', type: 'oreMiner', pos: { x: -12, z: 4 }, rotation: 0, floorId: 1, storageConfig: { capacity: 20, initialInventory: { [itemId]: 2 } } }
  const destination: FactoryObject = { id: 'rack-empty-destination', type: 'oreMiner', pos: { x: 10, z: 4 }, rotation: 180, floorId: 1, storageConfig: { capacity: 20, initialInventory: {} } }
  const agv: FactoryObject = { id: 'agv-no-virtual-supply', type: 'agv', pos: { x: -2, z: 12 }, rotation: 0, floorId: 1, agvProgram: { enabled: true, sourceObjectId: source.id, destinationObjectId: destination.id, itemId, loadQuantity: 3, dispatchMode: 'continuous' } }
  const engine = new SimulationEngine(20260821)
  engine.init([source, destination, agv], [])
  engine.advance(45)
  const snapshot = engine.getSnapshot()
  assert.equal(snapshot.racks.find((rack) => rack.objectId === source.id)?.inventory[itemId], 2, '库存不足时不应扣出半趟货物')
  assert.equal(snapshot.racks.find((rack) => rack.objectId === destination.id)?.inventory[itemId] ?? 0, 0, '没有真实来源时终点不应凭空收到货物')
  assert.equal(snapshot.agvs[0].cargoQuantity, 0, '库存不足时车辆不应获得虚拟或部分载荷')
}

// ForgeCore inventory-trigger mode gates only a new empty trip. It does not
// turn a finite rack into an infinite source.
{
  const source: FactoryObject = { id: 'rack-threshold-source', type: 'oreMiner', pos: { x: -12, z: 4 }, rotation: 0, floorId: 1, storageConfig: { capacity: 20, initialInventory: { [itemId]: 3 } } }
  const destination: FactoryObject = { id: 'rack-threshold-destination', type: 'oreMiner', pos: { x: 10, z: 4 }, rotation: 180, floorId: 1, storageConfig: { capacity: 20, initialInventory: {} } }
  const agv: FactoryObject = { id: 'agv-threshold-wait', type: 'agv', pos: { x: -2, z: 12 }, rotation: 0, floorId: 1, agvProgram: { enabled: true, sourceObjectId: source.id, destinationObjectId: destination.id, itemId, loadQuantity: 3, dispatchMode: 'threshold', sourceMinQuantity: 4, destinationMaxQuantity: 10 } }
  const engine = new SimulationEngine(20260821)
  engine.init([source, destination, agv], [])
  engine.advance(12)
  const runtime = engine.getSnapshot().agvs[0]
  assert.equal(runtime.distanceTravelled, 0, '起点库存未达到触发阈值时不应发起新行程')
  assert.equal(runtime.currentWaypointLabel, '等待库存条件')
}

console.log('storage logistics regression: passed')
