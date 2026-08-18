import { createEmptyProjectData } from '../data/emptyProject'
import type {
  ActivityEvent,
  FactoryObject,
  InventoryRecord,
  Item,
  MetricSample,
  PersistedForgeState,
  Recipe,
  SimulationState,
} from '../types'
import { ApiError, apiRequest, getAccessToken } from './apiClient'
import { authRepository } from './authRepository'

export const FACTORY_STORAGE_KEY = 'forgecore.factory.workspace.v1'
export const UI_PAGE_STORAGE_KEY = 'forgecore.ui.last-page.v1'
export const REMOTE_FACTORY_STORAGE_KEY = 'forgecore.factory.remote-id.v1'

export type RepositoryResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string }

interface ApiFactoryBrief {
  id: string
  name: string
  width_m: number
  length_m: number
  grid_size_m: number
  schema_version: number
  created_at: string
  updated_at: string
}

interface ApiFactorySnapshot {
  factory: ApiFactoryBrief
  floors: Array<{ id: string; factory_id: string; level: number; name: string; elevation_m: number; height_m: number }>
  objects: Array<{
    id: string; factory_id: string; floor_id: string; kind: FactoryObject['kind']; name: string; model_ref: string | null
    transform_x: number; transform_z: number; transform_rotation_y: number; footprint_width: number; footprint_depth: number
    status: FactoryObject['status']; config: FactoryObject['config']; created_at: string; updated_at: string
  }>
  items: Array<{
    id: string; code: string; name: string; category: Item['category']; description: string; item_model_id: string
    model_parameters: Item['modelParameters']; icon: string | null; mass_kg: number; max_stack_size: number
  }>
  recipes: Array<{
    id: string; code: string; name: string; description: string; inputs: Recipe['inputs']; outputs: Recipe['outputs']
    processing_time_sec: number; enabled: boolean
  }>
  inventory: Array<{
    id: string; location_type: InventoryRecord['locationType']; location_id: string; item_id: string; quantity: number
    initial_quantity: number; capacity: number; reserved_outbound_quantity: number; reserved_inbound_capacity: number
    infinite_supply: boolean
  }>
  simulation: {
    factory_id: string; status: SimulationState['status']; speed: SimulationState['speed']; elapsed_sim_sec: number
    tick_count: number; seed: number; accumulated_unstepped_sec: number; machine_runtime: SimulationState['machineRuntime']
    agv_runtime: SimulationState['agvRuntime']; drone_runtime: SimulationState['droneRuntime']
    transit_items: SimulationState['transitItems']; warehouse_dispatch_cooldown_sec_by_port: SimulationState['warehouseDispatchCooldownSecByPort']
    source_feed_cooldown_sec: number; next_transit_sequence: number; next_metric_sample_at_sec: number
    production_events_sec: number[]; completed_transport_durations_sec: number[]; total_finished: number
  }
  metrics: Array<{
    elapsed_sim_sec: number; throughput_per_min: number; work_in_progress: number; finished_goods: number
    machine_a_utilization: number; machine_b_utilization: number
  }>
  activities: Array<{
    id: string; elapsed_sim_sec: number; title: string; description: string; tone: ActivityEvent['tone']; object_id?: string | null
  }>
}

const getStorage = (): Storage | null => {
  if (typeof window === 'undefined' || !window.localStorage) return null
  return window.localStorage
}

const isPersistedState = (value: unknown): value is PersistedForgeState => {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<PersistedForgeState>
  return (
    candidate.persistenceSchemaVersion === 1
    && typeof candidate.savedAt === 'string'
    && Boolean(candidate.factory && typeof candidate.factory.id === 'string')
    && Array.isArray(candidate.floors)
    && Array.isArray(candidate.objects)
    && Array.isArray(candidate.items)
    && Array.isArray(candidate.recipes)
    && Array.isArray(candidate.inventory)
    && Array.isArray(candidate.transportCapabilities)
    && Boolean(candidate.simulation && typeof candidate.simulation === 'object')
    && Boolean(candidate.metrics && typeof candidate.metrics === 'object')
    && Array.isArray(candidate.metricSeries)
    && Array.isArray(candidate.activities)
  )
}

const clone = <T>(value: T): T => {
  if (typeof structuredClone === 'function') return structuredClone(value)
  return JSON.parse(JSON.stringify(value)) as T
}

const scopedKey = (baseKey: string): string | null => {
  const userId = authRepository.activeUserId()
  return userId ? `${baseKey}.${userId}` : null
}

const loadLocal = (): RepositoryResult<PersistedForgeState | null> => {
  const storage = getStorage()
  if (!storage) return { ok: true, value: null }
  try {
    const key = scopedKey(FACTORY_STORAGE_KEY)
    if (!key) return { ok: false, error: '请先登录，再读取工厂存档。' }
    const raw = storage.getItem(key)
    if (!raw) return { ok: true, value: null }
    const parsed: unknown = JSON.parse(raw)
    if (!isPersistedState(parsed)) return { ok: false, error: '本地工厂数据版本无法识别，已保留原数据供审查。' }
    return { ok: true, value: clone(parsed) }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? `读取本地工厂失败：${error.message}` : '读取本地工厂失败。' }
  }
}

const saveLocal = (snapshot: PersistedForgeState): RepositoryResult<string> => {
  const storage = getStorage()
  if (!storage) return { ok: false, error: '当前环境不支持本地持久化。' }
  try {
    const key = scopedKey(FACTORY_STORAGE_KEY)
    if (!key) return { ok: false, error: '请先登录，再保存工厂。' }
    storage.setItem(key, JSON.stringify(snapshot))
    return { ok: true, value: snapshot.savedAt }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? `保存工厂失败：${error.message}` : '保存工厂失败。' }
  }
}

const existsLocal = (): boolean => {
  try {
    const key = scopedKey(FACTORY_STORAGE_KEY)
    return key ? getStorage()?.getItem(key) !== null : false
  } catch {
    return false
  }
}

const getRemoteFactoryId = (): string | null => {
  const key = scopedKey(REMOTE_FACTORY_STORAGE_KEY)
  return key ? getStorage()?.getItem(key) ?? null : null
}

const setRemoteFactoryId = (factoryId: string | null) => {
  const key = scopedKey(REMOTE_FACTORY_STORAGE_KEY)
  if (!key) return
  if (factoryId) getStorage()?.setItem(key, factoryId)
  else getStorage()?.removeItem(key)
}

const toSyncPayload = (snapshot: PersistedForgeState) => ({
  name: snapshot.factory.name,
  width_m: snapshot.factory.widthM,
  length_m: snapshot.factory.lengthM,
  grid_size_m: snapshot.factory.gridSizeM,
  schema_version: snapshot.factory.schemaVersion,
  floors: snapshot.floors.map((floor) => ({ id: floor.id, level: floor.level, name: floor.name, elevation_m: floor.elevationM, height_m: floor.heightM })),
  objects: snapshot.objects.map((object) => ({
    id: object.id,
    floor_id: object.floorId,
    kind: object.kind,
    name: object.name,
    model_ref: object.modelRef,
    transform_x: object.transform.x,
    transform_z: object.transform.z,
    transform_rotation_y: object.transform.rotationY,
    footprint_width: object.footprint.width,
    footprint_depth: object.footprint.depth,
    status: object.status,
    config: object.config,
  })),
  items: snapshot.items.map((item) => ({
    id: item.id, code: item.code, name: item.name, category: item.category, description: item.description,
    item_model_id: item.itemModelId, model_parameters: item.modelParameters, icon: item.icon,
    mass_kg: item.massKg, max_stack_size: item.maxStackSize,
  })),
  recipes: snapshot.recipes.map((recipe) => ({
    id: recipe.id, code: recipe.code, name: recipe.name, description: recipe.description,
    inputs: recipe.inputs, outputs: recipe.outputs, processing_time_sec: recipe.processingTimeSec, enabled: recipe.enabled,
  })),
  inventory: snapshot.inventory.map((record) => ({
    id: record.id, location_type: record.locationType, location_id: record.locationId, item_id: record.itemId,
    quantity: record.quantity, initial_quantity: record.initialQuantity, capacity: record.capacity,
    reserved_outbound_quantity: record.reservedOutboundQuantity, reserved_inbound_capacity: record.reservedInboundCapacity,
    infinite_supply: record.infiniteSupply ?? false,
  })),
  simulation: {
    status: snapshot.simulation.status,
    speed: snapshot.simulation.speed,
    elapsed_sim_sec: snapshot.simulation.elapsedSimSec,
    tick_count: snapshot.simulation.tickCount,
    seed: snapshot.simulation.seed,
    accumulated_unstepped_sec: snapshot.simulation.accumulatedUnsteppedSec,
    machine_runtime: snapshot.simulation.machineRuntime,
    agv_runtime: snapshot.simulation.agvRuntime,
    drone_runtime: snapshot.simulation.droneRuntime,
    transit_items: snapshot.simulation.transitItems,
    warehouse_dispatch_cooldown_sec_by_port: snapshot.simulation.warehouseDispatchCooldownSecByPort,
    source_feed_cooldown_sec: snapshot.simulation.sourceFeedCooldownSec,
    next_transit_sequence: snapshot.simulation.nextTransitSequence,
    next_metric_sample_at_sec: snapshot.simulation.nextMetricSampleAtSec,
    production_events_sec: snapshot.simulation.productionEventsSec,
    completed_transport_durations_sec: snapshot.simulation.completedTransportDurationsSec,
    total_finished: snapshot.simulation.totalFinished,
  },
  metrics: snapshot.metricSeries.map((sample) => ({
    elapsed_sim_sec: sample.elapsedSimSec, throughput_per_min: sample.throughputPerMin,
    work_in_progress: sample.workInProgress, finished_goods: sample.finishedGoods,
    machine_a_utilization: sample.machineAUtilization, machine_b_utilization: sample.machineBUtilization,
  })),
  activities: snapshot.activities.map((event) => ({
    id: event.id, elapsed_sim_sec: event.elapsedSimSec, title: event.title, description: event.description,
    tone: event.tone, object_id: event.objectId,
  })),
})

const fromApiSnapshot = (source: ApiFactorySnapshot): PersistedForgeState => {
  const base = createEmptyProjectData({
    factoryId: source.factory.id,
    floorId: source.floors[0]?.id,
    name: source.factory.name,
    widthM: source.factory.width_m,
    lengthM: source.factory.length_m,
    gridSizeM: source.factory.grid_size_m,
  })
  const metricSeries: MetricSample[] = source.metrics.map((sample) => ({
    elapsedSimSec: sample.elapsed_sim_sec,
    throughputPerMin: sample.throughput_per_min,
    workInProgress: sample.work_in_progress,
    finishedGoods: sample.finished_goods,
    machineAUtilization: sample.machine_a_utilization,
    machineBUtilization: sample.machine_b_utilization,
  }))
  const latest = metricSeries.at(-1)
  const machineIds = source.objects.filter((object) => object.kind === 'machine').map((object) => object.id)
  return {
    ...base,
    factory: {
      id: source.factory.id, name: source.factory.name, widthM: source.factory.width_m,
      lengthM: source.factory.length_m, gridSizeM: source.factory.grid_size_m,
      schemaVersion: source.factory.schema_version, createdAt: source.factory.created_at, updatedAt: source.factory.updated_at,
    },
    floors: source.floors.map((floor) => ({
      id: floor.id, factoryId: source.factory.id, level: floor.level, name: floor.name,
      elevationM: floor.elevation_m, heightM: floor.height_m,
    })),
    objects: source.objects.map((object) => ({
      id: object.id, factoryId: source.factory.id, floorId: object.floor_id, kind: object.kind, name: object.name,
      modelRef: object.model_ref,
      transform: { x: object.transform_x, z: object.transform_z, rotationY: object.transform_rotation_y as 0 | 90 | 180 | 270 },
      footprint: { width: object.footprint_width, depth: object.footprint_depth }, status: object.status,
      config: object.config, createdAt: object.created_at, updatedAt: object.updated_at,
    })),
    items: source.items.map((item) => ({
      id: item.id, code: item.code, name: item.name, category: item.category, description: item.description,
      itemModelId: item.item_model_id, modelParameters: item.model_parameters, icon: item.icon,
      massKg: item.mass_kg, maxStackSize: item.max_stack_size,
    })),
    recipes: source.recipes.map((recipe) => ({
      id: recipe.id, code: recipe.code, name: recipe.name, description: recipe.description,
      inputs: recipe.inputs, outputs: recipe.outputs, processingTimeSec: recipe.processing_time_sec, enabled: recipe.enabled,
    })),
    inventory: source.inventory.map((record) => ({
      id: record.id, locationType: record.location_type, locationId: record.location_id, itemId: record.item_id,
      quantity: record.quantity, initialQuantity: record.initial_quantity, capacity: record.capacity,
      reservedOutboundQuantity: record.reserved_outbound_quantity, reservedInboundCapacity: record.reserved_inbound_capacity,
      infiniteSupply: record.infinite_supply,
    })),
    simulation: {
      id: `simulation-${source.factory.id}`, factoryId: source.factory.id, status: source.simulation.status,
      speed: source.simulation.speed, elapsedSimSec: source.simulation.elapsed_sim_sec, tickCount: source.simulation.tick_count,
      seed: source.simulation.seed, accumulatedUnsteppedSec: source.simulation.accumulated_unstepped_sec,
      machineRuntime: source.simulation.machine_runtime, agvRuntime: source.simulation.agv_runtime,
      droneRuntime: source.simulation.drone_runtime, transitItems: source.simulation.transit_items,
      warehouseDispatchCooldownSecByPort: source.simulation.warehouse_dispatch_cooldown_sec_by_port,
      sourceFeedCooldownSec: source.simulation.source_feed_cooldown_sec,
      nextTransitSequence: source.simulation.next_transit_sequence, nextMetricSampleAtSec: source.simulation.next_metric_sample_at_sec,
      productionEventsSec: source.simulation.production_events_sec,
      completedTransportDurationsSec: source.simulation.completed_transport_durations_sec,
      totalFinished: source.simulation.total_finished,
    },
    metrics: {
      ...base.metrics,
      currentThroughputPerMin: latest?.throughputPerMin ?? 0,
      totalProduced: source.simulation.total_finished,
      workInProgress: latest?.workInProgress ?? 0,
      inventoryTotal: source.inventory.reduce((sum, record) => sum + record.quantity, 0),
      machineUtilization: {
        ...(machineIds[0] ? { [machineIds[0]]: latest?.machineAUtilization ?? 0 } : {}),
        ...(machineIds[1] ? { [machineIds[1]]: latest?.machineBUtilization ?? 0 } : {}),
      },
    },
    metricSeries,
    activities: source.activities.map((event) => ({
      id: event.id, elapsedSimSec: event.elapsed_sim_sec, title: event.title, description: event.description, tone: event.tone,
      ...(event.object_id ? { objectId: event.object_id } : {}),
    })),
    persistenceSchemaVersion: 1,
    savedAt: source.factory.updated_at,
  }
}

export const factoryRepository = {
  async load(): Promise<RepositoryResult<PersistedForgeState | null>> {
    if (!getAccessToken()) return loadLocal()
    try {
      const factories = await apiRequest<ApiFactoryBrief[]>('/api/factories')
      if (factories.length === 0) return { ok: true, value: null }
      const selectedId = getRemoteFactoryId()
      const factoryId = factories.some((factory) => factory.id === selectedId) ? selectedId! : factories[0].id
      setRemoteFactoryId(factoryId)
      const snapshot = fromApiSnapshot(await apiRequest<ApiFactorySnapshot>(`/api/factories/${encodeURIComponent(factoryId)}`))
      saveLocal(snapshot)
      return { ok: true, value: snapshot }
    } catch (error) {
      if (error instanceof ApiError && error.unavailable) return loadLocal()
      return { ok: false, error: error instanceof Error ? `读取后端工厂失败：${error.message}` : '读取后端工厂失败。' }
    }
  },

  async save(snapshot: PersistedForgeState): Promise<RepositoryResult<string>> {
    if (!getAccessToken()) return saveLocal(snapshot)
    try {
      let factoryId = getRemoteFactoryId()
      if (!factoryId) {
        const created = await apiRequest<ApiFactoryBrief>('/api/factories', {
          method: 'POST',
          body: JSON.stringify({
            name: snapshot.factory.name, width_m: snapshot.factory.widthM,
            length_m: snapshot.factory.lengthM, grid_size_m: snapshot.factory.gridSizeM,
          }),
        })
        factoryId = created.id
        setRemoteFactoryId(factoryId)
      }
      await apiRequest<ApiFactorySnapshot>(`/api/factories/${encodeURIComponent(factoryId)}/sync`, {
        method: 'PUT', body: JSON.stringify(toSyncPayload(snapshot)),
      })
      saveLocal(snapshot)
      return { ok: true, value: snapshot.savedAt }
    } catch (error) {
      if (error instanceof ApiError && error.unavailable) return saveLocal(snapshot)
      return { ok: false, error: error instanceof Error ? `保存到后端失败：${error.message}` : '保存到后端失败。' }
    }
  },

  clear(): RepositoryResult<null> {
    const storage = getStorage()
    if (!storage) return { ok: true, value: null }
    try {
      const key = scopedKey(FACTORY_STORAGE_KEY)
      if (key) storage.removeItem(key)
      return { ok: true, value: null }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? `清理本地工厂失败：${error.message}` : '清理本地工厂失败。' }
    }
  },

  async exists(): Promise<boolean> {
    if (!getAccessToken()) return existsLocal()
    try {
      const factories = await apiRequest<ApiFactoryBrief[]>('/api/factories')
      if (factories.length > 0 && !getRemoteFactoryId()) setRemoteFactoryId(factories[0].id)
      return factories.length > 0
    } catch {
      return existsLocal()
    }
  },

  prepareNewFactory(): void {
    setRemoteFactoryId(null)
  },

  activeRemoteFactoryId(): string | null {
    return getRemoteFactoryId()
  },
}

export const uiPreferenceRepository = {
  loadPage<T extends string>(allowed: readonly T[], fallback: T): T {
    const storage = getStorage()
    if (!storage) return fallback
    try {
      const key = scopedKey(UI_PAGE_STORAGE_KEY)
      if (!key) return fallback
      const page = storage.getItem(key)
      return page && allowed.includes(page as T) ? page as T : fallback
    } catch {
      return fallback
    }
  },

  savePage(page: string): void {
    const storage = getStorage()
    if (!storage) return
    try {
      const key = scopedKey(UI_PAGE_STORAGE_KEY)
      if (key) storage.setItem(key, page)
    } catch {
      // UI preference persistence is best-effort and never blocks factory work.
    }
  },
}
