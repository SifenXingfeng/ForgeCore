import type { FactoryMetrics, ForgeProjectData, SimulationState, TransportCapability } from '../types'

const nowIso = () => new Date().toISOString()

export const createEmptySimulation = (factoryId: string): SimulationState => ({
  id: `simulation-${factoryId}`,
  factoryId,
  status: 'idle',
  speed: 1,
  elapsedSimSec: 0,
  tickCount: 0,
  seed: 41731,
  accumulatedUnsteppedSec: 0,
  machineRuntime: {},
  agvRuntime: {},
  droneRuntime: {},
  transitItems: [],
  warehouseDispatchCooldownSecByPort: {},
  sourceFeedCooldownSec: 0,
  nextTransitSequence: 1,
  nextMetricSampleAtSec: 1,
  productionEventsSec: [],
  completedTransportDurationsSec: [],
  totalFinished: 0,
})

export const createEmptyMetrics = (): FactoryMetrics => ({
  currentThroughputPerMin: 0,
  totalProduced: 0,
  workInProgress: 0,
  inventoryTotal: 0,
  queueDepth: 0,
  blockedObjectCount: 0,
  machineUtilization: {},
  conveyorUtilization: 0,
  averageTransportSec: 0,
  agvUtilization: null,
  droneUtilization: null,
  targetThroughputPerMin: 0,
})

const createTransportCapabilities = (): TransportCapability[] => [
  {
    id: 'capability-conveyor', mode: 'conveyor', label: '传送带运输', status: 'available', enabled: true,
    description: '支持按网格轨迹铺设、自动转弯和物料路径运动。',
    auditNote: '使用用户实际绘制的折线路径，不注入预设线路。',
    features: ['定向路径', '容量限制', '3D 物品运动'],
  },
  {
    id: 'capability-agv', mode: 'agv', label: 'AGV 智能物流', status: 'available', enabled: true,
    description: '支持可视化任务配置、库存触发、A* 最短路、动态避障和多车协调运输。',
    auditNote: '导航、安全包络、载荷与任务状态来自独立业务数据；Cels vendor 外观仍保持视觉待派生审计状态。',
    features: ['A* 最短路径', '库存触发运输', '动态避障与通行权协调'],
  },
  {
    id: 'capability-drone', mode: 'drone', label: '货运无人机', status: 'available', enabled: true,
    description: '支持小批量跨楼层运输、26 邻域三维 A*、安全下降和多机动态避障。',
    auditNote: '业务载荷、速度、安全包络与任务状态来自独立数据；Count Infinity vendor 原件只作为视觉层，仍保持 derived pending。',
    features: ['三维 A* 最短路径', '跨楼层真实运输', '建筑与多机动态避障'],
  },
]

export const createEmptyProjectData = (input?: {
  factoryId?: string
  floorId?: string
  name?: string
  widthM?: number
  lengthM?: number
  gridSizeM?: number
}): ForgeProjectData => {
  const factoryId = input?.factoryId ?? 'factory-uninitialized'
  const floorId = input?.floorId ?? 'floor-uninitialized'
  const timestamp = nowIso()
  return {
    factory: {
      id: factoryId,
      name: input?.name ?? '尚未创建工厂',
      widthM: input?.widthM ?? 32,
      lengthM: input?.lengthM ?? 20,
      gridSizeM: input?.gridSizeM ?? 1,
      schemaVersion: 4,
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    floors: [{ id: floorId, factoryId, level: 1, name: '1F 生产区', elevationM: 0, heightM: 4.5 }],
    objects: [],
    items: [],
    recipes: [],
    inventory: [],
    transportCapabilities: createTransportCapabilities(),
    simulation: createEmptySimulation(factoryId),
    metrics: createEmptyMetrics(),
    metricSeries: [],
    activities: [],
  }
}
