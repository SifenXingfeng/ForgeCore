import type { FactoryFloorId, InclineConveyorConfig } from './types'

/** The active floor overrides its independent context-visibility switch. */
export function floorObjectsVisible(floorId: FactoryFloorId, activeFloor: FactoryFloorId, visibleFloors: ReadonlySet<FactoryFloorId>) {
  return floorId === activeFloor || visibleFloors.has(floorId)
}

/** Context floors are render-only; only the selected floor accepts interaction. */
export function floorIsInteractive(floorId: FactoryFloorId, activeFloor: FactoryFloorId) {
  return floorId === activeFloor
}

export function inclineVisible(config: Pick<InclineConveyorConfig, 'lowerFloorId' | 'upperFloorId'>, activeFloor: FactoryFloorId, visibleFloors: ReadonlySet<FactoryFloorId>) {
  return floorObjectsVisible(config.lowerFloorId, activeFloor, visibleFloors)
    && floorObjectsVisible(config.upperFloorId, activeFloor, visibleFloors)
}

/** The construction grid is singular and always follows the selected floor. */
export function gridVisibleOnFloor(floorId: FactoryFloorId, activeFloor: FactoryFloorId) {
  return floorId === activeFloor
}
