import { OrbitControls } from '@react-three/drei'
import { Canvas } from '@react-three/fiber'
import { useMemo, type ReactNode } from 'react'
import * as THREE from 'three'
import { RUNTIME_MATERIAL_LIBRARY, buildRuntimeItemModel, type RuntimeBuildResult, type RuntimeMaterialPreset } from '../data/itemModelRuntime'
import type { ModelParameters } from '../game/item'

export interface CachedParametricPrimitive { geometry: THREE.BufferGeometry; material: THREE.MeshStandardMaterial }
export interface CachedParametricModel { primitives: CachedParametricPrimitive[]; bounds: { min: [number, number, number]; max: [number, number, number]; size: [number, number, number] } }
const modelCache = new Map<string, CachedParametricModel>()
const EMPTY_PARAMETERS: ModelParameters = Object.freeze({})

function stableParameterKey(parameters: ModelParameters): string {
  return JSON.stringify(Object.entries(parameters).sort(([left], [right]) => left.localeCompare(right)))
}

function parseHexColor(value: unknown): THREE.Color | null {
  if (typeof value !== 'string' || !/^#[\da-f]{6}$/iu.test(value)) return null
  return new THREE.Color(value)
}

function createProceduralTexture(bindingKey: string): THREE.CanvasTexture | null {
  if (!bindingKey || typeof document === 'undefined') return null
  const canvas = document.createElement('canvas'); canvas.width = 64; canvas.height = 64
  const context = canvas.getContext('2d'); if (!context) return null
  let hash = 2166136261
  for (const character of bindingKey) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619)
  const spacing = 8 + Math.abs(hash % 9)
  context.fillStyle = '#ffffff'; context.fillRect(0, 0, 64, 64)
  context.strokeStyle = `hsl(${Math.abs(hash) % 360} 20% 72%)`; context.lineWidth = 4
  for (let offset = -64; offset < 128; offset += spacing) { context.beginPath(); context.moveTo(offset, 64); context.lineTo(offset + 64, 0); context.stroke() }
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace; texture.wrapS = THREE.RepeatWrapping; texture.wrapT = THREE.RepeatWrapping; texture.repeat.set(2, 2)
  return texture
}

function materialFromPreset(preset: RuntimeMaterialPreset | undefined, isPrimary: boolean, overrides: ModelParameters): THREE.MeshStandardMaterial {
  const source = preset ?? RUNTIME_MATERIAL_LIBRARY.neutral
  const sourceColor = source.baseColorFactor ?? [0.46, 0.49, 0.52, 1]
  const colorOverride = isPrimary && Object.prototype.hasOwnProperty.call(overrides, 'color') ? parseHexColor(overrides.color) : null
  const opacity = isPrimary && Object.prototype.hasOwnProperty.call(overrides, 'opacity') ? Number(overrides.opacity) : sourceColor[3]
  const emission = isPrimary && Object.prototype.hasOwnProperty.call(overrides, 'emission') ? parseHexColor(overrides.emission) : null
  const material = new THREE.MeshStandardMaterial({
    color: colorOverride ?? new THREE.Color(sourceColor[0], sourceColor[1], sourceColor[2]), emissive: emission ?? new THREE.Color(0, 0, 0), emissiveIntensity: emission ? 0.72 : 0,
    metalness: isPrimary && Object.prototype.hasOwnProperty.call(overrides, 'metalness') ? Number(overrides.metalness) : source.metallicFactor,
    roughness: isPrimary && Object.prototype.hasOwnProperty.call(overrides, 'roughness') ? Number(overrides.roughness) : source.roughnessFactor,
    opacity, transparent: opacity < 0.999 || source.alphaMode === 'BLEND', depthWrite: opacity >= 0.999, side: source.doubleSided ? THREE.DoubleSide : THREE.FrontSide,
  })
  if (isPrimary && typeof overrides.texture === 'string' && overrides.texture.trim()) material.map = createProceduralTexture(overrides.texture.trim())
  return material
}

function createCachedModel(build: RuntimeBuildResult, overrides: ModelParameters): CachedParametricModel {
  const requestedPreset = build.parameters.materialPreset
  const primaryMaterialId = typeof requestedPreset === 'string' && requestedPreset !== 'auto' ? requestedPreset : Object.values(build.definition.defaultMaterials)[0] ?? 'neutral'
  const primitives = build.geometry.primitives.map((primitive) => {
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(primitive.positions, 3)); geometry.setAttribute('normal', new THREE.Float32BufferAttribute(primitive.normals, 3)); geometry.setAttribute('uv', new THREE.Float32BufferAttribute(primitive.uvs, 2)); geometry.setIndex(primitive.indices); geometry.computeBoundingBox(); geometry.computeBoundingSphere()
    return { geometry, material: materialFromPreset(RUNTIME_MATERIAL_LIBRARY[primitive.material], primitive.material === primaryMaterialId, overrides) }
  })
  return { primitives, bounds: build.geometry.bounds }
}

export function getParametricItemModel(modelId: string, parameters: ModelParameters): CachedParametricModel | null {
  const cacheKey = `${modelId}:${stableParameterKey(parameters)}`
  const cached = modelCache.get(cacheKey)
  if (cached) return cached
  try {
    const model = createCachedModel(buildRuntimeItemModel(modelId, parameters), parameters)
    modelCache.set(cacheKey, model)
    return model
  } catch (error) {
    console.warn('ForgeCore parametric model fallback', error)
    return null
  }
}

function useParametricModel(modelId: string, parameters: ModelParameters): CachedParametricModel | null {
  const parameterKey = stableParameterKey(parameters)
  return useMemo(() => {
    return getParametricItemModel(modelId, parameters)
  }, [modelId, parameterKey, parameters])
}

export function ParametricItemModel({ modelId, parameters, targetSize, center = false, fallback = null }: { modelId: string; parameters: ModelParameters; targetSize?: [number, number, number]; center?: boolean; fallback?: ReactNode }) {
  const model = useParametricModel(modelId, parameters); const reference = useParametricModel(modelId, EMPTY_PARAMETERS)
  if (!model) return fallback
  const fit = reference?.bounds.size ?? model.bounds.size
  const scale = targetSize ? Math.min(targetSize[0] / Math.max(fit[0], .0001), targetSize[1] / Math.max(fit[1], .0001), targetSize[2] / Math.max(fit[2], .0001)) : 1
  const centerY = center ? -((model.bounds.min[1] + model.bounds.max[1]) / 2) * scale : 0
  return <group scale={scale} position={[0, centerY, 0]}>{model.primitives.map((primitive, index) => <mesh key={index} geometry={primitive.geometry} material={primitive.material} castShadow receiveShadow />)}</group>
}

export function ParametricModelPreview({ modelId, parameters, label }: { modelId: string; parameters: ModelParameters; label: string }) {
  return <div className="fm-parametric-preview" aria-label={`${label} 参数化三维实时预览`}>
    <Canvas orthographic camera={{ position: [4, 3.2, 4], zoom: 64, near: .1, far: 100 }} dpr={[1, 1.5]} shadows>
      <color attach="background" args={['#e8eeeb']} /><ambientLight intensity={1.45} /><directionalLight position={[4, 7, 5]} intensity={2.2} color="#fff8dc" castShadow /><directionalLight position={[-4, 2, -3]} intensity={.75} color="#c7d2db" />
      <group rotation={[.08, -.55, 0]}><ParametricItemModel modelId={modelId} parameters={parameters} targetSize={[2.5, 2.5, 2.5]} center /></group>
      <OrbitControls makeDefault enablePan={false} enableZoom minZoom={42} maxZoom={105} autoRotate autoRotateSpeed={.7} />
    </Canvas><span>实时几何 · 拖动旋转 · 滚轮缩放</span>
  </div>
}
