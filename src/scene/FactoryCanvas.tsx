import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { OrbitControls, PerformanceMonitor } from '@react-three/drei'
import { Suspense, useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'
import { GridFloor } from './GridFloor'
import { BuildPlacer } from './BuildPlacer'
import { GhostPreview } from './GhostPreview'
import { FactoryObjectMesh, getConveyorLinks } from './FactoryObjectMesh'
import { ItemLotMesh } from './ItemLotMesh'
import { ElevatorCabin } from './ElevatorCabin'
import { LoginCameraRig } from './LoginCameraRig'
import { preloadPandaArm } from './PandaArmModel'
import { useForgeMindStore } from '../store/forgeMind'
import { useAuthStore } from '../store/auth'
import { DaiyuConveyorBatch, DaiyuEmbeddedModelBatch, DaiyuPandaBatch, DaiyuRuntime, DaiyuScenePrewarmer, DaiyuStaticModelBatch } from '../engine/daiyu'
import { canBatchAsGenericMachine, type BuildType, type FactoryFloorId, type FactoryObject } from '../game/types'
import { AgvRouteVisual } from './AgvRouteVisual'
import { BASE_CONVEYOR_CROSS_SECTION_SCALE, NON_VEHICLE_BUILDING_VISUAL_SCALE, SOURCE_EMBEDDED_CONVEYOR_LOCAL_POSITION } from './industrialVisualScale'
import { WarehouseZone } from './WarehouseZone'
import { FactoryFloorSystem, getFloorElevation, getObjectFloor } from './FactoryFloorSystem'
import { inclineTouchesFloor, isInclineConveyorType, objectsTouchingFloor } from '../game/inclineConveyor'
import { InclineConveyorMesh } from './InclineConveyorMesh'
import { DroneRouteVisual } from './DroneRouteVisual'
import { floorIsInteractive, floorObjectsVisible, gridVisibleOnFloor, inclineVisible } from '../game/floorVisibility'
import { getFactoryFloors } from '../game/floorConfig'
import { SelectionController } from './SelectionController'
import { RackInventoryLabels } from './RackInventoryLabels'

/**
 * 3D 工厂视口 —— 主画布。
 * Day 1：相机 + 灯光 + 网格地面 + OrbitControls。
 * Day 2：叠加建造交互（放置/旋转/ghost）与已放置对象渲染。
 * 登录后：电梯舱（ElevatorCabin）在未进厂阶段挂载，登录成功相机从舱内推镜进厂，
 * 相机控制（CameraRig/OrbitControls）仅在 factory 阶段挂载，避免与推镜抢相机。
 */
export type FactoryView = 'overview' | 'build' | 'flow' | 'diagnostics'
const DEFAULT_FACTORY_FLOORS: FactoryFloorId[] = [1]

const CABIN_CAM: [number, number, number] = [-15.75, 1.88, 0]

export const CAMERA_PRESETS: Record<FactoryView, { position: [number, number, number]; target: [number, number, number] }> = {
  overview: { position: [25, 31, 29], target: [-2, 0, 0] },
  build: { position: [-2, 43, 0.01], target: [-2, 0, 0] },
  flow: { position: [30, 17, 20], target: [-2, 0, 0] },
  diagnostics: { position: [-2, 43, 0.01], target: [-2, 0, 0] },
}

/** 工厂场景内容（无 Canvas 包装，供 FactoryCanvas 复用）。 */
export function FactoryScene({
  view,
  visible = true,
  activeFloor = 1,
  visibleFloors = DEFAULT_FACTORY_FLOORS,
  floorCount = 1,
}: {
  view: FactoryView
  visible?: boolean
  activeFloor?: FactoryFloorId
  visibleFloors?: readonly FactoryFloorId[]
  floorCount?: number
}) {
  const storedObjects = useForgeMindStore((s) => s.objects)
  const allObjects = useMemo(() => getDaiyuStressObjects(storedObjects), [storedObjects])
  const visibleFloorSet = useMemo(() => new Set(visibleFloors), [visibleFloors])
  const factoryFloorIds = useMemo(() => getFactoryFloors(floorCount).map((floor) => floor.id), [floorCount])
  const objects = useMemo(
    () => selectableObjectsForFloor(allObjects, activeFloor, visibleFloorSet),
    [activeFloor, allObjects, visibleFloorSet],
  )
  const ghost = useForgeMindStore((s) => s.ghost)
  const selectedId = useForgeMindStore((s) => s.selectedId)
  const selectedIds = useForgeMindStore((s) => s.selectedIds)
  const selectedIdSet = useMemo(() => new Set(selectedIds), [selectedIds])
  const select = useForgeMindStore((s) => s.select)
  const simSnapshot = useForgeMindStore((s) => s.simSnapshot)
  const items = useForgeMindStore((s) => s.items)
  const simPlaying = useForgeMindStore((s) => s.simPlaying)
  const contentRef = useRef<THREE.Group>(null)

  // 机器运行时态索引：objectId -> runtime
  const runtimeMap = useMemo(
    () => new Map(simSnapshot.machines.map((machine) => [machine.objectId, machine])),
    [simSnapshot.machines],
  )
  const sourceRuntimeMap = useMemo(
    () => new Map(simSnapshot.sources.map((source) => [source.objectId, source])),
    [simSnapshot.sources],
  )
  const conveyorActiveIds = useMemo(
    () => new Set(simSnapshot.itemLots.map((lot) => lot.conveyorId)),
    [simSnapshot.itemLots],
  )
  const visibleItemLots = useMemo(() => {
    const objectsById = new Map(allObjects.map((object) => [object.id, object]))
    return simSnapshot.itemLots.filter((lot) => {
      const conveyor = objectsById.get(lot.conveyorId)
      return conveyor && isInclineConveyorType(conveyor.type)
        ? inclineTouchesFloor(conveyor, activeFloor)
          && Boolean(conveyor.incline && inclineVisible(conveyor.incline, activeFloor, visibleFloorSet))
        : lot.floorId === activeFloor
    })
  }, [activeFloor, allObjects, simSnapshot.itemLots, visibleFloorSet])
  const agvRuntimeMap = useMemo(
    () => new Map(simSnapshot.agvs.map((agv) => [agv.objectId, agv])),
    [simSnapshot.agvs],
  )
  const droneRuntimeMap = useMemo(
    () => new Map(simSnapshot.drones.map((drone) => [drone.objectId, drone])),
    [simSnapshot.drones],
  )
  const visibleDroneObjects = useMemo(
    () => allObjects.filter((object) => {
      if (object.type !== 'drone') return false
      const runtime = droneRuntimeMap.get(object.id)
      return floorObjectsVisible(runtime ? nearestFloorForDrone(runtime.position.y, factoryFloorIds) : getObjectFloor(object), activeFloor, visibleFloorSet)
    }),
    [activeFloor, allObjects, droneRuntimeMap, factoryFloorIds, visibleFloorSet],
  )
  const contextFloorIds = useMemo(
    () => factoryFloorIds.filter((floorId) => floorId !== activeFloor && visibleFloorSet.has(floorId)),
    [activeFloor, factoryFloorIds, visibleFloorSet],
  )
  const contextInclines = useMemo(
    () => allObjects.filter((object) => isInclineConveyorType(object.type)
      && Boolean(object.incline)
      && !inclineTouchesFloor(object, activeFloor)
      && inclineVisible(object.incline!, activeFloor, visibleFloorSet)),
    [activeFloor, allObjects, visibleFloorSet],
  )
  const batchedConveyors = useMemo(
    () => objects.filter((object) => object.type === 'conveyor' && !getConveyorLinks(object, objects).corner),
    [objects],
  )
  const inclineObjects = useMemo(() => objects.filter((object) => isInclineConveyorType(object.type)), [objects])
  const individuallyRenderedObjects = useMemo(() => {
    const batchedIds = new Set([...batchedConveyors, ...inclineObjects].map((object) => object.id))
    return objects.filter((object) => !batchedIds.has(object.id))
  }, [batchedConveyors, inclineObjects, objects])
  const staticMachineObjects = useMemo(() => objects.filter(canBatchAsGenericMachine), [objects])
  const staticAgvObjects = useMemo(() => objects.filter((object) => object.type === 'agv'), [objects])
  const staticPressObjects = useMemo(() => objects.filter((object) => object.type === 'press'), [objects])
  const staticWashingObjects = useMemo(() => objects.filter((object) => object.type === 'washing'), [objects])
  const staticStorageObjects = useMemo(() => objects.filter((object) => object.type === 'storage'), [objects])
  const sourceObjects = useMemo(() => objects.filter((object) => object.type === 'source'), [objects])
  const sourceIds = useMemo(() => new Set(sourceObjects.map((object) => object.id)), [sourceObjects])
  const batchedPandaObjects = useMemo(
    () => objects.filter((object) => {
      if (object.type !== 'source') return false
      const state = sourceRuntimeMap.get(object.id)?.state
      return state !== 'picking' && state !== 'placing'
    }),
    [objects, sourceRuntimeMap],
  )
  const batchedPandaIds = useMemo(() => new Set(batchedPandaObjects.map((object) => object.id)), [batchedPandaObjects])
  const staticBatchedIds = useMemo(
    () => new Set([...staticMachineObjects, ...staticAgvObjects, ...staticPressObjects, ...staticWashingObjects, ...staticStorageObjects].map((object) => object.id)),
    [staticAgvObjects, staticMachineObjects, staticPressObjects, staticStorageObjects, staticWashingObjects],
  )
  const castDetailedShadows = objects.length <= 120
  const floorElevation = getFloorElevation(activeFloor)

  return (
    <>
      {/* 背景雾 —— 让远处网格淡出，工业纵深感 */}
      {visible && <color attach="background" args={['#c4ceca']} />}
      {visible && <fog attach="fog" args={['#c4ceca', 60, 180]} />}

      <DaiyuScenePrewarmer rootRef={contentRef} enabled={!visible} preload={preloadPandaArm} />
      <group ref={contentRef} visible={visible}>
        {/* 灯光 */}
        <ambientLight intensity={0.5} />
        <hemisphereLight args={['#edf1f0', '#8d9794', 0.55]} />
        <directionalLight
          position={[20, 30, 15]}
          intensity={1.2}
          castShadow
          shadow-mapSize={[1024, 1024]}
          shadow-normalBias={0.025}
          shadow-camera-near={1}
          shadow-camera-far={120}
          shadow-camera-left={-40}
          shadow-camera-right={40}
          shadow-camera-top={40}
          shadow-camera-bottom={-40}
        />

        {/* 场景内容 */}
        <FactoryFloorSystem floorCount={floorCount} />
        {factoryFloorIds.filter((floorId) => gridVisibleOnFloor(floorId, activeFloor)).map((floorId) => (
          <group key={floorId} name={`active-floor-grid:L${floorId}`} position={[0, getFloorElevation(floorId), 0]}>
            <GridFloor showZones={floorId === 1} />
            {floorId === 1 && <WarehouseZone />}
          </group>
        ))}

        <group name="cargo-drone-vehicles">
          <DaiyuStaticModelBatch
            type="drone"
            objects={visibleDroneObjects.filter((object) => {
              const runtime = droneRuntimeMap.get(object.id)
              return floorIsInteractive(runtime ? nearestFloorForDrone(runtime.position.y, factoryFloorIds) : getObjectFloor(object), activeFloor)
            })}
            motion={droneRuntimeMap}
            castShadows={castDetailedShadows}
            onSelect={select}
          />
          <DaiyuStaticModelBatch
            type="drone"
            objects={visibleDroneObjects.filter((object) => {
              const runtime = droneRuntimeMap.get(object.id)
              return !floorIsInteractive(runtime ? nearestFloorForDrone(runtime.position.y, factoryFloorIds) : getObjectFloor(object), activeFloor)
            })}
            motion={droneRuntimeMap}
            castShadows={false}
          />
        </group>
        <DroneRouteVisual drones={simSnapshot.drones.filter((drone) => visibleDroneObjects.some((object) => object.id === drone.objectId))} />

        {contextFloorIds.map((floorId) => <ContextFloorLayer key={floorId} floorId={floorId} allObjects={allObjects} running={simPlaying} />)}
        {contextInclines.map((object) => (
          <group key={object.id} position={[0, getFloorElevation(object.incline!.lowerFloorId), 0]}>
            <InclineConveyorMesh
              object={object}
              renderFloorId={object.incline!.lowerFloorId}
              selected={selectedIdSet.has(object.id)}
              running={simPlaying}
            />
            {simSnapshot.itemLots.filter((lot) => lot.conveyorId === object.id).map((lot) => <ItemLotMesh key={lot.id} lot={lot} renderFloorId={object.incline!.lowerFloorId} />)}
          </group>
        ))}

        {/* 已放置对象 */}
        <group position={[0, floorElevation, 0]}>
          <DaiyuConveyorBatch
            objects={batchedConveyors}
            running={simPlaying}
            selectedIds={selectedIds}
            castShadows={castDetailedShadows}
            onSelect={select}
          />
          <DaiyuStaticModelBatch type="machine" objects={staticMachineObjects} castShadows={castDetailedShadows} onSelect={select} />
          <DaiyuStaticModelBatch type="agv" objects={staticAgvObjects} motion={agvRuntimeMap} castShadows={castDetailedShadows} onSelect={select} />
          <DaiyuStaticModelBatch type="press" objects={staticPressObjects} castShadows={castDetailedShadows} onSelect={select} />
          <DaiyuStaticModelBatch type="washing" objects={staticWashingObjects} castShadows={castDetailedShadows} onSelect={select} />
          <DaiyuStaticModelBatch type="storage" objects={staticStorageObjects} castShadows={castDetailedShadows} onSelect={select} />
          <DaiyuPandaBatch objects={batchedPandaObjects} castShadows={castDetailedShadows} onSelect={select} />
          <DaiyuEmbeddedModelBatch batchName="source-conveyor" path="/models/industrial/roller_conveyor_segment.glb" targetFootprint={1.05} targetHeight={0.52} localPosition={SOURCE_EMBEDDED_CONVEYOR_LOCAL_POSITION} rotationOffsetY={Math.PI / 2} stripDirectionTexture crossSectionScale={BASE_CONVEYOR_CROSS_SECTION_SCALE} visualScale={NON_VEHICLE_BUILDING_VISUAL_SCALE} objects={sourceObjects} castShadows={castDetailedShadows} onSelect={select} />
          {inclineObjects.map((object) => (
            <InclineConveyorMesh
              key={object.id}
              object={object}
              renderFloorId={activeFloor}
              selected={selectedIdSet.has(object.id)}
              running={simPlaying}
              onSelect={select}
            />
          ))}
          {individuallyRenderedObjects.map((o) => (
            <FactoryObjectMesh
              key={o.id}
              obj={o}
              objects={objects}
              selected={selectedIdSet.has(o.id)}
              active={conveyorActiveIds.has(o.id) || sourceRuntimeMap.get(o.id)?.state === 'picking' || sourceRuntimeMap.get(o.id)?.state === 'placing'}
              running={simPlaying}
              runtime={runtimeMap.get(o.id)}
              sourceRuntime={sourceRuntimeMap.get(o.id)}
              suppressEquipmentModel={staticBatchedIds.has(o.id)}
              showPortMarkers={objects.length <= 120 || o.id === selectedId}
              castShadows={castDetailedShadows}
              suppressPanda={batchedPandaIds.has(o.id)}
              suppressConveyor={sourceIds.has(o.id)}
              onClick={select}
            />
          ))}

          {/* 在途物品（ItemLot） */}
          {visibleItemLots.map((lot) => (
            <ItemLotMesh key={lot.id} lot={lot} renderFloorId={activeFloor} />
          ))}

          <RackInventoryLabels objects={objects} racks={simSnapshot.racks} items={items} />

          {/* ghost 预览 */}
          <GhostPreview ghost={ghost} />

          {/* 建造指针交互（挂 window 键盘） */}
          <BuildPlacer enabled={visible && view === 'build'} floorId={activeFloor} />
        </group>
        {floorObjectsVisible(1, activeFloor, visibleFloorSet) && <AgvRouteVisual agvs={simSnapshot.agvs} />}
      </group>
    </>
  )
}

function CanvasSelectionController({
  enabled,
  activeFloor,
  visibleFloors,
}: {
  enabled: boolean
  activeFloor: FactoryFloorId
  visibleFloors: readonly FactoryFloorId[]
}) {
  const storedObjects = useForgeMindStore((state) => state.objects)
  const allObjects = useMemo(() => getDaiyuStressObjects(storedObjects), [storedObjects])
  const visibleFloorSet = useMemo(() => new Set(visibleFloors), [visibleFloors])
  const selectableObjects = useMemo(
    () => selectableObjectsForFloor(allObjects, activeFloor, visibleFloorSet),
    [activeFloor, allObjects, visibleFloorSet],
  )
  return <SelectionController enabled={enabled} selectableObjects={selectableObjects} />
}

function selectableObjectsForFloor(allObjects: FactoryObject[], activeFloor: FactoryFloorId, visibleFloorSet: ReadonlySet<FactoryFloorId>) {
  return allObjects.filter((object) => {
    if (object.type === 'drone') return false
    if (isInclineConveyorType(object.type) && object.incline) {
      return inclineTouchesFloor(object, activeFloor) && inclineVisible(object.incline, activeFloor, visibleFloorSet)
    }
    return floorObjectsVisible(activeFloor, activeFloor, visibleFloorSet) && getObjectFloor(object) === activeFloor
  })
}

function ContextFloorLayer({ floorId, allObjects, running }: { floorId: FactoryFloorId; allObjects: FactoryObject[]; running: boolean }) {
  const snapshot = useForgeMindStore((state) => state.simSnapshot)
  const floorObjects = useMemo(
    () => allObjects.filter((object) => getObjectFloor(object) === floorId && object.type !== 'drone' && !isInclineConveyorType(object.type)),
    [allObjects, floorId],
  )
  const touchingObjects = useMemo(() => objectsTouchingFloor(allObjects, floorId), [allObjects, floorId])
  const runtimeMap = useMemo(() => new Map(snapshot.machines.map((runtime) => [runtime.objectId, runtime])), [snapshot.machines])
  const sourceRuntimeMap = useMemo(() => new Map(snapshot.sources.map((runtime) => [runtime.objectId, runtime])), [snapshot.sources])
  const activeIds = useMemo(() => new Set(snapshot.itemLots.map((lot) => lot.conveyorId)), [snapshot.itemLots])
  const itemLots = useMemo(() => snapshot.itemLots.filter((lot) => lot.floorId === floorId && !isInclineConveyorType(allObjects.find((object) => object.id === lot.conveyorId)?.type ?? 'conveyor')), [allObjects, floorId, snapshot.itemLots])
  return (
    <group name={`context-floor:L${floorId}`} position={[0, getFloorElevation(floorId), 0]}>
      {floorObjects.map((object) => (
        <FactoryObjectMesh
          key={object.id}
          obj={object}
          objects={touchingObjects}
          selected={false}
          active={activeIds.has(object.id) || sourceRuntimeMap.get(object.id)?.state === 'picking' || sourceRuntimeMap.get(object.id)?.state === 'placing'}
          running={running}
          runtime={runtimeMap.get(object.id)}
          sourceRuntime={sourceRuntimeMap.get(object.id)}
          castShadows={false}
          showPortMarkers={false}
        />
      ))}
      {itemLots.map((lot) => <ItemLotMesh key={lot.id} lot={lot} renderFloorId={floorId} />)}
    </group>
  )
}

function nearestFloorForDrone(y: number, floorIds: readonly FactoryFloorId[]): FactoryFloorId {
  return floorIds.reduce((nearest, floorId) => {
    const nearestDistance = Math.abs(y - (getFloorElevation(nearest) + 2.2))
    const distance = Math.abs(y - (getFloorElevation(floorId) + 2.2))
    return distance < nearestDistance ? floorId : nearest
  }, 1 as FactoryFloorId)
}

/** 仅开发环境：?daiyuStress=300，不写入 store，也不参与保存。 */
function getDaiyuStressObjects(storedObjects: FactoryObject[]) {
  if (!import.meta.env.DEV) return storedObjects
  const requested = Number(new URLSearchParams(window.location.search).get('daiyuStress'))
  if (!Number.isFinite(requested) || requested < 1) return storedObjects
  const count = Math.min(Math.floor(requested), 600)
  const pattern: BuildType[] = [
    'conveyor', 'conveyor', 'conveyor', 'conveyor', 'conveyor', 'conveyor',
    'conveyor', 'conveyor', 'conveyor', 'conveyor', 'conveyor', 'conveyor',
    'machine', 'machine', 'agv', 'storage', 'source', 'press', 'washing', 'inspection',
  ]
  const columns = Math.ceil(Math.sqrt(count * 1.45))
  const rows = Math.ceil(count / columns)
  return Array.from({ length: count }, (_, index): FactoryObject => {
    const type = pattern[index % pattern.length]
    const column = index % columns
    const row = Math.floor(index / columns)
    return {
      id: `daiyu-stress-${index}`,
      type,
      pos: {
        x: column * 3 - Math.floor(columns * 1.5),
        z: row * 3 - Math.floor(rows * 1.5),
      },
      rotation: ([0, 90, 180, 270] as const)[(column + row) % 4],
    }
  })
}

export function FactoryCanvas({ view = 'overview', activeFloor = 1, visibleFloors = DEFAULT_FACTORY_FLOORS, floorCount = 1 }: { view?: FactoryView; activeFloor?: FactoryFloorId; visibleFloors?: readonly FactoryFloorId[]; floorCount?: number }) {
  const phase = useAuthStore((s) => s.phase)
  const buildType = useForgeMindStore((s) => s.buildType)
  const inFactory = phase === 'factory'
  const showFactory = phase !== 'elevator'
  const isPlacing = buildType !== null
  const floorElevation = getFloorElevation(activeFloor)
  const cameraPreset = CAMERA_PRESETS[view]
  const forcedDevelopmentDpr = getForcedDevelopmentDpr()
  const [dpr, setDpr] = useState(() => forcedDevelopmentDpr ?? Math.min(window.devicePixelRatio, 1.2))

  return (
    <Canvas
      shadows="basic"
      dpr={dpr}
      performance={{ min: 0.55, debounce: 650 }}
      camera={{ position: inFactory ? [cameraPreset.position[0], cameraPreset.position[1] + floorElevation, cameraPreset.position[2]] : CABIN_CAM, fov: 45, near: 0.1, far: 500 }}
      gl={{ antialias: true, powerPreference: 'high-performance', stencil: false }}
      style={{ background: 'transparent' }}
    >
      <PerformanceMonitor
        flipflops={3}
        onChange={({ factor }) => {
          if (forcedDevelopmentDpr === null && phase !== 'entering') setDpr(Math.max(1, Math.round((0.78 + factor * 0.62) * 100) / 100))
        }}
        onFallback={() => {
          if (forcedDevelopmentDpr === null) setDpr(1)
        }}
      />
      <DaiyuRuntime running={inFactory} />
      <Suspense fallback={null}>
        <FactoryScene view={view} visible={showFactory} activeFloor={activeFloor} visibleFloors={visibleFloors} floorCount={floorCount} />
      </Suspense>
      <CanvasSelectionController enabled={showFactory && view !== 'flow'} activeFloor={activeFloor} visibleFloors={visibleFloors} />

      {/* 未进厂：电梯舱 + 登录相机推镜（独占相机） */}
      {!inFactory && <ElevatorCabin />}
      {!inFactory && <LoginCameraRig />}

      {/* 已进厂：视图切换 + 用户相机控制 */}
      {inFactory && <FactoryCameraController view={view} isPlacing={isPlacing} activeFloor={activeFloor} />}
    </Canvas>
  )
}

function getForcedDevelopmentDpr() {
  if (!import.meta.env.DEV) return null
  const value = Number(new URLSearchParams(window.location.search).get('daiyuDpr'))
  return Number.isFinite(value) && value >= 1 && value <= 2 ? value : null
}

function FactoryCameraController({ view, isPlacing, activeFloor }: { view: FactoryView; isPlacing: boolean; activeFloor: FactoryFloorId }) {
  const { camera } = useThree()
  const controlsRef = useRef<OrbitControlsImpl>(null)
  const preset = CAMERA_PRESETS[view]
  const floorElevation = getFloorElevation(activeFloor)
  const destination = useMemo(() => new THREE.Vector3(preset.position[0], preset.position[1] + floorElevation, preset.position[2]), [floorElevation, preset])
  const destinationTarget = useMemo(() => new THREE.Vector3(preset.target[0], preset.target[1] + floorElevation, preset.target[2]), [floorElevation, preset])
  const transition = useRef({
    active: false,
    startedAt: 0,
    duration: 1100,
    fromPosition: new THREE.Vector3(),
    fromTarget: new THREE.Vector3(),
    distance: 0,
  })

  useEffect(() => {
    const state = transition.current
    const controls = controlsRef.current
    state.startedAt = performance.now()
    state.fromPosition.copy(camera.position)
    state.fromTarget.copy(controls?.target ?? destinationTarget)
    state.distance = state.fromPosition.distanceTo(destination)
    state.duration = THREE.MathUtils.clamp(780 + state.distance * 22, 960, 1380)
    state.active = state.distance > 0.015 || state.fromTarget.distanceTo(destinationTarget) > 0.015
    if (controls && state.active) controls.enabled = false
  }, [activeFloor, camera, destination, destinationTarget, view])

  useFrame(() => {
    const state = transition.current
    const controls = controlsRef.current
    if (!controls) return

    if (!state.active) {
      controls.enabled = !isPlacing
      return
    }

    const t = Math.min((performance.now() - state.startedAt) / state.duration, 1)
    const eased = t * t * t * (t * (t * 6 - 15) + 10)
    camera.position.lerpVectors(state.fromPosition, destination, eased)
    camera.position.y += Math.sin(Math.PI * eased) * Math.min(state.distance * 0.055, 1.25)
    controls.target.lerpVectors(state.fromTarget, destinationTarget, eased)
    controls.update()

    if (t >= 1) {
      camera.position.copy(destination)
      controls.target.copy(destinationTarget)
      controls.update()
      state.active = false
      controls.enabled = !isPlacing
    }
  })

  return (
    <OrbitControls
      ref={controlsRef}
      makeDefault
      enabled={!isPlacing}
      enablePan
      screenSpacePanning={false}
      enableDamping
      dampingFactor={0.08}
      maxPolarAngle={view === 'build' ? Math.PI / 2.02 : Math.PI / 2.05}
      minDistance={6}
      maxDistance={120}
    />
  )
}
