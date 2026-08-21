import { memo, useLayoutEffect, useMemo, useRef } from 'react'
import { useGLTF } from '@react-three/drei'
import type { ThreeEvent } from '@react-three/fiber'
import * as THREE from 'three'
import { objectToWorld } from '../../game/grid'
import type { FactoryObject } from '../../game/types'

const UP = new THREE.Vector3(0, 1, 0)
const ONE = new THREE.Vector3(1, 1, 1)

interface EmbeddedBatchPart {
  key: string
  geometry: THREE.BufferGeometry
  material: THREE.Material | THREE.Material[]
  matrices: THREE.Matrix4[]
}

/** 对复合设备内部重复出现的原始 GLB 做精确实例化。 */
export const DaiyuEmbeddedModelBatch = memo(function DaiyuEmbeddedModelBatch({
  batchName,
  path,
  targetFootprint,
  targetHeight,
  localPosition,
  rotationOffsetY = 0,
  stripDirectionTexture = false,
  crossSectionScale = 1,
  visualScale = 1,
  objects,
  castShadows = true,
  onSelect,
}: {
  batchName: string
  path: string
  targetFootprint: number
  targetHeight: number
  localPosition: [number, number, number]
  rotationOffsetY?: number
  stripDirectionTexture?: boolean
  crossSectionScale?: number
  visualScale?: number
  objects: FactoryObject[]
  castShadows?: boolean
  onSelect: (id: string) => void
}) {
  const gltf = useGLTF(path)
  const refs = useRef(new Map<string, THREE.InstancedMesh>())
  const normalized = useMemo(
    () => normalizeModel(gltf.scene, targetFootprint, targetHeight, rotationOffsetY, stripDirectionTexture, crossSectionScale),
    [crossSectionScale, gltf.scene, rotationOffsetY, stripDirectionTexture, targetFootprint, targetHeight],
  )
  const parts = useMemo(() => collectParts(normalized), [normalized])
  const local = useMemo(
    () => new THREE.Matrix4().compose(
      new THREE.Vector3(...localPosition).multiplyScalar(visualScale),
      new THREE.Quaternion(),
      new THREE.Vector3(visualScale, visualScale, visualScale),
    ),
    [localPosition[0], localPosition[1], localPosition[2], visualScale],
  )

  useLayoutEffect(() => {
    parts.forEach((part) => {
      const mesh = refs.current.get(part.key)
      if (!mesh) return
      let instance = 0
      objects.forEach((object) => {
        const root = objectMatrix(object).multiply(local)
        part.matrices.forEach((partMatrix) => {
          mesh.setMatrixAt(instance, root.clone().multiply(partMatrix))
          instance += 1
        })
      })
      mesh.count = instance
      mesh.instanceMatrix.needsUpdate = true
      mesh.computeBoundingSphere()
    })
  }, [local, objects, parts])

  const selectFromPart = (localCount: number) => (event: ThreeEvent<MouseEvent>) => {
    event.stopPropagation()
    if (event.instanceId === undefined) return
    const object = objects[Math.floor(event.instanceId / localCount)]
    if (object) onSelect(object.id)
  }

  return (
    <group name={`daiyu-batch:${batchName}`} dispose={null}>
      {parts.map((part) => (
        <instancedMesh
          key={part.key}
          ref={(mesh) => {
            if (mesh) refs.current.set(part.key, mesh)
            else refs.current.delete(part.key)
          }}
          args={[part.geometry, part.material, Math.max(objects.length * part.matrices.length, 1)]}
          visible={objects.length > 0}
          castShadow={castShadows}
          receiveShadow
          onClick={selectFromPart(part.matrices.length)}
        />
      ))}
    </group>
  )
})

function normalizeModel(source: THREE.Group, targetFootprint: number, targetHeight: number, rotationOffsetY: number, stripDirectionTexture: boolean, crossSectionScale: number) {
  const scene = source.clone(true)
  scene.position.set(0, 0, 0)
  scene.rotation.set(0, rotationOffsetY, 0)
  scene.updateMatrixWorld(true)
  const box = new THREE.Box3().setFromObject(scene)
  const size = box.getSize(new THREE.Vector3())
  const scale = Math.min(targetFootprint / Math.max(size.x, size.z, 0.0001), targetHeight / Math.max(size.y, 0.0001))
  scene.scale.setScalar(scale)
  scene.updateMatrixWorld(true)
  const normalized = new THREE.Box3().setFromObject(scene)
  const center = normalized.getCenter(new THREE.Vector3())
  scene.position.set(-center.x, -normalized.min.y, -center.z)
  scene.updateMatrixWorld(true)
  scene.traverse((node) => {
    if (!(node instanceof THREE.Mesh)) return
    const materials = Array.isArray(node.material) ? node.material : [node.material]
    const isBelt = stripDirectionTexture && (
      node.name.toLowerCase().includes('belt') || materials.some((material) => {
        const name = material?.name?.toLowerCase() ?? ''
        return name.includes('conveyorbelt') || name.includes('rubber')
      })
    )
    if (!isBelt) return
    const replace = (material: THREE.Material) => {
      const next = material.clone() as THREE.MeshStandardMaterial
      next.map = null
      next.color.set('#172321')
      next.needsUpdate = true
      return next
    }
    node.material = Array.isArray(node.material) ? node.material.map(replace) : replace(node.material)
  })
  scene.updateMatrixWorld(true)
  const wrapper = new THREE.Group()
  wrapper.scale.set(1, crossSectionScale, crossSectionScale)
  wrapper.add(scene)
  wrapper.updateMatrixWorld(true)
  return wrapper
}

function collectParts(scene: THREE.Group) {
  const grouped = new Map<string, EmbeddedBatchPart>()
  scene.traverse((node) => {
    if (!(node instanceof THREE.Mesh)) return
    const materials = Array.isArray(node.material) ? node.material : [node.material]
    const key = `${node.geometry.uuid}:${materials.map((material) => material.uuid).join(',')}`
    const existing = grouped.get(key)
    if (existing) {
      existing.matrices.push(node.matrixWorld.clone())
      return
    }
    grouped.set(key, { key, geometry: node.geometry, material: node.material, matrices: [node.matrixWorld.clone()] })
  })
  return [...grouped.values()]
}

function objectMatrix(object: FactoryObject) {
  const world = objectToWorld(object)
  return new THREE.Matrix4().compose(
    new THREE.Vector3(world.x, 0, world.z),
    new THREE.Quaternion().setFromAxisAngle(UP, rotationAngle(object.rotation)),
    ONE,
  )
}

function rotationAngle(rotation: FactoryObject['rotation']) {
  return rotation === 90 ? -Math.PI / 2 : rotation === 180 ? Math.PI : rotation === 270 ? Math.PI / 2 : 0
}
