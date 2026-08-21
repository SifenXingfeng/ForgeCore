import { Html } from '@react-three/drei'
import { getFactoryObjectDisplayName, getObjectDef, type FactoryObject } from '../game/types'
import type { Item } from '../game/item'
import type { RackRuntimeSnapshot } from '../game/simulation'
import { isCargoStorageRack, objectToWorld } from '../game/grid'
import { buildingVisualScaleForType } from './industrialVisualScale'

/** Always-visible, read-only inventory labels for cargo racks on the active floor. */
export function RackInventoryLabels({ objects, racks, items }: { objects: FactoryObject[]; racks: RackRuntimeSnapshot[]; items: Item[] }) {
  const runtimeById = new Map(racks.map((rack) => [rack.objectId, rack]))
  return <group name="rack-actual-inventory-labels">{objects.filter(isCargoStorageRack).map((object) => {
    const runtime = runtimeById.get(object.id)
    const inventory = runtime?.inventory ?? object.storageConfig?.initialInventory ?? {}
    const entries = Object.entries(inventory).filter(([, quantity]) => quantity > 0)
    const total = entries.reduce((sum, [, quantity]) => sum + quantity, 0)
    const capacity = runtime?.capacity ?? object.storageConfig?.capacity ?? 100
    const world = objectToWorld(object)
    const height = getObjectDef(object.type, object.resourceId).height * buildingVisualScaleForType(object.type) + 0.35
    return <Html key={object.id} center sprite distanceFactor={13} position={[world.x, height, world.z]} style={{ pointerEvents: 'none' }}>
      <div className={`fm-rack-inventory-label${entries.length === 0 ? ' is-empty' : ''}`}>
        <span>{getFactoryObjectDisplayName(object)}</span>
        <div>{entries.length > 0 ? entries.map(([itemId, quantity]) => <b key={itemId}>{items.find((item) => item.id === itemId)?.name ?? itemId}<strong>×{quantity}</strong></b>) : <b>空货架<strong>×0</strong></b>}</div>
        <small>{total} / {capacity}</small>
      </div>
    </Html>
  })}</group>
}
