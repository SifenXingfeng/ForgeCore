import { canCustomizeStorageName, isBuildType, type AgvProgram, type AgvRouteWaypoint, type FactoryFloorId, type FactoryObject, type InclineConveyorConfig, type MachineDefinition, type Rotation, type StationProgram, type StorageConfig } from './types'
import { isInclineConveyorType } from './inclineConveyor'
import type { Item, Recipe, RecipePort } from './item'
import { MAX_FACTORY_FLOORS, MIN_FACTORY_FLOORS, clampFloorCount } from './floorConfig'

/**
 * 工厂项目的版本化载荷。主存档由账号下的后端项目库持久化；
 * 这里的序列化与文件 API 只负责 schema 校验和显式 JSON 导入/导出。
 */

export interface FactorySave {
  version: number
  savedAt?: string
  name: string
  floorCount: number
  floorNames: string[]
  objects: FactoryObject[]
  items: Item[]
  recipes: Recipe[]
  machineDefinitions: MachineDefinition[]
}

/** Version 6 adds finite rack inventory plus inbound/outbound warehouses. */
export const SAVE_VERSION = 6
const FIRST_SUPPORTED_VERSION = 1

/** 导出存档（序列化到 JSON 字符串） */
export function serializeSave(save: FactorySave): string {
  return JSON.stringify(save, null, 2)
}

/** 下载存档为文件 */
export function downloadSave(save: FactorySave, filename = 'forgemind-factory.json') {
  const blob = new Blob([serializeSave(save)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
}

/** 从文件读取 JSON 文本 */
export function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result))
    r.onerror = () => reject(r.error)
    r.readAsText(file)
  })
}

/**
 * 解析并校验存档，返回合法 FactorySave；非法则抛错。
 * 校验策略：未知字段忽略，关键字段做运行时类型检查（防脏数据进入 store）。
 */
export function parseSave(json: string): FactorySave {
  const parsed: unknown = JSON.parse(json)

  if (!isRecord(parsed)) {
    throw new Error('存档不是有效对象')
  }

  const version = parseVersion(parsed.version)
  const data = migrateSave(parsed, version)
  const objects = parseObjects(data.objects)
  const items = parseItems(data.items)
  const recipes = parseRecipes(data.recipes, items)
  const machineDefinitions = parseMachineDefinitions(data.machineDefinitions, recipes)
  const inferredFloorCount = inferFloorCount(objects, version <= 3 ? 3 : 1)
  const floorCount = data.floorCount === undefined
    ? inferredFloorCount
    : parseFloorCount(data.floorCount)
  if (objects.some((object) => maxObjectFloor(object) > floorCount)) {
    throw new Error('存档楼层数量小于设备所在楼层')
  }

  return {
    version: SAVE_VERSION,
    savedAt: typeof data.savedAt === 'string' ? data.savedAt : undefined,
    name: typeof data.name === 'string' && data.name.trim() ? data.name.trim().slice(0, 80) : '未命名工厂',
    floorCount,
    floorNames: parseFloorNames(data.floorNames, floorCount),
    objects,
    items,
    recipes,
    machineDefinitions,
  }
}

function parseVersion(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new Error('存档版本非法')
  }
  if (value < FIRST_SUPPORTED_VERSION || value > SAVE_VERSION) {
    throw new Error(`不支持的存档版本 v${value}，当前支持 v${FIRST_SUPPORTED_VERSION}–v${SAVE_VERSION}`)
  }
  return value
}

/**
 * Upgrade older payloads before validation. V6 adds warehouse boundaries and
 * finite rack configuration while preserving V3 incline geometry.
 */
function migrateSave(data: Record<string, unknown>, version: number): Record<string, unknown> {
  if (version === SAVE_VERSION) return data
  return { ...data, version: SAVE_VERSION }
}

function parseObjects(v: unknown): FactoryObject[] {
  if (!Array.isArray(v)) throw new Error('objects 不是数组')
  const ids = new Set<string>()
  return v.map((o) => {
    if (!isRecord(o)) throw new Error('对象数据非法')
    const x = o
    const type = x.type
    const pos = x.pos
    const rotation = x.rotation
    if (!isBuildType(type))
      throw new Error('对象类型非法')
    if (!isRecord(pos) || !isFiniteNumber(pos.x) || !isFiniteNumber(pos.z))
      throw new Error('对象位置非法')
    if (rotation !== 0 && rotation !== 90 && rotation !== 180 && rotation !== 270)
      throw new Error('对象旋转非法')
    const id = typeof x.id === 'string' ? x.id : genIdFor('obj')
    if (ids.has(id)) throw new Error(`对象 id 重复：${id}`)
    ids.add(id)
    const incline = parseInclineConfig(x.incline)
    if (isInclineConveyorType(type) && !incline) throw new Error('跨层传送带配置非法')
    const parsedFloorId = parseFloorId(x.floorId)
    const floorId = incline
      ? incline.direction === 'up' ? incline.lowerFloorId : incline.upperFloorId
      : parsedFloorId
    const itemId = typeof x.itemId === 'string' ? x.itemId : undefined
    const legacyDisplayName = typeof x.displayName === 'string'
      ? x.displayName
      : typeof x.customName === 'string'
        ? x.customName
        : typeof x.name === 'string'
          ? x.name
          : ''
    const displayName = canCustomizeStorageName(type) && legacyDisplayName.trim()
      ? legacyDisplayName.trim().slice(0, 40)
      : undefined
    return {
      id,
      type,
      displayName,
      resourceId: typeof x.resourceId === 'string' ? x.resourceId : undefined,
      pos: { x: pos.x as number, z: pos.z as number },
      rotation: rotation as Rotation,
      floorId,
      recipeId: typeof x.recipeId === 'string' ? x.recipeId : undefined,
      itemId,
      agvProgram: parseAgvProgram(x.agvProgram),
      incline,
      portConfig: parsePortConfig(x.portConfig),
      stationProgram: parseStationProgram(x.stationProgram),
      storageConfig: type === 'oreMiner' || type === 'storage' ? parseStorageConfig(x.storageConfig, itemId) : undefined,
    }
  })
}

function parseStorageConfig(value: unknown, legacyItemId?: string): StorageConfig {
  if (!isRecord(value)) {
    return { capacity: 100, initialInventory: legacyItemId ? { [legacyItemId]: 24 } : {} }
  }
  const capacity = isFiniteNumber(value.capacity) ? Math.max(1, Math.min(1000000, Math.round(value.capacity))) : 100
  const initialInventory: Record<string, number> = {}
  let remaining = capacity
  if (isRecord(value.initialInventory)) {
    for (const [itemId, quantity] of Object.entries(value.initialInventory)) {
      if (!isFiniteNumber(quantity) || quantity <= 0 || remaining <= 0) continue
      const accepted = Math.min(remaining, Math.round(quantity))
      if (accepted > 0) initialInventory[itemId] = accepted
      remaining -= accepted
    }
  }
  return { capacity, initialInventory }
}

function parseFloorId(value: unknown): FactoryFloorId {
  return typeof value === 'number' && Number.isInteger(value) && value >= MIN_FACTORY_FLOORS && value <= MAX_FACTORY_FLOORS ? value : 1
}

function parseInclineConfig(value: unknown): InclineConveyorConfig | undefined {
  if (!isRecord(value) || (value.direction !== 'up' && value.direction !== 'down')) return undefined
  const lowerFloorId = value.lowerFloorId
  const upperFloorId = value.upperFloorId
  if (!isFloorId(lowerFloorId) || lowerFloorId >= MAX_FACTORY_FLOORS || !isFloorId(upperFloorId) || upperFloorId !== lowerFloorId + 1) return undefined
  if (!isGridPos(value.lowPos) || !isGridPos(value.highPos)) return undefined
  if (!isFiniteNumber(value.riseM) || value.riseM <= 0 || !isFiniteNumber(value.runM) || value.runM <= 0) return undefined
  return {
    direction: value.direction,
    lowerFloorId,
    upperFloorId,
    lowPos: value.lowPos,
    highPos: value.highPos,
    riseM: value.riseM,
    runM: value.runM,
  }
}

function isFloorId(value: unknown): value is FactoryFloorId {
  return typeof value === 'number' && Number.isInteger(value) && value >= MIN_FACTORY_FLOORS && value <= MAX_FACTORY_FLOORS
}

function parseFloorCount(value: unknown): number {
  if (!isFloorId(value)) throw new Error(`楼层数量必须为 ${MIN_FACTORY_FLOORS}–${MAX_FACTORY_FLOORS} 的整数`)
  return value
}

function parseFloorNames(value: unknown, floorCount: number): string[] {
  const source = Array.isArray(value) ? value : []
  return Array.from({ length: floorCount }, (_, index) => {
    const name = source[index]
    return typeof name === 'string' && name.trim() ? name.trim().slice(0, 30) : `${index + 1}F 生产层`
  })
}

function parsePortConfig(value: unknown): FactoryObject['portConfig'] {
  if (!isRecord(value)) return undefined
  if (!isFiniteNumber(value.inputCount) || !isFiniteNumber(value.outputCount)) return undefined
  return {
    inputCount: Math.max(1, Math.round(value.inputCount)),
    outputCount: Math.max(1, Math.round(value.outputCount)),
  }
}

function parseStationProgram(value: unknown): StationProgram | undefined {
  if (!isRecord(value) || (value.mode !== 'pickup' && value.mode !== 'store')) return undefined
  const assignments: StationProgram['rackAssignments'] = {}
  if (isRecord(value.rackAssignments)) {
    Object.entries(value.rackAssignments).forEach(([itemId, side]) => {
      if (side === 'back' || side === 'left' || side === 'right') assignments[itemId] = side
    })
  }
  return {
    mode: value.mode,
    transferIntervalSec: isFiniteNumber(value.transferIntervalSec) ? Math.max(0.25, Math.min(60, value.transferIntervalSec)) : 2,
    rackAssignments: assignments,
  }
}

function maxObjectFloor(object: FactoryObject): number {
  return Math.max(object.floorId ?? 1, object.incline?.lowerFloorId ?? 1, object.incline?.upperFloorId ?? 1)
}

function inferFloorCount(objects: FactoryObject[], minimum: number): number {
  return clampFloorCount(Math.max(minimum, ...objects.map(maxObjectFloor)))
}

function isGridPos(value: unknown): value is { x: number; z: number } {
  return isRecord(value) && isFiniteNumber(value.x) && isFiniteNumber(value.z)
}

function parseAgvProgram(value: unknown): AgvProgram | undefined {
  if (!isRecord(value)) return undefined
  const route = Array.isArray(value.route) ? value.route.flatMap((entry): AgvRouteWaypoint[] => {
    if (!isRecord(entry) || typeof entry.id !== 'string' || typeof entry.label !== 'string' || !isRecord(entry.position)) return []
    if (!isFiniteNumber(entry.position.x) || !isFiniteNumber(entry.position.z)) return []
    const action = entry.action === 'load' || entry.action === 'unload' || entry.action === 'pass' ? entry.action : 'pass'
    return [{ id: entry.id, label: entry.label, objectId: typeof entry.objectId === 'string' ? entry.objectId : null, position: { x: entry.position.x, z: entry.position.z }, action }]
  }) : undefined
  const policy = value.policy === 'shortest' || value.policy === 'priority' || value.policy === 'balanced' ? value.policy : 'balanced'
  const dispatchMode = value.dispatchMode === 'threshold' ? 'threshold' : 'continuous'
  return {
    enabled: value.enabled === true,
    sourceObjectId: typeof value.sourceObjectId === 'string' ? value.sourceObjectId : null,
    destinationObjectId: typeof value.destinationObjectId === 'string' ? value.destinationObjectId : null,
    itemId: typeof value.itemId === 'string' ? value.itemId : null,
    loadQuantity: isFiniteNumber(value.loadQuantity) ? Math.max(1, Math.round(value.loadQuantity)) : 100,
    route,
    priority: isFiniteNumber(value.priority) ? Math.max(0, Math.min(9, Math.round(value.priority))) : 0,
    policy,
    dispatchMode,
    sourceMinQuantity: isFiniteNumber(value.sourceMinQuantity) ? Math.max(0, Math.round(value.sourceMinQuantity)) : 1,
    destinationMaxQuantity: isFiniteNumber(value.destinationMaxQuantity) ? Math.max(0, Math.round(value.destinationMaxQuantity)) : 100,
  }
}

function parseItems(v: unknown): Item[] {
  if (!Array.isArray(v)) throw new Error('items 不是数组')
  const ids = new Set<string>()
  return v.map((i) => {
    if (!isRecord(i)) throw new Error('物品数据非法')
    const x = i
    if (typeof x.name !== 'string') throw new Error('物品名称非法')
    const cat = x.category
    if (cat !== 'raw' && cat !== 'intermediate' && cat !== 'product')
      throw new Error('物品类别非法')
    const id = typeof x.id === 'string' ? x.id : genIdFor('item')
    if (ids.has(id)) throw new Error(`物品 id 重复：${id}`)
    ids.add(id)
    if (x.size !== undefined && (!isFiniteNumber(x.size) || x.size <= 0)) throw new Error('物品尺寸非法')
    return {
      id,
      name: x.name,
      category: cat,
      color: typeof x.color === 'string' ? x.color : '#4fc3f7',
      size: typeof x.size === 'number' ? x.size : 1,
      note: typeof x.note === 'string' ? x.note : undefined,
      modelPath: typeof x.modelPath === 'string' ? x.modelPath : undefined,
      modelId: typeof x.modelId === 'string' ? x.modelId : undefined,
      code: typeof x.code === 'string' ? x.code : id,
      description: typeof x.description === 'string' ? x.description : typeof x.note === 'string' ? x.note : undefined,
      massKg: isFiniteNumber(x.massKg) ? Math.max(0, x.massKg) : 1,
      maxStackSize: isFiniteNumber(x.maxStackSize) ? Math.max(1, Math.round(x.maxStackSize)) : 100,
      modelParameters: parseModelParameters(x.modelParameters),
    }
  })
}

function parseRecipes(v: unknown, items: Item[]): Recipe[] {
  if (!Array.isArray(v)) throw new Error('recipes 不是数组')
  const itemIds = new Set(items.map((i) => i.id))
  const ids = new Set<string>()
  return v.map((r) => {
    if (!isRecord(r)) throw new Error('配方数据非法')
    const x = r
    if (typeof x.name !== 'string') throw new Error('配方名称非法')
    const inputs = parsePorts(x.inputs, itemIds)
    const outputs = parsePorts(x.outputs, itemIds)
    if (x.durationSec !== undefined && (!isFiniteNumber(x.durationSec) || x.durationSec <= 0)) throw new Error('配方时长非法')
    const id = typeof x.id === 'string' ? x.id : genIdFor('recipe')
    if (ids.has(id)) throw new Error(`配方 id 重复：${id}`)
    ids.add(id)
    return {
      id,
      name: x.name,
      inputs,
      outputs,
      durationSec: typeof x.durationSec === 'number' ? x.durationSec : 1,
      code: typeof x.code === 'string' ? x.code : id,
      description: typeof x.description === 'string' ? x.description : undefined,
      enabled: x.enabled !== false,
    }
  })
}

function parseModelParameters(value: unknown): Item['modelParameters'] {
  if (!isRecord(value)) return undefined
  const result: NonNullable<Item['modelParameters']> = {}
  Object.entries(value).forEach(([key, entry]) => {
    if (typeof entry === 'string' || typeof entry === 'boolean' || isFiniteNumber(entry)) result[key] = entry
  })
  return result
}

function parseMachineDefinitions(value: unknown, recipes: Recipe[]): MachineDefinition[] {
  if (value === undefined) return []
  if (!Array.isArray(value)) throw new Error('机器定义不是数组')
  const recipeIds = new Set(recipes.map((recipe) => recipe.id))
  const ids = new Set<string>()
  return value.map((entry) => {
    if (!isRecord(entry) || typeof entry.id !== 'string' || !entry.id.trim() || typeof entry.name !== 'string') throw new Error('机器定义非法')
    const id = entry.id.trim()
    if (ids.has(id)) throw new Error(`机器 id 重复：${id}`)
    ids.add(id)
    const footprint = isRecord(entry.footprint) && isFiniteNumber(entry.footprint.w) && isFiniteNumber(entry.footprint.d)
      ? { w: Math.max(1, Math.min(12, Math.round(entry.footprint.w))), d: Math.max(1, Math.min(12, Math.round(entry.footprint.d))) }
      : { w: 2, d: 2 }
    const modelType = entry.modelType === 'smelter' || entry.modelType === 'press' || entry.modelType === 'washing' || entry.modelType === 'imported' ? entry.modelType : 'machine'
    const inputPortCount = isFiniteNumber(entry.inputPortCount) ? Math.max(1, Math.min(footprint.w, Math.round(entry.inputPortCount))) : 1
    const outputPortCount = isFiniteNumber(entry.outputPortCount) ? Math.max(1, Math.min(footprint.w, Math.round(entry.outputPortCount))) : 1
    const allowed = Array.isArray(entry.recipeIds) ? entry.recipeIds.filter((recipeId): recipeId is string => typeof recipeId === 'string' && recipeIds.has(recipeId)) : []
    return {
      id,
      name: entry.name.trim().slice(0, 60),
      description: typeof entry.description === 'string' ? entry.description.slice(0, 240) : '',
      modelType,
      importedResourceId: typeof entry.importedResourceId === 'string' ? entry.importedResourceId : undefined,
      footprint,
      height: isFiniteNumber(entry.height) ? Math.max(0.3, Math.min(8, entry.height)) : 1.5,
      throughput: typeof entry.throughput === 'string' ? entry.throughput.slice(0, 40) : '—',
      power: typeof entry.power === 'string' ? entry.power.slice(0, 40) : '—',
      inputPortCount,
      outputPortCount,
      recipeIds: allowed,
    }
  })
}

function parsePorts(v: unknown, validItemIds: Set<string>): RecipePort[] {
  if (!Array.isArray(v)) throw new Error('配方端口不是数组')
  return v.map((p) => {
    if (!isRecord(p)) throw new Error('配方端口非法')
    const x = p
    if (typeof x.itemId !== 'string' || !validItemIds.has(x.itemId))
      throw new Error('配方引用了不存在的物品')
    if (!isFiniteNumber(x.qty) || x.qty <= 0) throw new Error('配方数量非法')
    return { itemId: x.itemId, qty: x.qty as number }
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function genIdFor(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}`
}
