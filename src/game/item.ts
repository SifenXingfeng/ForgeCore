/**
 * Item / Recipe 数据模型（Day 3）。
 *
 * 关键区分（补充设计 §3.4）：Item 是「类型定义」，ItemLot 是「在途实例」。
 * Day 3 只做 Item 与 Recipe 的类型定义；ItemLot 到 Day 5 传送带实现时再加。
 */

/** 物品类别 */
export type ItemCategory = 'raw' | 'intermediate' | 'product'

export type ModelParameterValue = string | number | boolean
export type ModelParameters = Record<string, ModelParameterValue>

/** 物品类型定义 */
export interface Item {
  id: string
  /** 用户维护的业务编码；默认与稳定 id 相同。 */
  code?: string
  name: string
  category: ItemCategory
  /** 占位色（Day 3 视觉用；后续接默认模型） */
  color: string
  /** 尺寸：默认模型占用格数（MVP 单格） */
  size: number
  /** 备注 */
  note?: string
  /** ForgeCore core item GLB, copied into this app's public model registry. */
  modelPath?: string
  /** Stable ForgeCore model identity; modelPath remains for backwards compatibility. */
  modelId?: string
  /** ForgeCore 参数化模型覆盖值。 */
  modelParameters?: ModelParameters
  description?: string
  massKg?: number
  maxStackSize?: number
}

/** One appearance payload shared by editor previews, thumbnails, and scene cargo. */
export function resolveItemAppearanceParameters(item: Pick<Item, 'color' | 'modelParameters'>): ModelParameters {
  const parameters = { ...(item.modelParameters ?? {}) }
  if (!Object.prototype.hasOwnProperty.call(parameters, 'color') && item.color) parameters.color = item.color
  return parameters
}

/** 配方单条输入 / 输出 */
export interface RecipePort {
  itemId: string
  qty: number
}

/** 生产配方：多输入 → 多输出 + 加工时长 */
export interface Recipe {
  id: string
  code?: string
  name: string
  description?: string
  enabled?: boolean
  inputs: RecipePort[]
  outputs: RecipePort[]
  /** 基准加工时长（秒） */
  durationSec: number
}

/** 物品类别中文标签 */
export const CATEGORY_LABELS: Record<ItemCategory, string> = {
  raw: '原料',
  intermediate: '中间品',
  product: '成品',
}

/** 默认物品色板（按类别） */
export const CATEGORY_COLORS: Record<ItemCategory, string> = {
  raw: '#fbc02d',
  intermediate: '#4fc3f7',
  product: '#66bb6a',
}

/** 生成短 id */
export function genId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}`
}

/** Starter industrial vocabulary used by the build workstation. */
export const DEFAULT_ITEMS: Item[] = [
  { id: 'item_steel_blank', name: '钢制毛坯', category: 'raw', color: '#87959a', size: 1, modelPath: 'material/ingot.glb', modelId: 'RAW_INGOT' },
  { id: 'item_steel_sheet', name: '冷轧钢板', category: 'raw', color: '#9ba8aa', size: 1, modelPath: 'material/plate.glb', modelId: 'MATERIAL_PLATE' },
  { id: 'item_copper_wire', name: '铜线盘', category: 'raw', color: '#c87948', size: 1, modelPath: 'material/wire-coil.glb', modelId: 'MATERIAL_WIRE_COIL' },
  { id: 'item_screw', name: '螺丝', category: 'raw', color: '#6d7b7b', size: 1, modelPath: 'mechanical/bolt.glb', modelId: 'PART_BOLT' },
  { id: 'item_fastener', name: '标准紧固件', category: 'raw', color: '#6d7b7b', size: 1, modelPath: 'mechanical/bolt.glb', modelId: 'PART_BOLT' },
  { id: 'item_fastener_kit', name: '紧固件齐套包', category: 'intermediate', color: '#7f8b88', size: 1, modelPath: 'package/box.glb', modelId: 'PACK_BOX' },
  { id: 'item_machined_housing', name: '机加工壳体', category: 'intermediate', color: '#71868a', size: 1, modelPath: 'material/chunk.glb', modelId: 'RAW_CHUNK' },
  { id: 'item_stamped_shell', name: '冲压壳体', category: 'intermediate', color: '#8a9ca0', size: 1, modelPath: 'material/plate.glb', modelId: 'MATERIAL_PLATE' },
  { id: 'item_clean_part', name: '洁净零件', category: 'intermediate', color: '#5f9c9c', size: 1, modelPath: 'mechanical/gear.glb', modelId: 'PART_GEAR' },
  { id: 'item_coil', name: '定子线圈', category: 'intermediate', color: '#c28e35', size: 1, modelPath: 'material/coil.glb', modelId: 'MATERIAL_COIL' },
  { id: 'item_motor', name: '电机总成', category: 'product', color: '#4c9fa0', size: 1, modelPath: 'electronic/motor.glb', modelId: 'ELEC_MOTOR' },
  { id: 'item_inspected_motor', name: '已检电机', category: 'product', color: '#3f9d79', size: 1, modelPath: 'electronic/motor.glb', modelId: 'ELEC_MOTOR' },
]

export const DEFAULT_RECIPES: Recipe[] = [
  { id: 'recipe_machining', name: '数控车铣复合', inputs: [{ itemId: 'item_steel_blank', qty: 1 }], outputs: [{ itemId: 'item_machined_housing', qty: 1 }], durationSec: 6.0 },
  { id: 'recipe_stamping', name: '板材冲压成型', inputs: [{ itemId: 'item_steel_sheet', qty: 1 }], outputs: [{ itemId: 'item_stamped_shell', qty: 1 }], durationSec: 4.0 },
  { id: 'recipe_coil', name: '定子线圈绕制', inputs: [{ itemId: 'item_copper_wire', qty: 1 }], outputs: [{ itemId: 'item_coil', qty: 1 }], durationSec: 5.5 },
  { id: 'recipe_fastener_kit', name: '紧固件自动齐套', inputs: [{ itemId: 'item_fastener', qty: 4 }], outputs: [{ itemId: 'item_fastener_kit', qty: 1 }], durationSec: 2.5 },
  { id: 'recipe_wash', name: '去毛刺与清洗', inputs: [{ itemId: 'item_machined_housing', qty: 1 }], outputs: [{ itemId: 'item_clean_part', qty: 1 }], durationSec: 3.5 },
  { id: 'recipe_motor', name: '电机自动装配', inputs: [{ itemId: 'item_clean_part', qty: 1 }, { itemId: 'item_stamped_shell', qty: 1 }, { itemId: 'item_fastener_kit', qty: 1 }, { itemId: 'item_coil', qty: 1 }], outputs: [{ itemId: 'item_motor', qty: 1 }], durationSec: 8.0 },
  { id: 'recipe_inspection', name: '视觉终检与追溯', inputs: [{ itemId: 'item_motor', qty: 1 }], outputs: [{ itemId: 'item_inspected_motor', qty: 1 }], durationSec: 2.0 },
  { id: 'recipe_packaging', name: '成品包装入库', inputs: [{ itemId: 'item_inspected_motor', qty: 1 }], outputs: [{ itemId: 'item_inspected_motor', qty: 1 }], durationSec: 3.0 },
]
