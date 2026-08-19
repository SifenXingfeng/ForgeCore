export type Id = string

export type ModelParameterValue = string | number | boolean | null
export type ModelParameters = Record<string, ModelParameterValue>

export type FactoryObjectKind =
  | 'machine'
  | 'conveyor'
  | 'rack'
  | 'shelf'
  | 'buffer'
  | 'agv'
  | 'drone'

export type FloorVisibilityMode = 'current-only' | 'lower-transparent' | 'lower-solid'

export type ObjectOperationalStatus =
  | 'idle'
  | 'ready'
  | 'running'
  | 'waiting-input'
  | 'blocked'
  | 'planned'
  | 'offline'

export interface GridTransform {
  x: number
  z: number
  rotationY: 0 | 90 | 180 | 270
}

export interface GridFootprint {
  width: number
  depth: number
}

export interface MachineObjectConfig {
  kind: 'machine'
  recipeId: Id | null
  inputCapacity: number
  outputCapacity: number
  speedMultiplier: number
  inputPortCount: number
  outputPortCount: number
}

export type MachinePortIndex = 0 | 1 | 2
export type WarehouseDispatchIntervalsSec = [number, number, number]

export interface ConveyorObjectConfig {
  kind: 'conveyor'
  conveyorType?: 'flat' | 'incline'
  fromObjectId: Id | null
  toObjectId: Id | 'finished-goods' | null
  fromPortIndex?: MachinePortIndex | null
  toPortIndex?: MachinePortIndex | null
  fromFloorId?: Id
  toFloorId?: Id
  riseM?: number
  outputItemId?: Id | null
  speedMps: number
  capacity: number
  path: Array<{ x: number; z: number }>
}

export interface RackObjectConfig {
  kind: 'rack'
  slotCount: number
  slotCapacity: number
  dispatchIntervalSecByPort: WarehouseDispatchIntervalsSec
  /** @deprecated 仅用于读取旧存档；恢复时迁移到 dispatchIntervalSecByPort。 */
  dispatchIntervalSec?: number
  storageType: 'mixed' | 'raw-material' | 'work-in-progress' | 'finished-goods'
  runtimeAssetStatus: 'proxy' | 'vendor-visual' | 'derived-ready'
  inputPortCount: number
  outputPortCount: number
}

export interface ShelfObjectConfig {
  kind: 'shelf'
  storageType: 'unbounded'
  runtimeAssetStatus: 'proxy' | 'vendor-visual' | 'derived-ready'
}

export type AgvTriggerLocation = 'always' | 'source' | 'destination'
export type AgvTriggerComparator = 'at-least' | 'at-most'

export interface AgvProgram {
  enabled: boolean
  sourceObjectId: Id | null
  destinationObjectId: Id | null
  itemId: Id | null
  loadQuantity: number
  triggerLocation: AgvTriggerLocation
  triggerComparator: AgvTriggerComparator
  triggerQuantity: number
}

export interface VehicleObjectConfig {
  kind: 'vehicle'
  vehicleType: 'agv' | 'drone'
  capabilityId: Id
  runtimeAssetStatus: 'vendor-only' | 'derived-ready'
  maxPayloadKg: number | null
  speedMps: number | null
  batteryLevelPercent: number | null
  agvProgram?: AgvProgram
  transportProgram?: AgvProgram
}

export interface BufferObjectConfig {
  kind: 'buffer'
  capacity: number
}

export type FactoryObjectConfig =
  | MachineObjectConfig
  | ConveyorObjectConfig
  | RackObjectConfig
  | ShelfObjectConfig
  | VehicleObjectConfig
  | BufferObjectConfig

export interface FactoryObject {
  id: Id
  factoryId: Id
  floorId: Id
  kind: FactoryObjectKind
  name: string
  modelRef: string | null
  transform: GridTransform
  footprint: GridFootprint
  status: ObjectOperationalStatus
  config: FactoryObjectConfig
  createdAt: string
  updatedAt: string
}

export interface NewFactoryObject {
  id?: Id
  kind: FactoryObjectKind
  floorId?: Id
  name?: string
  modelRef?: string | null
  transform: Partial<GridTransform> & Pick<GridTransform, 'x' | 'z'>
  footprint?: GridFootprint
  config?: FactoryObjectConfig
}

export interface Factory {
  id: Id
  name: string
  widthM: number
  lengthM: number
  gridSizeM: number
  schemaVersion: number
  /** Monotonic design snapshot version used by Agent patches. */
  designVersion: number
  createdAt: string
  updatedAt: string
}

export interface Floor {
  id: Id
  factoryId: Id
  level: number
  name: string
  elevationM: number
  heightM: number
}

export type ItemCategory = 'raw-material' | 'work-in-progress' | 'finished-good'

export interface Item {
  id: Id
  code: string
  name: string
  category: ItemCategory
  description: string
  itemModelId: string
  modelParameters: ModelParameters
  icon: string | null
  massKg: number
  maxStackSize: number
}

export interface RecipeLine {
  itemId: Id
  quantity: number
}

export interface Recipe {
  id: Id
  code: string
  name: string
  description: string
  inputs: RecipeLine[]
  outputs: RecipeLine[]
  processingTimeSec: number
  enabled: boolean
}

export type InventoryLocationType = 'rack-slot' | 'finished-goods'

export interface InventoryRecord {
  id: Id
  locationType: InventoryLocationType
  locationId: Id
  itemId: Id
  quantity: number
  initialQuantity: number
  capacity: number
  reservedOutboundQuantity: number
  reservedInboundCapacity: number
  /** @deprecated 旧存档中的混合预约字段；恢复时根据活动运输任务重新构建。 */
  reservedQuantity?: number
  infiniteSupply?: boolean
}

export type TransportCapabilityStatus = 'available' | 'runtime-asset-pending' | 'planned'

export interface TransportCapability {
  id: Id
  mode: 'conveyor' | 'agv' | 'drone'
  label: string
  status: TransportCapabilityStatus
  enabled: boolean
  description: string
  auditNote: string
  features: string[]
}

export type MachineRuntimeStatus = 'idle' | 'processing' | 'waiting-input' | 'blocked'

export interface MachineRuntimeState {
  machineObjectId: Id
  recipeId: Id
  state: MachineRuntimeStatus
  progress: number
  cycleRemainingSec: number
  inputBuffer: Record<Id, number>
  outputBuffer: Record<Id, number>
  processedCycles: number
  busySeconds: number
  idleSeconds: number
  blockedSeconds: number
}

export type TransitState = 'moving' | 'delivered'

export interface TransitItem {
  id: Id
  itemId: Id
  quantity: number
  conveyorObjectId: Id
  fromObjectId: Id
  toObjectId: Id | 'finished-goods'
  elapsedSec: number
  travelTimeSec: number
  progress: number
  state: TransitState
}

export type AgvRuntimePhase = 'unconfigured' | 'waiting-trigger' | 'to-source' | 'to-destination' | 'clearing-dock'
export type DroneRuntimePhase = AgvRuntimePhase
export type AgvRuntimeMotionStatus = 'idle' | 'moving' | 'waiting' | 'blocked' | 'yielding'

export interface AgvRuntimeState {
  vehicleObjectId: Id
  phase: AgvRuntimePhase
  motionStatus: AgvRuntimeMotionStatus
  position: { x: number; z: number }
  headingY: number
  path: Array<{ x: number; z: number }>
  waypointIndex: number
  missionSourceObjectId: Id | null
  missionDestinationObjectId: Id | null
  missionItemId: Id | null
  sourceInventoryRecordId: Id | null
  destinationInventoryRecordId: Id | null
  reservedQuantity: number
  cargoItemId: Id | null
  cargoQuantity: number
  blockedByVehicleId: Id | null
  blockedReason: string | null
  yieldingToVehicleId: Id | null
  waitTicks: number
  lastPlanTick: number
  tripStartedAtSec: number | null
  completedTrips: number
  distanceTravelledM: number
  movingSeconds: number
  waitingSeconds: number
  blockedSeconds: number
}

export interface DroneNavigationPoint {
  x: number
  y: number
  z: number
}

export interface DroneRuntimeState {
  vehicleObjectId: Id
  phase: DroneRuntimePhase
  motionStatus: AgvRuntimeMotionStatus
  position: DroneNavigationPoint
  headingY: number
  pitch: number
  path: DroneNavigationPoint[]
  waypointIndex: number
  missionSourceObjectId: Id | null
  missionDestinationObjectId: Id | null
  missionItemId: Id | null
  sourceInventoryRecordId: Id | null
  destinationInventoryRecordId: Id | null
  reservedQuantity: number
  cargoItemId: Id | null
  cargoQuantity: number
  blockedByVehicleId: Id | null
  blockedReason: string | null
  yieldingToVehicleId: Id | null
  waitTicks: number
  lastPlanTick: number
  tripStartedAtSec: number | null
  completedTrips: number
  distanceTravelledM: number
  movingSeconds: number
  waitingSeconds: number
  blockedSeconds: number
}

export type SimulationStatus = 'idle' | 'running' | 'paused'
export type SimulationSpeed = 1 | 2 | 5 | 10

export interface SimulationState {
  id: Id
  factoryId: Id
  status: SimulationStatus
  speed: SimulationSpeed
  elapsedSimSec: number
  tickCount: number
  seed: number
  accumulatedUnsteppedSec: number
  machineRuntime: Record<Id, MachineRuntimeState>
  agvRuntime: Record<Id, AgvRuntimeState>
  droneRuntime: Record<Id, DroneRuntimeState>
  transitItems: TransitItem[]
  warehouseDispatchCooldownSecByPort: Record<Id, WarehouseDispatchIntervalsSec>
  /** @deprecated 仅用于读取旧存档；恢复时迁移到 warehouseDispatchCooldownSecByPort。 */
  warehouseDispatchCooldownSec?: Record<Id, number>
  sourceFeedCooldownSec: number
  nextTransitSequence: number
  nextMetricSampleAtSec: number
  productionEventsSec: number[]
  completedTransportDurationsSec: number[]
  totalFinished: number
}

export interface FactoryMetrics {
  currentThroughputPerMin: number
  totalProduced: number
  workInProgress: number
  inventoryTotal: number
  queueDepth: number
  blockedObjectCount: number
  machineUtilization: Record<Id, number>
  conveyorUtilization: number
  averageTransportSec: number
  agvUtilization: number | null
  droneUtilization: number | null
  targetThroughputPerMin: number
}

export interface MetricSample {
  elapsedSimSec: number
  throughputPerMin: number
  workInProgress: number
  finishedGoods: number
  machineAUtilization: number
  machineBUtilization: number
}

export type ActivityTone = 'neutral' | 'success' | 'warning' | 'info'

export interface ActivityEvent {
  id: Id
  elapsedSimSec: number
  title: string
  description: string
  tone: ActivityTone
  objectId?: Id
}

export interface ForgeProjectData {
  factory: Factory
  floors: Floor[]
  objects: FactoryObject[]
  items: Item[]
  recipes: Recipe[]
  inventory: InventoryRecord[]
  transportCapabilities: TransportCapability[]
  simulation: SimulationState
  metrics: FactoryMetrics
  metricSeries: MetricSample[]
  activities: ActivityEvent[]
}

export interface PersistedForgeState extends ForgeProjectData {
  persistenceSchemaVersion: 1
  savedAt: string
}

export type SaveStatus = 'idle' | 'dirty' | 'saving' | 'saved' | 'error'

export interface ToastMessage {
  id: Id
  title: string
  description?: string
  tone: 'success' | 'error' | 'warning' | 'info'
}
