import assert from 'node:assert/strict'
import { useForgeMindStore } from '../src/store/forgeMind'
import { normalizeScreenRect, screenRectsIntersect, selectionKeyboardAction } from '../src/game/selection'
import type { FactoryObject } from '../src/game/types'

assert.deepEqual(selectionKeyboardAction('w'), { type: 'move', dx: 0, dz: -1 })
assert.deepEqual(selectionKeyboardAction('KeyW'), { type: 'move', dx: 0, dz: -1 })
assert.deepEqual(selectionKeyboardAction('A'), { type: 'move', dx: -1, dz: 0 })
assert.deepEqual(selectionKeyboardAction('s'), { type: 'move', dx: 0, dz: 1 })
assert.deepEqual(selectionKeyboardAction('D'), { type: 'move', dx: 1, dz: 0 })
assert.deepEqual(selectionKeyboardAction('q'), { type: 'rotate', direction: -1 })
assert.deepEqual(selectionKeyboardAction('E'), { type: 'rotate', direction: 1 })
assert.deepEqual(selectionKeyboardAction('Delete'), { type: 'delete' })
assert.deepEqual(selectionKeyboardAction('Del'), { type: 'delete' })
assert.deepEqual(selectionKeyboardAction('NumpadDecimal'), { type: 'delete' })
assert.deepEqual(selectionKeyboardAction('Backspace'), { type: 'delete' })
assert.equal(selectionKeyboardAction('r'), null)

const marquee = normalizeScreenRect(220, 180, 80, 40)
assert.deepEqual(marquee, { left: 80, top: 40, right: 220, bottom: 180 })
assert.equal(screenRectsIntersect(marquee, { left: 200, top: 120, right: 260, bottom: 210 }), true)
assert.equal(screenRectsIntersect(marquee, { left: 221, top: 120, right: 260, bottom: 210 }), false)

useForgeMindStore.getState().newFactory('selection regression')
const objects: FactoryObject[] = [
  { id: 'select-a', type: 'conveyor', pos: { x: 0, z: 0 }, rotation: 0, floorId: 1 },
  { id: 'select-b', type: 'conveyor', pos: { x: 2, z: 0 }, rotation: 0, floorId: 1 },
]
useForgeMindStore.setState({ objects, selectedId: null, selectedIds: [] })

useForgeMindStore.getState().select('select-a')
assert.equal(useForgeMindStore.getState().selectedId, 'select-a')
assert.deepEqual(useForgeMindStore.getState().selectedIds, ['select-a'])
assert.equal(useForgeMindStore.getState().moveObject('select-a', 1, 0), true)
assert.deepEqual(useForgeMindStore.getState().objects.find((object) => object.id === 'select-a')?.pos, { x: 1, z: 0 })
assert.equal(useForgeMindStore.getState().moveObject('select-a', 1, 0), false, '移动到已占用网格必须被拒绝')
assert.deepEqual(useForgeMindStore.getState().objects.find((object) => object.id === 'select-a')?.pos, { x: 1, z: 0 })

assert.equal(useForgeMindStore.getState().rotateObject('select-a', -1), true)
assert.equal(useForgeMindStore.getState().objects.find((object) => object.id === 'select-a')?.rotation, 270)
assert.equal(useForgeMindStore.getState().rotateObject('select-a', 1), true)
assert.equal(useForgeMindStore.getState().objects.find((object) => object.id === 'select-a')?.rotation, 0)

useForgeMindStore.getState().selectMany(['select-a', 'select-b', 'select-a', 'missing'])
assert.deepEqual(useForgeMindStore.getState().selectedIds, ['select-a', 'select-b'])
useForgeMindStore.getState().removeMany(useForgeMindStore.getState().selectedIds)
assert.equal(useForgeMindStore.getState().objects.length, 0)
assert.deepEqual(useForgeMindStore.getState().selectedIds, [])
useForgeMindStore.getState().undo()
assert.deepEqual(useForgeMindStore.getState().objects.map((object) => object.id), ['select-a', 'select-b'])
assert.deepEqual(useForgeMindStore.getState().selectedIds, ['select-a', 'select-b'], '批量删除撤销应恢复整个选择集合')

console.log('selection regression: passed')
