import { memo, useLayoutEffect, useMemo, useRef } from 'react'
import { Edges, Html, Line } from '@react-three/drei'
import { useFrame, type ThreeEvent } from '@react-three/fiber'
import * as THREE from 'three'
import type { AgvRuntimeState, DroneNavigationPoint, DroneRuntimeState, FactoryObject, Floor, FloorVisibilityMode, InventoryRecord, Item, SimulationState, TransitItem } from '../../types'
import { coreItemModelUrl } from '../../data/coreItemModelPaths'
import { ParametricItemModel } from './ParametricItemModel'
import { RuntimeAsset, assetUrl } from './RuntimeAsset'
import { COUNT_INFINITY_DRONE_INTRINSIC_ROTATION_Y } from '../../data/runtimeAssetOrientation'
import { GENERIC_MACHINE_CHANNEL_LAYOUT, MACHINE_PORT_INDICES, MACHINE_PORT_LANE_OFFSETS_M, SHELF_LAYOUT, alignPathToPorts, compactPath, conveyorEndpointFloorId, conveyorPortAnchor, conveyorSpatialLength, directionAlongPath, directionAlongSpatialPath, facilityCenter, isOrthogonalConveyorTurn, kenneyCornerRotationY, pointAlongPath, pointAlongSpatialPath, polylineLength, trimPathForCorners, type GridFacilityBounds, type GridPoint } from '../../domain/conveyorPath'
import { agvRemainingRoutePoints } from '../../domain/agvRouteVisual'
import { conveyorFloorsVisible, floorObjectsVisible } from '../../domain/floorVisibility'

type Point = GridPoint
type Vector3Tuple = [number, number, number]

export interface SceneObjectsProps {
  objects: FactoryObject[]
  items: Item[]
  inventory: InventoryRecord[]
  simulation: SimulationState
  floors: Floor[]
  activeFloorId: string
  floorVisibilityMode?: FloorVisibilityMode
  enabledFloorIds?: ReadonlySet<string>
  selectedId?: string | null
  onSelect: (id: string | null) => void
  onDragStart?: (id: string, pointerId: number, clientX: number, clientY: number, captureTarget: HTMLElement | null) => void
  showLabels?: boolean
  simulationRunning?: boolean
  simTime?: number
}

const KENNEY_CONVEYOR = '/3d/vendor/kenney-factory-kit-3.0/Models/GLB format/conveyor-long-stripe-sides.glb'
const KENNEY_CONVEYOR_CORNER = '/3d/vendor/kenney-factory-kit-3.0/Models/GLB format/conveyor-stripe-corner.glb'
const KENNEY_MACHINE_FORTIFIED = '/3d/vendor/kenney-factory-kit-3.0/Models/GLB format/machine-fortified.glb'
const KENNEY_WAREHOUSE_WINDOW = '/3d/vendor/kenney-factory-kit-3.0/Models/GLB format/machine-window.glb'
const MASTJIE_SHELF = '/3d/vendor/mastjie-low-poly-warehouse-kit/glb/rack.glb'
const KENNEY_BOX_SMALL = '/3d/vendor/kenney-factory-kit-3.0/Models/GLB format/box-small.glb'
const KENNEY_BOX_WIDE = '/3d/vendor/kenney-factory-kit-3.0/Models/GLB format/box-wide.glb'
const CONVEYOR_CORNER_SIZE = 1
const CONVEYOR_CORNER_HALF = CONVEYOR_CORNER_SIZE / 2
const CONVEYOR_OVERLAP = 0.04
const LOWER_FLOOR_OPACITY = 0.24
const VEHICLE_ROUTE_SELECTED_OPACITY = 0.58
const VEHICLE_ROUTE_UNSELECTED_OPACITY = 0.34
const VEHICLE_ROUTE_BASE_SELECTED_OPACITY = 0.16
const VEHICLE_ROUTE_BASE_UNSELECTED_OPACITY = 0.09

interface LayerMaterialBase {
  opacity: number
  transparent: boolean
  depthWrite: boolean
}

function applyLayerOpacity(root: THREE.Group, opacity: number, renderThroughFloor: boolean): void {
  root.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return
    const owned = child.userData.forgeCoreLayerMaterials === true
    if (!owned && opacity >= 0.999 && !renderThroughFloor) return
    if (!owned) {
      const cloneMaterial = (material: THREE.Material) => {
        const clone = material.clone()
        clone.userData = {
          ...clone.userData,
          forgeCoreLayerBase: {
            opacity: material.opacity,
            transparent: material.transparent,
            depthWrite: material.depthWrite,
          } satisfies LayerMaterialBase,
        }
        return clone
      }
      child.material = Array.isArray(child.material)
        ? child.material.map(cloneMaterial)
        : cloneMaterial(child.material)
      child.userData.forgeCoreLayerMaterials = true
      child.userData.forgeCoreLayerCastShadow = child.castShadow
      child.userData.forgeCoreLayerReceiveShadow = child.receiveShadow
      child.userData.forgeCoreLayerRenderOrder = child.renderOrder
    }
    const materials = Array.isArray(child.material) ? child.material : [child.material]
    materials.forEach((material) => {
      const base = material.userData.forgeCoreLayerBase as LayerMaterialBase | undefined
      if (!base) return
      material.opacity = base.opacity * opacity
      material.transparent = base.transparent || opacity < 0.999 || renderThroughFloor
      material.depthWrite = opacity >= 0.999 && !renderThroughFloor ? base.depthWrite : false
      material.needsUpdate = true
    })
    child.castShadow = opacity >= 0.999 && child.userData.forgeCoreLayerCastShadow === true
    child.receiveShadow = opacity >= 0.999 && child.userData.forgeCoreLayerReceiveShadow === true
    child.renderOrder = renderThroughFloor
      ? 20
      : opacity < 0.999
        ? 10
        : (child.userData.forgeCoreLayerRenderOrder as number | undefined) ?? 0
  })
}

function useLayerOpacity(groupRef: React.RefObject<THREE.Group | null>, opacity: number, renderThroughFloor = false): void {
  const needsSyncRef = useRef(opacity < 0.999 || renderThroughFloor)
  const previousAppearanceRef = useRef({ opacity, renderThroughFloor })
  const previousAppearance = previousAppearanceRef.current
  if (opacity < 0.999 || renderThroughFloor || previousAppearance.opacity !== opacity || previousAppearance.renderThroughFloor !== renderThroughFloor) {
    needsSyncRef.current = true
  }
  previousAppearanceRef.current = { opacity, renderThroughFloor }
  useFrame(() => {
    if (!needsSyncRef.current || !groupRef.current) return
    applyLayerOpacity(groupRef.current, opacity, renderThroughFloor)
    if (opacity >= 0.999 && !renderThroughFloor) needsSyncRef.current = false
  })
}

function stableConveyorQuaternion(directionValue: { x: number; y: number; z: number }): THREE.Quaternion {
  const forward = new THREE.Vector3(directionValue.x, directionValue.y, directionValue.z).normalize()
  const width = new THREE.Vector3(-forward.z, 0, forward.x).normalize()
  const up = new THREE.Vector3().crossVectors(width, forward).normalize()
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(forward, up, width))
}
function objectBounds(object: FactoryObject): GridFacilityBounds {
  return { x: object.transform.x, z: object.transform.z, width: object.footprint.width, depth: object.footprint.depth }
}

function objectCenter(object: FactoryObject): Point {
  return facilityCenter(objectBounds(object))
}

function floorElevation(floors: Floor[], floorId: string): number {
  return floors.find((floor) => floor.id === floorId)?.elevationM ?? 0
}

function conveyorRelativeElevations(object: FactoryObject, floors: Floor[], activeFloorId: string): [number, number] {
  if (object.config.kind !== 'conveyor') return [0, 0]
  const activeElevation = floorElevation(floors, activeFloorId)
  const fromFloorId = conveyorEndpointFloorId({ floorId: object.floorId, config: object.config }, 'start')
  const toFloorId = conveyorEndpointFloorId({ floorId: object.floorId, config: object.config }, 'end')
  return [floorElevation(floors, fromFloorId) - activeElevation, floorElevation(floors, toFloorId) - activeElevation]
}

export function conveyorPath(object: FactoryObject, objects: FactoryObject[]): Point[] {
  if (object.config.kind !== 'conveyor') return []
  const config = object.config
  const source = objects.find((candidate) => candidate.id === config.fromObjectId && candidate.config.kind !== 'conveyor')
  const target = config.toObjectId === 'finished-goods'
    ? null
    : objects.find((candidate) => candidate.id === config.toObjectId && candidate.config.kind !== 'conveyor')
  if (source && target) {
    const sourceCenter = objectCenter(source)
    const targetCenter = objectCenter(target)
    const start = conveyorPortAnchor(source, 'output', config.path[1] ?? targetCenter, config.fromPortIndex ?? 1)
    const end = conveyorPortAnchor(target, 'input', config.path.at(-2) ?? sourceCenter, config.toPortIndex ?? 1)
    return alignPathToPorts(config.path, start, end)
  }
  if (source && config.toObjectId === 'finished-goods') {
    const end = config.path.at(-1) ?? { x: source.transform.x + source.footprint.width + 6, z: objectCenter(source).z }
    const start = conveyorPortAnchor(source, 'output', end, config.fromPortIndex ?? 1)
    return alignPathToPorts(config.path.length >= 2 ? config.path : [start, end], start)
  }
  if (source) {
    const end = config.path.at(-1) ?? objectCenter(source)
    const start = conveyorPortAnchor(source, 'output', config.path[1] ?? end, config.fromPortIndex ?? 1)
    return alignPathToPorts(config.path, start)
  }
  if (target) {
    const start = config.path[0] ?? objectCenter(target)
    const end = conveyorPortAnchor(target, 'input', config.path.at(-2) ?? start, config.toPortIndex ?? 1)
    return alignPathToPorts(config.path, null, end)
  }
  return config.path.length >= 2 ? compactPath(config.path) : []
}

interface ConveyorJointCorner {
  previous: Point
  corner: Point
  next: Point
}

function sameHorizontalPoint(left: Point | undefined, right: Point | undefined): boolean {
  return Boolean(left && right && Math.abs(left.x - right.x) <= 0.0001 && Math.abs(left.z - right.z) <= 0.0001)
}

function conveyorJointCorner(
  object: FactoryObject,
  path: Point[],
  objects: FactoryObject[],
  endpoint: 'start' | 'end',
): ConveyorJointCorner | null {
  if (object.config.kind !== 'conveyor') return null
  const neighborId = endpoint === 'start' ? object.config.fromObjectId : object.config.toObjectId
  const neighbor = objects.find((candidate) => candidate.id === neighborId && candidate.config.kind === 'conveyor')
  if (!neighbor) return null
  const neighborPath = conveyorPath(neighbor, objects)
  const corner = endpoint === 'start' ? path[0] : path.at(-1)
  const neighborEndpoint = endpoint === 'start' ? neighborPath.at(-1) : neighborPath[0]
  const previous = endpoint === 'start' ? neighborPath.at(-2) : path.at(-2)
  const next = endpoint === 'start' ? path[1] : neighborPath[1]
  if (!corner || !sameHorizontalPoint(corner, neighborEndpoint) || !previous || !next) return null
  return isOrthogonalConveyorTurn(previous, corner, next) ? { previous, corner, next } : null
}

function FallbackBody({ kind }: { kind: FactoryObject['kind'] }) {
  const color = kind === 'rack' ? '#a4a7a3' : kind === 'shelf' ? '#69716b' : kind === 'buffer' ? '#d6d5ce' : '#656762'
  return (
    <mesh position={[0, kind === 'buffer' ? 0.18 : 0.65, 0]} castShadow receiveShadow>
      <boxGeometry args={kind === 'buffer' ? [1.4, 0.34, 1.4] : [1.4, 1.3, 1.2]} />
      <meshStandardMaterial color={color} roughness={0.55} metalness={0.28} />
      <Edges color="#f1bf2b" opacity={0.55} transparent />
    </mesh>
  )
}

function SelectionMarker({ object, showLabel }: { object: FactoryObject; showLabel: boolean }) {
  const width = object.footprint.width * 0.54
  const depth = object.footprint.depth * 0.54
  return (
    <>
      <mesh position={[0, 0.025, 0]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={5}>
        <ringGeometry args={[Math.max(width, depth), Math.max(width, depth) + 0.07, 48]} />
        <meshBasicMaterial color="#f2bb21" transparent opacity={0.95} depthWrite={false} />
      </mesh>
      {showLabel ? (
        <Html center position={[0, object.kind === 'drone' ? 3.25 : object.kind === 'shelf' ? 6.55 : object.kind === 'machine' || object.kind === 'rack' ? object.footprint.width * 1.02 : 2.55, 0]} distanceFactor={12} style={{ pointerEvents: 'none' }}>
          <div className="scene-object-label"><strong>{object.name}</strong><span>{object.status === 'planned' ? '视觉已加载 · 仿真待接入' : '已连接到业务对象'}</span></div>
        </Html>
      ) : null}
    </>
  )
}

function dampAngle(current: number, target: number, delta: number, speed = 14): number {
  const difference = Math.atan2(Math.sin(target - current), Math.cos(target - current))
  return current + difference * (1 - Math.exp(-speed * delta))
}

function InternalFlowMarkers({
  conveyorLength,
  countPerLane,
  active,
  simTime,
  simulationSpeed,
  warehouse = false,
}: {
  conveyorLength: number
  countPerLane: number
  active: boolean
  simTime: number
  simulationSpeed: number
  warehouse?: boolean
}) {
  const meshRef = useRef<THREE.InstancedMesh>(null)
  const totalCount = MACHINE_PORT_INDICES.length * countPerLane
  const phaseRate = 0.72
  const phaseRef = useRef<number[]>([])
  if (phaseRef.current.length !== totalCount) {
    phaseRef.current = Array.from({ length: totalCount }, (_, index) => ((index % countPerLane) / countPerLane + simTime * phaseRate) % 1)
  }
  const lastSimTimeRef = useRef(simTime)
  if (simTime < lastSimTimeRef.current - 0.001) {
    phaseRef.current = Array.from({ length: totalCount }, (_, index) => ((index % countPerLane) / countPerLane + simTime * phaseRate) % 1)
  }
  lastSimTimeRef.current = simTime
  const dummy = useMemo(() => new THREE.Object3D(), [])
  useFrame((_, delta) => {
    const mesh = meshRef.current
    if (!mesh) return
    const frameStep = Math.min(delta, 0.1) * simulationSpeed * phaseRate
    phaseRef.current.forEach((phase, index) => {
      const nextPhase = active ? (phase + frameStep) % 1 : phase
      phaseRef.current[index] = nextPhase
      const laneIndex = Math.floor(index / countPerLane)
      const portIndex = MACHINE_PORT_INDICES[laneIndex]
      dummy.position.set(-conveyorLength / 2 + nextPhase * conveyorLength, 0.42, MACHINE_PORT_LANE_OFFSETS_M[portIndex])
      dummy.updateMatrix()
      mesh.setMatrixAt(index, dummy.matrix)
    })
    mesh.instanceMatrix.needsUpdate = true
  })
  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, totalCount]} castShadow>
      <boxGeometry args={[warehouse ? 0.2 : 0.22, warehouse ? 0.05 : 0.055, warehouse ? 0.46 : 0.5]} />
      <meshStandardMaterial color="#f2c338" emissive={warehouse ? '#9b6900' : '#b87b00'} emissiveIntensity={active ? (warehouse ? 1.1 : 1.35) : (warehouse ? 0.1 : 0.12)} />
    </instancedMesh>
  )
}

function MachineRuntimeVisual({
  object,
  active,
  simTime,
  simulationSpeed,
  showLabels,
}: {
  object: FactoryObject
  active: boolean
  simTime: number
  simulationSpeed: number
  showLabels: boolean
}) {
  // The 6×6 shell carries three one-metre lanes. Each logical port is aligned
  // to its own lane while the enlarged soft curtain still covers the opening.
  const conveyorLength = GENERIC_MACHINE_CHANNEL_LAYOUT.internalConveyorLengthM
  const curtainOffset = GENERIC_MACHINE_CHANNEL_LAYOUT.curtainOffsetM
  const curtainOffsets = Array.from({ length: 11 }, (_, index) => (index - 5) * 0.315)

  return (
    <group name={`machine-runtime-${object.id}`}>
      {MACHINE_PORT_INDICES.map((portIndex) => {
        const laneZ = MACHINE_PORT_LANE_OFFSETS_M[portIndex]
        return (
          <group key={`internal-lane-${portIndex}`} position={[0, 0.035, laneZ]}>
            <RuntimeAsset
              url={KENNEY_CONVEYOR}
              targetSize={[conveyorLength, 0.4, 0.88]}
              fit="stretch"
              fallback={<FallbackConveyor length={conveyorLength} />}
            />
          </group>
        )
      })}

      {[-1, 1].map((side) => (
        <group key={`curtain-${side}`} position={[side * curtainOffset, 1.59, 0]}>
          {curtainOffsets.map((z, index) => (
            <mesh key={z} position={[0, index % 2 === 0 ? 0 : -0.04, z]} castShadow>
              <boxGeometry args={[0.12, 2.34, 0.3]} />
              <meshStandardMaterial color="#111312" roughness={0.88} metalness={0.04} />
            </mesh>
          ))}
        </group>
      ))}

      <InternalFlowMarkers conveyorLength={conveyorLength} countPerLane={5} active={active} simTime={simTime} simulationSpeed={simulationSpeed} />

      <mesh position={[0, 1.3, 0]}>
        <boxGeometry args={[1.1, 1.08, 2.8]} />
        <meshStandardMaterial
          color={active ? '#e1282f' : '#5c3032'}
          emissive="#ef2028"
          emissiveIntensity={active ? 3.8 : 0.04}
          transparent
          opacity={active ? 0.72 : 0.16}
        />
      </mesh>
      <mesh position={[0, 4.95, 0]} castShadow>
        <cylinderGeometry args={[0.2, 0.27, 0.24, 24]} />
        <meshStandardMaterial color={active ? '#ff343b' : '#4f2f31'} emissive="#ff1f28" emissiveIntensity={active ? 4.5 : 0.06} />
      </mesh>
      {active ? <pointLight position={[0, 2, 0]} color="#ff3038" intensity={6.8} distance={6.8} decay={2} /> : null}

      <group position={[0, 5.52, 0]}>
        <mesh position={[-0.18, 0, 0]} castShadow>
          <boxGeometry args={[3.18, 0.2, 0.2]} />
          <meshStandardMaterial color="#f2c438" emissive="#9a6a00" emissiveIntensity={0.28} />
        </mesh>
        <mesh position={[1.59, 0, 0]} rotation={[0, 0, -Math.PI / 2]} castShadow>
          <coneGeometry args={[0.42, 0.87, 20]} />
          <meshStandardMaterial color="#f2c438" emissive="#9a6a00" emissiveIntensity={0.28} />
        </mesh>
      </group>
      {showLabels ? MACHINE_PORT_INDICES.flatMap((portIndex) => {
        const laneZ = MACHINE_PORT_LANE_OFFSETS_M[portIndex]
        return [
          <Html key={`input-label-${portIndex}`} center position={[-curtainOffset, 3.75, laneZ]} distanceFactor={16} style={{ pointerEvents: 'none' }}>
            <span className="machine-port-label machine-port-label--input">入料口 {portIndex + 1}</span>
          </Html>,
          <Html key={`output-label-${portIndex}`} center position={[curtainOffset, 3.75, laneZ]} distanceFactor={16} style={{ pointerEvents: 'none' }}>
            <span className="machine-port-label machine-port-label--output">出货口 {portIndex + 1}</span>
          </Html>,
        ]
      }) : null}
    </group>
  )
}

function WarehouseRuntimeVisual({
  object,
  active,
  simTime,
  simulationSpeed,
  showLabels,
  inventory,
  items,
}: {
  object: FactoryObject
  active: boolean
  simTime: number
  simulationSpeed: number
  showLabels: boolean
  inventory: InventoryRecord[]
  items: Item[]
}) {
  const conveyorLength = GENERIC_MACHINE_CHANNEL_LAYOUT.internalConveyorLengthM
  const curtainOffset = GENERIC_MACHINE_CHANNEL_LAYOUT.curtainOffsetM
  const curtainOffsets = Array.from({ length: 11 }, (_, index) => (index - 5) * 0.315)
  const cartonPositions = MACHINE_PORT_INDICES.flatMap((portIndex) =>
    [-1.42, -0.72, 0, 0.72, 1.42].map((x, column) => ({
      x,
      z: MACHINE_PORT_LANE_OFFSETS_M[portIndex],
      column,
      portIndex,
    })),
  )
  const stockRecords = inventory.filter((record) => record.locationType === 'rack-slot' && record.locationId.startsWith(`${object.id}:`))
  const stockTotal = stockRecords.reduce((sum, record) => sum + record.quantity, 0)
  const availableRecords = stockRecords.filter((record) => record.quantity > 0 || record.infiniteSupply)
  const infiniteKinds = availableRecords.filter((record) => record.infiniteSupply).length
  const stockContents = availableRecords.map((record) => {
    const name = items.find((item) => item.id === record.itemId)?.name ?? record.itemId
    return `${name}${record.infiniteSupply ? ' ∞' : ` ×${record.quantity}`}`
  })

  return (
    <group name={`warehouse-runtime-${object.id}`}>
      {MACHINE_PORT_INDICES.map((portIndex) => (
        <group key={`warehouse-lane-${portIndex}`} position={[0, 0.035, MACHINE_PORT_LANE_OFFSETS_M[portIndex]]}>
          <RuntimeAsset
            url={KENNEY_CONVEYOR}
            targetSize={[conveyorLength, 0.4, 0.88]}
            fit="stretch"
            fallback={<FallbackConveyor length={conveyorLength} />}
          />
        </group>
      ))}

      {cartonPositions.map(({ x, z, column, portIndex }) => (
        <group key={`warehouse-carton-${portIndex}-${column}`} position={[x, 0.46 + (column % 2) * 0.04, z]} rotation={[0, (column % 3 - 1) * 0.08, 0]}>
          <RuntimeAsset
            url={(column + portIndex) % 2 === 0 ? KENNEY_BOX_SMALL : KENNEY_BOX_WIDE}
            targetSize={(column + portIndex) % 2 === 0 ? [0.62, 0.58, 0.62] : [0.68, 0.56, 0.58]}
            fit="contain"
            fallback={<FallbackCargo />}
          />
        </group>
      ))}

      {[-1, 1].map((side) => (
        <group key={`warehouse-curtain-${side}`} position={[side * curtainOffset, 1.59, 0]}>
          {curtainOffsets.map((z, index) => (
            <mesh key={z} position={[0, index % 2 === 0 ? 0 : -0.04, z]} castShadow>
              <boxGeometry args={[0.12, 2.34, 0.3]} />
              <meshStandardMaterial color="#101211" roughness={0.9} metalness={0.03} />
            </mesh>
          ))}
        </group>
      ))}

      <InternalFlowMarkers conveyorLength={conveyorLength} countPerLane={4} active={active} simTime={simTime} simulationSpeed={simulationSpeed} warehouse />

      {showLabels ? (
        <Html center position={[0, 5.12, 0]} distanceFactor={14} style={{ pointerEvents: 'none' }}>
          <span className="warehouse-stock-label">
            <strong>库存 {stockTotal} 件{infiniteKinds > 0 ? ` · ${infiniteKinds} 项无限` : ''}</strong>
            <small>{stockContents.length > 0 ? `${stockContents.slice(0, 2).join(' · ')}${stockContents.length > 2 ? ` · +${stockContents.length - 2}` : ''}` : '当前为空仓'}</small>
          </span>
        </Html>
      ) : null}
      {showLabels ? MACHINE_PORT_INDICES.flatMap((portIndex) => {
        const laneZ = MACHINE_PORT_LANE_OFFSETS_M[portIndex]
        return [
          <Html key={`warehouse-input-${portIndex}`} center position={[-curtainOffset, 3.75, laneZ]} distanceFactor={16} style={{ pointerEvents: 'none' }}>
            <span className="machine-port-label machine-port-label--input">入货口 {portIndex + 1}</span>
          </Html>,
          <Html key={`warehouse-output-${portIndex}`} center position={[curtainOffset, 3.75, laneZ]} distanceFactor={16} style={{ pointerEvents: 'none' }}>
            <span className="machine-port-label machine-port-label--output">出货口 {portIndex + 1}</span>
          </Html>,
        ]
      }) : null}
    </group>
  )
}

function ShelfRuntimeVisual({
  object,
  showLabels,
  inventory,
  items,
}: {
  object: FactoryObject
  showLabels: boolean
  inventory: InventoryRecord[]
  items: Item[]
}) {
  // rack.glb's four upward-facing shelf surfaces land at these local Y values
  // after its explicit 7.2 × 5.4 × 1.8m runtime fit. Cargo assets are
  // ground-centered, so placing their groups at the surface height keeps every
  // box resting on a board instead of floating in front of the rack.
  const cargoPositions = [-2.7, -1.35, 0, 1.35, 2.7].flatMap((x, column) =>
    [-0.38, 0.38].flatMap((z, row) =>
      [0.09, 1.72, 3.4, 5.09].map((y, level) => ({ x, y, z, column, row, level })),
    ),
  )
  const stockRecords = inventory.filter((record) => record.locationType === 'rack-slot' && record.locationId.startsWith(`${object.id}:`))
  const stockTotal = stockRecords.reduce((sum, record) => sum + record.quantity, 0)
  const availableRecords = stockRecords.filter((record) => record.quantity > 0 || record.infiniteSupply)
  const infiniteKinds = availableRecords.filter((record) => record.infiniteSupply).length
  const stockContents = availableRecords.map((record) => {
    const name = items.find((item) => item.id === record.itemId)?.name ?? record.itemId
    return `${name}${record.infiniteSupply ? ' ∞' : ` ×${record.quantity}`}`
  })
  return (
    <group name={`shelf-runtime-${object.id}`}>
      {cargoPositions.map(({ x, y, z, column, row, level }) => {
        const wide = (column + row + level) % 3 === 0
        return (
          <group key={`shelf-cargo-${column}-${row}-${level}`} position={[x, y, z]} rotation={[0, ((column + level) % 3 - 1) * 0.055, 0]}>
            <RuntimeAsset
              url={wide ? KENNEY_BOX_WIDE : KENNEY_BOX_SMALL}
              targetSize={wide ? [0.92, 0.62, 0.72] : [0.78, 0.64, 0.68]}
              fit="contain"
              fallback={<FallbackCargo />}
            />
          </group>
        )
      })}
      {showLabels ? (
        <Html center position={[0, 6.2, 0]} distanceFactor={14} style={{ pointerEvents: 'none' }}>
          <span className="warehouse-stock-label">
            <strong>货架 {stockTotal} 件{infiniteKinds > 0 ? ` · ${infiniteKinds} 项无限` : ''}</strong>
            <small>{stockContents.length > 0 ? `${stockContents.slice(0, 2).join(' · ')}${stockContents.length > 2 ? ` · +${stockContents.length - 2}` : ''}` : '无限堆叠 · 当前未登记库存'}</small>
          </span>
        </Html>
      ) : null}
    </group>
  )
}

function RuntimeObject({
  object,
  selected,
  onSelect,
  onDragStart,
  showLabels,
  simTime,
  simulation,
  inventory,
  items,
  simulationRunning,
  floorY,
  activeElevation,
  opacity,
  interactive,
}: {
  object: FactoryObject
  selected: boolean
  onSelect: (id: string | null) => void
  onDragStart?: SceneObjectsProps['onDragStart']
  showLabels: boolean
  simTime: number
  simulation: SimulationState
  inventory: InventoryRecord[]
  items: Item[]
  simulationRunning: boolean
  floorY: number
  activeElevation: number
  opacity: number
  interactive: boolean
}) {
  const groupRef = useRef<THREE.Group>(null)
  useLayerOpacity(groupRef, opacity)
  const center = objectCenter(object)
  const agvRuntime = object.kind === 'agv' ? simulation.agvRuntime?.[object.id] : undefined
  const droneRuntime = object.kind === 'drone' ? simulation.droneRuntime?.[object.id] : undefined
  const initialVehiclePositionRef = useRef<Vector3Tuple>([
    agvRuntime?.position.x ?? droneRuntime?.position.x ?? center.x,
    droneRuntime ? droneRuntime.position.y - activeElevation : floorY,
    agvRuntime?.position.z ?? droneRuntime?.position.z ?? center.z,
  ])
  const initialVehicleRotationRef = useRef<[number, number, number]>([0, agvRuntime?.headingY ?? droneRuntime?.headingY ?? THREE.MathUtils.degToRad(object.transform.rotationY), 0])
  const requestedUrl = object.kind === 'machine'
    ? KENNEY_MACHINE_FORTIFIED
    : object.kind === 'rack'
      ? KENNEY_WAREHOUSE_WINDOW
      : object.kind === 'shelf'
        ? MASTJIE_SHELF
      : assetUrl(object.modelRef)
  const adapter = useMemo<{
    size: Vector3Tuple
    fit: 'contain' | 'stretch'
    intrinsicRotationY?: number
    extractNodeName?: string
  }>(() => {
    switch (object.kind) {
      case 'rack':
        return { size: [object.footprint.width * 0.9, object.footprint.width * 0.8, object.footprint.depth * 0.9], fit: 'stretch' }
      case 'shelf':
        return { size: [SHELF_LAYOUT.visualWidthM, SHELF_LAYOUT.visualHeightM, SHELF_LAYOUT.visualDepthM], fit: 'stretch', intrinsicRotationY: Math.PI / 2 }
      case 'agv':
        return { size: [3.5, 2.1, 2.9], fit: 'contain', extractNodeName: 'GeoContainer_572__16_36' }
      case 'drone':
        return { size: [2.6, 2.4, 2.6], fit: 'contain', intrinsicRotationY: COUNT_INFINITY_DRONE_INTRINSIC_ROTATION_Y }
      case 'machine':
        return { size: [object.footprint.width * 0.9, object.footprint.width * 0.8, object.footprint.depth * 0.9], fit: 'stretch' }
      default:
        return { size: [object.footprint.width * 0.8, 1, object.footprint.depth * 0.8], fit: 'contain' }
    }
  }, [object.footprint.depth, object.footprint.width, object.kind])
  const lift = object.kind === 'drone' ? 2.15 + Math.sin(simTime * 1.4) * 0.04 : 0
  const rotation = THREE.MathUtils.degToRad(object.transform.rotationY)
  const machineRuntime = object.kind === 'machine' ? simulation.machineRuntime[object.id] : undefined
  const machineActive = simulationRunning && machineRuntime?.state === 'processing'
  const warehouseActive = simulationRunning && simulation.transitItems.some((transit) => transit.fromObjectId === object.id || transit.toObjectId === object.id)

  useFrame((_, delta) => {
    if ((object.kind !== 'agv' && object.kind !== 'drone') || !groupRef.current) return
    const target = agvRuntime?.position ?? droneRuntime?.position ?? center
    const frameDelta = Math.min(delta, 0.1)
    const positionFactor = 1 - Math.exp(-14 * frameDelta)
    groupRef.current.position.x = THREE.MathUtils.lerp(groupRef.current.position.x, target.x, positionFactor)
    groupRef.current.position.y = THREE.MathUtils.lerp(groupRef.current.position.y, droneRuntime ? droneRuntime.position.y - activeElevation : floorY, positionFactor)
    groupRef.current.position.z = THREE.MathUtils.lerp(groupRef.current.position.z, target.z, positionFactor)
    groupRef.current.rotation.y = dampAngle(groupRef.current.rotation.y, agvRuntime?.headingY ?? droneRuntime?.headingY ?? rotation, frameDelta, 12)
    groupRef.current.rotation.x = THREE.MathUtils.lerp(groupRef.current.rotation.x, droneRuntime ? -THREE.MathUtils.clamp(droneRuntime.pitch, -0.16, 0.16) : 0, positionFactor)
  })

  const click = (event: ThreeEvent<MouseEvent>) => {
    event.stopPropagation()
    onSelect(object.id)
  }

  return (
    <group
      ref={groupRef}
      position={object.kind === 'agv' || object.kind === 'drone' ? initialVehiclePositionRef.current : [center.x, floorY + lift, center.z]}
      rotation={object.kind === 'agv' || object.kind === 'drone' ? initialVehicleRotationRef.current : [0, rotation, 0]}
      onClick={interactive ? click : undefined}
      onPointerDown={interactive ? (event) => {
        if (event.button !== 0 || !onDragStart || ((object.kind === 'agv' || object.kind === 'drone') && simulationRunning)) return
        event.stopPropagation()
        onSelect(object.id)
        const nativeEvent = event.nativeEvent
        const captureTarget = nativeEvent.target instanceof HTMLElement ? nativeEvent.target : null
        onDragStart(object.id, event.pointerId, nativeEvent.clientX, nativeEvent.clientY, captureTarget)
      } : undefined}
      onPointerOver={interactive ? (event) => { event.stopPropagation(); document.body.style.cursor = selected ? 'grab' : 'pointer' } : undefined}
      onPointerOut={interactive ? () => { document.body.style.cursor = 'default' } : undefined}
    >
      {requestedUrl ? (
        <RuntimeAsset
          url={requestedUrl}
          targetSize={adapter.size}
          fit={adapter.fit}
          intrinsicRotationY={adapter.intrinsicRotationY}
          extractNodeName={adapter.extractNodeName}
          fallback={<FallbackBody kind={object.kind} />}
        />
      ) : <FallbackBody kind={object.kind} />}
      {object.kind === 'machine' ? <MachineRuntimeVisual object={object} active={machineActive} simTime={simTime} simulationSpeed={simulation.speed} showLabels={showLabels && interactive && selected} /> : null}
      {object.kind === 'rack' ? <WarehouseRuntimeVisual object={object} active={warehouseActive} simTime={simTime} simulationSpeed={simulation.speed} showLabels={showLabels && interactive && selected} inventory={inventory} items={items} /> : null}
      {object.kind === 'shelf' ? <ShelfRuntimeVisual object={object} showLabels={showLabels && interactive && selected} inventory={inventory} items={items} /> : null}
      {object.kind === 'agv' && agvRuntime?.cargoItemId && agvRuntime.cargoQuantity > 0 ? (
        <AgvCargoVisual runtime={agvRuntime} item={items.find((item) => item.id === agvRuntime.cargoItemId)} showLabel={showLabels && interactive} />
      ) : null}
      {object.kind === 'drone' && droneRuntime?.cargoItemId && droneRuntime.cargoQuantity > 0 ? (
        <DroneCargoVisual runtime={droneRuntime} item={items.find((item) => item.id === droneRuntime.cargoItemId)} showLabel={showLabels && interactive} />
      ) : null}
      {selected && interactive ? <SelectionMarker object={object} showLabel={showLabels} /> : null}
    </group>
  )
}

function AgvCargoVisual({ runtime, item, showLabel }: { runtime: AgvRuntimeState; item?: Item; showLabel: boolean }) {
  const modelId = item?.itemModelId
  const url = coreItemModelUrl(modelId)
  const hasParameterOverrides = Boolean(item && Object.keys(item.modelParameters).length > 0)
  return (
    <group position={[0, 1.65, 0]}>
      {item && hasParameterOverrides ? (
        <ParametricItemModel modelId={item.itemModelId} parameters={item.modelParameters} referenceTargetSize={[0.8, 0.62, 0.8]} fallback={<FallbackCargo />} />
      ) : url ? (
        <RuntimeAsset url={url} targetSize={[0.8, 0.62, 0.8]} fallback={<FallbackCargo />} />
      ) : <FallbackCargo />}
      {showLabel ? (
        <Html center position={[0, 0.82, 0]} distanceFactor={12} style={{ pointerEvents: 'none' }}>
          <span className="agv-cargo-label"><strong>{item?.name ?? runtime.cargoItemId}</strong><small>车载 ×{runtime.cargoQuantity}</small></span>
        </Html>
      ) : null}
    </group>
  )
}

function DroneCargoVisual({ runtime, item, showLabel }: { runtime: DroneRuntimeState; item?: Item; showLabel: boolean }) {
  const modelId = item?.itemModelId
  const url = coreItemModelUrl(modelId)
  const hasParameterOverrides = Boolean(item && Object.keys(item.modelParameters).length > 0)
  return (
    <group position={[0, -1.28, 0]}>
      {item && hasParameterOverrides ? (
        <ParametricItemModel modelId={item.itemModelId} parameters={item.modelParameters} referenceTargetSize={[0.58, 0.5, 0.58]} fallback={<FallbackCargo />} />
      ) : url ? (
        <RuntimeAsset url={url} targetSize={[0.58, 0.5, 0.58]} fallback={<FallbackCargo />} />
      ) : <FallbackCargo />}
      {showLabel ? (
        <Html center position={[0, -0.7, 0]} distanceFactor={12} style={{ pointerEvents: 'none' }}>
          <span className="agv-cargo-label"><strong>{item?.name ?? runtime.cargoItemId}</strong><small>空运 ×{runtime.cargoQuantity}</small></span>
        </Html>
      ) : null}
    </group>
  )
}

interface AgvRouteArrowMarker {
  key: string
  position: Vector3Tuple
  quaternion: THREE.Quaternion
}

function sampleRouteValues<T>(values: T[], maxCount: number): T[] {
  if (values.length <= maxCount) return values
  if (maxCount <= 1) return values.slice(-1)
  const sampled: T[] = []
  for (let index = 0; index < maxCount; index += 1) {
    sampled.push(values[Math.round(index * (values.length - 1) / (maxCount - 1))])
  }
  return sampled
}

function simplifyAgvRoutePoints(points: Point[]): Point[] {
  if (points.length <= 2) return points
  const simplified: Point[] = [points[0]]
  for (let index = 1; index < points.length - 1; index += 1) {
    const previous = simplified.at(-1)!
    const current = points[index]
    const next = points[index + 1]
    const ax = current.x - previous.x
    const az = current.z - previous.z
    const bx = next.x - current.x
    const bz = next.z - current.z
    const cross = ax * bz - az * bx
    const dot = ax * bx + az * bz
    if (Math.abs(cross) > 1e-5 || dot <= 0) simplified.push(current)
  }
  simplified.push(points.at(-1)!)
  return simplified
}

function simplifyDroneRoutePoints(points: DroneNavigationPoint[]): DroneNavigationPoint[] {
  if (points.length <= 2) return points
  const simplified: DroneNavigationPoint[] = [points[0]]
  for (let index = 1; index < points.length - 1; index += 1) {
    const previous = simplified.at(-1)!
    const current = points[index]
    const next = points[index + 1]
    const first = new THREE.Vector3(current.x - previous.x, current.y - previous.y, current.z - previous.z)
    const second = new THREE.Vector3(next.x - current.x, next.y - current.y, next.z - current.z)
    const firstLength = first.length()
    const secondLength = second.length()
    const sameDirection = firstLength > 1e-6
      && secondLength > 1e-6
      && first.dot(second) / (firstLength * secondLength) > 0.999999
    if (!sameDirection) simplified.push(current)
  }
  simplified.push(points.at(-1)!)
  return simplified
}

function RouteArrowInstances({
  markers,
  color,
  opacity,
  selected,
  renderOrder = 0,
}: {
  markers: AgvRouteArrowMarker[]
  color: string
  opacity: number
  selected: boolean
  renderOrder?: number
}) {
  const meshRef = useRef<THREE.InstancedMesh>(null)
  const dummy = useMemo(() => new THREE.Object3D(), [])
  useLayoutEffect(() => {
    const mesh = meshRef.current
    if (!mesh) return
    markers.forEach((marker, index) => {
      dummy.position.fromArray(marker.position)
      dummy.quaternion.copy(marker.quaternion)
      dummy.updateMatrix()
      mesh.setMatrixAt(index, dummy.matrix)
    })
    mesh.instanceMatrix.needsUpdate = true
    mesh.computeBoundingSphere()
  }, [dummy, markers])
  if (markers.length === 0) return null
  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, markers.length]} renderOrder={renderOrder}>
      <coneGeometry args={[selected ? 0.16 : 0.12, selected ? 0.4 : 0.32, 3]} />
      <meshBasicMaterial color={color} transparent opacity={opacity} depthWrite={false} />
    </instancedMesh>
  )
}

function AgvRouteNodeInstances({ points, color, opacity, selected }: { points: Point[]; color: string; opacity: number; selected: boolean }) {
  const meshRef = useRef<THREE.InstancedMesh>(null)
  const dummy = useMemo(() => new THREE.Object3D(), [])
  useLayoutEffect(() => {
    const mesh = meshRef.current
    if (!mesh) return
    points.forEach((point, index) => {
      dummy.position.set(point.x, 0.015, point.z)
      dummy.rotation.set(-Math.PI / 2, 0, 0)
      dummy.updateMatrix()
      mesh.setMatrixAt(index, dummy.matrix)
    })
    mesh.instanceMatrix.needsUpdate = true
    mesh.computeBoundingSphere()
  }, [dummy, points])
  if (points.length === 0) return null
  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, points.length]}>
      <circleGeometry args={[selected ? 0.075 : 0.055, 12]} />
      <meshBasicMaterial color={color} transparent opacity={opacity} depthWrite={false} side={THREE.DoubleSide} />
    </instancedMesh>
  )
}

function DroneRouteNodeInstances({ points, color, opacity, selected }: { points: DroneNavigationPoint[]; color: string; opacity: number; selected: boolean }) {
  const meshRef = useRef<THREE.InstancedMesh>(null)
  const dummy = useMemo(() => new THREE.Object3D(), [])
  useLayoutEffect(() => {
    const mesh = meshRef.current
    if (!mesh) return
    points.forEach((point, index) => {
      dummy.position.set(point.x, point.y, point.z)
      dummy.rotation.set(0, 0, 0)
      dummy.updateMatrix()
      mesh.setMatrixAt(index, dummy.matrix)
    })
    mesh.instanceMatrix.needsUpdate = true
    mesh.computeBoundingSphere()
  }, [dummy, points])
  if (points.length === 0) return null
  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, points.length]} renderOrder={26}>
      <sphereGeometry args={[selected ? 0.085 : 0.06, 8, 6]} />
      <meshBasicMaterial color={color} transparent opacity={opacity} depthWrite={false} />
    </instancedMesh>
  )
}

function agvRouteArrowMarkers(points: Point[], spacingM = 3): AgvRouteArrowMarker[] {
  const markers: AgvRouteArrowMarker[] = []
  let nextDistanceM = Math.max(1.2, spacingM * 0.6)
  points.slice(1).forEach((end, segmentIndex) => {
    const start = points[segmentIndex]
    const dx = end.x - start.x
    const dz = end.z - start.z
    const length = Math.hypot(dx, dz)
    if (length <= 1e-6) return
    const direction = new THREE.Vector3(dx / length, 0, dz / length)
    while (nextDistanceM <= length + 1e-6) {
      const ratio = nextDistanceM / length
      markers.push({
        key: `${segmentIndex}:${nextDistanceM.toFixed(3)}`,
        position: [start.x + dx * ratio, 0.055, start.z + dz * ratio],
        quaternion: new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction),
      })
      nextDistanceM += spacingM
    }
    nextDistanceM -= length
  })
  return markers
}

function AgvRouteFlowLine({ points, color, opacity, selected }: { points: Point[]; color: string; opacity: number; selected: boolean }) {
  const materialRef = useRef<(THREE.Material & { dashOffset: number }) | null>(null)
  useFrame((_, delta) => {
    if (!materialRef.current) return
    // Three.js 的虚线距离沿 points 顺序递增；减小相位会让虚线从车辆流向目标。
    materialRef.current.dashOffset -= Math.min(delta, 0.1) * (selected ? 1.45 : 1.05)
  })
  return (
    <Line
      ref={(line) => {
        materialRef.current = line ? line.material as THREE.Material & { dashOffset: number } : null
      }}
      points={points.map((point) => [point.x, 0.008, point.z] as Vector3Tuple)}
      color={color}
      lineWidth={selected ? 3.4 : 2.4}
      dashed
      dashSize={selected ? 0.52 : 0.4}
      gapSize={selected ? 0.2 : 0.28}
      transparent
      opacity={opacity}
      depthWrite={false}
    />
  )
}

function AgvRouteVisual({ runtime, floorY, selected, showLabel }: { runtime: AgvRuntimeState; floorY: number; selected: boolean; showLabel: boolean }) {
  const points = simplifyAgvRoutePoints(agvRemainingRoutePoints(runtime))
  if (points.length < 2) return null
  const color = runtime.motionStatus === 'blocked' ? '#c64c51' : runtime.motionStatus === 'yielding' ? '#5f88bd' : '#efbd24'
  const opacity = selected ? VEHICLE_ROUTE_SELECTED_OPACITY : VEHICLE_ROUTE_UNSELECTED_OPACITY
  const arrows = sampleRouteValues(agvRouteArrowMarkers(points, selected ? 2.6 : 3.4), selected ? 48 : 12)
  const intermediateNodes = sampleRouteValues(points.slice(1, -1), selected ? 96 : 32)
  const target = points.at(-1)!
  const targetLabel = runtime.motionStatus === 'yielding'
    ? '让行点'
    : runtime.phase === 'to-source'
      ? '取货点'
      : runtime.phase === 'clearing-dock'
        ? '安全离场点'
        : '卸货点'
  const remainingDistanceM = polylineLength(points)
  return (
    <group position={[0, floorY + 0.12, 0]}>
      <Line
        points={points.map((point) => [point.x, 0, point.z] as Vector3Tuple)}
        color="#252923"
        lineWidth={selected ? 7.2 : 5.2}
        transparent
        opacity={selected ? VEHICLE_ROUTE_BASE_SELECTED_OPACITY : VEHICLE_ROUTE_BASE_UNSELECTED_OPACITY}
        depthWrite={false}
      />
      <AgvRouteFlowLine points={points} color={color} opacity={opacity} selected={selected} />
      <RouteArrowInstances markers={arrows} color={color} opacity={opacity} selected={selected} />
      <AgvRouteNodeInstances points={intermediateNodes} color={color} opacity={opacity} selected={selected} />
      <mesh position={[target.x, 0.015, target.z]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[selected ? 0.2 : 0.15, selected ? 0.34 : 0.25, 24]} />
        <meshBasicMaterial color={color} transparent opacity={opacity} depthWrite={false} side={THREE.DoubleSide} />
      </mesh>
      {selected && showLabel ? (
        <Html center position={[target.x, 0.62, target.z]} distanceFactor={13} style={{ pointerEvents: 'none' }}>
          <span className="agv-route-label" style={{ borderColor: color }}>
            <strong>{targetLabel}</strong>
            <small>规划路线 · 剩余 {remainingDistanceM.toFixed(1)}m</small>
          </span>
        </Html>
      ) : null}
    </group>
  )
}

function droneRemainingRoutePoints(runtime: DroneRuntimeState, activeElevation: number): DroneNavigationPoint[] {
  const current = { x: runtime.position.x, y: runtime.position.y - activeElevation, z: runtime.position.z }
  const future = runtime.path
    .slice(Math.max(0, runtime.waypointIndex))
    .map((point) => ({ x: point.x, y: point.y - activeElevation, z: point.z }))
    .filter((point) => Math.hypot(point.x - current.x, point.y - current.y, point.z - current.z) > 0.01)
  return [current, ...future]
}

function droneRouteLength(points: DroneNavigationPoint[]): number {
  return points.slice(1).reduce((sum, point, index) => {
    const previous = points[index]
    return sum + Math.hypot(point.x - previous.x, point.y - previous.y, point.z - previous.z)
  }, 0)
}

function droneRouteArrowMarkers(points: DroneNavigationPoint[], spacingM = 3.4): AgvRouteArrowMarker[] {
  const markers: AgvRouteArrowMarker[] = []
  let nextDistanceM = Math.max(1.2, spacingM * 0.6)
  points.slice(1).forEach((end, segmentIndex) => {
    const start = points[segmentIndex]
    const direction = new THREE.Vector3(end.x - start.x, end.y - start.y, end.z - start.z)
    const length = direction.length()
    if (length <= 1e-6) return
    direction.normalize()
    while (nextDistanceM <= length + 1e-6) {
      const ratio = nextDistanceM / length
      markers.push({
        key: `drone:${segmentIndex}:${nextDistanceM.toFixed(3)}`,
        position: [
          start.x + (end.x - start.x) * ratio,
          start.y + (end.y - start.y) * ratio,
          start.z + (end.z - start.z) * ratio,
        ],
        quaternion: new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction),
      })
      nextDistanceM += spacingM
    }
    nextDistanceM -= length
  })
  return markers
}

function DroneRouteFlowLine({ points, color, opacity, selected }: { points: DroneNavigationPoint[]; color: string; opacity: number; selected: boolean }) {
  const materialRef = useRef<(THREE.Material & { dashOffset: number }) | null>(null)
  useFrame((_, delta) => {
    if (!materialRef.current) return
    // 距离沿“无人机 → 目标”递增；相位向负方向推进，使虚线始终向外流。
    materialRef.current.dashOffset -= Math.min(delta, 0.1) * (selected ? 1.7 : 1.2)
  })
  return (
    <Line
      ref={(line) => {
        materialRef.current = line ? line.material as THREE.Material & { dashOffset: number } : null
      }}
      points={points.map((point) => [point.x, point.y, point.z] as Vector3Tuple)}
      color={color}
      lineWidth={selected ? 3.5 : 2.5}
      dashed
      dashSize={selected ? 0.56 : 0.42}
      gapSize={selected ? 0.22 : 0.3}
      transparent
      opacity={opacity}
      depthWrite={false}
      renderOrder={25}
    />
  )
}

function DroneRouteVisual({ runtime, activeElevation, selected, showLabel }: { runtime: DroneRuntimeState; activeElevation: number; selected: boolean; showLabel: boolean }) {
  const points = simplifyDroneRoutePoints(droneRemainingRoutePoints(runtime, activeElevation))
  if (points.length < 2) return null
  const color = runtime.motionStatus === 'blocked' ? '#c64c51' : runtime.motionStatus === 'yielding' ? '#5f88bd' : '#efbd24'
  const opacity = selected ? VEHICLE_ROUTE_SELECTED_OPACITY : VEHICLE_ROUTE_UNSELECTED_OPACITY
  const arrows = sampleRouteValues(droneRouteArrowMarkers(points, selected ? 2.7 : 3.5), selected ? 48 : 12)
  const intermediateNodes = sampleRouteValues(points.slice(1, -1), selected ? 96 : 32)
  const target = points.at(-1)!
  const targetLabel = runtime.motionStatus === 'yielding'
    ? '三维让行点'
    : runtime.phase === 'to-source'
      ? '空中取货点'
      : runtime.phase === 'clearing-dock'
        ? '安全离场点'
        : '空中卸货点'
  const remainingDistanceM = droneRouteLength(points)
  return (
    <group name={`drone-route-${runtime.vehicleObjectId}`}>
      <Line
        points={points.map((point) => [point.x, point.y, point.z] as Vector3Tuple)}
        color="#252923"
        lineWidth={selected ? 7.4 : 5.4}
        transparent
        opacity={selected ? VEHICLE_ROUTE_BASE_SELECTED_OPACITY : VEHICLE_ROUTE_BASE_UNSELECTED_OPACITY}
        depthWrite={false}
        renderOrder={24}
      />
      <DroneRouteFlowLine points={points} color={color} opacity={opacity} selected={selected} />
      <RouteArrowInstances markers={arrows} color={color} opacity={opacity} selected={selected} renderOrder={26} />
      <DroneRouteNodeInstances points={intermediateNodes} color={color} opacity={opacity} selected={selected} />
      <mesh position={[target.x, target.y, target.z]} renderOrder={26}>
        <sphereGeometry args={[selected ? 0.22 : 0.17, 12, 8]} />
        <meshBasicMaterial color={color} transparent opacity={opacity} depthWrite={false} />
      </mesh>
      {selected && showLabel ? (
        <Html center position={[target.x, target.y + 0.72, target.z]} distanceFactor={13} style={{ pointerEvents: 'none' }}>
          <span className="agv-route-label" style={{ borderColor: color }}>
            <strong>{targetLabel}</strong>
            <small>3D 规划路线 · 剩余 {remainingDistanceM.toFixed(1)}m</small>
          </span>
        </Html>
      ) : null}
    </group>
  )
}

function ConveyorFlowMarkers({
  path,
  length,
  fromY,
  toY,
  count,
  running,
  simTime,
  beltSpeedMps,
  simulationSpeed,
}: {
  path: Point[]
  length: number
  fromY: number
  toY: number
  count: number
  running: boolean
  simTime: number
  beltSpeedMps: number
  simulationSpeed: number
}) {
  const meshRef = useRef<THREE.InstancedMesh>(null)
  const progressRef = useRef<number[]>([])
  if (progressRef.current.length !== count) {
    progressRef.current = Array.from({ length: count }, (_, index) => (index / count + simTime * beltSpeedMps / length) % 1)
  }
  const lastSimTimeRef = useRef(simTime)
  if (simTime < lastSimTimeRef.current - 0.001) {
    progressRef.current = Array.from({ length: count }, (_, index) => (index / count + simTime * beltSpeedMps / length) % 1)
  }
  lastSimTimeRef.current = simTime
  const dummy = useMemo(() => new THREE.Object3D(), [])
  useFrame((_, delta) => {
    const mesh = meshRef.current
    if (!mesh) return
    const frameDelta = Math.min(delta, 0.1)
    progressRef.current.forEach((progress, index) => {
      const nextProgress = running ? (progress + frameDelta * simulationSpeed * beltSpeedMps / length) % 1 : progress
      progressRef.current[index] = nextProgress
      const point = pointAlongSpatialPath(path, nextProgress, fromY, toY)
      const direction = directionAlongSpatialPath(path, nextProgress, fromY, toY)
      dummy.position.set(point.x, point.y + 0.39, point.z)
      dummy.quaternion.copy(stableConveyorQuaternion(direction))
      dummy.updateMatrix()
      mesh.setMatrixAt(index, dummy.matrix)
    })
    mesh.instanceMatrix.needsUpdate = true
  })
  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, count]} castShadow>
      <boxGeometry args={[0.2, 0.045, 0.45]} />
      <meshStandardMaterial color="#f5c32e" emissive="#9d6c00" emissiveIntensity={running ? 0.48 : 0.08} />
    </instancedMesh>
  )
}

function ConveyorConnection({
  object,
  objects,
  floors,
  activeFloorId,
  selected,
  running,
  simTime,
  simulationSpeed,
  onSelect,
  opacity,
  interactive,
  renderThroughFloor,
}: {
  object: FactoryObject
  objects: FactoryObject[]
  floors: Floor[]
  activeFloorId: string
  selected: boolean
  running: boolean
  simTime: number
  simulationSpeed: number
  onSelect: (id: string | null) => void
  opacity: number
  interactive: boolean
  renderThroughFloor: boolean
}) {
  const groupRef = useRef<THREE.Group>(null)
  useLayerOpacity(groupRef, opacity, renderThroughFloor)
  const path = conveyorPath(object, objects)
  if (path.length < 2) return null
  const [fromY, toY] = conveyorRelativeElevations(object, floors, activeFloorId)
  const isIncline = object.config.kind === 'conveyor' && object.config.conveyorType === 'incline'
  const length = Math.max(0.25, conveyorSpatialLength(path, toY - fromY))
  const markerCount = Math.max(2, Math.floor(length / 1.3))
  const segments = path.slice(1).map((end, index) => ({ start: path[index], end }))
  const startJointCorner = conveyorJointCorner(object, path, objects, 'start')
  const endJointCorner = conveyorJointCorner(object, path, objects, 'end')
  const visualSegments = trimPathForCorners(path, CONVEYOR_CORNER_HALF, {
    start: Boolean(startJointCorner),
    end: Boolean(endJointCorner),
  })
  const inclineStart = path[0]
  const inclineEnd = path.at(-1)!
  const inclineHorizontalLength = Math.max(0.0001, Math.hypot(inclineEnd.x - inclineStart.x, inclineEnd.z - inclineStart.z))
  const inclineStartT = startJointCorner ? Math.min(0.45, CONVEYOR_CORNER_HALF / inclineHorizontalLength) : 0
  const inclineEndT = endJointCorner ? Math.min(0.45, CONVEYOR_CORNER_HALF / inclineHorizontalLength) : 0
  const renderedInclineStart = {
    x: THREE.MathUtils.lerp(inclineStart.x, inclineEnd.x, inclineStartT),
    y: THREE.MathUtils.lerp(fromY, toY, inclineStartT),
    z: THREE.MathUtils.lerp(inclineStart.z, inclineEnd.z, inclineStartT),
  }
  const renderedInclineEnd = {
    x: THREE.MathUtils.lerp(inclineStart.x, inclineEnd.x, 1 - inclineEndT),
    y: THREE.MathUtils.lerp(fromY, toY, 1 - inclineEndT),
    z: THREE.MathUtils.lerp(inclineStart.z, inclineEnd.z, 1 - inclineEndT),
  }
  const renderedInclineDirection = new THREE.Vector3(
    renderedInclineEnd.x - renderedInclineStart.x,
    renderedInclineEnd.y - renderedInclineStart.y,
    renderedInclineEnd.z - renderedInclineStart.z,
  )
  const renderedInclineLength = Math.max(0.25, renderedInclineDirection.length())
  const inclineQuaternion = stableConveyorQuaternion(renderedInclineDirection)
  const click = (event: ThreeEvent<MouseEvent>) => { event.stopPropagation(); onSelect(object.id) }

  return (
    <group ref={groupRef} name={`connection-${object.id}`} onClick={interactive ? click : undefined}>
      {isIncline ? (
        <group
          position={[(renderedInclineStart.x + renderedInclineEnd.x) / 2, (renderedInclineStart.y + renderedInclineEnd.y) / 2, (renderedInclineStart.z + renderedInclineEnd.z) / 2]}
          quaternion={inclineQuaternion}
        >
          <RuntimeAsset
            url={assetUrl(object.modelRef) ?? KENNEY_CONVEYOR}
            targetSize={[renderedInclineLength + CONVEYOR_OVERLAP * 2, 0.4, 1]}
            fit="stretch"
            fallback={<FallbackConveyor length={renderedInclineLength} />}
          />
        </group>
      ) : visualSegments.flatMap((segment) => {
        const dx = segment.end.x - segment.start.x
        const dz = segment.end.z - segment.start.z
        const segmentTotal = segment.length
        const count = Math.max(1, Math.ceil(segmentTotal / 2))
        const segmentLength = segmentTotal / count
        const rotationY = -Math.atan2(dz, dx)
        return Array.from({ length: count }, (_, index) => {
          const t = (index + 0.5) / count
          const point = { x: THREE.MathUtils.lerp(segment.start.x, segment.end.x, t), z: THREE.MathUtils.lerp(segment.start.z, segment.end.z, t) }
          return (
            <group key={`${segment.sourceIndex}-${index}`} position={[point.x, fromY, point.z]} rotation={[0, rotationY, 0]}>
              <RuntimeAsset
                url={assetUrl(object.modelRef) ?? KENNEY_CONVEYOR}
                targetSize={[segmentLength + CONVEYOR_OVERLAP * 2, 0.4, 1]}
                fit="stretch"
                fallback={<FallbackConveyor length={segmentLength} />}
              />
            </group>
          )
        })
      })}
      {!isIncline ? path.slice(1, -1).map((corner, index) => (
        <group key={`corner-${index}`} position={[corner.x, fromY + 0.006, corner.z]} rotation={[0, kenneyCornerRotationY(path[index], corner, path[index + 2]), 0]}>
          <RuntimeAsset url={KENNEY_CONVEYOR_CORNER} targetSize={[CONVEYOR_CORNER_SIZE, 0.45, CONVEYOR_CORNER_SIZE]} fallback={<FallbackCorner />} />
        </group>
      )) : null}
      {startJointCorner ? (
        <group position={[startJointCorner.corner.x, fromY + 0.006, startJointCorner.corner.z]} rotation={[0, kenneyCornerRotationY(startJointCorner.previous, startJointCorner.corner, startJointCorner.next), 0]}>
          <RuntimeAsset url={KENNEY_CONVEYOR_CORNER} targetSize={[CONVEYOR_CORNER_SIZE, 0.45, CONVEYOR_CORNER_SIZE]} fallback={<FallbackCorner />} />
        </group>
      ) : null}
      <ConveyorFlowMarkers path={path} length={length} fromY={fromY} toY={toY} count={markerCount} running={running} simTime={simTime} beltSpeedMps={object.config.kind === 'conveyor' ? object.config.speedMps : 1} simulationSpeed={simulationSpeed} />
      {selected && interactive ? isIncline ? (
        <mesh position={[(renderedInclineStart.x + renderedInclineEnd.x) / 2, (renderedInclineStart.y + renderedInclineEnd.y) / 2 + 0.04, (renderedInclineStart.z + renderedInclineEnd.z) / 2]} quaternion={inclineQuaternion}>
          <boxGeometry args={[renderedInclineLength, 0.07, 1.04]} />
          <meshBasicMaterial color="#f4be22" transparent opacity={0.2} depthWrite={false} />
          <Edges color="#f4be22" opacity={0.96} transparent />
        </mesh>
      ) : segments.map((segment, index) => {
        const dx = segment.end.x - segment.start.x
        const dz = segment.end.z - segment.start.z
        const segmentLength = Math.hypot(dx, dz)
        return (
          <mesh key={`selected-${index}`} position={[(segment.start.x + segment.end.x) / 2, fromY + 0.05, (segment.start.z + segment.end.z) / 2]} rotation={[0, -Math.atan2(dz, dx), 0]}>
            <boxGeometry args={[segmentLength, 0.05, 1.02]} />
            <meshBasicMaterial color="#f4be22" transparent opacity={0.16} depthWrite={false} />
            <Edges color="#f4be22" opacity={0.9} transparent />
          </mesh>
        )
      }) : null}
    </group>
  )
}

function FallbackConveyor({ length }: { length: number }) {
  return (
    <mesh position={[0, 0.22, 0]} castShadow receiveShadow>
      <boxGeometry args={[length, 0.4, 1]} />
      <meshStandardMaterial color="#555854" roughness={0.48} metalness={0.5} />
      <Edges color="#f1bf2b" opacity={0.45} transparent />
    </mesh>
  )
}

function FallbackCorner() {
  return (
    <group>
      <mesh position={[0.25, 0.2, 0]} castShadow receiveShadow>
        <boxGeometry args={[0.5, 0.4, 1]} />
        <meshStandardMaterial color="#555854" roughness={0.48} metalness={0.5} />
      </mesh>
      <mesh position={[0, 0.2, -0.25]} castShadow receiveShadow>
        <boxGeometry args={[1, 0.4, 0.5]} />
        <meshStandardMaterial color="#555854" roughness={0.48} metalness={0.5} />
      </mesh>
    </group>
  )
}

function SmoothTransitVisual({ transit, path, item, running, simulationSpeed, fromY, toY, opacity, renderThroughFloor }: { transit: TransitItem; path: Point[]; item: Item | undefined; running: boolean; simulationSpeed: number; fromY: number; toY: number; opacity: number; renderThroughFloor: boolean }) {
  const groupRef = useRef<THREE.Group>(null)
  useLayerOpacity(groupRef, opacity, renderThroughFloor)
  const visualElapsedRef = useRef(transit.elapsedSec)
  const logicalElapsedRef = useRef(transit.elapsedSec)
  if (transit.elapsedSec < logicalElapsedRef.current - 0.001) visualElapsedRef.current = transit.elapsedSec
  else visualElapsedRef.current = Math.max(visualElapsedRef.current, transit.elapsedSec)
  logicalElapsedRef.current = transit.elapsedSec
  const initialProgress = THREE.MathUtils.clamp(visualElapsedRef.current / Math.max(transit.travelTimeSec, 0.001), 0, 1)
  const initialPoint = pointAlongSpatialPath(path, initialProgress, fromY, toY)
  const initialDirection = directionAlongSpatialPath(path, initialProgress, fromY, toY)
  useFrame((_, delta) => {
    const group = groupRef.current
    if (!group) return
    const frameDelta = Math.min(delta, 0.1)
    if (running) visualElapsedRef.current = Math.min(transit.travelTimeSec, Math.max(visualElapsedRef.current, transit.elapsedSec) + frameDelta * simulationSpeed)
    const progress = THREE.MathUtils.clamp(visualElapsedRef.current / Math.max(transit.travelTimeSec, 0.001), 0, 1)
    const point = pointAlongSpatialPath(path, progress, fromY, toY)
    const direction = directionAlongSpatialPath(path, progress, fromY, toY)
    group.position.set(point.x, point.y + 0.39, point.z)
    group.rotation.y = dampAngle(group.rotation.y, -Math.atan2(direction.z, direction.x), frameDelta, 11)
  })
  const modelId = item?.itemModelId
  const url = coreItemModelUrl(modelId)
  const hasParameterOverrides = Boolean(item && Object.keys(item.modelParameters).length > 0)
  return (
    <group ref={groupRef} position={[initialPoint.x, initialPoint.y + 0.39, initialPoint.z]} rotation={[0, -Math.atan2(initialDirection.z, initialDirection.x), 0]}>
      {item && hasParameterOverrides ? (
        <ParametricItemModel modelId={item.itemModelId} parameters={item.modelParameters} referenceTargetSize={[0.48, 0.36, 0.48]} fallback={<FallbackCargo />} />
      ) : url ? (
        <RuntimeAsset url={url} targetSize={[0.48, 0.36, 0.48]} fallback={<FallbackCargo />} />
      ) : <FallbackCargo />}
    </group>
  )
}

function TransitVisual({ transit, objects, floors, activeFloorId, items, running, simulationSpeed, opacity, renderThroughFloor }: { transit: TransitItem; objects: FactoryObject[]; floors: Floor[]; activeFloorId: string; items: Item[]; running: boolean; simulationSpeed: number; opacity: number; renderThroughFloor: boolean }) {
  const conveyor = objects.find((object) => object.id === transit.conveyorObjectId)
  if (!conveyor) return null
  const path = conveyorPath(conveyor, objects)
  if (path.length < 2) return null
  const [fromY, toY] = conveyorRelativeElevations(conveyor, floors, activeFloorId)
  const item = items.find((candidate) => candidate.id === transit.itemId)
  return <SmoothTransitVisual transit={transit} path={path} item={item} running={running} simulationSpeed={simulationSpeed} fromY={fromY} toY={toY} opacity={opacity} renderThroughFloor={renderThroughFloor} />
}

function FallbackCargo() {
  return (
    <group position={[0, 0.18, 0]}>
      <mesh castShadow>
        <boxGeometry args={[0.4, 0.36, 0.4]} />
        <meshStandardMaterial color="#70746e" roughness={0.62} metalness={0.2} />
      </mesh>
      <mesh position={[0, 0.02, 0.205]}>
        <boxGeometry args={[0.2, 0.08, 0.018]} />
        <meshStandardMaterial color="#f0c632" emissive="#8a6500" emissiveIntensity={0.45} />
      </mesh>
    </group>
  )
}

export const SceneObjects = memo(function SceneObjects({
  objects,
  items,
  inventory,
  simulation,
  floors,
  activeFloorId,
  floorVisibilityMode = 'current-only',
  enabledFloorIds = new Set(floors.map((floor) => floor.id)),
  selectedId,
  onSelect,
  onDragStart,
  showLabels = true,
  simulationRunning = false,
  simTime = 0,
}: SceneObjectsProps) {
  const activeFloor = floors.find((floor) => floor.id === activeFloorId) ?? floors[0]
  const activeElevation = activeFloor?.elevationM ?? 0
  const floorById = new Map(floors.map((floor) => [floor.id, floor]))
  const includesContextFloors = floorVisibilityMode !== 'current-only'
  const visibleFacilityEntries = objects.flatMap((object) => {
    if (object.kind === 'conveyor') return []
    const floor = floorById.get(object.floorId)
    if (!floor || !floorObjectsVisible(floor.id, activeFloorId, floorVisibilityMode, enabledFloorIds)) return []
    const isCurrent = floor.id === activeFloorId
    return [{ object, floorY: floor.elevationM - activeElevation, opacity: !isCurrent && floorVisibilityMode === 'lower-transparent' ? LOWER_FLOOR_OPACITY : 1, interactive: isCurrent }]
  })
  const visibleConveyorEntries = objects.flatMap((object) => {
    if (object.config.kind !== 'conveyor') return []
    const fromFloorId = conveyorEndpointFloorId({ floorId: object.floorId, config: object.config }, 'start')
    const toFloorId = conveyorEndpointFloorId({ floorId: object.floorId, config: object.config }, 'end')
    const fromFloor = floorById.get(fromFloorId)
    const toFloor = floorById.get(toFloorId)
    const touchesCurrent = fromFloorId === activeFloorId || toFloorId === activeFloorId
    if (!fromFloor || !toFloor || !conveyorFloorsVisible(fromFloorId, toFloorId, activeFloorId, floorVisibilityMode, enabledFloorIds)) return []
    return [{
      object,
      opacity: !touchesCurrent && floorVisibilityMode === 'lower-transparent' ? LOWER_FLOOR_OPACITY : 1,
      interactive: touchesCurrent,
      renderThroughFloor: includesContextFloors && fromFloorId !== toFloorId,
    }]
  })
  const visibleConveyorIds = new Set(visibleConveyorEntries.map(({ object }) => object.id))
  return (
    <group name="forgecore-factory-objects">
      {visibleConveyorEntries.map(({ object, opacity, interactive, renderThroughFloor }) => (
        <ConveyorConnection
          key={object.id}
          object={object}
          objects={objects}
          floors={floors}
          activeFloorId={activeFloorId}
          selected={object.id === selectedId}
          running={simulationRunning}
          simTime={simTime}
          simulationSpeed={simulation.speed}
          onSelect={onSelect}
          opacity={opacity}
          interactive={interactive}
          renderThroughFloor={renderThroughFloor}
        />
      ))}
      {visibleFacilityEntries.map(({ object, floorY, opacity, interactive }) => (
        <RuntimeObject
          key={object.id}
          object={object}
          selected={object.id === selectedId}
          onSelect={onSelect}
          onDragStart={onDragStart}
          showLabels={showLabels}
          simTime={simTime}
          simulation={simulation}
          inventory={inventory}
          items={items}
          simulationRunning={simulationRunning}
          floorY={floorY}
          activeElevation={activeElevation}
          opacity={opacity}
          interactive={interactive}
        />
      ))}
      {visibleFacilityEntries.filter(({ object }) => object.kind === 'agv' && simulation.agvRuntime?.[object.id]?.path.length > 1).map(({ object, floorY }) => (
        <AgvRouteVisual
          key={`agv-route-${object.id}`}
          runtime={simulation.agvRuntime[object.id]}
          floorY={floorY}
          selected={object.id === selectedId}
          showLabel={showLabels}
        />
      ))}
      {visibleFacilityEntries.filter(({ object }) => object.kind === 'drone' && simulation.droneRuntime?.[object.id]?.path.length > 1).map(({ object }) => (
        <DroneRouteVisual
          key={`drone-route-${object.id}`}
          runtime={simulation.droneRuntime[object.id]}
          activeElevation={activeElevation}
          selected={object.id === selectedId}
          showLabel={showLabels}
        />
      ))}
      {simulation.transitItems.filter((transit) => visibleConveyorIds.has(transit.conveyorObjectId)).map((transit) => {
        const conveyorEntry = visibleConveyorEntries.find(({ object }) => object.id === transit.conveyorObjectId)
        return <TransitVisual key={transit.id} transit={transit} objects={objects} floors={floors} activeFloorId={activeFloorId} items={items} running={simulationRunning} simulationSpeed={simulation.speed} opacity={conveyorEntry?.opacity ?? 1} renderThroughFloor={conveyorEntry?.renderThroughFloor ?? false} />
      })}
    </group>
  )
})
