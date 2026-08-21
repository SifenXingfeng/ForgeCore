import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { ThreeEvent } from '@react-three/fiber'
import * as THREE from 'three'
import type { URDFRobot } from 'urdf-loader'
import { objectToWorld } from '../../game/grid'
import type { FactoryObject } from '../../game/types'
import { loadPandaTemplate } from '../../scene/PandaArmModel'
import { NON_VEHICLE_BUILDING_VISUAL_SCALE } from '../../scene/industrialVisualScale'

const UP = new THREE.Vector3(0, 1, 0)
const ONE = new THREE.Vector3(1, 1, 1)
const STATION_LOCAL = new THREE.Matrix4().compose(
  new THREE.Vector3(-0.25, 0.18, -0.05).multiplyScalar(NON_VEHICLE_BUILDING_VISUAL_SCALE),
  new THREE.Quaternion(),
  new THREE.Vector3(1.14, 1.14, 1.14).multiplyScalar(NON_VEHICLE_BUILDING_VISUAL_SCALE),
)

interface PandaBatchPart {
  key: string
  geometry: THREE.BufferGeometry
  material: THREE.Material | THREE.Material[]
  matrices: THREE.Matrix4[]
  receiveShadow: boolean
}

/** 静止机械臂合批；进入 picking/placing 后由独立 URDF 关节树接管。 */
export const DaiyuPandaBatch = memo(function DaiyuPandaBatch({
  objects,
  castShadows = true,
  onSelect,
}: {
  objects: FactoryObject[]
  castShadows?: boolean
  onSelect: (id: string) => void
}) {
  const [template, setTemplate] = useState<URDFRobot | null>(null)
  const refs = useRef(new Map<string, THREE.InstancedMesh>())

  useEffect(() => {
    let cancelled = false
    loadPandaTemplate().then((robot) => {
      if (!cancelled) setTemplate(robot)
    }).catch(() => {})
    return () => { cancelled = true }
  }, [])

  const parts = useMemo(() => template ? collectPandaParts(template) : [], [template])

  useLayoutEffect(() => {
    parts.forEach((part) => {
      const mesh = refs.current.get(part.key)
      if (!mesh) return
      let instance = 0
      objects.forEach((object) => {
        const root = objectMatrix(object).multiply(STATION_LOCAL)
        part.matrices.forEach((local) => {
          mesh.setMatrixAt(instance, root.clone().multiply(local))
          instance += 1
        })
      })
      mesh.count = instance
      mesh.instanceMatrix.needsUpdate = true
      mesh.computeBoundingSphere()
    })
  }, [objects, parts])

  const selectFromBatch = (localCount: number) => (event: ThreeEvent<MouseEvent>) => {
    event.stopPropagation()
    if (event.instanceId === undefined) return
    const object = objects[Math.floor(event.instanceId / localCount)]
    if (object) onSelect(object.id)
  }

  if (!template) return null
  return (
    <group name="daiyu-batch:panda" dispose={null}>
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
          receiveShadow={part.receiveShadow}
          onClick={selectFromBatch(part.matrices.length)}
        />
      ))}
    </group>
  )
})

function collectPandaParts(template: URDFRobot) {
  template.updateMatrixWorld(true)
  const grouped = new Map<string, PandaBatchPart>()
  template.traverse((node) => {
    if (!(node instanceof THREE.Mesh)) return
    const materials = Array.isArray(node.material) ? node.material : [node.material]
    const key = `${node.geometry.uuid}:${materials.map((material) => material.uuid).join(',')}`
    const existing = grouped.get(key)
    if (existing) {
      existing.matrices.push(node.matrixWorld.clone())
      return
    }
    grouped.set(key, {
      key,
      geometry: node.geometry,
      material: node.material,
      matrices: [node.matrixWorld.clone()],
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
    ONE,
  )
}

function rotationAngle(rotation: FactoryObject['rotation']) {
  return rotation === 90 ? -Math.PI / 2 : rotation === 180 ? Math.PI : rotation === 270 ? Math.PI / 2 : 0
}
