import assert from 'node:assert/strict'
import { conveyorFloorsVisible, floorObjectsVisible, floorVisibilityRange } from '../../src/domain/floorVisibility'
import type { Floor } from '../../src/types'

const floors: Floor[] = [
  { id: 'floor-1', factoryId: 'factory-floor-visibility', level: 1, name: '1F', elevationM: 0, heightM: 4.5 },
  { id: 'floor-2', factoryId: 'factory-floor-visibility', level: 2, name: '2F', elevationM: 4.5, heightM: 4.5 },
  { id: 'floor-3', factoryId: 'factory-floor-visibility', level: 3, name: '3F', elevationM: 9, heightM: 4.5 },
]
const allEnabled = new Set(floors.map((floor) => floor.id))

assert(floorObjectsVisible('floor-2', 'floor-2', 'current-only', allEnabled), 'the active floor should be visible in current-only mode')
assert(!floorObjectsVisible('floor-1', 'floor-2', 'current-only', allEnabled), 'a lower floor should stay hidden in current-only mode')
assert(!floorObjectsVisible('floor-3', 'floor-2', 'current-only', allEnabled), 'an upper floor should stay hidden in current-only mode')
assert(floorObjectsVisible('floor-1', 'floor-2', 'lower-transparent', allEnabled), 'multi-floor mode should include enabled lower floors')
assert(floorObjectsVisible('floor-3', 'floor-2', 'lower-transparent', allEnabled), 'multi-floor mode should include enabled upper floors')

const floor3Disabled = new Set(['floor-1', 'floor-2'])
assert(!floorObjectsVisible('floor-3', 'floor-2', 'lower-transparent', floor3Disabled), 'a disabled upper floor must remain hidden in transparent mode')
assert(!floorObjectsVisible('floor-3', 'floor-2', 'lower-solid', floor3Disabled), 'a disabled upper floor must remain hidden in solid mode')
assert(!floorObjectsVisible('floor-3', 'floor-3', 'current-only', floor3Disabled), 'disabling the current floor should hide its objects while leaving its grid policy independent')

assert(conveyorFloorsVisible('floor-2', 'floor-3', 'floor-2', 'current-only', allEnabled), 'a current-floor cross-level conveyor should be visible when both floors are enabled')
assert(!conveyorFloorsVisible('floor-2', 'floor-3', 'floor-2', 'lower-solid', floor3Disabled), 'a cross-level conveyor must hide when either endpoint floor is disabled')

const middleRange = floorVisibilityRange(floors, 'floor-2', 'lower-solid', allEnabled)
assert.deepEqual(middleRange, {
  lowestElevationM: 0,
  highestElevationM: 9,
  lowerDepthM: 4.5,
  upperHeightM: 4.5,
  verticalSpanM: 9,
  centerOffsetM: 0,
  hasContextFloors: true,
})
const bottomRange = floorVisibilityRange(floors, 'floor-1', 'lower-transparent', allEnabled)
assert.equal(bottomRange.upperHeightM, 9, 'camera framing should include enabled floors above the active floor')
assert.equal(bottomRange.centerOffsetM, 4.5, 'camera target should move toward the center of the full visible vertical range')
const currentOnlyRange = floorVisibilityRange(floors, 'floor-2', 'current-only', allEnabled)
assert.equal(currentOnlyRange.verticalSpanM, 0)
assert.equal(currentOnlyRange.hasContextFloors, false)

console.log(JSON.stringify({
  currentOnly: ['floor-2'],
  transparentVisibleFloors: [...allEnabled],
  disabledUpperFloorVisible: false,
  crossLevelConveyorRequiresBothFloors: true,
  middleFloorRange: middleRange,
  bottomFloorUpperHeightM: bottomRange.upperHeightM,
}, null, 2))
