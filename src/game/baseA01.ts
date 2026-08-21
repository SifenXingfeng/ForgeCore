import type { FactoryObject, Rotation } from './types'
import { WAREHOUSE_RACKS } from './warehouse'

const unit = (
  id: string,
  type: FactoryObject['type'],
  x: number,
  z: number,
  rotation: Rotation,
  binding: Pick<FactoryObject, 'recipeId' | 'itemId' | 'agvProgram' | 'floorId'> = {},
): FactoryObject => ({ id, type, pos: { x, z }, rotation, ...binding })

const floorUnit = (
  floorId: 2 | 3,
  id: string,
  type: FactoryObject['type'],
  x: number,
  z: number,
  rotation: Rotation,
  binding: Pick<FactoryObject, 'recipeId' | 'itemId' | 'agvProgram'> = {},
): FactoryObject => unit(id, type, x, z, rotation, { ...binding, floorId })

/** L2: component manufacturing and kitting floor supplied through the L1 drone dock. */
export const FLOOR_L2_OBJECTS: FactoryObject[] = [
  // Steel housing: machining -> wash/deburr -> clean-part buffer.
  floorUnit(2, 'l2_infeed_steel', 'source', -23, -10, 0, { itemId: 'item_steel_blank' }),
  floorUnit(2, 'l2_cv_steel_01', 'conveyor', -22, -10, 0),
  floorUnit(2, 'l2_cv_steel_02', 'conveyor', -21, -10, 0),
  floorUnit(2, 'l2_cnc_housing', 'smelter', -20, -10, 0, { recipeId: 'recipe_machining' }),
  floorUnit(2, 'l2_cv_housing_01', 'conveyor', -17, -10, 0),
  floorUnit(2, 'l2_cv_housing_02', 'conveyor', -16, -10, 0),
  floorUnit(2, 'l2_wash_deburr', 'washing', -15, -10, 0, { recipeId: 'recipe_wash' }),
  floorUnit(2, 'l2_cv_clean_01', 'conveyor', -13, -10, 0),
  floorUnit(2, 'l2_cv_clean_02', 'conveyor', -12, -10, 0),
  floorUnit(2, 'l2_clean_buffer', 'storage', -11, -10, 0),

  // Steel sheet: stamping -> shell buffer.
  floorUnit(2, 'l2_infeed_sheet', 'source', -4, 13, 270, { itemId: 'item_steel_sheet' }),
  floorUnit(2, 'l2_cv_sheet_01', 'conveyor', -4, 12, 270),
  floorUnit(2, 'l2_cv_sheet_02', 'conveyor', -4, 11, 270),
  floorUnit(2, 'l2_press', 'press', -4, 9, 270, { recipeId: 'recipe_stamping' }),
  floorUnit(2, 'l2_cv_shell_01', 'conveyor', -4, 7, 270),
  floorUnit(2, 'l2_cv_shell_02', 'conveyor', -4, 6, 270),
  floorUnit(2, 'l2_shell_buffer', 'storage', -4, 4, 270),

  // Copper coil: winding -> coil buffer.
  floorUnit(2, 'l2_infeed_copper', 'source', 7, -14, 0, { itemId: 'item_copper_wire' }),
  floorUnit(2, 'l2_cv_copper_01', 'conveyor', 8, -14, 0),
  floorUnit(2, 'l2_cv_copper_02', 'conveyor', 9, -14, 0),
  floorUnit(2, 'l2_coil_winding', 'machine', 10, -14, 0, { recipeId: 'recipe_coil' }),
  floorUnit(2, 'l2_cv_coil_01', 'conveyor', 11, -14, 0),
  floorUnit(2, 'l2_cv_coil_02', 'conveyor', 12, -14, 0),
  floorUnit(2, 'l2_coil_buffer', 'storage', 13, -14, 0),

  // Fasteners: four-piece kitting cell -> kit buffer.
  floorUnit(2, 'l2_infeed_fastener', 'source', -23, 10, 0, { itemId: 'item_fastener' }),
  floorUnit(2, 'l2_cv_fastener_01', 'conveyor', -22, 10, 0),
  floorUnit(2, 'l2_cv_fastener_02', 'conveyor', -21, 10, 0),
  floorUnit(2, 'l2_kitting', 'machine', -20, 10, 0, { recipeId: 'recipe_fastener_kit' }),
  floorUnit(2, 'l2_cv_kit_01', 'conveyor', -19, 10, 0),
  floorUnit(2, 'l2_cv_kit_02', 'conveyor', -18, 10, 0),
  floorUnit(2, 'l2_kit_buffer', 'storage', -17, 10, 0),
]

/** L3: drone-fed multi-input assembly, QA, packaging, and finished-goods dispatch. */
export const FLOOR_L3_OBJECTS: FactoryObject[] = [
  // Four independent drone-fed input lanes converge on the robotic assembly cell.
  floorUnit(3, 'l3_infeed_clean_part', 'source', -8, 1, 0, { itemId: 'item_clean_part' }),
  ...[-7, -6, -5, -4, -3, -2, -1, 0].map((x) => floorUnit(3, `l3_cv_clean_${x}`, 'conveyor', x, 1, 0)),
  floorUnit(3, 'l3_infeed_shell', 'source', 3, 10, 270, { itemId: 'item_stamped_shell' }),
  ...[9, 8, 7, 6, 5, 4].map((z) => floorUnit(3, `l3_cv_shell_${z}`, 'conveyor', 3, z, 270)),
  floorUnit(3, 'l3_infeed_kit', 'source', 3, -7, 90, { itemId: 'item_fastener_kit' }),
  ...[-6, -5, -4, -3, -2, -1].map((z) => floorUnit(3, `l3_cv_kit_${z}`, 'conveyor', 3, z, 90)),
  floorUnit(3, 'l3_infeed_coil', 'source', 10, -10, 180, { itemId: 'item_coil' }),
  // Coil input turns north outside the QA lane, then approaches the
  // assembler's free rear dock at x=1,z=2.
  floorUnit(3, 'l3_cv_coil_09', 'conveyor', 9, -10, 180),
  floorUnit(3, 'l3_cv_coil_08', 'conveyor', 8, -10, 180),
  floorUnit(3, 'l3_cv_coil_turn_01', 'conveyor', 8, -9, 90),
  ...[-8, -7, -6, -5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((z) => floorUnit(3, `l3_cv_coil_y${z}`, 'conveyor', 8, z, 90)),
  floorUnit(3, 'l3_cv_coil_turn_02', 'conveyor', 8, 12, 180),
  ...[7, 6, 5, 4, 3, 2, 1, 0].map((x) => floorUnit(3, `l3_cv_coil_x${x}`, 'conveyor', x, 12, 180)),
  floorUnit(3, 'l3_cv_coil_turn_03', 'conveyor', 0, 11, 270),
  ...[10, 9, 8, 7, 6, 5, 4, 3].map((z) => floorUnit(3, `l3_cv_coil_drop${z}`, 'conveyor', 0, z, 270)),
  floorUnit(3, 'l3_cv_coil_approach', 'conveyor', 0, 2, 0),

  floorUnit(3, 'l3_robotic_assembly', 'assembler', 2, 0, 0, { recipeId: 'recipe_motor' }),
  floorUnit(3, 'l3_cv_assembly_out_01', 'conveyor', 5, 1, 0),
  floorUnit(3, 'l3_cv_assembly_out_02', 'conveyor', 6, 1, 0),
  floorUnit(3, 'l3_vision_inspection', 'inspection', 7, 1, 0, { recipeId: 'recipe_inspection' }),
  floorUnit(3, 'l3_cv_qa_01', 'conveyor', 9, 1, 0),
  floorUnit(3, 'l3_cv_qa_02', 'conveyor', 10, 1, 0),
  floorUnit(3, 'l3_packaging', 'machine', 11, 1, 0, { recipeId: 'recipe_packaging' }),
  floorUnit(3, 'l3_quality_splitter', 'splitter', 12, 1, 0),
  floorUnit(3, 'l3_cv_finished', 'conveyor', 13, 1, 0),
  floorUnit(3, 'l3_finished_buffer', 'storage', 14, 1, 0),
]

/**
 * Base A-01 follows a real one-way factory flow rather than a symmetrical game
 * board: west receiving and raw supermarket, a straight machining spine,
 * line-side component feeders around the assembly cell, then eastbound QA,
 * packaging, finished-goods buffers and dispatch.
 */
export const BASE_A01_OBJECTS: FactoryObject[] = [
  // 01 Receiving -> inbound AGV -> raw supermarket -> housing machining.
  unit('a01_infeed_steel', 'source', -23, 1, 0, { itemId: 'item_steel_blank' }),
  unit('a01_cv_receiving_01', 'conveyor', -20, 1, 0),
  unit('a01_cv_receiving_02', 'conveyor', -19, 1, 0),
  unit('a01_agv_inbound', 'agv', -21, 4, 0, { agvProgram: { enabled: true, sourceObjectId: 'a01_warehouse_raw_rack_01', destinationObjectId: 'a01_raw_material_rack', itemId: 'item_steel_blank', loadQuantity: 100, priority: 2, policy: 'priority' } }),
  unit('a01_raw_material_rack', 'oreMiner', -18, 1, 0),
  unit('a01_cv_main_01', 'conveyor', -16, 1, 0),
  unit('a01_cv_main_02', 'conveyor', -15, 1, 0),
  unit('a01_cv_main_03', 'conveyor', -14, 1, 0),
  unit('a01_cnc_housing', 'smelter', -13, 1, 0, { recipeId: 'recipe_machining' }),
  unit('a01_cv_main_04', 'conveyor', -10, 1, 0),
  unit('a01_cv_main_05', 'conveyor', -9, 1, 0),
  unit('a01_wash_deburr', 'washing', -8, 1, 0, { recipeId: 'recipe_wash' }),
  unit('a01_cv_main_06', 'conveyor', -6, 1, 0),
  unit('a01_cv_main_07', 'conveyor', -5, 1, 0),
  unit('a01_housing_wip_buffer', 'storage', -4, 1, 0),
  unit('a01_cv_main_08', 'conveyor', -2, 1, 0),
  unit('a01_cv_main_09', 'conveyor', -1, 1, 0),
  unit('a01_cv_main_10', 'conveyor', 0, 1, 0),
  unit('a01_cv_main_11', 'conveyor', 1, 1, 0),
  unit('a01_cv_main_12', 'conveyor', 2, 1, 0),
  unit('a01_cv_main_13', 'conveyor', 3, 1, 0),

  // 02 North forming island: sheet receiving and press feed the assembly cell.
  unit('a01_infeed_sheet', 'source', 5, 10, 270, { itemId: 'item_steel_sheet' }),
  unit('a01_cv_sheet_01', 'conveyor', 5, 9, 270),
  unit('a01_cv_sheet_02', 'conveyor', 5, 8, 270),
  unit('a01_hydraulic_press', 'press', 5, 6, 270, { recipeId: 'recipe_stamping' }),
  unit('a01_cv_stamp_01', 'conveyor', 5, 5, 270),
  unit('a01_cv_stamp_02', 'conveyor', 5, 4, 270),
  unit('a01_cv_stamp_03', 'conveyor', 5, 3, 270),

  // 03 South electrical island: copper receiving and coil winding.
  unit('a01_infeed_copper', 'source', 5, -10, 90, { itemId: 'item_copper_wire' }),
  unit('a01_cv_copper_01', 'conveyor', 5, -7, 90),
  unit('a01_cv_copper_02', 'conveyor', 5, -6, 90),
  unit('a01_coil_winding', 'machine', 5, -5, 90, { recipeId: 'recipe_coil' }),
  unit('a01_cv_coil_01', 'conveyor', 5, -4, 90),
  unit('a01_cv_coil_02', 'conveyor', 5, -3, 90),
  unit('a01_cv_coil_03', 'conveyor', 5, -2, 90),
  unit('a01_cv_coil_04', 'conveyor', 5, -1, 90),

  // 04 Line-side kitting island. Fasteners are batched in sets of four before
  // they enter a dedicated rear assembly dock, avoiding mixed-lane starvation.
  unit('a01_infeed_fasteners', 'source', -8, -5, 0, { itemId: 'item_fastener' }),
  unit('a01_cv_fastener_01', 'conveyor', -5, -5, 0),
  unit('a01_cv_fastener_02', 'conveyor', -4, -5, 0),
  unit('a01_fastener_kitting', 'machine', -3, -5, 0, { recipeId: 'recipe_fastener_kit' }),
  unit('a01_cv_kit_01', 'conveyor', -2, -5, 0),
  unit('a01_cv_kit_02', 'conveyor', -1, -5, 0),
  unit('a01_cv_kit_03', 'conveyor', 0, -5, 0),
  unit('a01_cv_kit_04', 'conveyor', 1, -5, 0),
  unit('a01_cv_kit_05', 'conveyor', 2, -5, 0),
  unit('a01_cv_kit_corner_01', 'conveyor', 3, -5, 90),
  unit('a01_cv_kit_06', 'conveyor', 3, -4, 90),
  unit('a01_cv_kit_07', 'conveyor', 3, -3, 90),
  unit('a01_cv_kit_08', 'conveyor', 3, -2, 90),
  unit('a01_cv_kit_09', 'conveyor', 3, -1, 90),
  unit('a01_cv_kit_corner_02', 'conveyor', 3, 0, 0),

  // 05 Robot assembly -> vision inspection -> packaging -> quality routing.
  unit('a01_robotic_assembly', 'assembler', 4, 0, 0, { recipeId: 'recipe_motor' }),
  unit('a01_cv_quality_01', 'conveyor', 7, 1, 0),
  unit('a01_vision_inspection', 'inspection', 8, 1, 0, { recipeId: 'recipe_inspection' }),
  unit('a01_cv_quality_02', 'conveyor', 10, 1, 0),
  unit('a01_packaging_cell', 'machine', 11, 1, 0, { recipeId: 'recipe_packaging' }),
  unit('a01_quality_splitter', 'splitter', 12, 1, 0),
  unit('a01_cv_finished', 'conveyor', 13, 1, 0),
  unit('a01_finished_buffer', 'storage', 14, 1, 0),
  unit('a01_agv_outbound', 'agv', 16, 1, 0, { agvProgram: { enabled: true, sourceObjectId: 'a01_warehouse_raw_rack_02', destinationObjectId: 'a01_finished_buffer', itemId: 'item_steel_blank', loadQuantity: 100, priority: 1, policy: 'balanced' } }),
  unit('a01_cv_rework', 'conveyor', 12, 2, 90),
  unit('a01_rework_buffer', 'storage', 12, 3, 90),
  unit('a01_cv_quarantine', 'conveyor', 12, 0, 270),
  unit('a01_quarantine_buffer', 'storage', 12, -2, 270),

  // 06 Vehicles parked on the marked logistics aisle; these are visible fleet
  // capacity, not decorative machines embedded in the conveyor backbone.
  unit('a01_agv_logistics_01', 'agv', -12, -14, 0, { agvProgram: { enabled: true, sourceObjectId: 'a01_warehouse_finished_rack_01', destinationObjectId: 'a01_raw_material_rack', itemId: 'item_steel_blank', loadQuantity: 100, priority: 0, policy: 'balanced' } }),
  unit('a01_agv_logistics_02', 'agv', 6, -14, 180, { agvProgram: { enabled: true, sourceObjectId: 'a01_warehouse_raw_rack_01', destinationObjectId: 'a01_finished_buffer', itemId: 'item_steel_blank', loadQuantity: 100, priority: 0, policy: 'shortest' } }),
  unit('a01_drone_logistics_01', 'drone', 18, -14, 180, { agvProgram: { enabled: true, sourceObjectId: 'l2_clean_buffer', destinationObjectId: 'l3_finished_buffer', itemId: 'item_clean_part', loadQuantity: 3, priority: 2, policy: 'shortest' } }),

  // 07 左侧仓储区：两组原料货架 + 两组成品缓存，东侧留出 AGV 装卸通道。
  ...WAREHOUSE_RACKS.map((rack) => unit(
    rack.id,
    rack.tone === 'raw' ? 'oreMiner' : 'storage',
    rack.pos.x,
    rack.pos.z,
    0,
  )),

  ...FLOOR_L2_OBJECTS,
  ...FLOOR_L3_OBJECTS,
]

export function createBaseA01Layout(): FactoryObject[] {
  return BASE_A01_OBJECTS.map((object) => ({ ...object, pos: { ...object.pos } }))
}
