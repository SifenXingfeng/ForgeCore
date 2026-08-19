import { create } from 'zustand'
import { createEmptyProjectData, createEmptySimulation } from '../data/emptyProject'
import { getRuntimeItemModelDefinition, normalizeModelParameterOverrides } from '../data/itemModelRuntime'
import { factoryRepository } from '../repository/factoryRepository'
import { AGV_NAVIGATION_CLEARANCE_M, AGV_VEHICLE_SEPARATION_M, findAgvYieldPath, findShortestAgvPath, findShortestAgvPathToPoint, type AgvDynamicObstacle, type AgvNavigationPoint } from '../domain/agvPathfinding'
import { DRONE_INITIAL_HOVER_M, DRONE_VEHICLE_SEPARATION_M, droneDockingPoint, droneDockingPoints, findShortestDronePath, type DroneDockingRole, type DroneDynamicObstacle } from '../domain/dronePathfinding'
import { MACHINE_PORT_INDICES, SHELF_LAYOUT, alignPathToPorts, buildOrthogonalConnectorPath, buildOrthogonalPath, compactPath, conveyorEndpointFloorId, conveyorPortAnchor, conveyorSpatialLength, facilityCenter, inclineHorizontalRun, polylineLength, supportsTripleConveyorPorts, type GridFacilityBounds, type GridPoint, type MachinePortIndex } from '../domain/conveyorPath'
import { conveyorPlacementBlocked, facilityPlacementBlocked } from '../domain/placementCollision'
import { advanceSimulation, type AdvanceSimulationKernel } from '../domain/advanceSimulation'
import type {
  ActivityEvent,
  AgvProgram,
  AgvRuntimeState,
  DroneNavigationPoint,
  DroneRuntimeState,
  Factory,
  FactoryMetrics,
  FactoryObject,
  FactoryObjectKind,
  FactoryObjectConfig,
  Floor,
  ForgeProjectData,
  GridTransform,
  Id,
  InventoryRecord,
  Item,
  MachineRuntimeState,
  MetricSample,
  NewFactoryObject,
  PersistedForgeState,
  Recipe,
  RackObjectConfig,
  SaveStatus,
  SimulationSpeed,
  SimulationState,
  ToastMessage,
  TransitItem,
  VehicleObjectConfig,
  WarehouseDispatchIntervalsSec,
} from '../types'

const STEP_SECONDS = 0.25
const DEFAULT_WAREHOUSE_DISPATCH_INTERVAL_SECONDS = 2.5
const MIN_WAREHOUSE_DISPATCH_INTERVAL_SECONDS = 0.25
const MAX_WAREHOUSE_DISPATCH_INTERVAL_SECONDS = 60
const MAX_ACTIVITY_EVENTS = 80
const MAX_METRIC_SAMPLES = 240
const DEFAULT_FLOOR_HEIGHT_M = 4.5
const DEFAULT_MACHINE_MODEL_REF = 'assets/3d/vendor/kenney-factory-kit-3.0/Models/GLB format/machine-fortified.glb'
const DEFAULT_WAREHOUSE_MODEL_REF = 'assets/3d/vendor/kenney-factory-kit-3.0/Models/GLB format/machine-window.glb'
const DEFAULT_SHELF_MODEL_REF = 'assets/3d/vendor/mastjie-low-poly-warehouse-kit/glb/rack.glb'
const UNBOUNDED_STORAGE_CAPACITY = Number.MAX_SAFE_INTEGER
const DEFAULT_AGV_SPEED_MPS = 2
const DEFAULT_AGV_MAX_PAYLOAD_KG = 500
const DEFAULT_AGV_LOAD_QUANTITY = 10
const AGV_DYNAMIC_REPLAN_INTERVAL_TICKS = 8
const AGV_BLOCKED_RETRY_INTERVAL_TICKS = 20
const AGV_DOCK_WAIT_RADIUS_M = AGV_VEHICLE_SEPARATION_M * 2 + 1
const AGV_DOCK_EGRESS_DISTANCE_M = AGV_VEHICLE_SEPARATION_M + 1
const DEFAULT_DRONE_SPEED_MPS = 4
const DEFAULT_DRONE_MAX_PAYLOAD_KG = 30
const DEFAULT_DRONE_LOAD_QUANTITY = 3
const DRONE_DYNAMIC_REPLAN_INTERVAL_TICKS = 8
const DRONE_BLOCKED_RETRY_INTERVAL_TICKS = 20
const DRONE_DOCK_WAIT_RADIUS_M = DRONE_VEHICLE_SEPARATION_M * 2 + 1
const DRONE_DOCK_EGRESS_DISTANCE_M = DRONE_VEHICLE_SEPARATION_M + 1

const deepClone = <T>(value: T): T => {
  if (typeof structuredClone === 'function') return structuredClone(value)
  return JSON.parse(JSON.stringify(value)) as T
}

let idSequence = 1
const createId = (prefix: string): string => `${prefix}-${Date.now().toString(36)}-${(idSequence++).toString(36)}`

const nowIso = (): string => new Date().toISOString()

const bumpDesignVersion = (factory: Factory): Factory => ({
  ...factory,
  designVersion: Math.max(1, Number(factory.designVersion) || 1) + 1,
  updatedAt: nowIso(),
})

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value))

const sumRecord = (record: Record<Id, number>): number =>
  Object.values(record).reduce((sum, value) => sum + value, 0)

const getRecipe = (recipes: Recipe[], id: Id): Recipe | undefined => recipes.find((recipe) => recipe.id === id)

const getMachineObject = (objects: FactoryObject[], id: Id): FactoryObject | undefined =>
  objects.find((object) => object.id === id && object.kind === 'machine')

const getConveyor = (objects: FactoryObject[], id: Id): FactoryObject | undefined =>
  objects.find((object) => object.id === id && object.kind === 'conveyor')

const getMachineConfig = (object: FactoryObject | undefined) =>
  object?.config.kind === 'machine' ? object.config : undefined

const getConveyorConfig = (object: FactoryObject | undefined) =>
  object?.config.kind === 'conveyor' ? object.config : undefined

const getWarehouseConfig = (object: FactoryObject | undefined) =>
  object?.config.kind === 'rack' ? object.config : undefined

const isStorageObject = (object: FactoryObject | undefined): object is FactoryObject =>
  object?.kind === 'rack' || object?.kind === 'shelf'

const warehouseCapacity = (object: FactoryObject | undefined): number => {
  if (object?.config.kind === 'shelf') return UNBOUNDED_STORAGE_CAPACITY
  const config = getWarehouseConfig(object)
  return config ? Math.max(1, config.slotCount * config.slotCapacity) : 0
}

const normalizeWarehouseDispatchInterval = (value: unknown): number => clamp(
  Number(value) || DEFAULT_WAREHOUSE_DISPATCH_INTERVAL_SECONDS,
  MIN_WAREHOUSE_DISPATCH_INTERVAL_SECONDS,
  MAX_WAREHOUSE_DISPATCH_INTERVAL_SECONDS,
)

const warehouseDispatchIntervalsFromConfig = (config: RackObjectConfig | undefined): WarehouseDispatchIntervalsSec => {
  const legacyInterval = config?.dispatchIntervalSec
  return MACHINE_PORT_INDICES.map((portIndex) => normalizeWarehouseDispatchInterval(
    config?.dispatchIntervalSecByPort?.[portIndex] ?? legacyInterval,
  )) as WarehouseDispatchIntervalsSec
}

const normalizeWarehouseConfig = (config: RackObjectConfig): RackObjectConfig => {
  const { dispatchIntervalSec: _legacyInterval, ...current } = config
  void _legacyInterval
  return {
    ...current,
    dispatchIntervalSecByPort: warehouseDispatchIntervalsFromConfig(config),
  }
}

const warehouseDispatchInterval = (object: FactoryObject | undefined, portIndex: MachinePortIndex): number => {
  const config = object?.config.kind === 'rack' ? object.config : undefined
  return clamp(
    warehouseDispatchIntervalsFromConfig(config)[portIndex],
    MIN_WAREHOUSE_DISPATCH_INTERVAL_SECONDS,
    MAX_WAREHOUSE_DISPATCH_INTERVAL_SECONDS,
  )
}

const isWarehouseRecord = (record: InventoryRecord, warehouseId: Id): boolean =>
  record.locationType === 'rack-slot' && record.locationId.startsWith(`${warehouseId}:`)

const createWarehouseInventoryRecord = (warehouseId: Id, itemId: Id, capacity: number): InventoryRecord => ({
  id: `inventory-${warehouseId}-${itemId}`,
  locationType: 'rack-slot',
  locationId: `${warehouseId}:bulk`,
  itemId,
  quantity: 0,
  initialQuantity: 0,
  capacity,
  reservedOutboundQuantity: 0,
  reservedInboundCapacity: 0,
  infiniteSupply: false,
})

const reservedOutboundQuantity = (record: InventoryRecord): number => Math.max(0, Number(record.reservedOutboundQuantity) || 0)
const reservedInboundCapacity = (record: InventoryRecord): number => Math.max(0, Number(record.reservedInboundCapacity) || 0)

const isAvailableWarehouseStock = (record: InventoryRecord): boolean =>
  record.quantity - reservedOutboundQuantity(record) > 0 || record.infiniteSupply === true

const rebuildDirectionalInventoryReservations = (
  inventory: InventoryRecord[],
  simulation: SimulationState,
  force = false,
): void => {
  const needsMigration = force || inventory.some((record) => (
    !Number.isFinite(record.reservedOutboundQuantity)
    || !Number.isFinite(record.reservedInboundCapacity)
    || record.reservedQuantity != null
  ))
  if (!needsMigration) return

  inventory.forEach((record) => {
    record.reservedOutboundQuantity = 0
    record.reservedInboundCapacity = 0
    delete record.reservedQuantity
  })
  const rebuildRuntime = (runtime: AgvRuntimeState | DroneRuntimeState) => {
    const quantity = Math.max(0, Math.trunc(Number(runtime.reservedQuantity) || 0))
    if (quantity <= 0) return
    const source = runtime.sourceInventoryRecordId
      ? inventory.find((record) => record.id === runtime.sourceInventoryRecordId)
      : undefined
    const destination = runtime.destinationInventoryRecordId
      ? inventory.find((record) => record.id === runtime.destinationInventoryRecordId)
      : undefined
    if (source && !source.infiniteSupply && runtime.cargoQuantity <= 0) {
      source.reservedOutboundQuantity += quantity
    }
    if (destination) destination.reservedInboundCapacity += quantity
  }
  Object.values(simulation.agvRuntime ?? {}).forEach(rebuildRuntime)
  Object.values(simulation.droneRuntime ?? {}).forEach(rebuildRuntime)
}

const defaultAgvProgram = (): AgvProgram => ({
  enabled: false,
  sourceObjectId: null,
  destinationObjectId: null,
  itemId: null,
  loadQuantity: DEFAULT_AGV_LOAD_QUANTITY,
  triggerLocation: 'always',
  triggerComparator: 'at-least',
  triggerQuantity: 1,
})

const defaultDroneProgram = (): AgvProgram => ({
  ...defaultAgvProgram(),
  loadQuantity: DEFAULT_DRONE_LOAD_QUANTITY,
})

const normalizeAgvProgram = (program?: Partial<AgvProgram>): AgvProgram => ({
  enabled: program?.enabled === true,
  sourceObjectId: program?.sourceObjectId ?? null,
  destinationObjectId: program?.destinationObjectId ?? null,
  itemId: program?.itemId ?? null,
  loadQuantity: Math.max(1, Math.min(1000, Math.trunc(Number(program?.loadQuantity) || DEFAULT_AGV_LOAD_QUANTITY))),
  triggerLocation: program?.triggerLocation === 'source' || program?.triggerLocation === 'destination'
    ? program.triggerLocation
    : 'always',
  triggerComparator: program?.triggerComparator === 'at-most' ? 'at-most' : 'at-least',
  triggerQuantity: Math.max(0, Math.min(Number.MAX_SAFE_INTEGER, Math.trunc(Number(program?.triggerQuantity) || 0))),
})

const getVehicleConfig = (object: FactoryObject | undefined): VehicleObjectConfig | undefined =>
  object?.config.kind === 'vehicle' ? object.config : undefined

const getAgvProgram = (object: FactoryObject | undefined): AgvProgram | undefined => {
  const config = getVehicleConfig(object)
  return config?.vehicleType === 'agv' ? normalizeAgvProgram(config.agvProgram) : undefined
}

const getDroneProgram = (object: FactoryObject | undefined): AgvProgram | undefined => {
  const config = getVehicleConfig(object)
  return config?.vehicleType === 'drone' ? normalizeAgvProgram(config.transportProgram ?? defaultDroneProgram()) : undefined
}

const ensureWarehouseInventoryRecords = (
  inventory: InventoryRecord[],
  objects: FactoryObject[],
  items: Item[],
): InventoryRecord[] => {
  const next = [...inventory]
  objects.filter(isStorageObject).forEach((warehouse) => {
    const capacity = warehouseCapacity(warehouse)
    items.forEach((item) => {
      if (!next.some((record) => isWarehouseRecord(record, warehouse.id) && record.itemId === item.id)) {
        next.push(createWarehouseInventoryRecord(warehouse.id, item.id, capacity))
      }
    })
  })
  return next
}

const objectBounds = (object: FactoryObject): GridFacilityBounds => ({
  x: object.transform.x,
  z: object.transform.z,
  width: object.footprint.width,
  depth: object.footprint.depth,
})

const normalizeFloors = (floors: Floor[], factoryId: Id): Floor[] => {
  const sorted = floors.length > 0
    ? [...floors].sort((left, right) => left.level - right.level)
    : [{ id: `floor-${factoryId}`, factoryId, level: 1, name: '1F 生产区', elevationM: 0, heightM: DEFAULT_FLOOR_HEIGHT_M }]
  let nextElevation = 0
  return sorted.map((floor, index) => {
    const heightM = clamp(Number(floor.heightM) || DEFAULT_FLOOR_HEIGHT_M, 2.5, 12)
    const elevationM = index === 0 ? 0 : Number.isFinite(floor.elevationM) ? floor.elevationM : nextElevation
    nextElevation = elevationM + heightM
    return {
      ...floor,
      factoryId,
      level: index + 1,
      name: floor.name?.trim() || `${index + 1}F 生产区`,
      elevationM,
      heightM,
    }
  })
}

const normalizeConveyorFloors = (objects: FactoryObject[]): FactoryObject[] => objects.map((object) => {
  if (object.config.kind !== 'conveyor') return object
  const fromFloorId = object.config.fromFloorId ?? object.floorId
  const toFloorId = object.config.toFloorId ?? object.floorId
  return {
    ...object,
    floorId: fromFloorId,
    config: {
      ...object.config,
      conveyorType: object.config.conveyorType === 'incline' && fromFloorId !== toFloorId ? 'incline' : 'flat',
      fromFloorId,
      toFloorId,
      riseM: fromFloorId === toFloorId ? 0 : Math.abs(Number(object.config.riseM) || DEFAULT_FLOOR_HEIGHT_M),
    },
  }
})

const createMachineRuntime = (machineObjectId: Id, recipe: Recipe): MachineRuntimeState => ({
  machineObjectId,
  recipeId: recipe.id,
  state: 'waiting-input',
  progress: 0,
  cycleRemainingSec: 0,
  inputBuffer: Object.fromEntries(recipe.inputs.map((line) => [line.itemId, 0])),
  outputBuffer: Object.fromEntries(recipe.outputs.map((line) => [line.itemId, 0])),
  processedCycles: 0,
  busySeconds: 0,
  idleSeconds: 0,
  blockedSeconds: 0,
})

const canFitAt = (
  object: Pick<FactoryObject, 'id' | 'floorId' | 'footprint' | 'kind'>,
  x: number,
  z: number,
  factory: Factory,
  objects: FactoryObject[],
): boolean => {
  if (object.kind === 'conveyor') return true
  const minX = x
  const minZ = z
  const maxX = x + object.footprint.width
  const maxZ = z + object.footprint.depth
  if (minX < 0 || minZ < 0 || maxX > factory.widthM || maxZ > factory.lengthM) return false

  return !facilityPlacementBlocked({ x, z, width: object.footprint.width, depth: object.footprint.depth }, object.floorId, objects, object.id)
}

const connectionPathFor = (
  fromObject: FactoryObject,
  toObject: FactoryObject,
  fromPortIndex: MachinePortIndex = 1,
  toPortIndex: MachinePortIndex = 1,
): Array<{ x: number; z: number }> => {
  const fromCenter = facilityCenter(objectBounds(fromObject))
  const toCenter = facilityCenter(objectBounds(toObject))
  return buildOrthogonalConnectorPath(
    conveyorPortAnchor(fromObject, 'output', toCenter, fromPortIndex),
    conveyorPortAnchor(toObject, 'input', fromCenter, toPortIndex),
  )
}

const normalizePortFacilities = (objects: FactoryObject[], factory: Factory): FactoryObject[] => {
  const gridSize = Math.max(0.25, factory.gridSizeM)
  const snap = (value: number) => Math.round(value / gridSize) * gridSize
  return objects.map((object) => {
    if (!supportsTripleConveyorPorts(object) && object.kind !== 'shelf') return object
    const center = facilityCenter(objectBounds(object))
    const shelfQuarterTurn = object.kind === 'shelf' && (object.transform.rotationY === 90 || object.transform.rotationY === 270)
    const width = object.kind === 'shelf' ? (shelfQuarterTurn ? SHELF_LAYOUT.depthM : SHELF_LAYOUT.widthM) : 6
    const depth = object.kind === 'shelf' ? (shelfQuarterTurn ? SHELF_LAYOUT.widthM : SHELF_LAYOUT.depthM) : 6
    const nextX = clamp(snap(center.x) - width / 2, 0, Math.max(0, factory.widthM - width))
    const nextZ = clamp(snap(center.z) - depth / 2, 0, Math.max(0, factory.lengthM - depth))
    const modelRef = object.kind === 'machine'
      ? DEFAULT_MACHINE_MODEL_REF
      : object.kind === 'shelf'
        ? DEFAULT_SHELF_MODEL_REF
        : DEFAULT_WAREHOUSE_MODEL_REF
    const config: FactoryObjectConfig = object.config.kind === 'machine'
      ? { ...object.config, inputPortCount: 3, outputPortCount: 3, inputCapacity: Math.max(12, object.config.inputCapacity), outputCapacity: Math.max(12, object.config.outputCapacity) }
      : object.config.kind === 'rack'
        ? {
            ...normalizeWarehouseConfig(object.config),
            slotCount: Math.max(18, object.config.slotCount),
            slotCapacity: Math.max(100, object.config.slotCapacity),
            runtimeAssetStatus: 'vendor-visual',
            inputPortCount: 3,
            outputPortCount: 3,
          }
        : object.config.kind === 'shelf'
          ? {
              ...object.config,
              storageType: 'unbounded',
              runtimeAssetStatus: 'vendor-visual',
            }
        : object.config
    return {
      ...object,
      modelRef,
      transform: { ...object.transform, x: nextX, z: nextZ },
      footprint: { width, depth },
      config,
    }
  })
}

const normalizeAgvObjects = (objects: FactoryObject[], factory: Factory): FactoryObject[] => {
  const gridSize = Math.max(0.25, factory.gridSizeM)
  const snap = (value: number) => Math.round(value / gridSize) * gridSize
  return objects.map((object) => {
    if (object.kind === 'drone') {
      const previous = object.config.kind === 'vehicle' ? object.config : undefined
      return {
        ...object,
        status: object.status === 'planned' ? 'ready' : object.status,
        config: {
          kind: 'vehicle',
          vehicleType: 'drone',
          capabilityId: 'capability-drone',
          runtimeAssetStatus: previous?.runtimeAssetStatus ?? 'vendor-only',
          maxPayloadKg: Math.max(1, Number(previous?.maxPayloadKg) || DEFAULT_DRONE_MAX_PAYLOAD_KG),
          speedMps: clamp(Number(previous?.speedMps) || DEFAULT_DRONE_SPEED_MPS, 0.5, 12),
          batteryLevelPercent: previous?.batteryLevelPercent ?? null,
          transportProgram: normalizeAgvProgram(previous?.transportProgram ?? defaultDroneProgram()),
        } satisfies VehicleObjectConfig,
      }
    }
    if (object.kind !== 'agv') return object
    const oldCenter = facilityCenter(objectBounds(object))
    const width = 4
    const depth = 4
    const x = clamp(snap(oldCenter.x) - width / 2, 0, Math.max(0, factory.widthM - width))
    const z = clamp(snap(oldCenter.z) - depth / 2, 0, Math.max(0, factory.lengthM - depth))
    const previous = object.config.kind === 'vehicle' ? object.config : undefined
    return {
      ...object,
      transform: { ...object.transform, x, z },
      footprint: { width, depth },
      status: object.status === 'planned' ? 'ready' : object.status,
      config: {
        kind: 'vehicle',
        vehicleType: 'agv',
        capabilityId: 'capability-agv',
        runtimeAssetStatus: previous?.runtimeAssetStatus ?? 'vendor-only',
        maxPayloadKg: Math.max(1, Number(previous?.maxPayloadKg) || DEFAULT_AGV_MAX_PAYLOAD_KG),
        speedMps: clamp(Number(previous?.speedMps) || DEFAULT_AGV_SPEED_MPS, 0.25, 6),
        batteryLevelPercent: previous?.batteryLevelPercent ?? null,
        agvProgram: normalizeAgvProgram(previous?.agvProgram),
      } satisfies VehicleObjectConfig,
    }
  })
}

const normalizeConnectionPorts = (objects: FactoryObject[]): FactoryObject[] => {
  const usedInputs = new Map<Id, Set<MachinePortIndex>>()
  const usedOutputs = new Map<Id, Set<MachinePortIndex>>()
  const portFacilityIds = new Set(objects.filter(supportsTripleConveyorPorts).map((object) => object.id))
  const shelfIds = new Set(objects.filter((object) => object.kind === 'shelf').map((object) => object.id))
  const reserve = (map: Map<Id, Set<MachinePortIndex>>, facilityId: Id, preferred: MachinePortIndex | null | undefined) => {
    const used = map.get(facilityId) ?? new Set<MachinePortIndex>()
    const validPreferred = preferred != null && MACHINE_PORT_INDICES.includes(preferred) && !used.has(preferred) ? preferred : null
    const selected = validPreferred ?? MACHINE_PORT_INDICES.find((index) => !used.has(index)) ?? null
    if (selected != null) used.add(selected)
    map.set(facilityId, used)
    return selected
  }

  return objects.map((object) => {
    if (object.config.kind !== 'conveyor') return object
    const originalFromObjectId = shelfIds.has(object.config.fromObjectId ?? '') ? null : object.config.fromObjectId
    const originalToObjectId = shelfIds.has(object.config.toObjectId ?? '') ? null : object.config.toObjectId
    const fromPortIndex = originalFromObjectId && portFacilityIds.has(originalFromObjectId)
      ? reserve(usedOutputs, originalFromObjectId, object.config.fromPortIndex)
      : null
    const toPortIndex = originalToObjectId && originalToObjectId !== 'finished-goods' && portFacilityIds.has(originalToObjectId)
      ? reserve(usedInputs, originalToObjectId, object.config.toPortIndex)
      : null
    const fromObjectId = originalFromObjectId && portFacilityIds.has(originalFromObjectId) && fromPortIndex == null
      ? null
      : originalFromObjectId
    const toObjectId = originalToObjectId && originalToObjectId !== 'finished-goods' && portFacilityIds.has(originalToObjectId) && toPortIndex == null
      ? null
      : originalToObjectId
    return {
      ...object,
      config: {
        ...object.config,
        fromObjectId,
        toObjectId,
        fromPortIndex,
        toPortIndex,
        outputItemId: object.config.outputItemId ?? null,
      },
    }
  })
}

const isPortOccupied = (
  objects: FactoryObject[],
  facilityId: Id,
  role: 'input' | 'output',
  portIndex: MachinePortIndex,
  excludeConveyorId = '',
): boolean => objects.some((object) => {
  if (object.id === excludeConveyorId || object.config.kind !== 'conveyor') return false
  return role === 'output'
    ? object.config.fromObjectId === facilityId && (object.config.fromPortIndex ?? 1) === portIndex
    : object.config.toObjectId === facilityId && (object.config.toPortIndex ?? 1) === portIndex
})

const firstAvailablePort = (
  objects: FactoryObject[],
  facilityId: Id,
  role: 'input' | 'output',
): MachinePortIndex | null => MACHINE_PORT_INDICES.find((portIndex) => !isPortOccupied(objects, facilityId, role, portIndex)) ?? null

const automaticOutputItemId = (
  source: FactoryObject | undefined,
  objects: FactoryObject[],
  recipes: Recipe[],
  inventory: InventoryRecord[],
): Id | null => {
  const visited = new Set<Id>()
  while (source?.config.kind === 'conveyor' && source.config.fromObjectId && !visited.has(source.id)) {
    visited.add(source.id)
    if (source.config.outputItemId) return source.config.outputItemId
    const upstreamId = source.config.fromObjectId
    source = objects.find((object) => object.id === upstreamId)
  }
  const config = getMachineConfig(source)
  const recipe = config?.recipeId ? getRecipe(recipes, config.recipeId) : undefined
  if (recipe?.outputs.length === 1) return recipe.outputs[0].itemId
  if (source?.kind !== 'rack') return null
  const stockedItems = inventory.filter((record) => isWarehouseRecord(record, source.id) && isAvailableWarehouseStock(record))
  return stockedItems.length === 1 ? stockedItems[0].itemId : null
}

const refreshConnectionPaths = (objects: FactoryObject[]): FactoryObject[] => objects.map((object) => {
  if (object.config.kind !== 'conveyor' || (!object.config.fromObjectId && !object.config.toObjectId)) return object
  const config = object.config
  const fromObject = objects.find((candidate) => candidate.id === config.fromObjectId)
  const toObject = config.toObjectId === 'finished-goods' ? undefined : objects.find((candidate) => candidate.id === config.toObjectId)
  if (!fromObject && !toObject) return object
  const fromCenter = fromObject && fromObject.config.kind !== 'conveyor' ? facilityCenter(objectBounds(fromObject)) : undefined
  const toCenter = toObject && toObject.config.kind !== 'conveyor' ? facilityCenter(objectBounds(toObject)) : undefined
  const start = fromObject
    ? fromObject.config.kind === 'conveyor'
      ? fromObject.config.path.at(-1) ?? null
      : conveyorPortAnchor(fromObject, 'output', config.path[1] ?? toCenter ?? config.path.at(-1)!, config.fromPortIndex ?? 1)
    : null
  const end = toObject
    ? toObject.config.kind === 'conveyor'
      ? toObject.config.path[0] ?? null
      : conveyorPortAnchor(toObject, 'input', config.path.at(-2) ?? fromCenter ?? config.path[0], config.toPortIndex ?? 1)
    : null
  const path = alignPathToPorts(config.path, start, end)
  if (path.length < 2) return object
  return {
    ...object,
    transform: {
      ...object.transform,
      x: (path[0].x + path[1].x) / 2,
      z: (path[0].z + path[1].z) / 2,
    },
    footprint: { width: Math.max(1, Math.abs(path[1].x - path[0].x)), depth: Math.max(1, Math.abs(path[1].z - path[0].z)) },
    config: { ...config, path },
    updatedAt: nowIso(),
  }
})

const defaultConfigForKind = (kind: NewFactoryObject['kind']): FactoryObjectConfig => {
  switch (kind) {
    case 'machine':
      return {
        kind: 'machine',
        recipeId: null,
        inputCapacity: 12,
        outputCapacity: 12,
        speedMultiplier: 1,
        inputPortCount: 3,
        outputPortCount: 3,
      }
    case 'conveyor':
      return {
        kind: 'conveyor',
        fromObjectId: null,
        toObjectId: null,
        fromPortIndex: null,
        toPortIndex: null,
        outputItemId: null,
        speedMps: 1,
        capacity: 4,
        path: [],
      }
    case 'rack':
      return {
        kind: 'rack',
        slotCount: 18,
        slotCapacity: 100,
        dispatchIntervalSecByPort: [
          DEFAULT_WAREHOUSE_DISPATCH_INTERVAL_SECONDS,
          DEFAULT_WAREHOUSE_DISPATCH_INTERVAL_SECONDS,
          DEFAULT_WAREHOUSE_DISPATCH_INTERVAL_SECONDS,
        ],
        storageType: 'mixed',
        runtimeAssetStatus: 'vendor-visual',
        inputPortCount: 3,
        outputPortCount: 3,
      }
    case 'shelf':
      return {
        kind: 'shelf',
        storageType: 'unbounded',
        runtimeAssetStatus: 'vendor-visual',
      }
    case 'agv':
      return {
        kind: 'vehicle',
        vehicleType: 'agv',
        capabilityId: 'capability-agv',
        runtimeAssetStatus: 'vendor-only',
        maxPayloadKg: DEFAULT_AGV_MAX_PAYLOAD_KG,
        speedMps: DEFAULT_AGV_SPEED_MPS,
        batteryLevelPercent: null,
        agvProgram: defaultAgvProgram(),
      }
    case 'drone':
      return {
        kind: 'vehicle',
        vehicleType: 'drone',
        capabilityId: 'capability-drone',
        runtimeAssetStatus: 'vendor-only',
        maxPayloadKg: DEFAULT_DRONE_MAX_PAYLOAD_KG,
        speedMps: DEFAULT_DRONE_SPEED_MPS,
        batteryLevelPercent: null,
        transportProgram: defaultDroneProgram(),
      }
    default:
      return { kind: 'buffer', capacity: 20 }
  }
}

const defaultFootprint = (kind: NewFactoryObject['kind']) => {
  switch (kind) {
    case 'machine':
      return { width: 6, depth: 6 }
    case 'rack':
      return { width: 6, depth: 6 }
    case 'shelf':
      return { width: SHELF_LAYOUT.widthM, depth: SHELF_LAYOUT.depthM }
    case 'conveyor':
      return { width: 1, depth: 1 }
    case 'drone':
      return { width: 3, depth: 3 }
    case 'agv':
      return { width: 4, depth: 4 }
    default:
      return { width: 2, depth: 2 }
  }
}

const materializeAgentObject = (
  raw: Record<string, unknown>,
  factoryId: Id,
  floors: Floor[],
  existing?: FactoryObject,
): FactoryObject | null => {
  const supportedKinds: FactoryObjectKind[] = ['machine', 'conveyor', 'rack', 'shelf', 'buffer', 'agv', 'drone']
  const kind = raw.kind as FactoryObjectKind
  if (!supportedKinds.includes(kind)) return null
  const transform = raw.transform && typeof raw.transform === 'object' ? raw.transform as Record<string, unknown> : raw
  const footprint = raw.footprint && typeof raw.footprint === 'object' ? raw.footprint as Record<string, unknown> : {}
  const id = typeof raw.id === 'string' ? raw.id : existing?.id
  if (!id) return null
  const rotationValue = Number(transform.rotationY ?? existing?.transform.rotationY ?? 0)
  const rotationY = ([0, 90, 180, 270] as const).includes(rotationValue as 0 | 90 | 180 | 270)
    ? rotationValue as GridTransform['rotationY']
    : 0
  const x = Number(transform.x ?? existing?.transform.x)
  const z = Number(transform.z ?? existing?.transform.z)
  if (!Number.isFinite(x) || !Number.isFinite(z)) return null
  const defaultConfig = defaultConfigForKind(kind)
  const rawConfig = raw.config && typeof raw.config === 'object' ? raw.config as FactoryObjectConfig : defaultConfig
  const config = kind === 'rack' && rawConfig.kind === 'rack'
    ? normalizeWarehouseConfig(rawConfig)
    : rawConfig
  const floorId = typeof raw.floorId === 'string' ? raw.floorId : existing?.floorId ?? floors[0]?.id ?? `floor-${factoryId}`
  const defaultSize = defaultFootprint(kind)
  return {
    id,
    factoryId,
    floorId,
    kind,
    name: typeof raw.name === 'string' && raw.name.trim() ? raw.name : existing?.name ?? objectLabel(kind),
    modelRef: typeof raw.modelRef === 'string' ? raw.modelRef : raw.modelRef === null ? null : existing?.modelRef ?? null,
    transform: { x, z, rotationY },
    footprint: {
      width: Math.max(1, Number(footprint.width ?? existing?.footprint.width ?? defaultSize.width) || defaultSize.width),
      depth: Math.max(1, Number(footprint.depth ?? existing?.footprint.depth ?? defaultSize.depth) || defaultSize.depth),
    },
    status: typeof raw.status === 'string' ? raw.status as FactoryObject['status'] : existing?.status ?? 'ready',
    config,
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : existing?.createdAt ?? nowIso(),
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : nowIso(),
  }
}

const objectLabel = (kind: NewFactoryObject['kind']): string => {
  const labels: Record<NewFactoryObject['kind'], string> = {
    machine: '通用机器',
    conveyor: '传送带',
    rack: '货物仓库',
    shelf: '货架',
    buffer: '缓冲区',
    agv: 'AGV',
    drone: '货运无人机',
  }
  return labels[kind]
}

const pushActivity = (
  activities: ActivityEvent[],
  simulation: SimulationState,
  event: Omit<ActivityEvent, 'id' | 'elapsedSimSec'>,
): void => {
  activities.unshift({
    ...event,
    id: `activity-${simulation.tickCount}-${simulation.nextTransitSequence}-${activities.length}`,
    elapsedSimSec: simulation.elapsedSimSec,
  })
  activities.splice(MAX_ACTIVITY_EVENTS)
}

const createTransit = (
  simulation: SimulationState,
  objects: FactoryObject[],
  itemId: Id,
  quantity: number,
  conveyorId: Id,
  fromObjectId: Id,
  toObjectId: Id | 'finished-goods',
): TransitItem | null => {
  const conveyor = getConveyor(objects, conveyorId)
  const config = getConveyorConfig(conveyor)
  if (!config) return null
  const activeCount = simulation.transitItems.filter((item) => item.conveyorObjectId === conveyorId).length
  if (activeCount >= config.capacity) return null

  const lengthM = Math.max(1, conveyorSpatialLength(config.path, config.riseM ?? 0))
  const travelTimeSec = Math.max(0.75, lengthM / Math.max(0.1, config.speedMps))
  const transit: TransitItem = {
    id: `transit-${simulation.nextTransitSequence++}`,
    itemId,
    quantity,
    conveyorObjectId: conveyorId,
    fromObjectId,
    toObjectId,
    elapsedSec: 0,
    travelTimeSec,
    progress: 0,
    state: 'moving',
  }
  simulation.transitItems.push(transit)
  return transit
}

const availableOutputSpace = (
  runtime: MachineRuntimeState,
  machineObject: FactoryObject | undefined,
): number => {
  const config = getMachineConfig(machineObject)
  return Math.max(0, (config?.outputCapacity ?? 0) - sumRecord(runtime.outputBuffer))
}

const hasInputs = (runtime: MachineRuntimeState, recipe: Recipe): boolean =>
  recipe.inputs.every((line) => (runtime.inputBuffer[line.itemId] ?? 0) >= line.quantity)

const hasOutputSpace = (
  runtime: MachineRuntimeState,
  recipe: Recipe,
  machineObject: FactoryObject | undefined,
): boolean => recipe.outputs.reduce((sum, line) => sum + line.quantity, 0) <= availableOutputSpace(runtime, machineObject)

const consumeInputs = (runtime: MachineRuntimeState, recipe: Recipe): void => {
  recipe.inputs.forEach((line) => {
    runtime.inputBuffer[line.itemId] = Math.max(0, (runtime.inputBuffer[line.itemId] ?? 0) - line.quantity)
  })
}

const addOutputs = (runtime: MachineRuntimeState, recipe: Recipe): void => {
  recipe.outputs.forEach((line) => {
    runtime.outputBuffer[line.itemId] = (runtime.outputBuffer[line.itemId] ?? 0) + line.quantity
  })
}

const updateMachineState = (
  runtime: MachineRuntimeState,
  recipe: Recipe,
  machineObject: FactoryObject | undefined,
  deltaSec: number,
  activities: ActivityEvent[],
  simulation: SimulationState,
): void => {
  const config = getMachineConfig(machineObject)
  const processTime = Math.max(0.25, recipe.processingTimeSec / Math.max(0.1, config?.speedMultiplier ?? 1))

  if (runtime.state === 'processing') {
    runtime.busySeconds += deltaSec
    runtime.cycleRemainingSec = Math.max(0, runtime.cycleRemainingSec - deltaSec)
    runtime.progress = clamp(1 - runtime.cycleRemainingSec / processTime, 0, 1)
    if (runtime.cycleRemainingSec <= 0) {
      if (hasOutputSpace(runtime, recipe, machineObject)) {
        addOutputs(runtime, recipe)
        runtime.processedCycles += 1
        runtime.progress = 0
        runtime.state = 'idle'
        pushActivity(activities, simulation, {
          title: `${machineObject?.name ?? '机器'} 完成加工`,
          description: `${recipe.name}已产生 ${recipe.outputs.reduce((sum, line) => sum + line.quantity, 0)} 件输出`,
          tone: 'success',
          objectId: runtime.machineObjectId,
        })
      } else {
        runtime.state = 'blocked'
      }
    }
    return
  }

  if (runtime.state === 'blocked') {
    runtime.blockedSeconds += deltaSec
    if (hasOutputSpace(runtime, recipe, machineObject)) runtime.state = 'idle'
    return
  }

  if (hasInputs(runtime, recipe) && hasOutputSpace(runtime, recipe, machineObject)) {
    consumeInputs(runtime, recipe)
    runtime.state = 'processing'
    runtime.cycleRemainingSec = processTime
    runtime.progress = 0
    runtime.busySeconds += deltaSec
  } else {
    runtime.state = hasInputs(runtime, recipe) ? 'blocked' : 'waiting-input'
    if (runtime.state === 'blocked') runtime.blockedSeconds += deltaSec
    else runtime.idleSeconds += deltaSec
  }
}

const dispatchMachineOutput = (
  simulation: SimulationState,
  objects: FactoryObject[],
  runtime: MachineRuntimeState,
  conveyorId: Id,
  targetId: Id | 'finished-goods',
  outputItemId: Id | null,
): void => {
  if (!outputItemId) return
  const entry = Object.entries(runtime.outputBuffer).find(([itemId, quantity]) => itemId === outputItemId && quantity > 0)
  if (!entry) return
  const [itemId, quantity] = entry
  if (quantity <= 0) return

  const transit = createTransit(
    simulation,
    objects,
    itemId,
    1,
    conveyorId,
    runtime.machineObjectId,
    targetId,
  )
  if (transit) runtime.outputBuffer[itemId] -= 1
}

const acceptTransit = (
  transit: TransitItem,
  simulation: SimulationState,
  inventory: InventoryRecord[],
  objects: FactoryObject[],
  activities: ActivityEvent[],
): 'accepted' | 'forwarded' | false => {
  if (transit.toObjectId === 'finished-goods') {
    const target = inventory.find((record) => record.locationType === 'finished-goods' && record.itemId === transit.itemId)
    if (!target || target.quantity + transit.quantity > target.capacity) return false
    target.quantity += transit.quantity
    simulation.totalFinished += transit.quantity
    simulation.productionEventsSec.push(simulation.elapsedSimSec)
    pushActivity(activities, simulation, {
      title: '成品已下线',
      description: `${transit.quantity} 件驱动齿轮已进入成品区，累计 ${simulation.totalFinished} 件`,
      tone: 'success',
    })
    return 'accepted'
  }

  const nextConveyor = objects.find((object) => object.id === transit.toObjectId && object.config.kind === 'conveyor')
  if (nextConveyor?.config.kind === 'conveyor') {
    if (!nextConveyor.config.toObjectId) return false
    const activeCount = simulation.transitItems.filter((item) => item.id !== transit.id && item.conveyorObjectId === nextConveyor.id).length
    if (activeCount >= nextConveyor.config.capacity) return false
    const lengthM = Math.max(1, conveyorSpatialLength(nextConveyor.config.path, nextConveyor.config.riseM ?? 0))
    transit.conveyorObjectId = nextConveyor.id
    transit.fromObjectId = nextConveyor.config.fromObjectId ?? transit.fromObjectId
    transit.toObjectId = nextConveyor.config.toObjectId
    transit.elapsedSec = 0
    transit.travelTimeSec = Math.max(0.75, lengthM / Math.max(0.1, nextConveyor.config.speedMps))
    transit.progress = 0
    transit.state = 'moving'
    return 'forwarded'
  }

  const warehouse = objects.find((object) => object.id === transit.toObjectId && object.kind === 'rack')
  if (warehouse) {
    const capacity = warehouseCapacity(warehouse)
    const warehouseRecords = inventory.filter((record) => isWarehouseRecord(record, warehouse.id))
    const totalStoredAndReserved = warehouseRecords.reduce(
      (sum, record) => sum + record.quantity + reservedInboundCapacity(record),
      0,
    )
    if (totalStoredAndReserved + transit.quantity > capacity) return false
    let target = warehouseRecords.find((record) => record.itemId === transit.itemId)
    if (!target) {
      target = createWarehouseInventoryRecord(warehouse.id, transit.itemId, capacity)
      inventory.push(target)
    }
    target.quantity += transit.quantity
    pushActivity(activities, simulation, {
      title: '货物已入库',
      description: `${transit.itemId} ×${transit.quantity} 已从入货口进入 ${warehouse.name}`,
      tone: 'success',
    })
    return 'accepted'
  }

  const runtime = simulation.machineRuntime[transit.toObjectId]
  if (!runtime) return false
  const machineConfig = getMachineConfig(getMachineObject(objects, transit.toObjectId))
  const inputCapacity = machineConfig?.inputCapacity ?? 0
  if (sumRecord(runtime.inputBuffer) + transit.quantity > inputCapacity) return false
  runtime.inputBuffer[transit.itemId] = (runtime.inputBuffer[transit.itemId] ?? 0) + transit.quantity
  return 'accepted'
}

const updateTransit = (
  simulation: SimulationState,
  inventory: InventoryRecord[],
  objects: FactoryObject[],
  activities: ActivityEvent[],
  deltaSec: number,
): void => {
  const remaining: TransitItem[] = []
  for (const transit of simulation.transitItems) {
    transit.elapsedSec += deltaSec
    transit.progress = clamp(transit.elapsedSec / transit.travelTimeSec, 0, 1)
    if (transit.progress < 1) {
      remaining.push(transit)
      continue
    }

    const completedSegmentDuration = transit.travelTimeSec
    const accepted = acceptTransit(transit, simulation, inventory, objects, activities)
    if (accepted === 'accepted') {
      transit.state = 'delivered'
      simulation.completedTransportDurationsSec.push(completedSegmentDuration)
      simulation.completedTransportDurationsSec.splice(0, Math.max(0, simulation.completedTransportDurationsSec.length - 120))
    } else if (accepted === 'forwarded') {
      simulation.completedTransportDurationsSec.push(completedSegmentDuration)
      remaining.push(transit)
    } else {
      transit.elapsedSec = transit.travelTimeSec
      transit.progress = 0.999
      remaining.push(transit)
    }
  }
  simulation.transitItems = remaining
}

const dispatchWarehouseInventory = (
  simulation: SimulationState,
  objects: FactoryObject[],
  inventory: InventoryRecord[],
): void => {
  simulation.warehouseDispatchCooldownSecByPort ??= {}
  for (const warehouse of objects.filter((object) => object.kind === 'rack')) {
    const legacyCooldown = simulation.warehouseDispatchCooldownSec?.[warehouse.id] ?? 0
    const cooldowns = (simulation.warehouseDispatchCooldownSecByPort[warehouse.id] ?? [legacyCooldown, legacyCooldown, legacyCooldown])
      .map((cooldown) => Math.max(0, (Number(cooldown) || 0) - STEP_SECONDS)) as WarehouseDispatchIntervalsSec
    simulation.warehouseDispatchCooldownSecByPort[warehouse.id] = cooldowns
    const stocked = inventory.filter((record) => isWarehouseRecord(record, warehouse.id) && isAvailableWarehouseStock(record))
    if (stocked.length === 0) continue
    const outgoing = objects.filter((object) => object.config.kind === 'conveyor'
      && object.config.fromObjectId === warehouse.id
      && object.config.toObjectId)
    for (const connection of outgoing) {
      if (connection.config.kind !== 'conveyor' || !connection.config.toObjectId) continue
      const portIndex = connection.config.fromPortIndex ?? 1
      if (cooldowns[portIndex] > 0) continue
      const requested = connection.config.outputItemId
      const currentlyAvailable = stocked.filter(isAvailableWarehouseStock)
      const source = requested
        ? currentlyAvailable.find((record) => record.itemId === requested)
        : currentlyAvailable.length === 1 ? currentlyAvailable[0] : undefined
      if (!source) continue
      const transit = createTransit(
        simulation,
        objects,
        source.itemId,
        1,
        connection.id,
        warehouse.id,
        connection.config.toObjectId,
      )
      if (transit) {
        if (!source.infiniteSupply) source.quantity -= 1
        cooldowns[portIndex] = warehouseDispatchInterval(warehouse, portIndex)
      }
    }
  }
}

const createAgvRuntime = (object: FactoryObject): AgvRuntimeState => {
  const center = facilityCenter(objectBounds(object))
  return {
    vehicleObjectId: object.id,
    phase: 'unconfigured',
    motionStatus: 'idle',
    position: center,
    headingY: THREE_DEGREES_TO_RADIANS * object.transform.rotationY,
    path: [],
    waypointIndex: 0,
    missionSourceObjectId: null,
    missionDestinationObjectId: null,
    missionItemId: null,
    sourceInventoryRecordId: null,
    destinationInventoryRecordId: null,
    reservedQuantity: 0,
    cargoItemId: null,
    cargoQuantity: 0,
    blockedByVehicleId: null,
    blockedReason: null,
    yieldingToVehicleId: null,
    waitTicks: 0,
    lastPlanTick: -AGV_BLOCKED_RETRY_INTERVAL_TICKS,
    tripStartedAtSec: null,
    completedTrips: 0,
    distanceTravelledM: 0,
    movingSeconds: 0,
    waitingSeconds: 0,
    blockedSeconds: 0,
  }
}

const THREE_DEGREES_TO_RADIANS = Math.PI / 180

const ensureAgvRuntimes = (simulation: SimulationState, objects: FactoryObject[]): void => {
  simulation.agvRuntime ??= {}
  const agvIds = new Set(objects.filter((object) => object.kind === 'agv').map((object) => object.id))
  Object.keys(simulation.agvRuntime).forEach((id) => {
    if (!agvIds.has(id)) delete simulation.agvRuntime[id]
  })
  objects.filter((object) => object.kind === 'agv').forEach((object) => {
    const runtime = simulation.agvRuntime[object.id]
    if (!runtime || !Number.isFinite(runtime.position?.x) || !Number.isFinite(runtime.position?.z)) {
      simulation.agvRuntime[object.id] = createAgvRuntime(object)
    }
  })
}

const storageInventoryRecord = (
  inventory: InventoryRecord[],
  storageObjectId: Id,
  itemId: Id,
): InventoryRecord | undefined => inventory.find((record) => isWarehouseRecord(record, storageObjectId) && record.itemId === itemId)

const storageRemainingCapacity = (
  inventory: InventoryRecord[],
  storage: FactoryObject,
): number => {
  if (storage.kind === 'shelf') return Number.MAX_SAFE_INTEGER
  const usedAndReserved = inventory
    .filter((record) => isWarehouseRecord(record, storage.id))
    .reduce((sum, record) => sum + record.quantity + reservedInboundCapacity(record), 0)
  return Math.max(0, warehouseCapacity(storage) - usedAndReserved)
}

const releaseAgvReservations = (runtime: AgvRuntimeState, inventory: InventoryRecord[]): void => {
  if (runtime.reservedQuantity <= 0) return
  const source = runtime.sourceInventoryRecordId
    ? inventory.find((record) => record.id === runtime.sourceInventoryRecordId)
    : undefined
  const destination = runtime.destinationInventoryRecordId
    ? inventory.find((record) => record.id === runtime.destinationInventoryRecordId)
    : undefined
  if (source && !source.infiniteSupply && runtime.cargoQuantity <= 0) {
    source.reservedOutboundQuantity = Math.max(0, reservedOutboundQuantity(source) - runtime.reservedQuantity)
  }
  if (destination) destination.reservedInboundCapacity = Math.max(0, reservedInboundCapacity(destination) - runtime.reservedQuantity)
  runtime.reservedQuantity = 0
}

const clearAgvMission = (runtime: AgvRuntimeState): void => {
  runtime.phase = 'waiting-trigger'
  runtime.motionStatus = 'waiting'
  runtime.path = []
  runtime.waypointIndex = 0
  runtime.missionSourceObjectId = null
  runtime.missionDestinationObjectId = null
  runtime.missionItemId = null
  runtime.sourceInventoryRecordId = null
  runtime.destinationInventoryRecordId = null
  runtime.reservedQuantity = 0
  runtime.cargoItemId = null
  runtime.cargoQuantity = 0
  runtime.blockedByVehicleId = null
  runtime.blockedReason = null
  runtime.yieldingToVehicleId = null
  runtime.waitTicks = 0
  runtime.tripStartedAtSec = null
}

const agvConfigurationError = (
  object: FactoryObject,
  program: AgvProgram,
  objects: FactoryObject[],
  items: Item[],
  floors: Floor[],
): string | null => {
  if (!program.enabled) return '任务程序未启用'
  if (!program.sourceObjectId || !program.destinationObjectId || !program.itemId) return '请设置起点、终点和货物'
  if (program.sourceObjectId === program.destinationObjectId) return '起点与终点不能相同'
  const source = objects.find((candidate) => candidate.id === program.sourceObjectId && isStorageObject(candidate))
  const destination = objects.find((candidate) => candidate.id === program.destinationObjectId && isStorageObject(candidate))
  if (!source || !destination) return '起点或终点已不存在'
  if (floors.find((floor) => floor.id === object.floorId)?.level !== 1) return 'AGV 仅允许在 1F 执行运输'
  if (source.floorId !== object.floorId || destination.floorId !== object.floorId) return 'AGV 只在当前楼层执行地面运输'
  if (!items.some((item) => item.id === program.itemId)) return '所选货物已不存在'
  return null
}

const agvTriggerMatches = (
  program: AgvProgram,
  sourceRecord: InventoryRecord,
  destinationRecord: InventoryRecord,
): boolean => {
  if (program.triggerLocation === 'always') return true
  const quantity = program.triggerLocation === 'source' ? sourceRecord.quantity : destinationRecord.quantity
  return program.triggerComparator === 'at-least'
    ? quantity >= program.triggerQuantity
    : quantity <= program.triggerQuantity
}

const assignAgvPath = (runtime: AgvRuntimeState, path: AgvNavigationPoint[], tickCount: number): void => {
  const nextPath = [...path]
  if (nextPath.length === 0 || Math.hypot(nextPath[0].x - runtime.position.x, nextPath[0].z - runtime.position.z) > 0.01) {
    nextPath.unshift({ ...runtime.position })
  }
  runtime.path = nextPath
  runtime.waypointIndex = nextPath.length > 1 ? 1 : nextPath.length
  runtime.lastPlanTick = tickCount
  runtime.motionStatus = nextPath.length > 1 ? 'moving' : 'waiting'
  runtime.blockedByVehicleId = null
  runtime.blockedReason = null
  runtime.waitTicks = 0
}

const agvMissionGoalId = (runtime: AgvRuntimeState): Id | null =>
  runtime.phase === 'to-source'
    ? runtime.missionSourceObjectId
    : runtime.phase === 'to-destination'
      ? runtime.missionDestinationObjectId
      : null

const agvPointDistance = (left: AgvNavigationPoint, right: AgvNavigationPoint): number => Math.hypot(
  left.x - right.x,
  left.z - right.z,
)

const agvRemainingRouteDistance = (runtime: AgvRuntimeState): number => {
  const remainingPath = runtime.path.slice(runtime.waypointIndex)
  if (remainingPath.length === 0) return Number.POSITIVE_INFINITY
  let distance = agvPointDistance(runtime.position, remainingPath[0])
  for (let index = 1; index < remainingPath.length; index += 1) distance += agvPointDistance(remainingPath[index - 1], remainingPath[index])
  return distance
}

const agvDistanceToFacility = (position: AgvNavigationPoint, facility: FactoryObject): number => {
  const minX = facility.transform.x
  const maxX = facility.transform.x + facility.footprint.width
  const minZ = facility.transform.z
  const maxZ = facility.transform.z + facility.footprint.depth
  const dx = Math.max(minX - position.x, 0, position.x - maxX)
  const dz = Math.max(minZ - position.z, 0, position.z - maxZ)
  return Math.hypot(dx, dz)
}

interface AgvDockingClaim {
  ownerVehicleId: Id
}

const buildAgvDockingClaims = (
  factory: Factory,
  objects: FactoryObject[],
  simulation: SimulationState,
): Map<Id, AgvDockingClaim> => {
  const agvs = objects.filter((object) => object.kind === 'agv')
  const goalIds = [...new Set(agvs.flatMap((object) => {
    const runtime = simulation.agvRuntime[object.id]
    const activeGoalId = agvMissionGoalId(runtime)
    const clearingGoalId = runtime.phase === 'clearing-dock' ? runtime.missionDestinationObjectId : null
    return activeGoalId || clearingGoalId ? [activeGoalId ?? clearingGoalId!] : []
  }))]
  const claims = new Map<Id, AgvDockingClaim>()
  for (const goalId of goalIds) {
    const facility = objects.find((object) => object.id === goalId && isStorageObject(object))
    if (!facility) continue
    const clearing = agvs
      .filter((object) => {
        const runtime = simulation.agvRuntime[object.id]
        return runtime.phase === 'clearing-dock' && runtime.missionDestinationObjectId === goalId
      })
      .sort((left, right) => left.id.localeCompare(right.id))
    const targeters = agvs
      .filter((object) => agvMissionGoalId(simulation.agvRuntime[object.id]) === goalId)
    const occupants = targeters
      .filter((object) => agvDistanceToFacility(simulation.agvRuntime[object.id].position, facility) <= AGV_NAVIGATION_CLEARANCE_M + factory.gridSizeM * 0.5)
      .sort((left, right) => {
        const distanceDifference = agvDistanceToFacility(simulation.agvRuntime[left.id].position, facility)
          - agvDistanceToFacility(simulation.agvRuntime[right.id].position, facility)
        return Math.abs(distanceDifference) > 1e-6 ? distanceDifference : left.id.localeCompare(right.id)
      })
    targeters.sort((left, right) => {
      const distanceDifference = agvRemainingRouteDistance(simulation.agvRuntime[left.id])
        - agvRemainingRouteDistance(simulation.agvRuntime[right.id])
      return Math.abs(distanceDifference) > 1e-6 ? distanceDifference : left.id.localeCompare(right.id)
    })
    const owner = clearing[0] ?? occupants[0] ?? targeters[0]
    if (owner) claims.set(goalId, { ownerVehicleId: owner.id })
  }
  return claims
}

const agvDockEgressPath = (runtime: AgvRuntimeState): AgvNavigationPoint[] => {
  if (runtime.path.length < 2) return []
  let targetIndex = 0
  for (let index = runtime.path.length - 2; index >= 0; index -= 1) {
    targetIndex = index
    if (agvPointDistance(runtime.path[index], runtime.position) >= AGV_DOCK_EGRESS_DISTANCE_M - 1e-6) break
  }
  const path = runtime.path.slice(targetIndex).reverse().map((point) => ({ ...point }))
  if (path.length === 0 || agvPointDistance(path[0], runtime.position) > 0.01) path.unshift({ ...runtime.position })
  return path.length > 1 && agvPointDistance(path[0], path.at(-1)!) > 0.1 ? path : []
}

const currentAgvDynamicObstacles = (
  simulation: SimulationState,
  objects: FactoryObject[],
  vehicle: FactoryObject,
  factory: Factory,
  proposedPositions?: Map<Id, AgvNavigationPoint>,
): AgvDynamicObstacle[] => {
  const segmentSafetyMargin = Math.max(0.25, factory.gridSizeM) * Math.SQRT1_2
  return objects
    .filter((candidate) => candidate.kind === 'agv' && candidate.id !== vehicle.id && candidate.floorId === vehicle.floorId)
    .map((candidate) => {
      const runtime = simulation.agvRuntime[candidate.id]
      const position = proposedPositions?.get(candidate.id)
        ?? runtime?.position
        ?? facilityCenter(objectBounds(candidate))
      return {
        ...position,
        radiusM: AGV_VEHICLE_SEPARATION_M + segmentSafetyMargin,
      }
    })
}

const recoverParkedAgvDockOccupancy = (
  runtime: AgvRuntimeState,
  object: FactoryObject,
  factory: Factory,
  objects: FactoryObject[],
  simulation: SimulationState,
): boolean => {
  if (runtime.phase !== 'waiting-trigger' || runtime.completedTrips <= 0 || runtime.path.length > 0) return false
  const destinationId = getAgvProgram(object)?.destinationObjectId
  const destination = destinationId ? objects.find((candidate) => candidate.id === destinationId && isStorageObject(candidate)) : undefined
  if (!destination || agvDistanceToFacility(runtime.position, destination) > AGV_NAVIGATION_CLEARANCE_M + factory.gridSizeM * 0.5) return false
  const home = facilityCenter(objectBounds(object))
  const path = findShortestAgvPathToPoint({
    factory,
    objects,
    floorId: object.floorId,
    vehicleObjectId: object.id,
    start: runtime.position,
    target: home,
    dynamicObstacles: currentAgvDynamicObstacles(simulation, objects, object, factory),
  })
  if (!path || path.length < 2) return false
  runtime.phase = 'clearing-dock'
  runtime.missionDestinationObjectId = destination.id
  assignAgvPath(runtime, path, simulation.tickCount)
  runtime.blockedReason = '检测到旧任务仍占用共享装卸位，正在返回安全停车位置'
  return true
}

const findAgvRoute = (
  runtime: AgvRuntimeState,
  object: FactoryObject,
  destinationObjectId: Id,
  factory: Factory,
  objects: FactoryObject[],
  dynamicObstacles: AgvDynamicObstacle[] = [],
): AgvNavigationPoint[] | null => findShortestAgvPath({
  factory,
  objects,
  floorId: object.floorId,
  vehicleObjectId: object.id,
  start: runtime.position,
  destinationObjectId,
  dynamicObstacles,
})

const planAgvRoute = (
  runtime: AgvRuntimeState,
  object: FactoryObject,
  destinationObjectId: Id,
  factory: Factory,
  objects: FactoryObject[],
  simulation: SimulationState,
  dynamicObstacles: AgvDynamicObstacle[] = [],
): boolean => {
  const path = findAgvRoute(runtime, object, destinationObjectId, factory, objects, dynamicObstacles)
  runtime.lastPlanTick = simulation.tickCount
  if (!path) {
    runtime.path = []
    runtime.waypointIndex = 0
    runtime.motionStatus = 'blocked'
    runtime.blockedReason = '静态安全包络内没有可达路径'
    runtime.waitTicks += 1
    return false
  }
  assignAgvPath(runtime, path, simulation.tickCount)
  return true
}

const tryStartAgvMission = (
  runtime: AgvRuntimeState,
  object: FactoryObject,
  factory: Factory,
  floors: Floor[],
  objects: FactoryObject[],
  items: Item[],
  inventory: InventoryRecord[],
  simulation: SimulationState,
  activities: ActivityEvent[],
): void => {
  const program = getAgvProgram(object) ?? defaultAgvProgram()
  const error = agvConfigurationError(object, program, objects, items, floors)
  if (error) {
    runtime.phase = program.enabled ? 'unconfigured' : 'waiting-trigger'
    runtime.motionStatus = program.enabled ? 'blocked' : 'idle'
    runtime.blockedReason = error
    return
  }
  const source = objects.find((candidate) => candidate.id === program.sourceObjectId)!
  const destination = objects.find((candidate) => candidate.id === program.destinationObjectId)!
  const sourceRecord = storageInventoryRecord(inventory, source.id, program.itemId!)
  const destinationRecord = storageInventoryRecord(inventory, destination.id, program.itemId!)
  const item = items.find((candidate) => candidate.id === program.itemId)!
  if (!sourceRecord || !destinationRecord || !agvTriggerMatches(program, sourceRecord, destinationRecord)) {
    runtime.phase = 'waiting-trigger'
    runtime.motionStatus = 'waiting'
    runtime.blockedReason = sourceRecord && destinationRecord ? '等待库存触发条件' : '等待库存记录'
    return
  }
  const config = getVehicleConfig(object)!
  const payloadUnits = Math.max(1, Math.floor((config.maxPayloadKg ?? DEFAULT_AGV_MAX_PAYLOAD_KG) / Math.max(0.001, item.massKg)))
  const sourceAvailable = sourceRecord.infiniteSupply
    ? Number.MAX_SAFE_INTEGER
    : Math.max(0, sourceRecord.quantity - reservedOutboundQuantity(sourceRecord))
  const destinationAvailable = storageRemainingCapacity(inventory, destination)
  const quantity = Math.min(program.loadQuantity, payloadUnits, sourceAvailable, destinationAvailable)
  if (quantity < 1) {
    runtime.phase = 'waiting-trigger'
    runtime.motionStatus = 'waiting'
    runtime.blockedReason = sourceAvailable < 1 ? '起点库存不足' : '终点容量不足'
    return
  }
  if (!sourceRecord.infiniteSupply) sourceRecord.reservedOutboundQuantity = reservedOutboundQuantity(sourceRecord) + quantity
  destinationRecord.reservedInboundCapacity = reservedInboundCapacity(destinationRecord) + quantity
  runtime.phase = 'to-source'
  runtime.missionSourceObjectId = source.id
  runtime.missionDestinationObjectId = destination.id
  runtime.missionItemId = item.id
  runtime.sourceInventoryRecordId = sourceRecord.id
  runtime.destinationInventoryRecordId = destinationRecord.id
  runtime.reservedQuantity = quantity
  runtime.tripStartedAtSec = simulation.elapsedSimSec
  runtime.blockedReason = null
  planAgvRoute(
    runtime,
    object,
    source.id,
    factory,
    objects,
    simulation,
    currentAgvDynamicObstacles(simulation, objects, object, factory),
  )
  pushActivity(activities, simulation, {
    title: `${object.name} 已创建运输任务`,
    description: `${source.name} → ${destination.name} · ${item.name} ×${quantity}`,
    tone: 'info',
    objectId: object.id,
  })
}

interface ProposedAgvMovement {
  position: AgvNavigationPoint
  waypointIndex: number
  headingY: number
  distanceM: number
  reachedEnd: boolean
}

const proposeAgvMovement = (runtime: AgvRuntimeState, distanceM: number): ProposedAgvMovement => {
  const position = { ...runtime.position }
  let waypointIndex = runtime.waypointIndex
  let remaining = distanceM
  let travelled = 0
  let headingY = runtime.headingY
  while (remaining > 1e-6 && waypointIndex < runtime.path.length) {
    const target = runtime.path[waypointIndex]
    const dx = target.x - position.x
    const dz = target.z - position.z
    const distance = Math.hypot(dx, dz)
    if (distance <= 1e-6) {
      waypointIndex += 1
      continue
    }
    headingY = Math.atan2(dx, dz)
    const step = Math.min(distance, remaining)
    position.x += dx / distance * step
    position.z += dz / distance * step
    travelled += step
    remaining -= step
    if (step >= distance - 1e-6) waypointIndex += 1
  }
  return { position, waypointIndex, headingY, distanceM: travelled, reachedEnd: waypointIndex >= runtime.path.length }
}

const handleAgvArrival = (
  runtime: AgvRuntimeState,
  object: FactoryObject,
  factory: Factory,
  objects: FactoryObject[],
  items: Item[],
  inventory: InventoryRecord[],
  simulation: SimulationState,
  activities: ActivityEvent[],
): void => {
  if (runtime.phase === 'clearing-dock') {
    clearAgvMission(runtime)
    runtime.blockedReason = '已退出共享装卸位，等待库存触发条件'
    return
  }
  if (runtime.phase === 'to-source') {
    const source = runtime.sourceInventoryRecordId ? inventory.find((record) => record.id === runtime.sourceInventoryRecordId) : undefined
    const destination = runtime.destinationInventoryRecordId ? inventory.find((record) => record.id === runtime.destinationInventoryRecordId) : undefined
    if (!source || !destination || !runtime.missionItemId || !runtime.missionDestinationObjectId) {
      releaseAgvReservations(runtime, inventory)
      clearAgvMission(runtime)
      runtime.motionStatus = 'blocked'
      runtime.blockedReason = '装货点或库存记录已失效'
      return
    }
    const quantity = source.infiniteSupply ? runtime.reservedQuantity : Math.min(runtime.reservedQuantity, source.quantity)
    if (!source.infiniteSupply) {
      source.reservedOutboundQuantity = Math.max(0, reservedOutboundQuantity(source) - runtime.reservedQuantity)
      source.quantity -= quantity
    }
    if (quantity < runtime.reservedQuantity) {
      destination.reservedInboundCapacity = Math.max(0, reservedInboundCapacity(destination) - (runtime.reservedQuantity - quantity))
      runtime.reservedQuantity = quantity
    }
    if (quantity <= 0) {
      releaseAgvReservations(runtime, inventory)
      clearAgvMission(runtime)
      return
    }
    runtime.cargoItemId = runtime.missionItemId
    runtime.cargoQuantity = quantity
    runtime.phase = 'to-destination'
    runtime.path = []
    runtime.waypointIndex = 0
    const destinationObject = objects.find((candidate) => candidate.id === runtime.missionDestinationObjectId)
    pushActivity(activities, simulation, {
      title: `${object.name} 完成装货`,
      description: `${items.find((item) => item.id === runtime.cargoItemId)?.name ?? runtime.cargoItemId} ×${quantity}，前往 ${destinationObject?.name ?? '终点'}`,
      tone: 'success',
      objectId: object.id,
    })
    planAgvRoute(
      runtime,
      object,
      runtime.missionDestinationObjectId,
      factory,
      objects,
      simulation,
      currentAgvDynamicObstacles(simulation, objects, object, factory),
    )
    return
  }

  if (runtime.phase !== 'to-destination' || !runtime.cargoItemId || runtime.cargoQuantity <= 0) return
  const destination = runtime.destinationInventoryRecordId ? inventory.find((record) => record.id === runtime.destinationInventoryRecordId) : undefined
  if (!destination) {
    runtime.motionStatus = 'blocked'
    runtime.blockedReason = '卸货点库存记录已失效，货物保留在车上'
    return
  }
  destination.reservedInboundCapacity = Math.max(0, reservedInboundCapacity(destination) - runtime.reservedQuantity)
  destination.quantity += runtime.cargoQuantity
  const sourceObject = objects.find((candidate) => candidate.id === runtime.missionSourceObjectId)
  const destinationObject = objects.find((candidate) => candidate.id === runtime.missionDestinationObjectId)
  const item = items.find((candidate) => candidate.id === runtime.cargoItemId)
  runtime.completedTrips += 1
  if (runtime.tripStartedAtSec != null) {
    simulation.completedTransportDurationsSec.push(Math.max(STEP_SECONDS, simulation.elapsedSimSec - runtime.tripStartedAtSec))
  }
  pushActivity(activities, simulation, {
    title: `${object.name} 完成运输`,
    description: `${sourceObject?.name ?? '起点'} → ${destinationObject?.name ?? '终点'} · ${item?.name ?? runtime.cargoItemId} ×${runtime.cargoQuantity}`,
    tone: 'success',
    objectId: object.id,
  })
  const completedDestinationId = runtime.missionDestinationObjectId
  const egressPath = agvDockEgressPath(runtime)
  clearAgvMission(runtime)
  if (completedDestinationId && egressPath.length > 1) {
    runtime.phase = 'clearing-dock'
    runtime.missionDestinationObjectId = completedDestinationId
    assignAgvPath(runtime, egressPath, simulation.tickCount)
    runtime.blockedReason = '完成卸货，正在退出共享装卸位'
  }
}

const updateAgvSimulation = (
  factory: Factory,
  floors: Floor[],
  objects: FactoryObject[],
  items: Item[],
  inventory: InventoryRecord[],
  simulation: SimulationState,
  activities: ActivityEvent[],
): void => {
  ensureAgvRuntimes(simulation, objects)
  const agvObjects = objects.filter((object) => object.kind === 'agv').sort((left, right) => left.id.localeCompare(right.id))
  const objectById = new Map(agvObjects.map((object) => [object.id, object]))
  for (const object of agvObjects) {
    const runtime = simulation.agvRuntime[object.id]
    if (runtime.phase === 'clearing-dock' && runtime.path.length === 0 && !runtime.yieldingToVehicleId) {
      clearAgvMission(runtime)
    }
    if (recoverParkedAgvDockOccupancy(runtime, object, factory, objects, simulation)) continue
    if (runtime.phase !== 'clearing-dock' && !runtime.missionSourceObjectId && runtime.cargoQuantity <= 0) {
      tryStartAgvMission(runtime, object, factory, floors, objects, items, inventory, simulation, activities)
    } else if (runtime.path.length === 0 && simulation.tickCount - runtime.lastPlanTick >= AGV_BLOCKED_RETRY_INTERVAL_TICKS) {
      const goalId = agvMissionGoalId(runtime)
      if (goalId) {
        planAgvRoute(
          runtime,
          object,
          goalId,
          factory,
          objects,
          simulation,
          currentAgvDynamicObstacles(simulation, objects, object, factory),
        )
      }
    }
  }

  const dockingClaims = buildAgvDockingClaims(factory, objects, simulation)
  const proposedPositions = new Map<Id, AgvNavigationPoint>()
  const reachedRuntimes: AgvRuntimeState[] = []
  for (const object of agvObjects) {
    const runtime = simulation.agvRuntime[object.id]
    const config = getVehicleConfig(object)
    if (!config || (runtime.phase !== 'to-source' && runtime.phase !== 'to-destination' && runtime.phase !== 'clearing-dock')) {
      runtime.waitingSeconds += STEP_SECONDS
      continue
    }
    if (runtime.yieldingToVehicleId) {
      const winner = simulation.agvRuntime[runtime.yieldingToVehicleId]
      if (winner && (runtime.motionStatus !== 'yielding' || runtime.path.length === 0)) {
        const avoidPoints = [winner.position, ...winner.path.slice(winner.waypointIndex, winner.waypointIndex + 5)]
        const dynamicObstacles = currentAgvDynamicObstacles(simulation, objects, object, factory, proposedPositions)
        const yieldPath = findAgvYieldPath({
          factory,
          objects,
          floorId: object.floorId,
          vehicleObjectId: object.id,
          start: runtime.position,
          avoidPoints,
          dynamicObstacles,
        })
        if (yieldPath) {
          assignAgvPath(runtime, yieldPath, simulation.tickCount)
          runtime.motionStatus = 'yielding'
          runtime.blockedReason = `向 ${objectById.get(winner.vehicleObjectId)?.name ?? '高优先级车辆'} 让行`
        }
      }
    }
    if (runtime.path.length === 0) {
      runtime.waitingSeconds += STEP_SECONDS
      continue
    }
    if (runtime.waypointIndex >= runtime.path.length) {
      if (runtime.motionStatus === 'yielding') {
        runtime.yieldingToVehicleId = null
        runtime.motionStatus = 'waiting'
        runtime.path = []
        runtime.waypointIndex = 0
      } else {
        reachedRuntimes.push(runtime)
      }
      runtime.waitingSeconds += STEP_SECONDS
      continue
    }
    const movement = proposeAgvMovement(runtime, Math.max(0.25, config.speedMps ?? DEFAULT_AGV_SPEED_MPS) * STEP_SECONDS)
    const goalId = agvMissionGoalId(runtime)
    const dockingClaim = goalId ? dockingClaims.get(goalId) : undefined
    const goalFacility = goalId ? objects.find((candidate) => candidate.id === goalId && isStorageObject(candidate)) : undefined
    if (dockingClaim
      && dockingClaim.ownerVehicleId !== object.id
      && goalFacility
      && agvDistanceToFacility(movement.position, goalFacility) < AGV_NAVIGATION_CLEARANCE_M + AGV_DOCK_WAIT_RADIUS_M - 1e-6) {
      const owner = objectById.get(dockingClaim.ownerVehicleId)
      runtime.motionStatus = 'yielding'
      runtime.yieldingToVehicleId = null
      runtime.blockedByVehicleId = dockingClaim.ownerVehicleId
      runtime.blockedReason = `共享装卸位由 ${owner?.name ?? '另一辆 AGV'} 使用，正在安全半径外排队`
      runtime.waitTicks += 1
      runtime.blockedSeconds += STEP_SECONDS
      proposedPositions.set(object.id, runtime.position)
      continue
    }
    const blocker = agvObjects.find((other) => {
      if (other.id === object.id || other.floorId !== object.floorId) return false
      const otherPosition = proposedPositions.get(other.id) ?? simulation.agvRuntime[other.id].position
      const candidateDistance = agvPointDistance(movement.position, otherPosition)
      const currentDistance = agvPointDistance(runtime.position, otherPosition)
      return candidateDistance < AGV_VEHICLE_SEPARATION_M - 1e-6
        && candidateDistance <= currentDistance + 1e-6
    })
    if (blocker) {
      const blockerRuntime = simulation.agvRuntime[blocker.id]
      const blockerHasActiveMission = blockerRuntime.phase === 'to-source' || blockerRuntime.phase === 'to-destination' || blockerRuntime.phase === 'clearing-dock'
      const currentHasPriority = runtime.phase === 'clearing-dock'
        || (blockerRuntime.phase !== 'clearing-dock' && object.id.localeCompare(blocker.id) < 0)
      const blockerIsParked = !blockerHasActiveMission
        || blockerRuntime.motionStatus === 'idle'
        || blockerRuntime.motionStatus === 'waiting'
      const blockerChanged = runtime.blockedByVehicleId !== blocker.id
      const replanDue = simulation.tickCount - runtime.lastPlanTick >= AGV_DYNAMIC_REPLAN_INTERVAL_TICKS
      const mayRerouteWithoutSymmetry = blockerIsParked || currentHasPriority
      if (
        !runtime.yieldingToVehicleId
        && goalId
        && mayRerouteWithoutSymmetry
        && (blockerChanged || replanDue)
      ) {
        const reroutedPath = findAgvRoute(
          runtime,
          object,
          goalId,
          factory,
          objects,
          currentAgvDynamicObstacles(simulation, objects, object, factory, proposedPositions),
        )
        runtime.lastPlanTick = simulation.tickCount
        if (reroutedPath) {
          assignAgvPath(runtime, reroutedPath, simulation.tickCount)
          runtime.blockedByVehicleId = blocker.id
          runtime.blockedReason = `已绕开 ${blocker.name}，继续执行运输`
          proposedPositions.set(object.id, runtime.position)
          continue
        }
      }
      runtime.motionStatus = 'blocked'
      runtime.blockedByVehicleId = blocker.id
      runtime.waitTicks += 1
      runtime.blockedSeconds += STEP_SECONDS
      if (blockerIsParked) {
        runtime.blockedReason = `前方被停驻的 ${blocker.name} 占用，当前没有安全绕路，等待后重试`
      } else if (currentHasPriority) {
        blockerRuntime.yieldingToVehicleId = object.id
        blockerRuntime.path = []
        blockerRuntime.waypointIndex = 0
        runtime.blockedReason = `前方与 ${blocker.name} 冲突，协调器已要求对方让行`
      } else {
        runtime.yieldingToVehicleId = blocker.id
        runtime.path = []
        runtime.waypointIndex = 0
        runtime.blockedReason = `前方与 ${blocker.name} 冲突，正在按固定通行权让行`
      }
      proposedPositions.set(object.id, runtime.position)
      continue
    }
    runtime.position = movement.position
    runtime.waypointIndex = movement.waypointIndex
    runtime.headingY = movement.headingY
    runtime.distanceTravelledM += movement.distanceM
    runtime.movingSeconds += STEP_SECONDS
    runtime.motionStatus = runtime.yieldingToVehicleId ? 'yielding' : 'moving'
    runtime.blockedByVehicleId = null
    runtime.blockedReason = runtime.yieldingToVehicleId ? runtime.blockedReason : null
    runtime.waitTicks = 0
    proposedPositions.set(object.id, runtime.position)
    if (movement.reachedEnd) {
      if (runtime.yieldingToVehicleId) {
        runtime.yieldingToVehicleId = null
        runtime.motionStatus = 'waiting'
        runtime.path = []
        runtime.waypointIndex = 0
      } else {
        reachedRuntimes.push(runtime)
      }
    }
  }

  for (const runtime of reachedRuntimes) {
    const object = objectById.get(runtime.vehicleObjectId)
    if (object) handleAgvArrival(runtime, object, factory, objects, items, inventory, simulation, activities)
  }
}

const createDroneRuntime = (object: FactoryObject, floors: Floor[]): DroneRuntimeState => {
  const center = facilityCenter(objectBounds(object))
  const floor = floors.find((candidate) => candidate.id === object.floorId) ?? floors[0]
  return {
    vehicleObjectId: object.id,
    phase: 'unconfigured',
    motionStatus: 'idle',
    position: { x: center.x, y: (floor?.elevationM ?? 0) + DRONE_INITIAL_HOVER_M, z: center.z },
    headingY: THREE_DEGREES_TO_RADIANS * object.transform.rotationY,
    pitch: 0,
    path: [],
    waypointIndex: 0,
    missionSourceObjectId: null,
    missionDestinationObjectId: null,
    missionItemId: null,
    sourceInventoryRecordId: null,
    destinationInventoryRecordId: null,
    reservedQuantity: 0,
    cargoItemId: null,
    cargoQuantity: 0,
    blockedByVehicleId: null,
    blockedReason: null,
    yieldingToVehicleId: null,
    waitTicks: 0,
    lastPlanTick: -DRONE_BLOCKED_RETRY_INTERVAL_TICKS,
    tripStartedAtSec: null,
    completedTrips: 0,
    distanceTravelledM: 0,
    movingSeconds: 0,
    waitingSeconds: 0,
    blockedSeconds: 0,
  }
}

const ensureDroneRuntimes = (simulation: SimulationState, objects: FactoryObject[], floors: Floor[]): void => {
  simulation.droneRuntime ??= {}
  const droneIds = new Set(objects.filter((object) => object.kind === 'drone').map((object) => object.id))
  Object.keys(simulation.droneRuntime).forEach((id) => {
    if (!droneIds.has(id)) delete simulation.droneRuntime[id]
  })
  objects.filter((object) => object.kind === 'drone').forEach((object) => {
    const runtime = simulation.droneRuntime[object.id]
    if (!runtime || !Number.isFinite(runtime.position?.x) || !Number.isFinite(runtime.position?.y) || !Number.isFinite(runtime.position?.z)) {
      simulation.droneRuntime[object.id] = createDroneRuntime(object, floors)
    }
  })
}

const releaseDroneReservations = (runtime: DroneRuntimeState, inventory: InventoryRecord[]): void => {
  if (runtime.reservedQuantity <= 0) return
  const source = runtime.sourceInventoryRecordId ? inventory.find((record) => record.id === runtime.sourceInventoryRecordId) : undefined
  const destination = runtime.destinationInventoryRecordId ? inventory.find((record) => record.id === runtime.destinationInventoryRecordId) : undefined
  if (source && !source.infiniteSupply && runtime.cargoQuantity <= 0) source.reservedOutboundQuantity = Math.max(0, reservedOutboundQuantity(source) - runtime.reservedQuantity)
  if (destination) destination.reservedInboundCapacity = Math.max(0, reservedInboundCapacity(destination) - runtime.reservedQuantity)
  runtime.reservedQuantity = 0
}

const clearDroneMission = (runtime: DroneRuntimeState): void => {
  runtime.phase = 'waiting-trigger'
  runtime.motionStatus = 'waiting'
  runtime.path = []
  runtime.waypointIndex = 0
  runtime.missionSourceObjectId = null
  runtime.missionDestinationObjectId = null
  runtime.missionItemId = null
  runtime.sourceInventoryRecordId = null
  runtime.destinationInventoryRecordId = null
  runtime.reservedQuantity = 0
  runtime.cargoItemId = null
  runtime.cargoQuantity = 0
  runtime.blockedByVehicleId = null
  runtime.blockedReason = null
  runtime.yieldingToVehicleId = null
  runtime.waitTicks = 0
  runtime.tripStartedAtSec = null
}

const droneConfigurationError = (
  program: AgvProgram,
  objects: FactoryObject[],
  items: Item[],
): string | null => {
  if (!program.enabled) return '任务程序未启用'
  if (!program.sourceObjectId || !program.destinationObjectId || !program.itemId) return '请设置起点、终点和货物'
  if (program.sourceObjectId === program.destinationObjectId) return '起点与终点不能相同'
  const source = objects.find((candidate) => candidate.id === program.sourceObjectId && isStorageObject(candidate))
  const destination = objects.find((candidate) => candidate.id === program.destinationObjectId && isStorageObject(candidate))
  if (!source || !destination) return '起点或终点已不存在'
  if (!items.some((item) => item.id === program.itemId)) return '所选货物已不存在'
  return null
}

const assignDronePath = (runtime: DroneRuntimeState, path: DroneNavigationPoint[], tickCount: number): void => {
  const nextPath = [...path]
  if (nextPath.length === 0 || Math.hypot(
    nextPath[0].x - runtime.position.x,
    nextPath[0].y - runtime.position.y,
    nextPath[0].z - runtime.position.z,
  ) > 0.01) nextPath.unshift({ ...runtime.position })
  runtime.path = nextPath
  runtime.waypointIndex = nextPath.length > 1 ? 1 : nextPath.length
  runtime.lastPlanTick = tickCount
  runtime.motionStatus = nextPath.length > 1 ? 'moving' : 'waiting'
  runtime.blockedByVehicleId = null
  runtime.blockedReason = null
  runtime.waitTicks = 0
}

const droneMissionGoalId = (runtime: DroneRuntimeState): Id | null => runtime.phase === 'to-source'
  ? runtime.missionSourceObjectId
  : runtime.phase === 'to-destination'
    ? runtime.missionDestinationObjectId
    : null

const droneDockingRole = (runtime: DroneRuntimeState): DroneDockingRole | null => runtime.phase === 'to-source'
  ? 'pickup'
  : runtime.phase === 'to-destination'
    ? 'dropoff'
    : null

const dronePointDistance = (left: DroneNavigationPoint, right: DroneNavigationPoint): number => Math.hypot(
  left.x - right.x,
  left.y - right.y,
  left.z - right.z,
)

const droneRemainingRouteDistance = (runtime: DroneRuntimeState, fallbackTarget: DroneNavigationPoint): number => {
  const remainingPath = runtime.path.slice(runtime.waypointIndex)
  if (remainingPath.length === 0) return dronePointDistance(runtime.position, fallbackTarget)
  let distance = dronePointDistance(runtime.position, remainingPath[0])
  for (let index = 1; index < remainingPath.length; index += 1) distance += dronePointDistance(remainingPath[index - 1], remainingPath[index])
  return distance
}

interface DroneDockingClaim {
  ownerVehicleId: Id
}

const buildDroneDockingClaims = (
  factory: Factory,
  floors: Floor[],
  objects: FactoryObject[],
  simulation: SimulationState,
): Map<Id, DroneDockingClaim> => {
  const drones = objects.filter((object) => object.kind === 'drone')
  const goalIds = [...new Set(drones
    .map((object) => droneMissionGoalId(simulation.droneRuntime[object.id]))
    .filter((goalId): goalId is Id => Boolean(goalId)))]
  const claims = new Map<Id, DroneDockingClaim>()
  for (const goalId of goalIds) {
    const servicePoints = (['pickup', 'dropoff'] as const)
      .flatMap((dockingRole) => droneDockingPoints({ factory, floors, objects, destinationObjectId: goalId, dockingRole }))
      .filter((point, index, points) => points.findIndex((candidate) => dronePointDistance(candidate, point) < 0.01) === index)
    if (servicePoints.length === 0) continue
    const occupants = drones
      .map((object) => ({
        object,
        distance: Math.min(...servicePoints.map((point) => dronePointDistance(simulation.droneRuntime[object.id].position, point))),
      }))
      .filter(({ object, distance }) => distance < DRONE_VEHICLE_SEPARATION_M - 1e-6
        && (simulation.droneRuntime[object.id].phase === 'clearing-dock' || droneMissionGoalId(simulation.droneRuntime[object.id]) === goalId))
      .sort((left, right) => {
        const distanceDifference = left.distance - right.distance
        return Math.abs(distanceDifference) > 1e-6 ? distanceDifference : left.object.id.localeCompare(right.object.id)
      })
    const targeters = drones
      .filter((object) => droneMissionGoalId(simulation.droneRuntime[object.id]) === goalId)
      .map((object) => {
        const runtime = simulation.droneRuntime[object.id]
        const role = droneDockingRole(runtime)
        const point = runtime.path.at(-1) ?? (role ? droneDockingPoint({ factory, floors, objects, destinationObjectId: goalId, dockingRole: role }) : null)
        return point ? { object, runtime, point } : null
      })
      .filter((candidate): candidate is { object: FactoryObject; runtime: DroneRuntimeState; point: DroneNavigationPoint } => candidate !== null)
      .sort((left, right) => {
        const distanceDifference = droneRemainingRouteDistance(left.runtime, left.point)
          - droneRemainingRouteDistance(right.runtime, right.point)
        return Math.abs(distanceDifference) > 1e-6 ? distanceDifference : left.object.id.localeCompare(right.object.id)
      })
    const owner = occupants[0]?.object ?? targeters[0]?.object
    if (owner) claims.set(goalId, { ownerVehicleId: owner.id })
  }
  return claims
}

const droneDockEgressPath = (runtime: DroneRuntimeState): DroneNavigationPoint[] => {
  if (runtime.path.length < 2) return []
  let targetIndex = 0
  for (let index = runtime.path.length - 2; index >= 0; index -= 1) {
    targetIndex = index
    if (dronePointDistance(runtime.path[index], runtime.position) >= DRONE_DOCK_EGRESS_DISTANCE_M - 1e-6) break
  }
  const path = runtime.path.slice(targetIndex).reverse().map((point) => ({ ...point }))
  if (path.length === 0 || dronePointDistance(path[0], runtime.position) > 0.01) path.unshift({ ...runtime.position })
  return path.length > 1 && dronePointDistance(path[0], path.at(-1)!) > 0.1 ? path : []
}

const currentDroneDynamicObstacles = (
  simulation: SimulationState,
  objects: FactoryObject[],
  vehicle: FactoryObject,
  proposedPositions?: Map<Id, DroneNavigationPoint>,
): DroneDynamicObstacle[] => objects
  .filter((candidate) => candidate.kind === 'drone' && candidate.id !== vehicle.id)
  .map((candidate) => {
    const runtime = simulation.droneRuntime[candidate.id]
    const position = proposedPositions?.get(candidate.id) ?? runtime?.position
    return position ? { ...position, radiusM: DRONE_VEHICLE_SEPARATION_M } : null
  })
  .filter((obstacle): obstacle is DroneDynamicObstacle => obstacle !== null)

const findDroneRoute = (
  runtime: DroneRuntimeState,
  object: FactoryObject,
  destinationObjectId: Id,
  factory: Factory,
  floors: Floor[],
  objects: FactoryObject[],
  dynamicObstacles: DroneDynamicObstacle[] = [],
): DroneNavigationPoint[] | null => findShortestDronePath({
  factory,
  floors,
  objects,
  vehicleObjectId: object.id,
  start: runtime.position,
  destinationObjectId,
  dockingRole: droneDockingRole(runtime) ?? 'dropoff',
  dynamicObstacles,
})

const planDroneRoute = (
  runtime: DroneRuntimeState,
  object: FactoryObject,
  destinationObjectId: Id,
  factory: Factory,
  floors: Floor[],
  objects: FactoryObject[],
  simulation: SimulationState,
  dynamicObstacles: DroneDynamicObstacle[] = [],
): boolean => {
  const path = findDroneRoute(runtime, object, destinationObjectId, factory, floors, objects, dynamicObstacles)
  runtime.lastPlanTick = simulation.tickCount
  if (!path) {
    runtime.path = []
    runtime.waypointIndex = 0
    runtime.motionStatus = 'blocked'
    runtime.blockedReason = '三维安全包络内没有可达航路'
    runtime.waitTicks += 1
    return false
  }
  assignDronePath(runtime, path, simulation.tickCount)
  return true
}

const tryStartDroneMission = (
  runtime: DroneRuntimeState,
  object: FactoryObject,
  factory: Factory,
  floors: Floor[],
  objects: FactoryObject[],
  items: Item[],
  inventory: InventoryRecord[],
  simulation: SimulationState,
  activities: ActivityEvent[],
): void => {
  const program = getDroneProgram(object) ?? defaultDroneProgram()
  const error = droneConfigurationError(program, objects, items)
  if (error) {
    runtime.phase = program.enabled ? 'unconfigured' : 'waiting-trigger'
    runtime.motionStatus = program.enabled ? 'blocked' : 'idle'
    runtime.blockedReason = error
    return
  }
  const source = objects.find((candidate) => candidate.id === program.sourceObjectId)!
  const destination = objects.find((candidate) => candidate.id === program.destinationObjectId)!
  const sourceRecord = storageInventoryRecord(inventory, source.id, program.itemId!)
  const destinationRecord = storageInventoryRecord(inventory, destination.id, program.itemId!)
  const item = items.find((candidate) => candidate.id === program.itemId)!
  if (!sourceRecord || !destinationRecord || !agvTriggerMatches(program, sourceRecord, destinationRecord)) {
    runtime.phase = 'waiting-trigger'
    runtime.motionStatus = 'waiting'
    runtime.blockedReason = sourceRecord && destinationRecord ? '等待库存触发条件' : '等待库存记录'
    return
  }
  const config = getVehicleConfig(object)!
  const payloadUnits = Math.max(1, Math.floor((config.maxPayloadKg ?? DEFAULT_DRONE_MAX_PAYLOAD_KG) / Math.max(0.001, item.massKg)))
  const sourceAvailable = sourceRecord.infiniteSupply ? Number.MAX_SAFE_INTEGER : Math.max(0, sourceRecord.quantity - reservedOutboundQuantity(sourceRecord))
  const destinationAvailable = storageRemainingCapacity(inventory, destination)
  const quantity = Math.min(program.loadQuantity, payloadUnits, sourceAvailable, destinationAvailable)
  if (quantity < 1) {
    runtime.phase = 'waiting-trigger'
    runtime.motionStatus = 'waiting'
    runtime.blockedReason = sourceAvailable < 1 ? '起点库存不足' : '终点容量不足'
    return
  }
  if (!sourceRecord.infiniteSupply) sourceRecord.reservedOutboundQuantity = reservedOutboundQuantity(sourceRecord) + quantity
  destinationRecord.reservedInboundCapacity = reservedInboundCapacity(destinationRecord) + quantity
  runtime.phase = 'to-source'
  runtime.missionSourceObjectId = source.id
  runtime.missionDestinationObjectId = destination.id
  runtime.missionItemId = item.id
  runtime.sourceInventoryRecordId = sourceRecord.id
  runtime.destinationInventoryRecordId = destinationRecord.id
  runtime.reservedQuantity = quantity
  runtime.tripStartedAtSec = simulation.elapsedSimSec
  runtime.blockedReason = null
  // 高层任务先规划建筑静态最短路；其他无人机可能正停在装卸点，不能把临时占位误判成永久不可达。
  // 真正飞行到冲突区时再由下面的三维动态绕行与稳定优先级协调器处理。
  planDroneRoute(runtime, object, source.id, factory, floors, objects, simulation)
  pushActivity(activities, simulation, {
    title: `${object.name} 已创建跨层运输任务`,
    description: `${source.name} → ${destination.name} · ${item.name} ×${quantity}`,
    tone: 'info',
    objectId: object.id,
  })
}

interface ProposedDroneMovement {
  position: DroneNavigationPoint
  waypointIndex: number
  headingY: number
  pitch: number
  distanceM: number
  reachedEnd: boolean
}

const proposeDroneMovement = (runtime: DroneRuntimeState, distanceM: number): ProposedDroneMovement => {
  const position = { ...runtime.position }
  let waypointIndex = runtime.waypointIndex
  let remaining = distanceM
  let travelled = 0
  let headingY = runtime.headingY
  let pitch = runtime.pitch
  while (remaining > 1e-6 && waypointIndex < runtime.path.length) {
    const target = runtime.path[waypointIndex]
    const dx = target.x - position.x
    const dy = target.y - position.y
    const dz = target.z - position.z
    const distance = Math.hypot(dx, dy, dz)
    if (distance <= 1e-6) {
      waypointIndex += 1
      continue
    }
    headingY = Math.atan2(dx, dz)
    pitch = Math.atan2(dy, Math.hypot(dx, dz))
    const step = Math.min(distance, remaining)
    position.x += dx / distance * step
    position.y += dy / distance * step
    position.z += dz / distance * step
    travelled += step
    remaining -= step
    if (step >= distance - 1e-6) waypointIndex += 1
  }
  return { position, waypointIndex, headingY, pitch, distanceM: travelled, reachedEnd: waypointIndex >= runtime.path.length }
}

const handleDroneArrival = (
  runtime: DroneRuntimeState,
  object: FactoryObject,
  factory: Factory,
  floors: Floor[],
  objects: FactoryObject[],
  items: Item[],
  inventory: InventoryRecord[],
  simulation: SimulationState,
  activities: ActivityEvent[],
): void => {
  if (runtime.phase === 'clearing-dock') {
    clearDroneMission(runtime)
    runtime.blockedReason = '已退出共享装卸位，等待库存触发条件'
    return
  }
  if (runtime.phase === 'to-source') {
    const source = runtime.sourceInventoryRecordId ? inventory.find((record) => record.id === runtime.sourceInventoryRecordId) : undefined
    const destination = runtime.destinationInventoryRecordId ? inventory.find((record) => record.id === runtime.destinationInventoryRecordId) : undefined
    if (!source || !destination || !runtime.missionItemId || !runtime.missionDestinationObjectId) {
      releaseDroneReservations(runtime, inventory)
      clearDroneMission(runtime)
      runtime.motionStatus = 'blocked'
      runtime.blockedReason = '装货点或库存记录已失效'
      return
    }
    const quantity = source.infiniteSupply ? runtime.reservedQuantity : Math.min(runtime.reservedQuantity, source.quantity)
    if (!source.infiniteSupply) {
      source.reservedOutboundQuantity = Math.max(0, reservedOutboundQuantity(source) - runtime.reservedQuantity)
      source.quantity -= quantity
    }
    if (quantity < runtime.reservedQuantity) {
      destination.reservedInboundCapacity = Math.max(0, reservedInboundCapacity(destination) - (runtime.reservedQuantity - quantity))
      runtime.reservedQuantity = quantity
    }
    if (quantity <= 0) {
      releaseDroneReservations(runtime, inventory)
      clearDroneMission(runtime)
      return
    }
    runtime.cargoItemId = runtime.missionItemId
    runtime.cargoQuantity = quantity
    runtime.phase = 'to-destination'
    runtime.path = []
    runtime.waypointIndex = 0
    const destinationObject = objects.find((candidate) => candidate.id === runtime.missionDestinationObjectId)
    pushActivity(activities, simulation, {
      title: `${object.name} 完成空中装货`,
      description: `${items.find((item) => item.id === runtime.cargoItemId)?.name ?? runtime.cargoItemId} ×${quantity}，飞往 ${destinationObject?.name ?? '终点'}`,
      tone: 'success',
      objectId: object.id,
    })
    planDroneRoute(runtime, object, runtime.missionDestinationObjectId, factory, floors, objects, simulation)
    return
  }
  if (runtime.phase !== 'to-destination' || !runtime.cargoItemId || runtime.cargoQuantity <= 0) return
  const destination = runtime.destinationInventoryRecordId ? inventory.find((record) => record.id === runtime.destinationInventoryRecordId) : undefined
  if (!destination) {
    runtime.motionStatus = 'blocked'
    runtime.blockedReason = '卸货点库存记录已失效，货物保留在无人机上'
    return
  }
  destination.reservedInboundCapacity = Math.max(0, reservedInboundCapacity(destination) - runtime.reservedQuantity)
  destination.quantity += runtime.cargoQuantity
  const sourceObject = objects.find((candidate) => candidate.id === runtime.missionSourceObjectId)
  const destinationObject = objects.find((candidate) => candidate.id === runtime.missionDestinationObjectId)
  const item = items.find((candidate) => candidate.id === runtime.cargoItemId)
  runtime.completedTrips += 1
  if (runtime.tripStartedAtSec != null) simulation.completedTransportDurationsSec.push(Math.max(STEP_SECONDS, simulation.elapsedSimSec - runtime.tripStartedAtSec))
  pushActivity(activities, simulation, {
    title: `${object.name} 完成跨层运输`,
    description: `${sourceObject?.name ?? '起点'} → ${destinationObject?.name ?? '终点'} · ${item?.name ?? runtime.cargoItemId} ×${runtime.cargoQuantity}`,
    tone: 'success',
    objectId: object.id,
  })
  const egressPath = droneDockEgressPath(runtime)
  clearDroneMission(runtime)
  if (egressPath.length > 1) {
    runtime.phase = 'clearing-dock'
    assignDronePath(runtime, egressPath, simulation.tickCount)
    runtime.blockedReason = '完成卸货，正在退出共享装卸位'
  }
}

const updateDroneSimulation = (
  factory: Factory,
  floors: Floor[],
  objects: FactoryObject[],
  items: Item[],
  inventory: InventoryRecord[],
  simulation: SimulationState,
  activities: ActivityEvent[],
): void => {
  ensureDroneRuntimes(simulation, objects, floors)
  const drones = objects.filter((object) => object.kind === 'drone').sort((left, right) => left.id.localeCompare(right.id))
  const objectById = new Map(drones.map((object) => [object.id, object]))
  for (const object of drones) {
    const runtime = simulation.droneRuntime[object.id]
    if (runtime.phase === 'clearing-dock' && runtime.path.length === 0) {
      clearDroneMission(runtime)
    }
    if (runtime.phase !== 'clearing-dock' && !runtime.missionSourceObjectId && runtime.cargoQuantity <= 0) {
      tryStartDroneMission(runtime, object, factory, floors, objects, items, inventory, simulation, activities)
    } else if (runtime.path.length === 0 && simulation.tickCount - runtime.lastPlanTick >= DRONE_BLOCKED_RETRY_INTERVAL_TICKS) {
      const goalId = droneMissionGoalId(runtime)
      if (goalId) planDroneRoute(runtime, object, goalId, factory, floors, objects, simulation)
    }
  }

  const dockingClaims = buildDroneDockingClaims(factory, floors, objects, simulation)
  const proposedPositions = new Map<Id, DroneNavigationPoint>()
  const reachedRuntimes: DroneRuntimeState[] = []
  for (const object of drones) {
    const runtime = simulation.droneRuntime[object.id]
    const config = getVehicleConfig(object)
    if (!config || (runtime.phase !== 'to-source' && runtime.phase !== 'to-destination' && runtime.phase !== 'clearing-dock')) {
      runtime.waitingSeconds += STEP_SECONDS
      continue
    }
    if (runtime.path.length === 0) {
      runtime.waitingSeconds += STEP_SECONDS
      continue
    }
    if (runtime.waypointIndex >= runtime.path.length) {
      reachedRuntimes.push(runtime)
      continue
    }
    const movement = proposeDroneMovement(runtime, Math.max(0.5, config.speedMps ?? DEFAULT_DRONE_SPEED_MPS) * STEP_SECONDS)
    const goalId = droneMissionGoalId(runtime)
    const dockingClaim = goalId ? dockingClaims.get(goalId) : undefined
    const role = droneDockingRole(runtime)
    const dockingPoint = goalId
      ? runtime.path.at(-1) ?? (role ? droneDockingPoint({ factory, floors, objects, destinationObjectId: goalId, dockingRole: role }) : null)
      : null
    if (dockingClaim
      && dockingPoint
      && dockingClaim.ownerVehicleId !== object.id
      && dronePointDistance(movement.position, dockingPoint) < DRONE_DOCK_WAIT_RADIUS_M - 1e-6) {
      const owner = objectById.get(dockingClaim.ownerVehicleId)
      runtime.motionStatus = 'yielding'
      runtime.yieldingToVehicleId = dockingClaim.ownerVehicleId
      runtime.blockedByVehicleId = dockingClaim.ownerVehicleId
      runtime.blockedReason = `共享装卸位由 ${owner?.name ?? '另一架无人机'} 使用，正在安全半径外等待`
      runtime.waitTicks += 1
      runtime.blockedSeconds += STEP_SECONDS
      proposedPositions.set(object.id, runtime.position)
      continue
    }
    const blocker = drones.find((other) => {
      if (other.id === object.id) return false
      const otherPosition = proposedPositions.get(other.id) ?? simulation.droneRuntime[other.id].position
      const candidateDistance = dronePointDistance(movement.position, otherPosition)
      const currentDistance = dronePointDistance(runtime.position, otherPosition)
      return candidateDistance < DRONE_VEHICLE_SEPARATION_M - 1e-6
        && candidateDistance <= currentDistance + 1e-6
    })
    if (blocker) {
      const blockerChanged = runtime.blockedByVehicleId !== blocker.id
      const replanDue = simulation.tickCount - runtime.lastPlanTick >= DRONE_DYNAMIC_REPLAN_INTERVAL_TICKS
      if (goalId && (blockerChanged || replanDue)) {
        const rerouted = findDroneRoute(runtime, object, goalId, factory, floors, objects, currentDroneDynamicObstacles(simulation, objects, object, proposedPositions))
        runtime.lastPlanTick = simulation.tickCount
        if (rerouted) {
          assignDronePath(runtime, rerouted, simulation.tickCount)
          runtime.yieldingToVehicleId = object.id.localeCompare(blocker.id) > 0 ? blocker.id : null
          runtime.motionStatus = runtime.yieldingToVehicleId ? 'yielding' : 'moving'
          runtime.blockedByVehicleId = blocker.id
          runtime.blockedReason = `已三维绕开 ${blocker.name}`
          proposedPositions.set(object.id, runtime.position)
          continue
        }
      }
      const hasPriority = object.id.localeCompare(blocker.id) < 0
      runtime.motionStatus = hasPriority ? 'blocked' : 'yielding'
      runtime.yieldingToVehicleId = hasPriority ? null : blocker.id
      runtime.blockedByVehicleId = blocker.id
      runtime.blockedReason = hasPriority
        ? `前方与 ${blocker.name} 冲突，等待对方完成确定性让行`
        : `正在向高优先级 ${blocker.name} 让行`
      runtime.waitTicks += 1
      runtime.blockedSeconds += STEP_SECONDS
      proposedPositions.set(object.id, runtime.position)
      continue
    }
    runtime.position = movement.position
    runtime.waypointIndex = movement.waypointIndex
    runtime.headingY = movement.headingY
    runtime.pitch = movement.pitch
    runtime.distanceTravelledM += movement.distanceM
    runtime.movingSeconds += STEP_SECONDS
    runtime.motionStatus = 'moving'
    runtime.blockedByVehicleId = null
    runtime.blockedReason = null
    runtime.yieldingToVehicleId = null
    runtime.waitTicks = 0
    proposedPositions.set(object.id, runtime.position)
    if (movement.reachedEnd) reachedRuntimes.push(runtime)
  }
  for (const runtime of reachedRuntimes) {
    const object = objectById.get(runtime.vehicleObjectId)
    if (object) handleDroneArrival(runtime, object, factory, floors, objects, items, inventory, simulation, activities)
  }
}

const calculateMetrics = (
  simulation: SimulationState,
  inventory: InventoryRecord[],
  objects: FactoryObject[],
): FactoryMetrics => {
  const cutoff = Math.max(0, simulation.elapsedSimSec - 60)
  simulation.productionEventsSec = simulation.productionEventsSec.filter((time) => time >= cutoff)
  const currentThroughputPerMin = simulation.productionEventsSec.length
  const machineRuntimes = Object.values(simulation.machineRuntime)
  const wipInMachines = machineRuntimes.reduce(
    (sum, runtime) => sum + sumRecord(runtime.inputBuffer) + sumRecord(runtime.outputBuffer) + (runtime.state === 'processing' ? 1 : 0),
    0,
  )
  const agvRuntimes = Object.values(simulation.agvRuntime ?? {})
  const droneRuntimes = Object.values(simulation.droneRuntime ?? {})
  const agvCargo = agvRuntimes.reduce((sum, runtime) => sum + runtime.cargoQuantity, 0)
  const droneCargo = droneRuntimes.reduce((sum, runtime) => sum + runtime.cargoQuantity, 0)
  const workInProgress = wipInMachines + agvCargo + droneCargo + simulation.transitItems.reduce((sum, item) => sum + item.quantity, 0)
  const queueDepth = machineRuntimes.reduce((sum, runtime) => sum + sumRecord(runtime.inputBuffer), 0)
  const blockedObjectCount = machineRuntimes.filter((runtime) => runtime.state === 'blocked').length
    + agvRuntimes.filter((runtime) => runtime.motionStatus === 'blocked').length
    + droneRuntimes.filter((runtime) => runtime.motionStatus === 'blocked').length
  const machineUtilization = Object.fromEntries(
    machineRuntimes.map((runtime) => {
      const observed = runtime.busySeconds + runtime.idleSeconds + runtime.blockedSeconds
      return [runtime.machineObjectId, observed > 0 ? (runtime.busySeconds / observed) * 100 : 0]
    }),
  )
  const conveyorCapacity = objects
    .filter((object) => object.kind === 'conveyor' && object.config.kind === 'conveyor')
    .reduce((sum, object) => sum + (object.config.kind === 'conveyor' ? object.config.capacity : 0), 0)
  const durations = simulation.completedTransportDurationsSec
  const agvObservedSeconds = agvRuntimes.reduce((sum, runtime) => sum + runtime.movingSeconds + runtime.waitingSeconds + runtime.blockedSeconds, 0)
  const agvMovingSeconds = agvRuntimes.reduce((sum, runtime) => sum + runtime.movingSeconds, 0)
  const droneObservedSeconds = droneRuntimes.reduce((sum, runtime) => sum + runtime.movingSeconds + runtime.waitingSeconds + runtime.blockedSeconds, 0)
  const droneMovingSeconds = droneRuntimes.reduce((sum, runtime) => sum + runtime.movingSeconds, 0)
  return {
    currentThroughputPerMin,
    totalProduced: simulation.totalFinished,
    workInProgress,
    inventoryTotal: inventory.reduce((sum, record) => sum + record.quantity, 0),
    queueDepth,
    blockedObjectCount,
    machineUtilization,
    conveyorUtilization: conveyorCapacity > 0 ? (simulation.transitItems.length / conveyorCapacity) * 100 : 0,
    averageTransportSec:
      durations.length > 0 ? durations.reduce((sum, value) => sum + value, 0) / durations.length : 0,
    agvUtilization: agvObservedSeconds > 0 ? agvMovingSeconds / agvObservedSeconds * 100 : 0,
    droneUtilization: droneObservedSeconds > 0 ? droneMovingSeconds / droneObservedSeconds * 100 : 0,
    targetThroughputPerMin: 8,
  }
}

const updateObjectStatuses = (objects: FactoryObject[], simulation: SimulationState): void => {
  objects.forEach((object) => {
    if (object.kind === 'machine') {
      const runtime = simulation.machineRuntime[object.id]
      if (runtime) object.status = runtime.state === 'processing' ? 'running' : runtime.state
    }
    if (object.kind === 'agv') {
      const runtime = simulation.agvRuntime?.[object.id]
      object.status = !runtime
        ? 'ready'
        : runtime.motionStatus === 'moving' || runtime.motionStatus === 'yielding'
          ? 'running'
          : runtime.motionStatus === 'blocked'
            ? 'blocked'
            : runtime.phase === 'unconfigured'
              ? 'offline'
              : runtime.motionStatus === 'waiting'
                ? 'waiting-input'
                : 'ready'
    }
    if (object.kind === 'drone') {
      const runtime = simulation.droneRuntime?.[object.id]
      object.status = !runtime
        ? 'ready'
        : runtime.motionStatus === 'moving' || runtime.motionStatus === 'yielding'
          ? 'running'
          : runtime.motionStatus === 'blocked'
            ? 'blocked'
            : runtime.phase === 'unconfigured'
              ? 'offline'
              : runtime.motionStatus === 'waiting'
                ? 'waiting-input'
                : 'ready'
    }
  })
}

export const forgeSimulationKernel: AdvanceSimulationKernel = {
  stepSeconds: STEP_SECONDS,
  maxMetricSamples: MAX_METRIC_SAMPLES,
  rebuildReservations: rebuildDirectionalInventoryReservations,
  updateTransit,
  dispatchWarehouseInventory,
  updateAgv: updateAgvSimulation,
  updateDrone: updateDroneSimulation,
  getRecipe,
  getMachineObject,
  updateMachineState,
  dispatchMachineOutput,
  calculateMetrics,
  updateObjectStatuses,
}

const projectSnapshot = (state: ForgeStore): ForgeProjectData => ({
  factory: state.factory,
  floors: state.floors,
  objects: state.objects,
  items: state.items,
  recipes: state.recipes,
  inventory: state.inventory,
  transportCapabilities: state.transportCapabilities,
  simulation: state.simulation,
  metrics: state.metrics,
  metricSeries: state.metricSeries,
  activities: state.activities,
})

const simulationDraft = (state: ForgeStore): ForgeProjectData => ({
  // Static design data is read-only during a simulation tick, so keep its
  // references stable instead of cloning large paths, schemas and metadata.
  factory: state.factory,
  floors: state.floors,
  objects: state.objects.map((object) => ({ ...object })),
  items: state.items,
  recipes: state.recipes,
  inventory: state.inventory.map((record) => ({ ...record })),
  transportCapabilities: state.transportCapabilities,
  simulation: deepClone(state.simulation),
  metrics: state.metrics,
  metricSeries: [...state.metricSeries],
  activities: [...state.activities],
})

const reconcileSimulationDraft = (draft: ForgeProjectData, state: ForgeStore): void => {
  let objectChanged = draft.objects.length !== state.objects.length
  draft.objects = draft.objects.map((object, index) => {
    const previous = state.objects[index]
    if (previous?.id === object.id && previous.status === object.status) return previous
    objectChanged = true
    return object
  })
  if (!objectChanged) draft.objects = state.objects
  if (draft.metricSeries.length === state.metricSeries.length
    && draft.metricSeries.at(-1) === state.metricSeries.at(-1)) draft.metricSeries = state.metricSeries
  if (draft.activities.length === state.activities.length
    && draft.activities.at(-1) === state.activities.at(-1)) draft.activities = state.activities
}

const itemReferenceReasons = (state: ForgeStore, itemId: Id): string[] => {
  const reasons: string[] = []
  if (state.recipes.some((recipe) => recipe.inputs.some((line) => line.itemId === itemId) || recipe.outputs.some((line) => line.itemId === itemId))) reasons.push('配方')
  if (state.inventory.some((record) => record.itemId === itemId && (
    record.quantity > 0
    || record.infiniteSupply === true
    || reservedOutboundQuantity(record) > 0
    || reservedInboundCapacity(record) > 0
  ))) reasons.push('非空、无限或已预约库存')
  if (state.objects.some((object) => object.config.kind === 'vehicle' && object.config.agvProgram?.itemId === itemId)) reasons.push('AGV 运输程序')
  if (state.objects.some((object) => object.config.kind === 'vehicle' && object.config.transportProgram?.itemId === itemId)) reasons.push('无人机运输程序')
  if (Object.values(state.simulation.agvRuntime ?? {}).some((runtime) => runtime.cargoItemId === itemId && runtime.cargoQuantity > 0)) reasons.push('AGV 车载货物')
  if (Object.values(state.simulation.droneRuntime ?? {}).some((runtime) => runtime.cargoItemId === itemId && runtime.cargoQuantity > 0)) reasons.push('无人机载货')
  return reasons
}

const isReferencedItem = (state: ForgeStore, itemId: Id): boolean => itemReferenceReasons(state, itemId).length > 0

const addToast = (state: ForgeStore, toast: Omit<ToastMessage, 'id'>): ToastMessage[] => [
  ...state.toasts,
  { ...toast, id: createId('toast') },
].slice(-4)

export interface InclineConveyorInput {
  lowerFloorId: Id
  upperFloorId: Id
  lowPoint: GridPoint
  highPoint: GridPoint
  direction: 'up' | 'down'
  connectedObjectId?: Id | null
  connectedPortIndex?: MachinePortIndex | null
}

export interface AgentDesignCommit {
  factory: Factory
  objects: unknown[]
  inventory: InventoryRecord[]
}

export interface ForgeStore extends ForgeProjectData {
  selectedObjectId: Id | null
  saveStatus: SaveStatus
  lastSavedAt: string | null
  toasts: ToastMessage[]
  hydrated: boolean

  createFactory: (input: Partial<Pick<Factory, 'name' | 'widthM' | 'lengthM' | 'gridSizeM'>>) => void
  addFloor: (heightM?: number) => Id
  selectObject: (id: Id | null) => void
  renameObject: (id: Id, name: string) => boolean
  addObject: (input: NewFactoryObject) => Id
  addConveyorPath: (
    path: GridPoint[],
    fromObjectId?: Id | null,
    toObjectId?: Id | null,
    fromPortIndex?: MachinePortIndex | null,
    toPortIndex?: MachinePortIndex | null,
    floorId?: Id,
  ) => Id
  addInclineConveyor: (input: InclineConveyorInput) => Id
  reverseInclineDirection: (id: Id) => boolean
  connectObjects: (fromObjectId: Id, toObjectId: Id) => Id
  moveObject: (id: Id, position: Pick<GridTransform, 'x' | 'z'>) => boolean
  rotateObject: (id: Id, direction?: 'clockwise' | 'counterclockwise') => void
  deleteObject: (id: Id) => void
  updateObjectConfig: (id: Id, patch: Partial<FactoryObjectConfig>) => void
  upsertItem: (item: Item) => boolean
  removeItem: (id: Id) => boolean
  upsertRecipe: (recipe: Recipe) => void
  removeRecipe: (id: Id) => boolean
  playSimulation: () => void
  pauseSimulation: () => void
  setSimulationSpeed: (speed: SimulationSpeed) => void
  resetSimulation: () => void
  tickSimulation: (realDeltaSec: number) => void
  adjustInventory: (recordId: Id, delta: number) => boolean
  setInventoryInfiniteSupply: (recordId: Id, enabled: boolean) => boolean
  saveFactory: () => Promise<boolean>
  restoreFactory: () => Promise<boolean>
  applyRealtimeMetric: (sample: MetricSample) => void
  applyRealtimeActivity: (event: ActivityEvent) => void
  clearWorkspace: () => void
  markDirty: () => void
  commitAgentDesign: (design: AgentDesignCommit) => boolean
  syncAgentFactory: (factory: Factory) => void
  dismissToast: (id: Id) => void
  clearToasts: () => void
}

const blank = createEmptyProjectData()

export const useForgeStore = create<ForgeStore>((set, get) => ({
  ...blank,
  selectedObjectId: null,
  saveStatus: 'idle',
  lastSavedAt: null,
  toasts: [],
  hydrated: false,

  createFactory: (input) => {
    const factoryId = createId('factory')
    const next = createEmptyProjectData({
      factoryId,
      floorId: createId('floor'),
      name: input.name?.trim() || '未命名数字工厂',
      widthM: Math.max(12, Math.round(input.widthM ?? 32)),
      lengthM: Math.max(12, Math.round(input.lengthM ?? 20)),
      gridSizeM: Math.max(0.25, input.gridSizeM ?? 1),
    })
    set({
      ...next,
      selectedObjectId: null,
      saveStatus: 'dirty',
      hydrated: true,
      toasts: addToast(get(), { title: '新工厂已创建', tone: 'success' }),
    })
  },

  addFloor: (heightM = DEFAULT_FLOOR_HEIGHT_M) => {
    const state = get()
    const floors = normalizeFloors(state.floors, state.factory.id)
    const top = floors.at(-1)!
    const normalizedHeight = clamp(Number(heightM) || DEFAULT_FLOOR_HEIGHT_M, 2.5, 12)
    const level = top.level + 1
    const id = createId('floor')
    const floor: Floor = {
      id,
      factoryId: state.factory.id,
      level,
      name: `${level}F 生产区`,
      elevationM: top.elevationM + normalizedHeight,
      heightM: normalizedHeight,
    }
    set({
      floors: [...floors, floor],
      factory: bumpDesignVersion({ ...state.factory, schemaVersion: Math.max(4, state.factory.schemaVersion) }),
      saveStatus: 'dirty',
      toasts: addToast(state, { title: `${level}F 已创建`, description: `层高 ${normalizedHeight.toFixed(1)}m，可切换到新楼层继续建造`, tone: 'success' }),
    })
    return id
  },

  selectObject: (id) => set({ selectedObjectId: id }),

  renameObject: (id, name) => {
    const state = get()
    const normalized = name.trim()
    if (!normalized) {
      set({ toasts: addToast(state, { title: '名称不能为空', description: '请输入一个可识别的设备名称', tone: 'warning' }) })
      return false
    }
    if (!state.objects.some((object) => object.id === id)) return false
    set({
      objects: state.objects.map((object) => object.id === id ? { ...object, name: normalized, updatedAt: nowIso() } : object),
      factory: bumpDesignVersion(state.factory),
      saveStatus: 'dirty',
    })
    return true
  },

  addObject: (input) => {
    const state = get()
    const id = input.id ?? createId(`object-${input.kind}`)
    const footprint = input.footprint ?? defaultFootprint(input.kind)
    const snap = (value: number) => Math.round(value / state.factory.gridSizeM) * state.factory.gridSizeM
    const floorId = input.floorId ?? state.floors[0]?.id ?? `floor-${state.factory.id}`
    if (input.kind === 'agv' && state.floors.find((floor) => floor.id === floorId)?.level !== 1) {
      set({ toasts: addToast(state, { title: 'AGV 只能建造在 1F', description: '上层和跨层物流请使用货运无人机', tone: 'warning' }) })
      return ''
    }
    const baseConfig = input.config ?? defaultConfigForKind(input.kind)
    const config = baseConfig.kind === 'conveyor'
      ? {
          ...baseConfig,
          conveyorType: baseConfig.conveyorType ?? 'flat',
          fromFloorId: baseConfig.fromFloorId ?? floorId,
          toFloorId: baseConfig.toFloorId ?? floorId,
          riseM: baseConfig.riseM ?? 0,
        }
      : input.kind === 'agv' && baseConfig.kind === 'vehicle'
        ? {
            ...baseConfig,
            maxPayloadKg: Math.max(1, Number(baseConfig.maxPayloadKg) || DEFAULT_AGV_MAX_PAYLOAD_KG),
            speedMps: clamp(Number(baseConfig.speedMps) || DEFAULT_AGV_SPEED_MPS, 0.25, 6),
            agvProgram: normalizeAgvProgram(baseConfig.agvProgram),
          }
        : input.kind === 'drone' && baseConfig.kind === 'vehicle'
          ? {
              ...baseConfig,
              maxPayloadKg: Math.max(1, Number(baseConfig.maxPayloadKg) || DEFAULT_DRONE_MAX_PAYLOAD_KG),
              speedMps: clamp(Number(baseConfig.speedMps) || DEFAULT_DRONE_SPEED_MPS, 0.5, 12),
              transportProgram: normalizeAgvProgram(baseConfig.transportProgram ?? defaultDroneProgram()),
            }
          : input.kind === 'rack' && baseConfig.kind === 'rack'
            ? normalizeWarehouseConfig(baseConfig)
        : baseConfig
    const object: FactoryObject = {
      id,
      factoryId: state.factory.id,
      floorId,
      kind: input.kind,
      name: input.name?.trim() || `${objectLabel(input.kind)} ${state.objects.length + 1}`,
      modelRef: input.modelRef ?? null,
      transform: {
        x: snap(input.transform.x),
        z: snap(input.transform.z),
        rotationY: input.transform.rotationY ?? 0,
      },
      footprint,
      status: 'ready',
      config,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    }
    if (!canFitAt(object, object.transform.x, object.transform.z, state.factory, state.objects)) {
      set({ toasts: addToast(state, { title: '无法放置设施', description: '位置超出工厂或与现有设施重叠', tone: 'warning' }) })
      return ''
    }
    const objects = [...state.objects, object]
    const inventory = object.kind === 'rack' || object.kind === 'shelf'
      ? ensureWarehouseInventoryRecords(state.inventory, objects, state.items)
      : state.inventory
    const simulation = deepClone(state.simulation)
    if (object.kind === 'agv') {
      simulation.agvRuntime ??= {}
      simulation.agvRuntime[id] = createAgvRuntime(object)
    }
    if (object.kind === 'drone') {
      simulation.droneRuntime ??= {}
      simulation.droneRuntime[id] = createDroneRuntime(object, state.floors)
    }
    set({ objects, inventory, simulation, selectedObjectId: id, factory: bumpDesignVersion(state.factory), saveStatus: 'dirty' })
    return id
  },

  addConveyorPath: (path, fromObjectId = null, toObjectId = null, fromPortIndex = null, toPortIndex = null, requestedFloorId) => {
    const state = get()
    if (path.length < 2 || polylineLength(path) < state.factory.gridSizeM) {
      set({ toasts: addToast(state, { title: '传送带太短', description: '请至少跨越一个网格单元', tone: 'warning' }) })
      return ''
    }
    const fromObject = state.objects.find((object) => object.id === fromObjectId)
    const toObject = state.objects.find((object) => object.id === toObjectId)
    if (fromObject?.kind === 'shelf' || toObject?.kind === 'shelf') {
      set({ toasts: addToast(state, { title: '货架不连接传送带', description: '货架没有出货口或入货口，请在属性面板中维护其库存', tone: 'warning' }) })
      return ''
    }
    if (fromObject?.config.kind === 'conveyor' && fromObject.config.toObjectId) {
      set({ toasts: addToast(state, { title: '传送带末端已连接', description: '请选择仍为空闲的传送带末端继续拉线', tone: 'warning' }) })
      return ''
    }
    if (toObject?.config.kind === 'conveyor' && toObject.config.fromObjectId) {
      set({ toasts: addToast(state, { title: '传送带起点已连接', description: '请选择仍为空闲的传送带起点完成连接', tone: 'warning' }) })
      return ''
    }
    const resolvedFromPort = fromObject && supportsTripleConveyorPorts(fromObject)
      ? fromPortIndex ?? firstAvailablePort(state.objects, fromObject.id, 'output')
      : null
    const resolvedToPort = toObject && supportsTripleConveyorPorts(toObject)
      ? toPortIndex ?? firstAvailablePort(state.objects, toObject.id, 'input')
      : null
    if (fromObject && supportsTripleConveyorPorts(fromObject) && (resolvedFromPort == null || isPortOccupied(state.objects, fromObject.id, 'output', resolvedFromPort))) {
      set({ toasts: addToast(state, { title: '出货口已占用', description: '每个出货口只能连接一条传送带，请选择空闲端口', tone: 'warning' }) })
      return ''
    }
    if (toObject && supportsTripleConveyorPorts(toObject) && (resolvedToPort == null || isPortOccupied(state.objects, toObject.id, 'input', resolvedToPort))) {
      set({ toasts: addToast(state, { title: '入货口已占用', description: '每个入货口只能连接一条传送带，请选择空闲端口', tone: 'warning' }) })
      return ''
    }
    const startPort = fromObject
      ? fromObject.config.kind === 'conveyor'
        ? fromObject.config.path.at(-1) ?? null
        : conveyorPortAnchor(fromObject, 'output', path[1] ?? path.at(-1)!, resolvedFromPort ?? 1)
      : null
    const endPort = toObject
      ? toObject.config.kind === 'conveyor'
        ? toObject.config.path[0] ?? null
        : conveyorPortAnchor(toObject, 'input', path.at(-2) ?? path[0], resolvedToPort ?? 1)
      : null
    const connectedPath = alignPathToPorts(path, startPort, endPort)
    const floorId = requestedFloorId
      ?? (fromObject?.config.kind === 'conveyor' ? conveyorEndpointFloorId({ floorId: fromObject.floorId, config: fromObject.config }, 'end') : fromObject?.floorId)
      ?? (toObject?.config.kind === 'conveyor' ? conveyorEndpointFloorId({ floorId: toObject.floorId, config: toObject.config }, 'start') : toObject?.floorId)
      ?? state.floors[0]?.id
      ?? `floor-${state.factory.id}`
    if (conveyorPlacementBlocked(connectedPath, floorId, state.objects, fromObject?.id ?? null, toObject?.id ?? null)) {
      set({ toasts: addToast(state, { title: '传送带无法放置', description: '路径与已有建筑物或传送带占用同一网格', tone: 'warning' }) })
      return ''
    }
    const minX = Math.min(...connectedPath.map((point) => point.x))
    const maxX = Math.max(...connectedPath.map((point) => point.x))
    const minZ = Math.min(...connectedPath.map((point) => point.z))
    const maxZ = Math.max(...connectedPath.map((point) => point.z))
    const fromName = fromObject?.name
    const toName = toObject?.name
    const sequence = state.objects.filter((object) => object.kind === 'conveyor').length + 1
    const id = get().addObject({
      kind: 'conveyor',
      floorId,
      name: fromName && toName ? `${fromName} → ${toName}` : `自定义传送带 C-${String(sequence).padStart(2, '0')}`,
      modelRef: 'assets/3d/vendor/kenney-factory-kit-3.0/Models/GLB format/conveyor-long-stripe-sides.glb',
      transform: { x: minX, z: minZ },
      footprint: { width: Math.max(1, maxX - minX), depth: Math.max(1, maxZ - minZ) },
      config: {
        kind: 'conveyor',
        conveyorType: 'flat',
        fromObjectId,
        toObjectId,
        fromPortIndex: resolvedFromPort,
        toPortIndex: resolvedToPort,
        fromFloorId: floorId,
        toFloorId: floorId,
        riseM: 0,
        outputItemId: automaticOutputItemId(fromObject, state.objects, state.recipes, state.inventory),
        speedMps: 1.2,
        capacity: 6,
        path: connectedPath,
      },
    })
    if (!id) return ''
    const latest = get()
    const objects = latest.objects.map((object) => {
      if (object.id === fromObjectId && object.config.kind === 'conveyor') {
        return { ...object, config: { ...object.config, toObjectId: id }, updatedAt: nowIso() }
      }
      if (object.id === toObjectId && object.config.kind === 'conveyor') {
        return { ...object, config: { ...object.config, fromObjectId: id }, updatedAt: nowIso() }
      }
      return object
    })
    set({ objects, factory: bumpDesignVersion(latest.factory), saveStatus: 'dirty' })
    return id
  },

  addInclineConveyor: ({ lowerFloorId, upperFloorId, lowPoint, highPoint, direction, connectedObjectId = null, connectedPortIndex = null }) => {
    const state = get()
    const lowerFloor = state.floors.find((floor) => floor.id === lowerFloorId)
    const upperFloor = state.floors.find((floor) => floor.id === upperFloorId)
    if (!lowerFloor || !upperFloor || upperFloor.level !== lowerFloor.level + 1) {
      set({ toasts: addToast(state, { title: '无法创建跨层传送带', description: '跨层传送带必须连接相邻的上下楼层', tone: 'warning' }) })
      return ''
    }
    const connectedObject = state.objects.find((object) => object.id === connectedObjectId)
    if (connectedObject?.kind === 'shelf') {
      set({ toasts: addToast(state, { title: '货架不连接传送带', description: '跨层传送带也不能吸附到货架', tone: 'warning' }) })
      return ''
    }
    if (connectedObject?.config.kind === 'conveyor') {
      const occupied = direction === 'up' ? connectedObject.config.toObjectId : connectedObject.config.fromObjectId
      if (occupied) {
        set({ toasts: addToast(state, { title: '吸附端已占用', description: '所选传送带端头已经连接其他线路', tone: 'warning' }) })
        return ''
      }
    }
    if (connectedObject && supportsTripleConveyorPorts(connectedObject) && connectedPortIndex != null) {
      const role = direction === 'up' ? 'output' : 'input'
      if (isPortOccupied(state.objects, connectedObject.id, role, connectedPortIndex)) {
        set({ toasts: addToast(state, { title: '设施端口已占用', description: '请选择另一个空闲端口', tone: 'warning' }) })
        return ''
      }
    }
    const path = direction === 'up' ? [lowPoint, highPoint] : [highPoint, lowPoint]
    const fromFloorId = direction === 'up' ? lowerFloorId : upperFloorId
    const toFloorId = direction === 'up' ? upperFloorId : lowerFloorId
    const fromObjectId = direction === 'up' ? connectedObjectId : null
    const toObjectId = direction === 'down' ? connectedObjectId : null
    const riseM = Math.abs(upperFloor.elevationM - lowerFloor.elevationM)
    const horizontalRunM = polylineLength(path)
    const expectedRunM = inclineHorizontalRun(riseM)
    if (Math.abs(horizontalRunM - expectedRunM) > 0.01) {
      set({ toasts: addToast(state, { title: '跨层传送带坡度无效', description: `高差 ${riseM.toFixed(1)}m 需要 ${expectedRunM.toFixed(1)}m 水平投影`, tone: 'warning' }) })
      return ''
    }
    const blockedOnLower = conveyorPlacementBlocked(path, lowerFloorId, state.objects, fromObjectId, toObjectId)
    const blockedOnUpper = conveyorPlacementBlocked(path, upperFloorId, state.objects, fromObjectId, toObjectId)
    if (blockedOnLower || blockedOnUpper) {
      set({ toasts: addToast(state, { title: '跨层传送带无法放置', description: '斜坡投影与上层或下层的已有建筑/线路冲突', tone: 'warning' }) })
      return ''
    }
    const sequence = state.objects.filter((object) => object.config.kind === 'conveyor' && object.config.conveyorType === 'incline').length + 1
    const id = get().addObject({
      kind: 'conveyor',
      floorId: fromFloorId,
      name: `跨层传送带 V-${String(sequence).padStart(2, '0')}`,
      modelRef: 'assets/3d/vendor/kenney-factory-kit-3.0/Models/GLB format/conveyor-long-stripe-sides.glb',
      transform: { x: Math.min(lowPoint.x, highPoint.x), z: Math.min(lowPoint.z, highPoint.z) },
      footprint: { width: Math.max(1, Math.abs(highPoint.x - lowPoint.x)), depth: Math.max(1, Math.abs(highPoint.z - lowPoint.z)) },
      config: {
        kind: 'conveyor',
        conveyorType: 'incline',
        fromObjectId,
        toObjectId,
        fromPortIndex: direction === 'up' && connectedObject && supportsTripleConveyorPorts(connectedObject) ? connectedPortIndex : null,
        toPortIndex: direction === 'down' && connectedObject && supportsTripleConveyorPorts(connectedObject) ? connectedPortIndex : null,
        fromFloorId,
        toFloorId,
        riseM,
        outputItemId: automaticOutputItemId(direction === 'up' ? connectedObject : undefined, state.objects, state.recipes, state.inventory),
        speedMps: 1.05,
        capacity: 6,
        path,
      },
    })
    if (!id) return ''
    if (connectedObject?.config.kind === 'conveyor') {
      const latest = get()
      set({
        objects: latest.objects.map((object) => {
          if (object.id !== connectedObject.id || object.config.kind !== 'conveyor') return object
          return direction === 'up'
            ? { ...object, config: { ...object.config, toObjectId: id }, updatedAt: nowIso() }
            : { ...object, config: { ...object.config, fromObjectId: id }, updatedAt: nowIso() }
        }),
        factory: bumpDesignVersion(state.factory),
        saveStatus: 'dirty',
      })
    }
    return id
  },

  reverseInclineDirection: (id) => {
    const state = get()
    const target = state.objects.find((object) => object.id === id)
    if (!target || target.config.kind !== 'conveyor' || target.config.conveyorType !== 'incline') return false
    const config = target.config
    const objects = state.objects.map((object) => {
      if (object.id === id) {
        return {
          ...object,
          floorId: config.toFloorId ?? object.floorId,
          config: {
            ...config,
            path: [...config.path].reverse(),
            fromFloorId: config.toFloorId ?? object.floorId,
            toFloorId: config.fromFloorId ?? object.floorId,
            fromObjectId: null,
            toObjectId: null,
            fromPortIndex: null,
            toPortIndex: null,
            outputItemId: null,
          },
          updatedAt: nowIso(),
        }
      }
      if (object.config.kind !== 'conveyor') return object
      if (object.config.fromObjectId !== id && object.config.toObjectId !== id) return object
      return {
        ...object,
        config: {
          ...object.config,
          fromObjectId: object.config.fromObjectId === id ? null : object.config.fromObjectId,
          toObjectId: object.config.toObjectId === id ? null : object.config.toObjectId,
        },
        updatedAt: nowIso(),
      }
    })
    set({
      objects,
      simulation: { ...state.simulation, transitItems: state.simulation.transitItems.filter((item) => item.conveyorObjectId !== id) },
      factory: bumpDesignVersion(state.factory),
      saveStatus: 'dirty',
      toasts: addToast(state, { title: '运输方向已反转', description: '为避免端口语义倒置，原有两端连接已解除，请从新的输出端继续拉线', tone: 'info' }),
    })
    return true
  },

  connectObjects: (fromObjectId, toObjectId) => {
    const state = get()
    const fromObject = state.objects.find((object) => object.id === fromObjectId && object.kind !== 'conveyor')
    const toObject = state.objects.find((object) => object.id === toObjectId && object.kind !== 'conveyor')
    if (!fromObject || !toObject || fromObject.id === toObject.id) {
      set({ toasts: addToast(state, { title: '无法创建传送带连接', description: '请选择两个不同的固定设施', tone: 'warning' }) })
      return ''
    }
    if (fromObject.kind === 'shelf' || toObject.kind === 'shelf') {
      set({ toasts: addToast(state, { title: '货架不连接传送带', description: '货架没有出货口或入货口，请改为连接货物仓库或机器', tone: 'warning' }) })
      return ''
    }
    if (fromObject.floorId !== toObject.floorId) {
      set({ toasts: addToast(state, { title: '设施位于不同楼层', description: '请使用跨层传送带连接相邻楼层，再从其端头继续拉线', tone: 'warning' }) })
      return ''
    }
    const fromPortIndex = supportsTripleConveyorPorts(fromObject) ? firstAvailablePort(state.objects, fromObject.id, 'output') : null
    const toPortIndex = supportsTripleConveyorPorts(toObject) ? firstAvailablePort(state.objects, toObject.id, 'input') : null
    if ((supportsTripleConveyorPorts(fromObject) && fromPortIndex == null) || (supportsTripleConveyorPorts(toObject) && toPortIndex == null)) {
      set({ toasts: addToast(state, { title: '没有空闲端口', description: '设施的三个对应端口均已连接传送带', tone: 'warning' }) })
      return ''
    }
    const id = createId('connection-conveyor')
    const path = connectionPathFor(fromObject, toObject, fromPortIndex ?? 1, toPortIndex ?? 1)
    if (conveyorPlacementBlocked(path, fromObject.floorId, state.objects, fromObject.id, toObject.id)) {
      set({ toasts: addToast(state, { title: '无法创建传送带连接', description: '自动路径与已有建筑物或传送带重叠', tone: 'warning' }) })
      return ''
    }
    const connection: FactoryObject = {
      id,
      factoryId: state.factory.id,
      floorId: fromObject.floorId,
      kind: 'conveyor',
      name: `${fromObject.name} → ${toObject.name}`,
      modelRef: 'assets/3d/vendor/kenney-factory-kit-3.0/Models/GLB format/conveyor-long-stripe-sides.glb',
      transform: { x: (path[0].x + path[1].x) / 2, z: (path[0].z + path[1].z) / 2, rotationY: 0 },
      footprint: { width: Math.max(1, Math.abs(path[1].x - path[0].x)), depth: Math.max(1, Math.abs(path[1].z - path[0].z)) },
      status: 'ready',
      config: {
        kind: 'conveyor',
        conveyorType: 'flat',
        fromObjectId,
        toObjectId,
        fromPortIndex,
        toPortIndex,
        fromFloorId: fromObject.floorId,
        toFloorId: fromObject.floorId,
        riseM: 0,
        outputItemId: automaticOutputItemId(fromObject, state.objects, state.recipes, state.inventory),
        speedMps: 1.2,
        capacity: 5,
        path,
      },
      createdAt: nowIso(),
      updatedAt: nowIso(),
    }
    set({ objects: [...state.objects, connection], factory: bumpDesignVersion(state.factory), selectedObjectId: id, saveStatus: 'dirty', toasts: addToast(state, { title: '传送带连接已创建', description: `${fromObject.name} → ${toObject.name}`, tone: 'success' }) })
    return id
  },

  moveObject: (id, position) => {
    const state = get()
    const object = state.objects.find((candidate) => candidate.id === id)
    if (!object) return false
    const x = Math.round(position.x / state.factory.gridSizeM) * state.factory.gridSizeM
    const z = Math.round(position.z / state.factory.gridSizeM) * state.factory.gridSizeM
    if (!canFitAt(object, x, z, state.factory, state.objects)) {
      set({ toasts: addToast(state, { title: '移动被阻止', description: '目标网格已被占用或超出边界', tone: 'warning' }) })
      return false
    }
    const candidateObjects = state.objects.map((candidate) =>
        candidate.id === id
          ? { ...candidate, transform: { ...candidate.transform, x, z }, updatedAt: nowIso() }
          : candidate,
      )
    const objects = refreshConnectionPaths(candidateObjects)
    const affectedConveyors = objects.filter((candidate) => candidate.config.kind === 'conveyor'
      && (candidate.config.fromObjectId === id || candidate.config.toObjectId === id))
    const connectionBlocked = affectedConveyors.some((conveyor) => conveyor.config.kind === 'conveyor'
      && conveyorPlacementBlocked(
        conveyor.config.path,
        conveyor.floorId,
        objects,
        conveyor.config.fromObjectId,
        conveyor.config.toObjectId === 'finished-goods' ? null : conveyor.config.toObjectId,
        conveyor.id,
      ))
    if (connectionBlocked) {
      set({ toasts: addToast(state, { title: '移动被阻止', description: '移动后的传送带会与其他建筑或线路发生冲突', tone: 'warning' }) })
      return false
    }
    const simulation = deepClone(state.simulation)
    const movedObject = objects.find((candidate) => candidate.id === id)
    const agvRuntime = simulation.agvRuntime?.[id]
    if (movedObject?.kind === 'agv' && agvRuntime) {
      agvRuntime.position = facilityCenter(objectBounds(movedObject))
      agvRuntime.path = []
      agvRuntime.waypointIndex = 0
      agvRuntime.motionStatus = agvRuntime.cargoQuantity > 0 ? 'waiting' : 'idle'
      agvRuntime.blockedReason = null
      agvRuntime.blockedByVehicleId = null
      agvRuntime.yieldingToVehicleId = null
    }
    const droneRuntime = simulation.droneRuntime?.[id]
    if (movedObject?.kind === 'drone' && droneRuntime) {
      const center = facilityCenter(objectBounds(movedObject))
      const floor = state.floors.find((candidate) => candidate.id === movedObject.floorId)
      droneRuntime.position = { x: center.x, y: (floor?.elevationM ?? 0) + DRONE_INITIAL_HOVER_M, z: center.z }
      droneRuntime.path = []
      droneRuntime.waypointIndex = 0
      droneRuntime.motionStatus = droneRuntime.cargoQuantity > 0 ? 'waiting' : 'idle'
      droneRuntime.blockedReason = null
      droneRuntime.blockedByVehicleId = null
      droneRuntime.yieldingToVehicleId = null
    }
    set({
      objects,
      simulation,
      factory: bumpDesignVersion(state.factory),
      saveStatus: 'dirty',
    })
    return true
  },

  rotateObject: (id, direction = 'clockwise') => {
    const state = get()
    const delta = direction === 'clockwise' ? 90 : -90
    const target = state.objects.find((object) => object.id === id)
    if (!target) return
    const nextFootprint = { width: target.footprint.depth, depth: target.footprint.width }
    const rotatedCandidate = { ...target, footprint: nextFootprint }
    if (!canFitAt(rotatedCandidate, target.transform.x, target.transform.z, state.factory, state.objects)) {
      set({ toasts: addToast(state, { title: '旋转被阻止', description: '旋转后的设施会超出边界或与其他设施重叠', tone: 'warning' }) })
      return
    }
    let objects = state.objects.map((object) => {
        if (object.id !== id) return object
        const rotationY = ((object.transform.rotationY + delta + 360) % 360) as GridTransform['rotationY']
        return { ...object, footprint: nextFootprint, transform: { ...object.transform, rotationY }, updatedAt: nowIso() }
      })
    const simulation = deepClone(state.simulation)
    const agvRuntime = simulation.agvRuntime?.[id]
    if (agvRuntime && target.kind === 'agv') agvRuntime.headingY = ((target.transform.rotationY + delta + 360) % 360) * THREE_DEGREES_TO_RADIANS
    const droneRuntime = simulation.droneRuntime?.[id]
    if (droneRuntime && target.kind === 'drone') droneRuntime.headingY = ((target.transform.rotationY + delta + 360) % 360) * THREE_DEGREES_TO_RADIANS
    set({
      objects: refreshConnectionPaths(objects),
      simulation,
      factory: bumpDesignVersion(state.factory),
      saveStatus: 'dirty',
    })
  },

  deleteObject: (id) => {
    const state = get()
    const target = state.objects.find((object) => object.id === id)
    const simulation = deepClone(state.simulation)
    let inventory = deepClone(state.inventory)
    const removedAgvRuntime = simulation.agvRuntime?.[id]
    if (removedAgvRuntime) {
      const source = removedAgvRuntime.sourceInventoryRecordId
        ? inventory.find((record) => record.id === removedAgvRuntime.sourceInventoryRecordId)
        : undefined
      if (removedAgvRuntime.cargoQuantity > 0 && source && !source.infiniteSupply) {
        source.quantity += removedAgvRuntime.cargoQuantity
      }
      releaseAgvReservations(removedAgvRuntime, inventory)
      delete simulation.agvRuntime[id]
    }
    const removedDroneRuntime = simulation.droneRuntime?.[id]
    if (removedDroneRuntime) {
      const source = removedDroneRuntime.sourceInventoryRecordId
        ? inventory.find((record) => record.id === removedDroneRuntime.sourceInventoryRecordId)
        : undefined
      if (removedDroneRuntime.cargoQuantity > 0 && source && !source.infiniteSupply) source.quantity += removedDroneRuntime.cargoQuantity
      releaseDroneReservations(removedDroneRuntime, inventory)
      delete simulation.droneRuntime[id]
    }
    delete simulation.machineRuntime[id]
    delete simulation.warehouseDispatchCooldownSecByPort?.[id]
    delete simulation.warehouseDispatchCooldownSec?.[id]
    simulation.transitItems = simulation.transitItems.filter(
      (item) => item.fromObjectId !== id && item.toObjectId !== id && item.conveyorObjectId !== id,
    )
    const connectedIds = new Set(target?.config.kind === 'conveyor'
      ? []
      : state.objects.filter((object) => object.config.kind === 'conveyor' && (object.config.fromObjectId === id || object.config.toObjectId === id)).map((object) => object.id))
    simulation.transitItems = simulation.transitItems.filter((item) => !connectedIds.has(item.conveyorObjectId))
    const removedIds = new Set<Id>([id, ...connectedIds])
    const objects = state.objects
      .filter((object) => !removedIds.has(object.id))
      .map((object) => {
        if (object.config.kind === 'vehicle' && object.config.vehicleType === 'agv' && object.config.agvProgram) {
          const referencesRemovedObject = object.config.agvProgram.sourceObjectId === id || object.config.agvProgram.destinationObjectId === id
          if (referencesRemovedObject) {
            return {
              ...object,
              config: { ...object.config, agvProgram: { ...object.config.agvProgram, enabled: false } },
              status: 'offline' as const,
              updatedAt: nowIso(),
            }
          }
        }
        if (object.config.kind === 'vehicle' && object.config.vehicleType === 'drone' && object.config.transportProgram) {
          const referencesRemovedObject = object.config.transportProgram.sourceObjectId === id || object.config.transportProgram.destinationObjectId === id
          if (referencesRemovedObject) {
            return {
              ...object,
              config: { ...object.config, transportProgram: { ...object.config.transportProgram, enabled: false } },
              status: 'offline' as const,
              updatedAt: nowIso(),
            }
          }
        }
        if (object.config.kind !== 'conveyor') return object
        if (!removedIds.has(object.config.fromObjectId ?? '') && !removedIds.has(object.config.toObjectId ?? '')) return object
        return {
          ...object,
          config: {
            ...object.config,
            fromObjectId: removedIds.has(object.config.fromObjectId ?? '') ? null : object.config.fromObjectId,
            toObjectId: removedIds.has(object.config.toObjectId ?? '') ? null : object.config.toObjectId,
          },
          updatedAt: nowIso(),
        }
      })
    inventory = inventory.filter((record) => !isWarehouseRecord(record, id))
    set({
      objects,
      inventory,
      selectedObjectId: state.selectedObjectId === id ? null : state.selectedObjectId,
      simulation,
      factory: bumpDesignVersion(state.factory),
      saveStatus: 'dirty',
    })
  },

  updateObjectConfig: (id, patch) => {
    const state = get()
    const target = state.objects.find((object) => object.id === id)
    const normalizedPatch: Partial<FactoryObjectConfig> = target?.config.kind === 'rack'
      && ('dispatchIntervalSecByPort' in patch || 'dispatchIntervalSec' in patch)
      ? {
          ...patch,
          dispatchIntervalSecByPort: 'dispatchIntervalSecByPort' in patch
            ? MACHINE_PORT_INDICES.map((portIndex) => normalizeWarehouseDispatchInterval(
                (patch as Partial<RackObjectConfig>).dispatchIntervalSecByPort?.[portIndex]
                  ?? (target.config as RackObjectConfig).dispatchIntervalSecByPort?.[portIndex],
              )) as WarehouseDispatchIntervalsSec
            : MACHINE_PORT_INDICES.map(() => normalizeWarehouseDispatchInterval((patch as Partial<RackObjectConfig>).dispatchIntervalSec)) as WarehouseDispatchIntervalsSec,
        }
      : target?.config.kind === 'vehicle' && target.config.vehicleType === 'agv'
        ? {
            ...patch,
            ...('speedMps' in patch ? { speedMps: clamp(Number(patch.speedMps) || DEFAULT_AGV_SPEED_MPS, 0.25, 6) } : {}),
            ...('maxPayloadKg' in patch ? { maxPayloadKg: Math.max(1, Number(patch.maxPayloadKg) || DEFAULT_AGV_MAX_PAYLOAD_KG) } : {}),
            ...('agvProgram' in patch ? { agvProgram: normalizeAgvProgram(patch.agvProgram as Partial<AgvProgram> | undefined) } : {}),
          }
        : target?.config.kind === 'vehicle' && target.config.vehicleType === 'drone'
          ? {
              ...patch,
              ...('speedMps' in patch ? { speedMps: clamp(Number(patch.speedMps) || DEFAULT_DRONE_SPEED_MPS, 0.5, 12) } : {}),
              ...('maxPayloadKg' in patch ? { maxPayloadKg: Math.max(1, Number(patch.maxPayloadKg) || DEFAULT_DRONE_MAX_PAYLOAD_KG) } : {}),
              ...('transportProgram' in patch ? { transportProgram: normalizeAgvProgram(patch.transportProgram as Partial<AgvProgram> | undefined) } : {}),
            }
        : patch
    let objects = state.objects.map((object) => {
      if (object.id !== id || (normalizedPatch.kind && object.config.kind !== normalizedPatch.kind)) return object
      const nextConfig = object.config.kind === 'rack'
        ? normalizeWarehouseConfig({ ...object.config, ...normalizedPatch } as RackObjectConfig)
        : { ...object.config, ...normalizedPatch } as FactoryObjectConfig
      return {
        ...object,
        config: nextConfig,
        updatedAt: nowIso(),
      }
    })
    const simulation = deepClone(state.simulation)
    const inventory = deepClone(state.inventory)
    simulation.warehouseDispatchCooldownSecByPort ??= {}
    if (target?.config.kind === 'rack' && 'dispatchIntervalSecByPort' in normalizedPatch) {
      const nextIntervals = normalizedPatch.dispatchIntervalSecByPort as WarehouseDispatchIntervalsSec
      const legacyCooldown = simulation.warehouseDispatchCooldownSec?.[id] ?? 0
      const currentCooldowns = simulation.warehouseDispatchCooldownSecByPort[id] ?? [legacyCooldown, legacyCooldown, legacyCooldown]
      simulation.warehouseDispatchCooldownSecByPort[id] = MACHINE_PORT_INDICES.map((portIndex) => (
        Math.min(currentCooldowns[portIndex] ?? 0, nextIntervals[portIndex])
      )) as WarehouseDispatchIntervalsSec
    }
    if (target?.config.kind === 'machine' && 'recipeId' in normalizedPatch) {
      const recipeId = normalizedPatch.recipeId ?? null
      const recipe = recipeId ? getRecipe(state.recipes, recipeId) : undefined
      if (recipe) simulation.machineRuntime[id] = createMachineRuntime(id, recipe)
      else delete simulation.machineRuntime[id]
      const outputIds = new Set(recipe?.outputs.map((line) => line.itemId) ?? [])
      objects = objects.map((object) => {
        if (object.config.kind !== 'conveyor' || object.config.fromObjectId !== id) return object
        const outputItemId = recipe?.outputs.length === 1
          ? recipe.outputs[0].itemId
          : object.config.outputItemId && outputIds.has(object.config.outputItemId)
            ? object.config.outputItemId
            : null
        return { ...object, config: { ...object.config, outputItemId }, updatedAt: nowIso() }
      })
    }
    if (target?.config.kind === 'vehicle' && target.config.vehicleType === 'agv') {
      simulation.agvRuntime ??= {}
      const runtime = simulation.agvRuntime[id] ?? createAgvRuntime(target)
      if (runtime.cargoQuantity <= 0 && runtime.phase !== 'clearing-dock') {
        releaseAgvReservations(runtime, inventory)
        clearAgvMission(runtime)
        runtime.phase = 'unconfigured'
        runtime.motionStatus = 'idle'
      }
      simulation.agvRuntime[id] = runtime
    }
    if (target?.config.kind === 'vehicle' && target.config.vehicleType === 'drone') {
      simulation.droneRuntime ??= {}
      const runtime = simulation.droneRuntime[id] ?? createDroneRuntime(target, state.floors)
      if (runtime.cargoQuantity <= 0 && runtime.phase !== 'clearing-dock') {
        releaseDroneReservations(runtime, inventory)
        clearDroneMission(runtime)
        runtime.phase = 'unconfigured'
        runtime.motionStatus = 'idle'
      }
      simulation.droneRuntime[id] = runtime
    }
    set({
      objects,
      simulation,
      inventory,
      factory: bumpDesignVersion(state.factory),
      saveStatus: 'dirty',
    })
  },

  upsertItem: (item) => {
    const state = get()
    const name = item.name.trim()
    const code = item.code.trim()
    const description = item.description.trim()
    const runtimeModel = getRuntimeItemModelDefinition(item.itemModelId)
    const maxStackSize = Math.trunc(item.maxStackSize)
    const duplicateCode = state.items.some((candidate) => candidate.id !== item.id && candidate.code.trim().toLowerCase() === code.toLowerCase())
    if (!item.id || !name || !code || !runtimeModel || !Number.isFinite(item.massKg) || item.massKg < 0 || !Number.isSafeInteger(maxStackSize) || maxStackSize < 1 || duplicateCode) {
      const descriptionText = duplicateCode
        ? `物品编码 ${code || '（空）'} 已被其他物品使用`
        : '请填写名称和唯一编码，选择有效模型，并提供非负质量与正整数最大堆叠数'
      set({ toasts: addToast(state, { title: '物品无法保存', description: descriptionText, tone: 'warning' }) })
      return false
    }
    const normalizedItem: Item = {
      ...item,
      name,
      code,
      description,
      modelParameters: normalizeModelParameterOverrides(item.itemModelId, item.modelParameters),
      massKg: item.massKg,
      maxStackSize,
    }
    const exists = state.items.some((candidate) => candidate.id === normalizedItem.id)
    const items = exists ? state.items.map((candidate) => (candidate.id === normalizedItem.id ? deepClone(normalizedItem) : candidate)) : [...state.items, deepClone(normalizedItem)]
    set({
      items,
      inventory: ensureWarehouseInventoryRecords(state.inventory, state.objects, items),
      factory: bumpDesignVersion(state.factory),
      saveStatus: 'dirty',
      toasts: addToast(state, {
        title: exists ? '物品已更新' : '物品已创建',
        description: `${normalizedItem.name} · ${normalizedItem.code}`,
        tone: 'success',
      }),
    })
    return true
  },

  removeItem: (id) => {
    const state = get()
    if (isReferencedItem(state, id)) {
      set({ toasts: addToast(state, { title: '无法删除物品', description: `请先解除：${itemReferenceReasons(state, id).join('、')}`, tone: 'warning' }) })
      return false
    }
    const removed = state.items.find((item) => item.id === id)
    set({
      items: state.items.filter((item) => item.id !== id),
      inventory: state.inventory.filter((record) => record.itemId !== id),
      factory: bumpDesignVersion(state.factory),
      saveStatus: 'dirty',
      toasts: addToast(state, { title: '物品已删除', description: removed ? `${removed.name} · ${removed.code}` : undefined, tone: 'info' }),
    })
    return true
  },

  upsertRecipe: (recipe) => {
    const state = get()
    const uniqueInputs = new Set(recipe.inputs.map((line) => line.itemId))
    const uniqueOutputs = new Set(recipe.outputs.map((line) => line.itemId))
    const knownItemIds = new Set(state.items.map((item) => item.id))
    const allLines = [...recipe.inputs, ...recipe.outputs]
    if (recipe.inputs.length < 1 || recipe.outputs.length < 1 || recipe.inputs.length > 3 || recipe.outputs.length > 3
      || uniqueInputs.size !== recipe.inputs.length || uniqueOutputs.size !== recipe.outputs.length
      || !allLines.every((line) => knownItemIds.has(line.itemId) && Number.isFinite(line.quantity) && line.quantity >= 1)
      || !Number.isFinite(recipe.processingTimeSec) || recipe.processingTimeSec <= 0) {
      set({ toasts: addToast(state, { title: '配方无法保存', description: '配方必须包含 1–3 种不重复且真实存在的原料和产物，并填写有效数量与处理时间', tone: 'warning' }) })
      return
    }
    const exists = state.recipes.some((candidate) => candidate.id === recipe.id)
    const recipes = exists ? state.recipes.map((candidate) => (candidate.id === recipe.id ? deepClone(recipe) : candidate)) : [...state.recipes, deepClone(recipe)]
    const outputIds = new Set(recipe.outputs.map((line) => line.itemId))
    const boundMachineIds = new Set(state.objects.filter((object) => object.config.kind === 'machine' && object.config.recipeId === recipe.id).map((object) => object.id))
    const objects = state.objects.map((object) => {
      if (object.config.kind !== 'conveyor' || !object.config.fromObjectId || !boundMachineIds.has(object.config.fromObjectId)) return object
      const outputItemId = recipe.outputs.length === 1
        ? recipe.outputs[0].itemId
        : object.config.outputItemId && outputIds.has(object.config.outputItemId)
          ? object.config.outputItemId
          : null
      return { ...object, config: { ...object.config, outputItemId }, updatedAt: nowIso() }
    })
    const simulation = deepClone(state.simulation)
    boundMachineIds.forEach((machineId) => { simulation.machineRuntime[machineId] = createMachineRuntime(machineId, recipe) })
    set({ recipes, objects, simulation, factory: bumpDesignVersion(state.factory), saveStatus: 'dirty' })
  },

  removeRecipe: (id) => {
    const state = get()
    const isBound = state.objects.some((object) => object.config.kind === 'machine' && object.config.recipeId === id)
    if (isBound) {
      set({ toasts: addToast(state, { title: '无法删除配方', description: '请先从机器上解除该配方', tone: 'warning' }) })
      return false
    }
    set({ recipes: state.recipes.filter((recipe) => recipe.id !== id), factory: bumpDesignVersion(state.factory), saveStatus: 'dirty' })
    return true
  },

  playSimulation: () => {
    const state = get()
    const hasWarehouseFlow = state.objects.some((object) => {
      if (object.config.kind !== 'conveyor' || !object.config.fromObjectId) return false
      const sourceId = object.config.fromObjectId
      return state.objects.some((source) => source.id === sourceId && source.kind === 'rack')
    })
    const hasAgvFlow = state.objects.some((object) => object.kind === 'agv'
      && getAgvProgram(object)?.enabled
      && !agvConfigurationError(object, getAgvProgram(object)!, state.objects, state.items, state.floors))
    const hasDroneFlow = state.objects.some((object) => object.kind === 'drone'
      && getDroneProgram(object)?.enabled
      && !droneConfigurationError(getDroneProgram(object)!, state.objects, state.items))
    if (Object.keys(state.simulation.machineRuntime).length === 0 && !hasWarehouseFlow && !hasAgvFlow && !hasDroneFlow) {
      set({ toasts: addToast(state, { title: '还没有可运行的物流或生产链', description: '请先连接货物仓库、绑定机器配方，或为 AGV/无人机启用完整运输程序', tone: 'warning' }) })
      return
    }
    const simulation = deepClone(state.simulation)
    ensureAgvRuntimes(simulation, state.objects)
    ensureDroneRuntimes(simulation, state.objects, state.floors)
    set({
      simulation: { ...simulation, status: 'running' },
      toasts: addToast(state, { title: '仿真已启动', description: `当前速度 ${state.simulation.speed}×`, tone: 'success' }),
    })
  },

  pauseSimulation: () => set((state) => ({ simulation: { ...state.simulation, status: 'paused' } })),

  setSimulationSpeed: (speed) => set((state) => ({ simulation: { ...state.simulation, speed } })),

  resetSimulation: () => {
    const state = get()
    const resetState = createEmptySimulation(state.factory.id)
    state.objects.forEach((object) => {
      if (object.config.kind !== 'machine' || !object.config.recipeId) return
      const recipe = getRecipe(state.recipes, object.config.recipeId)
      if (recipe) resetState.machineRuntime[object.id] = createMachineRuntime(object.id, recipe)
    })
    state.objects.filter((object) => object.kind === 'agv').forEach((object) => {
      resetState.agvRuntime[object.id] = createAgvRuntime(object)
    })
    state.objects.filter((object) => object.kind === 'drone').forEach((object) => {
      resetState.droneRuntime[object.id] = createDroneRuntime(object, state.floors)
    })
    const resetInventory = state.inventory.map((record) => ({
      ...record,
      quantity: record.initialQuantity,
      reservedOutboundQuantity: 0,
      reservedInboundCapacity: 0,
      reservedQuantity: undefined,
    }))
    set({
      simulation: resetState,
      inventory: resetInventory,
      metrics: calculateMetrics(resetState, resetInventory, state.objects),
      metricSeries: [],
      activities: [],
      saveStatus: 'dirty',
      toasts: addToast(state, { title: '仿真已重置', description: '物料、机器缓存和指标已恢复到初始状态', tone: 'info' }),
    })
  },

  tickSimulation: (realDeltaSec) => {
    const state = get()
    if (state.simulation.status !== 'running' || !Number.isFinite(realDeltaSec) || realDeltaSec <= 0) return
    const simulatedSeconds = clamp(realDeltaSec, 0, 1) * state.simulation.speed + state.simulation.accumulatedUnsteppedSec
    const maxSteps = Math.min(80, Math.floor((simulatedSeconds + 1e-9) / STEP_SECONDS))
    if (maxSteps === 0) {
      set({ simulation: { ...state.simulation, accumulatedUnsteppedSec: simulatedSeconds } })
      return
    }
    // Create one isolated runtime draft per UI update, then advance every fixed
    // step inside it. Static design data keeps stable references; only mutable
    // runtime, inventory and status data is copied. This preserves deterministic
    // 0.25s settlement without repeatedly cloning the complete project.
    const next = simulationDraft(state)
    for (let index = 0; index < maxSteps; index += 1) advanceSimulation(next, forgeSimulationKernel)
    next.simulation.accumulatedUnsteppedSec = simulatedSeconds - maxSteps * STEP_SECONDS
    reconcileSimulationDraft(next, state)
    set({ ...next })
  },

  adjustInventory: (recordId, delta) => {
    const state = get()
    const record = state.inventory.find((candidate) => candidate.id === recordId)
    if (!record || !Number.isFinite(delta)) return false
    if (record.infiniteSupply) {
      set({ toasts: addToast(state, { title: '请先取消无限供应', description: '无限供应启用时保留实际库存但不允许手动修改数量', tone: 'warning' }) })
      return false
    }
    const nextQuantity = record.quantity + Math.trunc(delta)
    const warehouseId = record.locationType === 'rack-slot' ? record.locationId.split(':')[0] : null
    const warehouse = warehouseId ? state.objects.find((object) => object.id === warehouseId && isStorageObject(object)) : undefined
    const aggregateAfter = warehouse
      ? state.inventory
          .filter((candidate) => isWarehouseRecord(candidate, warehouse.id) && candidate.id !== record.id)
          .reduce((sum, candidate) => sum + candidate.quantity + reservedInboundCapacity(candidate), 0)
        + nextQuantity + reservedInboundCapacity(record)
      : nextQuantity
    if (nextQuantity < reservedOutboundQuantity(record) || !Number.isSafeInteger(nextQuantity) || nextQuantity > record.capacity || (warehouse?.kind === 'rack' && aggregateAfter > warehouseCapacity(warehouse))) {
      set({ toasts: addToast(state, { title: '库存调整失败', description: '数量不能低于已预约装运量、成为非安全整数或超过该设施容量', tone: 'warning' }) })
      return false
    }
    const inventory = state.inventory.map((candidate) => candidate.id === recordId
      ? {
          ...candidate,
          quantity: nextQuantity,
          initialQuantity: state.simulation.status === 'idle' ? nextQuantity : candidate.initialQuantity,
        }
      : candidate)
    set({ inventory, metrics: calculateMetrics(state.simulation, inventory, state.objects), saveStatus: 'dirty' })
    return true
  },

  setInventoryInfiniteSupply: (recordId, enabled) => {
    const state = get()
    const record = state.inventory.find((candidate) => candidate.id === recordId)
    if (!record || record.locationType !== 'rack-slot') return false
    const inventory = state.inventory.map((candidate) => candidate.id === recordId
      ? { ...candidate, infiniteSupply: enabled }
      : candidate)
    rebuildDirectionalInventoryReservations(inventory, state.simulation, true)
    set({
      inventory,
      saveStatus: 'dirty',
      toasts: addToast(state, {
        title: enabled ? '已启用无限供应' : '已恢复有限库存',
        description: enabled
          ? '该物品可持续从本仓储设施出货，实际库存数量不会被扣减'
          : '后续出货将重新扣减该物品的实际库存',
        tone: enabled ? 'success' : 'info',
      }),
    })
    return true
  },

  saveFactory: async () => {
    const state = get()
    set({ saveStatus: 'saving' })
    const savedAt = nowIso()
    const snapshot: PersistedForgeState = {
      ...deepClone(projectSnapshot(state)),
      persistenceSchemaVersion: 1,
      savedAt,
    }
    const result = await factoryRepository.save(snapshot)
    if (!result.ok) {
      set({ saveStatus: 'error', toasts: addToast(state, { title: '保存失败', description: result.error, tone: 'error' }) })
      return false
    }
    set({ saveStatus: 'saved', lastSavedAt: result.value, toasts: addToast(state, { title: '工厂已保存', description: '布局、配方与当前仿真状态已同步；断网时自动保留本地副本', tone: 'success' }) })
    return true
  },

  restoreFactory: async () => {
    const state = get()
    const result = await factoryRepository.load()
    if (!result.ok) {
      set({ hydrated: true, saveStatus: 'error', toasts: addToast(state, { title: '恢复失败', description: result.error, tone: 'error' }) })
      return false
    }
    if (!result.value) {
      set({ hydrated: true })
      return false
    }
    const { persistenceSchemaVersion: _schema, savedAt, ...project } = result.value
    void _schema
    const restored = deepClone(project)
    restored.factory.schemaVersion = Math.max(4, restored.factory.schemaVersion ?? 1)
    restored.factory.designVersion = Math.max(1, Number(restored.factory.designVersion) || 1)
    restored.floors = normalizeFloors(restored.floors, restored.factory.id)
    restored.simulation.warehouseDispatchCooldownSecByPort ??= {}
    for (const warehouse of restored.objects.filter((object) => object.kind === 'rack')) {
      const legacyCooldown = restored.simulation.warehouseDispatchCooldownSec?.[warehouse.id] ?? 0
      const savedCooldowns = restored.simulation.warehouseDispatchCooldownSecByPort[warehouse.id]
      restored.simulation.warehouseDispatchCooldownSecByPort[warehouse.id] = MACHINE_PORT_INDICES.map((portIndex) => (
        Math.max(0, Number(savedCooldowns?.[portIndex] ?? legacyCooldown) || 0)
      )) as WarehouseDispatchIntervalsSec
    }
    delete restored.simulation.warehouseDispatchCooldownSec
    restored.simulation.agvRuntime ??= {}
    restored.simulation.droneRuntime ??= {}
    restored.items = restored.items.map((item) => getRuntimeItemModelDefinition(item.itemModelId)
      ? { ...item, modelParameters: normalizeModelParameterOverrides(item.itemModelId, item.modelParameters) }
      : item)
    restored.recipes = restored.recipes.map((recipe) => ({ ...recipe, inputs: recipe.inputs.slice(0, 3), outputs: recipe.outputs.slice(0, 3) }))
    restored.objects = normalizeAgvObjects(normalizeConveyorFloors(normalizeConnectionPorts(normalizePortFacilities(restored.objects, restored.factory))), restored.factory)
    restored.objects = refreshConnectionPaths(restored.objects)
    restored.inventory = ensureWarehouseInventoryRecords(restored.inventory, restored.objects, restored.items)
    ensureAgvRuntimes(restored.simulation, restored.objects)
    ensureDroneRuntimes(restored.simulation, restored.objects, restored.floors)
    rebuildDirectionalInventoryReservations(restored.inventory, restored.simulation, true)
    restored.transportCapabilities = restored.transportCapabilities.map((capability) => capability.mode === 'agv'
      ? {
          ...capability,
          status: 'available',
          enabled: true,
          description: '支持可视化任务配置、库存触发、A* 最短路、动态避障和多车协调运输',
          auditNote: '导航、安全包络、载荷与任务状态来自独立业务数据；Cels vendor 外观仍保持视觉待派生审计状态',
          features: ['A* 最短路径', '库存触发运输', '动态避障与通行权协调'],
        }
      : capability)
    set({ ...restored, selectedObjectId: restored.objects[0]?.id ?? null, hydrated: true, saveStatus: 'saved', lastSavedAt: savedAt })
    return true
  },

  applyRealtimeMetric: (sample) => set((state) => {
    const metricSeries = [...state.metricSeries.filter((entry) => entry.elapsedSimSec !== sample.elapsedSimSec), sample]
      .sort((a, b) => a.elapsedSimSec - b.elapsedSimSec)
      .slice(-MAX_METRIC_SAMPLES)
    return {
      metricSeries,
      metrics: {
        ...state.metrics,
        currentThroughputPerMin: sample.throughputPerMin,
        workInProgress: sample.workInProgress,
        totalProduced: Math.max(state.metrics.totalProduced, sample.finishedGoods),
      },
    }
  }),

  applyRealtimeActivity: (event) => set((state) => ({
    activities: [...state.activities.filter((entry) => entry.id !== event.id), event]
      .sort((a, b) => a.elapsedSimSec - b.elapsedSimSec)
      .slice(-MAX_ACTIVITY_EVENTS),
  })),

  clearWorkspace: () => {
    const next = createEmptyProjectData()
    set({
      ...next,
      selectedObjectId: null,
      saveStatus: 'idle',
      lastSavedAt: null,
      hydrated: false,
      toasts: [],
    })
  },

  markDirty: () => set({ saveStatus: 'dirty' }),
  commitAgentDesign: (design) => {
    const state = get()
    if (!design.factory || !Array.isArray(design.objects) || !Array.isArray(design.inventory)) return false
    const materialized: FactoryObject[] = []
    const seen = new Set<Id>()
    for (const raw of design.objects) {
      if (!raw || typeof raw !== 'object') return false
      const value = raw as Record<string, unknown>
      const existing = typeof value.id === 'string' ? state.objects.find((object) => object.id === value.id) : undefined
      const object = materializeAgentObject(value, state.factory.id, state.floors, existing)
      if (!object || seen.has(object.id)) return false
      seen.add(object.id)
      materialized.push(object)
    }
    const objects = refreshConnectionPaths(materialized)
    const inventory = ensureWarehouseInventoryRecords(deepClone(design.inventory), objects, state.items)
    const simulation = deepClone(state.simulation)
    const previousObjects = new Map(state.objects.map((object) => [object.id, object]))
    const objectIds = new Set(objects.map((object) => object.id))
    simulation.transitItems = simulation.transitItems.filter((item) => (
      objectIds.has(item.fromObjectId)
      && (item.toObjectId === 'finished-goods' || objectIds.has(item.toObjectId))
      && objectIds.has(item.conveyorObjectId)
    ))
    Object.keys(simulation.machineRuntime).forEach((id) => {
      const object = objects.find((candidate) => candidate.id === id)
      if (!object || object.kind !== 'machine') delete simulation.machineRuntime[id]
    })
    objects.filter((object) => object.kind === 'machine').forEach((object) => {
      const config = object.config.kind === 'machine' ? object.config : undefined
      const recipe = config?.recipeId ? getRecipe(state.recipes, config.recipeId) : undefined
      if (!recipe) {
        delete simulation.machineRuntime[object.id]
        return
      }
      const previous = previousObjects.get(object.id)
      const previousRecipeId = previous?.config.kind === 'machine' ? previous.config.recipeId : null
      if (!simulation.machineRuntime[object.id] || previousRecipeId !== config?.recipeId) {
        simulation.machineRuntime[object.id] = createMachineRuntime(object.id, recipe)
      }
    })
    ensureAgvRuntimes(simulation, objects)
    ensureDroneRuntimes(simulation, objects, state.floors)
    simulation.warehouseDispatchCooldownSecByPort ??= {}
    Object.keys(simulation.warehouseDispatchCooldownSecByPort).forEach((id) => {
      if (!objects.some((object) => object.id === id && object.kind === 'rack')) delete simulation.warehouseDispatchCooldownSecByPort[id]
    })
    updateObjectStatuses(objects, simulation)
    const metrics = calculateMetrics(simulation, inventory, objects)
    const selectedObjectId = state.selectedObjectId && objectIds.has(state.selectedObjectId)
      ? state.selectedObjectId
      : objects.at(-1)?.id ?? null
    set({
      factory: deepClone(design.factory),
      objects,
      inventory,
      simulation,
      metrics,
      selectedObjectId,
      saveStatus: 'dirty',
    })
    return true
  },
  syncAgentFactory: (factory) => {
    const state = get()
    set({
      // A multi-operation Agent patch is committed once by the backend. Local
      // editor actions may bump versions per operation, so converge on the
      // server's monotonic version after applying the candidate locally.
      factory: deepClone(factory),
      saveStatus: 'dirty',
      toasts: addToast(state, { title: 'Agent 设计版本已同步', tone: 'info' }),
    })
  },
  dismissToast: (id) => set((state) => ({ toasts: state.toasts.filter((toast) => toast.id !== id) })),
  clearToasts: () => set({ toasts: [] }),
}))

export const selectSelectedObject = (state: ForgeStore): FactoryObject | null =>
  state.objects.find((object) => object.id === state.selectedObjectId) ?? null

export const selectMachineObjects = (state: ForgeStore): FactoryObject[] =>
  state.objects.filter((object) => object.kind === 'machine')

export const selectRunning = (state: ForgeStore): boolean => state.simulation.status === 'running'

export const selectFinishedInventory = (state: ForgeStore): InventoryRecord | null =>
  state.inventory.find((record) => record.locationType === 'finished-goods') ?? null
