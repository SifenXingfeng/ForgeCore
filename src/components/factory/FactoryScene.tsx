import { forwardRef, Suspense, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import { ContactShadows, Edges, GizmoHelper, GizmoViewport, Grid, Html, OrbitControls } from '@react-three/drei'
import * as THREE from 'three'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'
import type { FactoryObject, FactoryObjectKind, Floor, FloorVisibilityMode, GridTransform, InventoryRecord, Item, SimulationState } from '../../types'
import { SceneObjects } from './SceneObjects'
import { SHELF_LAYOUT, trimPathForCorners, type GridPoint } from '../../domain/conveyorPath'
import { floorVisibilityRange } from '../../domain/floorVisibility'
import { RuntimeAsset, assetUrl } from './RuntimeAsset'
import { COUNT_INFINITY_DRONE_INTRINSIC_ROTATION_Y } from '../../data/runtimeAssetOrientation'

type Vector3Tuple = [number, number, number]

function stableConveyorQuaternion(directionValue: { x: number; y: number; z: number }): THREE.Quaternion {
  const forward = new THREE.Vector3(directionValue.x, directionValue.y, directionValue.z).normalize()
  const width = new THREE.Vector3(-forward.z, 0, forward.x).normalize()
  const up = new THREE.Vector3().crossVectors(width, forward).normalize()
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(forward, up, width))
}

export interface FactorySceneProps {
  objects: FactoryObject[]
  items: Item[]
  inventory: InventoryRecord[]
  simulation: SimulationState
  floors: Floor[]
  activeFloorId: string
  floorVisibilityMode?: FloorVisibilityMode
  enabledFloorIds?: ReadonlySet<string>
  factoryWidth: number
  factoryLength: number
  gridSize: number
  placementPreview?: PlacementPreview | null
  interactionLocked?: boolean
  showGrid?: boolean
  showLabels?: boolean
  shadowsEnabled?: boolean
  selectedId?: string | null
  onSelect: (id: string | null) => void
  onDragStart?: (id: string, pointerId: number, clientX: number, clientY: number, captureTarget: HTMLElement | null) => void
  simulationRunning?: boolean
  simTime?: number
  className?: string
  ariaLabel?: string
}

export interface PlacementPreview {
  kind: 'facility' | 'conveyor'
  point?: GridPoint
  path?: GridPoint[]
  footprint?: { width: number; depth: number }
  objectKind?: FactoryObjectKind
  modelRef?: string | null
  rotationY?: GridTransform['rotationY']
  valid?: boolean
  conveyorType?: 'flat' | 'incline'
  fromY?: number
  toY?: number
}

export interface FactorySceneHandle {
  screenToGrid: (clientX: number, clientY: number) => GridPoint | null
}

function LoadingScene() {
  return (
    <Html center>
      <div
        role="status"
        aria-live="polite"
        style={{
          border: '1px solid rgba(65, 66, 62, .18)',
          borderRadius: 12,
          background: 'rgba(248, 248, 245, .92)',
          boxShadow: '0 12px 34px rgba(25, 27, 25, .14)',
          color: '#353733',
          font: '12px/1.4 Inter, "Microsoft YaHei", sans-serif',
          padding: '9px 13px',
          whiteSpace: 'nowrap',
        }}
      >
        正在初始化三维工厂…
      </div>
    </Html>
  )
}

function PlotMarkings({ width, length }: { width: number; length: number }) {
  return (
    <group position={[0, 0.018, 0]}>
      {[length * 0.25, length * 0.5, length * 0.75].map((z) => (
        <mesh key={`aisle-${z}`} position={[0, 0, z]} receiveShadow>
          <boxGeometry args={[width, 0.012, 0.04]} />
          <meshBasicMaterial color="#f0c235" transparent opacity={0.32} />
        </mesh>
      ))}
      {[[0, 0], [width, 0], [0, length], [width, length]].map(([x, z]) => (
        <mesh key={`corner-${x}-${z}`} position={[x, 0.003, z]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[0.24, 0.28, 24]} />
          <meshBasicMaterial color="#e5ae14" transparent opacity={0.7} />
        </mesh>
      ))}
    </group>
  )
}

function FactoryEnvironment({ width, length, gridSize, showGrid, shadowsEnabled, lowerFloorDepth, showingContextFloors }: { width: number; length: number; gridSize: number; showGrid: boolean; shadowsEnabled: boolean; lowerFloorDepth: number; showingContextFloors: boolean }) {
  const gridRef = useRef<THREE.Mesh>(null)
  useEffect(() => {
    if (!gridRef.current) return
    const materials = Array.isArray(gridRef.current.material) ? gridRef.current.material : [gridRef.current.material]
    materials.forEach((material) => { material.depthWrite = false })
  }, [showGrid])
  return (
    <>
      <color attach="background" args={['#d6d9d6']} />
      <fog attach="fog" args={['#d6d9d6', 30, 76]} />
      <ambientLight intensity={0.9} color="#ffffff" />
      <hemisphereLight args={['#ffffff', '#777c77', 1.45]} />
      <directionalLight
        castShadow={shadowsEnabled}
        color="#fffdf5"
        intensity={2.4}
        position={[10, 16, 8]}
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-camera-near={1}
        shadow-camera-far={48}
        shadow-camera-left={-18}
        shadow-camera-right={18}
        shadow-camera-top={18}
        shadow-camera-bottom={-18}
        shadow-bias={-0.00015}
      />
      <directionalLight color="#b9c6cb" intensity={0.72} position={[-10, 7, -12]} />
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, showingContextFloors ? -lowerFloorDepth - 0.08 : -0.016, 0]} receiveShadow>
        <planeGeometry args={[80, 80]} />
        <meshStandardMaterial color="#c8cbc8" metalness={0.03} roughness={0.92} />
      </mesh>
      {showingContextFloors ? (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[width / 2, 0.002, length / 2]} renderOrder={1}>
          <planeGeometry args={[width, length]} />
          <meshStandardMaterial
            color="#e4e6e2"
            metalness={0.04}
            roughness={0.82}
            transparent
            opacity={0.14}
            depthWrite={false}
            side={THREE.DoubleSide}
          />
          <Edges color="#d3a900" opacity={0.58} transparent />
        </mesh>
      ) : (
        <mesh position={[width / 2, -0.02, length / 2]} receiveShadow>
          <boxGeometry args={[width, 0.12, length]} />
          <meshStandardMaterial color="#e4e6e2" metalness={0.04} roughness={0.82} />
          <Edges color="#d3a900" opacity={0.88} transparent />
        </mesh>
      )}
      {showGrid ? (
        <Grid
          ref={gridRef}
          args={[width, length]}
          position={[width / 2, 0.048, length / 2]}
          renderOrder={4}
          cellSize={gridSize}
          cellThickness={0.8}
          cellColor="#a8aca7"
          sectionSize={gridSize * 5}
          sectionThickness={1.4}
          sectionColor="#747974"
          fadeDistance={80}
          fadeStrength={0}
          followCamera={false}
        />
      ) : null}
      <PlotMarkings width={width} length={length} />
      {shadowsEnabled && !showingContextFloors ? (
        <ContactShadows
          position={[0, 0.012, 0]}
          opacity={0.34}
          scale={38}
          blur={2.4}
          far={13}
          resolution={512}
          color="#50534f"
        />
      ) : null}
    </>
  )
}

function PlacementGhost({ preview }: { preview: PlacementPreview }) {
  const color = preview.valid === false ? '#c64c51' : '#efbd24'
  if (preview.kind === 'facility' && preview.point && preview.footprint) {
    const kind = preview.objectKind ?? 'machine'
    const lift = kind === 'drone' ? 2.15 : 0
    const targetSize: Vector3Tuple = kind === 'shelf'
      ? [SHELF_LAYOUT.visualWidthM, SHELF_LAYOUT.visualHeightM, SHELF_LAYOUT.visualDepthM]
      : kind === 'rack'
      ? [preview.footprint.width * 0.9, preview.footprint.width * 0.8, preview.footprint.depth * 0.9]
      : kind === 'agv'
        ? [3.5, 2.1, 2.9]
        : kind === 'drone'
          ? [2.6, 2.4, 2.6]
          : kind === 'machine'
            ? [preview.footprint.width * 0.9, preview.footprint.width * 0.8, preview.footprint.depth * 0.9]
            : [preview.footprint.width * 0.8, 1, preview.footprint.depth * 0.8]
    const url = assetUrl(preview.modelRef)
    return (
      <group position={[preview.point.x, lift, preview.point.z]} rotation={[0, THREE.MathUtils.degToRad(preview.rotationY ?? 0), 0]}>
        {url ? (
          <RuntimeAsset
            url={url}
            targetSize={targetSize}
            fit={kind === 'machine' || kind === 'rack' || kind === 'shelf' ? 'stretch' : 'contain'}
            intrinsicRotationY={kind === 'shelf'
              ? Math.PI / 2
              : kind === 'drone'
                ? COUNT_INFINITY_DRONE_INTRINSIC_ROTATION_Y
                : 0}
            extractNodeName={kind === 'agv' ? 'GeoContainer_572__16_36' : undefined}
            fallback={<GhostFallback kind={kind} color={color} />}
          />
        ) : <GhostFallback kind={kind} color={color} />}
        <mesh position={[0, 0.1 - lift, 0]}>
          <boxGeometry args={[preview.footprint.width, 0.16, preview.footprint.depth]} />
          <meshBasicMaterial color={color} transparent opacity={0.26} depthWrite={false} />
          <Edges color={color} opacity={0.98} transparent />
        </mesh>
      </group>
    )
  }
  if (preview.kind === 'conveyor' && preview.path && preview.path.length === 1) {
    return (
      <mesh position={[preview.path[0].x, 0.13, preview.path[0].z]}>
        <boxGeometry args={[0.88, 0.16, 0.88]} />
        <meshBasicMaterial color={color} transparent opacity={0.38} depthWrite={false} />
        <Edges color={color} opacity={0.98} transparent />
      </mesh>
    )
  }
  if (preview.kind === 'conveyor' && preview.path && preview.path.length >= 2) {
    if (preview.conveyorType === 'incline') {
      const start = preview.path[0]
      const end = preview.path.at(-1)!
      const startY = preview.fromY ?? 0
      const endY = preview.toY ?? 0
      const direction = new THREE.Vector3(end.x - start.x, endY - startY, end.z - start.z)
      const length = Math.max(0.08, direction.length())
      const quaternion = stableConveyorQuaternion(direction)
      return (
        <group>
          <mesh
            position={[(start.x + end.x) / 2, (startY + endY) / 2 + 0.18, (start.z + end.z) / 2]}
            quaternion={quaternion}
          >
            <boxGeometry args={[length, 0.24, 1]} />
            <meshBasicMaterial color={color} transparent opacity={0.5} depthWrite={false} />
            <Edges color={color} opacity={0.98} transparent />
          </mesh>
        </group>
      )
    }
    const segments = trimPathForCorners(preview.path, 0.5)
    return (
      <group>
        {segments.map((segment) => {
          const dx = segment.end.x - segment.start.x
          const dz = segment.end.z - segment.start.z
          return (
            <mesh key={segment.sourceIndex} position={[(segment.start.x + segment.end.x) / 2, 0.18, (segment.start.z + segment.end.z) / 2]} rotation={[0, -Math.atan2(dz, dx), 0]}>
              <boxGeometry args={[Math.max(0.08, segment.length), 0.2, 1]} />
              <meshBasicMaterial color={color} transparent opacity={0.42} depthWrite={false} />
              <Edges color={color} opacity={0.95} transparent />
            </mesh>
          )
        })}
        {preview.path.slice(1, -1).map((corner, index) => (
          <mesh key={`turn-${index}`} position={[corner.x, 0.18, corner.z]}>
            <boxGeometry args={[1, 0.2, 1]} />
            <meshBasicMaterial color={color} transparent opacity={0.48} depthWrite={false} />
            <Edges color={color} opacity={0.98} transparent />
          </mesh>
        ))}
      </group>
    )
  }
  return null
}

function GhostFallback({ kind, color }: { kind: FactoryObjectKind; color: string }) {
  return (
    <mesh position={[0, kind === 'buffer' ? 0.18 : 0.65, 0]}>
      <boxGeometry args={kind === 'buffer' ? [1.4, 0.34, 1.4] : [1.4, 1.3, 1.2]} />
      <meshStandardMaterial color={color} roughness={0.55} metalness={0.22} transparent opacity={0.78} />
      <Edges color={color} opacity={0.95} transparent />
    </mesh>
  )
}

function WebGlFallback() {
  return (
    <div
      role="alert"
      style={{
        alignItems: 'center',
        background: 'linear-gradient(145deg, #eceeeb, #d9dcd8)',
        color: '#424440',
        display: 'flex',
        flexDirection: 'column',
        font: '13px/1.5 Inter, "Microsoft YaHei", sans-serif',
        height: '100%',
        justifyContent: 'center',
        padding: 24,
        textAlign: 'center',
        width: '100%',
      }}
    >
      <strong style={{ color: '#6c5700', fontSize: 15 }}>无法启动三维视图</strong>
      <span style={{ color: '#6f736f', marginTop: 6 }}>请开启浏览器 WebGL 硬件加速，或使用设备列表继续操作。</span>
    </div>
  )
}

export const FactoryScene = forwardRef<FactorySceneHandle, FactorySceneProps>(function FactoryScene({
  objects,
  items,
  inventory,
  simulation,
  floors,
  activeFloorId,
  floorVisibilityMode = 'current-only',
  enabledFloorIds = new Set(floors.map((floor) => floor.id)),
  factoryWidth,
  factoryLength,
  gridSize,
  placementPreview,
  interactionLocked = false,
  showGrid = true,
  showLabels = true,
  shadowsEnabled = true,
  selectedId,
  onSelect,
  onDragStart,
  simulationRunning = false,
  simTime = 0,
  className,
  ariaLabel = 'ForgeCore 三维工厂场景',
}: FactorySceneProps, ref) {
  const [contextLost, setContextLost] = useState(false)
  const sceneRuntime = useRef<{ camera: THREE.Camera; element: HTMLCanvasElement } | null>(null)
  const raycaster = useRef(new THREE.Raycaster())
  const groundPlane = useRef(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0))
  const controlsRef = useRef<OrbitControlsImpl>(null)
  const previousVisibleSpanRef = useRef(0)
  const singleFloorDistanceRef = useRef(24)
  const runtimeShadowsEnabled = shadowsEnabled && !simulationRunning
  const visibilityRange = floorVisibilityRange(floors, activeFloorId, floorVisibilityMode, enabledFloorIds)
  const { lowerDepthM: lowerFloorDepth, upperHeightM, verticalSpanM, centerOffsetM, hasContextFloors } = visibilityRange

  useEffect(() => {
    const controls = controlsRef.current
    if (!controls) return
    const previousSpan = previousVisibleSpanRef.current
    const currentOffset = controls.object.position.clone().sub(controls.target)
    const currentDistance = Math.max(4, currentOffset.length())
    if (previousSpan <= 0.001 && verticalSpanM > 0.001) singleFloorDistanceRef.current = currentDistance
    const target = new THREE.Vector3(factoryWidth / 2, 0.8 + centerOffsetM, factoryLength / 2)
    const desiredDistance = verticalSpanM > 0.001
      ? Math.max(currentDistance, 24 + verticalSpanM * 2.2)
      : singleFloorDistanceRef.current
    controls.target.copy(target)
    controls.object.position.copy(target).add(currentOffset.normalize().multiplyScalar(desiredDistance))
    controls.update()
    previousVisibleSpanRef.current = verticalSpanM
  }, [centerOffsetM, factoryLength, factoryWidth, verticalSpanM])

  useImperativeHandle(ref, () => ({
    screenToGrid: (clientX, clientY) => {
      const runtime = sceneRuntime.current
      if (!runtime) return null
      const rect = runtime.element.getBoundingClientRect()
      if (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) return null
      const pointer = new THREE.Vector2(
        ((clientX - rect.left) / rect.width) * 2 - 1,
        -((clientY - rect.top) / rect.height) * 2 + 1,
      )
      raycaster.current.setFromCamera(pointer, runtime.camera)
      const hit = new THREE.Vector3()
      if (!raycaster.current.ray.intersectPlane(groundPlane.current, hit)) return null
      if (hit.x < 0 || hit.z < 0 || hit.x > factoryWidth || hit.z > factoryLength) return null
      return {
        x: Math.round(hit.x / gridSize) * gridSize,
        z: Math.round(hit.z / gridSize) * gridSize,
      }
    },
  }), [factoryLength, factoryWidth, gridSize])

  return (
    <div
      className={className}
      role="region"
      aria-label={ariaLabel}
      aria-describedby="forgecore-scene-help"
      data-floor-visibility-mode={floorVisibilityMode}
      data-lower-floor-depth={lowerFloorDepth}
      data-upper-floor-height={upperHeightM}
      data-visible-floor-span={verticalSpanM}
      style={{
        background: '#d6d9d6',
        height: '100%',
        minHeight: 360,
        overflow: 'hidden',
        position: 'relative',
        width: '100%',
      }}
    >
      <span id="forgecore-scene-help" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>
        拖动空白区域旋转视角，滚轮缩放，点击建筑可选中；按住建筑并拖动可沿网格调整位置，冲突或越界时不会提交移动。
      </span>
      {contextLost ? (
        <WebGlFallback />
      ) : (
        <Canvas
          shadows={runtimeShadowsEnabled}
          dpr={simulationRunning ? [0.75, 1.15] : [1, 1.5]}
          performance={{ min: 0.6, debounce: 200 }}
          camera={{ position: [16, 17.5 + verticalSpanM * 1.3, 28 + verticalSpanM * 1.1], fov: 40, near: 0.1, far: 180 }}
          fallback={<WebGlFallback />}
          gl={{
            antialias: true,
            alpha: false,
            powerPreference: 'high-performance',
            preserveDrawingBuffer: false,
            toneMapping: THREE.ACESFilmicToneMapping,
            outputColorSpace: THREE.SRGBColorSpace,
          }}
          onCreated={({ gl, camera }) => {
            sceneRuntime.current = { camera, element: gl.domElement }
            gl.setClearColor('#d6d9d6')
            gl.domElement.addEventListener('webglcontextlost', (event) => {
              event.preventDefault()
              setContextLost(true)
            }, { once: true })
          }}
          onPointerMissed={() => { if (!interactionLocked) onSelect(null) }}
        >
          <Suspense fallback={<LoadingScene />}>
            <FactoryEnvironment width={factoryWidth} length={factoryLength} gridSize={gridSize} showGrid={showGrid} shadowsEnabled={runtimeShadowsEnabled} lowerFloorDepth={lowerFloorDepth} showingContextFloors={hasContextFloors} />
            {placementPreview ? <PlacementGhost preview={placementPreview} /> : null}
            <SceneObjects
              objects={objects}
              items={items}
              inventory={inventory}
              simulation={simulation}
              floors={floors}
              activeFloorId={activeFloorId}
              floorVisibilityMode={floorVisibilityMode}
              enabledFloorIds={enabledFloorIds}
              selectedId={selectedId}
              onSelect={onSelect}
              onDragStart={interactionLocked ? undefined : onDragStart}
              showLabels={showLabels}
              simulationRunning={simulationRunning}
              simTime={simTime}
            />
            <OrbitControls
              ref={controlsRef}
              makeDefault
              enabled={!interactionLocked}
              target={[factoryWidth / 2, 0.8 + centerOffsetM, factoryLength / 2]}
              enableDamping
              dampingFactor={0.075}
              minDistance={4}
              maxDistance={52}
              minPolarAngle={0.16}
              maxPolarAngle={Math.PI / 2.04}
              screenSpacePanning={false}
            />
            <GizmoHelper alignment="bottom-right" margin={[72, 72]}>
              <GizmoViewport
                axisColors={['#c6574d', '#4b9b70', '#577e9e']}
                labelColor="#2f312e"
              />
            </GizmoHelper>
          </Suspense>
        </Canvas>
      )}
    </div>
  )
})

export default FactoryScene
