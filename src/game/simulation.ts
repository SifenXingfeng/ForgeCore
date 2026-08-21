import { canReceiveVehicle, canSupplyVehicle, isStorageFacilityType, isTransportType, objectRole, type AgvProgram, type AgvRouteAction, type AgvRouteWaypoint, type FactoryFloorId, type FactoryObject } from './types'
import type { Recipe } from './item'
import { mulberry32 } from './rng'
import { rotationToDir, cellKey } from './dir'
import { isCargoStorageRack, objectCompatiblePortCells, objectInterfacePortCells, objectPortCell, objectPortCells, objectToWorld, occupiedCells, stationRackConnections, type StationRackSide } from './grid'
import { AGV_CENTER_CLEARANCE, AGV_NAV_RADIUS, agvDockCandidates, findAgvPath, type AgvDynamicObstacle, type AgvNavigationPoint } from './agvNavigation'
import { DRONE_HOVER_HEIGHT_M, DRONE_SEPARATION_M, findDronePath, type DroneDynamicObstacle, type DroneNavigationPoint } from './dronePathfinding'
import { FLOOR_HEIGHT_M, MAX_FACTORY_FLOORS } from './floorConfig'
import { inclineEndCell, inclineInputCell, inclineStartCell, inclineStartFloor, inclineTargetFloor, inclineTravelLength, isInclineConveyorType } from './inclineConveyor'

export type { DroneNavigationPoint } from './dronePathfinding'

/**
 * 仿真引擎（补充设计 §3 内核）—— 唯一真相源。
 *
 * Day 5 完整版：传送带分段模型 + ItemLot 在途运输 + 头堵背压 + 机器输入/输出耦合 + Source 产出。
 *
 * 连接语义（极简，贯穿全引擎）：
 *   每个对象（source / conveyor / machine）都有「输出方向」= rotation 方向。
 *   物品从对象 A 沿 A.dir 流出，进入「A.pos + A.dir」这一格上的对象 B：
 *     - B 是传送带 → 物品沿 B.dir 继续（槽位空才能进入）。
 *     - B 是机器   → 物品进入机器输入缓冲（机器 idle 且需要该物品）。
 *   机器加工完成后，沿 machine.dir 吐出产物到下游传送带（或计数视为出口）。
 *   用户只需保证「上游的 rotation 指向下游」，物品就会流动。
 */

/** 固定步长（§3.2：50ms 一步） */
export const SIM_STEP = 0.05

/** 收料 / 出料过渡时长（秒） */
export const LOAD_TIME = 0.5
export const OUTPUT_TIME = 0.3

/** 传送带速度（格/秒） */
export const CONVEYOR_SPEED = 2

/** source 产出间隔（秒） */
export const SOURCE_INTERVAL = 1.0
export const SOURCE_TRANSFER_TIME = 1.2
export const DEFAULT_RACK_INITIAL_STOCK = 24

const floorCellKey = (floorId: FactoryFloorId | undefined, x: number, z: number): string => `${floorId ?? 1}:${cellKey(x, z)}`

/** 机器运行时状态（§3.4 状态机） */
export type MachineState = 'idle' | 'loading' | 'processing' | 'output'

export interface MachineRuntime {
  objectId: string
  state: MachineState
  /** 当前阶段进度 0..1 */
  progress: number
  recipeId: string | null
  /** 输入缓冲：已收到的输入 itemId -> 数量 */
  inputBuffer: Record<string, number>
  /** 累计加工时间（秒），用于利用率统计 */
  processingTime: number
  outputCursor: number
  outputQueue: string[]
}

/** 在途物品实例（§3.4 ItemLot） */
export interface ItemLot {
  id: string
  itemId: string
  /** 当前所在传送带 id */
  conveyorId: string
  /** 物料随输送带继承的楼层，旧快照默认视为 L1。 */
  floorId: FactoryFloorId
  /** 沿 conveyor 朝向的格内进度 0..1 */
  offset: number
}

export interface SimStats {
  consumed: Record<string, number>
  produced: Record<string, number>
}

export type FloorSimStats = Record<FactoryFloorId, SimStats>

function createFloorStats(): FloorSimStats {
  return Object.fromEntries(Array.from({ length: MAX_FACTORY_FLOORS }, (_, index) => [index + 1, { consumed: {}, produced: {} }]))
}

/** 快照：前端消费的最小接口 */
export interface SimulationSnapshot {
  timeSec: number
  machines: MachineRuntime[]
  sources: SourceRuntimeSnapshot[]
  racks: RackRuntimeSnapshot[]
  itemLots: ItemLot[]
  agvs: AgvRuntimeSnapshot[]
  drones: DroneRuntimeSnapshot[]
  stats: SimStats
  floorStats: FloorSimStats
}

export type SourceState = 'idle' | 'picking' | 'placing' | 'blocked'

export interface SourceRuntimeSnapshot {
  objectId: string
  itemId: string | null
  state: SourceState
  progress: number
  mode?: 'pickup' | 'store'
  rackSide?: 'back' | 'left' | 'right'
  rackObjectId?: string | null
  rackConnections?: Partial<Record<StationRackSide, string>>
  inventory?: Record<string, number>
}

export interface RackRuntimeSnapshot {
  objectId: string
  inventory: Record<string, number>
  kind: 'rack' | 'inbound' | 'outbound'
  capacity: number | null
}

interface SourceRuntime {
  objectId: string
  itemId: string | null
  /** 产出计时器 */
  timer: number
  transferTimer: number
  state: SourceState
  mode: 'pickup' | 'store'
  rackSide: 'back' | 'left' | 'right'
  rackObjectId: string | null
  rackAssignments: Record<string, 'back' | 'left' | 'right'>
  pendingItemId: string | null
}

interface ConveyorRuntime {
  objectId: string
  /** 当前槽位上的物品（容量 1） */
  lot: ItemLot | null
  /** Round-robin output branch for a splitter. */
  branchCursor: number
}

export type AgvPhase = 'to-warehouse' | 'to-line' | 'to-source' | 'to-destination'
export type AgvMotionStatus = 'idle' | 'moving' | 'waiting'

export interface AgvRuntimeSnapshot {
  objectId: string
  position: AgvNavigationPoint
  headingY: number
  phase: AgvPhase
  motionStatus: AgvMotionStatus
  path: AgvNavigationPoint[]
  waypointIndex: number
  cargoItemId: string | null
  cargoQuantity: number
  completedTrips: number
  distanceTravelled: number
  decision: AgvDecision
  blockedSeconds: number
  yieldCount: number
  currentWaypointLabel: string
}

export type DronePhase = 'parked' | 'to-source' | 'to-destination' | 'returning'
export type DroneMotionStatus = 'idle' | 'moving' | 'waiting'

export interface DroneRuntimeSnapshot {
  objectId: string
  position: DroneNavigationPoint
  headingY: number
  phase: DronePhase
  motionStatus: DroneMotionStatus
  path: DroneNavigationPoint[]
  waypointIndex: number
  targetFloor: FactoryFloorId
  deliveryPointIndex: number
  cargoItemId: string | null
  cargoQuantity: number
  completedTrips: number
  distanceTravelled: number
  currentWaypointLabel: string
}

export type AgvDecision = 'idle' | 'moving' | 'yielding' | 'replanning' | 'recovering'

interface AgvRuntime {
  objectId: string
  position: AgvNavigationPoint
  headingY: number
  phase: AgvPhase
  motionStatus: AgvMotionStatus
  path: AgvNavigationPoint[]
  waypointIndex: number
  routeIndex: number
  cargoItemId: string | null
  cargoQuantity: number
  completedTrips: number
  distanceTravelled: number
  retryTimer: number
  program: AgvProgram | null
  decision: AgvDecision
  blockedSeconds: number
  yieldCount: number
  currentWaypointLabel: string
  pathMode: 'mission' | 'recovery' | 'yield'
}

interface DroneRuntime {
  objectId: string
  position: DroneNavigationPoint
  headingY: number
  phase: DronePhase
  motionStatus: DroneMotionStatus
  path: DroneNavigationPoint[]
  pathLabels: string[]
  waypointIndex: number
  targetFloor: FactoryFloorId
  deliveryPointIndex: number
  cargoItemId: string | null
  cargoQuantity: number
  completedTrips: number
  distanceTravelled: number
  holdSeconds: number
  retryTimer: number
  targetObjectId: string | null
  program: AgvProgram | null
  currentWaypointLabel: string
}

interface AgvMissionTarget {
  objectId: string | null
  position: AgvNavigationPoint
  candidates?: AgvNavigationPoint[]
  kind: 'warehouse' | 'line-side' | 'source' | 'destination'
  action: AgvRouteAction
  label: string
}

export class SimulationEngine {
  readonly seed: number
  readonly rng: () => number

  private timeSec = 0
  private accumulator = 0

  private machines = new Map<string, MachineRuntime>()
  private conveyors = new Map<string, ConveyorRuntime>()
  private agvs = new Map<string, AgvRuntime>()
  private drones = new Map<string, DroneRuntime>()
  private sources = new Map<string, SourceRuntime>()
  private rackInventories = new Map<string, Record<string, number>>()
  private rackCapacities = new Map<string, number>()
  private recipes = new Map<string, Recipe>()
  /** cellKey -> FactoryObject（用于查下游） */
  private objectByCell = new Map<string, FactoryObject>()
  /** objectId -> FactoryObject（用于查自身 pos/rotation） */
  private objectById = new Map<string, FactoryObject>()

  private stats: SimStats = { consumed: {}, produced: {} }
  private floorStats: FloorSimStats = createFloorStats()
  private lotCounter = 0
  private factoryObjects: FactoryObject[] = []

  constructor(seed: number) {
    this.seed = seed >>> 0
    this.rng = mulberry32(this.seed)
  }

  /** 装载工厂结构 */
  init(objects: FactoryObject[], recipes: Recipe[]): void {
    this.timeSec = 0
    this.accumulator = 0
    this.stats = { consumed: {}, produced: {} }
    this.floorStats = createFloorStats()
    this.machines.clear()
    this.conveyors.clear()
    this.agvs.clear()
    this.drones.clear()
    this.sources.clear()
    this.rackInventories.clear()
    this.rackCapacities.clear()
    this.recipes.clear()
    this.objectByCell.clear()
    this.objectById.clear()
    this.lotCounter = 0
    this.factoryObjects = objects

    for (const r of recipes) if (r.enabled !== false) this.recipes.set(r.id, r)

    for (const o of objects) {
      if (isCargoStorageRack(o)) {
        const configured = o.storageConfig?.initialInventory
        this.rackInventories.set(o.id, configured ? { ...configured } : o.itemId ? { [o.itemId]: DEFAULT_RACK_INITIAL_STOCK } : {})
        this.rackCapacities.set(o.id, Math.max(1, Math.round(o.storageConfig?.capacity ?? 100)))
      } else if (o.type === 'inboundWarehouse' || o.type === 'outboundWarehouse') {
        this.rackInventories.set(o.id, {})
      }
      if (isInclineConveyorType(o.type) && o.incline) {
        const start = inclineStartCell(o)
        this.objectByCell.set(floorCellKey(inclineStartFloor(o), start.x, start.z), o)
      } else {
        for (const cell of occupiedCells(o)) {
          this.objectByCell.set(floorCellKey(o.floorId, cell.x, cell.z), o)
        }
      }
      this.objectById.set(o.id, o)
      if (objectRole(o.type, o.resourceId) === 'machine') {
        this.machines.set(o.id, {
          objectId: o.id,
          state: 'idle',
          progress: 0,
          recipeId: o.recipeId ?? null,
          inputBuffer: {},
          processingTime: 0,
          outputCursor: 0,
          outputQueue: [],
        })
      } else if (o.type === 'agv') {
        this.agvs.set(o.id, createAgvRuntime(o))
      } else if (o.type === 'drone') {
        this.drones.set(o.id, createDroneRuntime(o))
      } else if (isTransportType(o.type, o.resourceId)) {
        this.conveyors.set(o.id, { objectId: o.id, lot: null, branchCursor: 0 })
      } else if (objectRole(o.type, o.resourceId) === 'source' || o.type === 'inboundWarehouse') {
        this.sources.set(o.id, {
          objectId: o.id,
          itemId: o.itemId ?? null,
          timer: 0,
          transferTimer: 0,
          state: 'idle',
          mode: o.stationProgram?.mode ?? 'pickup',
          rackSide: 'back',
          rackObjectId: null,
          rackAssignments: { ...o.stationProgram?.rackAssignments },
          pendingItemId: null,
        })
      }
    }

    for (const runtime of this.agvs.values()) this.planAgvPath(runtime)
  }

  advance(dtSec: number): void {
    if (dtSec <= 0) return
    this.accumulator += dtSec
    const steps = Math.floor(this.accumulator / SIM_STEP)
    for (let index = 0; index < steps; index += 1) {
      this.step(SIM_STEP)
    }
    this.accumulator -= steps * SIM_STEP
  }

  private step(dt: number): void {
    this.timeSec += dt
    this.stepSources(dt)
    this.stepConveyors(dt)
    this.stepMachines(dt)
    this.stepAgvs(dt)
    this.stepDrones(dt)
  }

  // —— Source：定时产出到下游 ——
  private stepSources(dt: number): void {
    for (const s of this.sources.values()) {
      const srcObj = this.objectById.get(s.objectId)
      if (!srcObj) {
        s.state = 'blocked'
        s.transferTimer = 0
        continue
      }
      s.mode = srcObj.stationProgram?.mode ?? 'pickup'
      if (s.mode === 'store') {
        if (!s.pendingItemId) { s.state = 'idle'; s.transferTimer = 0; continue }
        const rackInventory = s.rackObjectId ? this.rackInventories.get(s.rackObjectId) : undefined
        if (!rackInventory) { s.state = 'blocked'; continue }
        s.transferTimer += dt
        const progress = Math.min(s.transferTimer / SOURCE_TRANSFER_TIME, 1)
        s.state = progress < 0.52 ? 'picking' : 'placing'
        if (progress >= 1) {
          const rackObject = s.rackObjectId ? this.objectById.get(s.rackObjectId) : undefined
          if (!rackObject || this.depositIntoStorage(rackObject, s.pendingItemId, 1) !== 1) {
            s.state = 'blocked'
            continue
          }
          s.pendingItemId = null
          s.rackObjectId = null
          s.transferTimer = 0
          s.state = 'idle'
        }
        continue
      }
      if (!s.itemId) {
        s.state = 'blocked'
        s.transferTimer = 0
        continue
      }

      // A cargo access station is only a rack↔conveyor handler. It may output
      // an item only when one of its real connected racks currently owns it.
      // The inbound warehouse is the sole infinite conveyor source.
      const rackConnection = srcObj.type === 'source' ? this.resolveRackConnection(s, srcObj, s.itemId, 'pickup') : null
      if (srcObj.type === 'source' && !rackConnection) {
        s.state = 'blocked'
        s.transferTimer = 0
        continue
      }
      if (rackConnection) {
        s.rackSide = rackConnection.side
        s.rackObjectId = rackConnection.rack.id
      }

      if (s.transferTimer <= 0 && s.state !== 'picking' && s.state !== 'placing') {
        s.timer += dt
        const interval = Math.max(0.25, Math.min(60, srcObj.stationProgram?.transferIntervalSec ?? SOURCE_INTERVAL))
        if (s.timer < interval) {
          s.state = 'idle'
          continue
        }
        if (this.sourceDownstreams(srcObj).length === 0) {
          s.state = 'blocked'
          continue
        }
        s.timer -= interval
        s.transferTimer = 0
      }

      s.transferTimer += dt
      const progress = Math.min(s.transferTimer / SOURCE_TRANSFER_TIME, 1)
      s.state = progress < 0.52 ? 'picking' : 'placing'
      if (progress < 1) continue

      if (this.trySourceOutput(srcObj, s.itemId)) {
        if (rackConnection) {
          this.withdrawFromStorage(rackConnection.rack, s.itemId, 1)
        } else if (srcObj.type === 'inboundWarehouse') {
          this.withdrawFromStorage(srcObj, s.itemId, 1)
        }
        s.transferTimer = 0
        s.state = 'idle'
      } else {
        s.state = 'blocked'
      }
    }
  }

  private sourceDownstreams(srcObj: FactoryObject): FactoryObject[] {
    return objectCompatiblePortCells(srcObj, 'output')
      .map((cell) => this.objectByCell.get(floorCellKey(srcObj.floorId, cell.x, cell.z)))
      .filter((obj): obj is FactoryObject => Boolean(obj))
      .filter((obj) => this.isConnected(srcObj, obj))
  }

  private trySourceOutput(srcObj: FactoryObject, itemId: string): boolean {
    for (const downstream of this.sourceDownstreams(srcObj)) {
      if (isTransportType(downstream.type, downstream.resourceId)) {
        const c = this.conveyors.get(downstream.id)
        if (c && !c.lot) {
          c.lot = this.makeLot(itemId, downstream.id, 0)
          return true
        }
      } else if (objectRole(downstream.type, downstream.resourceId) === 'machine' && this.tryFeedMachine(downstream.id, itemId)) {
        return true
      }
    }
    return false
  }

  private stepConveyors(dt: number): void {
    const step = CONVEYOR_SPEED * dt
    // 固定按 id 排序，保证确定性
    const ids = Array.from(this.conveyors.keys()).sort()

    for (const id of ids) {
      const c = this.conveyors.get(id)!
      const lot = c.lot
      if (!lot) continue
      const obj = this.objectById.get(id)
      if (!obj) continue

      lot.offset += isInclineConveyorType(obj.type) && obj.incline ? step / inclineTravelLength(obj) : step

      // 到达段末端 → 尝试进入下游
      if (lot.offset >= 1) {
        if (obj.type === 'splitter') {
          if (!this.tryMoveFromSplitter(c, obj, lot)) lot.offset = 1
          continue
        }
        const dir = rotationToDir(obj.rotation)
        const output = isInclineConveyorType(obj.type) && obj.incline
          ? objectPortCell(obj, 'output') ?? inclineEndCell(obj)
          : objectPortCell(obj, 'output') ?? { x: obj.pos.x + dir.dx, z: obj.pos.z + dir.dz }
        const nx = output.x
        const nz = output.z
        const outputFloorId = isInclineConveyorType(obj.type) && obj.incline ? inclineTargetFloor(obj) : obj.floorId
        const downstream = this.objectByCell.get(floorCellKey(outputFloorId, nx, nz))
          ?? this.machineAtConnectedInput(obj, outputFloorId)

        let moved = false
        if (downstream && this.isConnected(obj, downstream) && isTransportType(downstream.type, downstream.resourceId)) {
          const dc = this.conveyors.get(downstream.id)
          if (dc && !dc.lot) {
            dc.lot = this.makeLot(lot.itemId, downstream.id, lot.offset - 1, lot.id)
            c.lot = null
            moved = true
          }
        } else if (downstream && this.isConnected(obj, downstream) && objectRole(downstream.type, downstream.resourceId) === 'machine') {
          if (this.tryFeedMachine(downstream.id, lot.itemId)) {
            c.lot = null
            moved = true
          }
        } else if (downstream && this.isConnected(obj, downstream) && objectRole(downstream.type, downstream.resourceId) === 'source') {
          const station = this.sources.get(downstream.id)
          if (station?.mode === 'store' && !station.pendingItemId) {
            const connection = this.resolveRackConnection(station, downstream, lot.itemId, 'store')
            if (connection) {
              station.pendingItemId = lot.itemId
              station.rackSide = connection.side
              station.rackObjectId = connection.rack.id
              station.transferTimer = 0
              station.state = 'picking'
              c.lot = null
              moved = true
            }
          }
        } else if (downstream?.type === 'outboundWarehouse' && this.isConnected(obj, downstream)) {
          if (this.depositIntoStorage(downstream, lot.itemId, 1) === 1) {
            c.lot = null
            moved = true
          }
        }

        if (!moved) {
          // 下游为空、断开或已满都视为头堵。只有明确的接收设备才能
          // 消耗货物，不能再把未连接末端解释为“离开工厂”。
          lot.offset = 1
        }
      }
    }
  }

  // —— Machine：状态机 ——
  private tryMoveFromSplitter(c: ConveyorRuntime, obj: FactoryObject, lot: ItemLot): boolean {
    const outputs = objectPortCells(obj, 'output')
    const start = c.branchCursor % Math.max(outputs.length, 1)
    for (let offset = 0; offset < outputs.length; offset++) {
      const output = outputs[(start + offset) % outputs.length]
      const downstream = this.objectByCell.get(floorCellKey(obj.floorId, output.x, output.z))
        ?? this.machineAtConnectedInput(obj, obj.floorId)
      if (!downstream || !this.isConnected(obj, downstream)) continue
      if (isTransportType(downstream.type, downstream.resourceId)) {
        const dc = this.conveyors.get(downstream.id)
        if (!dc || dc.lot) continue
        dc.lot = this.makeLot(lot.itemId, downstream.id, lot.offset - 1, lot.id)
        c.branchCursor = (start + offset + 1) % outputs.length
        c.lot = null
        return true
      }
      if (objectRole(downstream.type, downstream.resourceId) === 'machine' && this.tryFeedMachine(downstream.id, lot.itemId)) {
        c.branchCursor = (start + offset + 1) % outputs.length
        c.lot = null
        return true
      }
    }
    return false
  }

  private stepMachines(dt: number): void {
    for (const m of this.machines.values()) {
      this.stepMachine(m, dt)
    }
  }

  private stepMachine(m: MachineRuntime, dt: number): void {
    const recipe = m.recipeId ? this.recipes.get(m.recipeId) : undefined
    if (!recipe) {
      m.state = 'idle'
      m.progress = 0
      return
    }

    switch (m.state) {
      case 'idle': {
        // 检查输入是否齐备
        if (this.inputsSatisfied(m, recipe)) {
          // 机器内部转换不计入工厂边界消耗；只有从入货仓库
          // 实际取出时才登记全局“消耗”。
          m.inputBuffer = {}
          m.state = 'loading'
          m.progress = 0
        }
        break
      }

      case 'loading':
        m.progress += dt / LOAD_TIME
        if (m.progress >= 1) {
          m.progress = 0
          m.state = 'processing'
        }
        break

      case 'processing':
        m.progress += dt / recipe.durationSec
        m.processingTime += dt
        if (m.progress >= 1) {
          m.progress = 0
          m.state = 'output'
          m.outputQueue = recipe.outputs.flatMap((output) => Array.from({ length: Math.max(1, Math.round(output.qty)) }, () => output.itemId))
        }
        break

      case 'output': {
        m.progress += dt / OUTPUT_TIME
        if (m.progress >= 1) {
          m.progress = 0
          // 吐出产物到下游传送带
          const placed = this.tryOutput(m, recipe)
          if (placed) {
            // 回到 idle，等待下一轮输入齐备（§3.4 状态机闭环）
            m.state = 'idle'
          }
          // 未吐出 → 停在 output（下游空后下步再试）
          else {
            m.progress = 1
          }
        }
        break
      }
    }
  }

  private inputsSatisfied(m: MachineRuntime, recipe: Recipe): boolean {
    for (const p of recipe.inputs) {
      if ((m.inputBuffer[p.itemId] ?? 0) < p.qty) return false
    }
    return true
  }

  /** 尝试把物品喂给机器输入缓冲。返回是否成功。 */
  private tryFeedMachine(machineId: string, itemId: string): boolean {
    const m = this.machines.get(machineId)
    if (!m) return false
    if (m.state !== 'idle') return false
    const recipe = m.recipeId ? this.recipes.get(m.recipeId) : undefined
    if (!recipe) return false
    // 该物品是配方某个输入，且还未收满
    for (const p of recipe.inputs) {
      if (p.itemId === itemId && (m.inputBuffer[itemId] ?? 0) < p.qty) {
        m.inputBuffer[itemId] = (m.inputBuffer[itemId] ?? 0) + 1
        return true
      }
    }
    return false
  }

  /** 尝试从机器输出产物到下游。机器加工本身不登记工厂边界产出。 */
  private tryOutput(m: MachineRuntime, recipe: Recipe): boolean {
    // 若无产物（配方无输出），直接视为完成
    if (recipe.outputs.length === 0) return true

    const obj = this.findMachineObject(m.objectId)
    if (!obj) return false
    const outputs = [...objectInterfacePortCells(obj, 'output'), ...objectPortCells(obj, 'output')]
    const downstreams = Array.from(new Map(outputs
      .map((cell) => this.objectByCell.get(floorCellKey(obj.floorId, cell.x, cell.z)))
      .filter((target): target is FactoryObject => target !== undefined && this.isConnected(obj, target))
      .map((target) => [target.id, target])).values())
    if (m.outputQueue.length === 0) {
      return true
    }
    if (downstreams.length === 0) {
      m.outputQueue = []
      return true
    }
    const start = m.outputCursor % downstreams.length
    for (let offset = 0; offset < downstreams.length; offset += 1) {
      const index = (start + offset) % downstreams.length
      const downstream = downstreams[index]
      if (!isTransportType(downstream.type, downstream.resourceId)) continue
      const conveyor = this.conveyors.get(downstream.id)
      if (!conveyor || conveyor.lot) continue
      conveyor.lot = this.makeLot(m.outputQueue.shift()!, downstream.id, 0)
      m.outputCursor = (index + 1) % downstreams.length
      if (m.outputQueue.length === 0) {
        return true
      }
      return false
    }
    return false
  }

  private rackTotal(objectId: string): number {
    return Object.values(this.rackInventories.get(objectId) ?? {}).reduce((sum, quantity) => sum + quantity, 0)
  }

  private availableStorageCapacity(object: FactoryObject): number {
    if (object.type === 'outboundWarehouse') return Number.POSITIVE_INFINITY
    if (!isCargoStorageRack(object)) return 0
    return Math.max(0, (this.rackCapacities.get(object.id) ?? 100) - this.rackTotal(object.id))
  }

  private recordBoundaryStat(object: FactoryObject, itemId: string, quantity: number, direction: 'consumed' | 'produced') {
    if (quantity <= 0) return
    this.stats[direction][itemId] = (this.stats[direction][itemId] ?? 0) + quantity
    const floorStats = this.floorStats[object.floorId ?? 1]
    floorStats[direction][itemId] = (floorStats[direction][itemId] ?? 0) + quantity
  }

  private withdrawFromStorage(object: FactoryObject, itemId: string, requested: number): number {
    const quantity = Math.max(0, Math.round(requested))
    if (quantity <= 0) return 0
    if (object.type === 'inboundWarehouse') {
      if (!object.itemId || object.itemId !== itemId) return 0
      this.recordBoundaryStat(object, itemId, quantity, 'consumed')
      return quantity
    }
    if (!isCargoStorageRack(object)) return 0
    const inventory = this.rackInventories.get(object.id)
    if (!inventory) return 0
    // “每趟数量”是完整装载契约。普通货架没有对应物品或数量不足
    // 时整次取货阻塞，不允许凭空补货，也不产生半趟虚拟货物。
    const available = inventory[itemId] ?? 0
    if (available < quantity) return 0
    const accepted = quantity
    inventory[itemId] = Math.max(0, available - accepted)
    if (inventory[itemId] <= 0) delete inventory[itemId]
    return accepted
  }

  private depositIntoStorage(object: FactoryObject, itemId: string, requested: number): number {
    const quantity = Math.max(0, Math.round(requested))
    if (quantity <= 0) return 0
    if (object.type === 'outboundWarehouse') {
      const inventory = this.rackInventories.get(object.id)
      if (!inventory) return 0
      inventory[itemId] = (inventory[itemId] ?? 0) + quantity
      this.recordBoundaryStat(object, itemId, quantity, 'produced')
      return quantity
    }
    if (!isCargoStorageRack(object)) return 0
    const inventory = this.rackInventories.get(object.id)
    if (!inventory) return 0
    const accepted = Math.min(quantity, this.availableStorageCapacity(object))
    if (accepted <= 0) return 0
    inventory[itemId] = (inventory[itemId] ?? 0) + accepted
    return accepted
  }

  private storageItemQuantity(object: FactoryObject, itemId: string): number {
    if (object.type === 'inboundWarehouse') return object.itemId === itemId ? Number.POSITIVE_INFINITY : 0
    return this.rackInventories.get(object.id)?.[itemId] ?? 0
  }

  /** Inventory triggers gate only the departure of a new empty trip. */
  private vehicleTripConditionsMet(program: AgvProgram): boolean {
    if ((program.dispatchMode ?? 'continuous') !== 'threshold') return true
    if (!program.itemId || !program.sourceObjectId || !program.destinationObjectId) return false
    const source = this.objectById.get(program.sourceObjectId)
    const destination = this.objectById.get(program.destinationObjectId)
    if (!source || !destination || !canSupplyVehicle(source.type) || !canReceiveVehicle(destination.type)) return false
    const sourceMinimum = Math.max(0, Math.round(program.sourceMinQuantity ?? program.loadQuantity))
    const destinationMaximum = Math.max(0, Math.round(program.destinationMaxQuantity ?? 100))
    return this.storageItemQuantity(source, program.itemId) >= sourceMinimum
      && this.storageItemQuantity(destination, program.itemId) <= destinationMaximum
  }

  private resolveRackConnection(runtime: SourceRuntime, station: FactoryObject, itemId: string, mode: 'pickup' | 'store'): { side: StationRackSide; rack: FactoryObject } | null {
    const connections = stationRackConnections(station, this.factoryObjects)
    const configured = station.stationProgram?.rackAssignments[itemId]
    const usable = (side: StationRackSide | undefined) => {
      if (!side) return null
      const rack = connections[side]
      if (!rack) return null
      if (mode === 'pickup' && (this.rackInventories.get(rack.id)?.[itemId] ?? 0) <= 0) return null
      if (mode === 'store' && this.availableStorageCapacity(rack) <= 0) return null
      return { side, rack }
    }
    if (configured) {
      runtime.rackAssignments[itemId] = configured
      return usable(configured)
    }
    if (mode === 'store') {
      const existing = usable(runtime.rackAssignments[itemId])
      if (existing) return existing
    }
    const candidates = (['back', 'left', 'right'] as const)
      .map((side) => usable(side))
      .filter((entry): entry is { side: StationRackSide; rack: FactoryObject } => Boolean(entry))
    if (candidates.length === 0) return null
    const connection = candidates[Math.floor(this.rng() * candidates.length)]
    if (mode === 'store') runtime.rackAssignments[itemId] = connection.side
    return connection
  }

  private stepAgvs(dt: number): void {
    for (const runtime of [...this.agvs.values()].sort((left, right) => left.objectId.localeCompare(right.objectId))) {
      const mission = this.agvMission(runtime)
      if (mission.length === 0) {
        runtime.path = []
        runtime.waypointIndex = 0
        runtime.motionStatus = 'idle'
        runtime.decision = 'idle'
        const programReady = Boolean(runtime.program?.enabled && runtime.program.itemId && runtime.program.sourceObjectId && runtime.program.destinationObjectId)
        runtime.currentWaypointLabel = programReady && !this.vehicleTripConditionsMet(runtime.program!) ? '等待库存条件' : '任务已停用'
        continue
      }

      runtime.retryTimer = Math.max(0, runtime.retryTimer - dt)
      if (runtime.path.length === 0) {
        runtime.motionStatus = 'waiting'
        runtime.decision = runtime.blockedSeconds > 0 ? 'replanning' : 'yielding'
        if (runtime.retryTimer > 0) continue
        if (this.planAgvPath(runtime)) {
          runtime.motionStatus = 'moving'
          runtime.decision = 'moving'
        } else {
          runtime.retryTimer = runtime.blockedSeconds > 2.5 ? 1.2 : 0.5
        }
        continue
      }

      if (runtime.waypointIndex >= runtime.path.length) {
        if (runtime.pathMode === 'recovery') {
          runtime.path = []
          runtime.waypointIndex = 0
          runtime.pathMode = 'mission'
          runtime.blockedSeconds = 0
          runtime.decision = 'replanning'
          continue
        }
        if (runtime.pathMode === 'yield') {
          runtime.path = []
          runtime.waypointIndex = 0
          runtime.pathMode = 'mission'
          runtime.blockedSeconds = 0
          runtime.retryTimer = 0.35
          runtime.motionStatus = 'waiting'
          runtime.decision = 'yielding'
          continue
        }
        const arrivedTarget = mission[runtime.routeIndex % mission.length]
        if (!this.applyAgvArrival(runtime, arrivedTarget)) {
          runtime.motionStatus = 'waiting'
          runtime.decision = 'idle'
          runtime.retryTimer = 0.5
          continue
        }
        runtime.routeIndex = (runtime.routeIndex + 1) % mission.length
        runtime.path = []
        runtime.waypointIndex = 0
        runtime.motionStatus = 'waiting'
        runtime.blockedSeconds = 0
        runtime.decision = 'moving'
        continue
      }

      const target = runtime.path[runtime.waypointIndex]
      const dx = target.x - runtime.position.x
      const dz = target.z - runtime.position.z
      const distance = Math.hypot(dx, dz)
      const travel = Math.min(distance, AGV_SPEED * dt)
      const nextPosition = distance <= 0.0001 || travel >= distance
        ? target
        : { x: runtime.position.x + dx / distance * travel, z: runtime.position.z + dz / distance * travel }
      const blocker = this.blockingAgv(runtime, nextPosition)
      if (blocker) {
        const yielding = this.shouldYield(runtime, blocker)
        if (yielding && runtime.decision !== 'yielding' && runtime.decision !== 'replanning') runtime.yieldCount += 1
        runtime.blockedSeconds += dt
        runtime.motionStatus = 'waiting'
        runtime.decision = yielding ? 'yielding' : 'replanning'
        if (runtime.retryTimer <= 0) {
          if (yielding && runtime.blockedSeconds >= 0.15) {
            // First response is a constant-time retreat along the already
            // validated path. Only a persistent conflict is allowed to invoke
            // the expensive global planner.
            const yieldPath = this.planYieldPath(runtime, blocker, runtime.blockedSeconds >= 1)
            if (yieldPath) {
              runtime.path = yieldPath
              runtime.waypointIndex = 1
              runtime.pathMode = 'yield'
              runtime.retryTimer = 0
              runtime.decision = 'yielding'
            } else {
              runtime.retryTimer = 0.1
            }
          } else if (runtime.blockedSeconds >= 3) {
            const escapePath = this.planEscapePath(runtime, blocker)
            if (escapePath) {
              runtime.path = escapePath
              runtime.waypointIndex = 1
              runtime.pathMode = 'recovery'
              runtime.retryTimer = 0
              runtime.decision = 'recovering'
            } else {
              runtime.path = []
              runtime.waypointIndex = 0
              runtime.retryTimer = 1.25
              runtime.decision = 'recovering'
            }
          } else {
            // The right-of-way vehicle keeps its current mission path. The
            // yielding vehicle is responsible for backing out of the conflict
            // zone; clearing both paths here creates a mutual replanning deadlock.
            runtime.retryTimer = 0.25
          }
        }
        continue
      }

      runtime.blockedSeconds = 0
      if (distance <= 0.0001 || travel >= distance) {
        runtime.position = { ...target }
        runtime.waypointIndex += 1
        runtime.distanceTravelled += distance
      } else {
        runtime.position = {
          x: runtime.position.x + dx / distance * travel,
          z: runtime.position.z + dz / distance * travel,
        }
        runtime.distanceTravelled += travel
      }
      if (distance > 0.0001) runtime.headingY = Math.atan2(dz, dx)
      runtime.motionStatus = 'moving'
      runtime.decision = 'moving'
    }
  }

  private planAgvPath(runtime: AgvRuntime): boolean {
    const mission = this.agvMission(runtime)
    if (mission.length === 0) return false
    const target = mission[runtime.routeIndex % mission.length]
    const candidates = target.candidates ?? [target.position]
    const nextPath = candidates
      .map((candidate) => findAgvPath(this.factoryObjects, runtime.position, candidate, runtime.objectId, this.dynamicObstaclesFor(runtime, true)))
      .find((path): path is AgvNavigationPoint[] => Boolean(path && path.length > 1))
      ?? candidates
        .map((candidate) => findAgvPath(this.factoryObjects, runtime.position, candidate, runtime.objectId, this.dynamicObstaclesFor(runtime)))
        .find((path): path is AgvNavigationPoint[] => Boolean(path && path.length > 1))
    if (!nextPath || nextPath.length <= 1) return false
    runtime.path = nextPath
    runtime.waypointIndex = 1
    runtime.pathMode = 'mission'
    runtime.phase = target.kind === 'warehouse' ? 'to-warehouse' : target.kind === 'line-side' ? 'to-line' : target.kind === 'source' ? 'to-source' : 'to-destination'
    runtime.currentWaypointLabel = target.label
    runtime.retryTimer = 0
    return true
  }

  private agvMission(runtime: AgvRuntime): AgvMissionTarget[] {
    const program = runtime.program
    if (!program?.enabled || !program.itemId || !program.sourceObjectId || !program.destinationObjectId) return []
    if (runtime.cargoQuantity <= 0 && runtime.path.length === 0 && runtime.routeIndex === 0 && !this.vehicleTripConditionsMet(program)) return []
    const source = program?.sourceObjectId ? this.objectById.get(program.sourceObjectId) : undefined
    const destination = program?.destinationObjectId ? this.objectById.get(program.destinationObjectId) : undefined
    if (program?.enabled && source && destination) {
      const configuredRoute = program.route?.filter((waypoint) => waypoint.position && waypoint.action)
      if (configuredRoute && configuredRoute.length >= 2) return configuredRoute.map((waypoint) => this.missionTargetFromWaypoint(waypoint))
      return [
        this.missionTargetFromWaypoint({ id: 'source', label: '起点装货', objectId: source.id, position: agvDockCandidates(source)[0], action: 'load' }),
        this.missionTargetFromWaypoint({ id: 'destination', label: '终点卸货', objectId: destination.id, position: agvDockCandidates(destination)[0], action: 'unload' }),
      ]
    }
    return []
  }

  private missionTargetFromWaypoint(waypoint: AgvRouteWaypoint): AgvMissionTarget {
    const object = waypoint.objectId ? this.objectById.get(waypoint.objectId) : undefined
    const candidates = object ? agvDockCandidates(object) : undefined
    return {
      objectId: waypoint.objectId,
      position: candidates?.[0] ?? waypoint.position,
      candidates,
      kind: waypoint.action === 'load' ? 'source' : waypoint.action === 'unload' ? 'destination' : 'line-side',
      action: waypoint.action,
      label: waypoint.label,
    }
  }

  private applyAgvArrival(runtime: AgvRuntime, target: AgvMissionTarget): boolean {
    if (target.action === 'pass') return true
    const storage = target.objectId ? this.objectById.get(target.objectId) : undefined
    const itemId = runtime.program?.itemId
    if (!storage || !itemId || !isStorageFacilityType(storage.type)) return false
    if (target.action === 'load') {
      if (runtime.cargoQuantity > 0) return true
      const loaded = this.withdrawFromStorage(storage, itemId, runtime.program?.loadQuantity ?? 1)
      if (loaded <= 0) {
        runtime.currentWaypointLabel = `${target.label} · 等待库存`
        return false
      }
      runtime.cargoItemId = itemId
      runtime.cargoQuantity = loaded
    } else if (target.action === 'unload') {
      if (runtime.cargoQuantity <= 0 || !runtime.cargoItemId) return true
      const unloaded = this.depositIntoStorage(storage, runtime.cargoItemId, runtime.cargoQuantity)
      runtime.cargoQuantity -= unloaded
      if (runtime.cargoQuantity > 0) {
        runtime.currentWaypointLabel = `${target.label} · 等待容量`
        return false
      }
      runtime.completedTrips += 1
      runtime.cargoItemId = null
    }
    return true
  }

  private dynamicObstaclesFor(runtime: AgvRuntime, includeLookahead = false): AgvDynamicObstacle[] {
    const obstacles: AgvDynamicObstacle[] = []
    for (const other of this.agvs.values()) {
      if (other.objectId === runtime.objectId || other.motionStatus === 'idle') continue
      obstacles.push({ position: other.position, radius: AGV_NAV_RADIUS })
      const next = other.path[other.waypointIndex]
      if (next) obstacles.push({ position: next, radius: AGV_NAV_RADIUS })
      if (!includeLookahead) continue

      // Reserve the next few cells of each moving AGV's route. A planner that
      // only sees the current cell discovers the conflict too late, when both
      // vehicles are already inside the same narrow aisle.
      const lookahead = [other.position, ...other.path.slice(other.waypointIndex, other.waypointIndex + 4)]
      for (let index = 1; index < lookahead.length; index += 1) {
        const from = lookahead[index - 1]
        const to = lookahead[index]
        const distance = Math.hypot(to.x - from.x, to.z - from.z)
        const samples = Math.min(8, Math.max(1, Math.ceil(distance)))
        for (let sample = 1; sample <= samples; sample += 1) {
          const progress = sample / samples
          obstacles.push({
            position: {
              x: from.x + (to.x - from.x) * progress,
              z: from.z + (to.z - from.z) * progress,
            },
            radius: AGV_NAV_RADIUS,
          })
        }
      }
    }
    return obstacles
  }

  private blockingAgv(runtime: AgvRuntime, position: AgvNavigationPoint): AgvRuntime | undefined {
    return [...this.agvs.values()]
      .filter((other) => other.objectId !== runtime.objectId && other.motionStatus !== 'idle')
      .find((other) => Math.hypot(other.position.x - position.x, other.position.z - position.z) < AGV_CENTER_CLEARANCE)
  }

  private planEscapePath(runtime: AgvRuntime, blocker: AgvRuntime): AgvNavigationPoint[] | null {
    const awayX = Math.sign(runtime.position.x - blocker.position.x) || 1
    const awayZ = Math.sign(runtime.position.z - blocker.position.z) || 1
    const candidates = [
      { x: runtime.position.x + awayX * 3, z: runtime.position.z },
      { x: runtime.position.x, z: runtime.position.z + awayZ * 3 },
      { x: runtime.position.x - awayX * 3, z: runtime.position.z },
      { x: runtime.position.x, z: runtime.position.z - awayZ * 3 },
    ]
    return candidates
      .map((candidate) => findAgvPath(this.factoryObjects, runtime.position, candidate, runtime.objectId, this.dynamicObstaclesFor(runtime, true)))
      .find((path): path is AgvNavigationPoint[] => Boolean(path && path.length > 1)) ?? null
  }

  private planYieldPath(runtime: AgvRuntime, blocker: AgvRuntime, allowGlobalSearch: boolean): AgvNavigationPoint[] | null {
    const retreatPoint = runtime.path
      .slice(0, runtime.waypointIndex)
      .reverse()
        .find((point) => Math.hypot(point.x - runtime.position.x, point.z - runtime.position.z) > 0.8 && Math.hypot(point.x - blocker.position.x, point.z - blocker.position.z) >= AGV_CENTER_CLEARANCE)
    if (retreatPoint) return [{ ...runtime.position }, { ...retreatPoint }]
    if (!allowGlobalSearch) return null

    const next = runtime.path[runtime.waypointIndex]
    const moveX = (next ? Math.sign(next.x - runtime.position.x) : 0) || Math.sign(runtime.position.x - blocker.position.x) || 1
    const moveZ = (next ? Math.sign(next.z - runtime.position.z) : 0) || Math.sign(runtime.position.z - blocker.position.z) || 0
    const away = { x: -moveX, z: -moveZ }
    const targets = [
      ...runtime.path
        .slice(0, runtime.waypointIndex)
        .reverse()
        .filter((point) => Math.hypot(point.x - runtime.position.x, point.z - runtime.position.z) > 0.8),
      { x: runtime.position.x + away.x * 2, z: runtime.position.z + away.z * 2 },
      { x: runtime.position.x + away.x * 3, z: runtime.position.z + away.z * 3 },
      { x: runtime.position.x + away.z * 2, z: runtime.position.z - away.x * 2 },
      { x: runtime.position.x - away.z * 2, z: runtime.position.z + away.x * 2 },
    ]
    const dynamicObstacles = this.dynamicObstaclesFor(runtime, true)
    return targets
      .filter((target) => Math.hypot(target.x - blocker.position.x, target.z - blocker.position.z) >= AGV_CENTER_CLEARANCE)
      .map((target) => findAgvPath(this.factoryObjects, runtime.position, target, runtime.objectId, dynamicObstacles))
      .find((path): path is AgvNavigationPoint[] => Boolean(path && path.length > 1)) ?? null
  }

  private shouldYield(runtime: AgvRuntime, blocker: AgvRuntime) {
    // Priority is explicit, while trip count provides aging: a vehicle that
    // has already completed more work gives way to a waiting vehicle instead
    // of monopolising a shared dock forever.
    const priority = (runtime.program?.priority ?? 0) * 100 - runtime.completedTrips
    const blockerPriority = (blocker.program?.priority ?? 0) * 100 - blocker.completedTrips
    return priority < blockerPriority || (priority === blockerPriority && runtime.objectId > blocker.objectId)
  }

  /** A transfer is valid only when the upstream output faces the downstream input. */
  private isConnected(upstream: FactoryObject, downstream: FactoryObject): boolean {
    if (isInclineConveyorType(upstream.type) && upstream.incline) {
      if (inclineTargetFloor(upstream) !== (downstream.floorId ?? 1)) return false
      const end = inclineEndCell(upstream)
      return objectCompatiblePortCells(downstream, 'input').some((input) => input.x === end.x && input.z === end.z)
    }
    if (isInclineConveyorType(downstream.type) && downstream.incline) {
      if ((upstream.floorId ?? 1) !== inclineStartFloor(downstream)) return false
      const input = inclineInputCell(downstream)
      return occupiedCells(upstream).some((cell) => cell.x === input.x && cell.z === input.z)
    }
    if ((upstream.floorId ?? 1) !== (downstream.floorId ?? 1)) return false
    const upstreamRole = objectRole(upstream.type, upstream.resourceId)
    const downstreamRole = objectRole(downstream.type, downstream.resourceId)
    if (upstreamRole === 'machine') {
      const downstreamCells = occupiedCells(downstream)
      const connectedOutput = objectCompatiblePortCells(upstream, 'output')
        .find((output) => downstreamCells.some((cell) => cell.x === output.x && cell.z === output.z))
      if (!connectedOutput) return false
      if (!isTransportType(downstream.type, downstream.resourceId)) return true
      const centre = objectToWorld(upstream)
      const beltDirection = rotationToDir(downstream.rotation)
      return beltDirection.dx * (connectedOutput.x + 0.5 - centre.x)
        + beltDirection.dz * (connectedOutput.z + 0.5 - centre.z) > 0
    }
    const inputCells = objectCompatiblePortCells(downstream, 'input')
    if (downstreamRole === 'machine') {
      const connectedInput = inputCells.find((input) => occupiedCells(upstream)
        .some((cell) => cell.x === input.x && cell.z === input.z))
      if (!connectedInput) return false
      if (!isTransportType(upstream.type, upstream.resourceId)) return true
      const machineCentre = objectToWorld(downstream)
      const upstreamCentre = objectToWorld(upstream)
      const direction = rotationToDir(upstream.rotation)
      return direction.dx * (machineCentre.x - upstreamCentre.x)
        + direction.dz * (machineCentre.z - upstreamCentre.z) > 0
    }
    if (inputCells.length === 0) return true
    return occupiedCells(upstream).some((cell) => inputCells.some((input) => cell.x === input.x && cell.z === input.z))
  }

  /** Resolve a machine whose visible/legacy inlet is occupied by this belt. */
  private machineAtConnectedInput(upstream: FactoryObject, floorId: FactoryFloorId | undefined): FactoryObject | undefined {
    const upstreamCells = occupiedCells(upstream)
    return this.factoryObjects.find((candidate) => (
      candidate.id !== upstream.id
      && (candidate.floorId ?? 1) === (floorId ?? 1)
      && objectRole(candidate.type, candidate.resourceId) === 'machine'
      && objectCompatiblePortCells(candidate, 'input').some((input) => upstreamCells
        .some((cell) => cell.x === input.x && cell.z === input.z))
      && this.isConnected(upstream, candidate)
    ))
  }

  private makeLot(itemId: string, conveyorId: string, offset: number, id?: string): ItemLot {
    const conveyor = this.objectById.get(conveyorId)
    return {
      id: id ?? `lot_${this.lotCounter++}`,
      itemId,
      conveyorId,
      floorId: conveyor?.floorId ?? 1,
      offset,
    }
  }

  private findMachineObject(machineId: string): FactoryObject | undefined {
    return this.objectById.get(machineId)
  }

  private stepDrones(dt: number): void {
    const ordered = [...this.drones.values()].sort((left, right) => left.objectId.localeCompare(right.objectId))
    for (const runtime of ordered) {
      const endpoints = this.droneMissionEndpoints(runtime)
      if (!endpoints) {
        runtime.path = []
        runtime.waypointIndex = 0
        runtime.targetObjectId = null
        runtime.phase = 'parked'
        runtime.motionStatus = 'idle'
        continue
      }

      runtime.holdSeconds = Math.max(0, runtime.holdSeconds - dt)
      runtime.retryTimer = Math.max(0, runtime.retryTimer - dt)
      if (runtime.holdSeconds > 0) {
        runtime.motionStatus = 'waiting'
        continue
      }

      if (runtime.phase === 'to-source' && runtime.cargoQuantity <= 0 && runtime.path.length === 0 && !runtime.targetObjectId && !this.vehicleTripConditionsMet(runtime.program!)) {
        runtime.motionStatus = 'waiting'
        runtime.currentWaypointLabel = '等待库存条件'
        continue
      }

      if (runtime.path.length === 0 || runtime.waypointIndex >= runtime.path.length) {
        if (runtime.targetObjectId && !this.applyDroneArrival(runtime)) continue
        if (runtime.holdSeconds > 0) continue
        const destination = runtime.phase === 'to-destination' ? endpoints.destination : endpoints.source
        const role = runtime.phase === 'to-destination' ? 'dropoff' as const : 'pickup' as const
        if (runtime.retryTimer <= 0 && this.planDronePath(runtime, destination, role)) {
          if (runtime.path.length <= 1 && runtime.targetObjectId) {
            this.applyDroneArrival(runtime)
          } else {
            runtime.motionStatus = 'moving'
          }
        } else {
          runtime.motionStatus = 'waiting'
          runtime.retryTimer = 0.55
        }
        continue
      }

      const target = runtime.path[runtime.waypointIndex]
      const distance = Math.hypot(target.x - runtime.position.x, target.y - runtime.position.y, target.z - runtime.position.z)
      const travel = Math.min(distance, DRONE_SPEED * dt)
      const next = distance <= 0.0001 || travel >= distance
        ? target
        : {
            x: runtime.position.x + (target.x - runtime.position.x) / distance * travel,
            y: runtime.position.y + (target.y - runtime.position.y) / distance * travel,
            z: runtime.position.z + (target.z - runtime.position.z) / distance * travel,
          }
      const blocker = ordered.find((other) => other.objectId !== runtime.objectId
        && Math.hypot(other.position.x - next.x, other.position.y - next.y, other.position.z - next.z) < DRONE_SEPARATION_M)
      if (blocker) {
        runtime.motionStatus = 'waiting'
        if (runtime.retryTimer <= 0) {
          const destination = runtime.targetObjectId ? this.objectById.get(runtime.targetObjectId) : undefined
          if (destination) this.planDronePath(runtime, destination, runtime.phase === 'to-destination' ? 'dropoff' : 'pickup')
          runtime.retryTimer = 0.45
        }
        continue
      }

      advanceDrone(runtime, dt)
    }
  }

  private droneMissionEndpoints(runtime: DroneRuntime): { source: FactoryObject; destination: FactoryObject } | null {
    const program = runtime.program
    if (!program?.enabled || !program.itemId || !program.sourceObjectId || !program.destinationObjectId) return null
    const source = this.objectById.get(program.sourceObjectId)
    const destination = this.objectById.get(program.destinationObjectId)
    return source && destination ? { source, destination } : null
  }

  private planDronePath(runtime: DroneRuntime, destination: FactoryObject, role: 'pickup' | 'dropoff'): boolean {
    const dynamicObstacles: DroneDynamicObstacle[] = [...this.drones.values()]
      .filter((other) => other.objectId !== runtime.objectId && other.motionStatus !== 'idle')
      .map((other) => ({ position: other.position, radius: DRONE_SEPARATION_M }))
    const path = findDronePath(this.factoryObjects, runtime.position, destination, runtime.objectId, role, dynamicObstacles)
      ?? findDronePath(this.factoryObjects, runtime.position, destination, runtime.objectId, role)
    if (!path) return false
    runtime.path = path
    runtime.waypointIndex = Math.min(1, path.length)
    runtime.targetObjectId = destination.id
    runtime.targetFloor = destination.floorId ?? 1
    runtime.pathLabels = path.map((_, index) => index === path.length - 1
      ? `L${runtime.targetFloor} ${role === 'pickup' ? '取货点' : '卸货点'} / 对接`
      : `三维自由航路 / 节点 ${String(index + 1).padStart(2, '0')}`)
    runtime.motionStatus = path.length <= 1 ? 'waiting' : 'moving'
    runtime.currentWaypointLabel = path.length <= 1
      ? role === 'pickup' ? '已到取货点 · 执行装货' : '已到卸货点 · 执行卸货'
      : role === 'pickup' ? '前往跨层起点' : '前往跨层终点'
    return true
  }

  private applyDroneArrival(runtime: DroneRuntime): boolean {
    const storage = runtime.targetObjectId ? this.objectById.get(runtime.targetObjectId) : undefined
    const itemId = runtime.program?.itemId
    if (!storage || !itemId || !isStorageFacilityType(storage.type)) return false
    if (runtime.phase === 'to-destination') {
      if (runtime.cargoQuantity > 0 && runtime.cargoItemId) {
        const unloaded = this.depositIntoStorage(storage, runtime.cargoItemId, runtime.cargoQuantity)
        runtime.cargoQuantity -= unloaded
        if (runtime.cargoQuantity > 0) {
          runtime.currentWaypointLabel = '卸货点 · 等待容量'
          runtime.holdSeconds = 0.45
          runtime.motionStatus = 'waiting'
          return false
        }
        runtime.completedTrips += 1
      }
      runtime.cargoItemId = null
      runtime.phase = 'to-source'
      runtime.currentWaypointLabel = '卸货完成 · 返回取货'
    } else {
      const loaded = this.withdrawFromStorage(storage, itemId, runtime.program?.loadQuantity ?? 1)
      if (loaded <= 0) {
        runtime.currentWaypointLabel = '取货点 · 等待库存'
        runtime.holdSeconds = 0.45
        runtime.motionStatus = 'waiting'
        return false
      }
      runtime.cargoItemId = itemId
      runtime.cargoQuantity = loaded
      runtime.phase = 'to-destination'
      runtime.currentWaypointLabel = '装货完成 · 前往卸货'
    }
    runtime.path = []
    runtime.pathLabels = []
    runtime.waypointIndex = 0
    runtime.targetObjectId = null
    runtime.holdSeconds = 0.45
    runtime.motionStatus = 'waiting'
    return true
  }

  getSnapshot(): SimulationSnapshot {
    const lots: ItemLot[] = []
    for (const c of this.conveyors.values()) {
      if (c.lot) lots.push({ ...c.lot })
    }
    return {
      timeSec: this.timeSec,
      machines: Array.from(this.machines.values()).map((m) => ({ ...m })),
      sources: Array.from(this.sources.values()).map((s) => {
        const station = this.objectById.get(s.objectId)
        const connections = station ? stationRackConnections(station, this.factoryObjects) : {}
        const inventory: Record<string, number> = {}
        Object.values(connections).forEach((rack) => {
          if (!rack) return
          Object.entries(this.rackInventories.get(rack.id) ?? {}).forEach(([itemId, quantity]) => {
            inventory[itemId] = (inventory[itemId] ?? 0) + quantity
          })
        })
        return {
          objectId: s.objectId,
          itemId: s.itemId,
          state: s.state,
          progress: s.transferTimer > 0 ? Math.min(s.transferTimer / SOURCE_TRANSFER_TIME, 1) : 0,
          mode: s.mode,
          rackSide: s.rackSide,
          rackObjectId: s.rackObjectId,
          rackConnections: Object.fromEntries(Object.entries(connections).map(([side, rack]) => [side, rack?.id])),
          inventory,
        }
      }),
      racks: Array.from(this.rackInventories.entries()).map(([objectId, inventory]) => {
        const object = this.objectById.get(objectId)
        const kind = object?.type === 'inboundWarehouse' ? 'inbound' as const : object?.type === 'outboundWarehouse' ? 'outbound' as const : 'rack' as const
        return { objectId, inventory: { ...inventory }, kind, capacity: kind === 'rack' ? this.rackCapacities.get(objectId) ?? 100 : null }
      }),
      itemLots: lots,
      agvs: Array.from(this.agvs.values()).map((runtime) => ({
        objectId: runtime.objectId,
        position: { ...runtime.position },
        headingY: runtime.headingY,
        phase: runtime.phase,
        motionStatus: runtime.motionStatus,
        path: runtime.path.map((point) => ({ ...point })),
        waypointIndex: runtime.waypointIndex,
        cargoItemId: runtime.cargoItemId,
        cargoQuantity: runtime.cargoQuantity,
        completedTrips: runtime.completedTrips,
        distanceTravelled: runtime.distanceTravelled,
        decision: runtime.decision,
        blockedSeconds: runtime.blockedSeconds,
        yieldCount: runtime.yieldCount,
        currentWaypointLabel: runtime.currentWaypointLabel,
      })),
      drones: Array.from(this.drones.values()).map((runtime) => ({
        objectId: runtime.objectId,
        position: { ...runtime.position },
        headingY: runtime.headingY,
        phase: runtime.phase,
        motionStatus: runtime.motionStatus,
        path: runtime.path.map((point) => ({ ...point })),
        waypointIndex: runtime.waypointIndex,
        targetFloor: runtime.targetFloor,
        deliveryPointIndex: runtime.deliveryPointIndex,
        cargoItemId: runtime.cargoItemId,
        cargoQuantity: runtime.cargoQuantity,
        completedTrips: runtime.completedTrips,
        distanceTravelled: runtime.distanceTravelled,
        currentWaypointLabel: runtime.pathLabels[runtime.waypointIndex] ?? runtime.currentWaypointLabel,
      })),
      stats: {
        consumed: { ...this.stats.consumed },
        produced: { ...this.stats.produced },
      },
      floorStats: Object.fromEntries(Object.entries(this.floorStats).map(([floorId, stats]) => [floorId, {
        consumed: { ...stats.consumed },
        produced: { ...stats.produced },
      }])),
    }
  }
}

const AGV_SPEED = 2.2
const DRONE_SPEED = 4.5

function createAgvRuntime(object: FactoryObject): AgvRuntime {
  const position = objectToWorld(object)
  const direction = rotationToDir(object.rotation)
  return {
    objectId: object.id,
    position,
    headingY: Math.atan2(direction.dz, direction.dx),
    phase: 'to-warehouse',
    motionStatus: 'waiting',
    path: [],
    waypointIndex: 0,
    routeIndex: 0,
    cargoItemId: null,
    cargoQuantity: 0,
    completedTrips: 0,
    distanceTravelled: 0,
    retryTimer: 0,
    program: object.agvProgram ? { ...object.agvProgram } : null,
    decision: 'idle',
    blockedSeconds: 0,
    yieldCount: 0,
    currentWaypointLabel: '待规划',
    pathMode: 'mission',
  }
}

function createDroneRuntime(object: FactoryObject): DroneRuntime {
  const world = objectToWorld(object)
  const floorId = object.floorId ?? 1
  return {
    objectId: object.id,
    position: { x: world.x, y: (floorId - 1) * FLOOR_HEIGHT_M + DRONE_HOVER_HEIGHT_M, z: world.z },
    headingY: 0,
    phase: object.agvProgram?.enabled ? 'to-source' : 'parked',
    motionStatus: 'waiting',
    path: [],
    pathLabels: [],
    waypointIndex: 0,
    targetFloor: floorId,
    deliveryPointIndex: 0,
    cargoItemId: null,
    cargoQuantity: 0,
    completedTrips: 0,
    distanceTravelled: 0,
    holdSeconds: 0.35,
    retryTimer: 0,
    targetObjectId: null,
    program: object.agvProgram ? { ...object.agvProgram } : null,
    currentWaypointLabel: '等待运输任务',
  }
}

function advanceDrone(runtime: DroneRuntime, dt: number): void {
  let remaining = DRONE_SPEED * dt
  while (remaining > 0 && runtime.waypointIndex < runtime.path.length) {
    const target = runtime.path[runtime.waypointIndex]
    const dx = target.x - runtime.position.x
    const dy = target.y - runtime.position.y
    const dz = target.z - runtime.position.z
    const segment = Math.hypot(dx, dy, dz)
    if (segment < 0.001) {
      runtime.position = { ...target }
      runtime.waypointIndex += 1
      continue
    }
    runtime.headingY = Math.atan2(dz, dx)
    if (remaining >= segment) {
      runtime.position = { ...target }
      runtime.distanceTravelled += segment
      remaining -= segment
      runtime.waypointIndex += 1
    } else {
      const amount = remaining / segment
      runtime.position = {
        x: runtime.position.x + dx * amount,
        y: runtime.position.y + dy * amount,
        z: runtime.position.z + dz * amount,
      }
      runtime.distanceTravelled += remaining
      remaining = 0
    }
  }

  if (runtime.waypointIndex >= runtime.path.length) {
    runtime.motionStatus = 'waiting'
  }
}
