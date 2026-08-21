import { useMemo } from 'react'
import * as THREE from 'three'
import { useGLTF } from '@react-three/drei'
import { CONVEYOR_CROSS_SECTION_SCALE } from './industrialVisualScale'

const PATH = '/models/industrial/roller_conveyor_segment.glb'

/** The normalized conveyor asset used by build-mode conveyor objects. */
export function FormalConveyorSegment({ targetFootprint = 1.05, targetHeight = 0.52, crossSectionScale = CONVEYOR_CROSS_SECTION_SCALE }: { targetFootprint?: number; targetHeight?: number; crossSectionScale?: number }) {
  const gltf = useGLTF(PATH)
  const normalized = useMemo(() => {
    const scene = gltf.scene.clone(true)
    // The source asset's long axis is Z; build conveyors run along +X.
    scene.position.set(0, 0, 0)
    scene.rotation.set(0, Math.PI / 2, 0)
    const box = new THREE.Box3().setFromObject(scene)
    const size = box.getSize(new THREE.Vector3())
    const scale = Math.min(
      targetFootprint / Math.max(size.x, size.z, 0.0001),
      targetHeight / Math.max(size.y, 0.0001),
    )
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
      if (node.name.toLowerCase().includes('belt') || materials.some((material) => material?.name?.toLowerCase().includes('conveyorbelt') || material?.name?.toLowerCase().includes('rubber'))) {
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
      }
    })
    return scene
  }, [gltf, targetFootprint, targetHeight])

  return <group scale={[1, crossSectionScale, crossSectionScale]}><primitive object={normalized} /></group>
}

useGLTF.preload(PATH)
