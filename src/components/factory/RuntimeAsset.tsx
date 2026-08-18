import { Component, Suspense, useMemo, type ReactNode } from 'react'
import { useGLTF } from '@react-three/drei'
import * as THREE from 'three'

export interface RuntimeAssetProps {
  url: string
  targetSize: [number, number, number]
  extractNodeName?: string
  intrinsicRotationY?: number
  fit?: 'contain' | 'stretch'
  fallback?: ReactNode
}

function AssetGeometry({
  url,
  targetSize,
  extractNodeName,
  intrinsicRotationY = 0,
  fit = 'contain',
}: Omit<RuntimeAssetProps, 'fallback'>) {
  const { scene } = useGLTF(url)
  const normalized = useMemo(() => {
    scene.updateMatrixWorld(true)
    const source = extractNodeName
      ? scene.getObjectByName(extractNodeName) ?? scene.children.find((child) => child.name.includes(extractNodeName))
      : scene
    const clone = (source ?? scene).clone(true)

    // A vendor sub-tree can depend on transforms from its ancestors. Bake that
    // world transform before normalising it into the ForgeCore visual wrapper.
    if (source && source !== scene) clone.applyMatrix4(source.matrixWorld)

    const root = new THREE.Group()
    clone.rotation.y += intrinsicRotationY
    root.add(clone)
    root.updateMatrixWorld(true)

    const bounds = new THREE.Box3().setFromObject(root)
    const size = bounds.getSize(new THREE.Vector3())
    const center = bounds.getCenter(new THREE.Vector3())
    const scale = fit === 'stretch'
      ? new THREE.Vector3(
          targetSize[0] / Math.max(size.x, 0.0001),
          targetSize[1] / Math.max(size.y, 0.0001),
          targetSize[2] / Math.max(size.z, 0.0001),
        )
      : new THREE.Vector3().setScalar(Math.min(
          targetSize[0] / Math.max(size.x, 0.0001),
          targetSize[1] / Math.max(size.y, 0.0001),
          targetSize[2] / Math.max(size.z, 0.0001),
        ))
    // Scale the oriented wrapper in ForgeCore world axes. Applying a
    // non-uniform scale to the already-rotated clone swaps the effective X/Z
    // axes (most visible on rack.glb) and makes the shelf many times too long.
    root.scale.copy(scale)
    root.position.x -= center.x * scale.x
    root.position.z -= center.z * scale.z
    root.position.y -= bounds.min.y * scale.y
    root.updateMatrixWorld(true)
    root.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return
      child.castShadow = true
      child.receiveShadow = true
    })
    return root
  }, [extractNodeName, fit, intrinsicRotationY, scene, targetSize[0], targetSize[1], targetSize[2]])

  return <primitive object={normalized} />
}

class AssetBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  componentDidCatch(error: Error) { console.warn('ForgeCore runtime asset fallback activated', error) }
  render() { return this.state.failed ? this.props.fallback : this.props.children }
}

export function RuntimeAsset({ fallback = null, ...props }: RuntimeAssetProps) {
  return (
    <AssetBoundary fallback={fallback}>
      <Suspense fallback={fallback}>
        <AssetGeometry {...props} />
      </Suspense>
    </AssetBoundary>
  )
}

export function assetUrl(modelRef: string | null | undefined): string | null {
  if (!modelRef || modelRef.startsWith('procedural:')) return null
  const normalized = modelRef.replaceAll('\\', '/').replace(/^assets\//u, '')
  return `/${normalized}`
}
