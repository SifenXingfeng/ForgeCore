import { memo, useLayoutEffect, useMemo, useRef } from 'react'
import { useFrame, type ThreeEvent } from '@react-three/fiber'
import { useGLTF } from '@react-three/drei'
import * as THREE from 'three'
import { objectToWorld } from '../../game/grid'
import type { FactoryObject } from '../../game/types'
import {
  CONVEYOR_CROSS_SECTION_SCALE,
  CONVEYOR_DIRECTION_STRIPE_COLOR,
  CONVEYOR_DIRECTION_STRIPE_HEIGHT_M,
  CONVEYOR_DIRECTION_STRIPE_LENGTH_M,
  CONVEYOR_DIRECTION_STRIPE_OPACITY,
  CONVEYOR_DIRECTION_STRIPE_PHASE_RATE,
  CONVEYOR_DIRECTION_STRIPE_WIDTH_M,
  CONVEYOR_VISUAL_SURFACE_Y_M,
  CONVEYOR_VISUAL_WIDTH_M,
  conveyorStripeCount,
  conveyorStripeProgress,
} from '../../scene/industrialVisualScale'

const CONVEYOR_PATH = '/models/industrial/roller_conveyor_segment.glb'
const UP = new THREE.Vector3(0, 1, 0)
const IDENTITY_SCALE = new THREE.Vector3(1, 1, 1)

interface MeshBatch {
  key: string
  geometry: THREE.BufferGeometry
  material: THREE.Material | THREE.Material[]
  localMatrices: THREE.Matrix4[]
  castShadow: boolean
  receiveShadow: boolean
}

/**
 * 黛玉精确批处理：复用原始滚筒传送带 GLB 的全部几何、材质和法线，
 * 只把重复对象合并为 InstancedMesh。不会减面、换模或降低纹理精度。
 */
export const DaiyuConveyorBatch = memo(function DaiyuConveyorBatch({
  objects,
  running,
  selectedIds,
  castShadows = true,
  onSelect,
}: {
  objects: FactoryObject[]
  running: boolean
  selectedIds: readonly string[]
  castShadows?: boolean
  onSelect: (id: string) => void
}) {
  const gltf = useGLTF(CONVEYOR_PATH)
  const batchRefs = useRef(new Map<string, THREE.InstancedMesh>())
  const motionRef = useRef<THREE.InstancedMesh>(null)
  const motionPhaseRef = useRef(0)
  const selectedRefs = useRef(new Map<string, THREE.LineSegments>())
  const rootRef = useRef<THREE.Group>(null)
  const normalized = useMemo(() => normalizeConveyor(gltf.scene), [gltf.scene])
  const batches = useMemo(() => collectBatches(normalized), [normalized])
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds])
  const selectedObjects = useMemo(() => objects.filter((object) => selectedSet.has(object.id)), [objects, selectedSet])

  useLayoutEffect(() => {
    batches.forEach((batch) => {
      const mesh = batchRefs.current.get(batch.key)
      if (!mesh) return
      let instance = 0
      objects.forEach((object) => {
        const root = objectMatrix(object)
        batch.localMatrices.forEach((local) => {
          mesh.setMatrixAt(instance, root.clone().multiply(local))
          instance += 1
        })
      })
      mesh.count = instance
      mesh.instanceMatrix.needsUpdate = true
      mesh.computeBoundingSphere()
    })
  }, [batches, objects])

  useFrame(({ clock }, delta) => {
    if (!rootRef.current || !isHierarchyVisible(rootRef.current)) return
    const elapsed = clock.getElapsedTime()
    if (running) motionPhaseRef.current = (motionPhaseRef.current + delta * CONVEYOR_DIRECTION_STRIPE_PHASE_RATE) % 1
    updateMotionInstances(motionRef.current, objects, motionPhaseRef.current)
    const pulse = 1 + (0.5 + 0.5 * Math.sin(elapsed * 3)) * 0.03
    selectedRefs.current.forEach((outline) => outline.scale.setScalar(pulse))
  })

  const selectFromBatch = (localCount: number) => (event: ThreeEvent<MouseEvent>) => {
    event.stopPropagation()
    if (event.instanceId === undefined) return
    const object = objects[Math.floor(event.instanceId / localCount)]
    if (object) onSelect(object.id)
  }

  const selectMotion = (event: ThreeEvent<MouseEvent>) => {
    event.stopPropagation()
    if (event.instanceId === undefined) return
    const object = objects[Math.floor(event.instanceId / conveyorStripeCount(1))]
    if (object) onSelect(object.id)
  }

  return (
    <group ref={rootRef} name="daiyu-batch:conveyor" dispose={null}>
      {batches.map((batch) => (
        <instancedMesh
          key={batch.key}
          ref={(mesh) => {
            if (mesh) batchRefs.current.set(batch.key, mesh)
            else batchRefs.current.delete(batch.key)
          }}
          args={[batch.geometry, batch.material, Math.max(objects.length * batch.localMatrices.length, 1)]}
          castShadow={castShadows && batch.castShadow}
          receiveShadow={batch.receiveShadow}
          visible={objects.length > 0}
          onClick={selectFromBatch(batch.localMatrices.length)}
        />
      ))}

      <instancedMesh ref={motionRef} args={[undefined, undefined, Math.max(objects.length * conveyorStripeCount(1), 1)]} visible={objects.length > 0} onClick={selectMotion}>
        <boxGeometry args={[CONVEYOR_DIRECTION_STRIPE_LENGTH_M, CONVEYOR_DIRECTION_STRIPE_HEIGHT_M, CONVEYOR_DIRECTION_STRIPE_WIDTH_M]} />
        <meshBasicMaterial color={CONVEYOR_DIRECTION_STRIPE_COLOR} transparent opacity={CONVEYOR_DIRECTION_STRIPE_OPACITY} depthWrite={false} toneMapped={false} />
      </instancedMesh>

      {selectedObjects.map((selected) => (
        <lineSegments
          key={selected.id}
          ref={(outline) => {
            if (outline) selectedRefs.current.set(selected.id, outline)
            else selectedRefs.current.delete(selected.id)
          }}
          position={[objectToWorld(selected).x, CONVEYOR_VISUAL_SURFACE_Y_M / 2, objectToWorld(selected).z]}
          rotation={[0, rotationAngle(selected.rotation), 0]}
        >
          <edgesGeometry args={[new THREE.BoxGeometry(1, CONVEYOR_VISUAL_SURFACE_Y_M, CONVEYOR_VISUAL_WIDTH_M)]} />
          <lineBasicMaterial color="#4fc3f7" linewidth={1} />
        </lineSegments>
      ))}
    </group>
  )
})

function normalizeConveyor(source: THREE.Group) {
  const scene = source.clone(true)
  scene.position.set(0, 0, 0)
  scene.rotation.set(0, Math.PI / 2, 0)
  scene.updateMatrixWorld(true)
  const box = new THREE.Box3().setFromObject(scene)
  const size = box.getSize(new THREE.Vector3())
  const scale = Math.min(1.05 / Math.max(size.x, size.z, 0.0001), 0.52 / Math.max(size.y, 0.0001))
  scene.scale.setScalar(scale)
  scene.updateMatrixWorld(true)
  const normalizedBox = new THREE.Box3().setFromObject(scene)
  const center = normalizedBox.getCenter(new THREE.Vector3())
  scene.position.set(-center.x, -normalizedBox.min.y, -center.z)
  scene.updateMatrixWorld(true)

  scene.traverse((node) => {
    if (!(node instanceof THREE.Mesh)) return
    node.castShadow = true
    node.receiveShadow = true
    const materials = Array.isArray(node.material) ? node.material : [node.material]
    const isBelt = node.name.toLowerCase().includes('belt') || materials.some((material) => {
      const name = material?.name?.toLowerCase() ?? ''
      return name.includes('conveyorbelt') || name.includes('rubber')
    })
    if (!isBelt) return
    const replaceDirectionTexture = (material: THREE.Material) => {
      const next = material.clone() as THREE.MeshStandardMaterial
      next.map = null
      next.color.set('#172321')
      next.needsUpdate = true
      return next
    }
    node.material = Array.isArray(node.material)
      ? node.material.map(replaceDirectionTexture)
      : replaceDirectionTexture(node.material)
  })
  scene.updateMatrixWorld(true)
  const crossSection = new THREE.Group()
  crossSection.scale.set(1, CONVEYOR_CROSS_SECTION_SCALE, CONVEYOR_CROSS_SECTION_SCALE)
  crossSection.add(scene)
  crossSection.updateMatrixWorld(true)
  return crossSection
}

function collectBatches(scene: THREE.Group) {
  const grouped = new Map<string, MeshBatch>()
  scene.traverse((node) => {
    if (!(node instanceof THREE.Mesh)) return
    const materials = Array.isArray(node.material) ? node.material : [node.material]
    const key = `${node.geometry.uuid}:${materials.map((material) => material.uuid).join(',')}:${Number(node.castShadow)}:${Number(node.receiveShadow)}`
    const existing = grouped.get(key)
    if (existing) {
      existing.localMatrices.push(node.matrixWorld.clone())
      return
    }
    grouped.set(key, {
      key,
      geometry: node.geometry,
      material: node.material,
      localMatrices: [node.matrixWorld.clone()],
      castShadow: node.castShadow,
      receiveShadow: node.receiveShadow,
    })
  })
  return [...grouped.values()]
}

function objectMatrix(object: FactoryObject) {
  const world = objectToWorld(object)
  return new THREE.Matrix4().compose(
    new THREE.Vector3(world.x, 0, world.z),
    new THREE.Quaternion().setFromAxisAngle(UP, rotationAngle(object.rotation)),
    IDENTITY_SCALE,
  )
}

function updateMotionInstances(mesh: THREE.InstancedMesh | null, objects: FactoryObject[], phase: number) {
  if (!mesh) return
  const stripeCount = conveyorStripeCount(1)
  let instance = 0
  objects.forEach((object) => {
    const root = objectMatrix(object)
    for (let stripe = 0; stripe < stripeCount; stripe += 1) {
      const local = new THREE.Matrix4().makeTranslation(
        conveyorStripeProgress(phase, stripe, stripeCount) - 0.5,
        CONVEYOR_VISUAL_SURFACE_Y_M + 0.018,
        0,
      )
      mesh.setMatrixAt(instance, root.clone().multiply(local))
      instance += 1
    }
  })
  mesh.count = instance
  mesh.instanceMatrix.needsUpdate = true
}

function rotationAngle(rotation: FactoryObject['rotation']) {
  return rotation === 90 ? -Math.PI / 2 : rotation === 180 ? Math.PI : rotation === 270 ? Math.PI / 2 : 0
}

function isHierarchyVisible(object: THREE.Object3D) {
  let current: THREE.Object3D | null = object
  while (current) {
    if (!current.visible) return false
    current = current.parent
  }
  return true
}

useGLTF.preload(CONVEYOR_PATH)
