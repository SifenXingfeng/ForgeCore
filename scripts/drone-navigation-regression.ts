import assert from 'node:assert/strict'
import { DRONE_HOVER_HEIGHT_M, dronePathLength, findDronePath } from '../src/game/dronePathfinding'
import { FLOOR_HEIGHT_M } from '../src/game/floorConfig'
import { SimulationEngine } from '../src/game/simulation'
import type { FactoryObject } from '../src/game/types'

const drone: FactoryObject = {
  id: 'drone-01',
  type: 'drone',
  pos: { x: -18, z: -12 },
  rotation: 0,
  floorId: 1,
  agvProgram: {
    enabled: true,
    sourceObjectId: 'source-l2',
    destinationObjectId: 'destination-l3',
    itemId: 'item_steel_blank',
    loadQuantity: 3,
  },
}
const source: FactoryObject = { id: 'source-l2', type: 'storage', pos: { x: -8, z: -4 }, rotation: 0, floorId: 2, storageConfig: { capacity: 20, initialInventory: { item_steel_blank: 12 } } }
const destination: FactoryObject = { id: 'destination-l3', type: 'storage', pos: { x: 12, z: 8 }, rotation: 180, floorId: 3, storageConfig: { capacity: 20, initialInventory: {} } }
const objects = [drone, source, destination]
const start = { x: -16.5, y: DRONE_HOVER_HEIGHT_M, z: -10.5 }
const path = findDronePath(objects, start, destination, drone.id, 'dropoff')
assert.ok(path && path.length > 1, '三维 A* 未找到跨层路径')
assert.ok(path.slice(1).some((point, index) => {
  const previous = path[index]
  return point.y !== previous.y && (point.x !== previous.x || point.z !== previous.z)
}), '跨层路径没有任意方向的水平+垂直同步移动')
const axisOnlyDistance = Math.abs(destination.pos.x - start.x) + Math.abs(destination.pos.z - start.z) + FLOOR_HEIGHT_M * 2
assert.ok(dronePathLength(path) < axisOnlyDistance, '三维路径没有优于固定轴向/井道路线')

const engine = new SimulationEngine(20260820)
engine.init(objects, [])
engine.advance(45)
const runtime = engine.getSnapshot().drones[0]
assert.ok(runtime.completedTrips >= 1, '无人机未完成 L2→L3 跨层运输')
assert.ok(runtime.distanceTravelled > 20, '无人机没有产生有效三维运输里程')
assert.notEqual(runtime.phase, 'parked', '已配置无人机不应停留在固定停机位')
const snapshot = engine.getSnapshot()
assert.ok((snapshot.racks.find((rack) => rack.objectId === source.id)?.inventory.item_steel_blank ?? 0) < 12, '无人机装货没有扣减起点货架')
assert.ok((snapshot.racks.find((rack) => rack.objectId === destination.id)?.inventory.item_steel_blank ?? 0) > 0, '无人机卸货没有写入终点货架')

const dockedSource: FactoryObject = { id: 'docked-source', type: 'storage', pos: { x: 0, z: 0 }, rotation: 0, floorId: 1, storageConfig: { capacity: 20, initialInventory: { item_steel_blank: 6 } } }
const dockedDestination: FactoryObject = { id: 'docked-destination', type: 'storage', pos: { x: 12, z: 8 }, rotation: 180, floorId: 2, storageConfig: { capacity: 20, initialInventory: {} } }
const dockedDrone: FactoryObject = {
  id: 'docked-drone',
  type: 'drone',
  pos: { x: 3, z: 0 },
  rotation: 0,
  floorId: 1,
  agvProgram: {
    enabled: true,
    sourceObjectId: dockedSource.id,
    destinationObjectId: dockedDestination.id,
    itemId: 'item_steel_blank',
    loadQuantity: 3,
  },
}
const dockedObjects = [dockedDrone, dockedSource, dockedDestination]
const dockedStart = { x: 4.5, y: DRONE_HOVER_HEIGHT_M, z: 1.5 }
const dockedPickupPath = findDronePath(dockedObjects, dockedStart, dockedSource, dockedDrone.id, 'pickup')
assert.equal(dockedPickupPath?.length, 1, '回归场景必须让无人机初始位置与取货悬停网格重合')

const dockedEngine = new SimulationEngine(20260821)
dockedEngine.init(dockedObjects, [])
dockedEngine.advance(0.5)
const dockedLoadingSnapshot = dockedEngine.getSnapshot()
assert.equal(dockedLoadingSnapshot.racks.find((rack) => rack.objectId === dockedSource.id)?.inventory.item_steel_blank, 3, '已位于取货点时必须直接装货并扣减真实库存')
assert.equal(dockedLoadingSnapshot.drones[0].cargoQuantity, 3, '单节点取货路径不得让无人机永久空载等待')
dockedEngine.advance(30)
const dockedDeliverySnapshot = dockedEngine.getSnapshot()
assert.ok(dockedDeliverySnapshot.drones[0].completedTrips >= 1, '从取货点原地出发的无人机必须完成后续跨层运输')
assert.ok((dockedDeliverySnapshot.racks.find((rack) => rack.objectId === dockedDestination.id)?.inventory.item_steel_blank ?? 0) >= 3, '原地装货后的货物必须实际送达终点')

console.log('drone navigation regression: passed')
