import { create } from 'zustand'
import { canCustomizeStorageName, registerImportedObjectDef, registerMachineDefinition, type AgvProgram, type BuildType, type FactoryFloorId, type FactoryObject, type GridPos, type ImportedResource, type MachineDefinition, type Rotation, type StationProgram, type StorageConfig } from '../game/types'
import { canPlace } from '../game/grid'
import { type Item, type ItemCategory, type Recipe } from '../game/item'
import { genId as itemGenId } from '../game/item'
import type { FactorySave } from '../game/save'
import { SAVE_VERSION } from '../game/save'
import type { SimulationSnapshot } from '../game/simulation'
import { canPlaceIncline, createInclineObject, isInclineConveyorType, objectsTouchingFloor } from '../game/inclineConveyor'
import { MAX_FACTORY_FLOORS, clampFloorCount } from '../game/floorConfig'
import { dirToRotation } from '../game/dir'

export type FactoryId = 'a01' | 'a02'

/**
 * 低频 UI/编辑状态（补充设计 §5.3：只装低频状态；
 * 高频仿真实体位置绝不进 store，命令式更新 Three.js）。
 *
 * Day 2：建造；Day 3：Item/Recipe + 保存加载。
 */

/** 生成对象短 id */
function genId(): string {
  return `obj_${Math.random().toString(36).slice(2, 9)}`
}

/** ghost 预览（跟随鼠标的待放置对象） */
export interface Ghost {
  type: BuildType
  resourceId?: string
  pos: GridPos | null
  rotation: Rotation
  valid: boolean
  floorId?: FactoryFloorId
}

export interface ForgeMindState {
  /** 当前已打开项目的名称与可用楼层数。 */
  factoryName: string
  floorCount: number
  floorNames: string[]
  /** 当前工作场地：A-01 人工产线 / A-02 AI 生成实验场 */
  factoryId: FactoryId
  /** 场地布局缓存；切换场地时互不覆盖 */
  factoryLayouts: Record<FactoryId, FactoryObject[]>
  /** 当前选中的建造工具类型；null = 无工具（浏览/选择模式） */
  buildType: BuildType | null
  /** 当前选中的用户导入资源。 */
  selectedImportedResourceId: string | null
  selectedMachineDefinitionId: string | null
  /** 已放置对象 */
  objects: FactoryObject[]
  /** ghost 预览 */
  ghost: Ghost
  ghostPath: GridPos[]
  ghostPathValid: boolean[]
  /** 当前选中对象 id */
  selectedId: string | null
  /** 当前选择集合；selectedId 始终是集合中的主选中对象。 */
  selectedIds: string[]
  /** 物品类型定义 */
  items: Item[]
  /** 配方定义 */
  recipes: Recipe[]
  /** 当前浏览器会话内可建造的用户导入资源。 */
  importedResources: ImportedResource[]
  machineDefinitions: MachineDefinition[]

  /** 仿真快照（低频，10Hz 由 runner 写入） */
  simSnapshot: SimulationSnapshot
  /** 仿真是否运行中 */
  simPlaying: boolean
  /** 仿真倍率 */
  simSpeed: number
  /** 重置信号：每 +1，runner 重建引擎 */
  simResetTick: number
  canUndo: boolean
  canRedo: boolean

  setBuildType: (t: BuildType | null) => void
  setImportedResourceId: (id: string | null) => void
  setMachineDefinitionId: (id: string | null) => void
  registerImportedResource: (resource: ImportedResource, select?: boolean) => void
  clearImportedResources: () => void
  /** 更新 ghost 的网格位置（含合法性计算）；null = 指针不在网格上 */
  updateGhost: (pos: GridPos | null, floorId?: FactoryFloorId) => void
  setGhostPath: (path: GridPos[]) => void
  setGhostPathValid: (valid: boolean[]) => void
  /** ghost 旋转 90°（R 键） */
  rotateGhost: () => void
  /** 确认放置当前 ghost */
  place: () => void
  /** Place a segment at an explicit grid cell (used by conveyor drag placement). */
  placeAt: (pos: GridPos, rotation?: Rotation, floorId?: FactoryFloorId) => boolean
  /** 移除指定对象 */
  remove: (id: string) => void
  /** 一次性移除多个对象，并记为一条历史。 */
  removeMany: (ids: string[]) => void
  /** 将单个对象沿网格平移。非法位置保持原状。 */
  moveObject: (id: string, dx: number, dz: number) => boolean
  /** 旋转已放置对象 */
  rotateObject: (id: string, direction?: -1 | 1) => boolean
  undo: () => void
  redo: () => void
  select: (id: string | null) => void
  selectMany: (ids: string[]) => void

  /** 新增物品 */
  addItem: (name: string, category: ItemCategory, color: string, modelPath?: string, modelId?: string) => void
  createItem: (item: Item) => boolean
  updateItem: (id: string, item: Item) => boolean
  /** 删除物品（若有配方引用则一并移除引用，防止悬空） */
  removeItem: (id: string) => void
  /** 新增配方 */
  addRecipe: (
    name: string,
    inputs: Recipe['inputs'],
    outputs: Recipe['outputs'],
    durationSec: number,
  ) => void
  /** 删除配方 */
  removeRecipe: (id: string) => void
  createRecipe: (recipe: Recipe) => boolean
  updateRecipe: (id: string, recipe: Recipe) => boolean
  addMachineDefinition: (definition: MachineDefinition) => boolean
  updateMachineDefinition: (id: string, definition: MachineDefinition) => boolean
  removeMachineDefinition: (id: string) => boolean

  /** 机器绑定配方 */
  bindRecipe: (objectId: string, recipeId: string | null) => void
  /** source 绑定产出物品 */
  bindItem: (objectId: string, itemId: string | null) => void
  /** 配置 AGV 的起点、货物和终点任务 */
  setAgvProgram: (objectId: string, program: AgvProgram | null) => void
  setObjectPortConfig: (objectId: string, inputCount: number, outputCount: number) => void
  setStationProgram: (objectId: string, program: StationProgram) => void
  setStorageConfig: (objectId: string, config: StorageConfig) => void
  setObjectDisplayName: (objectId: string, name: string) => void

  /** 设置仿真快照（仅 runner 调用，低频） */
  setSimSnapshot: (snap: SimulationSnapshot) => void
  setSimPlaying: (p: boolean) => void
  setSimSpeed: (x: number) => void
  /** 请求重置仿真（runner 监听 tick 变化重建引擎） */
  requestSimReset: () => void

  /** 导出当前状态为存档对象 */
  exportSave: () => FactorySave
  /** 用存档覆盖当前状态 */
  importSave: (save: FactorySave) => void
  /** 清空全部（新建工厂） */
  clearAll: () => void
  /** 创建一个保留基础物品/配方目录的空白工厂。 */
  newFactory: (name?: string) => void
  /** 向上追加一个楼层并返回其编号。 */
  addFloor: () => FactoryFloorId
  renameFloor: (floorId: FactoryFloorId, name: string) => void
  /** 切换工作场地，并恢复目标场地的独立布局与仿真快照 */
  setFactory: (factoryId: FactoryId) => void
  /** 由生成器或诊断副本一次性应用布局，并合并候选方案的物品与配方 */
  applyLayout: (objects: FactoryObject[], layoutRecipes?: Recipe[], layoutItems?: Item[]) => void
}

const emptyGhost: Ghost = { type: 'machine', pos: null, rotation: 0, valid: false }

const emptySnapshot: SimulationSnapshot = {
  timeSec: 0,
  machines: [],
  sources: [],
  racks: [],
  itemLots: [],
  agvs: [],
  drones: [],
  stats: { consumed: {}, produced: {} },
  floorStats: {
    1: { consumed: {}, produced: {} },
    2: { consumed: {}, produced: {} },
    3: { consumed: {}, produced: {} },
  },
}

interface FactoryHistoryEntry {
  objects: FactoryObject[]
  selectedId: string | null
  selectedIds: string[]
}

const HISTORY_LIMIT = 80

export const useForgeMindStore = create<ForgeMindState>((set, get) => {
  const undoStacks: Record<FactoryId, FactoryHistoryEntry[]> = { a01: [], a02: [] }
  const redoStacks: Record<FactoryId, FactoryHistoryEntry[]> = { a01: [], a02: [] }

  const capture = (state: Pick<ForgeMindState, 'objects' | 'selectedId' | 'selectedIds'>): FactoryHistoryEntry => ({
    objects: state.objects,
    selectedId: state.selectedId,
    selectedIds: [...state.selectedIds],
  })

  const pushHistory = (state: Pick<ForgeMindState, 'objects' | 'selectedId' | 'selectedIds'>) => {
    const factoryId = get().factoryId
    undoStacks[factoryId] = [...undoStacks[factoryId], capture(state)].slice(-HISTORY_LIMIT)
    redoStacks[factoryId] = []
  }

  const historyFlags = () => {
    const factoryId = get().factoryId
    return { canUndo: undoStacks[factoryId].length > 0, canRedo: redoStacks[factoryId].length > 0 }
  }

  const snapshotByFactory: Record<FactoryId, SimulationSnapshot> = {
    a01: emptySnapshot,
    a02: emptySnapshot,
  }

  return ({
  factoryName: '未命名工厂',
  floorCount: 1,
  floorNames: ['1F 生产层'],
  factoryId: 'a01',
  factoryLayouts: {
    a01: [],
    a02: [],
  },
  buildType: null,
  selectedImportedResourceId: null,
  selectedMachineDefinitionId: null,
  objects: [],
  ghost: emptyGhost,
  ghostPath: [],
  ghostPathValid: [],
  selectedId: null,
  selectedIds: [],
  items: [],
  recipes: [],
  importedResources: [],
  machineDefinitions: [],
  simSnapshot: emptySnapshot,
  simPlaying: false,
  simSpeed: 0.35,
  simResetTick: 0,
  canUndo: false,
  canRedo: false,

  setBuildType: (t) =>
    set((s) => ({
      buildType: t,
      ghost: t ? { type: t, resourceId: t === 'imported' ? s.selectedImportedResourceId ?? undefined : t === 'machine' ? s.selectedMachineDefinitionId ?? undefined : undefined, pos: s.ghost.pos, rotation: 0, valid: false, floorId: s.ghost.floorId } : emptyGhost,
      ghostPath: [],
      ghostPathValid: [],
    })),

  setImportedResourceId: (id) =>
    set((s) => ({
      selectedImportedResourceId: id,
      buildType: id ? 'imported' : s.buildType === 'imported' ? null : s.buildType,
      ghost: id
        ? { ...s.ghost, type: 'imported', resourceId: id, rotation: 0, valid: false }
        : s.ghost,
    })),

  setMachineDefinitionId: (id) =>
    set((s) => ({
      selectedMachineDefinitionId: id,
      buildType: id ? 'machine' : s.buildType === 'machine' ? null : s.buildType,
      ghost: id ? { ...s.ghost, type: 'machine', resourceId: id, rotation: 0, valid: false } : s.ghost,
    })),

  registerImportedResource: (resource, select = true) => {
    registerImportedObjectDef(resource)
    get().machineDefinitions.filter((definition) => definition.importedResourceId === resource.id).forEach((definition) => registerMachineDefinition(definition, [...get().importedResources, resource]))
    set((s) => ({
      importedResources: [...s.importedResources.filter((entry) => entry.id !== resource.id), resource],
      ...(select ? {
        selectedImportedResourceId: resource.id,
        buildType: 'imported' as const,
        ghost: { ...s.ghost, type: 'imported' as const, resourceId: resource.id, rotation: 0 as Rotation, valid: false },
        ghostPath: [],
        ghostPathValid: [],
      } : {}),
    }))
  },

  clearImportedResources: () =>
    set((s) => {
      s.importedResources.forEach((resource) => {
        const assetPath = resource.objectDef.assetPath
        if (assetPath?.startsWith('blob:')) URL.revokeObjectURL(assetPath)
      })
      const withoutImported = (objects: FactoryObject[]) => objects.filter((object) => object.type !== 'imported')
      const factoryLayouts = {
        a01: withoutImported(s.factoryLayouts.a01),
        a02: withoutImported(s.factoryLayouts.a02),
      }
      const selectedIds = s.selectedIds.filter((id) => s.objects.some((object) => object.id === id && object.type !== 'imported'))
      return {
        importedResources: [],
        selectedImportedResourceId: null,
        factoryLayouts,
        objects: withoutImported(s.objects),
        buildType: s.buildType === 'imported' ? null : s.buildType,
        ghost: s.ghost.type === 'imported' ? emptyGhost : s.ghost,
        ghostPath: [],
        ghostPathValid: [],
        selectedId: s.selectedId && selectedIds.includes(s.selectedId) ? s.selectedId : selectedIds[0] ?? null,
        selectedIds,
      }
    }),

  updateGhost: (pos, floorId = 1) =>
    set((s) => {
      if (!s.ghost.pos && pos === null) return {}
      const rotation = s.ghost.rotation
      const valid = pos !== null && floorId >= 1 && floorId <= s.floorCount && (isInclineConveyorType(s.ghost.type)
        ? floorId < s.floorCount && canPlaceIncline(pos, s.ghost.type, rotation, floorId, s.objects)
        : canPlace(pos, s.ghost.type, rotation, objectsTouchingFloor(s.objects, floorId), s.ghost.resourceId))
      return { ghost: { ...s.ghost, pos, valid, floorId } }
    }),

  setGhostPath: (path) => set({ ghostPath: path }),
  setGhostPathValid: (valid) => set({ ghostPathValid: valid }),

  rotateGhost: () =>
    set((s) => {
      if (!s.buildType) return {}
      const rotation = ((s.ghost.rotation + 90) % 360) as Rotation
      const pos = s.ghost.pos
      const floorId = s.ghost.floorId ?? 1
      const valid = pos !== null && floorId >= 1 && floorId <= s.floorCount && (isInclineConveyorType(s.ghost.type)
        ? floorId < s.floorCount && canPlaceIncline(pos, s.ghost.type, rotation, floorId, s.objects)
        : canPlace(pos, s.ghost.type, rotation, objectsTouchingFloor(s.objects, floorId), s.ghost.resourceId))
      return { ghost: { ...s.ghost, rotation, valid } }
    }),

  place: () => {
    const ghost = get().ghost
    if (ghost.pos && ghost.valid) get().placeAt(ghost.pos, ghost.rotation, ghost.floorId ?? 1)
  },

  placeAt: (pos, rotation = get().ghost.rotation, floorId = 1) => {
    let placed = false
    set((s) => {
      if (!s.buildType) return {}
      if (!Number.isInteger(floorId) || floorId < 1 || floorId > s.floorCount) return {}
      const inclineType = isInclineConveyorType(s.buildType) ? s.buildType : null
      if (inclineType) {
        if (floorId >= s.floorCount) return {}
        if (!canPlaceIncline(pos, inclineType, rotation, floorId, s.objects)) return {}
        const inclineObject = createInclineObject(genId(), inclineType, pos, rotation, floorId)
        if (!inclineObject) return {}
        placed = true
        pushHistory(s)
        return { objects: [...s.objects, inclineObject], ghost: { ...s.ghost, pos, rotation, valid: true, floorId }, ...historyFlags() }
      }
      const resourceId = s.buildType === 'imported' ? s.selectedImportedResourceId ?? undefined : s.buildType === 'machine' ? s.selectedMachineDefinitionId ?? undefined : undefined
      if (s.buildType === 'machine' && !resourceId) return {}
      if (!canPlace(pos, s.buildType, rotation, objectsTouchingFloor(s.objects, floorId), resourceId)) return {}
      placed = true
      pushHistory(s)
      const obj: FactoryObject = {
        id: genId(),
        type: s.buildType,
        resourceId,
        pos,
        rotation,
        floorId,
        ...(s.buildType === 'assembler' ? { portConfig: { inputCount: 3, outputCount: 1 } } : {}),
        ...(s.buildType === 'source' ? { stationProgram: { mode: 'pickup' as const, transferIntervalSec: 2, rackAssignments: {} } } : {}),
        ...((s.buildType === 'oreMiner' || s.buildType === 'storage') ? { storageConfig: { capacity: 100, initialInventory: {} } } : {}),
      }
      return { objects: [...s.objects, obj], ghost: { ...s.ghost, pos, rotation, valid: true, floorId }, ...historyFlags() }
    })
    return placed
  },

  remove: (id) => get().removeMany([id]),

  removeMany: (ids) =>
    set((s) => {
      const targets = new Set(ids.filter((id) => s.objects.some((object) => object.id === id)))
      if (targets.size === 0) return {}
      pushHistory(s)
      const selectedIds = s.selectedIds.filter((id) => !targets.has(id))
      return {
        objects: s.objects.filter((object) => !targets.has(object.id)),
        selectedId: s.selectedId && !targets.has(s.selectedId) ? s.selectedId : selectedIds[0] ?? null,
        selectedIds,
        ...historyFlags(),
      }
    }),

  moveObject: (id, dx, dz) => {
    let moved = false
    const stepX = Math.sign(dx)
    const stepZ = Math.sign(dz)
    if (Math.abs(stepX) + Math.abs(stepZ) !== 1) return false
    set((s) => {
      const object = s.objects.find((entry) => entry.id === id)
      if (!object) return {}
      const others = s.objects.filter((entry) => entry.id !== id)
      if (isInclineConveyorType(object.type) && object.incline) {
        const lowPos = { x: object.incline.lowPos.x + stepX, z: object.incline.lowPos.z + stepZ }
        const uphillRotation = dirToRotation({
          dx: Math.sign(object.incline.highPos.x - object.incline.lowPos.x),
          dz: Math.sign(object.incline.highPos.z - object.incline.lowPos.z),
        })
        if (!canPlaceIncline(lowPos, object.type, uphillRotation, object.incline.lowerFloorId, others)) return {}
        const translated = createInclineObject(object.id, object.type, lowPos, uphillRotation, object.incline.lowerFloorId)
        if (!translated) return {}
        moved = true
        pushHistory(s)
        return {
          objects: s.objects.map((entry) => entry.id === id ? { ...object, pos: translated.pos, rotation: translated.rotation, floorId: translated.floorId, incline: translated.incline } : entry),
          ...historyFlags(),
        }
      }
      const pos = { x: object.pos.x + stepX, z: object.pos.z + stepZ }
      const floorId = object.floorId ?? 1
      if (!canPlace(pos, object.type, object.rotation, objectsTouchingFloor(others, floorId), object.resourceId)) return {}
      moved = true
      pushHistory(s)
      return {
        objects: s.objects.map((entry) => entry.id === id ? { ...entry, pos } : entry),
        ...historyFlags(),
      }
    })
    return moved
  },

  rotateObject: (id, direction = 1) => {
    let rotated = false
    set((s) => {
      const obj = s.objects.find((o) => o.id === id)
      if (!obj) return {}
      if (isInclineConveyorType(obj.type)) return {}
      const rotation = ((obj.rotation + direction * 90 + 360) % 360) as Rotation
      const others = objectsTouchingFloor(s.objects.filter((o) => o.id !== id), obj.floorId ?? 1)
      if (!canPlace(obj.pos, obj.type, rotation, others, obj.resourceId)) return {}
      rotated = true
      pushHistory(s)
      return {
        objects: s.objects.map((o) => (o.id === id ? { ...o, rotation } : o)),
        ...historyFlags(),
      }
    })
    return rotated
  },

  undo: () =>
    set((s) => {
      const previous = undoStacks[s.factoryId].pop()
      if (!previous) return {}
      redoStacks[s.factoryId].push(capture(s))
      return {
        objects: previous.objects,
        selectedId: previous.selectedId,
        selectedIds: previous.selectedIds,
        ghostPath: [],
        ghostPathValid: [],
        simResetTick: s.simResetTick + 1,
        ...historyFlags(),
      }
    }),

  redo: () =>
    set((s) => {
      const next = redoStacks[s.factoryId].pop()
      if (!next) return {}
      undoStacks[s.factoryId].push(capture(s))
      return {
        objects: next.objects,
        selectedId: next.selectedId,
        selectedIds: next.selectedIds,
        ghostPath: [],
        ghostPathValid: [],
        simResetTick: s.simResetTick + 1,
        ...historyFlags(),
      }
    }),

  select: (id) => set({ selectedId: id, selectedIds: id ? [id] : [] }),
  selectMany: (ids) =>
    set((s) => {
      const objectIds = new Set(s.objects.map((object) => object.id))
      const selectedIds = Array.from(new Set(ids)).filter((id) => objectIds.has(id))
      return { selectedId: selectedIds[0] ?? null, selectedIds }
    }),

  addItem: (name, category, color, modelPath, modelId) =>
    set((s) => ({
      items: [...s.items, { id: itemGenId('item'), name, category, color, size: 1, modelPath, modelId }],
    })),

  createItem: (item) => {
    const id = item.id.trim()
    if (!id || get().items.some((entry) => entry.id === id)) return false
    set((s) => ({ items: [...s.items, { ...item, id, code: item.code?.trim() || id }] }))
    return true
  },

  updateItem: (id, item) => {
    const nextId = item.id.trim()
    if (!nextId || get().items.some((entry) => entry.id === nextId && entry.id !== id)) return false
    set((s) => ({
      items: s.items.map((entry) => entry.id === id ? { ...item, id: nextId, code: item.code?.trim() || nextId } : entry),
      recipes: s.recipes.map((recipe) => ({
        ...recipe,
        inputs: recipe.inputs.map((port) => port.itemId === id ? { ...port, itemId: nextId } : port),
        outputs: recipe.outputs.map((port) => port.itemId === id ? { ...port, itemId: nextId } : port),
      })),
      objects: s.objects.map((object) => {
        const initialInventory = object.storageConfig?.initialInventory
        const nextInventory = initialInventory && Object.prototype.hasOwnProperty.call(initialInventory, id)
          ? Object.fromEntries(Object.entries(initialInventory).map(([itemId, quantity]) => [itemId === id ? nextId : itemId, quantity]))
          : initialInventory
        const assignments = object.stationProgram?.rackAssignments
        const nextAssignments = assignments && Object.prototype.hasOwnProperty.call(assignments, id)
          ? Object.fromEntries(Object.entries(assignments).map(([itemId, side]) => [itemId === id ? nextId : itemId, side]))
          : assignments
        const agvProgram = object.agvProgram?.itemId === id ? { ...object.agvProgram, itemId: nextId } : object.agvProgram
        if (object.itemId !== id && nextInventory === initialInventory && nextAssignments === assignments && agvProgram === object.agvProgram) return object
        return {
          ...object,
          itemId: object.itemId === id ? nextId : object.itemId,
          agvProgram,
          storageConfig: object.storageConfig && nextInventory ? { ...object.storageConfig, initialInventory: nextInventory } : object.storageConfig,
          stationProgram: object.stationProgram && nextAssignments ? { ...object.stationProgram, rackAssignments: nextAssignments } : object.stationProgram,
        }
      }),
      simResetTick: s.simResetTick + 1,
    }))
    return true
  },

  removeItem: (id) =>
    set((s) => {
      // 同时清理引用该物品的配方端口，防止悬空引用
      const recipes = s.recipes
        .map((r) => ({
          ...r,
          inputs: r.inputs.filter((p) => p.itemId !== id),
          outputs: r.outputs.filter((p) => p.itemId !== id),
        }))
        .filter((r) => r.inputs.length > 0 || r.outputs.length > 0)
      return {
        items: s.items.filter((i) => i.id !== id),
        recipes,
        objects: s.objects.map((object) => {
          const initialInventory = object.storageConfig?.initialInventory
          const nextInventory = initialInventory ? { ...initialInventory } : undefined
          if (nextInventory) delete nextInventory[id]
          const assignments = object.stationProgram?.rackAssignments
          const nextAssignments = assignments ? { ...assignments } : undefined
          if (nextAssignments) delete nextAssignments[id]
          return {
            ...object,
            itemId: object.itemId === id ? undefined : object.itemId,
            agvProgram: object.agvProgram?.itemId === id ? { ...object.agvProgram, enabled: false, itemId: null } : object.agvProgram,
            storageConfig: object.storageConfig && nextInventory ? { ...object.storageConfig, initialInventory: nextInventory } : object.storageConfig,
            stationProgram: object.stationProgram && nextAssignments ? { ...object.stationProgram, rackAssignments: nextAssignments } : object.stationProgram,
          }
        }),
        simResetTick: s.simResetTick + 1,
      }
    }),

  addRecipe: (name, inputs, outputs, durationSec) =>
    set((s) => ({
      recipes: [
        ...s.recipes,
        {
          id: itemGenId('recipe'),
          name,
          inputs,
          outputs,
          durationSec: Math.max(0.1, durationSec),
        },
      ],
    })),

  removeRecipe: (id) =>
    set((s) => ({
      recipes: s.recipes.filter((r) => r.id !== id),
      machineDefinitions: s.machineDefinitions.map((definition) => ({ ...definition, recipeIds: definition.recipeIds.filter((recipeId) => recipeId !== id) })),
      objects: s.objects.map((object) => object.recipeId === id ? { ...object, recipeId: undefined } : object),
    })),

  createRecipe: (recipe) => {
    const id = recipe.id.trim()
    if (!id || get().recipes.some((entry) => entry.id === id)) return false
    set((s) => ({ recipes: [...s.recipes, { ...recipe, id, code: recipe.code?.trim() || id, enabled: recipe.enabled !== false }] }))
    return true
  },

  updateRecipe: (id, recipe) => {
    const nextId = recipe.id.trim()
    if (!nextId || get().recipes.some((entry) => entry.id === nextId && entry.id !== id)) return false
    set((s) => ({
      recipes: s.recipes.map((entry) => entry.id === id ? { ...recipe, id: nextId, code: recipe.code?.trim() || nextId } : entry),
      machineDefinitions: s.machineDefinitions.map((definition) => ({ ...definition, recipeIds: definition.recipeIds.map((recipeId) => recipeId === id ? nextId : recipeId) })),
      objects: s.objects.map((object) => object.recipeId === id ? { ...object, recipeId: nextId } : object),
    }))
    return true
  },

  addMachineDefinition: (definition) => {
    const id = definition.id.trim()
    const state = get()
    if (!id || state.machineDefinitions.some((entry) => entry.id === id)) return false
    const next = { ...definition, id, name: definition.name.trim() }
    registerMachineDefinition(next, state.importedResources)
    set((s) => ({ machineDefinitions: [...s.machineDefinitions, next] }))
    return true
  },

  updateMachineDefinition: (id, definition) => {
    const nextId = definition.id.trim()
    const state = get()
    if (!nextId || state.machineDefinitions.some((entry) => entry.id === nextId && entry.id !== id)) return false
    const next = { ...definition, id: nextId, name: definition.name.trim() }
    registerMachineDefinition(next, state.importedResources)
    set((s) => ({
      machineDefinitions: s.machineDefinitions.map((entry) => entry.id === id ? next : entry),
      objects: s.objects.map((object) => object.type === 'machine' && object.resourceId === id ? { ...object, resourceId: nextId, recipeId: next.recipeIds.includes(object.recipeId ?? '') ? object.recipeId : undefined } : object),
      selectedMachineDefinitionId: s.selectedMachineDefinitionId === id ? nextId : s.selectedMachineDefinitionId,
    }))
    return true
  },

  removeMachineDefinition: (id) => {
    if (get().objects.some((object) => object.type === 'machine' && object.resourceId === id)) return false
    set((s) => ({
      machineDefinitions: s.machineDefinitions.filter((entry) => entry.id !== id),
      selectedMachineDefinitionId: s.selectedMachineDefinitionId === id ? null : s.selectedMachineDefinitionId,
      buildType: s.buildType === 'machine' && s.selectedMachineDefinitionId === id ? null : s.buildType,
    }))
    return true
  },

  bindRecipe: (objectId, recipeId) =>
    set((s) => {
      const object = s.objects.find((o) => o.id === objectId)
      const nextRecipeId = recipeId ?? undefined
      if (!object || object.recipeId === nextRecipeId) return {}
      if (nextRecipeId) {
        const recipe = s.recipes.find((entry) => entry.id === nextRecipeId && entry.enabled !== false)
        if (!recipe) return {}
        if (object.type === 'machine') {
          const definition = s.machineDefinitions.find((entry) => entry.id === object.resourceId)
          if (!definition?.recipeIds.includes(nextRecipeId) || recipe.inputs.length > definition.inputPortCount || recipe.outputs.length > definition.outputPortCount) return {}
        }
        if (object.type === 'assembler') {
          const inputCount = object.portConfig?.inputCount ?? 3
          const outputCount = object.portConfig?.outputCount ?? 1
          if (recipe.inputs.length < 2 || recipe.outputs.length !== 1 || recipe.inputs.length > inputCount || recipe.outputs.length > outputCount) return {}
        }
      }
      pushHistory(s)
      return {
        objects: s.objects.map((o) =>
          o.id === objectId ? { ...o, recipeId: nextRecipeId } : o,
        ),
        ...historyFlags(),
      }
    }),

  bindItem: (objectId, itemId) =>
    set((s) => {
      const object = s.objects.find((o) => o.id === objectId)
      const nextItemId = itemId ?? undefined
      if (!object || object.itemId === nextItemId) return {}
      pushHistory(s)
      return {
        objects: s.objects.map((o) =>
          o.id === objectId ? { ...o, itemId: nextItemId } : o,
        ),
        ...historyFlags(),
      }
    }),

  setAgvProgram: (objectId, program) =>
    set((s) => {
      const object = s.objects.find((entry) => entry.id === objectId)
      if (!object || (object.type !== 'agv' && object.type !== 'drone')) return {}
      const nextProgram = program ? {
        ...program,
        loadQuantity: Math.max(1, Math.round(program.loadQuantity)),
        dispatchMode: program.dispatchMode === 'threshold' ? 'threshold' as const : 'continuous' as const,
        sourceMinQuantity: Math.max(0, Math.round(program.sourceMinQuantity ?? program.loadQuantity)),
        destinationMaxQuantity: Math.max(0, Math.round(program.destinationMaxQuantity ?? 100)),
      } : undefined
      if (JSON.stringify(object.agvProgram ?? null) === JSON.stringify(nextProgram ?? null)) return {}
      pushHistory(s)
      return {
        objects: s.objects.map((entry) => (entry.id === objectId ? { ...entry, agvProgram: nextProgram } : entry)),
        ...historyFlags(),
      }
    }),

  setObjectPortConfig: (objectId, inputCount, outputCount) =>
    set((s) => {
      const nextInput = Math.max(1, Math.round(inputCount))
      const nextOutput = Math.max(1, Math.round(outputCount))
      return {
        objects: s.objects.map((object) => {
          if (object.id !== objectId) return object
          const recipe = s.recipes.find((entry) => entry.id === object.recipeId)
          const recipeId = recipe && (recipe.inputs.length > nextInput || recipe.outputs.length > nextOutput) ? undefined : object.recipeId
          return { ...object, recipeId, portConfig: { inputCount: nextInput, outputCount: nextOutput } }
        }),
        simResetTick: s.simResetTick + 1,
      }
    }),

  setStationProgram: (objectId, program) =>
    set((s) => ({
      objects: s.objects.map((object) => object.id === objectId ? { ...object, stationProgram: { ...program, rackAssignments: { ...program.rackAssignments } } } : object),
      simResetTick: s.simResetTick + 1,
    })),

  setStorageConfig: (objectId, config) =>
    set((s) => {
      const object = s.objects.find((entry) => entry.id === objectId)
      if (!object || (object.type !== 'oreMiner' && object.type !== 'storage')) return {}
      const capacity = Math.max(1, Math.min(1000000, Math.round(config.capacity)))
      const entries = Object.entries(config.initialInventory)
        .filter(([itemId, quantity]) => s.items.some((item) => item.id === itemId) && Number.isFinite(quantity) && quantity > 0)
      const initialInventory: Record<string, number> = {}
      let remaining = capacity
      for (const [itemId, quantity] of entries) {
        const accepted = Math.min(remaining, Math.max(0, Math.round(quantity)))
        if (accepted > 0) initialInventory[itemId] = accepted
        remaining -= accepted
        if (remaining <= 0) break
      }
      const nextConfig = { capacity, initialInventory }
      if (JSON.stringify(object.storageConfig) === JSON.stringify(nextConfig)) return {}
      pushHistory(s)
      return {
        objects: s.objects.map((entry) => entry.id === objectId ? { ...entry, storageConfig: nextConfig, itemId: undefined } : entry),
        simResetTick: s.simResetTick + 1,
        ...historyFlags(),
      }
    }),

  setObjectDisplayName: (objectId, name) =>
    set((s) => {
      const object = s.objects.find((entry) => entry.id === objectId)
      if (!object || !canCustomizeStorageName(object.type)) return {}
      const displayName = name.trim().slice(0, 40) || undefined
      if (object.displayName === displayName) return {}
      pushHistory(s)
      return {
        objects: s.objects.map((entry) => entry.id === objectId ? { ...entry, displayName } : entry),
        ...historyFlags(),
      }
    }),

  setSimSnapshot: (snap) => {
    snapshotByFactory[get().factoryId] = snap
    set({ simSnapshot: snap })
  },
  setSimPlaying: (p) => set({ simPlaying: p }),
  setSimSpeed: (x) => set({ simSpeed: x }),
  requestSimReset: () => set((s) => ({ simResetTick: s.simResetTick + 1 })),

  exportSave: () => {
    const s = get()
    return {
      version: SAVE_VERSION,
      savedAt: new Date().toISOString(),
      name: s.factoryName,
      floorCount: s.floorCount,
      floorNames: s.floorNames,
      objects: s.objects,
      items: s.items,
      recipes: s.recipes,
      machineDefinitions: s.machineDefinitions,
    }
  },

  importSave: (save) => {
    const factoryId = get().factoryId
    undoStacks[factoryId] = []
    redoStacks[factoryId] = []
    save.machineDefinitions.forEach((definition) => registerMachineDefinition(definition, get().importedResources))
    set({
      factoryName: save.name,
      floorCount: save.floorCount,
      floorNames: save.floorNames,
      factoryLayouts: { ...get().factoryLayouts, [factoryId]: save.objects },
      objects: save.objects,
      items: save.items,
      recipes: save.recipes,
      machineDefinitions: save.machineDefinitions,
      selectedId: null,
      selectedIds: [],
      buildType: null,
      ghost: emptyGhost,
      ghostPath: [],
      ghostPathValid: [],
      simSnapshot: emptySnapshot,
      simPlaying: false,
      canUndo: false,
      canRedo: false,
    })
  },

  clearAll: () => {
    const factoryId = get().factoryId
    undoStacks[factoryId] = []
    redoStacks[factoryId] = []
    set({
      factoryLayouts: { ...get().factoryLayouts, [factoryId]: [] },
      objects: [],
      items: [],
      recipes: [],
      machineDefinitions: [],
      selectedMachineDefinitionId: null,
      selectedId: null,
      selectedIds: [],
      buildType: null,
      ghost: emptyGhost,
      ghostPath: [],
      ghostPathValid: [],
      simSnapshot: emptySnapshot,
      simPlaying: false,
      canUndo: false,
      canRedo: false,
    })
  },

  newFactory: (name = '未命名工厂') => {
    const factoryId = get().factoryId
    undoStacks[factoryId] = []
    redoStacks[factoryId] = []
    snapshotByFactory[factoryId] = emptySnapshot
    set((s) => ({
      factoryName: name.trim().slice(0, 80) || '未命名工厂',
      floorCount: 1,
      floorNames: ['1F 生产层'],
      factoryLayouts: { ...s.factoryLayouts, [factoryId]: [] },
      objects: [],
      items: [],
      recipes: [],
      machineDefinitions: [],
      selectedMachineDefinitionId: null,
      selectedId: null,
      selectedIds: [],
      buildType: null,
      ghost: emptyGhost,
      ghostPath: [],
      ghostPathValid: [],
      simSnapshot: emptySnapshot,
      simPlaying: false,
      simResetTick: s.simResetTick + 1,
      canUndo: false,
      canRedo: false,
    }))
  },

  addFloor: () => {
    const current = get().floorCount
    const next = clampFloorCount(current + 1)
    if (current >= MAX_FACTORY_FLOORS) return current
    set((s) => ({ floorCount: next, floorNames: [...s.floorNames, `${next}F 生产层`] }))
    return next
  },

  renameFloor: (floorId, name) =>
    set((s) => ({
      floorNames: s.floorNames.map((entry, index) => index === floorId - 1 ? name.trim().slice(0, 30) || `${floorId}F 生产层` : entry),
    })),

  setFactory: (factoryId) => {
    set((s) => {
      if (s.factoryId === factoryId) return {}
      snapshotByFactory[s.factoryId] = s.simSnapshot
      const nextSnapshot = snapshotByFactory[factoryId] ?? emptySnapshot
      const nextObjects = s.factoryLayouts[factoryId] ?? []
      return {
        factoryId,
        factoryLayouts: {
          ...s.factoryLayouts,
          [s.factoryId]: s.objects,
        },
        objects: nextObjects.map((object) => ({ ...object, pos: { ...object.pos } })),
        selectedId: null,
        selectedIds: [],
        buildType: null,
        ghost: emptyGhost,
        ghostPath: [],
        ghostPathValid: [],
        simSnapshot: nextSnapshot,
        simPlaying: false,
        simResetTick: s.simResetTick + 1,
        canUndo: undoStacks[factoryId].length > 0,
        canRedo: redoStacks[factoryId].length > 0,
      }
    })
  },

  applyLayout: (objects, layoutRecipes = [], layoutItems = []) =>
    set((s) => {
      pushHistory(s)
      const mergeById = <T extends { id: string }>(current: T[], additions: T[]) => {
        const byId = new Map(current.map((entry) => [entry.id, entry]))
        additions.forEach((entry) => byId.set(entry.id, entry))
        return Array.from(byId.values())
      }
      return {
        objects: objects.map((object) => ({ ...object, pos: { ...object.pos } })),
        recipes: mergeById(s.recipes, layoutRecipes),
        items: mergeById(s.items, layoutItems),
        selectedId: null,
        selectedIds: [],
        buildType: null,
        ghost: emptyGhost,
        ghostPath: [],
        ghostPathValid: [],
        simSnapshot: emptySnapshot,
        simPlaying: false,
        simResetTick: s.simResetTick + 1,
        ...historyFlags(),
      }
    }),
  })
})

// Browser regressions must mutate the exact store instance already subscribed
// by React. Vite can otherwise hand a late dynamic import a newer HMR module
// instance. This bridge is development-only and is absent from production.
if (typeof window !== 'undefined' && import.meta.env.DEV) {
  ;(window as Window & { __FORGEMIND_DEV_STORE__?: typeof useForgeMindStore }).__FORGEMIND_DEV_STORE__ = useForgeMindStore
}
