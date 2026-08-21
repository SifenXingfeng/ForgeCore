import { memo, useLayoutEffect, useMemo, useRef } from 'react'
import type { ThreeEvent } from '@react-three/fiber'
import * as THREE from 'three'
import { objectToWorld } from '../game/grid'
import type { FactoryObject } from '../game/types'

const ROLLERS_PER_CONVEYOR = 7
const RAILS_PER_CONVEYOR = 2
const LEGS_PER_CONVEYOR = 4
const Y_AXIS = new THREE.Vector3(0, 1, 0)

interface InstancedConveyorFieldProps {
  objects: FactoryObject[]
  selectedId: string | null
  onSelect: (id: string) => void
}

/**
 * Repeated conveyor cells are rendered as five instanced batches instead of
 * cloning a seven-mesh GLB for every grid cell. A long line therefore keeps a
 * constant draw-call budget while preserving individual click selection.
 */
export const InstancedConveyorField = memo(function InstancedConveyorField({ objects, selectedId, onSelect }: InstancedConveyorFieldProps) {
  const deckRef = useRef<THREE.InstancedMesh>(null)
  const rollerRef = useRef<THREE.InstancedMesh>(null)
  const railRef = useRef<THREE.InstancedMesh>(null)
  const legRef = useRef<THREE.InstancedMesh>(null)
  const cornerRef = useRef<THREE.InstancedMesh>(null)
  const corners = useMemo(() => {
    const cells = new Set(objects.map((object) => `${object.pos.x}:${object.pos.z}`))
    return objects.filter((object) => {
      const hasHorizontal = cells.has(`${object.pos.x - 1}:${object.pos.z}`) || cells.has(`${object.pos.x + 1}:${object.pos.z}`)
      const hasVertical = cells.has(`${object.pos.x}:${object.pos.z - 1}`) || cells.has(`${object.pos.x}:${object.pos.z + 1}`)
      return hasHorizontal && hasVertical
    })
  }, [objects])
  const selected = objects.find((object) => object.id === selectedId)

  useLayoutEffect(() => {
    const deck = deckRef.current
    const rollers = rollerRef.current
    const rails = railRef.current
    const legs = legRef.current
    const corner = cornerRef.current
    if (!deck || !rollers || !rails || !legs || !corner) return

    objects.forEach((object, objectIndex) => {
      setInstance(deck, objectIndex, object, [0, 0.17, 0])

      for (let roller = 0; roller < ROLLERS_PER_CONVEYOR; roller += 1) {
        setInstance(
          rollers,
          objectIndex * ROLLERS_PER_CONVEYOR + roller,
          object,
          [-0.36 + roller * 0.12, 0.29, 0],
          [Math.PI / 2, 0, 0],
        )
      }

      for (let rail = 0; rail < RAILS_PER_CONVEYOR; rail += 1) {
        setInstance(
          rails,
          objectIndex * RAILS_PER_CONVEYOR + rail,
          object,
          [0, 0.35, rail === 0 ? -0.31 : 0.31],
        )
      }

      const legPositions: Array<[number, number, number]> = [
        [-0.34, 0.075, -0.24],
        [-0.34, 0.075, 0.24],
        [0.34, 0.075, -0.24],
        [0.34, 0.075, 0.24],
      ]
      legPositions.forEach((position, leg) => {
        setInstance(legs, objectIndex * LEGS_PER_CONVEYOR + leg, object, position)
      })
    })

    corners.forEach((object, index) => setInstance(corner, index, object, [0, 0.3, 0]))
    ;[deck, rollers, rails, legs, corner].forEach((mesh) => {
      mesh.instanceMatrix.needsUpdate = true
      mesh.computeBoundingSphere()
    })
  }, [corners, objects])

  const selectAt = (divisor: number) => (event: ThreeEvent<MouseEvent>) => {
    event.stopPropagation()
    if (event.instanceId === undefined) return
    const object = objects[Math.floor(event.instanceId / divisor)]
    if (object) onSelect(object.id)
  }

  const selectCorner = (event: ThreeEvent<MouseEvent>) => {
    event.stopPropagation()
    if (event.instanceId === undefined) return
    const object = corners[event.instanceId]
    if (object) onSelect(object.id)
  }

  return (
    <group>
      <instancedMesh ref={deckRef} args={[undefined, undefined, objects.length]} receiveShadow onClick={selectAt(1)}>
        <boxGeometry args={[0.94, 0.16, 0.62]} />
        <meshStandardMaterial color="#293633" roughness={0.72} metalness={0.48} />
      </instancedMesh>
      <instancedMesh ref={rollerRef} args={[undefined, undefined, objects.length * ROLLERS_PER_CONVEYOR]} receiveShadow onClick={selectAt(ROLLERS_PER_CONVEYOR)}>
        <cylinderGeometry args={[0.036, 0.036, 0.5, 8]} />
        <meshStandardMaterial color="#87918d" roughness={0.42} metalness={0.78} />
      </instancedMesh>
      <instancedMesh ref={railRef} args={[undefined, undefined, objects.length * RAILS_PER_CONVEYOR]} receiveShadow onClick={selectAt(RAILS_PER_CONVEYOR)}>
        <boxGeometry args={[0.94, 0.13, 0.055]} />
        <meshStandardMaterial color="#586762" roughness={0.54} metalness={0.68} />
      </instancedMesh>
      <instancedMesh ref={legRef} args={[undefined, undefined, objects.length * LEGS_PER_CONVEYOR]} receiveShadow onClick={selectAt(LEGS_PER_CONVEYOR)}>
        <boxGeometry args={[0.065, 0.15, 0.065]} />
        <meshStandardMaterial color="#46534f" roughness={0.62} metalness={0.62} />
      </instancedMesh>
      <instancedMesh ref={cornerRef} args={[undefined, undefined, Math.max(corners.length, 1)]} visible={corners.length > 0} receiveShadow onClick={selectCorner}>
        <cylinderGeometry args={[0.34, 0.34, 0.065, 20]} />
        <meshStandardMaterial color="#1d2926" roughness={0.74} metalness={0.32} />
      </instancedMesh>

      {selected && (
        <mesh
          position={[objectToWorld(selected).x, 0.29, objectToWorld(selected).z]}
          rotation={[0, rotationAngle(selected.rotation), 0]}
        >
          <boxGeometry args={[1.02, 0.64, 0.72]} />
          <meshBasicMaterial color="#4fc3c0" wireframe transparent opacity={0.78} />
        </mesh>
      )}
    </group>
  )
})

function setInstance(
  mesh: THREE.InstancedMesh,
  index: number,
  object: FactoryObject,
  localPosition: [number, number, number],
  localRotation: [number, number, number] = [0, 0, 0],
) {
  const world = objectToWorld(object)
  const root = new THREE.Matrix4().compose(
    new THREE.Vector3(world.x, 0, world.z),
    new THREE.Quaternion().setFromAxisAngle(Y_AXIS, rotationAngle(object.rotation)),
    new THREE.Vector3(1, 1, 1),
  )
  const local = new THREE.Matrix4().compose(
    new THREE.Vector3(...localPosition),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(...localRotation)),
    new THREE.Vector3(1, 1, 1),
  )
  mesh.setMatrixAt(index, root.multiply(local))
}

function rotationAngle(rotation: FactoryObject['rotation']) {
  return rotation === 90 ? -Math.PI / 2 : rotation === 180 ? Math.PI : rotation === 270 ? Math.PI / 2 : 0
}
