import assert from 'node:assert/strict'
import { FLOOR_DECK_UNDERSIDE_M, FLOOR_HEIGHT_M, INCLINE_CONVEYOR_GRADE, INCLINE_CONVEYOR_RUN_M } from '../src/game/floorConfig'
import { canPlaceIncline, createInclineObject, inclineInterfaces, inclineProjectionCells, objectsTouchingFloor, snapConveyorCellToIncline, snapInclinePlacement } from '../src/game/inclineConveyor'
import { DEFAULT_ITEMS, type Recipe } from '../src/game/item'
import { canPlace, stationRackDocks } from '../src/game/grid'
import { parseSave, SAVE_VERSION, serializeSave } from '../src/game/save'
import { SimulationEngine } from '../src/game/simulation'
import type { FactoryObject } from '../src/game/types'
import { OBJECT_DEFS } from '../src/game/types'
import { buildingVisualScaleForType } from '../src/scene/industrialVisualScale'
import { inclineSlopeQuaternion } from '../src/scene/InclineConveyorMesh'
import * as THREE from 'three'
import { BUILD_ASSET_PATHS } from '../src/game/types'

const iron = 'item_steel_blank'
const gear = 'item_machined_housing'
const recipe: Recipe = {
  id: 'cross-floor-recipe',
  name: '跨层验证',
  inputs: [{ itemId: iron, qty: 1 }],
  outputs: [{ itemId: gear, qty: 1 }],
  durationSec: 1,
}

function withRackSupply(objects: FactoryObject[]): FactoryObject[] {
  return objects.flatMap((object) => {
    if (object.type !== 'source' || !object.itemId) return [object]
    const station: FactoryObject = { ...object, stationProgram: { mode: 'pickup', transferIntervalSec: 1, rackAssignments: { [object.itemId]: 'back' } } }
    const dock = stationRackDocks(station).find((entry) => entry.side === 'back')!
    return [station, { id: `${object.id}-rack`, type: 'oreMiner', pos: dock.anchor, rotation: 0, floorId: object.floorId, storageConfig: { capacity: 200, initialInventory: { [object.itemId]: 200 } } } as FactoryObject]
  })
}

const maxBuiltInHeight = Math.max(...Object.values(OBJECT_DEFS)
  .filter((definition) => definition.type !== 'inclineUp' && definition.type !== 'inclineDown')
  .map((definition) => definition.height * buildingVisualScaleForType(definition.type)))
assert.equal(FLOOR_HEIGHT_M, 5.25)
assert.equal(INCLINE_CONVEYOR_RUN_M, 7)
assert.equal(FLOOR_HEIGHT_M / INCLINE_CONVEYOR_RUN_M, INCLINE_CONVEYOR_GRADE)
assert.ok(FLOOR_DECK_UNDERSIDE_M > maxBuiltInHeight, '上层楼板底面必须高于当前最高内置机器')
assert.ok(FLOOR_DECK_UNDERSIDE_M - maxBuiltInHeight >= 0.35, '最高机器上方至少保留约 0.35m 净空')
assert.equal(BUILD_ASSET_PATHS.inclineUp, '/models/industrial/roller_conveyor_segment.glb')
assert.equal(BUILD_ASSET_PATHS.inclineDown, '/models/industrial/roller_conveyor_segment.glb')
for (const horizontal of [[7, 0], [-7, 0], [0, 7], [0, -7]] as const) {
  const rotation = inclineSlopeQuaternion(new THREE.Vector3(horizontal[0], FLOOR_HEIGHT_M, horizontal[1]))
  const widthAxis = new THREE.Vector3(0, 0, 1).applyQuaternion(rotation)
  assert.ok(Math.abs(widthAxis.y) < 1e-9, `斜坡 ${horizontal.join(',')} 的宽轴发生侧滚`)
}

const up = createInclineObject('ramp-up', 'inclineUp', { x: 0, z: 0 }, 0, 1)
assert.ok(up?.incline)
assert.deepEqual(up.incline.highPos, { x: 7, z: 0 })
assert.equal(inclineProjectionCells(up.incline).length, 8)
assert.deepEqual(inclineInterfaces(up), [
  { role: 'input', floorId: 1, cell: { x: -1, z: 0 }, travelRotation: 0 },
  { role: 'output', floorId: 2, cell: { x: 8, z: 0 }, travelRotation: 0 },
])
const snappedUp = snapInclinePlacement({ x: 1, z: 0 }, 'inclineUp', 0, 1, [{ id: 'lower-feed', type: 'conveyor', pos: { x: -1, z: 0 }, rotation: 0, floorId: 1 }])
assert.equal(snappedUp.snapped, true)
assert.deepEqual(snappedUp.lowPos, { x: 0, z: 0 })
assert.equal(snappedUp.interfaceRole, 'input')
assert.deepEqual(snapConveyorCellToIncline({ x: 7, z: 0 }, 2, [up]), { x: 8, z: 0 })
const dynamicUpperRamp = createInclineObject('ramp-l3-l4', 'inclineUp', { x: 0, z: 4 }, 0, 3)
assert.equal(dynamicUpperRamp?.incline?.lowerFloorId, 3)
assert.equal(dynamicUpperRamp?.incline?.upperFloorId, 4, '手动追加楼层后必须能继续放置跨层传送带')

const upObjects: FactoryObject[] = [
  { id: 'source-l1', type: 'source', pos: { x: -4, z: -1 }, rotation: 0, floorId: 1, itemId: iron },
  up,
  { id: 'belt-l2', type: 'conveyor', pos: { x: 8, z: 0 }, rotation: 0, floorId: 2 },
  { id: 'machine-l2', type: 'machine', pos: { x: 9, z: 0 }, rotation: 0, floorId: 2, recipeId: recipe.id },
]
const upEngine = new SimulationEngine(20260820)
upEngine.init(withRackSupply(upObjects), [recipe])
const firstLotConveyors = new Set<string>()
for (let index = 0; index < 450; index += 1) {
  upEngine.advance(0.1)
  const firstLot = upEngine.getSnapshot().itemLots.find((lot) => lot.id === 'lot_0')
  if (firstLot) firstLotConveyors.add(firstLot.conveyorId)
}
assert.ok((upEngine.getSnapshot().machines.find((runtime) => runtime.objectId === 'machine-l2')?.processingTime ?? 0) > 0, '向上斜坡没有把货物送到 L2 机器')
assert.ok(firstLotConveyors.size >= 2, '同一货物跨传送带段时必须保留 ID，以支持平滑运输')

const down = createInclineObject('ramp-down', 'inclineDown', { x: 0, z: 0 }, 0, 1)
assert.ok(down?.incline)
const snappedDown = snapInclinePlacement({ x: 1, z: 0 }, 'inclineDown', 0, 1, [{ id: 'upper-feed', type: 'conveyor', pos: { x: 8, z: 0 }, rotation: 180, floorId: 2 }])
assert.equal(snappedDown.snapped, true)
assert.deepEqual(snappedDown.lowPos, { x: 0, z: 0 })
assert.equal(snappedDown.interfaceRole, 'input')
assert.deepEqual(snapConveyorCellToIncline({ x: 0, z: 0 }, 1, [down]), { x: -1, z: 0 })
const downObjects: FactoryObject[] = [
  { id: 'source-l2', type: 'source', pos: { x: 8, z: -1 }, rotation: 180, floorId: 2, itemId: iron },
  down,
  { id: 'belt-l1', type: 'conveyor', pos: { x: -1, z: 0 }, rotation: 180, floorId: 1 },
  { id: 'machine-l1', type: 'machine', pos: { x: -2, z: 0 }, rotation: 180, floorId: 1, recipeId: recipe.id },
]
const downEngine = new SimulationEngine(20260821)
downEngine.init(withRackSupply(downObjects), [recipe])
downEngine.advance(45)
assert.ok((downEngine.getSnapshot().machines.find((runtime) => runtime.objectId === 'machine-l1')?.processingTime ?? 0) > 0, '向下斜坡没有把货物送到 L1 机器')

const upperObstacle: FactoryObject = { id: 'upper-obstacle', type: 'machine', pos: { x: 4, z: 0 }, rotation: 0, floorId: 2 }
assert.equal(canPlaceIncline({ x: 0, z: 0 }, 'inclineUp', 0, 1, [upperObstacle]), false, '斜坡必须同时检查上下两层碰撞')
assert.equal(canPlace({ x: 4, z: 0 }, 'machine', 0, objectsTouchingFloor([up], 2)), false, '上层普通建筑不得穿过既有斜坡投影')

const saved = parseSave(serializeSave({ version: SAVE_VERSION, name: '跨层验证工厂', floorCount: 4, objects: [up, down, dynamicUpperRamp!], items: DEFAULT_ITEMS, recipes: [recipe] }))
assert.equal(saved.objects[0]?.floorId, 1)
assert.equal(saved.objects[1]?.floorId, 2)
assert.deepEqual(saved.objects[0]?.incline, up.incline)
assert.deepEqual(saved.objects[1]?.incline, down.incline)
assert.equal(saved.objects[2]?.incline?.upperFloorId, 4)

console.log('multifloor conveyor regression: passed')
