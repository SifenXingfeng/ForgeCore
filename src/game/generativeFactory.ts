import { CARDINALS, cellKey, dirToRotation } from './dir'
import { objectCompatiblePortCells, objectPortCells, objectPortCellsForSide, occupiedCells } from './grid'
import { DEFAULT_ITEMS, DEFAULT_RECIPES, type Item, type Recipe, type RecipePort } from './item'
import { SimulationEngine } from './simulation'
import { OBJECT_DEFS, objectRole, type BuildType, type FactoryObject, type PortSide, type Rotation } from './types'

export interface GenerationSpec {
  product: string
  targetThroughputPerHour: number
  floorWidth: number
  floorDepth: number
  cncLimit: number
  agvLimit: number
  objective: 'balanced' | 'throughput' | 'energy'
  /** Number of neighborhood-search rounds. Kept optional for saved briefs. */
  searchRounds?: number
  /** Optional economic assumptions supplied by the planning UI. */
  economics?: CostAssumptions
}

export interface CostAssumptions {
  energyPricePerKwh: number
  laborCostPerHour: number
  operatingHoursPerMonth: number
  contributionPerUnit: number
}

export interface EconomicMetrics {
  equipmentCost: number
  energyCostPerHour: number
  operatingCostPerMonth: number
  incrementalCapex: number
  monthlyBenefit: number
  paybackMonths: number | null
  roi12Month: number
}

export interface RecipeGraphNode {
  id: string
  recipeId: string
  name: string
  machineType: BuildType
  inputs: RecipePort[]
  outputs: RecipePort[]
  parallelCount: number
}

export interface RecipeGraphEdge {
  from: string
  to: string
  itemId: string
  qty: number
}

export interface RecipeGraph {
  product: string
  targetItemId: string
  nodes: RecipeGraphNode[]
  edges: RecipeGraphEdge[]
  rawInputs: string[]
  sourceItems: {
    steel: string
    sheet: string
    fastener: string
    auxiliary: string
  }
  recipeIds: {
    machining: string
    washing: string
    stamping: string
    fastenerKit: string
    auxiliary: string
    assembly: string
    inspection: string
    packaging: string
  }
  recipes: Recipe[]
  items: Item[]
}

export interface EquipmentEstimate {
  nodeId: string
  type: BuildType
  count: number
  requiredCount: number
  capacityPerHour: number
  rationale: string
}

export interface GeneratedMetrics {
  throughputPerHour: number
  utilization: number
  energyPerUnit: number
  logisticsEfficiency: number
  footprint: number
  changeCost: number
  layoutRisk: number
  economics: EconomicMetrics
}

export interface LayoutDiff {
  added: number
  removed: number
  moved: number
  rotated: number
  unchanged: number
  changeCost: number
}

export interface CandidateValidation {
  passed: boolean
  issues: GeneratedLayoutIssue[]
  connectedConveyors: number
  totalConveyors: number
  collisionCount: number
}

export interface CandidateSimulation {
  simulatedSeconds: number
  outputItemId: string
  outputUnits: number
  throughputPerHour: number
  utilization: number
  energyPerUnit: number
  logisticsEfficiency: number
  blockedSources: number
  bottleneck: string
}

export interface GeneratedCandidate {
  id: string
  rank: number
  name: string
  strategy: string
  description: string
  score: number
  metrics: GeneratedMetrics
  warnings: string[]
  recipeGraph: RecipeGraph
  equipment: EquipmentEstimate[]
  validation: CandidateValidation
  simulation: CandidateSimulation
  objects: FactoryObject[]
  mode: 'generate' | 'adjust'
  adjustments: AdjustmentAction[]
  diff: LayoutDiff
  paretoRank: number
  searchRound: number
}

export interface AdjustmentAction {
  kind: 'inspect' | 'reroute' | 'trim' | 'rebuild' | 'scale' | 'search'
  title: string
  detail: string
}

export interface GeneratedLayoutIssue {
  objectId: string
  message: string
}

export interface BriefParseResult {
  spec: GenerationSpec
  extracted: string[]
}

export type WhatIfMutation =
  | 'add-cnc'
  | 'remove-cnc'
  | 'add-assembly'
  | 'remove-assembly'
  | 'add-agv'
  | 'remove-agv'

export interface WhatIfResult {
  mutation: WhatIfMutation
  label: string
  before: GeneratedCandidate
  after: GeneratedCandidate
  delta: {
    throughputPerHour: number
    energyPerUnit: number
    utilization: number
    monthlyBenefit: number
    paybackMonths: number | null
  }
}

export const DEFAULT_COST_ASSUMPTIONS: CostAssumptions = {
  energyPricePerKwh: 0.82,
  laborCostPerHour: 180,
  operatingHoursPerMonth: 720,
  contributionPerUnit: 80,
}

const EQUIPMENT_CAPEX: Partial<Record<BuildType, number>> = {
  source: 50000,
  conveyor: 3500,
  machine: 85000,
  smelter: 320000,
  press: 260000,
  assembler: 420000,
  inspection: 180000,
  washing: 160000,
  agv: 180000,
  storage: 120000,
  splitter: 18000,
  merger: 18000,
}

type Cell = { x: number; z: number }

// Ten minutes is long enough to expose steady-state backpressure while keeping
// the three candidate simulations responsive in the browser main thread.
const SIMULATION_SECONDS = 600
const ITEM_NAMES: Record<string, string> = {
  item_steel_blank: '钢制毛坯',
  item_steel_sheet: '冷轧钢板',
  item_fastener: '标准紧固件',
  item_copper_wire: '铜线盘',
  item_lubricant: '工业润滑剂',
  item_gear_blank: '齿轮毛坯',
  item_clean_gear: '清洗齿轮组',
  item_gear_housing: '齿轮箱壳体',
  item_lubricant_pack: '定量润滑包',
  item_gearbox: '齿轮箱总成',
  item_inspected_gearbox: '已检齿轮箱',
}

const GEARBOX_ITEMS: Item[] = [
  { id: 'item_lubricant', name: '工业润滑剂', category: 'raw', color: '#d39a42', size: 1, modelPath: 'material/granule.glb', modelId: 'RAW_GRANULE' },
  { id: 'item_gear_blank', name: '齿轮毛坯', category: 'intermediate', color: '#71868a', size: 1, modelPath: 'material/ingot.glb', modelId: 'RAW_INGOT' },
  { id: 'item_clean_gear', name: '清洗齿轮组', category: 'intermediate', color: '#5f9c9c', size: 1, modelPath: 'mechanical/gear.glb', modelId: 'PART_GEAR' },
  { id: 'item_gear_housing', name: '齿轮箱壳体', category: 'intermediate', color: '#8a9ca0', size: 1, modelPath: 'material/chunk.glb', modelId: 'RAW_CHUNK' },
  { id: 'item_lubricant_pack', name: '定量润滑包', category: 'intermediate', color: '#c28e35', size: 1, modelPath: 'package/box.glb', modelId: 'PACK_BOX' },
  { id: 'item_gearbox', name: '齿轮箱总成', category: 'product', color: '#4c9fa0', size: 1, modelPath: 'package/crate.glb', modelId: 'PACK_CRATE' },
  { id: 'item_inspected_gearbox', name: '已检齿轮箱', category: 'product', color: '#3f9d79', size: 1, modelPath: 'package/crate.glb', modelId: 'PACK_CRATE' },
]

const GEARBOX_RECIPES: Recipe[] = [
  { id: 'recipe_gear_machining', name: '齿轮切削与精加工', inputs: [{ itemId: 'item_steel_blank', qty: 1 }], outputs: [{ itemId: 'item_gear_blank', qty: 1 }], durationSec: 5.5 },
  { id: 'recipe_gear_wash', name: '齿轮清洗与去毛刺', inputs: [{ itemId: 'item_gear_blank', qty: 1 }], outputs: [{ itemId: 'item_clean_gear', qty: 1 }], durationSec: 3.0 },
  { id: 'recipe_gear_housing', name: '箱体冲压成型', inputs: [{ itemId: 'item_steel_sheet', qty: 1 }], outputs: [{ itemId: 'item_gear_housing', qty: 1 }], durationSec: 4.5 },
  { id: 'recipe_fastener_kit', name: '齿轮箱紧固件齐套', inputs: [{ itemId: 'item_fastener', qty: 4 }], outputs: [{ itemId: 'item_fastener_kit', qty: 1 }], durationSec: 2.5 },
  { id: 'recipe_gear_lube', name: '定量润滑准备', inputs: [{ itemId: 'item_lubricant', qty: 1 }], outputs: [{ itemId: 'item_lubricant_pack', qty: 1 }], durationSec: 3.5 },
  { id: 'recipe_gearbox', name: '齿轮箱自动装配', inputs: [{ itemId: 'item_clean_gear', qty: 1 }, { itemId: 'item_gear_housing', qty: 1 }, { itemId: 'item_fastener_kit', qty: 1 }, { itemId: 'item_lubricant_pack', qty: 1 }], outputs: [{ itemId: 'item_gearbox', qty: 1 }], durationSec: 9.0 },
  { id: 'recipe_gear_inspection', name: '齿轮啮合视觉终检', inputs: [{ itemId: 'item_gearbox', qty: 1 }], outputs: [{ itemId: 'item_inspected_gearbox', qty: 1 }], durationSec: 2.5 },
  { id: 'recipe_gear_packaging', name: '齿轮箱包装入库', inputs: [{ itemId: 'item_inspected_gearbox', qty: 1 }], outputs: [{ itemId: 'item_inspected_gearbox', qty: 1 }], durationSec: 3.0 },
]

interface RecipeProfile {
  recipes: Recipe[]
  items: Item[]
  sourceItems: RecipeGraph['sourceItems']
  recipeIds: RecipeGraph['recipeIds']
}

const unit = (
  id: string,
  type: FactoryObject['type'],
  x: number,
  z: number,
  rotation: Rotation,
  binding: Pick<FactoryObject, 'recipeId' | 'itemId'> = {},
): FactoryObject => ({ id, type, pos: { x, z }, rotation, ...binding })

/** Parse the common Chinese brief format before the deterministic planner runs. */
export function parseGenerationBrief(brief: string, fallback: GenerationSpec): BriefParseResult {
  const text = brief.trim()
  const next = { ...fallback }
  const extracted: string[] = []

  const product = text.match(/(?:生产|制造|做)\s*([^。；;，,\n]+?)(?=每小时|场地|CNC|AGV|尽量|优先|$)/i)?.[1]?.trim()
  if (product) {
    next.product = product
    extracted.push(`产品：${product}`)
  }

  const throughput = text.match(/(?:每小时目标|目标产出|产出目标)\s*[:：]?\s*(\d+(?:\.\d+)?)/i)?.[1]
  if (throughput) {
    next.targetThroughputPerHour = Math.max(1, Number(throughput))
    extracted.push(`产出：${next.targetThroughputPerHour}/h`)
  }

  const floor = text.match(/场地\s*(\d+(?:\.\d+)?)\s*[×xX*]\s*(\d+(?:\.\d+)?)/i)
  if (floor) {
    next.floorWidth = Math.max(10, Number(floor[1]))
    next.floorDepth = Math.max(10, Number(floor[2]))
    extracted.push(`场地：${next.floorWidth}×${next.floorDepth}m`)
  }

  const cnc = text.match(/CNC\s*(?:最多|上限|不超过)?\s*(\d+)/i)?.[1]
  if (cnc) {
    next.cncLimit = Math.max(1, Math.floor(Number(cnc)))
    extracted.push(`CNC：${next.cncLimit}台`)
  }

  const agv = text.match(/AGV\s*(?:最多|上限|不超过)?\s*(\d+)/i)?.[1]
  if (agv) {
    next.agvLimit = Math.max(1, Math.floor(Number(agv)))
    extracted.push(`AGV：${next.agvLimit}台`)
  }

  if (/能耗|节能|省电|低能量/i.test(text)) {
    next.objective = 'energy'
    extracted.push('目标：降低能耗')
  } else if (/吞吐|产能|最大化|最快/i.test(text)) {
    next.objective = 'throughput'
    extracted.push('目标：最大吞吐')
  } else if (/平衡|综合/i.test(text)) {
    next.objective = 'balanced'
    extracted.push('目标：综合平衡')
  }

  return { spec: next, extracted }
}

/**
 * Generate, validate, simulate, score and rank the factory candidates.
 * The returned three candidates are already the Top 3, not three fixed cards.
 */
export function generateFactoryCandidates(spec: GenerationSpec, factoryKey = 'a02'): GeneratedCandidate[] {
  const graph = buildRecipeGraph(spec)
  const baseCnc = Math.max(1, Math.min(spec.cncLimit, spec.objective === 'throughput' ? 3 : 2))
  const variants: CandidateVariant[] = [
    { key: 'balanced', cncCount: baseCnc, agvCount: Math.max(1, Math.min(spec.agvLimit, 2)), strategy: 'BALANCED FLOW', description: '完整四路物料齐套，平衡产能、路径长度和设备利用率。' },
    { key: 'throughput', cncCount: Math.max(baseCnc, Math.min(spec.cncLimit, 3)), agvCount: Math.max(1, Math.min(spec.agvLimit, 2)), strategy: 'HIGH THROUGHPUT', description: '增加并行 CNC，优先降低机加工工序的等待时间。' },
    { key: 'energy', cncCount: 1, agvCount: 1, strategy: 'LOW ENERGY', description: '减少并行设备和物流距离，牺牲部分峰值吞吐换取低能耗。' },
  ]

  const initial = variants.map((variant) => makeCandidate(factoryKey, variant, spec, graph))
  const maxRounds = Math.max(1, Math.min(4, Math.round(spec.searchRounds ?? 2)))
  let pool = initial
  let frontier = rankCandidates(initial).slice(0, 4)

  // Beam-style neighborhood search: keep the best few layouts, perturb their
  // machine/AGV plan, then re-simulate the next generation. The deterministic
  // seed and signature dedupe keep browser runs reproducible.
  for (let round = 1; round < maxRounds; round += 1) {
    const neighbors = frontier.flatMap((candidate) => neighborVariants(candidate, spec, graph, round))
    const evaluated = neighbors.flatMap((variant) => {
      try {
        return [makeCandidate(factoryKey, variant, spec, graph)]
      } catch {
        // A neighborhood mutation may be geometrically infeasible in the
        // bounded floor. It is a rejected search node, not a failed run.
        return []
      }
    })
    pool = [...pool, ...evaluated]
    frontier = rankCandidates(dedupeCandidates([...frontier, ...evaluated])).slice(0, 4)
  }

  return rankCandidates(dedupeCandidates(pool)).slice(0, 3)
}

/**
 * Adjust an existing factory instead of blindly replacing it.
 *
 * The engine deliberately returns three different intervention levels:
 * 1. keep the current line as a diagnostic baseline;
 * 2. preserve non-conveyor equipment and rebuild only the material routes;
 * 3. fall back to a clean high-throughput rebuild when the current line is
 *    missing recipe anchors or cannot be routed without collisions.
 */
export function generateFactoryAdjustments(currentObjects: FactoryObject[], spec: GenerationSpec, factoryKey = 'a01'): GeneratedCandidate[] {
  if (currentObjects.length === 0) return generateFactoryCandidates(spec, factoryKey).map((candidate) => ({
    ...candidate,
    mode: 'adjust' as const,
    adjustments: [{ kind: 'rebuild' as const, title: '空场地初始化', detail: '当前场地没有可保留设备，使用完整生成器创建首套产线。' }],
  }))

  const graph = buildRecipeGraph(spec)
  const equipment = estimateEquipment(spec, graph)
  const adjustmentFloor = footprintFloor(currentObjects, spec)
  const baseline = makeEvaluatedCandidate(factoryKey, {
    key: 'baseline',
    cncCount: Math.max(1, currentObjects.filter((object) => object.type === 'smelter').length),
    agvCount: currentObjects.filter((object) => object.type === 'agv').length,
    strategy: 'CURRENT LINE',
    description: '保留当前工厂，仅作为调整前的基准诊断。',
  }, spec, graph, equipment, currentObjects, {
    mode: 'adjust',
    adjustments: [{ kind: 'inspect', title: '读取当前状态', detail: `保留 ${currentObjects.length} 个现有对象，先建立调整前基线。` }],
    validationFloor: adjustmentFloor,
    baselineObjects: currentObjects,
  })

  const localCandidates = (['reroute', 'compact-left', 'compact-right'] as const)
    .map((variant) => createAdjustmentLayout(currentObjects, factoryKey, graph, variant))
    .filter((layout): layout is NonNullable<typeof layout> => Boolean(layout))
    .map((layout) => makeEvaluatedCandidate(factoryKey, {
      key: layout.variant,
      cncCount: Math.max(1, layout.objects.filter((object) => object.type === 'smelter').length),
      agvCount: layout.objects.filter((object) => object.type === 'agv').length,
      strategy: layout.variant === 'reroute' ? 'MINIMAL REWIRE' : 'COMPACT ASSEMBLY',
      description: layout.variant === 'reroute'
        ? '保留现有设备和位置，只重建传送带端口连接，优先修复断线与物流背压。'
        : '在局部邻域内移动装配单元，缩短齐套物流距离并重新搜索无碰撞路线。',
    }, spec, graph, equipment, layout.objects, { mode: 'adjust', adjustments: layout.adjustments, validationFloor: adjustmentFloor, baselineObjects: currentObjects }))
  const rerouted = localCandidates.sort((a, b) => b.score - a.score)[0]
    ?? (() => {
      const migration = makeCandidate(factoryKey, {
        key: 'migration',
        cncCount: Math.max(1, Math.min(spec.cncLimit, 2)),
        agvCount: Math.max(1, Math.min(spec.agvLimit, 2)),
        strategy: 'RECIPE MIGRATION',
        description: '当前设备与目标产品配方不一致，生成一套可运行的目标配方迁移线。',
      }, spec, graph, currentObjects)
      return {
        ...migration,
        id: `${factoryKey}_adjust_migration`,
        mode: 'adjust' as const,
        adjustments: [{ kind: 'rebuild' as const, title: '配方迁移', detail: '现有产线缺少目标产品的工艺锚点，保留当前布局作为基线，使用目标配方重建生产链。' }],
      }
    })()

  const clean = makeCandidate(factoryKey, {
    key: 'rebuild',
    cncCount: Math.max(1, Math.min(spec.cncLimit, 3)),
    agvCount: Math.max(1, Math.min(spec.agvLimit, 2)),
    strategy: 'FULL REBUILD',
    description: '当前结构无法在原位安全修复时，重新生成一套经过校验的完整产线。',
  }, spec, graph, currentObjects)
  const rebuild = {
    ...clean,
    id: `${factoryKey}_adjust_rebuild`,
    mode: 'adjust' as const,
    adjustments: [{ kind: 'rebuild' as const, title: '完整重构', detail: '当前设备缺少完整配方链或原位路由不可行，使用验证通过的新布局替换。' }],
  }

  return rankCandidates([baseline, rerouted, rebuild])
}

export function buildRecipeGraph(spec: GenerationSpec): RecipeGraph {
  const profile = productProfile(spec.product)
  const recipes = new Map(profile.recipes.map((recipe) => [recipe.id, recipe]))
  const node = (id: string, recipeId: string, machineType: BuildType, parallelCount = 1): RecipeGraphNode => {
    const recipe = recipes.get(recipeId)
    if (!recipe) throw new Error(`缺少配方 ${recipeId}`)
    return { id, recipeId, name: recipe.name, machineType, inputs: recipe.inputs, outputs: recipe.outputs, parallelCount }
  }

  const nodes = [
    node('machining', profile.recipeIds.machining, 'smelter'),
    node('washing', profile.recipeIds.washing, 'washing'),
    node('stamping', profile.recipeIds.stamping, 'press'),
    node('fastener-kit', profile.recipeIds.fastenerKit, 'machine'),
    node('coil', profile.recipeIds.auxiliary, 'machine'),
    node('assembly', profile.recipeIds.assembly, 'assembler'),
    node('inspection', profile.recipeIds.inspection, 'inspection'),
  ]
  const recipeInputs = (id: string) => recipes.get(id)!.inputs
  const recipeOutput = (id: string) => recipes.get(id)!.outputs[0]
  const assemblyInputs = new Map(recipeInputs(profile.recipeIds.assembly).map((port) => [port.itemId, port]))
  const edges: RecipeGraphEdge[] = [
    { from: 'raw:steel-blank', to: 'machining', itemId: recipeInputs(profile.recipeIds.machining)[0].itemId, qty: recipeInputs(profile.recipeIds.machining)[0].qty },
    { from: 'machining', to: 'washing', itemId: recipeOutput(profile.recipeIds.machining).itemId, qty: recipeOutput(profile.recipeIds.machining).qty },
    { from: 'washing', to: 'assembly', itemId: recipeOutput(profile.recipeIds.washing).itemId, qty: assemblyInputs.get(recipeOutput(profile.recipeIds.washing).itemId)?.qty ?? 1 },
    { from: 'raw:steel-sheet', to: 'stamping', itemId: recipeInputs(profile.recipeIds.stamping)[0].itemId, qty: recipeInputs(profile.recipeIds.stamping)[0].qty },
    { from: 'stamping', to: 'assembly', itemId: recipeOutput(profile.recipeIds.stamping).itemId, qty: assemblyInputs.get(recipeOutput(profile.recipeIds.stamping).itemId)?.qty ?? 1 },
    { from: 'raw:fastener', to: 'fastener-kit', itemId: recipeInputs(profile.recipeIds.fastenerKit)[0].itemId, qty: recipeInputs(profile.recipeIds.fastenerKit)[0].qty },
    { from: 'fastener-kit', to: 'assembly', itemId: recipeOutput(profile.recipeIds.fastenerKit).itemId, qty: assemblyInputs.get(recipeOutput(profile.recipeIds.fastenerKit).itemId)?.qty ?? 1 },
    { from: 'raw:auxiliary', to: 'coil', itemId: recipeInputs(profile.recipeIds.auxiliary)[0].itemId, qty: recipeInputs(profile.recipeIds.auxiliary)[0].qty },
    { from: 'coil', to: 'assembly', itemId: recipeOutput(profile.recipeIds.auxiliary).itemId, qty: assemblyInputs.get(recipeOutput(profile.recipeIds.auxiliary).itemId)?.qty ?? 1 },
    { from: 'assembly', to: 'inspection', itemId: recipeOutput(profile.recipeIds.assembly).itemId, qty: recipeOutput(profile.recipeIds.assembly).qty },
  ]

  return {
    product: spec.product || '齿轮箱',
    targetItemId: recipeOutput(profile.recipeIds.inspection).itemId,
    nodes,
    edges,
    rawInputs: Object.values(profile.sourceItems),
    sourceItems: profile.sourceItems,
    recipeIds: profile.recipeIds,
    recipes: profile.recipes,
    items: profile.items,
  }
}

function planMachineCounts(spec: GenerationSpec, graph: RecipeGraph, variant?: CandidateVariant): Record<string, number> {
  const plan: Record<string, number> = {}
  const throughputBias = spec.objective === 'throughput' ? 3 : spec.objective === 'balanced' ? 2 : 1
  for (const node of graph.nodes) {
    const recipe = graph.recipes.find((candidate) => candidate.id === node.recipeId)
    const capacityPerHour = recipe ? 3600 / recipe.durationSec : 1
    const requiredCount = Math.max(1, Math.ceil(spec.targetThroughputPerHour / capacityPerHour))
    // CNC has a verified splitter/merger layout in the current 30×20 floor.
    // Other multi-input cells remain visible in the demand estimate until a
    // collision-free expansion variant is found by the neighborhood search.
    const defaultCount = node.id === 'machining'
      ? Math.max(1, Math.min(spec.cncLimit, throughputBias))
      : node.id === 'assembly'
        ? 1
        : Math.min(requiredCount, throughputBias)
    plan[node.id] = clamp(Math.round(variant?.parallelOverrides?.[node.id] ?? defaultCount), 1, 3)
  }
  if (variant) plan.machining = clamp(Math.round(variant.cncCount), 1, Math.max(1, Math.min(spec.cncLimit, 3)))
  return plan
}

function countPlanFromObjects(objects: FactoryObject[], graph: RecipeGraph): Record<string, number> {
  return Object.fromEntries(graph.nodes.map((node) => [
    node.id,
    Math.max(1, objects.filter((object) => object.recipeId === node.recipeId).length),
  ]))
}

function estimateEquipment(spec: GenerationSpec, graph: RecipeGraph, plan = planMachineCounts(spec, graph)): EquipmentEstimate[] {
  const recipes = new Map(graph.recipes.map((recipe) => [recipe.id, recipe]))
  return graph.nodes.map((node) => {
    const recipe = recipes.get(node.recipeId)!
    const capacityPerHour = 3600 / recipe.durationSec
    const requiredCount = Math.max(1, Math.ceil(spec.targetThroughputPerHour / capacityPerHour))
    const count = plan[node.id] ?? 1
    const rationale = node.id === 'machining'
      ? `受 CNC 上限 ${spec.cncLimit} 台约束，采用 ${count} 台并行单元`
      : requiredCount > count
        ? `单机理论能力 ${capacityPerHour.toFixed(0)} 件/h，需要 ${requiredCount} 台，当前场地计划 ${count} 台`
        : `单机理论能力 ${capacityPerHour.toFixed(0)} 件/h，按目标产出配置 ${count} 台`
    return { nodeId: node.id, type: node.machineType, count, requiredCount, capacityPerHour, rationale }
  })
}

function productProfile(product: string): RecipeProfile {
  const gearbox = /齿轮箱|变速箱|减速机/i.test(product)
  const motorIds: RecipeGraph['recipeIds'] = {
    machining: 'recipe_machining',
    washing: 'recipe_wash',
    stamping: 'recipe_stamping',
    fastenerKit: 'recipe_fastener_kit',
    auxiliary: 'recipe_coil',
    assembly: 'recipe_motor',
    inspection: 'recipe_inspection',
    packaging: 'recipe_packaging',
  }
  if (!gearbox) {
    return {
      recipes: DEFAULT_RECIPES,
      items: DEFAULT_ITEMS,
      sourceItems: { steel: 'item_steel_blank', sheet: 'item_steel_sheet', fastener: 'item_fastener', auxiliary: 'item_copper_wire' },
      recipeIds: motorIds,
    }
  }
  const gearboxIds: RecipeGraph['recipeIds'] = {
    machining: 'recipe_gear_machining',
    washing: 'recipe_gear_wash',
    stamping: 'recipe_gear_housing',
    fastenerKit: 'recipe_fastener_kit',
    auxiliary: 'recipe_gear_lube',
    assembly: 'recipe_gearbox',
    inspection: 'recipe_gear_inspection',
    packaging: 'recipe_gear_packaging',
  }
  return {
    recipes: GEARBOX_RECIPES,
    items: [...DEFAULT_ITEMS, ...GEARBOX_ITEMS],
    sourceItems: { steel: 'item_steel_blank', sheet: 'item_steel_sheet', fastener: 'item_fastener', auxiliary: 'item_lubricant' },
    recipeIds: gearboxIds,
  }
}

interface CandidateVariant {
  key: string
  cncCount: number
  agvCount: number
  strategy: string
  description: string
  parallelOverrides?: Record<string, number>
  searchRound?: number
}

function neighborVariants(candidate: GeneratedCandidate, spec: GenerationSpec, _graph: RecipeGraph, round: number): CandidateVariant[] {
  const plan = Object.fromEntries(candidate.recipeGraph.nodes.map((node) => [node.id, node.parallelCount]))
  const cnc = candidate.equipment.find((item) => item.nodeId === 'machining')?.count ?? 1
  const agv = candidate.objects.filter((object) => object.type === 'agv').length
  const variants: CandidateVariant[] = []
  const push = (suffix: string, nextCnc: number, nextAgv: number, overrides: Record<string, number>, description: string) => {
    variants.push({
      key: `r${round}_${candidate.id}_${suffix}`,
      cncCount: clamp(Math.round(nextCnc), 1, Math.max(1, Math.min(spec.cncLimit, 3))),
      agvCount: clamp(Math.round(nextAgv), 1, Math.max(1, spec.agvLimit)),
      strategy: `ITERATION ${round}`,
      description,
      parallelOverrides: overrides,
      searchRound: round,
    })
  }

  push('flow', cnc + (spec.objective === 'throughput' ? 1 : 0), agv, { ...plan }, '沿上一轮优胜布局增加关键工序并行度，重新验证物流背压。')
  push('energy', cnc, Math.max(1, agv - 1), { ...plan, washing: Math.max(1, (plan.washing ?? 1) - 1), inspection: Math.max(1, (plan.inspection ?? 1) - 1) }, '沿上一轮优胜布局压缩低负载单元与 AGV，验证能耗/吞吐折中。')
  push('assembly', cnc, agv, { ...plan, assembly: Math.min(3, (plan.assembly ?? 1) + 1) }, '围绕装配瓶颈增加并行单元，重新搜索齐套物流路径。')
  return variants
}

function dedupeCandidates(candidates: GeneratedCandidate[]): GeneratedCandidate[] {
  const seen = new Set<string>()
  return candidates.filter((candidate) => {
    const signature = candidate.objects
      .map((object) => `${object.type}:${object.pos.x},${object.pos.z}:${object.rotation}:${object.recipeId ?? ''}:${object.itemId ?? ''}`)
      .sort()
      .join('|')
    if (seen.has(signature)) return false
    seen.add(signature)
    return true
  })
}

function makeCandidate(
  factoryKey: string,
  variant: CandidateVariant,
  spec: GenerationSpec,
  graph: RecipeGraph,
  baselineObjects: FactoryObject[] = [],
): GeneratedCandidate {
  const prefix = `${factoryKey}_${variant.key}`
  const parallelPlan = planMachineCounts(spec, graph, variant)
  const equipment = estimateEquipment(spec, graph, parallelPlan)
  const objects = createConnectedLayout(prefix, parallelPlan, variant.agvCount, graph)
  return makeEvaluatedCandidate(factoryKey, variant, spec, graph, equipment, objects, { mode: 'generate', adjustments: [], baselineObjects, parallelPlan })
}

function makeEvaluatedCandidate(
  factoryKey: string,
  variant: CandidateVariant,
  spec: GenerationSpec,
  graph: RecipeGraph,
  equipment: EquipmentEstimate[],
  objects: FactoryObject[],
  context: Pick<GeneratedCandidate, 'mode' | 'adjustments'> & { validationFloor?: { width: number; depth: number }; baselineObjects?: FactoryObject[]; parallelPlan?: Record<string, number> },
): GeneratedCandidate {
  const layoutValidation = makeValidation(objects, context.validationFloor?.width ?? spec.floorWidth, context.validationFloor?.depth ?? spec.floorDepth)
  const simulation = simulateCandidate(objects, spec, graph, layoutValidation)
  const validation = simulation.outputUnits > 0 ? layoutValidation : { ...layoutValidation, passed: false }
  const diff = compareLayouts(context.baselineObjects ?? [], objects)
  const layoutRisk = layoutValidation.issues.length * 10 + diff.changeCost * 0.12
  const score = scoreCandidate(simulation, validation, spec, diff, context.mode)
  const warnings: string[] = []
  if (!layoutValidation.passed) warnings.push(`布局校验发现 ${layoutValidation.issues.length} 个问题，未达到可直接应用标准。`)
  if (simulation.outputUnits <= 0) warnings.push(`副本仿真没有产出 ${graph.product}，当前候选不能直接应用。`)
  if (simulation.throughputPerHour < spec.targetThroughputPerHour) {
    warnings.push(`副本仿真产出 ${simulation.throughputPerHour.toFixed(1)}/h，低于目标 ${spec.targetThroughputPerHour}/h。`)
  }
  if (simulation.blockedSources > 0 && simulation.throughputPerHour < spec.targetThroughputPerHour) warnings.push(`${simulation.blockedSources} 个来料站受到下游满载背压，正在限制目标产能。`)
  const parallelPlan = context.parallelPlan ?? countPlanFromObjects(objects, graph)
  const economics = calculateEconomics(objects, simulation, spec, diff, context.baselineObjects ?? [], graph)

  return {
    id: `${factoryKey}_${variant.key}`,
    rank: 0,
    name: variant.strategy,
    strategy: variant.strategy,
    description: variant.description,
    score,
    metrics: {
      throughputPerHour: simulation.throughputPerHour,
      utilization: simulation.utilization,
      energyPerUnit: simulation.energyPerUnit,
      logisticsEfficiency: simulation.logisticsEfficiency,
      footprint: Math.round((objects.length / Math.max(1, spec.floorWidth * spec.floorDepth)) * 1000) / 10,
      changeCost: Math.round(diff.changeCost * 10) / 10,
      layoutRisk: Math.round(layoutRisk * 10) / 10,
      economics,
    },
    warnings,
    recipeGraph: { ...graph, nodes: graph.nodes.map((node) => ({ ...node, parallelCount: parallelPlan[node.id] ?? node.parallelCount })) },
    equipment: equipment.map((item) => ({ ...item, count: parallelPlan[item.nodeId] ?? item.count })),
    validation,
    simulation,
    objects,
    mode: context.mode,
    adjustments: context.adjustments,
    diff,
    paretoRank: 0,
    searchRound: variant.searchRound ?? 0,
  }
}

function footprintFloor(objects: FactoryObject[], spec: GenerationSpec): { width: number; depth: number } {
  const cells = objects.flatMap(occupiedCells)
  if (cells.length === 0) return { width: spec.floorWidth, depth: spec.floorDepth }
  const minX = Math.min(...cells.map((cell) => cell.x))
  const maxX = Math.max(...cells.map((cell) => cell.x))
  const minZ = Math.min(...cells.map((cell) => cell.z))
  const maxZ = Math.max(...cells.map((cell) => cell.z))
  return {
    // Validation uses a centred factory envelope, so size it from the
    // furthest occupied coordinate rather than only the raw span.
    width: Math.max(spec.floorWidth, Math.max(Math.abs(minX), Math.abs(maxX)) * 2 + 2),
    depth: Math.max(spec.floorDepth, Math.max(Math.abs(minZ), Math.abs(maxZ)) * 2 + 2),
  }
}

function createAdjustmentLayout(currentObjects: FactoryObject[], factoryKey: string, graph: RecipeGraph, variant: 'reroute' | 'compact-left' | 'compact-right'): { objects: FactoryObject[]; adjustments: AdjustmentAction[]; variant: string } | null {
  const findSource = (itemId: string) => currentObjects.find((object) => (object.type === 'source' || object.type === 'inboundWarehouse') && object.itemId === itemId)
  const findMachine = (recipeId: string) => currentObjects.find((object) => object.recipeId === recipeId)
  const sourceSteel = findSource(graph.sourceItems.steel)
  const sourceSheet = findSource(graph.sourceItems.sheet)
  const sourceFastener = findSource(graph.sourceItems.fastener)
  const sourceCopper = findSource(graph.sourceItems.auxiliary)
  const cnc = findMachine(graph.recipeIds.machining)
  const washing = findMachine(graph.recipeIds.washing)
  const press = findMachine(graph.recipeIds.stamping)
  const fastenerKit = findMachine(graph.recipeIds.fastenerKit)
  const coil = findMachine(graph.recipeIds.auxiliary)
  const assembly = findMachine(graph.recipeIds.assembly)
  const inspection = findMachine(graph.recipeIds.inspection)
  const packaging = findMachine(graph.recipeIds.packaging)
  const storage = currentObjects.find((object) => object.type === 'outboundWarehouse')
    ?? currentObjects.find((object) => object.type === 'storage' && /finished|成品/i.test(object.id))
    ?? currentObjects.filter((object) => object.type === 'storage').sort((a, b) => b.pos.x - a.pos.x)[0]
  if (!sourceSteel || !sourceSheet || !sourceFastener || !sourceCopper || !cnc || !washing || !press || !fastenerKit || !coil || !assembly || !inspection || !storage) return null

  const requiredIds = new Set([
    sourceSteel.id,
    sourceSheet.id,
    sourceFastener.id,
    sourceCopper.id,
    cnc.id,
    washing.id,
    press.id,
    fastenerKit.id,
    coil.id,
    assembly.id,
    inspection.id,
    packaging?.id,
    storage.id,
  ])
  // Ancillary racks, old splitters, quarantine buffers and parked AGVs are
  // deliberately excluded from the routing obstacle map. They can occupy a
  // stale belt cell and make a repair look impossible even though the process
  // equipment itself is perfectly reusable.
  const shift = variant === 'compact-left' ? -1 : variant === 'compact-right' ? 1 : 0
  const preserved = currentObjects.filter((object) => requiredIds.has(object.id)).map((object) => object.id === assembly.id && shift !== 0
    ? { ...object, pos: { x: object.pos.x + shift, z: object.pos.z } }
    : { ...object, pos: { ...object.pos } })
  const preservedCells = new Map<string, string>()
  for (const object of preserved) {
    for (const cell of occupiedCells(object)) {
      const key = cellKey(cell.x, cell.z)
      if (preservedCells.has(key)) return null
      preservedCells.set(key, object.id)
    }
  }
  const builder: LayoutBuilder = { prefix: `${factoryKey}_adjust_${variant}`, objects: preserved, conveyorIndex: 1 }
  try {
    addRoute(builder, sourceSteel, cnc)
    addRoute(builder, cnc, washing)
    addRoute(builder, sourceSheet, press)
    addRoute(builder, sourceFastener, fastenerKit)
    addRoute(builder, sourceCopper, coil)
    addRoute(builder, washing, assembly)
    addRoute(builder, press, assembly)
    addRoute(builder, fastenerKit, assembly)
    addRoute(builder, coil, assembly)
    addRoute(builder, assembly, inspection)
    addRoute(builder, inspection, packaging ?? storage)
    if (packaging) addRoute(builder, packaging, storage)
  } catch {
    return null
  }

  return {
    objects: builder.objects,
    adjustments: [
      { kind: 'reroute', title: '重建端口路由', detail: `移除 ${currentObjects.filter((object) => object.type === 'conveyor').length} 段旧传送带，保留 ${preserved.length} 个设备并按配方顺序重新连接。` },
      ...(shift === 0 ? [] : [{ kind: 'reroute' as const, title: '局部邻域移动', detail: `装配单元沿 X 轴${shift < 0 ? '左移' : '右移'} ${Math.abs(shift)} 格，再重新搜索四路齐套物流。` }]),
      { kind: 'trim', title: '清理陈旧物流资产', detail: `保留 ${preserved.length} 个工艺锚点；旧缓存、分流器和停放车辆不参与本次新路由，避免遮挡有效端口。` },
    ],
    variant,
  }
}

interface ParallelStage {
  machines: FactoryObject[]
  inputSplitter: FactoryObject | null
  outputMerger: FactoryObject | null
}

function createParallelStage(
  prefix: string,
  nodeId: string,
  type: BuildType,
  recipeId: string,
  x: number,
  baseZ: number,
  count: number,
  spacing: number,
  splitterPos: Cell,
  mergerPos: Cell,
  rowPositions?: number[],
): ParallelStage {
  const safeCount = clamp(Math.round(count), 1, 3)
  const rows = (rowPositions ?? Array.from({ length: safeCount }, (_, index) => baseZ + index * spacing)).slice(0, safeCount)
  const machines = rows.map((z, index) => unit(`${prefix}_${nodeId}_${index + 1}`, type, x, z, 0, { recipeId }))
  return {
    machines,
    inputSplitter: safeCount > 1 ? unit(`${prefix}_${nodeId}_splitter`, 'splitter', splitterPos.x, splitterPos.z, 0) : null,
    outputMerger: safeCount > 1 ? unit(`${prefix}_${nodeId}_merger`, 'merger', mergerPos.x, mergerPos.z, 0) : null,
  }
}

function cncRows(count: number): number[] {
  if (count <= 1) return [-4]
  if (count === 2) return [-7, -1]
  return [-7, -4, -1]
}

function assemblyRows(count: number): number[] {
  if (count <= 1) return [-5]
  if (count === 2) return [-5, 4]
  return [-5, 1, 7]
}

function createConnectedLayout(prefix: string, parallelPlan: Record<string, number>, agvCount: number, graph: RecipeGraph): FactoryObject[] {
  const builder: LayoutBuilder = { prefix, objects: [], conveyorIndex: 1 }
  const sourceSteel = unit(`${prefix}_source_steel`, 'inboundWarehouse', -14, -4, 0, { itemId: graph.sourceItems.steel })
  const sourceSheet = unit(`${prefix}_source_sheet`, 'inboundWarehouse', -14, 8, 0, { itemId: graph.sourceItems.sheet })
  const sourceFastener = unit(`${prefix}_source_fastener`, 'inboundWarehouse', -14, -9, 0, { itemId: graph.sourceItems.fastener })
  const sourceCopper = unit(`${prefix}_source_copper`, 'inboundWarehouse', -14, 5, 0, { itemId: graph.sourceItems.auxiliary })
  const cnc = createParallelStage(prefix, 'cnc', 'smelter', graph.recipeIds.machining, -7, -7, parallelPlan.machining ?? 1, 3, { x: -10, z: -4 }, { x: -2, z: -4 }, cncRows(parallelPlan.machining ?? 1))
  const washing = createParallelStage(prefix, 'washing', 'washing', graph.recipeIds.washing, 0, -2, parallelPlan.washing ?? 1, 3, { x: -3, z: -2 }, { x: 2, z: -2 })
  const press = createParallelStage(prefix, 'press', 'press', graph.recipeIds.stamping, -7, 8, parallelPlan.stamping ?? 1, -2, { x: -10, z: 8 }, { x: -4, z: 8 }, [8, 6, 4])
  const fastenerKit = createParallelStage(prefix, 'fastener_kit', 'machine', graph.recipeIds.fastenerKit, -4, -9, parallelPlan['fastener-kit'] ?? 1, 2, { x: -10, z: -9 }, { x: -2, z: -9 })
  const coil = createParallelStage(prefix, 'coil', 'machine', graph.recipeIds.auxiliary, -4, 5, parallelPlan.coil ?? 1, 2, { x: -10, z: 5 }, { x: -2, z: 5 })
  const assembly = createParallelStage(prefix, 'assembly', 'assembler', graph.recipeIds.assembly, 4, -5, parallelPlan.assembly ?? 1, 6, { x: 1, z: -5 }, { x: 8, z: -5 }, assemblyRows(parallelPlan.assembly ?? 1))
  const inspection = createParallelStage(prefix, 'inspection', 'inspection', graph.recipeIds.inspection, 10, -4, parallelPlan.inspection ?? 1, 3, { x: 8, z: -4 }, { x: 12, z: -4 })
  const assemblyInputSplitters = (parallelPlan.assembly ?? 1) > 1
    ? [
        unit(`${prefix}_assembly_input_clean_splitter`, 'splitter', 3, -2, 0),
        unit(`${prefix}_assembly_input_press_splitter`, 'splitter', -3, 8, 0),
        unit(`${prefix}_assembly_input_fastener_splitter`, 'splitter', -2, -9, 0),
        unit(`${prefix}_assembly_input_coil_splitter`, 'splitter', -2, 5, 0),
      ]
    : []
  const storage = unit(`${prefix}_storage`, 'outboundWarehouse', 13, -4, 0)
  const fixedObjects = [
    sourceSteel, sourceSheet, sourceFastener, sourceCopper,
    ...cnc.machines, cnc.inputSplitter, cnc.outputMerger,
    ...washing.machines, washing.inputSplitter, washing.outputMerger,
    ...press.machines, press.inputSplitter, press.outputMerger,
    ...fastenerKit.machines, fastenerKit.inputSplitter, fastenerKit.outputMerger,
    ...coil.machines, coil.inputSplitter, coil.outputMerger,
    ...assembly.machines, assembly.inputSplitter, assembly.outputMerger,
    ...inspection.machines, inspection.inputSplitter, inspection.outputMerger,
    ...assemblyInputSplitters, storage,
  ].filter((object): object is FactoryObject => Boolean(object))
  fixedObjects.forEach((object) => addObject(builder, object))

  const processFeed = connectCncStage(builder, sourceSteel, cnc)
  const cleanFeed = connectSingleInputStage(builder, processFeed, washing)
  const pressFeed = connectSingleInputStage(builder, sourceSheet, press)
  const fastenerFeed = connectSingleInputStage(builder, sourceFastener, fastenerKit)
  const coilFeed = connectSingleInputStage(builder, sourceCopper, coil)
  const assemblyFeed = connectAssemblyStage(builder, [cleanFeed, pressFeed, fastenerFeed, coilFeed], assembly, assemblyInputSplitters)
  const inspectionFeed = connectSingleInputStage(builder, assemblyFeed, inspection)
  addRoute(builder, inspectionFeed, storage, undefined, 'back')

  for (let index = 0; index < agvCount; index += 1) {
    addObject(builder, unit(`${prefix}_agv_${index + 1}`, 'agv', 12, 8 - index * 3, index === 1 ? 180 : 0))
  }
  return builder.objects
}

function connectCncStage(builder: LayoutBuilder, upstream: FactoryObject, stage: ParallelStage): FactoryObject {
  if (!stage.inputSplitter || !stage.outputMerger) {
    addRoute(builder, upstream, stage.machines[0], undefined, 'back')
    return stage.machines[0]
  }
  addRoute(builder, upstream, stage.inputSplitter, undefined, 'back')
  const branchSides: PortSide[] = stage.machines.length === 2 ? ['right', 'left'] : ['right', 'front', 'left']
  stage.machines.forEach((machine, index) => addRoute(builder, stage.inputSplitter!, machine, branchSides[index], 'back'))
  const mergeSides: PortSide[] = stage.machines.length === 2 ? ['right', 'left'] : ['right', 'back', 'left']
  stage.machines.forEach((machine, index) => addRoute(builder, machine, stage.outputMerger!, undefined, mergeSides[index]))
  return stage.outputMerger
}

function connectSingleInputStage(builder: LayoutBuilder, upstream: FactoryObject, stage: ParallelStage): FactoryObject {
  if (!stage.inputSplitter || !stage.outputMerger) {
    addRoute(builder, upstream, stage.machines[0], undefined, 'back')
    return stage.machines[0]
  }
  addRoute(builder, upstream, stage.inputSplitter, undefined, 'back')
  stage.machines.forEach((machine) => addRoute(builder, stage.inputSplitter!, machine))
  stage.machines.forEach((machine) => addRoute(builder, machine, stage.outputMerger!))
  return stage.outputMerger
}

function connectAssemblyStage(
  builder: LayoutBuilder,
  upstreams: FactoryObject[],
  stage: ParallelStage,
  inputSplitters: FactoryObject[],
): FactoryObject {
  if (!stage.inputSplitter || !stage.outputMerger) {
    upstreams.forEach((upstream) => addRoute(builder, upstream, stage.machines[0]))
    return stage.machines[0]
  }
  upstreams.forEach((upstream, index) => {
    const splitter = inputSplitters[index]
    if (!splitter) throw new Error('装配并行输入缺少分流器')
    addRoute(builder, upstream, splitter, undefined, 'back')
  })
  const branchOrder = [1, 0, 3, 2].filter((index) => index < upstreams.length)
  branchOrder.forEach((index) => {
    const splitter = inputSplitters[index]
    if (!splitter) throw new Error('装配并行输入缺少分流器')
    const branchSides: PortSide[] = stage.machines.length === 2 ? ['front', 'left'] : ['front', 'right', 'left']
    const inputTargetSide: PortSide = (['back', 'left', 'right', 'back'] as PortSide[])[index] ?? 'back'
    const targetSides: PortSide[] = stage.machines.length === 2 ? [inputTargetSide, inputTargetSide] : [inputTargetSide, inputTargetSide, inputTargetSide]
    stage.machines.forEach((machine, machineIndex) => {
      const preferred = { from: branchSides[machineIndex], to: targetSides[machineIndex] }
      const alternatives = [preferred, ...(['front', 'right', 'left'] as PortSide[]).flatMap((from) => (['back', 'left', 'right'] as PortSide[]).map((to) => ({ from, to })))]
      let connected = false
      for (const option of alternatives) {
        try {
          addRoute(builder, splitter, machine, option.from, option.to)
          connected = true
          break
        } catch {
          // The previous branch may have consumed the shortest corridor;
          // retry another valid splitter output / assembly dock pair.
        }
      }
      if (!connected) throw new Error(`无法为装配并行支路分配端口 ${splitter.id} -> ${machine.id}`)
    })
  })
  stage.machines.forEach((machine) => addRoute(builder, machine, stage.outputMerger!))
  return stage.outputMerger
}

interface LayoutBuilder {
  prefix: string
  objects: FactoryObject[]
  conveyorIndex: number
}

function addObject(builder: LayoutBuilder, object: FactoryObject): void {
  builder.objects.push(object)
}

/** Connect two object ports using a collision-free Manhattan route. */
function addRoute(builder: LayoutBuilder, from: FactoryObject, to: FactoryObject, fromSide?: PortSide, toSide?: PortSide): void {
  const starts = fromSide ? objectPortCellsForSide(from, 'output', fromSide) : objectPortCells(from, 'output')
  const targets = toSide ? objectPortCellsForSide(to, 'input', toSide) : objectPortCells(to, 'input')
  const blocked = new Set(builder.objects.flatMap(occupiedCells).map((cell) => cellKey(cell.x, cell.z)))
  let best: { path: Cell[]; targetOccupied: Cell } | null = null

  for (const start of starts) {
    for (const target of targets) {
      const targetOccupied = adjacentOccupiedCell(target, to)
      const path = targetOccupied ? findPath(start, target, blocked) : null
      if (path && (!best || path.length < best.path.length)) best = { path, targetOccupied: targetOccupied! }
    }
  }
  if (!best) throw new Error(`无法连接 ${from.id} -> ${to.id}`)

  best.path.forEach((cell, index) => {
    const next = best!.path[index + 1] ?? best!.targetOccupied
    const direction = { dx: next.x - cell.x, dz: next.z - cell.z }
    if (Math.abs(direction.dx) + Math.abs(direction.dz) !== 1) throw new Error(`路线 ${from.id} -> ${to.id} 存在非相邻段`)
    addObject(builder, unit(`${builder.prefix}_cv_${String(builder.conveyorIndex++).padStart(2, '0')}`, 'conveyor', cell.x, cell.z, dirToRotation(direction)))
  })
}

function findPath(start: Cell, goal: Cell, blocked: Set<string>): Cell[] | null {
  const startKey = cellKey(start.x, start.z)
  const goalKey = cellKey(goal.x, goal.z)
  if (blocked.has(startKey) || blocked.has(goalKey)) return null
  const queue: Cell[] = [start]
  const parent = new Map<string, string | null>([[startKey, null]])
  const cellByKey = new Map<string, Cell>([[startKey, start]])

  while (queue.length > 0) {
    const current = queue.shift()!
    const currentKey = cellKey(current.x, current.z)
    if (currentKey === goalKey) {
      const path: Cell[] = []
      let key: string | null = currentKey
      while (key) {
        path.unshift(cellByKey.get(key)!)
        key = parent.get(key) ?? null
      }
      return path
    }
    const directions = [...CARDINALS].sort((a, b) => {
      const da = Math.abs(current.x + a.dx - goal.x) + Math.abs(current.z + a.dz - goal.z)
      const db = Math.abs(current.x + b.dx - goal.x) + Math.abs(current.z + b.dz - goal.z)
      return da - db
    })
    for (const direction of directions) {
      const next = { x: current.x + direction.dx, z: current.z + direction.dz }
      if (next.x < -22 || next.x > 22 || next.z < -12 || next.z > 12) continue
      const nextKey = cellKey(next.x, next.z)
      if (blocked.has(nextKey) || parent.has(nextKey)) continue
      parent.set(nextKey, currentKey)
      cellByKey.set(nextKey, next)
      queue.push(next)
    }
  }
  return null
}

function adjacentOccupiedCell(target: Cell, object: FactoryObject): Cell | null {
  return occupiedCells(object).find((cell) => Math.abs(cell.x - target.x) + Math.abs(cell.z - target.z) === 1) ?? null
}

function sameCell(a: Cell, b: Cell): boolean {
  return a.x === b.x && a.z === b.z
}

export function validateGeneratedLayout(objects: FactoryObject[], floorWidth = 30, floorDepth = 20): GeneratedLayoutIssue[] {
  const issues: GeneratedLayoutIssue[] = []
  const byCell = new Map<string, FactoryObject>()
  const halfWidth = floorWidth / 2
  const halfDepth = floorDepth / 2

  for (const object of objects) {
    for (const cell of occupiedCells(object)) {
      const key = cellKey(cell.x, cell.z)
      const existing = byCell.get(key)
      if (existing) issues.push({ objectId: object.id, message: `与 ${existing.id} 占用同一格 ${key}` })
      else byCell.set(key, object)
      if (cell.x < -halfWidth || cell.x > halfWidth - 1 || cell.z < -halfDepth || cell.z > halfDepth - 1) {
        issues.push({ objectId: object.id, message: `超出 ${floorWidth}×${floorDepth}m 场地边界` })
      }
    }
  }

  const connects = (upstream: FactoryObject, downstream: FactoryObject) => {
    const inputCells = objectCompatiblePortCells(downstream, 'input')
    const outputHitsDownstream = objectCompatiblePortCells(upstream, 'output')
      .some((output) => occupiedCells(downstream).some((cell) => sameCell(output, cell)))
    const upstreamOccupiesInput = inputCells.length === 0
      || occupiedCells(upstream).some((cell) => inputCells.some((input) => sameCell(cell, input)))
    if (objectRole(upstream.type, upstream.resourceId) === 'machine') return outputHitsDownstream
    if (objectRole(downstream.type, downstream.resourceId) === 'machine') return upstreamOccupiesInput
    return outputHitsDownstream && upstreamOccupiesInput
  }

  for (const object of objects.filter((candidate) => candidate.type === 'conveyor')) {
    if (!objects.some((candidate) => candidate.id !== object.id && connects(candidate, object))) {
      issues.push({ objectId: object.id, message: '没有找到有效的上游输出接口' })
    }
    const output = objectPortCells(object, 'output')[0]
    const downstream = (output ? byCell.get(cellKey(output.x, output.z)) : undefined)
      ?? objects.find((candidate) => candidate.id !== object.id && objectRole(candidate.type, candidate.resourceId) === 'machine' && connects(object, candidate))
    if (!downstream || !connects(object, downstream)) issues.push({ objectId: object.id, message: '输出端没有接入下游设备或传送带' })
  }

  for (const object of objects.filter((candidate) => (candidate.type === 'source' || candidate.type === 'inboundWarehouse') && candidate.itemId)) {
    if (!objects.some((candidate) => candidate.id !== object.id && connects(object, candidate))) {
      issues.push({ objectId: object.id, message: '来料站没有连接到物流入口' })
    }
  }
  return issues
}

function makeValidation(objects: FactoryObject[], floorWidth: number, floorDepth: number): CandidateValidation {
  const issues = validateGeneratedLayout(objects, floorWidth, floorDepth)
  const totalConveyors = objects.filter((object) => object.type === 'conveyor').length
  const connectedConveyors = totalConveyors - issues.filter((issue) => objects.find((object) => object.id === issue.objectId)?.type === 'conveyor').length
  return {
    passed: issues.length === 0,
    issues,
    connectedConveyors: Math.max(0, connectedConveyors),
    totalConveyors,
    collisionCount: issues.filter((issue) => issue.message.includes('占用同一格')).length,
  }
}

function simulateCandidate(objects: FactoryObject[], spec: GenerationSpec, graph: RecipeGraph, validation: CandidateValidation): CandidateSimulation {
  const engine = new SimulationEngine(20260813)
  engine.init(objects, graph.recipes)
  engine.advance(SIMULATION_SECONDS)
  const snapshot = engine.getSnapshot()
  const outputUnits = snapshot.stats.produced[graph.targetItemId] ?? 0
  const throughputPerHour = outputUnits / (SIMULATION_SECONDS / 3600)
  const machines = objects.filter((object) => OBJECT_DEFS[object.type].role === 'machine')
  const utilization = machines.length === 0
    ? 0
    : clamp((snapshot.machines.reduce((sum, machine) => sum + machine.processingTime, 0) / (machines.length * SIMULATION_SECONDS)) * 100, 0, 100)
  const turns = objects.filter((object) => object.type === 'conveyor' && object.rotation !== 0).length
  const logisticsEfficiency = clamp(100 - objects.filter((object) => object.type === 'conveyor').length * 0.32 - turns * 0.38, 0, 100)
  const activeEnergy = snapshot.machines.reduce((sum, machine) => {
    const object = objects.find((candidate) => candidate.id === machine.objectId)
    return sum + (object ? powerKw(object.type) * machine.processingTime : 0)
  }, 0)
  const idleLogisticsEnergy = objects.filter((object) => object.type === 'conveyor').length * 1.5 * SIMULATION_SECONDS * 0.18
    + objects.filter((object) => object.type === 'agv').length * 5 * SIMULATION_SECONDS * 0.05
  const energyPerUnit = outputUnits > 0 ? (activeEnergy + idleLogisticsEnergy) / outputUnits : 99
  const blockedSources = snapshot.sources.filter((source) => source.state === 'blocked').length
  const bottleneck = !validation.passed
    ? '布局校验未通过'
    : throughputPerHour < spec.targetThroughputPerHour
      ? blockedSources > 0 ? '物流入口背压限制产出' : '装配齐套等待限制产出'
      : blockedSources > 0 ? '物流背压可控，产能已达目标' : '无结构性瓶颈'

  return {
    simulatedSeconds: snapshot.timeSec,
    outputItemId: graph.targetItemId,
    outputUnits,
    throughputPerHour,
    utilization,
    energyPerUnit,
    logisticsEfficiency,
    blockedSources,
    bottleneck,
  }
}

function costAssumptions(spec: GenerationSpec): CostAssumptions {
  return {
    ...DEFAULT_COST_ASSUMPTIONS,
    ...(spec.economics ?? {}),
  }
}

function totalEquipmentCost(objects: FactoryObject[]): number {
  return objects.reduce((sum, object) => sum + (EQUIPMENT_CAPEX[object.type] ?? 0), 0)
}

function calculateEconomics(
  objects: FactoryObject[],
  simulation: CandidateSimulation,
  spec: GenerationSpec,
  diff: LayoutDiff,
  baselineObjects: FactoryObject[],
  graph: RecipeGraph,
): EconomicMetrics {
  const assumptions = costAssumptions(spec)
  const equipmentCost = totalEquipmentCost(objects)
  const energyCostPerHour = simulation.energyPerUnit * simulation.throughputPerHour * assumptions.energyPricePerKwh
  const operatingCostPerMonth = (energyCostPerHour + assumptions.laborCostPerHour) * assumptions.operatingHoursPerMonth
  const baselineValidation = baselineObjects.length > 0
    ? makeValidation(baselineObjects, spec.floorWidth, spec.floorDepth)
    : null
  const baselineSimulation = baselineValidation
    ? simulateCandidate(baselineObjects, spec, graph, baselineValidation)
    : null
  const baselineEnergyCostPerHour = baselineSimulation
    ? baselineSimulation.energyPerUnit * baselineSimulation.throughputPerHour * assumptions.energyPricePerKwh
    : 0
  const candidateContributionPerHour = simulation.throughputPerHour * assumptions.contributionPerUnit - energyCostPerHour - assumptions.laborCostPerHour
  const baselineContributionPerHour = baselineSimulation
    ? baselineSimulation.throughputPerHour * assumptions.contributionPerUnit - baselineEnergyCostPerHour - assumptions.laborCostPerHour
    : 0
  const monthlyBenefit = Math.max(0, candidateContributionPerHour - baselineContributionPerHour) * assumptions.operatingHoursPerMonth
  const baselineCapex = baselineObjects.length > 0 ? totalEquipmentCost(baselineObjects) : 0
  const changePremium = baselineObjects.length > 0 ? diff.changeCost * 1200 : 0
  const incrementalCapex = Math.max(0, equipmentCost - baselineCapex) + changePremium
  const paybackMonths = incrementalCapex > 0 && monthlyBenefit > 0 ? incrementalCapex / monthlyBenefit : null
  const roi12Month = incrementalCapex > 0 ? ((monthlyBenefit * 12 - incrementalCapex) / incrementalCapex) * 100 : 0

  return {
    equipmentCost: Math.round(equipmentCost),
    energyCostPerHour: roundOne(energyCostPerHour),
    operatingCostPerMonth: Math.round(operatingCostPerMonth),
    incrementalCapex: Math.round(incrementalCapex),
    monthlyBenefit: Math.round(monthlyBenefit),
    paybackMonths: paybackMonths === null ? null : roundOne(paybackMonths),
    roi12Month: roundOne(roi12Month),
  }
}

/** Evaluate a controlled change against the same deterministic simulator. */
export function evaluateWhatIf(baseObjects: FactoryObject[], spec: GenerationSpec, mutation: WhatIfMutation, factoryKey = 'a02'): WhatIfResult {
  const graph = buildRecipeGraph(spec)
  const basePlan = countPlanFromObjects(baseObjects, graph)
  const baseCnc = basePlan.machining ?? 1
  const baseAgv = baseObjects.filter((object) => object.type === 'agv').length
  const nextPlan = { ...basePlan }
  let nextCnc = baseCnc
  let nextAgv = Math.max(1, baseAgv)
  const labels: Record<WhatIfMutation, string> = {
    'add-cnc': '增加 1 台 CNC',
    'remove-cnc': '减少 1 台 CNC',
    'add-assembly': '增加 1 台装配单元',
    'remove-assembly': '减少 1 台装配单元',
    'add-agv': '增加 1 台 AGV',
    'remove-agv': '减少 1 台 AGV',
  }
  if (mutation === 'add-cnc') nextCnc += 1
  if (mutation === 'remove-cnc') nextCnc = Math.max(1, nextCnc - 1)
  if (mutation === 'add-assembly') nextPlan.assembly = Math.min(3, (nextPlan.assembly ?? 1) + 1)
  if (mutation === 'remove-assembly') nextPlan.assembly = Math.max(1, (nextPlan.assembly ?? 1) - 1)
  if (mutation === 'add-agv') nextAgv += 1
  if (mutation === 'remove-agv') nextAgv = Math.max(1, nextAgv - 1)
  nextPlan.machining = clamp(nextCnc, 1, Math.max(1, Math.min(spec.cncLimit, 3)))

  const beforeVariant: CandidateVariant = { key: 'whatif_before', cncCount: basePlan.machining ?? 1, agvCount: Math.max(1, baseAgv), strategy: 'WHAT-IF BASELINE', description: '以当前选中布局作为 What-if 基线。', parallelOverrides: basePlan }
  const before = makeEvaluatedCandidate(factoryKey, beforeVariant, spec, graph, estimateEquipment(spec, graph, basePlan), baseObjects, {
    mode: 'adjust',
    adjustments: [{ kind: 'inspect', title: '建立试算基线', detail: 'What-if 使用当前布局和同一仿真时间窗建立对照。' }],
    baselineObjects: baseObjects,
    parallelPlan: basePlan,
  })
  const afterVariant: CandidateVariant = {
    key: `whatif_${mutation}`,
    cncCount: nextPlan.machining ?? 1,
    agvCount: nextAgv,
    strategy: 'WHAT-IF RESULT',
    description: `${labels[mutation]}后重新生成可验证布局，并与当前基线比较。`,
    parallelOverrides: nextPlan,
    searchRound: 1,
  }
  let after: GeneratedCandidate
  try {
    after = makeCandidate(factoryKey, afterVariant, spec, graph, baseObjects)
  } catch (error) {
    const fallbackPlan = { ...nextPlan, assembly: basePlan.assembly ?? 1 }
    after = makeCandidate(factoryKey, { ...afterVariant, parallelOverrides: fallbackPlan }, spec, graph, baseObjects)
    after.warnings.push(`What-if ${labels[mutation]} 在当前场地无法找到无碰撞路线，已返回保守基线供比较。`)
    after.validation = { ...after.validation, passed: false }
    void error
  }
  return {
    mutation,
    label: labels[mutation],
    before,
    after,
    delta: {
      throughputPerHour: roundOne(after.metrics.throughputPerHour - before.metrics.throughputPerHour),
      energyPerUnit: roundOne(after.metrics.energyPerUnit - before.metrics.energyPerUnit),
      utilization: roundOne(after.metrics.utilization - before.metrics.utilization),
      monthlyBenefit: after.metrics.economics.monthlyBenefit - before.metrics.economics.monthlyBenefit,
      paybackMonths: after.metrics.economics.paybackMonths,
    },
  }
}

function compareLayouts(before: FactoryObject[], after: FactoryObject[]): LayoutDiff {
  const beforeById = new Map(before.map((object) => [object.id, object]))
  const afterById = new Map(after.map((object) => [object.id, object]))
  let added = 0
  let removed = 0
  let moved = 0
  let rotated = 0
  let unchanged = 0
  for (const object of after) {
    const previous = beforeById.get(object.id)
    if (!previous) {
      added += 1
      continue
    }
    const positionChanged = previous.pos.x !== object.pos.x || previous.pos.z !== object.pos.z
    const rotationChanged = previous.rotation !== object.rotation
    if (positionChanged) moved += 1
    if (rotationChanged) rotated += 1
    if (!positionChanged && !rotationChanged) unchanged += 1
  }
  for (const object of before) if (!afterById.has(object.id)) removed += 1
  return {
    added,
    removed,
    moved,
    rotated,
    unchanged,
    changeCost: added + removed + moved * 2 + rotated * 0.5,
  }
}

function scoreCandidate(
  simulation: CandidateSimulation,
  validation: CandidateValidation,
  spec: GenerationSpec,
  diff: LayoutDiff,
  mode: GeneratedCandidate['mode'],
): number {
  const throughput = clamp(simulation.throughputPerHour / Math.max(1, spec.targetThroughputPerHour), 0, 1.4) / 1.4
  const energy = clamp(1 - simulation.energyPerUnit / 99, 0, 1)
  const logistics = simulation.logisticsEfficiency / 100
  const utilization = simulation.utilization / 100
  const structural = validation.passed ? 1 : 0
  const changePenalty = mode === 'adjust' ? clamp(diff.changeCost / 120, 0, 1) : 0
  if (spec.objective === 'throughput') return structural * 35 + throughput * 42 + utilization * 15 + logistics * 8 - changePenalty * 4
  if (spec.objective === 'energy') return structural * 35 + energy * 36 + logistics * 20 + throughput * 9 - changePenalty * 3
  return structural * 35 + throughput * 28 + energy * 18 + logistics * 12 + utilization * 7 - changePenalty * 4
}

function rankCandidates(candidates: GeneratedCandidate[]): GeneratedCandidate[] {
  const sorted = [...candidates].sort((a, b) => b.score - a.score)
  return sorted.map((candidate, index) => ({
    ...candidate,
    rank: index + 1,
    paretoRank: isDominated(candidate, sorted) ? 2 : 1,
  }))
}

function isDominated(candidate: GeneratedCandidate, candidates: GeneratedCandidate[]): boolean {
  return candidates.some((other) => {
    if (other.id === candidate.id) return false
    const noWorse = other.metrics.throughputPerHour >= candidate.metrics.throughputPerHour
      && other.metrics.energyPerUnit <= candidate.metrics.energyPerUnit
      && other.metrics.logisticsEfficiency >= candidate.metrics.logisticsEfficiency
      && other.metrics.changeCost <= candidate.metrics.changeCost
    const strictlyBetter = other.metrics.throughputPerHour > candidate.metrics.throughputPerHour
      || other.metrics.energyPerUnit < candidate.metrics.energyPerUnit
      || other.metrics.logisticsEfficiency > candidate.metrics.logisticsEfficiency
      || other.metrics.changeCost < candidate.metrics.changeCost
    return noWorse && strictlyBetter
  })
}

function powerKw(type: BuildType): number {
  const match = OBJECT_DEFS[type].power.match(/([\d.]+)/)
  return match ? Number(match[1]) : 1
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function roundOne(value: number): number {
  return Math.round(value * 10) / 10
}

export function itemLabel(itemId: string): string {
  return ITEM_NAMES[itemId] ?? itemId
}

export function recipeById(recipeId: string): Recipe | undefined {
  return [...DEFAULT_RECIPES, ...GEARBOX_RECIPES].find((recipe) => recipe.id === recipeId)
}
