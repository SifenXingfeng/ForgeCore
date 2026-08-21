import type { FactoryObject } from './types'

/**
 * A-02 is intentionally empty at boot. It is the bounded sandbox for
 * generated layouts, candidate previews, and future optimization runs.
 */
export const BASE_A02_OBJECTS: FactoryObject[] = []

export function createBaseA02Layout(): FactoryObject[] {
  return BASE_A02_OBJECTS.map((object) => ({ ...object, pos: { ...object.pos } }))
}
