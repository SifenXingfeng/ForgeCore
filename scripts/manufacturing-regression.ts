import { strict as assert } from 'node:assert'
import { objectCompatiblePortCells, objectInterfacePortCells, objectPortCells, snapCargoStoragePlacement, snapConveyorCellToObjectPort, stationRackConnections, stationRackDocks } from '../src/game/grid'
import { parseSave, SAVE_VERSION } from '../src/game/save'
import { SimulationEngine } from '../src/game/simulation'
import { resolveItemAppearanceParameters } from '../src/game/item'
import { BUILD_ASSET_PATHS, canBatchAsGenericMachine, getObjectDef, registerMachineDefinition, type FactoryObject, type MachineDefinition } from '../src/game/types'
import { useForgeMindStore } from '../src/store/forgeMind'

useForgeMindStore.getState().newFactory('制造契约验证')
const blank = useForgeMindStore.getState()
assert.equal(blank.items.length, 0, '新工厂物品库必须为 0')
assert.equal(blank.recipes.length, 0, '新工厂配方必须为 0')
assert.equal(blank.machineDefinitions.length, 0, '新工厂机器目录必须为 0')
assert.deepEqual(blank.floorNames, ['1F 生产层'])

const definition: MachineDefinition = {
  id: 'MACHINE_PORT_TEST',
  name: '双进双出加工机',
  description: '端口契约测试',
  modelType: 'machine',
  footprint: { w: 3, d: 3 },
  height: 1.5,
  throughput: '30 / min',
  power: '8 kW',
  inputPortCount: 2,
  outputPortCount: 2,
  recipeIds: [],
}
registerMachineDefinition(definition)
const custom: FactoryObject = { id: 'custom', type: 'machine', resourceId: definition.id, pos: { x: 0, z: 0 }, rotation: 0 }
assert.equal(objectPortCells(custom, 'input').length, 2, '自定义机器应暴露两个真实入口格')
assert.equal(objectPortCells(custom, 'output').length, 2, '自定义机器应暴露两个真实出口格')
const visibleInputPorts = objectInterfacePortCells(custom, 'input')
const visibleOutputPorts = objectInterfacePortCells(custom, 'output')
assert.ok(visibleInputPorts.every((cell) => cell.x < -1), '蓝色接口格必须位于 2.5 倍机器模型包络之外')
assert.ok(visibleOutputPorts.every((cell) => cell.x > 3), '黄色接口格必须位于 2.5 倍机器模型包络之外')
assert.deepEqual(snapConveyorCellToObjectPort({ x: visibleInputPorts[0].x - 1, z: visibleInputPorts[0].z }, 1, [custom]), visibleInputPorts[0], '拖绘传送带必须直接吸附到可见蓝色标记格')
assert.equal(getObjectDef('machine', definition.id).assetPath, BUILD_ASSET_PATHS.machine, '自定义机器定义必须保留所选模型的真实资产路径')
assert.equal(canBatchAsGenericMachine(custom), false, '自定义机器不得进入通用机器模型合批')
assert.equal(canBatchAsGenericMachine({ id: 'legacy-machine', type: 'machine', pos: { x: 0, z: 0 }, rotation: 0 }), true, '无资源定义的旧通用机器仍可合批')

const cncDefinition: MachineDefinition = { ...definition, id: 'MACHINE_CNC_MODEL_TEST', modelType: 'smelter' }
registerMachineDefinition(cncDefinition)
assert.equal(getObjectDef('machine', cncDefinition.id).assetPath, BUILD_ASSET_PATHS.smelter, '选择数控模型后，场景实例必须使用数控模型')
assert.deepEqual(resolveItemAppearanceParameters({ color: '#123456', modelParameters: { width: 2 } }), { width: 2, color: '#123456' }, '物品场景与缩略图必须继承业务显示颜色和模型参数')
assert.equal(resolveItemAppearanceParameters({ color: '#123456', modelParameters: { color: '#abcdef' } }).color, '#abcdef', '显式模型颜色必须优先于旧显示色')

const assembler: FactoryObject = { id: 'assembler', type: 'assembler', pos: { x: 0, z: 0 }, rotation: 0, portConfig: { inputCount: 5, outputCount: 2 } }
assert.equal(objectPortCells(assembler, 'input').length, 5, '精密装配后三边接口数应由实例配置决定')
assert.equal(objectPortCells(assembler, 'output').length, 2, '精密装配前边接口数应由实例配置决定')

const pickup: FactoryObject = { id: 'pickup', type: 'source', pos: { x: 0, z: 0 }, rotation: 0, itemId: 'ITEM_IRON', stationProgram: { mode: 'pickup', transferIntervalSec: 0.25, rackAssignments: { ITEM_IRON: 'left' } } }
const pickupRack: FactoryObject = { id: 'pickup-rack', type: 'oreMiner', pos: { x: 1, z: 4 }, rotation: 0, itemId: 'ITEM_IRON' }
const pickupBackRack: FactoryObject = { id: 'pickup-back-rack', type: 'oreMiner', pos: { x: -2, z: 1 }, rotation: 0 }
const pickupRightRack: FactoryObject = { id: 'pickup-right-rack', type: 'oreMiner', pos: { x: 1, z: -2 }, rotation: 0 }
const store: FactoryObject = { id: 'store', type: 'source', pos: { x: 7, z: 0 }, rotation: 180, stationProgram: { mode: 'store', transferIntervalSec: 0.25, rackAssignments: { ITEM_IRON: 'right' } } }
const storeRack: FactoryObject = { id: 'store-rack', type: 'oreMiner', pos: { x: 8, z: 4 }, rotation: 0 }
assert.equal(objectPortCells(pickup, 'input').length, 0)
assert.equal(objectPortCells(pickup, 'output').length, 1)
assert.equal(objectPortCells(store, 'input').length, 1)
assert.equal(objectPortCells(store, 'output').length, 0)
const rotatedSourcePorts = ([
  [0, { x: 4, z: 1 }],
  [90, { x: 2, z: 4 }],
  [180, { x: -1, z: 2 }],
  [270, { x: 1, z: -1 }],
] as const).map(([rotation, expected]) => {
  const source: FactoryObject = { ...pickup, id: `pickup-${rotation}`, rotation }
  assert.deepEqual(objectPortCells(source, 'output'), [expected], `${rotation}° 存取站接口必须与站内短带保持同一局部中线`)
  return source
})
assert.ok(objectCompatiblePortCells(rotatedSourcePorts[1], 'output').some((cell) => cell.x === 1 && cell.z === 4), '90° 旧存档第一中线仍应作为兼容接口')
assert.deepEqual(stationRackDocks(pickup).map((dock) => [dock.side, dock.anchor]), [['back', { x: -2, z: 1 }], ['left', { x: 1, z: 4 }], ['right', { x: 1, z: -2 }]], '4x4 存取站必须提供三个居中的 2x2 泊位')
const allRacks = [pickup, pickupRack, pickupBackRack, pickupRightRack]
assert.equal(Object.keys(stationRackConnections(pickup, allRacks)).length, 3, '三面各吸附一个实际货架')
assert.deepEqual(snapCargoStoragePlacement({ x: 2, z: 5 }, 'oreMiner', 0, 1, [pickup]), pickupRack.pos, '靠近左侧泊位放置货架应吸附到完整 2x2 锚点')
assert.deepEqual(snapCargoStoragePlacement({ x: 1, z: 1 }, 'source', 0, 1, [pickupRack]), pickup.pos, '先放货架再放存取站也应反向吸附')
const engine = new SimulationEngine(20260820)
engine.init([pickup, pickupRack, pickupBackRack, pickupRightRack, { id: 'belt-a', type: 'conveyor', pos: { x: 4, z: 1 }, rotation: 0 }, { id: 'belt-b', type: 'conveyor', pos: { x: 5, z: 1 }, rotation: 0 }, { id: 'belt-c', type: 'conveyor', pos: { x: 6, z: 1 }, rotation: 0 }, store, storeRack], [])
engine.advance(12)
const stored = engine.getSnapshot().sources.find((source) => source.objectId === store.id)
assert.ok((stored?.inventory?.ITEM_IRON ?? 0) > 0, '存货站应从传送带取得物品并写入指定货架库存')
assert.equal(stored?.rackSide, 'right')
assert.equal(stored?.rackObjectId, 'store-rack')
assert.ok((engine.getSnapshot().racks.find((rack) => rack.objectId === pickupRack.id)?.inventory.ITEM_IRON ?? 0) < 24, '取货必须扣减实际来源货架库存')
assert.ok((engine.getSnapshot().racks.find((rack) => rack.objectId === storeRack.id)?.inventory.ITEM_IRON ?? 0) > 0, '存货必须增加实际目标货架库存')

const blockedEngine = new SimulationEngine(20260820)
blockedEngine.init([pickup, { id: 'blocked-belt', type: 'conveyor', pos: { x: 4, z: 1 }, rotation: 0 }], [])
blockedEngine.advance(3)
assert.equal(blockedEngine.getSnapshot().sources[0]?.state, 'blocked', '显式映射侧未吸附货架时不得凭空取货')
assert.equal(blockedEngine.getSnapshot().itemLots.length, 0)

const blockedStoreEngine = new SimulationEngine(20260820)
blockedStoreEngine.init([pickup, pickupRack, { id: 'blocked-store-belt-a', type: 'conveyor', pos: { x: 4, z: 1 }, rotation: 0 }, { id: 'blocked-store-belt-b', type: 'conveyor', pos: { x: 5, z: 1 }, rotation: 0 }, { id: 'blocked-store-belt-c', type: 'conveyor', pos: { x: 6, z: 1 }, rotation: 0 }, store], [])
blockedStoreEngine.advance(8)
const retainedLot = blockedStoreEngine.getSnapshot().itemLots.find((lot) => lot.conveyorId === 'blocked-store-belt-c')
assert.equal(retainedLot?.offset, 1, '存货映射侧未吸附货架时必须保留传送带来货并形成背压')
assert.equal(blockedStoreEngine.getSnapshot().sources.find((source) => source.objectId === store.id)?.inventory?.ITEM_IRON ?? 0, 0, '缺失目标货架时不得把货物写入站体虚拟库存')

const saved = blank.exportSave()
const parsed = parseSave(JSON.stringify({ ...saved, version: SAVE_VERSION, floorNames: ['首层'], machineDefinitions: [definition] }))
assert.equal(parsed.floorNames[0], '首层')
assert.equal(parsed.machineDefinitions[0]?.id, definition.id)

console.log('机械制造回归：空白目录、命名楼层、动态端口、精密装配端口、三面真实货架吸附/库存/背压、双向物流与 v6 存档通过')
