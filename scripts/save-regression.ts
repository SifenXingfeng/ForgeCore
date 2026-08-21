import { strict as assert } from 'node:assert'
import { BASE_A01_OBJECTS } from '../src/game/baseA01'
import { DEFAULT_ITEMS, DEFAULT_RECIPES } from '../src/game/item'
import { parseSave, SAVE_VERSION, serializeSave, type FactorySave } from '../src/game/save'
import type { BuildType } from '../src/game/types'

const save: FactorySave = {
  version: SAVE_VERSION,
  savedAt: '2026-08-17T00:00:00.000Z',
  name: '五层验证工厂',
  floorCount: 5,
  floorNames: ['收货层', '加工层', '装配层', '质检层', '出货层'],
  objects: BASE_A01_OBJECTS,
  items: DEFAULT_ITEMS,
  recipes: DEFAULT_RECIPES,
  machineDefinitions: [],
}

const roundTripped = parseSave(serializeSave(save))
assert.equal(roundTripped.version, SAVE_VERSION)
assert.equal(roundTripped.name, '五层验证工厂')
assert.equal(roundTripped.floorCount, 5)
assert.equal(roundTripped.objects.length, BASE_A01_OBJECTS.length)
assert.equal(roundTripped.objects.find((object) => object.id === 'l2_cnc_housing')?.floorId, 2, 'L2 对象的楼层必须在存档往返后保留')
assert.equal(roundTripped.objects.find((object) => object.id === 'l3_robotic_assembly')?.floorId, 3, 'L3 对象的楼层必须在存档往返后保留')
assert.deepEqual(new Set(roundTripped.objects.map((object) => object.type)), new Set<BuildType>([
  'source', 'oreMiner', 'agv', 'conveyor', 'smelter', 'press', 'washing',
  'machine', 'assembler', 'inspection', 'splitter', 'storage',
  'drone',
]))

const rack = save.objects.find((object) => object.type === 'oreMiner' || object.type === 'storage')
assert.ok(rack, '基线存档必须包含普通货物仓储架')
const namedRoundTrip = parseSave(serializeSave({
  ...save,
  objects: save.objects.map((object) => object.id === rack.id ? { ...object, displayName: '一号原料货架' } : object),
}))
assert.equal(namedRoundTrip.objects.find((object) => object.id === rack.id)?.displayName, '一号原料货架', '仓储实例名称必须完整往返')

for (const version of [1, 2, 3, 4, 5, 6]) {
  const legacyObjects = save.objects.map((object) => {
    if (object.id !== rack.id) return object
    const { displayName: _displayName, storageConfig: _storageConfig, ...legacyObject } = object
    return { ...legacyObject, name: '旧版原料区 A 架' }
  })
  const legacyPayload: Record<string, unknown> = { ...save, version, objects: legacyObjects }
  if (version < 5) {
    delete legacyPayload.floorNames
    delete legacyPayload.machineDefinitions
  }
  const compatible = parseSave(JSON.stringify(legacyPayload))
  const compatibleRack = compatible.objects.find((object) => object.id === rack.id)
  assert.equal(compatible.version, SAVE_VERSION, `v${version} 必须迁移至当前版本`)
  assert.equal(compatibleRack?.displayName, '旧版原料区 A 架', `v${version} 旧对象名称必须迁入 displayName`)
  assert.equal(compatibleRack?.storageConfig?.capacity, 100, `v${version} 旧货架必须生成有限容量配置`)
}

const unnamedV6 = parseSave(JSON.stringify({ ...save, version: 6 }))
assert.equal(unnamedV6.objects.find((object) => object.id === rack.id)?.displayName, undefined, '缺少显示名称的 v6 存档仍须合法')

const vehicle = save.objects.find((object) => object.type === 'agv')
assert.ok(vehicle, '基线存档必须包含 AGV')
const triggerRoundTrip = parseSave(serializeSave({
  ...save,
  objects: save.objects.map((object) => object.id === vehicle.id ? { ...object, agvProgram: { enabled: true, sourceObjectId: rack.id, destinationObjectId: rack.id, itemId: DEFAULT_ITEMS[0].id, loadQuantity: 4, dispatchMode: 'threshold', sourceMinQuantity: 12, destinationMaxQuantity: 3 } } : object),
}))
const triggerProgram = triggerRoundTrip.objects.find((object) => object.id === vehicle.id)?.agvProgram
assert.equal(triggerProgram?.dispatchMode, 'threshold')
assert.equal(triggerProgram?.sourceMinQuantity, 12)
assert.equal(triggerProgram?.destinationMaxQuantity, 3)

const { name: _legacyName, floorCount: _legacyFloorCount, ...legacySave } = save
const migrated = parseSave(JSON.stringify({ ...legacySave, version: 1 }))
assert.equal(migrated.version, SAVE_VERSION)
assert.equal(migrated.objects.length, save.objects.length)
assert.equal(migrated.floorCount, 3, '旧版三层存档必须推断为至少三层')

assert.throws(() => parseSave(JSON.stringify({ ...save, version: 99 })), /不支持的存档版本/)
assert.throws(() => parseSave(JSON.stringify({ ...save, objects: [{ ...save.objects[0], type: 'unknown' }] })), /对象类型非法/)
assert.throws(() => parseSave(JSON.stringify({ ...save, objects: [save.objects[0], save.objects[0]] })), /对象 id 重复/)

console.log(`存档回归：${roundTripped.objects.length} 个设备完整往返，v1 → v${SAVE_VERSION} 迁移通过`)
