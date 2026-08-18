import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type WheelEvent as ReactWheelEvent } from 'react'
import { Activity, ArrowDown, ArrowUp, Boxes, ChevronRight, Clock3, Construction, Cpu, Eye, Gauge, Grid3X3, Layers, MoveUpRight, PackageOpen, PanelRight, Pause, Play, Plus, RotateCcw, RotateCw, SunMedium, Trash2, Truck, Warehouse, X } from 'lucide-react'
import { FactoryScene, type FactorySceneHandle, type PlacementPreview } from '../components/factory/FactoryScene'
import { INCLINE_REFERENCE_RUN_M, MACHINE_PORT_INDICES, alignPathToPorts, appendGridTrace, conveyorEndpointFloorId, inclineHorizontalRun, nearestConveyorPort, pathFromGridTrace, polylineLength, supportsTripleConveyorPorts, type ConveyorEndpointSnap, type GridPoint, type MachinePortIndex } from '../domain/conveyorPath'
import { conveyorPlacementBlocked, facilityPlacementBlocked } from '../domain/placementCollision'
import { useForgeStore } from '../store/useForgeStore'
import { useShallow } from 'zustand/react/shallow'
import type { AppPage } from '../components/Sidebar'
import type { AgvProgram, ConveyorObjectConfig, FactoryObject, FactoryObjectKind, Floor, FloorVisibilityMode, GridTransform, InventoryRecord, Item, NewFactoryObject, RackObjectConfig, Recipe, SimulationSpeed, VehicleObjectConfig, WarehouseDispatchIntervalsSec } from '../types'

type DockTab = 'build' | 'run' | 'view'
const simulationSpeeds: SimulationSpeed[] = [1, 2, 5, 10]
const floorVisibilityOptions: Array<{ value: FloorVisibilityMode; label: string; hint: string }> = [
  { value: 'current-only', label: '仅当前层', hint: '只显示当前楼层对象' },
  { value: 'lower-transparent', label: '多层透视', hint: '已开启的其他楼层半透明' },
  { value: 'lower-solid', label: '多层实显', hint: '已开启的所有楼层正常显示' },
]

const KENNEY_ROOT = 'assets/3d/vendor/kenney-factory-kit-3.0/Models/GLB format/'
const MODEL_REFS = {
  machine: `${KENNEY_ROOT}machine-fortified.glb`,
  conveyor: `${KENNEY_ROOT}conveyor-long-stripe-sides.glb`,
  rack: `${KENNEY_ROOT}machine-window.glb`,
  shelf: 'assets/3d/vendor/mastjie-low-poly-warehouse-kit/glb/rack.glb',
  agv: 'assets/3d/vendor/cels-industrial-agv-trolley/industrial_3d_agv_trolley_free_low-poly_3d_model.glb',
  drone: 'assets/3d/vendor/count-infinity-futuristic-delivery-drone/futuristic_delivery_drone.glb',
} as const

interface BuildEntry {
  id: string
  kind: FactoryObjectKind
  name: string
  subtitle: string
  icon: typeof Cpu
  footprint: [number, number]
  modelRef: string | null
  placementMode: 'facility' | 'draw-conveyor' | 'incline-conveyor'
}

interface FacilityDragSession {
  id: string
  pointerId: number
  startClientX: number
  startClientY: number
  grabOffsetX: number
  grabOffsetZ: number
  captureTarget: HTMLElement | null
  started: boolean
  moved: boolean
  lastAttemptKey: string
}

const buildEntries: BuildEntry[] = [
  { id: 'machine', kind: 'machine', name: '机器', subtitle: '6×6 网格 · 3进3出', icon: Cpu, footprint: [6, 6], modelRef: MODEL_REFS.machine, placementMode: 'facility' },
  { id: 'rack', kind: 'rack', name: '货物仓库', subtitle: '6×6 网格 · 3进3出', icon: Warehouse, footprint: [6, 6], modelRef: MODEL_REFS.rack, placementMode: 'facility' },
  { id: 'shelf', kind: 'shelf', name: '货架', subtitle: '8×2 网格 · 无限堆叠', icon: Layers, footprint: [8, 2], modelRef: MODEL_REFS.shelf, placementMode: 'facility' },
  { id: 'conveyor', kind: 'conveyor', name: '传送带', subtitle: '端头吸附 · 自由续拉', icon: Boxes, footprint: [1, 1], modelRef: MODEL_REFS.conveyor, placementMode: 'draw-conveyor' },
  { id: 'incline-conveyor', kind: 'conveyor', name: '跨层传送带', subtitle: '固定坡度 · 上下运输', icon: MoveUpRight, footprint: [INCLINE_REFERENCE_RUN_M, 1], modelRef: MODEL_REFS.conveyor, placementMode: 'incline-conveyor' },
  { id: 'buffer', kind: 'buffer', name: '缓冲区', subtitle: '业务区域', icon: PackageOpen, footprint: [2, 2], modelRef: null, placementMode: 'facility' },
  { id: 'agv', kind: 'agv', name: 'AGV', subtitle: '仅1F · 八方向 A*', icon: Truck, footprint: [4, 4], modelRef: MODEL_REFS.agv, placementMode: 'facility' },
  { id: 'drone', kind: 'drone', name: '货运无人机', subtitle: '跨层 · 26邻域 3D A*', icon: MoveUpRight, footprint: [3, 3], modelRef: MODEL_REFS.drone, placementMode: 'facility' },
]

export function FactoryEditorPage({ onNavigate }: { onNavigate: (page: AppPage) => void }) {
  const {
    factory, floors, objects, items, recipes, inventory, selectedObjectId, simulation, saveStatus,
    addFloor, selectObject, renameObject, addObject, addConveyorPath, addInclineConveyor, reverseInclineDirection, moveObject, rotateObject, deleteObject,
    updateObjectConfig, adjustInventory, setInventoryInfiniteSupply, playSimulation, pauseSimulation, setSimulationSpeed, resetSimulation,
  } = useForgeStore(useShallow((state) => ({
    factory: state.factory,
    floors: state.floors,
    objects: state.objects,
    items: state.items,
    recipes: state.recipes,
    inventory: state.inventory,
    selectedObjectId: state.selectedObjectId,
    simulation: state.simulation,
    saveStatus: state.saveStatus,
    addFloor: state.addFloor,
    selectObject: state.selectObject,
    renameObject: state.renameObject,
    addObject: state.addObject,
    addConveyorPath: state.addConveyorPath,
    addInclineConveyor: state.addInclineConveyor,
    reverseInclineDirection: state.reverseInclineDirection,
    moveObject: state.moveObject,
    rotateObject: state.rotateObject,
    deleteObject: state.deleteObject,
    updateObjectConfig: state.updateObjectConfig,
    adjustInventory: state.adjustInventory,
    setInventoryInfiniteSupply: state.setInventoryInfiniteSupply,
    playSimulation: state.playSimulation,
    pauseSimulation: state.pauseSimulation,
    setSimulationSpeed: state.setSimulationSpeed,
    resetSimulation: state.resetSimulation,
  })))
  const sceneRef = useRef<FactorySceneHandle>(null)
  const conveyorTraceRef = useRef<GridPoint[]>([])
  const conveyorStartSnapRef = useRef<ConveyorEndpointSnap<FactoryObject> | null>(null)
  const lastPlacementClickAtRef = useRef(0)
  const lastWheelRotationAtRef = useRef(0)
  const facilityDragRef = useRef<FacilityDragSession | null>(null)
  const [inspectorOpen, setInspectorOpen] = useState(true)
  const [placementPreview, setPlacementPreview] = useState<PlacementPreview | null>(null)
  const [activeBuildEntryId, setActiveBuildEntryId] = useState<string | null>(null)
  const [isConveyorDrawing, setIsConveyorDrawing] = useState(false)
  const [lastBuildMessage, setLastBuildMessage] = useState<string | null>(null)
  const [conveyorSnapLabel, setConveyorSnapLabel] = useState<string | null>(null)
  const [placementRotation, setPlacementRotation] = useState<GridTransform['rotationY']>(0)
  const [draggingObjectId, setDraggingObjectId] = useState<string | null>(null)
  const [dragStatus, setDragStatus] = useState<string | null>(null)
  const [dockTab, setDockTab] = useState<DockTab>('build')
  const [showGrid, setShowGrid] = useState(true)
  const [showLabels, setShowLabels] = useState(true)
  const [shadowsEnabled, setShadowsEnabled] = useState(true)
  const [activeFloorId, setActiveFloorId] = useState(() => useForgeStore.getState().floors[0]?.id ?? '')
  const [floorVisibilityMode, setFloorVisibilityMode] = useState<FloorVisibilityMode>('current-only')
  const [floorEnabledById, setFloorEnabledById] = useState<Record<string, boolean>>(() => Object.fromEntries(
    useForgeStore.getState().floors.map((floor) => [floor.id, true]),
  ))
  const [newFloorHeightM, setNewFloorHeightM] = useState(4.5)
  const [inclineDirection, setInclineDirection] = useState<'up' | 'down'>('up')
  const activeEntry = buildEntries.find((entry) => entry.id === activeBuildEntryId) ?? null
  const activeFloor = floors.find((floor) => floor.id === activeFloorId) ?? floors[0]
  const enabledFloorIds = useMemo(
    () => new Set(floors.filter((floor) => floorEnabledById[floor.id] !== false).map((floor) => floor.id)),
    [floorEnabledById, floors],
  )
  const nextFloor = activeFloor ? floors.find((floor) => floor.level === activeFloor.level + 1) : undefined
  const buildHint = !activeEntry
    ? '选择建筑后按住拖动可调整位置'
    : activeEntry.placementMode === 'draw-conveyor'
      ? isConveyorDrawing ? '保持按住并沿网格拖动；释放完成铺设' : '已选择传送带：在网格上按住并拖绘；右键、Esc 或再次单击取消'
      : activeEntry.placementMode === 'incline-conveyor'
        ? nextFloor ? `连接 ${activeFloor?.name} 与 ${nextFloor.name} · 固定 75% 坡度 · 滚轮旋转，单击放置` : '请先新建上一层，再放置跨层传送带'
      : `已选择 ${activeEntry.name}：滚轮旋转，单击网格放置；右键、Esc 或再次单击取消`
  const placementStatus = !activeEntry
    ? dragStatus
    : lastBuildMessage ?? conveyorSnapLabel ?? (activeEntry.placementMode === 'incline-conveyor' && placementPreview?.path?.length
      ? `跨层传送带 · ${inclineDirection === 'up' ? '向上' : '向下'}运输 · ${placementRotation}° · ${placementPreview.valid === false ? '不可放置' : '可放置'}`
      : placementPreview?.kind === 'facility' && placementPreview.point
      ? `${activeEntry.name} · 网格 ${placementPreview.point.x}, ${placementPreview.point.z} · ${placementRotation}° · ${placementPreview.valid === false ? '不可放置' : '可放置'}`
      : placementPreview?.kind === 'conveyor' && placementPreview.path?.length
        ? `${isConveyorDrawing ? '正在铺设' : '传送带起点'} · ${polylineLength(placementPreview.path).toFixed(1)} m · ${Math.max(0, placementPreview.path.length - 2)} 个弯道`
        : `${activeEntry.name} · 将鼠标移入工厂网格`)
  const selected = objects.find((object) => object.id === selectedObjectId)
  const running = simulation.status === 'running'
  const conveyors = objects.filter((object) => object.kind === 'conveyor')
  const facilities = objects.filter((object) => object.kind !== 'conveyor')
  const activeFacilities = facilities.filter((object) => object.floorId === activeFloor?.id)
  const activeConveyors = conveyors.filter((object) => object.config.kind === 'conveyor' && (
    conveyorEndpointFloorId({ floorId: object.floorId, config: object.config }, 'start') === activeFloor?.id
    || conveyorEndpointFloorId({ floorId: object.floorId, config: object.config }, 'end') === activeFloor?.id
  ))

  const placeFacility = (entry: BuildEntry, point: GridPoint) => {
    const footprint = rotatedFootprint(entry.footprint, placementRotation)
    const { position } = facilityPlacement(entry, point, factory.gridSizeM, placementRotation)
    const input: NewFactoryObject = {
      kind: entry.kind,
      floorId: activeFloor?.id,
      name: `${entry.name} ${facilities.filter((object) => object.kind === entry.kind && object.floorId === activeFloor?.id).length + 1}`,
      modelRef: entry.modelRef,
      transform: { ...position, rotationY: placementRotation },
      footprint,
    }
    const id = addObject(input)
    if (id) {
      selectObject(null)
      setInspectorOpen(false)
      setLastBuildMessage(`已放置 ${entry.name} · 建造工具保持选中`)
    }
  }

  const snapConveyorEndpoint = (point: GridPoint, endpoint: 'start' | 'end'): ConveyorEndpointSnap<FactoryObject> | null => {
    if (!activeFloor) return null
    const candidates = activeFacilities.filter((object) => object.kind !== 'agv' && object.kind !== 'drone' && object.kind !== 'shelf')
    const facilitySnap = nearestConveyorPort(
      point,
      endpoint,
      candidates,
      Math.max(0.8, factory.gridSizeM * 1.35),
      (object, role, portIndex) => {
        if (!supportsTripleConveyorPorts(object) || portIndex == null) return true
        return !conveyors.some((conveyor) => conveyor.config.kind === 'conveyor' && (
          role === 'output'
            ? conveyor.config.fromObjectId === object.id && (conveyor.config.fromPortIndex ?? 1) === portIndex
            : conveyor.config.toObjectId === object.id && (conveyor.config.toPortIndex ?? 1) === portIndex
        ))
      },
    )
    const conveyorSnaps = conveyors.flatMap((object): ConveyorEndpointSnap<FactoryObject>[] => {
      if (object.config.kind !== 'conveyor') return []
      const isStart = endpoint === 'start'
      const endpointFloorId = conveyorEndpointFloorId(
        { floorId: object.floorId, config: object.config },
        isStart ? 'end' : 'start',
      )
      const occupied = isStart ? object.config.toObjectId : object.config.fromObjectId
      const anchor = isStart ? object.config.path.at(-1) : object.config.path[0]
      if (endpointFloorId !== activeFloor.id || occupied || !anchor) return []
      const distance = Math.hypot(point.x - anchor.x, point.z - anchor.z)
      if (distance > Math.max(0.8, factory.gridSizeM * 1.35)) return []
      return [{ object, role: isStart ? 'output' : 'input', portIndex: null, point: anchor, distance }]
    })
    return [facilitySnap, ...conveyorSnaps]
      .filter((candidate): candidate is ConveyorEndpointSnap<FactoryObject> => Boolean(candidate))
      .sort((left, right) => left.distance - right.distance)[0] ?? null
  }

  const placeConveyor = (
    route: GridPoint[],
    startSnap: ConveyorEndpointSnap<FactoryObject> | null,
    endSnap: ConveyorEndpointSnap<FactoryObject> | null,
  ) => {
    const fromObject = startSnap?.role === 'output' || startSnap?.role === 'generic' ? startSnap.object : null
    const toObject = endSnap && endSnap.object.id !== fromObject?.id && (endSnap.role === 'input' || endSnap.role === 'generic')
      ? endSnap.object
      : null
    const id = addConveyorPath(
      route,
      fromObject?.id ?? null,
      toObject?.id ?? null,
      fromObject && supportsTripleConveyorPorts(fromObject) ? startSnap?.portIndex : null,
      toObject && supportsTripleConveyorPorts(toObject) ? endSnap?.portIndex : null,
      activeFloor?.id,
    )
    if (id) {
      selectObject(null)
      setInspectorOpen(false)
      const fromLabel = fromObject?.kind === 'conveyor' ? '输出端' : fromObject && supportsTripleConveyorPorts(fromObject) && startSnap?.portIndex != null ? `出货口 ${startSnap.portIndex + 1}` : '出货端'
      const toLabel = toObject?.kind === 'conveyor' ? '输入端' : toObject && supportsTripleConveyorPorts(toObject) && endSnap?.portIndex != null ? `${toObject.kind === 'rack' ? '入货口' : '入料口'} ${endSnap.portIndex + 1}` : '入货端'
      const connection = fromObject && toObject ? `${fromObject.name} ${fromLabel} → ${toObject.name} ${toLabel} · 连接成功` : '自由传送带已创建'
      setLastBuildMessage(`${connection} · ${polylineLength(route).toFixed(1)} m · ${Math.max(0, route.length - 2)} 个弯道`)
    }
  }

  const previewIsValid = (entry: BuildEntry, point: GridPoint, rotationY = placementRotation) => {
    if (entry.placementMode !== 'facility') return true
    const footprint = rotatedFootprint(entry.footprint, rotationY)
    const { position } = facilityPlacement(entry, point, factory.gridSizeM, rotationY)
    const minX = position.x
    const minZ = position.z
    const maxX = minX + footprint.width
    const maxZ = minZ + footprint.depth
    if (minX < 0 || minZ < 0 || maxX > factory.widthM || maxZ > factory.lengthM) return false
    return !facilityPlacementBlocked(
      { x: minX, z: minZ, width: footprint.width, depth: footprint.depth },
      activeFloor?.id ?? `floor-${factory.id}`,
      objects,
    )
  }

  const inclineCandidate = (point: GridPoint, rotationY = placementRotation) => {
    if (!activeFloor || !nextFloor) return null
    const direction = rotationY === 90
      ? { x: 0, z: -1 }
      : rotationY === 180
        ? { x: -1, z: 0 }
        : rotationY === 270
          ? { x: 0, z: 1 }
          : { x: 1, z: 0 }
    const riseM = Math.abs(nextFloor.elevationM - activeFloor.elevationM)
    const horizontalRunM = inclineHorizontalRun(riseM)
    const halfRun = horizontalRunM / 2
    const snap = (value: number) => Math.round(value / factory.gridSizeM) * factory.gridSizeM
    let lowPoint = { x: snap(point.x - direction.x * halfRun), z: snap(point.z - direction.z * halfRun) }
    let highPoint = { x: lowPoint.x + direction.x * horizontalRunM, z: lowPoint.z + direction.z * horizontalRunM }
    const lowSnap = snapConveyorEndpoint(lowPoint, inclineDirection === 'up' ? 'start' : 'end')
    if (lowSnap) {
      const dx = lowSnap.point.x - lowPoint.x
      const dz = lowSnap.point.z - lowPoint.z
      lowPoint = lowSnap.point
      highPoint = { x: highPoint.x + dx, z: highPoint.z + dz }
    }
    const path = inclineDirection === 'up' ? [lowPoint, highPoint] : [highPoint, lowPoint]
    const fromObjectId = inclineDirection === 'up' ? lowSnap?.object.id ?? null : null
    const toObjectId = inclineDirection === 'down' ? lowSnap?.object.id ?? null : null
    const inBounds = [lowPoint, highPoint].every((candidate) => candidate.x >= 0 && candidate.z >= 0 && candidate.x <= factory.widthM && candidate.z <= factory.lengthM)
    const blocked = !inBounds
      || conveyorPlacementBlocked(path, activeFloor.id, objects, fromObjectId, toObjectId)
      || conveyorPlacementBlocked(path, nextFloor.id, objects, fromObjectId, toObjectId)
    return {
      lowPoint,
      highPoint,
      path,
      lowSnap,
      riseM,
      valid: !blocked,
      fromY: inclineDirection === 'up' ? 0 : riseM,
      toY: inclineDirection === 'up' ? riseM : 0,
    }
  }

  const placeIncline = (point: GridPoint) => {
    if (!activeFloor || !nextFloor) {
      setLastBuildMessage('请先使用楼层面板新建上一层')
      return
    }
    const candidate = inclineCandidate(point)
    if (!candidate?.valid) return
    const id = addInclineConveyor({
      lowerFloorId: activeFloor.id,
      upperFloorId: nextFloor.id,
      lowPoint: candidate.lowPoint,
      highPoint: candidate.highPoint,
      direction: inclineDirection,
      connectedObjectId: candidate.lowSnap?.object.id ?? null,
      connectedPortIndex: candidate.lowSnap?.portIndex ?? null,
    })
    if (id) {
      selectObject(null)
      setInspectorOpen(false)
      setLastBuildMessage(`已放置跨层传送带 · ${inclineDirection === 'up' ? '向上' : '向下'}运输 · 水平 ${polylineLength(candidate.path).toFixed(1)}m / 高差 ${candidate.riseM.toFixed(1)}m · 切换到 ${nextFloor.name} 可从伸出端继续拉线`)
    }
  }

  const cancelBuildMode = () => {
    setActiveBuildEntryId(null)
    setPlacementPreview(null)
    setLastBuildMessage(null)
    setConveyorSnapLabel(null)
    setIsConveyorDrawing(false)
    conveyorTraceRef.current = []
    conveyorStartSnapRef.current = null
    setPlacementRotation(0)
  }

  const selectDockTab = (tab: DockTab) => {
    if (tab !== 'build' && activeEntry) cancelBuildMode()
    setDockTab(tab)
  }

  const selectBuildEntry = (entry: BuildEntry) => {
    if (activeBuildEntryId === entry.id) {
      cancelBuildMode()
      return
    }
    setActiveBuildEntryId(entry.id)
    setPlacementPreview(null)
    setLastBuildMessage(null)
    setConveyorSnapLabel(null)
    setIsConveyorDrawing(false)
    setPlacementRotation(0)
    conveyorTraceRef.current = []
    conveyorStartSnapRef.current = null
    selectObject(null)
    setInspectorOpen(false)
  }

  const switchFloor = (floorId: string) => {
    if (floorId === activeFloor?.id) return
    cancelBuildMode()
    finishFacilityDrag()
    setActiveFloorId(floorId)
    selectObject(null)
    setInspectorOpen(false)
    setLastBuildMessage(null)
  }

  const createUpperFloor = () => {
    cancelBuildMode()
    const floorId = addFloor(newFloorHeightM)
    setActiveFloorId(floorId)
    selectObject(null)
  }

  const toggleFloorVisibility = (floorId: string) => {
    setFloorEnabledById((current) => ({ ...current, [floorId]: current[floorId] === false }))
  }

  const beginFacilityDrag = (
    id: string,
    pointerId: number,
    clientX: number,
    clientY: number,
    captureTarget: HTMLElement | null,
  ) => {
    if (activeEntry) return
    const object = useForgeStore.getState().objects.find((candidate) => candidate.id === id && candidate.kind !== 'conveyor')
    const pointer = sceneRef.current?.screenToGrid(clientX, clientY) ?? null
    if (!object || !pointer) return
    const center = {
      x: object.transform.x + object.footprint.width / 2,
      z: object.transform.z + object.footprint.depth / 2,
    }
    facilityDragRef.current = {
      id,
      pointerId,
      startClientX: clientX,
      startClientY: clientY,
      grabOffsetX: center.x - pointer.x,
      grabOffsetZ: center.z - pointer.z,
      captureTarget,
      started: false,
      moved: false,
      lastAttemptKey: '',
    }
    try { captureTarget?.setPointerCapture(pointerId) } catch { /* Pointer capture is an enhancement; root handlers still complete the drag. */ }
    selectObject(id)
    setInspectorOpen(true)
    setDraggingObjectId(id)
    setDragStatus(`按住拖动 ${object.name} · 位置吸附到 ${factory.gridSizeM}m 网格`)
  }

  const finishFacilityDrag = (pointerId?: number) => {
    const drag = facilityDragRef.current
    if (!drag || (pointerId != null && drag.pointerId !== pointerId)) return false
    facilityDragRef.current = null
    try {
      if (drag.captureTarget?.hasPointerCapture(drag.pointerId)) drag.captureTarget.releasePointerCapture(drag.pointerId)
    } catch { /* The browser may already have released capture. */ }
    setDraggingObjectId(null)
    setDragStatus(null)
    setPlacementPreview(null)
    document.body.style.cursor = 'default'
    return true
  }

  const moveDraggedFacility = (event: ReactPointerEvent<HTMLElement>) => {
    const drag = facilityDragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return false
    event.preventDefault()
    event.stopPropagation()
    if (!drag.started) {
      const distance = Math.hypot(event.clientX - drag.startClientX, event.clientY - drag.startClientY)
      if (distance < 4) return true
      drag.started = true
      document.body.style.cursor = 'grabbing'
    }
    const pointer = sceneRef.current?.screenToGrid(event.clientX, event.clientY) ?? null
    if (!pointer) return true
    const state = useForgeStore.getState()
    const object = state.objects.find((candidate) => candidate.id === drag.id)
    if (!object || object.kind === 'conveyor') { finishFacilityDrag(event.pointerId); return true }
    const snap = (value: number) => Math.round(value / state.factory.gridSizeM) * state.factory.gridSizeM
    const x = snap(pointer.x + drag.grabOffsetX - object.footprint.width / 2)
    const z = snap(pointer.z + drag.grabOffsetZ - object.footprint.depth / 2)
    const attemptKey = `${x}:${z}`
    if (attemptKey === drag.lastAttemptKey) return true
    drag.lastAttemptKey = attemptKey
    const validBounds = x >= 0 && z >= 0
      && x + object.footprint.width <= state.factory.widthM
      && z + object.footprint.depth <= state.factory.lengthM
    const validFootprint = validBounds && !facilityPlacementBlocked(
      { x, z, width: object.footprint.width, depth: object.footprint.depth },
      object.floorId,
      state.objects,
      object.id,
    )
    const center = { x: x + object.footprint.width / 2, z: z + object.footprint.depth / 2 }
    if (!validFootprint) {
      setPlacementPreview({
        kind: 'facility',
        point: center,
        footprint: object.footprint,
        objectKind: object.kind,
        modelRef: object.modelRef,
        rotationY: object.transform.rotationY,
        valid: false,
      })
      setDragStatus(`${object.name} · 网格 ${center.x}, ${center.z} · 目标位置冲突或越界`)
      return true
    }
    if (x === object.transform.x && z === object.transform.z) {
      setPlacementPreview(null)
      return true
    }
    const moved = moveObject(object.id, { x, z })
    if (moved) {
      drag.moved = true
      setPlacementPreview(null)
      setDragStatus(`${object.name} · 已移动到网格 ${center.x}, ${center.z}`)
    } else {
      setPlacementPreview({
        kind: 'facility',
        point: center,
        footprint: object.footprint,
        objectKind: object.kind,
        modelRef: object.modelRef,
        rotationY: object.transform.rotationY,
        valid: false,
      })
      setDragStatus(`${object.name} · 连接线路发生冲突，不能移动到这里`)
    }
    return true
  }

  const handleEditorPointerMove = (event: ReactPointerEvent<HTMLElement>) => {
    if (moveDraggedFacility(event)) return
    if (!activeEntry || isDockTarget(event.target)) return
    setLastBuildMessage(null)
    const point = sceneRef.current?.screenToGrid(event.clientX, event.clientY) ?? null
    if (!point) { setPlacementPreview(null); return }
    if (activeEntry.placementMode === 'draw-conveyor') {
      if (isConveyorDrawing) {
        conveyorTraceRef.current = appendGridTrace(conveyorTraceRef.current, point, factory.gridSizeM)
        const endSnap = snapConveyorEndpoint(point, 'end')
        const previewTrace = endSnap && endSnap.object.id !== conveyorStartSnapRef.current?.object.id
          ? appendGridTrace(conveyorTraceRef.current, endSnap.point, factory.gridSizeM)
          : conveyorTraceRef.current
        const path = alignPathToPorts(
          pathFromGridTrace(previewTrace),
          conveyorStartSnapRef.current?.point,
          endSnap && endSnap.object.id !== conveyorStartSnapRef.current?.object.id ? endSnap.point : null,
        )
        setConveyorSnapLabel(endSnap
          ? `已吸附 ${endSnap.object.name}${endSnap.role === 'input' && endSnap.portIndex != null ? ` 入料口 ${endSnap.portIndex + 1}` : ''} · 释放即可连接`
          : conveyorStartSnapRef.current
            ? `起点已连接 ${conveyorStartSnapRef.current.object.name}${conveyorStartSnapRef.current.portIndex != null ? ` 出货口 ${conveyorStartSnapRef.current.portIndex + 1}` : ''} · 拖向下一台机器的入料口`
            : null)
        const fromObjectId = conveyorStartSnapRef.current?.object.id ?? null
        const toObjectId = endSnap && endSnap.object.id !== fromObjectId ? endSnap.object.id : null
        const blocked = conveyorPlacementBlocked(path, activeFloor?.id ?? `floor-${factory.id}`, objects, fromObjectId, toObjectId)
        setPlacementPreview({ kind: 'conveyor', path, valid: polylineLength(path) >= factory.gridSizeM && !blocked })
      } else {
        const startSnap = snapConveyorEndpoint(point, 'start')
        setConveyorSnapLabel(startSnap
          ? `已对准 ${startSnap.object.name}${startSnap.role === 'output' && startSnap.portIndex != null ? ` 出货口 ${startSnap.portIndex + 1}` : ''} · 按住并拖动开始铺设`
          : null)
        setPlacementPreview({ kind: 'conveyor', path: [startSnap?.point ?? point], valid: false })
      }
      return
    }
    if (activeEntry.placementMode === 'incline-conveyor') {
      const candidate = inclineCandidate(point)
      setConveyorSnapLabel(candidate?.lowSnap
        ? `斜坡已吸附 ${candidate.lowSnap.object.name} ${inclineDirection === 'up' ? '输出端' : '输入端'} · 水平 ${polylineLength(candidate.path).toFixed(1)}m / 高差 ${candidate.riseM.toFixed(1)}m · 单击放置`
        : candidate && nextFloor ? `跨层至 ${nextFloor.name} · 水平 ${polylineLength(candidate.path).toFixed(1)}m / 高差 ${candidate.riseM.toFixed(1)}m · ${inclineDirection === 'up' ? '向上' : '向下'}运输` : '请先新建上一层')
      setPlacementPreview(candidate ? {
        kind: 'conveyor',
        conveyorType: 'incline',
        path: candidate.path,
        fromY: candidate.fromY,
        toY: candidate.toY,
        valid: candidate.valid,
      } : null)
      return
    }
    setConveyorSnapLabel(null)
    const footprint = rotatedFootprint(activeEntry.footprint, placementRotation)
    const placement = facilityPlacement(activeEntry, point, factory.gridSizeM, placementRotation)
    setPlacementPreview({
      kind: 'facility',
      point: placement.center,
      footprint,
      objectKind: activeEntry.kind,
      modelRef: activeEntry.modelRef,
      rotationY: placementRotation,
      valid: previewIsValid(activeEntry, point, placementRotation),
    })
  }

  const handleEditorPointerDown = (event: ReactPointerEvent<HTMLElement>) => {
    if (!activeEntry || event.button !== 0 || isDockTarget(event.target)) return
    const point = sceneRef.current?.screenToGrid(event.clientX, event.clientY) ?? null
    if (!point) return
    event.preventDefault()
    event.stopPropagation()
    const now = performance.now()
    if (now - lastPlacementClickAtRef.current < 140) return
    lastPlacementClickAtRef.current = now
    if (activeEntry.placementMode === 'draw-conveyor') {
      const startSnap = snapConveyorEndpoint(point, 'start')
      const startPoint = startSnap?.point ?? point
      conveyorStartSnapRef.current = startSnap
      // Keep the construction trace on the grid. The exact fractional port is
      // added back as a terminal bridge for preview, persistence and rendering.
      conveyorTraceRef.current = [point]
      setIsConveyorDrawing(true)
      setConveyorSnapLabel(startSnap
        ? `已从 ${startSnap.object.name}${startSnap.role === 'output' && startSnap.portIndex != null ? ` 出货口 ${startSnap.portIndex + 1}` : ''} 开始 · 拖向入料口`
        : null)
      setPlacementPreview({ kind: 'conveyor', path: [startPoint], valid: false })
      event.currentTarget.setPointerCapture(event.pointerId)
      return
    }
    if (activeEntry.placementMode === 'incline-conveyor') {
      placeIncline(point)
      setPlacementPreview(null)
      return
    }
    if (previewIsValid(activeEntry, point, placementRotation)) placeFacility(activeEntry, point)
    setPlacementPreview(null)
  }

  const handleEditorPointerUp = (event: ReactPointerEvent<HTMLElement>) => {
    if (finishFacilityDrag(event.pointerId)) {
      event.preventDefault()
      event.stopPropagation()
      return
    }
    if (!activeEntry || activeEntry.placementMode !== 'draw-conveyor' || !isConveyorDrawing) return
    event.preventDefault()
    event.stopPropagation()
    const pointerPoint = sceneRef.current?.screenToGrid(event.clientX, event.clientY) ?? conveyorTraceRef.current.at(-1) ?? null
    const endSnap = pointerPoint ? snapConveyorEndpoint(pointerPoint, 'end') : null
    const acceptedEndSnap = endSnap && endSnap.object.id !== conveyorStartSnapRef.current?.object.id ? endSnap : null
    const completedTrace = acceptedEndSnap
      ? appendGridTrace(conveyorTraceRef.current, acceptedEndSnap.point, factory.gridSizeM)
      : conveyorTraceRef.current
    const path = alignPathToPorts(
      pathFromGridTrace(completedTrace),
      conveyorStartSnapRef.current?.point,
      acceptedEndSnap?.point,
    )
    if (polylineLength(path) >= factory.gridSizeM) placeConveyor(path, conveyorStartSnapRef.current, acceptedEndSnap)
    const end = acceptedEndSnap?.point ?? completedTrace.at(-1)
    conveyorTraceRef.current = []
    conveyorStartSnapRef.current = null
    setIsConveyorDrawing(false)
    setConveyorSnapLabel(null)
    setPlacementPreview(end ? { kind: 'conveyor', path: [end], valid: false } : null)
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }

  const suppressBuildClick = (event: ReactMouseEvent<HTMLElement>) => {
    if (!activeEntry || isDockTarget(event.target)) return
    event.preventDefault()
    event.stopPropagation()
  }

  const cancelBuildOnContextMenu = (event: ReactMouseEvent<HTMLElement>) => {
    if (!activeEntry) return
    event.preventDefault()
    event.stopPropagation()
    cancelBuildMode()
  }

  const rotatePlacementWithWheel = (event: ReactWheelEvent<HTMLElement>) => {
    if (!activeEntry || activeEntry.placementMode === 'draw-conveyor' || event.deltaY === 0 || isDockTarget(event.target)) return
    event.preventDefault()
    event.stopPropagation()
    const now = performance.now()
    if (now - lastWheelRotationAtRef.current < 140) return
    lastWheelRotationAtRef.current = now
    const delta = event.deltaY > 0 ? 90 : -90
    const nextRotation = ((placementRotation + delta + 360) % 360) as GridTransform['rotationY']
    setPlacementRotation(nextRotation)
    const point = sceneRef.current?.screenToGrid(event.clientX, event.clientY) ?? null
    if (!point) return
    if (activeEntry.placementMode === 'incline-conveyor') {
      const candidate = inclineCandidate(point, nextRotation)
      setPlacementPreview(candidate ? {
        kind: 'conveyor',
        conveyorType: 'incline',
        path: candidate.path,
        fromY: candidate.fromY,
        toY: candidate.toY,
        valid: candidate.valid,
      } : null)
      return
    }
    const footprint = rotatedFootprint(activeEntry.footprint, nextRotation)
    const placement = facilityPlacement(activeEntry, point, factory.gridSizeM, nextRotation)
    setPlacementPreview({
      kind: 'facility',
      point: placement.center,
      footprint,
      objectKind: activeEntry.kind,
      modelRef: activeEntry.modelRef,
      rotationY: nextRotation,
      valid: previewIsValid(activeEntry, point, nextRotation),
    })
  }

  useEffect(() => {
    if (floors.some((floor) => floor.id === activeFloorId)) return
    setActiveFloorId(floors[0]?.id ?? '')
  }, [activeFloorId, floors])

  useEffect(() => {
    setFloorEnabledById((current) => {
      const next = Object.fromEntries(floors.map((floor) => [floor.id, current[floor.id] ?? true]))
      const currentKeys = Object.keys(current)
      const nextKeys = Object.keys(next)
      const unchanged = currentKeys.length === nextKeys.length
        && nextKeys.every((floorId) => current[floorId] === next[floorId])
      return unchanged ? current : next
    })
  }, [floors])

  useEffect(() => {
    const cancelOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      cancelBuildMode()
    }
    window.addEventListener('keydown', cancelOnEscape)
    return () => window.removeEventListener('keydown', cancelOnEscape)
  }, [])

  useEffect(() => {
    const rotateSelectedMachine = (event: KeyboardEvent) => {
      if (event.repeat || event.isComposing || event.ctrlKey || event.metaKey || event.altKey || isEditableTarget(event.target)) return
      const key = event.key.toLowerCase()
      const isLeft = event.code === 'KeyQ' || key === 'q'
      const isRight = event.code === 'KeyE' || key === 'e'
      if (!isLeft && !isRight) return
      const state = useForgeStore.getState()
      const target = state.objects.find((object) => object.id === state.selectedObjectId)
      if (target?.kind !== 'machine') return
      event.preventDefault()
      event.stopPropagation()
      state.rotateObject(target.id, isLeft ? 'counterclockwise' : 'clockwise')
    }
    document.addEventListener('keydown', rotateSelectedMachine, true)
    return () => document.removeEventListener('keydown', rotateSelectedMachine, true)
  }, [])

  return (
    <div className="editor-page editor-page--floating">
      <main
        className={`editor-canvas editor-canvas--full ${activeEntry ? 'is-build-mode' : ''} ${isConveyorDrawing ? 'is-drawing-conveyor' : ''} ${draggingObjectId ? 'is-dragging-facility' : ''}`.trim()}
        data-build-mode={activeBuildEntryId ?? undefined}
        aria-keyshortcuts="Q E"
        onPointerMove={handleEditorPointerMove}
        onPointerDownCapture={handleEditorPointerDown}
        onPointerUpCapture={handleEditorPointerUp}
        onPointerCancelCapture={(event) => { finishFacilityDrag(event.pointerId) }}
        onLostPointerCapture={(event) => { finishFacilityDrag(event.pointerId) }}
        onClickCapture={suppressBuildClick}
        onContextMenuCapture={cancelBuildOnContextMenu}
        onWheelCapture={rotatePlacementWithWheel}
      >
        <FactoryScene
          ref={sceneRef}
          objects={objects}
          items={items}
          inventory={inventory}
          simulation={simulation}
          floors={floors}
          activeFloorId={activeFloor?.id ?? ''}
          floorVisibilityMode={floorVisibilityMode}
          enabledFloorIds={enabledFloorIds}
          factoryWidth={factory.widthM}
          factoryLength={factory.lengthM}
          gridSize={factory.gridSizeM}
          placementPreview={placementPreview}
          interactionLocked={Boolean(activeEntry) || Boolean(draggingObjectId)}
          showGrid={showGrid}
          showLabels={showLabels}
          shadowsEnabled={shadowsEnabled}
          selectedId={selectedObjectId}
          onSelect={(id) => { selectObject(id); if (id) setInspectorOpen(true) }}
          onDragStart={beginFacilityDrag}
          simulationRunning={running}
          simTime={simulation.elapsedSimSec}
        />

        <aside className="floor-stack-panel" aria-label="楼层选择与新建">
          <header><Layers /><span><strong>楼层</strong></span></header>
          <div className="floor-stack-panel__list">
            {[...floors].sort((left, right) => right.level - left.level).map((floor) => {
              const floorObjectCount = objects.filter((object) => object.config.kind === 'conveyor'
                ? conveyorEndpointFloorId({ floorId: object.floorId, config: object.config }, 'start') === floor.id
                  || conveyorEndpointFloorId({ floorId: object.floorId, config: object.config }, 'end') === floor.id
                : object.floorId === floor.id).length
              const enabled = floorEnabledById[floor.id] !== false
              return (
                <div className={`floor-stack-panel__row ${floor.id === activeFloor?.id ? 'is-active' : ''} ${enabled ? '' : 'is-disabled'}`.trim()} key={floor.id}>
                  <button className="floor-stack-panel__select" aria-pressed={floor.id === activeFloor?.id} onClick={() => switchFloor(floor.id)}>
                    <span>{floor.level}F</span><strong>{floor.name.replace(/^\d+F\s*/, '')}</strong><small>标高 {floor.elevationM.toFixed(1)}m · {floorObjectCount} 对象</small>
                  </button>
                  <button
                    className={`floor-stack-panel__toggle ${enabled ? 'is-on' : ''}`}
                    type="button"
                    role="switch"
                    aria-checked={enabled}
                    aria-label={`${enabled ? '关闭' : '开启'} ${floor.level}F 楼层显示`}
                    title={`${enabled ? '关闭' : '开启'} ${floor.name} 对象显示`}
                    onClick={() => toggleFloorVisibility(floor.id)}
                  ><i /></button>
                </div>
              )
            })}
          </div>
          <section className="floor-stack-panel__visibility" aria-label="楼层显示设置">
            <header><strong>显示设置</strong></header>
            <div role="radiogroup" aria-label="多楼层对象显示方式">
              {floorVisibilityOptions.map((option) => (
                <button
                  key={option.value}
                  role="radio"
                  aria-checked={floorVisibilityMode === option.value}
                  aria-label={`${option.label}：${option.hint}`}
                  className={floorVisibilityMode === option.value ? 'is-active' : ''}
                  onClick={() => setFloorVisibilityMode(option.value)}
                >
                  <strong>{option.label}</strong>
                </button>
              ))}
            </div>
          </section>
          <label><span>新层高</span><input aria-label="新楼层层高" type="number" min="2.5" max="12" step="0.5" value={newFloorHeightM} onChange={(event) => setNewFloorHeightM(Math.min(12, Math.max(2.5, Number(event.target.value) || 4.5)))} /><em>m</em></label>
          <button className="floor-stack-panel__add" onClick={createUpperFloor}><Plus />新建上层</button>
        </aside>

        <section className="editor-scene-summary" aria-label="场景摘要">
          <span><strong>{activeFloor?.level ?? 1}F</strong> 当前楼层</span>
          <span><strong>{factory.widthM}×{factory.lengthM}</strong> 地块</span>
          <span><strong>{activeFacilities.length}</strong> 设施</span>
          <span><strong>{activeConveyors.length}</strong> 传送带</span>
          <span><strong>{simulation.transitItems.length}</strong> 运输中</span>
        </section>

        {placementStatus ? <output className="editor-build-status" aria-live="polite">{placementStatus}</output> : null}

        {selected && inspectorOpen ? (
          <aside className="editor-float editor-float--inspector is-open" aria-label="对象属性">
            <div className="editor-float__body">
              <header><div><span className="eyebrow">INSPECT</span><h2>{selected.name}</h2></div><button className="icon-button" onClick={() => setInspectorOpen(false)} aria-label="收起属性"><X /></button></header>
              <ObjectInspector
                object={selected}
                objects={objects}
                floors={floors}
                items={items}
                inventory={inventory}
                recipes={recipes}
                simulation={simulation}
                onRotateLeft={() => rotateObject(selected.id, 'counterclockwise')}
                onRotateRight={() => rotateObject(selected.id, 'clockwise')}
                onReverseIncline={() => reverseInclineDirection(selected.id)}
                onDelete={() => { deleteObject(selected.id); setInspectorOpen(false) }}
                onRecipe={(recipeId) => updateObjectConfig(selected.id, { recipeId } as never)}
                onConveyorOutput={(conveyorId, itemId) => updateObjectConfig(conveyorId, { kind: 'conveyor', outputItemId: itemId } as Partial<ConveyorObjectConfig>)}
                onWarehouseDispatchInterval={(portIndex, seconds) => {
                  if (selected.config.kind !== 'rack') return
                  const legacyInterval = selected.config.dispatchIntervalSec ?? 2.5
                  const dispatchIntervalSecByPort = [
                    ...(selected.config.dispatchIntervalSecByPort ?? [legacyInterval, legacyInterval, legacyInterval]),
                  ] as WarehouseDispatchIntervalsSec
                  dispatchIntervalSecByPort[portIndex] = seconds
                  updateObjectConfig(selected.id, { kind: 'rack', dispatchIntervalSecByPort } as Partial<RackObjectConfig>)
                }}
                onAgvConfig={(patch) => updateObjectConfig(selected.id, { kind: 'vehicle', ...patch } as Partial<VehicleObjectConfig>)}
                onAdjustInventory={adjustInventory}
                onSetInfiniteSupply={setInventoryInfiniteSupply}
                onRename={(name) => renameObject(selected.id, name)}
                onDesignRecipes={() => onNavigate('recipes')}
                onManageItems={() => onNavigate('items')}
              />
            </div>
          </aside>
        ) : selected ? (
          <button className="editor-inspector-peek" onClick={() => setInspectorOpen(true)}>{selected.name}<ChevronRight /></button>
        ) : null}

        <section className={`construction-dock construction-dock--${dockTab}`} aria-label="工厂操作栏">
          <header className="construction-dock__header">
            <div className="construction-dock__tabs" role="tablist" aria-label="工厂操作分类">
              <button id="dock-tab-build" role="tab" aria-selected={dockTab === 'build'} aria-controls="dock-panel-build" className={dockTab === 'build' ? 'is-active' : ''} onClick={() => selectDockTab('build')}><Construction />建造</button>
              <button id="dock-tab-run" role="tab" aria-selected={dockTab === 'run'} aria-controls="dock-panel-run" className={dockTab === 'run' ? 'is-active' : ''} onClick={() => selectDockTab('run')}><Gauge />运行</button>
              <button id="dock-tab-view" role="tab" aria-selected={dockTab === 'view'} aria-controls="dock-panel-view" className={dockTab === 'view' ? 'is-active' : ''} onClick={() => selectDockTab('view')}><Eye />视图</button>
            </div>
            <div className="construction-dock__state" aria-live="polite">
              <span className={running ? 'is-running' : ''}><i />{running ? `${simulation.speed}× 运行中` : simulation.status === 'paused' ? '仿真已暂停' : '等待运行'}</span>
              <span className={saveStatus === 'dirty' ? 'has-attention' : ''}>{saveStatus === 'dirty' ? '有未保存更改' : saveStatus === 'error' ? '保存失败' : '已同步'}</span>
            </div>
          </header>

          {dockTab === 'build' ? (
            <div id="dock-panel-build" role="tabpanel" aria-labelledby="dock-tab-build" className="construction-dock__panel construction-dock__panel--build">
              <div className="construction-dock__intro"><div><span className="eyebrow">BUILD LIBRARY</span><strong>设备与线路</strong></div><small>{buildHint}</small></div>
              {activeEntry?.placementMode === 'incline-conveyor' ? (
                <div className="incline-direction-control" role="group" aria-label="跨层传送带运输方向">
                  <span>运输方向</span>
                  <button className={inclineDirection === 'up' ? 'is-active' : ''} aria-pressed={inclineDirection === 'up'} onClick={() => { setInclineDirection('up'); setPlacementPreview(null) }}><ArrowUp />向上</button>
                  <button className={inclineDirection === 'down' ? 'is-active' : ''} aria-pressed={inclineDirection === 'down'} onClick={() => { setInclineDirection('down'); setPlacementPreview(null) }}><ArrowDown />向下</button>
                </div>
              ) : null}
              <div className="construction-dock__rail">
                {buildEntries.map((entry) => {
                  const Icon = entry.icon
                  return (
                    <button
                      key={entry.id}
                      className={activeBuildEntryId === entry.id ? 'is-active' : ''}
                      onClick={() => selectBuildEntry(entry)}
                      aria-pressed={activeBuildEntryId === entry.id}
                      aria-label={`${entry.name}：${entry.subtitle}。单击${activeBuildEntryId === entry.id ? '取消' : '选择'}建造`}
                    >
                      <span><Icon /></span><strong>{entry.name}</strong><small>{entry.subtitle}</small>
                    </button>
                  )
                })}
              </div>
            </div>
          ) : null}

          {dockTab === 'run' ? (
            <div id="dock-panel-run" role="tabpanel" aria-labelledby="dock-tab-run" className="construction-dock__panel construction-dock__panel--run">
              <button className={`dock-run-primary ${running ? 'is-running' : ''}`} onClick={running ? pauseSimulation : playSimulation}>
                <span>{running ? <Pause /> : <Play />}</span><strong>{running ? '暂停生产仿真' : '启动生产仿真'}</strong><small>{running ? `当前以 ${simulation.speed}× 连续运行` : '按当前产线配置开始运行'}</small>
              </button>
              <section className="dock-speed-control" aria-label="仿真运行速度">
                <div><Gauge /><span><strong>运行速度</strong><small>逻辑结算与画面运输同步</small></span></div>
                <div className="dock-speed-control__options">
                  {simulationSpeeds.map((speed) => <button key={speed} className={simulation.speed === speed ? 'is-active' : ''} aria-pressed={simulation.speed === speed} onClick={() => setSimulationSpeed(speed)}>{speed}×</button>)}
                </div>
              </section>
              <div className="dock-run-metrics" aria-label="运行摘要">
                <span><Clock3 /><small>仿真时间</small><strong>{formatDockDuration(simulation.elapsedSimSec)}</strong></span>
                <span><Activity /><small>逻辑步数</small><strong>{simulation.tickCount.toLocaleString('zh-CN')}</strong></span>
                <span><Boxes /><small>运输中</small><strong>{simulation.transitItems.length + Object.values(simulation.agvRuntime ?? {}).reduce((sum, runtime) => sum + runtime.cargoQuantity, 0) + Object.values(simulation.droneRuntime ?? {}).reduce((sum, runtime) => sum + runtime.cargoQuantity, 0)} 件</strong></span>
              </div>
              <button className="dock-reset-action" onClick={resetSimulation}><RotateCcw />重置运行状态</button>
            </div>
          ) : null}

          {dockTab === 'view' ? (
            <div id="dock-panel-view" role="tabpanel" aria-labelledby="dock-tab-view" className="construction-dock__panel construction-dock__panel--view">
              <div className="construction-dock__intro"><div><span className="eyebrow">SCENE DISPLAY</span><strong>现场显示</strong></div><small>只改变当前画面，不修改工厂数据</small></div>
              <div className="dock-view-options">
                <button className={showGrid ? 'is-active' : ''} aria-pressed={showGrid} onClick={() => setShowGrid((value) => !value)}><span><Grid3X3 /></span><strong>地块网格</strong><small>{showGrid ? '已显示建造网格' : '网格已隐藏'}</small></button>
                <button className={showLabels ? 'is-active' : ''} aria-pressed={showLabels} onClick={() => setShowLabels((value) => !value)}><span><Eye /></span><strong>场景标签</strong><small>{showLabels ? '选中对象显示详细标签' : '标签已隐藏'}</small></button>
                <button className={shadowsEnabled ? 'is-active' : ''} aria-pressed={shadowsEnabled} onClick={() => setShadowsEnabled((value) => !value)}><span><SunMedium /></span><strong>高质量阴影</strong><small>{shadowsEnabled ? running ? '运行时自动关闭投影' : '接触阴影与投影开启' : '性能优先模式'}</small></button>
                <button disabled={!selected} className={selected && inspectorOpen ? 'is-active' : ''} aria-pressed={Boolean(selected && inspectorOpen)} onClick={() => setInspectorOpen((value) => !value)}><span><PanelRight /></span><strong>属性面板</strong><small>{selected ? inspectorOpen ? `正在查看 ${selected.name}` : '点击重新展开' : '先在场景中选择对象'}</small></button>
              </div>
            </div>
          ) : null}
        </section>
      </main>
    </div>
  )
}

function ObjectInspector({
  object, objects, floors, items, inventory, recipes, simulation, onRotateLeft, onRotateRight, onReverseIncline, onDelete, onRecipe, onConveyorOutput, onWarehouseDispatchInterval, onAgvConfig, onAdjustInventory, onSetInfiniteSupply, onRename, onDesignRecipes, onManageItems,
}: {
  object: FactoryObject
  objects: FactoryObject[]
  floors: ReturnType<typeof useForgeStore.getState>['floors']
  items: Item[]
  inventory: InventoryRecord[]
  recipes: ReturnType<typeof useForgeStore.getState>['recipes']
  simulation: ReturnType<typeof useForgeStore.getState>['simulation']
  onRotateLeft: () => void
  onRotateRight: () => void
  onReverseIncline: () => void
  onDelete: () => void
  onRecipe: (id: string | null) => void
  onConveyorOutput: (conveyorId: string, itemId: string | null) => void
  onWarehouseDispatchInterval: (portIndex: MachinePortIndex, seconds: number) => void
  onAgvConfig: (patch: Partial<VehicleObjectConfig>) => void
  onAdjustInventory: (recordId: string, delta: number) => boolean
  onSetInfiniteSupply: (recordId: string, enabled: boolean) => boolean
  onRename: (name: string) => boolean
  onDesignRecipes: () => void
  onManageItems: () => void
}) {
  if (object.config.kind === 'conveyor') {
    const config = object.config
    const fromObject = objects.find((candidate) => candidate.id === config.fromObjectId)
    const toObject = objects.find((candidate) => candidate.id === config.toObjectId)
    const isIncline = config.conveyorType === 'incline'
    const horizontalRunM = polylineLength(config.path)
    const gradePercent = horizontalRunM > 0 ? Math.abs(config.riseM ?? 0) / horizontalRunM * 100 : 0
    const fromFloor = floors.find((floor) => floor.id === (config.fromFloorId ?? object.floorId))
    const toFloor = floors.find((floor) => floor.id === (config.toFloorId ?? object.floorId))
    const direction = isIncline && (fromFloor?.level ?? 0) < (toFloor?.level ?? 0) ? '向上运输' : isIncline ? '向下运输' : '同层运输'
    const from = `${fromObject?.name ?? '自由起点'}${fromObject && supportsTripleConveyorPorts(fromObject) ? ` · 出货口 ${(config.fromPortIndex ?? 1) + 1}` : ''}`
    const to = config.toObjectId === 'finished-goods' ? '成品区' : `${toObject?.name ?? '自由终点'}${toObject && supportsTripleConveyorPorts(toObject) ? ` · ${toObject.kind === 'rack' ? '入货口' : '入料口'} ${(config.toPortIndex ?? 1) + 1}` : ''}`
    return (
      <>
        <div className="connection-route"><span>{from}</span><i><Boxes /></i><span>{to}</span></div>
        <dl className="compact-details"><div><dt>路径长度</dt><dd>{Math.hypot(horizontalRunM, config.riseM ?? 0).toFixed(1)} m</dd></div><div><dt>{isIncline ? '跨层方向' : '自动弯道'}</dt><dd>{isIncline ? direction : Math.max(0, config.path.length - 2)}</dd></div><div><dt>容量</dt><dd>{config.capacity} 件</dd></div></dl>
        {isIncline ? <p className="editor-float__note">{fromFloor?.name} → {toFloor?.name} · 垂直高度 {(config.riseM ?? 0).toFixed(1)}m · 水平投影 {horizontalRunM.toFixed(1)}m · 坡度 {gradePercent.toFixed(0)}%；两层端头都可继续吸附拉线</p> : <p className="editor-float__note">直线段、弯道和两端均可参与线路吸附；物料按整条折线路径运行</p>}
        {isIncline ? <button className="floating-design-link" onClick={onReverseIncline}>{direction === '向上运输' ? <ArrowDown /> : <ArrowUp />}切换为{direction === '向上运输' ? '向下' : '向上'}运输</button> : null}
        <button className="floating-danger" onClick={onDelete}><Trash2 />删除整条传送带</button>
      </>
    )
  }

  const machineConfig = object.config.kind === 'machine' ? object.config : null
  const machineRecipe = machineConfig?.recipeId ? recipes.find((recipe) => recipe.id === machineConfig.recipeId) : undefined
  const warehouseConfig = object.config.kind === 'rack' || object.config.kind === 'shelf' ? object.config : null
  const isShelf = object.kind === 'shelf'
  const vehicleConfig = (object.kind === 'agv' || object.kind === 'drone') && object.config.kind === 'vehicle' ? object.config : null
  return (
    <>
      <div className="inspector-asset-state"><span className="asset-state-dot" /><div><strong>{object.modelRef ? '真实模型已接入' : '必要程序化对象'}</strong><small>{vehicleConfig ? `${object.kind === 'drone' ? '三维跨层' : '地面'}运输仿真可用 · vendor 外观仍待 derived 派生` : '网格占地与视觉模型已关联'}</small></div></div>
      <dl className="compact-details"><div><dt>网格位置</dt><dd>{object.transform.x}, {object.transform.z}</dd></div><div><dt>占地</dt><dd>{object.footprint.width} × {object.footprint.depth}</dd></div><div><dt>朝向</dt><dd>{object.transform.rotationY}°</dd></div><div><dt>状态</dt><dd>{statusLabel(object.status)}</dd></div></dl>
      {machineConfig ? <>
        <label className="floating-field">机器名称<input key={object.id} defaultValue={object.name} onBlur={(event) => { if (!onRename(event.target.value)) event.target.value = object.name }} onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur() }} /></label>
        <label className="floating-field">绑定配方<select value={machineConfig.recipeId ?? ''} onChange={(event) => onRecipe(event.target.value || null)}><option value="">不绑定</option>{recipes.map((recipe) => <option value={recipe.id} key={recipe.id}>{recipe.name}</option>)}</select></label>
        <MachinePortRouting
          machine={object}
          objects={objects}
          items={items}
          recipe={machineRecipe}
          onConveyorOutput={onConveyorOutput}
        />
        <p className="editor-float__note">机器不预设工艺。请先到“配方工艺”设计配方，再在这里绑定</p>
        <button className="floating-design-link" onClick={onDesignRecipes}>前往配方工艺 <ChevronRight /></button>
      </> : null}
      {warehouseConfig ? <>
        <label className="floating-field">{isShelf ? '货架名称' : '仓库名称'}<input key={object.id} defaultValue={object.name} onBlur={(event) => { if (!onRename(event.target.value)) event.target.value = object.name }} onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur() }} /></label>
        <WarehousePortRouting
          warehouse={object}
          objects={objects}
          items={items}
          inventory={inventory}
          onConveyorOutput={onConveyorOutput}
          onDispatchInterval={onWarehouseDispatchInterval}
          onAdjustInventory={onAdjustInventory}
          onSetInfiniteSupply={onSetInfiniteSupply}
          onManageItems={onManageItems}
        />
        <p className="editor-float__note">{isShelf ? '架上满载货物是货架用途的视觉表达；货架不连接传送带，实际有限数量可无限堆叠，也可由 AGV 或无人机取货、存货，并可逐物品设为无限' : '仓内纸箱用于货物容器表现；上方清单是实际库存。无限供应只作用于本仓库出货，不占用或伪造有限库存数量'}</p>
      </> : null}
      {vehicleConfig ? (
        <VehicleProgramPanel
          vehicle={object}
          config={vehicleConfig}
          objects={objects}
          floors={floors}
          items={items}
          inventory={inventory}
          simulation={simulation}
          onRename={onRename}
          onChange={onAgvConfig}
          onManageItems={onManageItems}
        />
      ) : null}
      <details className="asset-reference"><summary>资产追溯</summary><code>{object.modelRef ?? 'procedural:business-zone'}</code></details>
      <div className="floating-inspector-actions floating-inspector-actions--rotation">
        <button onClick={onRotateLeft}><RotateCw style={{ transform: 'scaleX(-1)' }} />Q 左旋</button>
        <button onClick={onRotateRight}><RotateCw />E 右旋</button>
        <button className="floating-danger" onClick={onDelete}><Trash2 />删除</button>
      </div>
    </>
  )
}

const fallbackAgvProgram = (loadQuantity = 10): AgvProgram => ({
  enabled: false,
  sourceObjectId: null,
  destinationObjectId: null,
  itemId: null,
  loadQuantity,
  triggerLocation: 'always',
  triggerComparator: 'at-least',
  triggerQuantity: 1,
})

function VehicleProgramPanel({
  vehicle,
  config,
  objects,
  floors,
  items,
  inventory,
  simulation,
  onRename,
  onChange,
  onManageItems,
}: {
  vehicle: FactoryObject
  config: VehicleObjectConfig
  objects: FactoryObject[]
  floors: Floor[]
  items: Item[]
  inventory: InventoryRecord[]
  simulation: ReturnType<typeof useForgeStore.getState>['simulation']
  onRename: (name: string) => boolean
  onChange: (patch: Partial<VehicleObjectConfig>) => void
  onManageItems: () => void
}) {
  const isDrone = vehicle.kind === 'drone'
  const program = {
    ...fallbackAgvProgram(isDrone ? 3 : 10),
    ...(isDrone ? config.transportProgram : config.agvProgram),
  }
  const storageOptions = objects.filter((object) => (object.kind === 'rack' || object.kind === 'shelf') && (isDrone || object.floorId === vehicle.floorId))
  const runtime = isDrone ? simulation.droneRuntime?.[vehicle.id] : simulation.agvRuntime?.[vehicle.id]
  const floorById = new Map(floors.map((floor) => [floor.id, floor]))
  const source = storageOptions.find((object) => object.id === program.sourceObjectId)
  const destination = storageOptions.find((object) => object.id === program.destinationObjectId)
  const item = items.find((candidate) => candidate.id === program.itemId)
  const inventoryQuantity = (storageId: string | null) => {
    if (!storageId || !program.itemId) return 0
    return inventory.find((record) => record.locationType === 'rack-slot'
      && record.locationId.startsWith(`${storageId}:`)
      && record.itemId === program.itemId)?.quantity ?? 0
  }
  const sourceQuantity = inventoryQuantity(program.sourceObjectId)
  const destinationQuantity = inventoryQuantity(program.destinationObjectId)
  const patchProgram = (patch: Partial<AgvProgram>) => onChange(isDrone
    ? { transportProgram: { ...program, ...patch } }
    : { agvProgram: { ...program, ...patch } })
  const routeDistance = runtime?.path.slice(Math.max(1, runtime.waypointIndex)).reduce((sum, point, index) => {
    const previous = index === 0 ? runtime.position : runtime.path[Math.max(1, runtime.waypointIndex) + index - 1]
    const pointY = 'y' in point ? Number(point.y) : 0
    const previousY = 'y' in previous ? Number(previous.y) : 0
    return sum + Math.hypot(point.x - previous.x, pointY - previousY, point.z - previous.z)
  }, 0) ?? 0
  const phaseLabel = !runtime
    ? '等待运行'
    : runtime.motionStatus === 'yielding'
      ? '协调让行'
      : runtime.motionStatus === 'blocked'
        ? '路径受阻'
        : runtime.phase === 'to-source'
          ? '前往起点'
          : runtime.phase === 'to-destination'
            ? '运往终点'
            : runtime.phase === 'clearing-dock'
              ? '退出装卸位'
            : runtime.phase === 'waiting-trigger'
              ? '等待触发'
              : '等待配置'
  const isConfigured = Boolean(program.sourceObjectId && program.destinationObjectId && program.itemId && program.sourceObjectId !== program.destinationObjectId)
  const sourceActionLabel = source?.kind === 'shelf' ? '货架取货' : isDrone ? '仓库出货口取货' : '仓库取货'
  const destinationActionLabel = destination?.kind === 'shelf' ? '货架存货' : isDrone ? '仓库入货口存货' : '仓库存货'

  return (
    <section className="agv-program-panel" aria-label={`${vehicle.name} 可视化运输程序`} data-testid={isDrone ? 'drone-program-panel' : 'agv-program-panel'}>
      <header className="agv-program-panel__header">
        <div><span className="eyebrow">{isDrone ? 'VISUAL DRONE PROGRAM' : 'VISUAL AGV PROGRAM'}</span><strong>自动运输程序</strong></div>
        <label className="agv-program-switch">
          <input
            type="checkbox"
            checked={program.enabled}
            aria-label={`${vehicle.name} 启用自动运输`}
            onChange={(event) => patchProgram({ enabled: event.target.checked })}
          />
          <span>{program.enabled ? '已启用' : '已停用'}</span>
        </label>
      </header>

      <label className="floating-field">车辆名称<input key={vehicle.id} defaultValue={vehicle.name} onBlur={(event) => { if (!onRename(event.target.value)) event.target.value = vehicle.name }} onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur() }} /></label>

      <div className="agv-program-flow">
        <div className={`agv-program-node ${source ? 'is-complete' : ''}`}>
          <span>01 / 起点</span><strong>{source?.name ?? '选择装货站'}</strong>
          <select
            aria-label={`${vehicle.name} 运输起点`}
            value={program.sourceObjectId ?? ''}
            onChange={(event) => patchProgram({
              sourceObjectId: event.target.value || null,
              destinationObjectId: event.target.value === program.destinationObjectId ? null : program.destinationObjectId,
            })}
          >
            <option value="">请选择仓库或货架</option>
            {storageOptions.map((storage) => <option value={storage.id} key={storage.id}>{isDrone ? `${floorById.get(storage.floorId)?.name ?? '?F'} · ` : ''}{storage.kind === 'shelf' ? '货架' : '仓库'} · {storage.name}</option>)}
          </select>
          <small>{item ? `${sourceActionLabel} · ${item.name}：${sourceQuantity} 件` : isDrone ? '支持任意楼层装卸点' : '仅限 1F 同层装卸点'}</small>
        </div>
        <i className="agv-program-flow__arrow">→</i>
        <div className={`agv-program-node ${item ? 'is-complete' : ''}`}>
          <span>02 / 货物</span><strong>{item?.name ?? '选择货物'}</strong>
          <select aria-label={`${vehicle.name} 运送货物`} value={program.itemId ?? ''} onChange={(event) => patchProgram({ itemId: event.target.value || null })}>
            <option value="">请选择物品</option>
            {items.map((candidate) => <option value={candidate.id} key={candidate.id}>{candidate.name}</option>)}
          </select>
          <label className="agv-program-inline-input">每趟<input aria-label={`${vehicle.name} 每趟运输件数`} type="number" min={1} max={isDrone ? 100 : 1000} step={1} value={program.loadQuantity} onChange={(event) => patchProgram({ loadQuantity: Number(event.target.value) })} />件</label>
        </div>
        <i className="agv-program-flow__arrow">→</i>
        <div className={`agv-program-node ${destination ? 'is-complete' : ''}`}>
          <span>03 / 终点</span><strong>{destination?.name ?? '选择卸货站'}</strong>
          <select aria-label={`${vehicle.name} 运输终点`} value={program.destinationObjectId ?? ''} onChange={(event) => patchProgram({ destinationObjectId: event.target.value || null })}>
            <option value="">请选择仓库或货架</option>
            {storageOptions.filter((storage) => storage.id !== program.sourceObjectId).map((storage) => <option value={storage.id} key={storage.id}>{isDrone ? `${floorById.get(storage.floorId)?.name ?? '?F'} · ` : ''}{storage.kind === 'shelf' ? '货架' : '仓库'} · {storage.name}</option>)}
          </select>
          <small>{item ? `${destinationActionLabel} · ${item.name}：${destinationQuantity} 件` : isDrone ? '支持任意楼层装卸点' : '仅限 1F 同层装卸点'}</small>
        </div>
      </div>

      <div className="agv-trigger-program">
        <div><span>启动条件</span><strong>{program.triggerLocation === 'always' ? '持续运输' : `${program.triggerLocation === 'source' ? '起点' : '终点'}库存触发`}</strong></div>
        <select aria-label={`${vehicle.name} 启动条件位置`} value={program.triggerLocation} onChange={(event) => patchProgram({ triggerLocation: event.target.value as AgvProgram['triggerLocation'] })}>
          <option value="always">一直运输</option>
          <option value="source">监测起点货物量</option>
          <option value="destination">监测终点货物量</option>
        </select>
        {program.triggerLocation !== 'always' ? <>
          <select aria-label={`${vehicle.name} 启动条件比较`} value={program.triggerComparator} onChange={(event) => patchProgram({ triggerComparator: event.target.value as AgvProgram['triggerComparator'] })}>
            <option value="at-least">达到或超过</option>
            <option value="at-most">达到或低于</option>
          </select>
          <label className="agv-program-inline-input"><input aria-label={`${vehicle.name} 启动阈值`} type="number" min={0} step={1} value={program.triggerQuantity} onChange={(event) => patchProgram({ triggerQuantity: Number(event.target.value) })} />件时启动</label>
        </> : <small>每趟完成后，只要起点仍有货且终点有容量就继续运输</small>}
      </div>

      <div className={`agv-runtime-strip agv-runtime-strip--${runtime?.motionStatus ?? 'idle'}`} aria-live="polite">
        <span><i />{phaseLabel}</span>
        <strong>{runtime?.cargoQuantity ? `载货 ${runtime.cargoQuantity} 件` : isConfigured ? `剩余路线 ${routeDistance.toFixed(1)}m` : '程序未完整'}</strong>
        <small>{runtime?.blockedReason ?? `${isDrone ? '26 邻域三维 A* · 净空列安全下降' : '仅 1F · 八方向 A* 斜向最短路'} · ${Math.max(isDrone ? 0.5 : 0.25, config.speedMps ?? (isDrone ? 4 : 2)).toFixed(2)}m/s · 已完成 ${runtime?.completedTrips ?? 0} 趟`}</small>
      </div>

      <div className="agv-vehicle-parameters">
        <label>{isDrone ? '飞行速度' : '速度'}<input aria-label={`${vehicle.name} ${isDrone ? '飞行' : '行驶'}速度`} type="number" min={isDrone ? 0.5 : 0.25} max={isDrone ? 12 : 6} step={0.25} value={config.speedMps ?? (isDrone ? 4 : 2)} onChange={(event) => onChange({ speedMps: Number(event.target.value) })} /><span>m/s</span></label>
        <label>载重<input aria-label={`${vehicle.name} 最大载重`} type="number" min={1} max={isDrone ? 1000 : 100000} step={isDrone ? 5 : 10} value={config.maxPayloadKg ?? (isDrone ? 30 : 500)} onChange={(event) => onChange({ maxPayloadKg: Number(event.target.value) })} /><span>kg</span></label>
      </div>

      {storageOptions.length < 2 ? <p className="editor-float__note">{isDrone ? '工厂内' : '1F'}至少需要两个仓库或货架，才能设置起点和终点</p> : null}
      {items.length === 0 ? <button className="floating-design-link" onClick={onManageItems}>先定义可运输物品 <ChevronRight /></button> : null}
      <p className="editor-float__note">货架可直接作为取货或存货点：装货时扣减货架库存，卸货时写回货架库存；货架仍不连接传送带</p>
      <p className="editor-float__note">{isDrone
        ? '货物仓库取货使用出货口外侧悬停点，存货使用入货口外侧悬停点，并从三个对应端口中选择可达最短航点。黄色三维虚线与箭头从无人机流向目标点；路线允许直线、面对角和体对角移动。跨层下降前会先飞到无建筑遮挡的净空列；传送带与 AGV 不构成空中障碍，建筑和其他无人机会触发三维绕行与固定优先级协调'
        : '黄色虚线与箭头从小车向目标点流动，表示 1F 内允许安全斜线的八方向最短路线；遇到停驻车辆会先动态绕行，红色表示确实没有安全通路，蓝色表示固定通行权协调器正在引导低优先级车辆让行'}</p>
    </section>
  )
}

function MachinePortRouting({
  machine,
  objects,
  items,
  recipe,
  onConveyorOutput,
}: {
  machine: FactoryObject
  objects: FactoryObject[]
  items: Item[]
  recipe?: Recipe
  onConveyorOutput: (conveyorId: string, itemId: string | null) => void
}) {
  const itemName = (itemId: string) => items.find((item) => item.id === itemId)?.name ?? itemId
  return (
    <section className="machine-port-routing" aria-label="机器端口连接与产物分配">
      <header><span className="eyebrow">PORT ROUTING</span><strong>三进三出端口</strong></header>
      <div className="machine-port-routing__group">
        {MACHINE_PORT_INDICES.map((portIndex) => {
          const connection = objects.find((object) => object.config.kind === 'conveyor'
            && object.config.toObjectId === machine.id
            && (object.config.toPortIndex ?? 1) === portIndex)
          const connectionConfig = connection?.config.kind === 'conveyor' ? connection.config : null
          const source = connectionConfig
            ? objects.find((object) => object.id === connectionConfig.fromObjectId)
            : undefined
          return (
            <div className={`machine-port-row ${connection ? 'is-connected' : ''}`} key={`input-${portIndex}`}>
              <span>入料口 {portIndex + 1}</span>
              <strong>{connection ? source?.name ?? connection.name : '空闲 · 可吸附'}</strong>
            </div>
          )
        })}
      </div>
      <div className="machine-port-routing__group machine-port-routing__group--output">
        {MACHINE_PORT_INDICES.map((portIndex) => {
          const connection = objects.find((object) => object.config.kind === 'conveyor'
            && object.config.fromObjectId === machine.id
            && (object.config.fromPortIndex ?? 1) === portIndex)
          const connectionConfig = connection?.config.kind === 'conveyor' ? connection.config : null
          const target = connectionConfig
            ? objects.find((object) => object.id === connectionConfig.toObjectId)
            : undefined
          const selectedItemId = connectionConfig?.outputItemId ?? ''
          return (
            <div className={`machine-port-row machine-port-row--output ${connection ? 'is-connected' : ''}`} key={`output-${portIndex}`}>
              <span>出货口 {portIndex + 1}</span>
              <strong>{connection ? target?.name ?? (connectionConfig?.toObjectId === 'finished-goods' ? '成品区' : connection.name) : '空闲 · 可吸附'}</strong>
              {connection && recipe?.outputs.length === 1 ? <small>自动输出：{itemName(recipe.outputs[0].itemId)}</small> : null}
              {connection && recipe && recipe.outputs.length > 1 ? (
                <select
                  aria-label={`出货口 ${portIndex + 1} 输出产物`}
                  value={selectedItemId}
                  onChange={(event) => onConveyorOutput(connection.id, event.target.value || null)}
                >
                  <option value="">请选择输出产物</option>
                  {recipe.outputs.map((line) => <option key={line.itemId} value={line.itemId}>{itemName(line.itemId)}</option>)}
                </select>
              ) : null}
              {connection && !recipe ? <small>绑定配方后设置产物</small> : null}
            </div>
          )
        })}
      </div>
      <p>每个端口只能连接一条传送带；已连接端口不会再次参与自动吸附</p>
    </section>
  )
}

function WarehousePortRouting({
  warehouse,
  objects,
  items,
  inventory,
  onConveyorOutput,
  onDispatchInterval,
  onAdjustInventory,
  onSetInfiniteSupply,
  onManageItems,
}: {
  warehouse: FactoryObject
  objects: FactoryObject[]
  items: Item[]
  inventory: InventoryRecord[]
  onConveyorOutput: (conveyorId: string, itemId: string | null) => void
  onDispatchInterval: (portIndex: MachinePortIndex, seconds: number) => void
  onAdjustInventory: (recordId: string, delta: number) => boolean
  onSetInfiniteSupply: (recordId: string, enabled: boolean) => boolean
  onManageItems: () => void
}) {
  const isShelf = warehouse.kind === 'shelf'
  const records = inventory.filter((record) => record.locationType === 'rack-slot' && record.locationId.startsWith(`${warehouse.id}:`))
  const stocked = records.filter((record) => record.quantity > 0 || record.infiniteSupply)
  const total = records.reduce((sum, record) => sum + record.quantity, 0)
  const inboundReserved = records.reduce((sum, record) => sum + (record.reservedInboundCapacity ?? 0), 0)
  const infiniteCount = records.filter((record) => record.infiniteSupply).length
  const capacity = warehouse.config.kind === 'rack' ? warehouse.config.slotCount * warehouse.config.slotCapacity : Number.MAX_SAFE_INTEGER
  const remainingCapacity = Math.max(0, capacity - total - inboundReserved)
  const itemName = (itemId: string) => items.find((item) => item.id === itemId)?.name ?? itemId
  return (
    <section className="machine-port-routing warehouse-port-routing" aria-label={`${isShelf ? '货架' : '货物仓库'}端口与库存分流`}>
      <header><span className="eyebrow">{isShelf ? 'UNBOUNDED SHELF INVENTORY' : 'WAREHOUSE INVENTORY'}</span><strong>{total} 件{infiniteCount > 0 ? ` · ${infiniteCount} 项无限` : ''}</strong></header>
      <div className="warehouse-inventory-manager">
        {items.length === 0 ? (
          <div className="warehouse-inventory-empty">
            <strong>还没有可{isShelf ? '上架' : '入库'}的物品</strong>
            <small>先定义至少一种物品，{isShelf ? '货架' : '仓库'}才会生成对应库存记录</small>
            <button onClick={onManageItems}>前往定义物品</button>
          </div>
        ) : items.map((item) => {
          const record = records.find((candidate) => candidate.itemId === item.id)
          if (!record) return null
          return (
            <WarehouseInventoryRow
              key={record.id}
              item={item}
              record={record}
              maxAdd={isShelf ? Number.MAX_SAFE_INTEGER - record.quantity : Math.min(record.capacity - record.quantity, remainingCapacity)}
              unbounded={isShelf}
              onAdjust={onAdjustInventory}
              onSetInfinite={onSetInfiniteSupply}
            />
          )
        })}
      </div>
      <div className="warehouse-capacity-line"><span>{isShelf ? '堆叠容量' : '有限库存容量'}</span><strong>{isShelf ? `${total} / ∞` : `${total} 实存 + ${inboundReserved} 入库占位 / ${capacity}`}</strong></div>
      {!isShelf ? <>
      <div className="machine-port-routing__group">
        {MACHINE_PORT_INDICES.map((portIndex) => {
          const connection = objects.find((object) => object.config.kind === 'conveyor'
            && object.config.toObjectId === warehouse.id
            && (object.config.toPortIndex ?? 1) === portIndex)
          const config = connection?.config.kind === 'conveyor' ? connection.config : null
          const source = config ? objects.find((object) => object.id === config.fromObjectId) : undefined
          return (
            <div className={`machine-port-row ${connection ? 'is-connected' : ''}`} key={`warehouse-input-${portIndex}`}>
              <span>入货口 {portIndex + 1}</span>
              <strong>{connection ? source?.name ?? connection.name : '空闲 · 可吸附'}</strong>
            </div>
          )
        })}
      </div>
      <div className="machine-port-routing__group machine-port-routing__group--output">
        {MACHINE_PORT_INDICES.map((portIndex) => {
          const connection = objects.find((object) => object.config.kind === 'conveyor'
            && object.config.fromObjectId === warehouse.id
            && (object.config.fromPortIndex ?? 1) === portIndex)
          const config = connection?.config.kind === 'conveyor' ? connection.config : null
          const target = config ? objects.find((object) => object.id === config.toObjectId) : undefined
          const legacyInterval = warehouse.config.kind === 'rack' ? warehouse.config.dispatchIntervalSec ?? 2.5 : 2.5
          const dispatchIntervalSec = warehouse.config.kind === 'rack'
            ? warehouse.config.dispatchIntervalSecByPort?.[portIndex] ?? legacyInterval
            : legacyInterval
          return (
            <div className={`machine-port-row machine-port-row--output ${connection ? 'is-connected' : ''}`} key={`warehouse-output-${portIndex}`}>
              <span>出货口 {portIndex + 1}</span>
              <strong>{connection ? target?.name ?? (config?.toObjectId === 'finished-goods' ? '成品区' : connection.name) : '空闲 · 可吸附'}</strong>
              <label className="warehouse-port-interval">
                <span>出货间隔</span>
                <input
                  type="number"
                  min={0.25}
                  max={60}
                  step={0.25}
                  value={dispatchIntervalSec}
                  aria-label={`出货口 ${portIndex + 1} 出货间隔（秒）`}
                  onChange={(event) => onDispatchInterval(portIndex, Number(event.target.value))}
                />
                <em>秒 / 次</em>
              </label>
              {connection && stocked.length === 0 ? <small>等待库存或无限供应</small> : null}
              {connection && stocked.length === 1 ? <small>自动出货：{itemName(stocked[0].itemId)}{stocked[0].infiniteSupply ? ' · ∞' : ''}</small> : null}
              {connection && stocked.length > 1 ? (
                <select
                  aria-label={`${isShelf ? '货架' : '仓库'}出货口 ${portIndex + 1} 输出物品`}
                  value={config?.outputItemId ?? ''}
                  onChange={(event) => onConveyorOutput(connection.id, event.target.value || null)}
                >
                  <option value="">请选择出货物品</option>
                  {stocked.map((record) => <option key={record.itemId} value={record.itemId}>{itemName(record.itemId)} · {record.infiniteSupply ? '无限供应' : `${record.quantity} 件`}</option>)}
                </select>
              ) : null}
            </div>
          )
        })}
      </div>
      <p>每个端口只能连接一条传送带；有限库存按实际数量扣减，无限供应可持续出货且不扣数量</p>
      </> : <p>货架不设传送带出货口或入货口，也不参与传送带吸附；库存可由本面板手动维护，或通过 AGV、无人机实际取货和存货</p>}
    </section>
  )
}

function WarehouseInventoryRow({
  item,
  record,
  maxAdd,
  unbounded = false,
  onAdjust,
  onSetInfinite,
}: {
  item: Item
  record: InventoryRecord
  maxAdd: number
  unbounded?: boolean
  onAdjust: (recordId: string, delta: number) => boolean
  onSetInfinite: (recordId: string, enabled: boolean) => boolean
}) {
  const [addAmount, setAddAmount] = useState(1)
  const infinite = record.infiniteSupply === true
  const outboundReserved = record.reservedOutboundQuantity ?? 0
  const inboundReserved = record.reservedInboundCapacity ?? 0
  const addStock = () => {
    const amount = Math.max(1, Math.min(Math.trunc(addAmount), maxAdd))
    if (onAdjust(record.id, amount)) setAddAmount(1)
  }
  return (
    <article className={`warehouse-inventory-row ${infinite ? 'is-infinite' : ''}`}>
      <div className="warehouse-inventory-row__identity">
        <strong>{item.name}</strong>
        <small>{item.code || item.id}</small>
      </div>
      <div className="warehouse-inventory-row__quantity">
        <strong>{infinite ? '∞' : record.quantity}</strong>
        <small>{infinite
          ? `无限供应 · 实存 ${record.quantity} 件`
          : outboundReserved > 0 || inboundReserved > 0
            ? `件 · 出库预留 ${outboundReserved} · 入库占位 ${inboundReserved}`
            : '件'}</small>
      </div>
      <button
        className="warehouse-infinite-toggle"
        aria-pressed={infinite}
        aria-label={`${infinite ? '取消' : '启用'} ${item.name} 无限供应`}
        onClick={() => onSetInfinite(record.id, !infinite)}
      >{infinite ? '取消无限' : '设为无限'}</button>
      <div className="warehouse-manual-stock">
        <button aria-label={`减少 ${item.name} 1 件`} onClick={() => onAdjust(record.id, -1)} disabled={infinite || record.quantity <= outboundReserved}>−1</button>
        <input
          type="number"
          min={1}
          max={unbounded ? undefined : Math.max(1, maxAdd)}
          value={addAmount}
          disabled={infinite || maxAdd <= 0}
          aria-label={`手动${unbounded ? '上架' : '入库'} ${item.name} 数量`}
          onChange={(event) => setAddAmount(Math.max(1, Number(event.target.value) || 1))}
          onKeyDown={(event) => { if (event.key === 'Enter' && !infinite && maxAdd > 0) addStock() }}
        />
        <button onClick={addStock} disabled={infinite || maxAdd <= 0}>手动{unbounded ? '上架' : '入库'}</button>
      </div>
    </article>
  )
}

function rotatedFootprint(footprint: [number, number], rotationY: GridTransform['rotationY']) {
  const quarterTurn = rotationY === 90 || rotationY === 270
  return { width: quarterTurn ? footprint[1] : footprint[0], depth: quarterTurn ? footprint[0] : footprint[1] }
}

function facilityPlacement(entry: BuildEntry, pointer: GridPoint, gridSize: number, rotationY: GridTransform['rotationY']) {
  const snap = (value: number) => Math.round(value / gridSize) * gridSize
  const footprint = rotatedFootprint(entry.footprint, rotationY)
  const position = {
    x: snap(pointer.x - footprint.width / 2),
    z: snap(pointer.z - footprint.depth / 2),
  }
  return {
    position,
    center: {
      x: position.x + footprint.width / 2,
      z: position.z + footprint.depth / 2,
    },
  }
}

function isDockTarget(target: EventTarget | null) {
  return target instanceof Element && Boolean(target.closest('.construction-dock, .floor-stack-panel, .editor-float, .editor-inspector-peek'))
}

function isEditableTarget(target: EventTarget | null) {
  return target instanceof HTMLElement && (
    target.isContentEditable
    || target.matches('input, textarea, select')
  )
}

function formatDockDuration(seconds: number) {
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const remainingSeconds = Math.floor(seconds % 60)
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(remainingSeconds).padStart(2, '0')}`
}

function statusLabel(status: string) {
  return ({ idle: '空闲', ready: '已就绪', running: '运行中', 'waiting-input': '等待输入', blocked: '阻塞', planned: '视觉规划态', offline: '离线' } as Record<string, string>)[status] ?? status
}
