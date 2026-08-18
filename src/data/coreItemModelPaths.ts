/** Runtime URL projection of assets/3d/core/items/v1/catalog.json stable model IDs. */
export const CORE_ITEM_MODEL_PATHS: Readonly<Record<string, string>> = Object.freeze({
  BASIC_BOX: 'basic/box.glb',
  BASIC_CONE: 'basic/cone.glb',
  BASIC_CYLINDER: 'basic/cylinder.glb',
  BASIC_DISC: 'basic/disc.glb',
  BASIC_RING: 'basic/ring.glb',
  BASIC_SPHERE: 'basic/sphere.glb',
  CONTAINER_BOTTLE: 'package/bottle.glb',
  CONTAINER_DRUM: 'package/drum.glb',
  ELEC_BATTERY: 'electronic/battery.glb',
  ELEC_CHIP: 'electronic/chip.glb',
  ELEC_MODULE: 'electronic/module.glb',
  ELEC_MOTOR: 'electronic/motor.glb',
  ELEC_PCB: 'electronic/pcb.glb',
  MATERIAL_BEAM: 'material/beam.glb',
  MATERIAL_COIL: 'material/coil.glb',
  MATERIAL_PIPE: 'material/pipe.glb',
  MATERIAL_PLATE: 'material/plate.glb',
  MATERIAL_ROD: 'material/rod.glb',
  MATERIAL_WIRE_COIL: 'material/wire-coil.glb',
  PACK_BIN: 'package/bin.glb',
  PACK_BOX: 'package/box.glb',
  PACK_CRATE: 'package/crate.glb',
  PACK_PALLET: 'package/pallet.glb',
  PACK_SACK: 'package/sack.glb',
  PART_BEARING: 'mechanical/bearing.glb',
  PART_BOLT: 'mechanical/bolt.glb',
  PART_FLANGE: 'mechanical/flange.glb',
  PART_GEAR: 'mechanical/gear.glb',
  PART_NUT: 'mechanical/nut.glb',
  PART_SHAFT: 'mechanical/shaft.glb',
  PART_SPRING: 'mechanical/spring.glb',
  PART_WHEEL: 'mechanical/wheel.glb',
  RAW_CHUNK: 'material/chunk.glb',
  RAW_GRANULE: 'material/granule.glb',
  RAW_INGOT: 'material/ingot.glb',
  RAW_LOG: 'material/log.glb',
})

export function coreItemModelUrl(modelId: string | null | undefined): string | null {
  if (!modelId) return null
  const relativePath = CORE_ITEM_MODEL_PATHS[modelId]
  return relativePath ? `/3d/core/items/v1/${relativePath}` : null
}
