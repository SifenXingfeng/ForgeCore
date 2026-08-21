import { useMemo } from 'react'
import * as THREE from 'three'
import { useGLTF } from '@react-three/drei'

export function ImportedFactoryModel({ path, targetWidth, targetHeight, visible = true }: { path: string; targetWidth: number; targetHeight: number; visible?: boolean }) {
  const gltf = useGLTF(path)
  const normalized = useMemo(() => {
    const scene = gltf.scene.clone(true)
    const box = new THREE.Box3().setFromObject(scene)
    const size = box.getSize(new THREE.Vector3())
    const scale = Math.min(targetWidth / Math.max(size.x, size.z, 0.0001), targetHeight / Math.max(size.y, 0.0001))
    scene.scale.setScalar(scale)
    const normalizedBox = new THREE.Box3().setFromObject(scene)
    const center = normalizedBox.getCenter(new THREE.Vector3())
    scene.position.x -= center.x
    scene.position.z -= center.z
    scene.position.y -= normalizedBox.min.y
    scene.traverse((node) => {
      if (node instanceof THREE.Mesh) {
        node.castShadow = true
        node.receiveShadow = true
      }
    })
    return scene
  }, [gltf, targetWidth, targetHeight])

  return <group visible={visible}><primitive object={normalized} /></group>
}

useGLTF.preload('/models/industrial_line_demo.glb')
