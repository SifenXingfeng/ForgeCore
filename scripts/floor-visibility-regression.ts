import assert from 'node:assert/strict'
import { floorIsInteractive, floorObjectsVisible, gridVisibleOnFloor, inclineVisible } from '../src/game/floorVisibility'
import { getFactoryFloors, MAX_FACTORY_FLOORS } from '../src/game/floorConfig'

const visible = new Set([1, 3] as const)
assert.equal(floorObjectsVisible(1, 2, visible), true)
assert.equal(floorObjectsVisible(2, 2, visible), true, '活动楼层必须高优先级直接显示')
assert.equal(floorObjectsVisible(3, 2, visible), true)
assert.equal(floorObjectsVisible(2, 1, visible), false, '切走后必须恢复遵循原开关状态')
assert.equal(gridVisibleOnFloor(1, 2), false)
assert.equal(gridVisibleOnFloor(2, 2), true)
assert.equal(gridVisibleOnFloor(3, 2), false)
assert.equal(inclineVisible({ lowerFloorId: 1, upperFloorId: 2 }, 3, visible), false)
assert.equal(inclineVisible({ lowerFloorId: 1, upperFloorId: 2 }, 2, visible), true, '活动端点必须覆盖关闭的上下文开关')
assert.equal(inclineVisible({ lowerFloorId: 2, upperFloorId: 3 }, 1, new Set([2, 3] as const)), true)
assert.deepEqual([...visible].sort(), [1, 3], '选择楼层不得修改显示开关集合')
assert.equal(floorIsInteractive(2, 2), true)
assert.equal(floorIsInteractive(1, 2), false, '额外显示楼层必须保持只读')
assert.equal(getFactoryFloors(4)[3]?.code, 'L4')
assert.equal(getFactoryFloors(MAX_FACTORY_FLOORS + 5).length, MAX_FACTORY_FLOORS, '手动加层必须遵守安全上限')

console.log('floor visibility regression: passed')
