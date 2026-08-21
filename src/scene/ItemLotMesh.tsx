import { Component, useMemo, useRef, type ErrorInfo, type ReactNode } from 'react'
import { useFrame } from '@react-three/fiber'
import { useGLTF } from '@react-three/drei'
import * as THREE from 'three'
import { useForgeMindStore } from '../store/forgeMind'
import type { ItemLot } from '../game/simulation'
import { gridToWorld } from '../game/grid'
import { rotationToDir } from '../game/dir'
import { CONVEYOR_VISUAL_SURFACE_Y_M } from './industrialVisualScale'
import type { FactoryFloorId } from '../game/types'
import { inclineEndCell, inclineStartCell, inclineTargetFloor, isInclineConveyorType } from '../game/inclineConveyor'
import { getFloorElevation } from './FactoryFloorSystem'
import { resolveItemAppearanceParameters } from '../game/item'
import { ParametricItemModel } from '../components/ParametricItemModel'

/**
 * 在途物品（ItemLot）渲染（Day 5）。
 * 物品沿传送带朝向插值移动：世界位置 = 传送带格中心 + dir * (offset - 0.5)。
 * offset ∈ [0,1] 表示物品从带子入口到出口的进度。
 */
export function ItemLotMesh({ lot, renderFloorId = lot.floorId }: { lot: ItemLot; renderFloorId?: FactoryFloorId }) {
  const ref = useRef<THREE.Group>(null)
  const initialized = useRef(false)
  const objects = useForgeMindStore((s) => s.objects)
  const items = useForgeMindStore((s) => s.items)

  const conveyor = objects.find((o) => o.id === lot.conveyorId)
  if (!conveyor) return null
  const isIncline = isInclineConveyorType(conveyor.type) && Boolean(conveyor.incline)
  if (!isIncline && (conveyor.floorId ?? 1) !== lot.floorId) return null

  const item = items.find((i) => i.id === lot.itemId)
  const color = item?.color ?? '#dbe4ee'

  const size = 0.3
  let px: number
  let pz: number
  let targetY: number
  if (isIncline) {
    const start = gridToWorld(inclineStartCell(conveyor))
    const end = gridToWorld(inclineEndCell(conveyor))
    const startY = getFloorElevation(conveyor.floorId ?? 1)
    const endY = getFloorElevation(inclineTargetFloor(conveyor))
    px = THREE.MathUtils.lerp(start.x, end.x, lot.offset)
    pz = THREE.MathUtils.lerp(start.z, end.z, lot.offset)
    targetY = THREE.MathUtils.lerp(startY, endY, lot.offset) - getFloorElevation(renderFloorId) + CONVEYOR_VISUAL_SURFACE_Y_M + size / 2
  } else {
    const dir = rotationToDir(conveyor.rotation)
    const { x: cx, z: cz } = gridToWorld(conveyor.pos)
    // offset 0 = 入口，1 = 出口；视觉上让物品居中于带子上
    px = cx + dir.dx * (lot.offset - 0.5)
    pz = cz + dir.dz * (lot.offset - 0.5)
    targetY = CONVEYOR_VISUAL_SURFACE_Y_M + size / 2
  }

  useFrame((_, delta) => {
    if (!ref.current) return
    if (!initialized.current) {
      ref.current.position.set(px, targetY, pz)
      initialized.current = true
      return
    }
    ref.current.position.x = THREE.MathUtils.damp(ref.current.position.x, px, 10, delta)
    ref.current.position.y = THREE.MathUtils.damp(ref.current.position.y, targetY, 12, delta)
    ref.current.position.z = THREE.MathUtils.damp(ref.current.position.z, pz, 10, delta)
  })

  return (
    <group ref={ref}>
      {item?.modelId
        ? <ParametricItemModel modelId={item.modelId} parameters={resolveItemAppearanceParameters(item)} targetSize={[size, size, size]} center fallback={<CargoFallback size={size} color={color} />} />
        : item?.modelPath
          ? <CargoModelBoundary fallback={<CargoFallback size={size} color={color} />}><ForgeCoreCargoModel path={item.modelPath} size={size} /></CargoModelBoundary>
          : <CargoFallback size={size} color={color} />}
    </group>
  )
}

function CargoFallback({ size, color }: { size: number; color: string }) {
  return <mesh castShadow><boxGeometry args={[size, size, size]} /><meshStandardMaterial color={color} roughness={0.5} metalness={0.4} /></mesh>
}

interface CargoModelBoundaryProps {
  fallback: ReactNode
  children: ReactNode
}

interface CargoModelBoundaryState {
  hasError: boolean
}

/** A broken optional cargo asset must not take down the whole factory canvas. */
class CargoModelBoundary extends Component<CargoModelBoundaryProps, CargoModelBoundaryState> {
  state: CargoModelBoundaryState = { hasError: false }

  static getDerivedStateFromError(): CargoModelBoundaryState {
    return { hasError: true }
  }

  componentDidCatch(error: Error, _info: ErrorInfo) {
    console.warn('ForgeCore cargo model unavailable; using fallback geometry.', error)
  }

  render() {
    return this.state.hasError ? this.props.fallback : this.props.children
  }
}

function ForgeCoreCargoModel({ path, size }: { path: string; size: number }) {
  const gltf = useGLTF(`/models/forgecore/items/${path}`)
  const model = useMemo(() => {
    const scene = gltf.scene.clone(true)
    scene.updateMatrixWorld(true)
    const sourceBox = new THREE.Box3().setFromObject(scene)
    const sourceSize = sourceBox.getSize(new THREE.Vector3())
    const scale = size / Math.max(sourceSize.x, sourceSize.y, sourceSize.z, 0.0001)
    scene.scale.setScalar(scale)
    scene.updateMatrixWorld(true)
    const normalizedBox = new THREE.Box3().setFromObject(scene)
    const center = normalizedBox.getCenter(new THREE.Vector3())
    scene.position.set(-center.x, -normalizedBox.min.y, -center.z)
    scene.traverse((node) => {
      if (node instanceof THREE.Mesh) {
        node.castShadow = true
        node.receiveShadow = true
      }
    })
    return scene
  }, [gltf.scene, size])
  return <primitive object={model} />
}
