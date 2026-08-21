/** Core grid and equipment definitions for the industrial build system. */

import { FLOOR_HEIGHT_M } from './floorConfig'

export type Rotation = 0 | 90 | 180 | 270

export interface GridPos {
  x: number
  z: number
}

export type BuildType =
  | 'source'
  | 'inboundWarehouse'
  | 'outboundWarehouse'
  | 'conveyor'
  | 'inclineUp'
  | 'inclineDown'
  | 'machine'
  | 'oreMiner'
  | 'smelter'
  | 'press'
  | 'assembler'
  | 'inspection'
  | 'washing'
  | 'agv'
  | 'drone'
  | 'storage'
  | 'splitter'
  | 'merger'
  | 'imported'

/** Positive, one-based floor index. The current project caps creation at 12. */
export type FactoryFloorId = number

export type ObjectRole = 'source' | 'conveyor' | 'machine' | 'storage' | 'vehicle'
export type EquipmentCategory = '货物仓储' | '加工' | '装配' | '传送物流'

export interface Footprint {
  w: number
  d: number
}

export interface ObjectDef {
  type: BuildType
  role: ObjectRole
  category: EquipmentCategory
  label: string
  subtitle: string
  function: string
  model: string
  assetPath?: string
  assetKind?: 'center-split' | 'detailed-process' | 'runtime-assembly'
  footprint: Footprint
  color: string
  accent: string
  height: number
  throughput: string
  power: string
  inputs: string[]
  outputs: string[]
  /** Local machine ports. Front follows rotation direction; back is the inlet. */
  inputPort: PortSide | null
  outputPort: PortSide | null
  inputPortCount?: number
  outputPortCount?: number
}

export type MachineModelType = 'machine' | 'smelter' | 'press' | 'washing'

/** 用户在“机械制造”中维护的可建造基础加工机器。 */
export interface MachineDefinition {
  id: string
  name: string
  description: string
  modelType: MachineModelType | 'imported'
  importedResourceId?: string
  footprint: Footprint
  height: number
  throughput: string
  power: string
  inputPortCount: number
  outputPortCount: number
  recipeIds: string[]
}

export interface ImportedResource {
  id: string
  name: string
  modelFileName: string
  sourceFileName: string
  sourceFormat: string
  previewDataUrl: string
  objectDef: ObjectDef
  warnings: string[]
  importedAt: string
}

export type PortSide = 'front' | 'back' | 'left' | 'right'

export interface FactoryObject {
  id: string
  type: BuildType
  /** Optional per-instance label used by storage selectors and inspectors. */
  displayName?: string
  /** Runtime resource id for user-imported equipment. */
  resourceId?: string
  pos: GridPos
  rotation: Rotation
  /** Logical floor datum; old saves omit it and remain on L1. */
  floorId?: FactoryFloorId
  recipeId?: string
  itemId?: string
  agvProgram?: AgvProgram
  incline?: InclineConveyorConfig
  /** 精密装配实例的可调接口覆盖。 */
  portConfig?: { inputCount: number; outputCount: number }
  /** 货物存取站的双向取放与货架映射。 */
  stationProgram?: StationProgram
  /** 普通货架的有限总容量与仿真初始库存。 */
  storageConfig?: StorageConfig
}

export interface StorageConfig {
  capacity: number
  initialInventory: Record<string, number>
}

export interface StationProgram {
  mode: 'pickup' | 'store'
  transferIntervalSec: number
  rackAssignments: Record<string, 'back' | 'left' | 'right'>
}

export interface InclineConveyorConfig {
  direction: 'up' | 'down'
  lowerFloorId: FactoryFloorId
  upperFloorId: FactoryFloorId
  lowPos: GridPos
  highPos: GridPos
  riseM: number
  runM: number
}

export type AgvRouteAction = 'pass' | 'load' | 'unload'

export interface AgvRouteWaypoint {
  id: string
  label: string
  objectId: string | null
  position: { x: number; z: number }
  action: AgvRouteAction
}

export interface AgvProgram {
  enabled: boolean
  sourceObjectId: string | null
  destinationObjectId: string | null
  itemId: string | null
  loadQuantity: number
  /** Ordered route stations. Older saves may omit this and use source/destination. */
  route?: AgvRouteWaypoint[]
  /** Larger values receive right-of-way at a shared aisle. */
  priority?: number
  /** Traffic policy used when replanning around live vehicles. */
  policy?: 'balanced' | 'shortest' | 'priority'
  /** Continuous dispatch or inventory-threshold dispatch inherited from ForgeCore. */
  dispatchMode?: 'continuous' | 'threshold'
  /** A new empty trip starts only when source stock is at least this value. */
  sourceMinQuantity?: number
  /** A new empty trip starts only when destination stock is at most this value. */
  destinationMaxQuantity?: number
}

const equipment = (
  type: BuildType,
  role: ObjectRole,
  category: EquipmentCategory,
  label: string,
  subtitle: string,
  functionText: string,
  model: string,
  footprint: Footprint,
  color: string,
  accent: string,
  height: number,
  throughput: string,
  power: string,
  inputs: string[],
  outputs: string[],
): ObjectDef => ({
  type,
  role,
  category,
  label,
  subtitle,
  function: functionText,
  model,
  footprint,
  color,
  accent,
  height,
  throughput,
  power,
  inputs,
  outputs,
  inputPort: role === 'source' ? null : 'back',
  outputPort: 'front',
})

export const OBJECT_DEFS: Record<BuildType, ObjectDef> = {
  source: equipment('source', 'source', '货物仓储', '货物存取站', 'CARGO ACCESS STATION Mk.I', '机械臂在三个货架方向与传送带之间执行可配置的取货或存货。', 'Robotic cargo access station', { w: 1, d: 1 }, '#d69e24', '#f2c94c', 0.9, '60 / min', '0.2 kW', ['传送带来货'], ['货架出货']),
  inboundWarehouse: equipment('inboundWarehouse', 'storage', '货物仓储', '入货仓库', 'INBOUND WAREHOUSE Mk.I', '显式无限供货边界；实际取出的物资计入消耗，不会扣减仓库库存。', 'Inbound supply warehouse', { w: 3, d: 3 }, '#577b76', '#72d4d2', 1.8, '无限供货', '2.4 kW', [], ['无限供应物资']),
  outboundWarehouse: equipment('outboundWarehouse', 'storage', '货物仓储', '出货仓库', 'OUTBOUND WAREHOUSE Mk.I', '显式无限容量终点；送达货物不可再次取出，并计入工厂产出。', 'Outbound sink warehouse', { w: 3, d: 3 }, '#756d58', '#e4b52b', 1.8, '无限接收', '2.4 kW', ['工厂产出'], []),
  oreMiner: equipment('oreMiner', 'storage', '货物仓储', '货物仓储架', 'CARGO STORAGE RACK Mk.I', '合并原料架和成品缓存能力，按物品与批次保存货物。', 'Raw material pallet rack', { w: 2, d: 2 }, '#c68a21', '#f0b52c', 1.5, '90 / min', '1.2 kW', ['待存货物'], ['可取货物']),
  conveyor: equipment('conveyor', 'conveyor', '传送物流', '滚筒输送线', 'ROLLER CONVEYOR Mk.I', '以滚筒输送托盘和周转箱，连接工位、缓存区和检验区。', 'Industrial roller conveyor', { w: 1, d: 1 }, '#5b9b99', '#82d0c7', 0.35, '120 / min', '1.5 kW', ['托盘 / 周转箱'], ['托盘 / 周转箱']),
  inclineUp: equipment('inclineUp', 'conveyor', '传送物流', '向上跨层输送线', 'INCLINE CONVEYOR UP', '以固定 75% 坡度连接当前层与上一层，货物从低层向高层运输。', 'ForgeMind roller conveyor incline', { w: 8, d: 1 }, '#5b9b99', '#e4b52b', FLOOR_HEIGHT_M, '8 / min', '4.5 kW', ['低层物料'], ['高层物料']),
  inclineDown: equipment('inclineDown', 'conveyor', '传送物流', '向下跨层输送线', 'INCLINE CONVEYOR DOWN', '以固定 75% 坡度连接当前层与上一层，货物从高层向低层运输。', 'ForgeMind roller conveyor incline', { w: 8, d: 1 }, '#5b9b99', '#70d4d0', FLOOR_HEIGHT_M, '8 / min', '4.5 kW', ['高层物料'], ['低层物料']),
  splitter: equipment('splitter', 'conveyor', '传送物流', '三向分流器', 'FLOW SPLITTER Mk.I', '将一条上游线路拆分为三条可控物流支路。', 'Three-way hub', { w: 1, d: 1 }, '#4d8f8f', '#83d5cc', 0.52, '180 / min', '2.4 kW', ['物料批次'], ['物料批次 × 3']),
  merger: equipment('merger', 'conveyor', '传送物流', '汇流节点', 'FLOW MERGER Mk.I', '汇聚多条线路，为加工设备提供稳定进料。', 'Confluence hub', { w: 1, d: 1 }, '#4d8f8f', '#83d5cc', 0.52, '180 / min', '2.4 kW', ['物料批次 × 3'], ['物料批次']),
  machine: equipment('machine', 'machine', '加工', '通用工艺工作站', 'GENERAL PROCESS CELL Mk.I', '面向钻孔、攻丝、去毛刺等离散工艺的通用工作站。', 'High-detail imported process asset', { w: 1, d: 1 }, '#4b9ca4', '#72d4d2', 1.2, '30 / min', '8 kW', ['工艺输入'], ['工艺输出']),
  smelter: equipment('smelter', 'machine', '加工', '数控加工中心', 'CNC MACHINING CENTER Mk.I', '完成铣削、钻孔和攻丝，输出带有质量状态的机加工件。', 'Enclosed CNC cell', { w: 3, d: 2 }, '#657782', '#d2ad50', 1.9, '18 / min', '22 kW', ['钢坯 / 铝坯'], ['机加工壳体']),
  press: equipment('press', 'machine', '加工', '液压冲压机', 'HYDRAULIC PRESS Mk.I', '使用模具完成板材冲压和折弯，配置安全光栅与液压站。', 'Hydraulic forming press', { w: 2, d: 2 }, '#677e89', '#d2ad50', 1.6, '36 / min', '24 kW', ['板材'], ['冲压壳体']),
  assembler: equipment('assembler', 'machine', '装配', '机器人装配单元', 'ROBOTIC ASSEMBLY CELL Mk.I', '由六轴机器人、夹具和扭矩工具组成的自动装配单元。', 'ABB / IRB robotic cell', { w: 3, d: 3 }, '#5d7185', '#e4b52b', 1.85, '12 / min', '28 kW', ['机加工件', '标准件'], ['电机总成']),
  inspection: equipment('inspection', 'machine', '装配', '双臂视觉质检单元', 'DUAL-ARM VISION QA CELL Mk.I', '由夹取臂托举工件、摄像头臂进行 360° 环绕检测，识别尺寸、外观和装配缺陷，并将结果写入质量追溯。', 'Dual-arm camera inspection cell', { w: 2, d: 2 }, '#536f72', '#7ed4d1', 1.55, '20 / min', '6 kW', ['待检产品'], ['合格品 / 不合格品']),
  washing: equipment('washing', 'machine', '加工', '清洗去毛刺单元', 'DEBURR & WASH CELL Mk.I', '去除切削毛刺并清洗切削液，作为机加工后的标准工序。', 'Wash and deburr cell', { w: 2, d: 2 }, '#5c7477', '#71c8c0', 1.45, '18 / min', '16 kW', ['机加工件'], ['洁净零件']),
  agv: equipment('agv', 'vehicle', '传送物流', 'AGV 叉车搬运车', 'AGV FORKLIFT Mk.I', '独立地面运输实体；直接在车体上查看状态和编辑真实库存运输任务。', 'Autonomous forklift', { w: 2, d: 2 }, '#6e7370', '#dfb842', 1.35, '8 trips / h', '5 kW', [], []),
  drone: equipment('drone', 'vehicle', '传送物流', '货运无人机', 'CARGO DRONE Mk.I', '独立跨层运输实体；直接在机体上查看状态和编辑真实库存运输任务。', 'ForgeCore cargo drone', { w: 3, d: 3 }, '#536e78', '#70d4d0', 1.8, '12 trips / h', '3 kW', [], []),
  storage: equipment('storage', 'storage', '货物仓储', '货物仓储架', 'CARGO STORAGE RACK Mk.I', '兼容旧存档的合并仓储架；新建时与原料仓储架使用同一模型与能力。', 'Raw material pallet rack', { w: 2, d: 2 }, '#c68a21', '#f0b52c', 1.5, '240 / min', '1.2 kW', ['待存货物'], ['可取货物']),
  imported: equipment('imported', 'machine', '加工', '导入工艺设备', 'IMPORTED RESOURCE', '来自 Hub 资源包的可建造设备。', 'Imported ForgeMind resource', { w: 2, d: 2 }, '#4b9ca4', '#72d4d2', 1.5, '—', '—', ['工艺输入'], ['工艺输出']),
}

OBJECT_DEFS.inboundWarehouse.inputPort = null
OBJECT_DEFS.outboundWarehouse.outputPort = null
OBJECT_DEFS.oreMiner.inputPort = null
OBJECT_DEFS.oreMiner.outputPort = null
OBJECT_DEFS.storage.inputPort = null
OBJECT_DEFS.storage.outputPort = null
OBJECT_DEFS.agv.inputPort = null
OBJECT_DEFS.agv.outputPort = null
OBJECT_DEFS.drone.inputPort = null
OBJECT_DEFS.drone.outputPort = null

const importedObjectDefs = new Map<string, ObjectDef>()
const machineObjectDefs = new Map<string, ObjectDef>()

export function registerImportedObjectDef(resource: ImportedResource): void {
  importedObjectDefs.set(resource.id, resource.objectDef)
}

export function registerMachineDefinition(definition: MachineDefinition, importedResources: readonly ImportedResource[] = []): void {
  const base = definition.modelType === 'imported'
    ? importedResources.find((resource) => resource.id === definition.importedResourceId)?.objectDef ?? OBJECT_DEFS.imported
    : OBJECT_DEFS[definition.modelType]
  machineObjectDefs.set(definition.id, {
    ...base,
    type: 'machine',
    role: 'machine',
    category: '加工',
    label: definition.name,
    subtitle: `CUSTOM MACHINE / ${definition.id}`,
    function: definition.description,
    footprint: { ...definition.footprint },
    height: definition.height,
    throughput: definition.throughput,
    power: definition.power,
    inputPortCount: definition.inputPortCount,
    outputPortCount: definition.outputPortCount,
    assetPath: definition.modelType === 'imported' ? base.assetPath : BUILD_ASSET_PATHS[definition.modelType],
    assetKind: base.assetKind ?? 'detailed-process',
  })
}

/** Custom machine definitions can select different assets and must not enter the generic machine instance batch. */
export function canBatchAsGenericMachine(object: FactoryObject): boolean {
  return object.type === 'machine' && !object.resourceId
}

export function getObjectDef(type: BuildType, resourceId?: string): ObjectDef {
  if (type === 'imported' && resourceId) return importedObjectDefs.get(resourceId) ?? OBJECT_DEFS.imported
  if (type === 'machine' && resourceId) return machineObjectDefs.get(resourceId) ?? OBJECT_DEFS.machine
  return OBJECT_DEFS[type]
}

export function canCustomizeStorageName(type: BuildType): boolean {
  return type === 'oreMiner' || type === 'storage' || type === 'inboundWarehouse' || type === 'outboundWarehouse'
}

export function getFactoryObjectDisplayName(object: Pick<FactoryObject, 'type' | 'resourceId' | 'displayName'>): string {
  const name = object.displayName?.trim()
  return name || getObjectDef(object.type, object.resourceId).label
}

// A 4x4 compound cell leaves one centred 2x2 cargo-rack dock on each of the
// rear/left/right faces while preserving the single front conveyor lane.
OBJECT_DEFS.source.footprint = { w: 4, d: 4 }
OBJECT_DEFS.source.height = 1.35
OBJECT_DEFS.source.model = 'Robotic material infeed station'

/** Assets extracted from the centre reference cell and exposed in the build catalogue. */
export const BUILD_ASSET_PATHS: Partial<Record<BuildType, string>> = {
  machine: '/models/industrial/realvirtual_high_detail.glb',
  conveyor: '/models/industrial/roller_conveyor_segment.glb',
  inclineUp: '/models/industrial/roller_conveyor_segment.glb',
  inclineDown: '/models/industrial/roller_conveyor_segment.glb',
  smelter: '/models/industrial/cnc_machining_center.glb',
  assembler: '/models/panda/panda.urdf + robot_cell.glb / open cell, no fence',
  press: '/models/industrial/hydraulic_press_detail.glb',
  washing: '/models/industrial/wash_deburr_detail.glb',
  agv: '/models/forgecore/forgecore_agv.glb',
  drone: '/models/forgecore/forgecore_drone.glb',
  inboundWarehouse: '/models/industrial/pallet_buffer_detail.glb',
  outboundWarehouse: '/models/industrial/pallet_buffer_detail.glb',
  storage: undefined,
  splitter: '/models/industrial/flow_node_detail.glb',
  merger: '/models/industrial/flow_node_detail.glb',
}

const CENTER_SPLIT_TYPES = new Set<BuildType>(['machine', 'conveyor', 'inclineUp', 'inclineDown', 'smelter', 'assembler'])

for (const [type, assetPath] of Object.entries(BUILD_ASSET_PATHS)) {
  if (assetPath) {
    OBJECT_DEFS[type as BuildType].assetPath = assetPath
    OBJECT_DEFS[type as BuildType].assetKind = CENTER_SPLIT_TYPES.has(type as BuildType) ? 'center-split' : 'detailed-process'
  }
}

// 视觉检测单元由两套 Panda URDF 和程序化相机头组成，不再使用旧的
// sensor_pack / control_cabinet 组合模型。
OBJECT_DEFS.inspection.assetPath = '/models/panda/panda.urdf × 2 + procedural camera head'
OBJECT_DEFS.inspection.assetKind = 'runtime-assembly'

export const EQUIPMENT_ORDER: BuildType[] = [
  'source', 'oreMiner', 'inboundWarehouse', 'outboundWarehouse', 'smelter', 'press', 'washing', 'assembler', 'inspection', 'conveyor', 'inclineUp', 'inclineDown', 'splitter', 'merger', 'agv', 'drone', 'storage', 'machine',
]

export const BUILD_BOUND = 24

/** Runtime guard used by save parsing and external payload boundaries. */
export function isBuildType(value: unknown): value is BuildType {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(OBJECT_DEFS, value)
}

export function objectRole(type: BuildType, resourceId?: string): ObjectRole {
  return getObjectDef(type, resourceId).role
}

export function isMachineType(type: BuildType, resourceId?: string): boolean {
  return objectRole(type, resourceId) === 'machine'
}

export function isTransportType(type: BuildType, resourceId?: string): boolean {
  return objectRole(type, resourceId) === 'conveyor'
}

export function isStorageFacilityType(type: BuildType): boolean {
  return type === 'oreMiner' || type === 'storage' || type === 'inboundWarehouse' || type === 'outboundWarehouse'
}

export function canSupplyVehicle(type: BuildType): boolean {
  return type === 'oreMiner' || type === 'storage' || type === 'inboundWarehouse'
}

export function canReceiveVehicle(type: BuildType): boolean {
  return type === 'oreMiner' || type === 'storage' || type === 'outboundWarehouse'
}
