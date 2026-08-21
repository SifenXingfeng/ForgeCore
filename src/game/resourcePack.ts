import * as THREE from 'three'
import { GLTFLoader } from 'three-stdlib'
import type { EquipmentCategory, ImportedResource, ObjectDef, ObjectRole, PortSide } from './types'

export interface ResourceImportForm {
  id: string
  name: string
  category: EquipmentCategory
  role: ObjectRole
  subtitle: string
  description: string
  width: number
  depth: number
  height: number
  throughput: string
  power: string
  inputPort: PortSide
  outputPort: PortSide
}

export interface ResourceProjectMetadata {
  format: string
  name: string
  modelReference?: string
  material?: string
  accent?: string
  partCount?: number
}

interface UnknownRecord {
  [key: string]: unknown
}

export async function importResourcePack(projectFile: File, modelFile: File, form: ResourceImportForm): Promise<ImportedResource> {
  const raw = JSON.parse(await projectFile.text()) as unknown
  if (!isRecord(raw)) throw new Error('资源定义不是有效 JSON 对象')

  const metadata = readProjectMetadata(raw)
  const warnings: string[] = []
  const modelReference = metadata.modelReference
  if (modelReference && baseName(modelReference) !== baseName(modelFile.name)) {
    warnings.push(`JSON 引用了 ${modelReference}，当前选择的是 ${modelFile.name}`)
  }
  if (metadata.format === 'forgemind-project' && !modelReference) {
    warnings.push('这是 ForgeMind 项目文件，未声明 modelReference；当前模型将按手动选择使用')
  }
  if (modelFile.size === 0) throw new Error('GLB 文件为空')
  if (modelFile.size > 80 * 1024 * 1024) throw new Error('GLB 文件超过 80 MB 导入上限')

  const id = normalizeId(form.id || metadata.name || modelFile.name)
  const modelUrl = URL.createObjectURL(modelFile)
  let previewDataUrl = ''
  try {
    previewDataUrl = await renderModelCover(modelFile, form.name || metadata.name, metadata.accent ?? '#d7ac37')
  } catch (error) {
    URL.revokeObjectURL(modelUrl)
    throw new Error(`模型解析失败：${error instanceof Error ? error.message : 'GLB 无法读取'}`)
  }

  const objectDef: ObjectDef = {
    type: 'imported',
    role: form.role,
    category: form.category,
    label: form.name.trim() || metadata.name || '导入设备',
    subtitle: form.subtitle.trim() || 'IMPORTED RESOURCE',
    function: form.description.trim() || '来自 Hub 资源包的可建造设备。',
    model: `IMPORTED / ${id.toUpperCase()}`,
    assetPath: modelUrl,
    assetKind: 'detailed-process',
    footprint: { w: Math.max(1, Math.round(form.width)), d: Math.max(1, Math.round(form.depth)) },
    color: '#536e78',
    accent: metadata.accent ?? '#d7ac37',
    height: Math.max(0.2, form.height),
    throughput: form.throughput.trim() || '—',
    power: form.power.trim() || '—',
    inputs: ['工艺输入'],
    outputs: ['工艺输出'],
    inputPort: form.inputPort,
    outputPort: form.outputPort,
  }

  return {
    id,
    name: objectDef.label,
    modelFileName: modelFile.name,
    sourceFileName: projectFile.name,
    sourceFormat: metadata.format,
    previewDataUrl,
    objectDef,
    warnings,
    importedAt: new Date().toISOString(),
  }
}

function readProjectMetadata(raw: UnknownRecord): ResourceProjectMetadata {
  const format = typeof raw.format === 'string' ? raw.format : 'unknown'
  const name = typeof raw.name === 'string' ? raw.name : 'ForgeMind 导入设备'
  const modelReference = typeof raw.modelReference === 'string'
    ? raw.modelReference
    : isRecord(raw.model) && typeof raw.model.path === 'string'
      ? raw.model.path
      : undefined
  return {
    format,
    name,
    modelReference,
    material: typeof raw.material === 'string' ? raw.material : undefined,
    accent: typeof raw.accent === 'string' ? raw.accent : undefined,
    partCount: Array.isArray(raw.parts) ? raw.parts.length : undefined,
  }
}

async function renderModelCover(file: File, label: string, accent: string): Promise<string> {
  const buffer = await file.arrayBuffer()
  return new Promise<string>((resolve, reject) => {
    const loader = new GLTFLoader()
    loader.parse(buffer, '', (gltf) => {
      try {
        const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: true })
        renderer.setPixelRatio(1)
        renderer.setSize(640, 360, false)
        renderer.outputColorSpace = THREE.SRGBColorSpace
        renderer.setClearColor('#e7efec', 1)

        const scene = new THREE.Scene()
        scene.add(new THREE.HemisphereLight('#f5fbf8', '#61736d', 2.2))
        const keyLight = new THREE.DirectionalLight('#ffffff', 3.2)
        keyLight.position.set(4, 7, 5)
        scene.add(keyLight)
        const rimLight = new THREE.DirectionalLight(accent, 1.4)
        rimLight.position.set(-4, 3, -5)
        scene.add(rimLight)

        const model = gltf.scene
        const bounds = new THREE.Box3().setFromObject(model)
        const size = bounds.getSize(new THREE.Vector3())
        const center = bounds.getCenter(new THREE.Vector3())
        const maxDimension = Math.max(size.x, size.y, size.z, 0.001)
        model.position.sub(center)
        model.scale.setScalar(2.55 / maxDimension)
        model.traverse((node) => {
          if (node instanceof THREE.Mesh) {
            node.castShadow = false
            node.receiveShadow = false
          }
        })
        scene.add(model)

        const camera = new THREE.PerspectiveCamera(28, 640 / 360, 0.01, 100)
        camera.position.set(4.2, 2.7, 4.2)
        camera.lookAt(0, 0, 0)
        renderer.render(scene, camera)
        const cover = renderer.domElement.toDataURL('image/png')
        renderer.dispose()
        disposeModel(model)
        resolve(cover)
      } catch (error) {
        reject(error)
      }
    }, (error) => reject(error instanceof Error ? error : new Error('GLB 解析失败')))
  }).catch(() => createFallbackCover(label, accent))
}

function disposeModel(model: THREE.Object3D): void {
  model.traverse((node) => {
    if (!(node instanceof THREE.Mesh)) return
    node.geometry.dispose()
    const materials = Array.isArray(node.material) ? node.material : [node.material]
    materials.forEach((material) => material.dispose())
  })
}

function createFallbackCover(label: string, accent: string): string {
  const canvas = document.createElement('canvas')
  canvas.width = 640
  canvas.height = 360
  const context = canvas.getContext('2d')
  if (!context) return ''
  context.fillStyle = '#e7efec'
  context.fillRect(0, 0, canvas.width, canvas.height)
  context.strokeStyle = accent
  context.lineWidth = 3
  context.strokeRect(28, 28, canvas.width - 56, canvas.height - 56)
  context.fillStyle = '#263b3b'
  context.font = '600 24px monospace'
  context.fillText('MODEL PREVIEW / FALLBACK', 50, 80)
  context.fillStyle = accent
  context.font = '400 30px sans-serif'
  context.fillText(label.slice(0, 24), 50, 170)
  return canvas.toDataURL('image/png')
}

function normalizeId(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/\.[a-z0-9_-]+$/iu, '')
    .replace(/[^a-z0-9\u4e00-\u9fff]+/giu, '-')
    .replace(/^-+|-+$/g, '')
  return normalized || `imported-${Date.now()}`
}

function baseName(value: string): string {
  return value.split(/[\\/]/u).pop()?.replace(/\.[^.]+$/u, '').trim().toLowerCase() ?? ''
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
