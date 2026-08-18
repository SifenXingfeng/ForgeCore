import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'

const ROOT = '/3d/vendor/kenney-factory-kit-3.0/Models/GLB%20format/'
const loader = new GLTFLoader()

const candidates = [
  { id: 'a', title: 'A · 工业机械臂 A', type: '单模型', description: '动作结构最明显，适合装配、焊接或搬运机器。', parts: [{ file: 'robot-arm-a.glb', width: 2.55 }] },
  { id: 'b', title: 'B · 工业机械臂 B', type: '单模型', description: '轮廓更紧凑，适合精密加工或小型装配工位。', parts: [{ file: 'robot-arm-b.glb', width: 2.45 }] },
  { id: 'c', title: 'C · 平台机械臂单元', type: '组合方案', description: '机器平台与机械臂组合，最像完整可落地的加工设备。', layout: 'stack', parts: [{ file: 'machine-bed.glb', width: 3.25, role: 'base' }, { file: 'robot-arm-a.glb', width: 1.85, role: 'upper' }] },
  { id: 'd', title: 'D · 紧凑机械臂单元', type: '组合方案', description: '平台加紧凑机械臂，视觉重量较轻，适合小型产线。', layout: 'stack', parts: [{ file: 'machine-bed.glb', width: 3.15, role: 'base' }, { file: 'robot-arm-b.glb', width: 1.78, role: 'upper' }] },
  { id: 'e', title: 'E · 强化加工设备', type: '已选用 · 正式模型', recommended: true, description: 'ForgeCore 正式通用机器视觉底座，运行时叠加内部输送、黑帘、红光和端口标识。', parts: [{ file: 'machine-fortified.glb', width: 3.05 }] },
  { id: 'f', title: 'F · 可视化加工舱', type: '单模型', description: '带观察结构的封闭设备，适合检测、加工或包装工序。', parts: [{ file: 'machine-window.glb', width: 3.05 }] },
  { id: 'g', title: 'G · 料斗加工单元', type: '组合方案', description: '平台与方形料斗组合，适合熔炼、混合、投料或灌装。', layout: 'stack', parts: [{ file: 'machine-bed.glb', width: 3.15, role: 'base' }, { file: 'hopper-square.glb', width: 1.95, role: 'upper' }] },
  { id: 'h', title: 'H · 双机械臂工作站', type: '组合方案', description: '两个机械臂共享平台，机械感最强，适合复杂装配单元。', layout: 'twin', parts: [{ file: 'machine-bed.glb', width: 3.45, role: 'base' }, { file: 'robot-arm-a.glb', width: 1.48, role: 'upper', offsetX: -0.72 }, { file: 'robot-arm-b.glb', width: 1.42, role: 'upper', offsetX: 0.76 }] },
]

const loadModel = (file) => new Promise((resolve, reject) => loader.load(`${ROOT}${file}`, (gltf) => resolve(gltf.scene), undefined, reject))

function normalize(object, targetWidth) {
  object.traverse((node) => {
    if (!node.isMesh) return
    node.castShadow = true
    node.receiveShadow = true
  })
  const box = new THREE.Box3().setFromObject(object)
  const size = box.getSize(new THREE.Vector3())
  const scale = targetWidth / Math.max(size.x, size.z, 0.001)
  object.scale.setScalar(scale)
  object.updateMatrixWorld(true)
  const scaled = new THREE.Box3().setFromObject(object)
  const center = scaled.getCenter(new THREE.Vector3())
  object.position.x -= center.x
  object.position.z -= center.z
  object.position.y -= scaled.min.y
  object.updateMatrixWorld(true)
  return object
}

async function buildCandidate(candidate) {
  const group = new THREE.Group()
  const loaded = await Promise.all(candidate.parts.map(async (part) => ({ part, object: normalize(await loadModel(part.file), part.width) })))
  const base = loaded.find(({ part }) => part.role === 'base')
  const baseTop = base ? new THREE.Box3().setFromObject(base.object).max.y : 0
  for (const { part, object } of loaded) {
    if (part.role === 'upper') object.position.y += Math.max(0, baseTop - 0.03)
    object.position.x += part.offsetX ?? 0
    group.add(object)
  }
  return group
}

async function renderCandidate(candidate, host) {
  const scene = new THREE.Scene()
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true })
  renderer.setPixelRatio(1.5)
  renderer.setSize(host.clientWidth, host.clientHeight, false)
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFShadowMap
  host.append(renderer.domElement)

  scene.add(new THREE.HemisphereLight('#ffffff', '#7f857d', 2.25))
  const key = new THREE.DirectionalLight('#fff7df', 4.5)
  key.position.set(4, 7, 5)
  key.castShadow = true
  key.shadow.mapSize.set(1024, 1024)
  scene.add(key)
  const fill = new THREE.DirectionalLight('#dbe4ef', 1.5)
  fill.position.set(-4, 3, -2)
  scene.add(fill)

  const model = await buildCandidate(candidate)
  scene.add(model)
  const box = new THREE.Box3().setFromObject(model)
  const size = box.getSize(new THREE.Vector3())
  const center = box.getCenter(new THREE.Vector3())

  const floor = new THREE.Mesh(new THREE.CircleGeometry(Math.max(2.5, Math.max(size.x, size.z) * 0.85), 64), new THREE.MeshStandardMaterial({ color: '#d2d6d0', roughness: 0.9, metalness: 0.05 }))
  floor.rotation.x = -Math.PI / 2
  floor.position.y = -0.025
  floor.receiveShadow = true
  scene.add(floor)

  const aspect = host.clientWidth / host.clientHeight
  const view = Math.max(3.6, size.x * 1.3, size.z * 1.3, size.y * 1.55)
  const camera = new THREE.OrthographicCamera(-view * aspect / 2, view * aspect / 2, view / 2, -view / 2, 0.1, 100)
  camera.position.set(center.x + 5, Math.max(3.2, center.y + 3.6), center.z + 6)
  camera.lookAt(center.x, Math.max(0.65, center.y * 0.8), center.z)
  camera.updateProjectionMatrix()
  renderer.render(scene, camera)
}

const gallery = document.querySelector('#gallery')
for (const candidate of candidates.slice(0, 6)) {
  const article = document.createElement('article')
  article.innerHTML = `<div class="viewport"><span class="badge ${candidate.recommended ? 'recommended' : ''}">${candidate.type}</span></div><div class="copy"><strong>${candidate.title}</strong><small>KENNEY FACTORY KIT 3.0 · CC0</small><p>${candidate.description}</p></div>`
  gallery.append(article)
  try {
    await renderCandidate(candidate, article.querySelector('.viewport'))
    article.dataset.rendered = 'true'
  } catch (error) {
    article.querySelector('.viewport').insertAdjacentHTML('beforeend', `<div class="error">模型加载失败：${String(error)}</div>`)
  }
}
window.__GALLERY_READY__ = true
