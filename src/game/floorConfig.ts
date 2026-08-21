/** Shared multi-floor geometry. Kept outside the scene layer for simulation use. */
export const FLOOR_HEIGHT_M = 5.25
export const FLOOR_DECK_THICKNESS_M = 0.16
export const FLOOR_DECK_UNDERSIDE_M = FLOOR_HEIGHT_M - FLOOR_DECK_THICKNESS_M / 2
export const MIN_FACTORY_FLOORS = 1
export const MAX_FACTORY_FLOORS = 12

export interface FactoryFloorDefinition {
  id: number
  code: string
  name: string
  description: string
  elevation: number
}

const FLOOR_NAMES = ['生产层', '工艺层', '装配层'] as const
const FLOOR_DESCRIPTIONS = [
  'PRODUCTION / DRONE DOCK',
  'PROCESS LINE / DRONE SUPPLY',
  'ASSEMBLY LINE / DRONE SUPPLY',
] as const

export function clampFloorCount(value: number): number {
  return Math.min(MAX_FACTORY_FLOORS, Math.max(MIN_FACTORY_FLOORS, Math.round(value)))
}

export function getFactoryFloors(count: number, names: readonly string[] = []): FactoryFloorDefinition[] {
  return Array.from({ length: clampFloorCount(count) }, (_, index) => {
    const id = index + 1
    return {
      id,
      code: `L${id}`,
      name: names[index]?.trim() || FLOOR_NAMES[index] || `扩展层 ${id}`,
      description: FLOOR_DESCRIPTIONS[index] ?? `EXPANSION LEVEL / L${id}`,
      elevation: index * FLOOR_HEIGHT_M,
    }
  })
}

/** ForgeCore's established incline was 4.5 m rise over 6 m run (75% grade). */
export const INCLINE_CONVEYOR_GRADE = 0.75
export const INCLINE_CONVEYOR_RUN_M = FLOOR_HEIGHT_M / INCLINE_CONVEYOR_GRADE
export const INCLINE_CONVEYOR_LENGTH_M = Math.hypot(FLOOR_HEIGHT_M, INCLINE_CONVEYOR_RUN_M)
