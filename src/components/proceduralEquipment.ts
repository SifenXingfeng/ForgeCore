import * as THREE from 'three'
import type { ObjectDef } from '../game/types'

/**
 * 精细程序化设备建模（Three.js 原生）。
 * 使用倒角几何体、螺栓阵列、散热片、管道等细节零件构建高精度模型。
 * 每个设备返回 { group, update } —— update 包含机械动画 + 工件「原料→成品」状态变化。
 */

export interface ProceduralModel {
  group: THREE.Group
  update?: (t: number, dt: number) => void
}

// ==================== 精细化辅助函数 ====================

/** 物理金属材质（带清漆层） */
function pmetal(color: string, roughness = 0.45, metalness = 0.85, clearcoat = 0.3): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(color),
    roughness,
    metalness,
    clearcoat,
    clearcoatRoughness: 0.3,
    envMapIntensity: 1.2,
  })
}

/** 自发光材质 */
function pemissive(color: string, intensity = 0.4): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({
    color: new THREE.Color(color),
    roughness: 0.3,
    metalness: 0.4,
    emissive: new THREE.Color(color),
    emissiveIntensity: intensity,
  })
  return m
}

/** 玻璃材质（带透射） */
function pglass(color: string, opacity = 0.35): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(color),
    roughness: 0.08,
    metalness: 0.1,
    transmission: 0.85,
    transparent: true,
    opacity,
    ior: 1.45,
    thickness: 0.02,
    envMapIntensity: 1.5,
  })
}

/** 倒角盒子（带圆角和斜边） */
function roundedBox(w: number, h: number, d: number, r: number, mat: THREE.Material): THREE.Mesh {
  const radius = Math.min(r, w / 2 - 0.001, h / 2 - 0.001)
  const shape = new THREE.Shape()
  const hw = w / 2, hh = h / 2
  shape.moveTo(-hw + radius, -hh)
  shape.lineTo(hw - radius, -hh)
  shape.quadraticCurveTo(hw, -hh, hw, -hh + radius)
  shape.lineTo(hw, hh - radius)
  shape.quadraticCurveTo(hw, hh, hw - radius, hh)
  shape.lineTo(-hw + radius, hh)
  shape.quadraticCurveTo(-hw, hh, -hw, hh - radius)
  shape.lineTo(-hw, -hh + radius)
  shape.quadraticCurveTo(-hw, -hh, -hw + radius, -hh)
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: d,
    bevelEnabled: true,
    bevelThickness: Math.min(r * 0.4, d * 0.15),
    bevelSize: Math.min(r * 0.4, d * 0.15),
    bevelSegments: 2,
  })
  geo.translate(0, 0, -d / 2)
  geo.computeVertexNormals()
  const mesh = new THREE.Mesh(geo, mat)
  mesh.castShadow = true
  mesh.receiveShadow = true
  return mesh
}

/** 普通盒子（无倒角） */
function box(w: number, h: number, d: number, mat: THREE.Material): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat)
  mesh.castShadow = true
  mesh.receiveShadow = true
  return mesh
}

/** 圆柱（高面数） */
function cylinder(r: number, h: number, mat: THREE.Material, segments = 24): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, segments), mat)
  mesh.castShadow = true
  mesh.receiveShadow = true
  return mesh
}

/** 六角螺栓 */
function bolt(r: number, h: number, mat: THREE.Material): THREE.Group {
  const g = new THREE.Group()
  const head = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h * 0.35, 6), mat)
  head.castShadow = true
  g.add(head)
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.5, r * 0.5, h * 0.65, 16), mat)
  shaft.position.y = -h * 0.5
  shaft.castShadow = true
  g.add(shaft)
  return g
}

/** 散热片阵列 */
function heatsink(width: number, height: number, count: number, depth: number, mat: THREE.Material): THREE.Group {
  const g = new THREE.Group()
  const finW = 0.018
  const totalSpace = width - finW * count
  const spacing = totalSpace / Math.max(count - 1, 1)
  for (let i = 0; i < count; i++) {
    const fin = box(finW, height, depth, mat)
    fin.position.x = -width / 2 + finW / 2 + i * (finW + spacing)
    g.add(fin)
  }
  return g
}

/** 直管道 */
function pipe(start: THREE.Vector3, end: THREE.Vector3, radius: number, mat: THREE.Material): THREE.Mesh {
  const curve = new THREE.LineCurve3(start, end)
  const geo = new THREE.TubeGeometry(curve, 1, radius, 16, false)
  const mesh = new THREE.Mesh(geo, mat)
  mesh.castShadow = true
  return mesh
}

/** 警示标贴（带条纹纹理） */
function warningStrip(w: number, h: number): THREE.Mesh {
  const canvas = document.createElement('canvas')
  canvas.width = 128
  canvas.height = 16
  const ctx = canvas.getContext('2d')!
  for (let i = 0; i < 8; i++) {
    ctx.fillStyle = i % 2 === 0 ? '#f4c20d' : '#1a1a1a'
    ctx.fillRect(i * 16, 0, 16, 16)
  }
  const texture = new THREE.CanvasTexture(canvas)
  texture.wrapS = THREE.RepeatWrapping
  texture.repeat.set(w * 2, 1)
  const stripeMat = new THREE.MeshStandardMaterial({
    map: texture,
    roughness: 0.6,
    metalness: 0.3,
    emissive: new THREE.Color(0xf4c20d),
    emissiveIntensity: 0.15,
    emissiveMap: texture,
  })
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), stripeMat)
  return mesh
}

/** 螺栓阵列（四角） */
function boltCorners(w: number, d: number, y: number, mat: THREE.Material): THREE.Group {
  const g = new THREE.Group()
  for (const x of [-1, 1]) {
    for (const z of [-1, 1]) {
      const b = bolt(0.022, 0.06, mat)
      b.position.set(x * (w / 2 - 0.05), y, z * (d / 2 - 0.05))
      g.add(b)
    }
  }
  return g
}

// ==================== 精细化扩展 helper ====================

/** 铝型材方通（4040/4080 欧标，带凹槽截面） */
function aluminumExtrusion(length: number, profile = 0.04): THREE.Group {
  const g = new THREE.Group()
  const mat = pmetal('#d8dde0', 0.25, 0.92, 0.55)
  // 主体（带凹槽的方管）
  const shape = new THREE.Shape()
  const hw = profile / 2, hh = profile / 2, groove = profile * 0.18
  shape.moveTo(-hw, -hh)
  shape.lineTo(hw, -hh)
  shape.lineTo(hw, -hh + groove)
  shape.lineTo(hw - groove, -hh + groove)
  shape.lineTo(hw - groove, hh - groove)
  shape.lineTo(hw, hh - groove)
  shape.lineTo(hw, hh)
  shape.lineTo(-hw, hh)
  shape.lineTo(-hw, hh - groove)
  shape.lineTo(-hw + groove, hh - groove)
  shape.lineTo(-hw + groove, -hh + groove)
  shape.lineTo(-hw, -hh + groove)
  shape.lineTo(-hw, -hh)
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: length,
    bevelEnabled: false,
  })
  geo.translate(0, 0, -length / 2)
  geo.computeVertexNormals()
  const main = new THREE.Mesh(geo, mat)
  main.castShadow = true
  main.receiveShadow = true
  g.add(main)
  // 内部凹槽（4 条 T 型槽的视觉指示）
  const slotMat = pmetal('#1a1f1d', 0.5, 0.7, 0.2)
  for (const [sx, sy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
    const slot = box(profile * 0.15, profile * 0.08, length, slotMat)
    slot.position.set(sx * (hw - groove / 2), sy * (hh - groove / 2), 0)
    if (sx !== 0) slot.rotation.z = Math.PI / 2
    g.add(slot)
  }
  return g
}

void aluminumExtrusion

/** 三色警示灯（封装重复逻辑） */
function stackLight(position: [number, number, number], colors: string[] = ['#e02222', '#f4c20d', '#5cb85c']): {
  group: THREE.Group
  materials: THREE.MeshStandardMaterial[]
} {
  const g = new THREE.Group()
  const baseMat = pmetal('#1a1f1d', 0.4, 0.8, 0.3)
  const base = cylinder(0.04, 0.04, baseMat, 16)
  base.position.y = 0.02
  g.add(base)
  // 立柱
  const pole = cylinder(0.012, 0.08, pmetal('#3a4543', 0.4, 0.85, 0.3), 16)
  pole.position.y = 0.08
  g.add(pole)
  // 灯罩段
  const materials: THREE.MeshStandardMaterial[] = []
  colors.forEach((c, i) => {
    const mat = pemissive(c, 0.3)
    const lamp = cylinder(0.035, 0.05, mat, 24)
    lamp.position.y = 0.14 + i * 0.055
    g.add(lamp)
    materials.push(mat)
    // 灯罩隔环
    const ring = cylinder(0.038, 0.008, baseMat, 16)
    ring.position.y = 0.14 + i * 0.055 - 0.03
    g.add(ring)
  })
  // 顶帽
  const cap = cylinder(0.036, 0.02, baseMat, 16)
  cap.position.y = 0.14 + colors.length * 0.055 + 0.01
  g.add(cap)
  g.position.set(...position)
  return { group: g, materials }
}

/** 圆盘式刀库（圆盘 + 刀套阵列） */
function discToolMagazine(count: number, radius: number, mat: THREE.Material): {
  group: THREE.Group
  disc: THREE.Mesh
  toolHolders: THREE.Mesh[]
} {
  const g = new THREE.Group()
  // 圆盘主体
  const disc = cylinder(radius, 0.06, mat, 48)
  disc.rotation.x = Math.PI / 2
  g.add(disc)
  // 中心轮毂
  const hubMat = pmetal('#5a6a66', 0.4, 0.85, 0.3)
  const hub = cylinder(radius * 0.25, 0.1, hubMat, 32)
  hub.rotation.x = Math.PI / 2
  hub.position.z = 0.04
  g.add(hub)
  // 刀套阵列
  const holderMat = pmetal('#9da9a3', 0.3, 0.9, 0.5)
  const toolHolders: THREE.Mesh[] = []
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2
    const holder = new THREE.Mesh(
      new THREE.CylinderGeometry(0.018, 0.022, 0.08, 16),
      holderMat,
    )
    holder.castShadow = true
    holder.position.set(Math.cos(angle) * radius * 0.85, 0, Math.sin(angle) * radius * 0.85 + 0.04)
    g.add(holder)
    toolHolders.push(holder)
    // 刀具（每个刀套内一个刀柄）
    const toolMat = pmetal('#a1aca7', 0.2, 0.95, 0.5)
    const tool = cylinder(0.012, 0.06, toolMat, 16)
    tool.position.set(Math.cos(angle) * radius * 0.85, -0.07, Math.sin(angle) * radius * 0.85 + 0.04)
    g.add(tool)
  }
  return { group: g, disc, toolHolders }
}

/** 粒子喷洒（冷却液/切屑） */
function particleSpray(
  origin: THREE.Vector3,
  dir: THREE.Vector3,
  count: number,
  mat: THREE.Material,
): { points: THREE.Points; velocities: THREE.Vector3[]; positions: Float32Array } {
  const positions = new Float32Array(count * 3)
  const velocities: THREE.Vector3[] = []
  for (let i = 0; i < count; i++) {
    positions[i * 3] = origin.x
    positions[i * 3 + 1] = origin.y
    positions[i * 3 + 2] = origin.z
    // 随机散射方向（围绕主方向 ± 25°）
    const spread = 0.4
    const v = dir.clone().normalize()
    v.x += (Math.random() - 0.5) * spread
    v.y += (Math.random() - 0.5) * spread * 0.5
    v.z += (Math.random() - 0.5) * spread
    v.multiplyScalar(0.3 + Math.random() * 0.4)
    velocities.push(v)
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  const points = new THREE.Points(geo, mat)
  points.frustumCulled = false
  return { points, velocities, positions }
}

// ==================== 工件状态机 ====================

interface Workpiece {
  mesh: THREE.Mesh
  setProgress: (p: number) => void
}

const RAW_COLOR = '#8a9088'
const FINISHED_COLOR = '#d4af6a'

function lerpColor(a: THREE.Color, b: THREE.Color, t: number, out: THREE.Color): THREE.Color {
  out.r = a.r + (b.r - a.r) * t
  out.g = a.g + (b.g - a.g) * t
  out.b = a.b + (b.b - a.b) * t
  return out
}

function createWorkpiece(opts: {
  geometry: 'box' | 'cylinder' | 'rounded'
  size: number[]
  position: [number, number, number]
  rawColor?: string
  finishedColor?: string
}): Workpiece {
  const { geometry, size, position } = opts
  const rawColor = opts.rawColor ?? RAW_COLOR
  const finishedColor = opts.finishedColor ?? FINISHED_COLOR

  let geo: THREE.BufferGeometry
  if (geometry === 'box') {
    geo = new THREE.BoxGeometry(size[0], size[1], size[2])
  } else if (geometry === 'rounded') {
    const shape = new THREE.Shape()
    const w = size[0], h = size[1], r = Math.min(size[1] * 0.25, 0.04)
    const hw = w / 2, hh = h / 2
    shape.moveTo(-hw + r, -hh)
    shape.lineTo(hw - r, -hh)
    shape.quadraticCurveTo(hw, -hh, hw, -hh + r)
    shape.lineTo(hw, hh - r)
    shape.quadraticCurveTo(hw, hh, hw - r, hh)
    shape.lineTo(-hw + r, hh)
    shape.quadraticCurveTo(-hw, hh, -hw, hh - r)
    shape.lineTo(-hw, -hh + r)
    shape.quadraticCurveTo(-hw, -hh, -hw + r, -hh)
    geo = new THREE.ExtrudeGeometry(shape, { depth: size[2], bevelEnabled: true, bevelThickness: 0.01, bevelSize: 0.01, bevelSegments: 2 })
    geo.translate(0, 0, -size[2] / 2)
  } else {
    geo = new THREE.CylinderGeometry(size[0], size[0], size[1], 24)
  }

  const mat = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(rawColor),
    roughness: 0.75,
    metalness: 0.35,
    emissive: new THREE.Color(0x000000),
    emissiveIntensity: 0,
    clearcoat: 0.2,
    clearcoatRoughness: 0.4,
  })
  const mesh = new THREE.Mesh(geo, mat)
  mesh.position.set(...position)
  mesh.castShadow = true
  mesh.receiveShadow = true

  const raw = new THREE.Color(rawColor)
  const finished = new THREE.Color(finishedColor)

  return {
    mesh,
    setProgress: (p: number) => {
      lerpColor(raw, finished, p, mat.color)
      mat.emissive.copy(finished)
      mat.emissiveIntensity = Math.max(0, p - 0.5) * 0.7
      mat.roughness = 0.75 - p * 0.35
      mat.metalness = 0.35 + p * 0.4
      mat.clearcoat = 0.2 + p * 0.4
      const s = 0.92 + p * 0.12
      mesh.scale.setScalar(s)
    },
  }
}

function computeCycle(t: number, period = 10): { progress: number; offset: number } {
  const cycle = (t % period) / period
  if (cycle < 0.15) {
    const k = cycle / 0.15
    return { progress: 0, offset: -0.6 * (1 - k) }
  } else if (cycle < 0.85) {
    const k = (cycle - 0.15) / 0.7
    return { progress: k, offset: 0 }
  } else {
    const k = (cycle - 0.85) / 0.15
    return { progress: 1, offset: 0.6 * k }
  }
}

// ==================== 通用组件 ====================

function createBase(width = 1.6, depth = 1.6): THREE.Group {
  const g = new THREE.Group()
  const baseMat = pmetal('#5f706b', 0.65, 0.5, 0.15)
  const topMat = pmetal('#a1ada7', 0.45, 0.7, 0.35)
  const footMat = pmetal('#d2dad4', 0.35, 0.9, 0.4)
  const boltMat = pmetal('#9da9a3', 0.3, 0.9, 0.5)

  const top = roundedBox(width, 0.14, depth, 0.02, baseMat)
  top.position.y = 0.07
  g.add(top)
  // 顶板内嵌装饰
  const inset = roundedBox(width - 0.1, 0.04, depth - 0.1, 0.015, topMat)
  inset.position.y = 0.15
  g.add(inset)
  // 四角支脚（圆柱）
  for (const x of [-1, 1]) {
    for (const z of [-1, 1]) {
      const foot = cylinder(0.06, 0.08, footMat, 24)
      foot.position.set(x * (width / 2 - 0.16), 0.2, z * (depth / 2 - 0.16))
      g.add(foot)
      // 支脚上的橡胶垫
      const pad = cylinder(0.05, 0.02, new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.9, metalness: 0.1 }), 16)
      pad.position.set(x * (width / 2 - 0.16), 0.16, z * (depth / 2 - 0.16))
      g.add(pad)
    }
  }
  // 底座四角螺栓
  g.add(boltCorners(width - 0.08, depth - 0.08, 0.15, boltMat))
  return g
}

function createControlCabinet(position: [number, number, number], accent: string): THREE.Group {
  const g = new THREE.Group()
  g.position.set(...position)
  const bodyMat = pmetal('#2d3735', 0.4, 0.85, 0.4)
  const screenMat = pemissive(accent, 0.4)
  const handleMat = pmetal('#7f8b85', 0.3, 0.9, 0.5)
  const boltMat = pmetal('#9da9a3', 0.3, 0.9, 0.5)

  // 柜体（倒角）
  const body = roundedBox(0.3, 0.64, 0.22, 0.015, bodyMat)
  g.add(body)
  // 散热口（侧面）
  const vents = heatsink(0.5, 0.32, 12, 0.02, pmetal('#1a2322', 0.6, 0.5, 0.1))
  vents.rotation.y = Math.PI / 2
  vents.position.set(0.12, 0.05, 0)
  g.add(vents)
  // 屏幕
  const screen = roundedBox(0.17, 0.15, 0.005, 0.005, screenMat)
  screen.position.set(0, 0.12, 0.115)
  g.add(screen)
  // 屏幕边框
  const bezel = roundedBox(0.19, 0.17, 0.003, 0.005, pmetal('#1a2322', 0.5, 0.7, 0.2))
  bezel.position.set(0, 0.12, 0.113)
  g.add(bezel)
  // 按钮（3 个）
  const btnColors = ['#d34c3f', '#f4c20d', '#5cb85c']
  btnColors.forEach((c, i) => {
    const btn = cylinder(0.018, 0.012, pemissive(c, 0.2), 20)
    btn.rotation.x = Math.PI / 2
    btn.position.set(-0.04 + i * 0.04, -0.08, 0.118)
    g.add(btn)
  })
  // 把手
  const handle = cylinder(0.022, 0.18, handleMat, 20)
  handle.position.set(0, 0.28, 0.002)
  g.add(handle)
  // 四角螺栓
  g.add(boltCorners(0.28, 0.2, 0.32, boltMat))
  return g
}

// ==================== 各设备精细建模 ====================

function createPress(def: ObjectDef): ProceduralModel {
  const g = createBase(1.8, 1.75)
  g.position.y = 0.15
  const guideMat = pmetal('#9ba7a1', 0.25, 0.95, 0.4)
  const bodyMat = pmetal(def.color, 0.4, 0.75, 0.3)
  const accentMat = pemissive(def.accent, 0.25)
  const darkMat = pmetal('#2a3432', 0.5, 0.8, 0.3)
  const boltMat = pmetal('#9da9a3', 0.3, 0.9, 0.5)

  // 导柱（抛光镀铬）
  for (const x of [-0.55, 0.55]) {
    const pillar = cylinder(0.09, 1.45, guideMat, 32)
    pillar.position.set(x, 0.78, 0)
    g.add(pillar)
    // 导柱顶部法兰
    const flange = cylinder(0.14, 0.04, bodyMat, 24)
    flange.position.set(x, 1.52, 0)
    g.add(flange)
  }

  // 压头组
  const ram = new THREE.Group()
  const topPlate = roundedBox(1.5, 0.28, 1.25, 0.03, bodyMat)
  topPlate.position.y = 1.38
  ram.add(topPlate)
  // 冲头（带斜面）
  const stampGeo = new THREE.CylinderGeometry(0.55, 0.48, 0.08, 32)
  const stamp = new THREE.Mesh(stampGeo, accentMat)
  stamp.position.y = 1.56
  stamp.castShadow = true
  ram.add(stamp)
  // 冲头底部凸模
  const punch = roundedBox(0.9, 0.06, 0.7, 0.01, darkMat)
  punch.position.y = 1.62
  ram.add(punch)
  // 上压板螺栓阵列
  for (const x of [-0.6, 0.6]) {
    for (const z of [-0.5, 0.5]) {
      const b = bolt(0.025, 0.06, boltMat)
      b.position.set(x, 1.52, z)
      ram.add(b)
    }
  }
  g.add(ram)

  // 工作台
  const table = roundedBox(0.7, 0.12, 0.65, 0.02, darkMat)
  table.position.set(0, 0.4, 0)
  g.add(table)
  // 工作台 T 型槽
  for (const z of [-0.18, 0, 0.18]) {
    const slot = box(0.6, 0.02, 0.025, pmetal('#1a2322', 0.6, 0.5, 0.1))
    slot.position.set(0, 0.465, z)
    g.add(slot)
  }

  // 液压泵站
  const pump = cylinder(0.2, 0.3, pmetal('#b4bfba', 0.25, 0.9, 0.4), 32)
  pump.position.set(0, 0.58, 0.46)
  g.add(pump)
  // 泵站散热片
  const pumpFins = heatsink(0.3, 0.22, 10, 0.04, pmetal('#1a2322', 0.5, 0.7, 0.2))
  pumpFins.position.set(0, 0.58, 0.62)
  g.add(pumpFins)
  // 液压管路
  const pipeMat = pmetal('#3a4543', 0.4, 0.8, 0.3)
  g.add(pipe(new THREE.Vector3(0, 0.72, 0.46), new THREE.Vector3(0, 1.0, 0.46), 0.022, pipeMat))
  g.add(pipe(new THREE.Vector3(0, 1.0, 0.46), new THREE.Vector3(0, 1.2, 0.2), 0.022, pipeMat))

  // 阀组
  const valveBody = roundedBox(0.18, 0.75, 0.45, 0.02, pmetal('#3b4744', 0.4, 0.85, 0.3))
  valveBody.position.set(0.75, 0.55, -0.3)
  g.add(valveBody)
  // 阀组指示灯
  for (let i = 0; i < 3; i++) {
    const lightColor = ['#5cb85c', '#f4c20d', '#d34c3f'][i]
    const valveLight = cylinder(0.012, 0.02, pemissive(lightColor, 0.5), 16)
    valveLight.rotation.x = Math.PI / 2
    valveLight.position.set(0.77, 0.75 + i * 0.08, -0.085)
    g.add(valveLight)
  }

  g.add(createControlCabinet([0.85, 0.56, 0.34], def.accent))

  // 警示条
  const stripe = warningStrip(1.4, 0.04)
  stripe.position.set(0, 0.2, 0.63)
  stripe.rotation.x = -Math.PI / 2
  g.add(stripe)

  // 工件
  const workpiece = createWorkpiece({
    geometry: 'rounded',
    size: [0.45, 0.08, 0.35],
    position: [0, 0.48, 0],
  })
  g.add(workpiece.mesh)

  return {
    group: g,
    update: (t) => {
      const phase = (t * 2.1) % (Math.PI * 2)
      const pressAmount = Math.max(0, Math.sin(phase)) * 0.09
      ram.position.y = -pressAmount
      const { progress, offset } = computeCycle(t, 10)
      workpiece.setProgress(progress)
      workpiece.mesh.position.x = offset
      workpiece.mesh.position.y = 0.48 + Math.max(0, Math.sin(phase)) * 0.02
    },
  }
}

function createCncCell(def: ObjectDef): ProceduralModel {
  // 数控加工中心：2.0×1.4×1.85m，铸铁底座+立柱+主轴+圆盘刀库+拖链+粒子冷却
  const g = new THREE.Group()
  g.position.y = 0.18

  // ---------- 全局材质 ----------
  const bodyMat = pmetal(def.color, 0.4, 0.78, 0.32)
  const bodyDark = pmetal('#1a2422', 0.45, 0.8, 0.25)
  const ironMat = pmetal('#3a4240', 0.55, 0.7, 0.2)
  const alumMat = pmetal('#d8dde0', 0.25, 0.92, 0.55)
  const alumDark = pmetal('#9da9a3', 0.35, 0.88, 0.4)
  const steelMat = pmetal('#a1aca7', 0.22, 0.95, 0.55)
  const boltMat = pmetal('#a9b3af', 0.28, 0.92, 0.55)
  const motorMat = pmetal('#2255bb', 0.3, 0.9, 0.45)
  const motorDark = pmetal('#163b87', 0.42, 0.82, 0.3)
  const beltMat = new THREE.MeshPhysicalMaterial({ color: 0xf6c845, roughness: 0.68, metalness: 0.25, clearcoat: 0.2 })
  const darkMat = pmetal('#1a2422', 0.5, 0.75, 0.2)
  const glassMat = pglass('#1e302f', 0.4)

  // ---------- 1. 底座 + 接水盘 + 支脚 ----------
  const base = roundedBox(1.9, 0.4, 1.3, 0.02, ironMat)
  base.position.y = 0.2
  g.add(base)
  const drainPan = roundedBox(1.8, 0.08, 1.2, 0.015, bodyDark)
  drainPan.position.y = 0.44
  g.add(drainPan)
  for (const [cx, cz] of [[-0.85, -0.55], [0.85, -0.55], [-0.85, 0.55], [0.85, 0.55]] as const) {
    const foot = cylinder(0.04, 0.12, ironMat, 16)
    foot.position.set(cx, 0.06, cz)
    g.add(foot)
  }

  // ---------- 2. 立柱 + 观察窗 ----------
  const column = roundedBox(0.5, 1.5, 0.7, 0.02, bodyMat)
  column.position.set(0, 1.0, -0.4)
  g.add(column)
  const colWindow = roundedBox(0.35, 0.5, 0.005, 0.01, glassMat)
  colWindow.position.set(0, 1.1, -0.05)
  g.add(colWindow)

  // ---------- 3. 鞍座 + 工作台 + T 槽 ----------
  const saddleGroup = new THREE.Group()
  const saddle = roundedBox(0.6, 0.25, 0.5, 0.015, bodyDark)
  saddleGroup.add(saddle)
  saddleGroup.position.set(0, 0.52, 0)
  g.add(saddleGroup)
  const tableGroup = new THREE.Group()
  const table = roundedBox(0.7, 0.08, 0.5, 0.01, alumMat)
  tableGroup.add(table)
  for (const tx of [-0.15, 0.15]) {
    const slot = box(0.02, 0.005, 0.45, darkMat)
    slot.position.set(tx, 0.045, 0)
    tableGroup.add(slot)
  }
  tableGroup.position.set(0, 0.165, 0)
  saddleGroup.add(tableGroup)

  // ---------- 4. X/Y/Z 导轨防护罩 ----------
  const bellowsX = roundedBox(0.3, 0.04, 0.1, 0.01, bodyDark)
  bellowsX.position.set(0.3, 0.65, 0)
  g.add(bellowsX)
  const bellowsY = roundedBox(0.1, 0.2, 0.1, 0.01, bodyDark)
  bellowsY.position.set(0, 1.4, -0.1)
  g.add(bellowsY)
  const bellowsZ = roundedBox(0.1, 0.04, 0.3, 0.01, bodyDark)
  bellowsZ.position.set(0, 0.55, 0.3)
  g.add(bellowsZ)

  // ---------- 5. 机头主轴箱体 + 主轴 + 卡盘 + 螺栓 + 刀具 ----------
  const spindleHead = new THREE.Group()
  const headBody = roundedBox(0.55, 0.6, 0.5, 0.02, bodyMat)
  spindleHead.add(headBody)
  const spindle = cylinder(0.05, 0.3, steelMat, 32)
  spindle.position.y = -0.35
  spindleHead.add(spindle)
  const chuck = cylinder(0.1, 0.08, darkMat, 32)
  chuck.position.y = -0.42
  spindleHead.add(chuck)
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2
    const b = bolt(0.012, 0.04, boltMat)
    b.position.set(Math.cos(a) * 0.08, -0.42, Math.sin(a) * 0.08)
    spindleHead.add(b)
  }
  const toolColors = ['#c85a72', '#3fa94a', '#2255bb', '#c9a13a', '#9c3c55', '#5cb85c']
  const spindleTool = cylinder(0.015, 0.08, pmetal(toolColors[0], 0.3, 0.9, 0.4), 16)
  spindleTool.position.y = -0.5
  spindleHead.add(spindleTool)
  spindleHead.position.set(0, 1.44, 0)
  g.add(spindleHead)

  // ---------- 6. 机头电机 + 散热片 + 风扇 ----------
  const motor = cylinder(0.12, 0.32, motorMat, 32)
  motor.rotation.z = Math.PI / 2
  motor.position.set(0.35, 1.35, -0.35)
  g.add(motor)
  const motorFins = heatsink(0.2, 0.2, 5, 0.03, motorDark)
  motorFins.rotation.y = Math.PI / 2
  motorFins.position.set(0.35, 1.35, -0.2)
  g.add(motorFins)
  const fanBlades = new THREE.Group()
  for (let i = 0; i < 2; i++) {
    const a = (i / 2) * Math.PI * 2
    const blade = roundedBox(0.08, 0.003, 0.02, 0.001, pmetal('#d2dad4', 0.35, 0.88, 0.45))
    blade.rotation.z = a
    fanBlades.add(blade)
  }
  fanBlades.position.set(0.52, 1.35, -0.35)
  g.add(fanBlades)

  // ---------- 7. 皮带传动（主动轮 + 从动轮 + 同步带） ----------
  const drivePulley = cylinder(0.055, 0.05, beltMat, 24)
  drivePulley.rotation.z = Math.PI / 2
  drivePulley.position.set(0.25, 1.35, -0.35)
  g.add(drivePulley)
  const drivenPulley = cylinder(0.045, 0.05, beltMat, 24)
  drivenPulley.rotation.z = Math.PI / 2
  drivenPulley.position.set(-0.15, 1.4, -0.35)
  g.add(drivenPulley)
  const beltCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0.25, 1.4, -0.35),
    new THREE.Vector3(0.05, 1.42, -0.35),
    new THREE.Vector3(-0.15, 1.42, -0.35),
    new THREE.Vector3(-0.15, 1.33, -0.35),
    new THREE.Vector3(0.05, 1.33, -0.35),
    new THREE.Vector3(0.25, 1.33, -0.35),
  ], true)
  const belt = new THREE.Mesh(
    new THREE.TubeGeometry(beltCurve, 40, 0.008, 8, true),
    beltMat,
  )
  g.add(belt)

  // ---------- 8. 圆盘式刀库（12 刀套） ----------
  const magMat = pmetal('#5a6a66', 0.4, 0.85, 0.3)
  const magazine = discToolMagazine(12, 0.25, magMat)
  magazine.group.position.set(0.85, 1.2, -0.3)
  g.add(magazine.group)

  // ---------- 9. 刀库围板 + 后封板 ----------
  const magGuard = box(0.02, 0.6, 0.6, bodyDark)
  magGuard.position.set(1.05, 1.2, -0.3)
  g.add(magGuard)
  const magBack = box(0.4, 0.6, 0.02, bodyDark)
  magBack.position.set(0.85, 1.2, -0.6)
  g.add(magBack)

  // ---------- 10. 前门 + 玻璃 + 压框 ----------
  const doorFrame = roundedBox(1.4, 1.5, 0.03, 0.015, bodyMat)
  doorFrame.position.set(0, 0.95, 0.65)
  g.add(doorFrame)
  const doorGlass = roundedBox(1.28, 1.38, 0.005, 0.005, glassMat)
  doorGlass.position.set(0, 0.95, 0.665)
  g.add(doorGlass)
  const doorBezel = roundedBox(1.32, 1.42, 0.003, 0.005, bodyDark)
  doorBezel.position.set(0, 0.95, 0.662)
  g.add(doorBezel)

  // ---------- 11. 侧窗 + 后封板 + 中封板 + 警示条 ----------
  const sideWindow = roundedBox(0.005, 0.8, 0.9, 0.01, glassMat)
  sideWindow.position.set(-0.95, 1.0, 0)
  g.add(sideWindow)
  const backSeal = box(1.8, 1.5, 0.01, bodyDark)
  backSeal.position.set(0, 1.0, -0.74)
  g.add(backSeal)
  const midSeal = box(1.8, 0.08, 0.01, bodyMat)
  midSeal.position.set(0, 0.3, 0.655)
  g.add(midSeal)
  const midStripe = warningStrip(1.7, 0.04)
  midStripe.position.set(0, 0.3, 0.66)
  g.add(midStripe)

  // ---------- 12. 操作箱 + FANUC 屏幕 + 按键 + 支架 ----------
  const opBox = roundedBox(0.4, 0.5, 0.2, 0.012, bodyDark)
  opBox.position.set(0.95, 0.8, 0.45)
  g.add(opBox)
  const fanucScreen = roundedBox(0.22, 0.16, 0.005, 0.005, pemissive('#00e6c8', 0.7))
  fanucScreen.position.set(0.95, 0.92, 0.555)
  g.add(fanucScreen)
  for (let i = 0; i < 4; i++) {
    const btn = cylinder(0.012, 0.01, pemissive(['#5cb85c', '#f4c20d', '#d34c3f', '#00e6ff'][i], 0.4), 16)
    btn.rotation.x = Math.PI / 2
    btn.position.set(0.85 + (i % 2) * 0.1, 0.72 + Math.floor(i / 2) * 0.06, 0.555)
    g.add(btn)
  }
  const opArm = cylinder(0.02, 0.4, alumDark, 16)
  opArm.rotation.x = Math.PI / 2
  opArm.position.set(0.95, 0.8, 0.35)
  g.add(opArm)

  // ---------- 13. 电箱 + 电箱门 + 驱动器散热罩 ----------
  const eBox = roundedBox(0.5, 1.4, 0.3, 0.015, bodyDark)
  eBox.position.set(-1.0, 0.85, -0.3)
  g.add(eBox)
  const eBoxDoor = roundedBox(0.46, 1.36, 0.008, 0.008, bodyMat)
  eBoxDoor.position.set(-1.0, 0.85, -0.15)
  g.add(eBoxDoor)
  const eBoxFins = heatsink(0.3, 0.4, 3, 0.04, darkMat)
  eBoxFins.rotation.y = Math.PI / 2
  eBoxFins.position.set(-0.84, 1.1, -0.3)
  g.add(eBoxFins)

  // ---------- 14. 拖链条（4 段拼接） ----------
  const dragChainSegs: THREE.Mesh[] = []
  for (let i = 0; i < 4; i++) {
    const seg = box(0.04, 0.04, 0.08, bodyDark)
    seg.position.set(-0.5 + i * 0.08, 0.5, 0.4)
    g.add(seg)
    dragChainSegs.push(seg)
  }

  // ---------- 15. 工作灯 + 冲屑管 + 冷却液粒子 + 切屑粒子 ----------
  const workLamp = roundedBox(0.15, 0.04, 0.04, 0.008, pemissive('#fff8dc', 0.85))
  workLamp.position.set(0.3, 1.6, 0.2)
  g.add(workLamp)
  const coolantPipe = pipe(
    new THREE.Vector3(0.3, 1.55, 0.2),
    new THREE.Vector3(0.1, 1.0, 0.1),
    0.008, alumDark,
  )
  g.add(coolantPipe)
  const coolantMat = new THREE.PointsMaterial({ color: 0x6faeb0, size: 0.015, transparent: true, opacity: 0.7 })
  const coolant = particleSpray(
    new THREE.Vector3(0.1, 1.0, 0.1),
    new THREE.Vector3(0, -1, 0.3),
    50, coolantMat,
  )
  coolant.points.visible = false
  g.add(coolant.points)
  const chipMat = new THREE.PointsMaterial({ color: 0xc0c0c0, size: 0.008, transparent: true, opacity: 0.8 })
  const chips = particleSpray(
    new THREE.Vector3(0, 0.85, 0.1),
    new THREE.Vector3(0.5, 0.5, 0.3),
    30, chipMat,
  )
  chips.points.visible = false
  g.add(chips.points)

  // ---------- 16. 三联件 + 电磁阀 + 水箱 ----------
  for (let i = 0; i < 3; i++) {
    const unit = cylinder(0.025, 0.12, bodyMat, 20)
    unit.position.set(-0.7 + i * 0.07, 0.2, 0.5)
    g.add(unit)
  }
  const valve = roundedBox(0.15, 0.06, 0.08, 0.005, bodyDark)
  valve.position.set(-0.5, 0.2, 0.5)
  g.add(valve)
  const valveLeds: THREE.MeshStandardMaterial[] = []
  for (let i = 0; i < 2; i++) {
    const m = pemissive('#5cb85c', 0.3)
    valveLeds.push(m)
    const led = cylinder(0.005, 0.003, m, 10)
    led.rotation.x = Math.PI / 2
    led.position.set(-0.52 + i * 0.04, 0.22, 0.54)
    g.add(led)
  }
  const tank = roundedBox(0.3, 0.2, 0.2, 0.01, bodyDark)
  tank.position.set(-0.6, 0.15, -0.5)
  g.add(tank)

  // ---------- 17. 注油机门 + 三色警示灯 + 警示条 ----------
  const oilDoor = roundedBox(0.2, 0.25, 0.005, 0.005, glassMat)
  oilDoor.position.set(0.7, 0.35, 0.655)
  g.add(oilDoor)
  const stack = stackLight([0, 1.85, -0.3], ['#e02222', '#f4c20d', '#5cb85c'])
  g.add(stack.group)
  const stripe = warningStrip(1.6, 0.04)
  stripe.position.set(0, 0.15, 0.66)
  g.add(stripe)

  // ---------- 18. 工件 ----------
  const workpiece = createWorkpiece({
    geometry: 'box',
    size: [0.18, 0.12, 0.18],
    position: [0, 0.10, 0],
    rawColor: '#5a6058',
    finishedColor: '#d4af6a',
  })
  tableGroup.add(workpiece.mesh)

  // ---------- 闭包变量 ----------
  const stackMats = stack.materials
  const fanucMat = fanucScreen.material as THREE.MeshStandardMaterial
  const lampMat = workLamp.material as THREE.MeshStandardMaterial
  const spindleToolMat = spindleTool.material as THREE.MeshPhysicalMaterial
  const toolColorObjs = toolColors.map(c => new THREE.Color(c))
  const coolantAttr = coolant.points.geometry.attributes.position as THREE.BufferAttribute
  const chipAttr = chips.points.geometry.attributes.position as THREE.BufferAttribute
  let lastToolIdx = -1

  return {
    group: g,
    update: (t, dt) => {
      const phase = (t % 14) / 14

      // 主轴 + 电机 + 风扇 + 皮带轮旋转
      spindle.rotation.y += dt * 18
      motor.rotation.y += dt * 14
      fanBlades.rotation.y += dt * 30
      drivePulley.rotation.x += dt * 14
      drivenPulley.rotation.x += dt * 17

      // 机头 Z 轴运动：快降 / 切深 / 抬升
      let headOffset = 0
      if (phase >= 0.05 && phase < 0.15) headOffset = -0.15
      else if (phase >= 0.20 && phase < 0.55) headOffset = -0.05
      spindleHead.position.y = 1.44 + headOffset

      // 工作台 X 走刀（切削中来回）
      tableGroup.position.x = (phase >= 0.20 && phase < 0.55) ? Math.sin(t * 0.8) * 0.2 : 0

      // 鞍座 Z 位置（换刀预备位 / 切削位）
      saddleGroup.position.z = phase < 0.05 ? 0.2 : 0

      // 刀库旋转 + 主轴刀具颜色变化
      const currentTool = Math.floor(t / 14) % 24
      if (currentTool !== lastToolIdx) {
        lastToolIdx = currentTool
        spindleToolMat.color.copy(toolColorObjs[currentTool % toolColors.length])
      }
      magazine.disc.rotation.y = currentTool * (2 * Math.PI / 24)

      // 冷却液 + 切屑粒子（切削中喷洒）
      const cutting = phase >= 0.20 && phase < 0.55
      coolant.points.visible = cutting
      chips.points.visible = cutting
      if (cutting) {
        for (let i = 0; i < 50; i++) {
          coolant.positions[i * 3] += coolant.velocities[i].x * dt
          coolant.positions[i * 3 + 1] += coolant.velocities[i].y * dt
          coolant.positions[i * 3 + 2] += coolant.velocities[i].z * dt
          if (coolant.positions[i * 3 + 1] < 0.4) {
            coolant.positions[i * 3] = 0.1
            coolant.positions[i * 3 + 1] = 1.0
            coolant.positions[i * 3 + 2] = 0.1
          }
        }
        for (let i = 0; i < 30; i++) {
          chips.positions[i * 3] += chips.velocities[i].x * dt
          chips.positions[i * 3 + 1] += chips.velocities[i].y * dt
          chips.positions[i * 3 + 2] += chips.velocities[i].z * dt
          if (chips.positions[i * 3 + 1] < 0.4 || Math.abs(chips.positions[i * 3]) > 0.5) {
            chips.positions[i * 3] = 0
            chips.positions[i * 3 + 1] = 0.85
            chips.positions[i * 3 + 2] = 0.1
          }
        }
        coolantAttr.needsUpdate = true
        chipAttr.needsUpdate = true
      }

      // 工作灯
      lampMat.emissiveIntensity = 0.85 + Math.sin(t) * 0.1

      // 三色灯：切削中黄，待机绿，换刀红
      const toolChange = phase >= 0.15 && phase < 0.20
      stackMats.forEach((m, i) => {
        if (cutting && i === 1) m.emissiveIntensity = 0.8
        else if (toolChange && i === 0) m.emissiveIntensity = 0.8
        else if (!cutting && !toolChange && i === 2) m.emissiveIntensity = 0.5
        else m.emissiveIntensity = 0.15
      })

      // 显示屏
      fanucMat.emissiveIntensity = 0.65 + Math.abs(Math.sin(t * 1.5)) * 0.15

      // 拖链分段弯曲（根据工作台位置）
      const tableX = tableGroup.position.x
      for (let i = 0; i < 4; i++) {
        dragChainSegs[i].rotation.z = tableX * 0.15 * (i + 1) / 4
        dragChainSegs[i].position.x = -0.5 + i * 0.08 + tableX * 0.02 * i
      }

      // 电磁阀 LED 交替亮
      valveLeds.forEach((m, i) => {
        m.emissiveIntensity = (Math.floor(t / 2) % 2 === i) ? 0.7 : 0.15
      })

      // 工件循环（原料→切削→成品输出）
      const { progress, offset } = computeCycle(t, 14)
      workpiece.setProgress(progress)
      workpiece.mesh.position.x = offset * 0.3
      workpiece.mesh.position.y = 0.10 + (cutting ? Math.sin(t * 30) * 0.003 : 0)
    },
  }
}

function createWashCell(def: ObjectDef): ProceduralModel {
  const g = createBase(1.75, 1.75)
  g.position.y = 0.2
  const bodyMat = pmetal(def.color, 0.4, 0.75, 0.3)
  const pipeMat = pemissive('#6faeb0', 0.3)
  const brushMat = pmetal('#2e3b38', 0.5, 0.7, 0.2)
  const darkMat = pmetal('#1a2422', 0.4, 0.8, 0.3)

  // 主箱体
  const body = roundedBox(1.35, 1.05, 1.22, 0.04, bodyMat)
  body.position.set(0, 0.62, 0)
  g.add(body)
  // 顶部喷淋管
  const pipe = roundedBox(0.95, 0.03, 0.03, 0.01, pipeMat)
  pipe.position.set(0, 0.86, 0.61)
  g.add(pipe)
  // 喷淋头（6 个）
  for (const x of [-0.36, -0.18, 0, 0.18, 0.36]) {
    const nozzle = cylinder(0.035, 0.04, pemissive('#6faeb0', 0.35), 16)
    nozzle.position.set(x, 0.82, 0.5)
    g.add(nozzle)
  }
  // 刷子组
  const brushes = new THREE.Group()
  for (const x of [-0.48, 0.48]) {
    const brushBody = cylinder(0.22, 0.42, brushMat, 32)
    brushBody.position.set(x, 1.18, 0)
    brushes.add(brushBody)
    // 刷毛（多层圆环）
    for (let i = 0; i < 3; i++) {
      const bristles = new THREE.Mesh(
        new THREE.TorusGeometry(0.24 + i * 0.005, 0.015, 8, 32),
        new THREE.MeshStandardMaterial({ color: 0x2a3530, roughness: 0.95, metalness: 0.1 }),
      )
      bristles.rotation.x = Math.PI / 2
      bristles.position.set(x, 1.18 - 0.1 + i * 0.1, 0)
      brushes.add(bristles)
    }
  }
  g.add(brushes)
  // 观察窗
  const window = roundedBox(0.75, 0.45, 0.01, 0.02, pglass('#1a2927', 0.4))
  window.position.set(0, 0.66, 0.61)
  g.add(window)
  const winFrame = roundedBox(0.79, 0.49, 0.005, 0.02, darkMat)
  winFrame.position.set(0, 0.66, 0.607)
  g.add(winFrame)
  // 散热口
  const sideVents = heatsink(0.5, 0.35, 10, 0.03, darkMat)
  sideVents.rotation.y = Math.PI / 2
  sideVents.position.set(0.6, 0.55, 0)
  g.add(sideVents)

  g.add(createControlCabinet([0.74, 0.55, -0.2], def.accent))

  // 工件
  const workpiece = createWorkpiece({
    geometry: 'rounded',
    size: [0.42, 0.28, 0.42],
    position: [0, 0.85, 0],
    rawColor: '#5a605c',
    finishedColor: '#d4af6a',
  })
  g.add(workpiece.mesh)

  return {
    group: g,
    update: (t, dt) => {
      brushes.rotation.y += dt * 2.5
      const { progress, offset } = computeCycle(t, 10)
      workpiece.setProgress(progress)
      workpiece.mesh.position.x = offset
      if (progress > 0 && progress < 1) {
        workpiece.mesh.position.y = 0.85 + Math.sin(t * 10) * 0.01
      }
    },
  }
}

void createWashCell

function createStorage(def: ObjectDef): ProceduralModel {
  const g = createBase(1.75, 1.75)
  g.position.y = 0.18
  const bodyMat = pmetal(def.color, 0.4, 0.75, 0.3)
  const pillarMat = pmetal('#9da9a3', 0.3, 0.9, 0.4)
  const plateMat = pmetal('#d1d9d3', 0.3, 0.9, 0.5)
  const box1Mat = pmetal('#b7864f', 0.7, 0.3, 0.2)
  const box2Mat = pmetal('#a87342', 0.7, 0.3, 0.2)
  const accentMat = pemissive(def.accent, 0.1)

  for (const x of [-0.68, 0.68]) {
    for (const z of [-0.58, 0.58]) {
      const pillar = roundedBox(0.08, 1.55, 0.08, 0.01, pillarMat)
      pillar.position.set(x, 0.82, z)
      g.add(pillar)
    }
  }
  for (const y of [0.28, 0.78, 1.28]) {
    const tray = roundedBox(1.52, 0.08, 1.26, 0.02, bodyMat)
    tray.position.set(0, y, 0)
    g.add(tray)
    for (const x of [-0.47, 0.47]) {
      const rail = roundedBox(0.04, 0.03, 1.2, 0.01, plateMat)
      rail.position.set(x, y + 0.065, 0)
      g.add(rail)
    }
  }
  for (const y of [0.47, 0.97]) {
    for (const x of [-0.34, 0.34]) {
      const crate = roundedBox(0.54, 0.32, 0.64, 0.02, x < 0 ? box1Mat : box2Mat)
      crate.position.set(x, y, -0.12)
      g.add(crate)
    }
    const label = roundedBox(1.1, 0.03, 0.68, 0.005, accentMat)
    label.position.set(0, y + 0.17, -0.12)
    g.add(label)
  }
  const top = roundedBox(1.5, 0.1, 1.32, 0.03, pmetal('#6d7a75', 0.4, 0.85, 0.3))
  top.position.set(0, 1.56, 0)
  g.add(top)
  const topLight = roundedBox(0.86, 0.04, 0.03, 0.01, pemissive(def.accent, 0.7))
  topLight.position.set(0, 1.61, 0.67)
  g.add(topLight)
  for (const x of [-0.5, 0.5]) {
    const rail = roundedBox(0.035, 1.24, 0.035, 0.005, plateMat)
    rail.position.set(x, 0.82, -0.61)
    rail.rotation.z = x < 0 ? -0.34 : 0.34
    g.add(rail)
  }
  return {
    group: g,
  }
}

function createBelt(def: ObjectDef): ProceduralModel {
  const g = createBase(1.1, 1.1)
  g.position.y = 0.15
  const rollerMat = pmetal('#94a19c', 0.25, 0.9, 0.4)
  const beltMat = pmetal('#172321', 0.7, 0.3, 0.1)
  const accentMat = pemissive(def.accent, 0.25)
  const darkMat = pmetal('#202b29', 0.5, 0.7, 0.2)

  const frame = roundedBox(0.85, 0.12, 0.85, 0.02, darkMat)
  frame.position.set(0, 0.25, 0)
  g.add(frame)
  const rollers = new THREE.Group()
  for (const z of [-0.3, 0, 0.3]) {
    const roller = cylinder(0.08, 0.9, rollerMat, 32)
    roller.rotation.z = Math.PI / 2
    roller.position.set(0, 0.33, z)
    rollers.add(roller)
    // 滚筒端盖
    for (const x of [-0.45, 0.45]) {
      const cap = cylinder(0.06, 0.02, pmetal('#5a6a66', 0.4, 0.8, 0.3), 24)
      cap.rotation.z = Math.PI / 2
      cap.position.set(x, 0.33, z)
      rollers.add(cap)
    }
  }
  g.add(rollers)
  // 传送带面（带凹槽纹理）
  const belt = roundedBox(0.72, 0.03, 0.78, 0.005, beltMat)
  belt.position.set(0, 0.41, 0)
  g.add(belt)
  const signal = roundedBox(0.18, 0.03, 0.18, 0.005, accentMat)
  signal.position.set(0, 0.43, 0)
  g.add(signal)

  const workpiece = createWorkpiece({
    geometry: 'rounded',
    size: [0.24, 0.14, 0.24],
    position: [0, 0.49, 0],
  })
  g.add(workpiece.mesh)

  return {
    group: g,
    update: (t, dt) => {
      rollers.rotation.x += dt * 2
      const cycle = (t % 6) / 6
      workpiece.mesh.position.z = -0.35 + cycle * 0.7
      workpiece.setProgress(cycle)
    },
  }
}

function createFlowNode(def: ObjectDef, branches = 3, merger = false): ProceduralModel {
  const g = createBase(1.75, 1.75)
  g.position.y = 0.25
  const bodyMat = pmetal(def.color, 0.4, 0.75, 0.3)
  const armMat = pmetal('#273432', 0.5, 0.7, 0.2)
  const accentMat = pemissive(def.accent, 0.15)
  const plateMat = pmetal('#5a6a66', 0.4, 0.8, 0.3)

  const hub = new THREE.Group()
  // 转盘
  const disk = cylinder(0.48, 0.45, bodyMat, 32)
  disk.position.y = 0.25
  hub.add(disk)
  // 转盘上的环形槽
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(0.35, 0.02, 8, 48),
    plateMat,
  )
  ring.rotation.x = Math.PI / 2
  ring.position.y = 0.48
  hub.add(ring)

  const arms = merger
    ? [[-0.55, 0, 0], [0, 0, -0.55], [0.55, 0, 0]]
    : [[0.55, 0, 0], [0, 0, -0.55], [0, 0, 0.55]]
  arms.slice(0, branches).forEach(([x, , z]) => {
    const arm = roundedBox(
      x === 0 ? 0.14 : Math.abs(x) * 2,
      0.14,
      z === 0 ? 0.14 : Math.abs(z) * 2,
      0.01,
      armMat,
    )
    arm.position.set(x === 0 ? 0 : -x / 2, 0.05, z === 0 ? 0 : -z / 2)
    hub.add(arm)
    const light = roundedBox(0.24, 0.07, 0.24, 0.01, accentMat)
    light.position.set(x * 0.5, 0.3, z * 0.5)
    hub.add(light)
  })
  g.add(hub)

  const workpiece = createWorkpiece({
    geometry: 'rounded',
    size: [0.14, 0.14, 0.14],
    position: [0, 0.5, 0.3],
  })
  g.add(workpiece.mesh)

  return {
    group: g,
    update: (t, dt) => {
      hub.rotation.y += dt * 0.6
      const cycle = (t % 8) / 8
      const angle = cycle * Math.PI * 2
      workpiece.mesh.position.x = Math.sin(angle) * 0.3
      workpiece.mesh.position.z = Math.cos(angle) * 0.3
      workpiece.setProgress(cycle)
    },
  }
}

function createInspectionCell(def: ObjectDef): ProceduralModel {
  // 视觉检测站：1.5×1.45×1.5m，铝型材机架 + XY 模组 + 顶部/侧相机 + 气动分拣
  const g = new THREE.Group()
  g.position.y = 0.04

  // ---------- 全局材质 ----------
  const bodyMat = pmetal(def.color, 0.4, 0.78, 0.32)
  const bodyDark = pmetal('#2a3432', 0.45, 0.8, 0.25)
  const alumMat = pmetal('#d8dde0', 0.25, 0.92, 0.55)
  const alumDark = pmetal('#9da9a3', 0.35, 0.88, 0.4)
  const brassMat = pmetal('#c9a13a', 0.3, 0.9, 0.45)
  const steelMat = pmetal('#a1aca7', 0.22, 0.95, 0.55)
  const darkMat = pmetal('#1a2422', 0.5, 0.75, 0.2)
  const glassMat = pglass('#1b2726', 0.4)
  const cableMat = pmetal('#1a1f1d', 0.55, 0.55, 0.15)

  // ---------- 1. 底盘铝板 + 脚轮 ----------
  const basePlate = roundedBox(1.55, 0.04, 1.5, 0.012, alumMat)
  g.add(basePlate)
  const baseLip = roundedBox(1.58, 0.018, 1.53, 0.006, alumDark)
  baseLip.position.y = -0.025
  g.add(baseLip)
  // 4 脚轮
  const wheelMat = new THREE.MeshPhysicalMaterial({ color: 0x0a0a0a, roughness: 0.85, metalness: 0.15, clearcoat: 0.2 })
  for (const [cx, cz] of [[-0.62, -0.6], [0.62, -0.6], [-0.62, 0.6], [0.62, 0.6]] as const) {
    const bracket = roundedBox(0.08, 0.05, 0.06, 0.005, alumDark)
    bracket.position.set(cx, -0.055, cz)
    g.add(bracket)
    const wheel = cylinder(0.05, 0.04, wheelMat, 20)
    wheel.rotation.z = Math.PI / 2
    wheel.position.set(cx, -0.07, cz)
    g.add(wheel)
  }

  // ---------- 2. 机架方通（4 立柱 + 4 横梁） ----------
  for (const [px, pz] of [[-0.7, -0.68], [0.7, -0.68], [-0.7, 0.68], [0.7, 0.68]] as const) {
    const post = roundedBox(0.045, 1.4, 0.045, 0.006, alumMat)
    post.position.set(px, 0.74, pz)
    g.add(post)
  }
  for (const pz of [-0.68, 0.68]) {
    const topBeam = roundedBox(1.4, 0.04, 0.04, 0.006, alumMat)
    topBeam.position.set(0, 1.42, pz)
    g.add(topBeam)
    const botBeam = roundedBox(1.4, 0.04, 0.04, 0.006, alumMat)
    botBeam.position.set(0, 0.06, pz)
    g.add(botBeam)
  }

  // ---------- 3. 后封板 + 左侧盖门 ----------
  const backPanel = box(1.36, 1.3, 0.008, bodyDark)
  backPanel.position.set(0, 0.75, -0.68)
  g.add(backPanel)
  const leftDoor = roundedBox(0.02, 1.2, 1.28, 0.01, glassMat)
  leftDoor.position.set(-0.69, 0.75, 0)
  g.add(leftDoor)

  // ---------- 4. 前门 + 玻璃 + 门拉手 ----------
  const doorFrame = roundedBox(1.3, 1.2, 0.025, 0.012, bodyMat)
  doorFrame.position.set(0, 0.75, 0.68)
  g.add(doorFrame)
  const doorGlass = roundedBox(1.18, 1.08, 0.005, 0.005, glassMat)
  doorGlass.position.set(0, 0.75, 0.693)
  g.add(doorGlass)
  const handle = cylinder(0.014, 0.18, steelMat, 16)
  handle.rotation.z = Math.PI / 2
  handle.position.set(0.45, 0.75, 0.7)
  g.add(handle)

  // ---------- 5. X 向 KK60 直线模组 ----------
  const xBody = box(1.4, 0.08, 0.08, bodyDark)
  xBody.position.set(0, 0.4, -0.5)
  g.add(xBody)
  const xScrew = cylinder(0.012, 1.35, brassMat, 16)
  xScrew.rotation.z = Math.PI / 2
  xScrew.position.set(0, 0.4, -0.5)
  g.add(xScrew)
  const xRail = box(1.38, 0.012, 0.025, steelMat)
  xRail.position.set(0, 0.43, -0.5)
  g.add(xRail)

  // ---------- 6. Y 向 KK86 直线模组（横置） ----------
  const yBridge = new THREE.Group()
  const yBody = box(0.5, 0.1, 0.1, bodyDark)
  yBridge.add(yBody)
  const yScrew = cylinder(0.014, 0.45, brassMat, 16)
  yScrew.rotation.x = Math.PI / 2
  yBridge.add(yScrew)
  const ySlider = roundedBox(0.08, 0.08, 0.06, 0.005, bodyMat)
  ySlider.position.set(0, 0, 0.02)
  yBridge.add(ySlider)
  yBridge.position.set(0, 0.5, -0.2)
  g.add(yBridge)

  // ---------- 7. 顶部镜头立柱组件 ----------
  const lensCol = roundedBox(0.045, 1.2, 0.045, 0.006, alumMat)
  lensCol.position.set(0, 0.8, -0.6)
  g.add(lensCol)
  const lensBeam = roundedBox(0.4, 0.04, 0.04, 0.006, alumMat)
  lensBeam.position.set(0, 1.3, -0.55)
  g.add(lensBeam)
  const lensRack = box(0.025, 0.9, 0.018, steelMat)
  lensRack.position.set(0, 1.0, -0.55)
  g.add(lensRack)

  // ---------- 8. 镜头调座 + 25MM 镜头 + Basler 相机 ----------
  const lensGroup = new THREE.Group()
  const lensMount = roundedBox(0.12, 0.1, 0.1, 0.012, bodyMat)
  lensGroup.add(lensMount)
  const lensBarrel = cylinder(0.028, 0.1, alumDark, 24)
  lensBarrel.position.y = -0.07
  lensGroup.add(lensBarrel)
  const focusRing = cylinder(0.032, 0.025, brassMat, 24)
  focusRing.position.y = -0.05
  lensGroup.add(focusRing)
  const lensInner = cylinder(0.018, 0.003, pemissive('#ffffff', 0.8), 24)
  lensInner.position.y = -0.117
  lensGroup.add(lensInner)
  const camBody = roundedBox(0.1, 0.08, 0.06, 0.008, bodyDark)
  camBody.position.y = 0.085
  lensGroup.add(camBody)
  lensGroup.position.set(0, 1.2, -0.45)
  g.add(lensGroup)

  // ---------- 9. 侧相机检测工位 ----------
  const sideMount = roundedBox(0.04, 0.6, 0.5, 0.01, bodyMat)
  sideMount.position.set(0.55, 0.85, 0.1)
  g.add(sideMount)
  const sideCamBody = roundedBox(0.06, 0.06, 0.12, 0.008, bodyDark)
  sideCamBody.position.set(0.42, 0.95, 0.1)
  g.add(sideCamBody)
  const ringLight = new THREE.Mesh(
    new THREE.TorusGeometry(0.025, 0.006, 12, 24),
    pemissive('#ffffff', 0.7),
  )
  ringLight.rotation.y = Math.PI / 2
  ringLight.position.set(0.34, 0.95, 0.1)
  g.add(ringLight)

  // ---------- 10. 检测平台 + 吸塑盘 ----------
  const stageGroup = new THREE.Group()
  const stage = roundedBox(0.6, 0.04, 0.5, 0.012, bodyDark)
  stageGroup.add(stage)
  const vacuumPlate = roundedBox(0.35, 0.02, 0.35, 0.006, alumDark)
  vacuumPlate.position.y = 0.03
  stageGroup.add(vacuumPlate)
  stageGroup.position.set(0, 0.7, 0.05)
  g.add(stageGroup)

  // ---------- 11. 气动手指 + CDM2B20 推拉气缸 ----------
  const gripCyl = cylinder(0.02, 0.06, bodyMat, 20)
  gripCyl.position.set(0, 0.82, 0.05)
  g.add(gripCyl)
  const jawA = roundedBox(0.012, 0.04, 0.015, 0.003, steelMat)
  jawA.position.set(0, 0.75, 0.035)
  g.add(jawA)
  const jawB = roundedBox(0.012, 0.04, 0.015, 0.003, steelMat)
  jawB.position.set(0, 0.75, 0.065)
  g.add(jawB)
  // CDM2B20 气缸
  const cylBody = cylinder(0.025, 0.18, bodyMat, 24)
  cylBody.rotation.z = Math.PI / 2
  cylBody.position.set(-0.6, 0.5, 0.05)
  g.add(cylBody)
  const cylRod = cylinder(0.008, 0.12, steelMat, 16)
  cylRod.rotation.z = Math.PI / 2
  cylRod.position.set(-0.45, 0.5, 0.05)
  g.add(cylRod)

  // ---------- 12. 下料斜板 ----------
  const chute = new THREE.Group()
  const chutePlate = box(0.35, 0.02, 0.45, bodyDark)
  chutePlate.rotation.x = -Math.PI / 180 * 25
  chute.add(chutePlate)
  const chuteStripe = warningStrip(0.34, 0.025)
  chuteStripe.rotation.x = -Math.PI / 2 - Math.PI / 180 * 25
  chuteStripe.position.y = 0.014
  chute.add(chuteStripe)
  chute.position.set(0.55, 0.45, 0.3)
  g.add(chute)

  // ---------- 13. 电气控制箱 + 散热风扇 ----------
  const eBody = roundedBox(0.4, 1.0, 0.3, 0.015, bodyDark)
  eBody.position.set(-0.65, 0.7, -0.55)
  g.add(eBody)
  const eDoor = roundedBox(0.36, 0.96, 0.008, 0.008, bodyMat)
  eDoor.position.set(-0.65, 0.7, -0.405)
  g.add(eDoor)
  const fanHousing = cylinder(0.06, 0.02, darkMat, 24)
  fanHousing.rotation.x = Math.PI / 2
  fanHousing.position.set(-0.65, 1.05, -0.395)
  g.add(fanHousing)
  const fanBlades = new THREE.Group()
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2
    const blade = roundedBox(0.05, 0.003, 0.012, 0.001, pmetal('#d2dad4', 0.35, 0.88, 0.45))
    blade.rotation.z = a
    fanBlades.add(blade)
  }
  fanBlades.position.set(-0.65, 1.05, -0.385)
  g.add(fanBlades)

  // ---------- 14. 急停/启动/停止按钮 + 温控器 ----------
  const btnColors: [string, string][] = [['#e02222', '急停'], ['#5cb85c', '启动'], ['#f4c20d', '停止']]
  btnColors.forEach(([c], i) => {
    const btn = cylinder(0.018, 0.015, pemissive(c, 0.45), 20)
    btn.rotation.x = Math.PI / 2
    btn.position.set(-0.06 + i * 0.06, 0.4, 0.695)
    g.add(btn)
  })
  const thermo = roundedBox(0.08, 0.05, 0.008, 0.003, darkMat)
  thermo.position.set(0.18, 0.4, 0.695)
  g.add(thermo)
  // 三色警示灯
  const stack = stackLight([0.6, 1.5, -0.6], ['#e02222', '#f4c20d', '#5cb85c'])
  g.add(stack.group)

  // ---------- 15. HMI 显示屏 ----------
  const hmi = roundedBox(0.4, 0.25, 0.01, 0.005, darkMat)
  hmi.position.set(0, 0.55, 0.692)
  g.add(hmi)
  const hmiScreen = roundedBox(0.36, 0.21, 0.003, 0.003, pemissive(def.accent, 0.7))
  hmiScreen.position.set(0, 0.55, 0.7)
  g.add(hmiScreen)

  // ---------- 16. 电缆布线 ----------
  const cable1 = new THREE.Mesh(
    new THREE.TubeGeometry(
      new THREE.CatmullRomCurve3([
        new THREE.Vector3(-0.5, 0.7, -0.5),
        new THREE.Vector3(-0.3, 0.55, -0.4),
        new THREE.Vector3(-0.1, 0.6, -0.2),
        new THREE.Vector3(0.1, 0.65, 0),
      ]),
      16, 0.008, 8, false,
    ),
    cableMat,
  )
  g.add(cable1)

  // ---------- 17. 工件 ----------
  const workpiece = createWorkpiece({
    geometry: 'rounded',
    size: [0.18, 0.04, 0.18],
    position: [0, 0.75, 0.05],
    rawColor: '#7a807c',
    finishedColor: '#7ed47e',
  })
  g.add(workpiece.mesh)

  // ---------- 闭包变量 ----------
  const cycleIndexRef = { idx: 0, lastPhase: 0 }
  const lensInnerMat = lensInner.material as THREE.MeshStandardMaterial
  const sideRingMat = ringLight.material as THREE.MeshStandardMaterial
  const hmiMat = hmiScreen.material as THREE.MeshStandardMaterial
  const stackMats = stack.materials

  return {
    group: g,
    update: (t, dt) => {
      const phase = (t % 12) / 12
      // 周期计数（每完成一个周期 idx++，按 idx%3===0 切换合格/不合格）
      if (cycleIndexRef.lastPhase > 0.9 && phase < 0.1) cycleIndexRef.idx++
      cycleIndexRef.lastPhase = phase
      const isGood = cycleIndexRef.idx % 3 !== 0

      // XY 平台缓慢运动
      const bx = Math.sin(t * 0.5) * 0.25
      const bz = Math.sin(t * 0.3 + 1) * 0.15
      yBridge.position.x = bx
      yBridge.position.z = -0.2 + bz
      stageGroup.position.x = bx
      stageGroup.position.z = 0.05 + bz

      // 顶部镜头 Z 调焦
      lensGroup.position.y = 1.2 + Math.max(0, Math.sin(t * 1.5)) * 0.05

      // 镜头内圈曝光脉冲
      lensInnerMat.emissiveIntensity = 0.3 + Math.abs(Math.sin(t * 4)) * 0.7

      // 侧相机 LED 环光：曝光时闪光，否则呼吸
      const sideFlash = (phase >= 0.30 && phase < 0.45) || (phase >= 0.60 && phase < 0.75)
      sideRingMat.emissiveIntensity = sideFlash ? 0.9 : 0.7 + Math.sin(t * 2) * 0.2

      // 散热风扇
      fanBlades.rotation.y += dt * 8

      // 气动夹爪开合（phase<0.20 闭爪）
      const gripClose = phase < 0.20 ? 0.015 : 0
      jawA.position.z = 0.035 + gripClose
      jawB.position.z = 0.065 - gripClose

      // 推拉气缸（进料/分拣时推出）
      const pushOut = phase < 0.10 || phase >= 0.85
      cylRod.position.x = -0.45 + (pushOut ? 0.06 : 0)

      // 报警灯：判定阶段按工件颜色强闪，否则呼吸
      const judging = phase >= 0.75 && phase < 0.85
      stackMats.forEach((m, i) => {
        if (judging) {
          if ((isGood && i === 2) || (!isGood && i === 0)) {
            m.emissiveIntensity = 0.6 + Math.abs(Math.sin(t * 12)) * 0.4
          } else {
            m.emissiveIntensity = 0.15
          }
        } else {
          m.emissiveIntensity = 0.3 + Math.abs(Math.sin(t * (1.5 + i * 0.4))) * 0.5
        }
      })

      // 显示屏
      hmiMat.emissiveIntensity = 0.65 + Math.abs(Math.sin(t * 1.5)) * 0.15

      // 工件循环（原料→检测→成品输出）
      const { progress, offset } = computeCycle(t, 12)
      workpiece.setProgress(progress)
      workpiece.mesh.position.x = bx + offset * 0.4
      workpiece.mesh.position.z = 0.05 + bz
      workpiece.mesh.position.y = 0.75
    },
  }
}

function createAgvForklift(def: ObjectDef): ProceduralModel {
  const g = new THREE.Group()
  const color = def.color
  const accent = def.accent
  const bodyMat = pmetal(color, 0.35, 0.8, 0.4)
  const darkMat = pmetal('#2a3432', 0.4, 0.8, 0.3)
  const wheelMat = new THREE.MeshPhysicalMaterial({ color: 0x111111, roughness: 0.9, metalness: 0.1, clearcoat: 0.1 })
  const hubMat = pmetal('#9da9a3', 0.3, 0.9, 0.5)
  const accentMat = pemissive(accent, 0.5)

  // 车身（倒角）
  const chassis = roundedBox(1.05, 0.4, 0.85, 0.05, bodyMat)
  chassis.position.set(0, 0.4, 0)
  g.add(chassis)
  // 车身装饰条
  const stripe = warningStrip(0.85, 0.04)
  stripe.position.set(0, 0.45, 0.43)
  stripe.rotation.x = -Math.PI / 2
  g.add(stripe)
  // 4 个轮子（带轮毂）
  const wheels = new THREE.Group()
  for (const x of [-0.45, 0.45]) {
    for (const z of [-0.3, 0.3]) {
      const wheel = cylinder(0.16, 0.13, wheelMat, 32)
      wheel.rotation.z = Math.PI / 2
      wheel.position.set(x, 0.15, z)
      wheels.add(wheel)
      // 轮毂
      const hub = cylinder(0.07, 0.02, hubMat, 16)
      hub.rotation.z = Math.PI / 2
      hub.position.set(x + (x > 0 ? 0.067 : -0.067), 0.15, z)
      wheels.add(hub)
    }
  }
  g.add(wheels)
  // 桅杆组
  const mast = new THREE.Group()
  for (const x of [-0.13, 0.13]) {
    const m = roundedBox(0.09, 1.05, 0.09, 0.01, darkMat)
    m.position.set(x, 0.5, -0.35)
    mast.add(m)
    // 桅杆导轨
    const rail = cylinder(0.02, 1.0, pmetal('#d2dad4', 0.2, 0.95, 0.5), 16)
    rail.position.set(x, 0.5, -0.305)
    mast.add(rail)
  }
  // 链条
  for (const x of [-0.13, 0.13]) {
    const chain = pipe(new THREE.Vector3(x, 0.1, -0.33), new THREE.Vector3(x, 1.0, -0.33), 0.008, pmetal('#7f8b85', 0.3, 0.9, 0.4))
    mast.add(chain)
  }
  // 货叉横梁
  const beamGroup = new THREE.Group()
  const beam = roundedBox(0.38, 0.1, 0.1, 0.02, darkMat)
  beam.position.set(0, 0.2, -0.4)
  beamGroup.add(beam)
  // 货叉
  for (const x of [-0.13, 0.13]) {
    const forkVertical = roundedBox(0.05, 0.25, 0.05, 0.005, darkMat)
    forkVertical.position.set(x, 0.08, -0.4)
    beamGroup.add(forkVertical)
    const fork = roundedBox(0.05, 0.04, 0.5, 0.005, darkMat)
    fork.position.set(x, -0.04, -0.65)
    beamGroup.add(fork)
  }
  mast.add(beamGroup)
  g.add(mast)

  const light = cylinder(0.08, 0.12, accentMat, 24)
  light.position.set(0, 1.5, 0)
  g.add(light)
  // 前灯
  const headlight = roundedBox(0.42, 0.1, 0.04, 0.01, pemissive('#fff4d6', 0.6))
  headlight.position.set(0, 0.5, 0.44)
  g.add(headlight)

  // 工件（货箱）
  const workpiece = createWorkpiece({
    geometry: 'rounded',
    size: [0.36, 0.26, 0.36],
    position: [0, 0.15, -0.55],
  })
  beamGroup.add(workpiece.mesh)

  return {
    group: g,
    update: (t) => {
      wheels.children.forEach((w) => { (w as THREE.Mesh).rotation.y += 0.075 })
      const cycle = (t % 8) / 8
      const liftPhase = (Math.sin(t * 0.75) + 1) / 2
      beamGroup.position.y = liftPhase * 0.35
      const mat = light.material as THREE.MeshStandardMaterial
      mat.emissiveIntensity = 0.4 + Math.abs(Math.sin(t * 3)) * 0.6
      workpiece.setProgress(cycle)
    },
  }
}

function createRobotArm(def: ObjectDef): ProceduralModel {
  const g = new THREE.Group()
  const accent = def.accent
  const bodyMat = pmetal('#dfe3e0', 0.2, 0.95, 0.5)
  const jointMat = pmetal('#1f2d2b', 0.3, 0.85, 0.3)
  const accentMat = pemissive(accent, 0.4)
  const boltMat = pmetal('#9da9a3', 0.3, 0.9, 0.5)

  // 底座
  const base = cylinder(0.32, 0.18, jointMat, 32)
  base.position.set(0, 0.09, 0)
  g.add(base)
  // 底座法兰
  const baseFlange = cylinder(0.28, 0.03, bodyMat, 32)
  baseFlange.position.set(0, 0.18, 0)
  g.add(baseFlange)
  // 底座螺栓
  for (let i = 0; i < 6; i++) {
    const angle = (i / 6) * Math.PI * 2
    const b = bolt(0.014, 0.04, boltMat)
    b.position.set(Math.cos(angle) * 0.25, 0.18, Math.sin(angle) * 0.25)
    g.add(b)
  }

  // 第一关节（旋转）
  const j1 = new THREE.Group()
  j1.position.set(0, 0.28, 0)
  const j1Mesh = cylinder(0.22, 0.22, bodyMat, 32)
  j1.add(j1Mesh)
  // 关节环（装饰）
  const j1Ring = new THREE.Mesh(
    new THREE.TorusGeometry(0.22, 0.012, 8, 48),
    accentMat,
  )
  j1Ring.rotation.x = Math.PI / 2
  j1Ring.position.y = 0.05
  j1.add(j1Ring)
  g.add(j1)

  // 大臂
  const shoulder = new THREE.Group()
  j1.add(shoulder)
  const arm1 = roundedBox(0.17, 0.85, 0.17, 0.03, bodyMat)
  arm1.position.set(0, 0.45, 0.1)
  arm1.rotation.x = -0.5
  shoulder.add(arm1)
  // 大臂线缆护套
  const cable = new THREE.Mesh(
    new THREE.TubeGeometry(
      new THREE.CatmullRomCurve3([
        new THREE.Vector3(0, 0, 0),
        new THREE.Vector3(0, 0.3, 0.08),
        new THREE.Vector3(0, 0.6, 0.12),
        new THREE.Vector3(0, 0.85, 0.1),
      ]),
      16, 0.025, 12, false,
    ),
    pmetal('#2a3432', 0.5, 0.6, 0.2),
  )
  shoulder.add(cable)

  // 肘关节
  const elbow = new THREE.Group()
  elbow.position.set(0, 0.9, 0.2)
  shoulder.add(elbow)
  const j2 = cylinder(0.16, 0.16, jointMat, 32)
  j2.rotation.x = Math.PI / 2
  elbow.add(j2)
  const j2Ring = new THREE.Mesh(
    new THREE.TorusGeometry(0.16, 0.01, 8, 48),
    accentMat,
  )
  j2Ring.rotation.y = Math.PI / 2
  elbow.add(j2Ring)

  // 小臂
  const arm2 = roundedBox(0.13, 0.65, 0.13, 0.025, bodyMat)
  arm2.position.set(0, 0.15, 0.2)
  arm2.rotation.x = -0.3
  elbow.add(arm2)

  // 腕关节
  const wrist = new THREE.Group()
  wrist.position.set(0, 0.3, 0.4)
  elbow.add(wrist)
  const wristMesh = cylinder(0.11, 0.11, jointMat, 32)
  wrist.add(wristMesh)
  // 末端执行器
  const endEffector = roundedBox(0.1, 0.1, 0.22, 0.02, accentMat)
  endEffector.position.set(0, 0.05, 0.15)
  wrist.add(endEffector)
  // 夹爪
  for (const x of [-0.05, 0.05]) {
    const gripper = roundedBox(0.02, 0.08, 0.1, 0.005, pmetal('#3a4543', 0.4, 0.85, 0.3))
    gripper.position.set(x, -0.04, 0.22)
    wrist.add(gripper)
  }

  // 信号灯
  const light = cylinder(0.04, 0.08, pemissive('#7ed4d1', 0.9), 16)
  light.position.set(0, 1.6, 0)
  g.add(light)

  // 工件（被装配的零件）
  const workpiece = createWorkpiece({
    geometry: 'rounded',
    size: [0.18, 0.12, 0.18],
    position: [0, -0.06, 0.32],
  })
  wrist.add(workpiece.mesh)

  return {
    group: g,
    update: (t) => {
      j1.rotation.y = Math.sin(t * 0.4) * 0.8
      shoulder.rotation.x = -0.5 + Math.sin(t * 0.6) * 0.3
      elbow.rotation.x = -0.3 + Math.cos(t * 0.75) * 0.4
      wrist.rotation.y = Math.sin(t * 1) * 0.8
      const cycle = (t % 10) / 10
      workpiece.setProgress(cycle)
    },
  }
}

function createMaterialInfeed(def: ObjectDef): ProceduralModel {
  const g = createBase(2.2, 1.2)
  g.position.y = 0
  const bodyMat = pmetal(def.color, 0.4, 0.75, 0.3)
  const beltMat = pmetal('#172321', 0.7, 0.3, 0.1)
  const rollerMat = pmetal('#94a19c', 0.25, 0.9, 0.4)
  const accentMat = pemissive(def.accent, 0.35)
  const darkMat = pmetal('#3a4543', 0.4, 0.8, 0.3)

  const frame = roundedBox(1.85, 0.65, 0.95, 0.04, bodyMat)
  frame.position.set(0, 0.45, 0)
  g.add(frame)
  // 框架散热口
  const sideVents = heatsink(0.5, 0.35, 10, 0.04, darkMat)
  sideVents.rotation.y = Math.PI / 2
  sideVents.position.set(0.6, 0.45, 0)
  g.add(sideVents)

  const rollers = new THREE.Group()
  for (const x of [-0.7, 0, 0.7]) {
    const roller = cylinder(0.07, 0.75, rollerMat, 32)
    roller.rotation.z = Math.PI / 2
    roller.position.set(x, 0.78, 0)
    rollers.add(roller)
    for (const xx of [-0.38, 0.38]) {
      const cap = cylinder(0.05, 0.02, pmetal('#5a6a66', 0.4, 0.8, 0.3), 24)
      cap.rotation.z = Math.PI / 2
      cap.position.set(x + xx, 0.78, 0)
      rollers.add(cap)
    }
  }
  g.add(rollers)

  const belt = roundedBox(1.65, 0.04, 0.75, 0.005, beltMat)
  belt.position.set(0, 0.78, 0)
  g.add(belt)

  const support = roundedBox(0.09, 0.42, 0.09, 0.01, darkMat)
  support.position.set(0, 1.0, -0.35)
  g.add(support)
  const sensor = roundedBox(0.16, 0.09, 0.09, 0.01, accentMat)
  sensor.position.set(0, 1.2, -0.3)
  g.add(sensor)
  const light = cylinder(0.04, 0.1, pemissive('#7ed4d1', 0.8), 16)
  light.position.set(0.6, 1.2, 0)
  g.add(light)
  // 警示条
  const stripe = warningStrip(1.5, 0.04)
  stripe.position.set(0, 0.2, 0.48)
  stripe.rotation.x = -Math.PI / 2
  g.add(stripe)

  const workpiece = createWorkpiece({
    geometry: 'rounded',
    size: [0.26, 0.16, 0.26],
    position: [0, 0.86, 0],
    rawColor: '#8a9088',
    finishedColor: '#9da7a3',
  })
  g.add(workpiece.mesh)

  return {
    group: g,
    update: (t, dt) => {
      rollers.children.forEach((r) => { (r as THREE.Mesh).rotation.y += dt * 1.5 })
      const cycle = (t % 8) / 8
      workpiece.mesh.position.x = -0.8 + cycle * 1.6
      workpiece.setProgress(0)
    },
  }
}

function createRawRack(def: ObjectDef): ProceduralModel {
  return createStorage(def)
}

/**
 * 基于 SolidWorks 照片的去毛刺机超精细建模（procedural HD）
 * 参考：工厂素材/零件去毛刺机/Untitled.JPG
 * 结构：绿色底座+白框围栏+蓝色电机散热片+黄色皮带传动+绿色轴轴承座
 *       +粉色去毛刺机+控制面板(带屏幕显示)+电缆布线+顶部三灯
 */
function createDeburrMachine(_def: ObjectDef): ProceduralModel {
  const g = createBase(1.8, 1.3)
  g.position.y = 0.05

  // ---------- 全局材质 ----------
  const bodyMat = pmetal('#4a7c59', 0.32, 0.88, 0.35)
  const bodyMatDark = pmetal('#3a6045', 0.38, 0.82, 0.28)
  const motorMat = pmetal('#2255bb', 0.3, 0.9, 0.45)
  const motorDark = pmetal('#163b87', 0.42, 0.82, 0.3)
  const beltMat = new THREE.MeshPhysicalMaterial({ color: 0xf6c845, roughness: 0.68, metalness: 0.25, clearcoat: 0.2 })
  const shaftMat = pmetal('#3fa94a', 0.18, 0.96, 0.6)
  const shaftDark = pmetal('#2f7a38', 0.3, 0.9, 0.4)
  const deburrMat = pmetal('#c85a72', 0.4, 0.78, 0.32)
  const deburrSoft = pmetal('#e08a9c', 0.5, 0.55, 0.2)
  const darkMat = pmetal('#24302d', 0.52, 0.65, 0.22)
  const panelMat = pmetal('#6d7975', 0.42, 0.84, 0.35)
  const boltMat = pmetal('#a9b3af', 0.28, 0.92, 0.55)
  const cableMat = pmetal('#1a1f1d', 0.55, 0.55, 0.15)

  // ---------- 底座 ----------
  const base = roundedBox(1.55, 0.08, 1.1, 0.022, bodyMat)
  base.position.set(0, 0.22, 0)
  g.add(base)
  // 底座下沿倒角板
  const baseLip = roundedBox(1.58, 0.04, 1.13, 0.01, bodyMatDark)
  baseLip.position.set(0, 0.18, 0)
  g.add(baseLip)
  // 底座圆孔阵列（三排）
  const holeMat = pmetal('#1a2420', 0.7, 0.35, 0.1)
  for (let i = 0; i < 6; i++) {
    for (let j = 0; j < 4; j++) {
      const hole = cylinder(0.018, 0.025, holeMat, 16)
      hole.position.set(-0.5 + i * 0.2, 0.268, -0.35 + j * 0.23)
      g.add(hole)
    }
  }
  // 底座四角螺栓
  g.add(boltCorners(1.4, 1.0, 0.26, boltMat))
  // 底座中线加强筋（两条）
  for (const z of [-0.2, 0.2]) {
    const rib = roundedBox(1.4, 0.02, 0.018, 0.005, bodyMatDark)
    rib.position.set(0, 0.19, z)
    g.add(rib)
  }

  // ---------- 围栏（三面，铝合金框+网格） ----------
  const fenceHeight = 0.58
  const framePole = pmetal('#dde3e0', 0.22, 0.96, 0.6)
  const meshMat = new THREE.MeshPhysicalMaterial({ color: 0xb9c2be, roughness: 0.7, metalness: 0.25, clearcoat: 0.15, transparent: true, opacity: 0.55 })

  // 立柱（4根）
  const polePositions: [number, number, number][] = [
    [-0.77, 0.26 + fenceHeight / 2, -0.5],
    [0.77, 0.26 + fenceHeight / 2, -0.5],
    [-0.77, 0.26 + fenceHeight / 2, 0.5],
    [0.77, 0.26 + fenceHeight / 2, 0.5],
  ]
  polePositions.forEach((pos) => {
    const pole = roundedBox(0.035, fenceHeight, 0.035, 0.008, framePole)
    pole.position.set(...pos)
    g.add(pole)
    // 立柱底座
    const poleBase = roundedBox(0.05, 0.02, 0.05, 0.004, bodyMatDark)
    poleBase.position.set(pos[0], 0.26, pos[2])
    g.add(poleBase)
  })
  // 顶部横梁
  for (const [x0, x1, z] of [[-0.77, 0.77, -0.5], [-0.77, 0.77, 0.5], [-0.77, -0.77, -0.5]]) {
    if (z < 0 || x0 !== x1) {
      const dx = (x1 - x0)
      if (z === -0.5 && x0 !== x1) {
        const beam = roundedBox(dx, 0.028, 0.028, 0.006, framePole)
        beam.position.set((x0 + x1) / 2, 0.26 + fenceHeight, -0.5)
        g.add(beam)
      }
    }
  }
  // 左右两侧横梁
  for (const x of [-0.77, 0.77]) {
    const beam = roundedBox(0.028, 0.028, 0.95, 0.006, framePole)
    beam.position.set(x, 0.26 + fenceHeight, 0)
    g.add(beam)
  }
  // 后围栏面板（网格）
  const backPanel = box(1.48, fenceHeight - 0.12, 0.005, meshMat)
  backPanel.position.set(0, 0.26 + fenceHeight / 2, -0.49)
  g.add(backPanel)
  // 左围栏面板
  const leftPanel = box(0.005, fenceHeight - 0.12, 0.96, meshMat)
  leftPanel.position.set(-0.745, 0.26 + fenceHeight / 2, 0)
  g.add(leftPanel)
  // 右围栏面板
  const rightPanel = box(0.005, fenceHeight - 0.12, 0.96, meshMat)
  rightPanel.position.set(0.745, 0.26 + fenceHeight / 2, 0)
  g.add(rightPanel)
  // 顶部长条形照明灯（照片中白色长灯管）
  const lightHousing = roundedBox(0.45, 0.04, 0.035, 0.008, bodyMatDark)
  lightHousing.position.set(0, 0.26 + fenceHeight - 0.02, -0.5)
  g.add(lightHousing)
  const lightEmitter = roundedBox(0.42, 0.018, 0.02, 0.005, pemissive('#fff8dc', 0.9))
  lightEmitter.position.set(0, 0.26 + fenceHeight - 0.045, -0.485)
  g.add(lightEmitter)

  // ---------- 电机（右侧蓝色，含多组散热片） ----------
  const motor = new THREE.Group()
  // 电机主体（圆柱）
  const motorBody = cylinder(0.145, 0.38, motorMat, 48)
  motorBody.rotation.z = Math.PI / 2
  motorBody.position.set(0.38, 0.47, -0.15)
  motor.add(motorBody)
  // 散热片（纵向一圈，约30片，更真实）
  for (let i = 0; i < 32; i++) {
    const angle = (i / 32) * Math.PI * 2
    const sx = Math.cos(angle)
    const sy = Math.sin(angle)
    const fin = box(0.01, 0.04, 0.032, motorDark)
    fin.position.set(0.38 + sx * 0.142, 0.47 + sy * 0.142, -0.15)
    fin.rotation.z = angle
    motor.add(fin)
  }
  // 电机侧面散热格栅（2组）
  for (const x of [-0.08, 0.08]) {
    const sideGrill = heatsink(0.2, 0.18, 14, 0.03, motorDark)
    sideGrill.rotation.y = Math.PI / 2
    sideGrill.position.set(0.38 + x, 0.47, -0.17)
    motor.add(sideGrill)
  }
  // 电机尾盖
  const rearCap = cylinder(0.11, 0.025, pmetal('#0f2a70', 0.3, 0.92, 0.55), 36)
  rearCap.rotation.z = Math.PI / 2
  rearCap.position.set(0.58, 0.47, -0.15)
  motor.add(rearCap)
  // 尾盖中心风扇
  const fan = cylinder(0.08, 0.012, pmetal('#1a1f25', 0.45, 0.7, 0.2), 16)
  fan.rotation.z = Math.PI / 2
  fan.position.set(0.595, 0.47, -0.15)
  motor.add(fan)
  // 尾盖风扇叶片（3片）
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2
    const blade = roundedBox(0.06, 0.003, 0.015, 0.001, pmetal('#d2dad4', 0.35, 0.88, 0.45))
    blade.position.set(0.597, 0.47 + Math.sin(a) * 0.04, -0.15 + Math.cos(a) * 0.04)
    blade.rotation.x = a
    motor.add(blade)
  }
  // 电机前端法兰
  const frontFlange = cylinder(0.115, 0.018, pmetal('#4a5a58', 0.3, 0.92, 0.55), 36)
  frontFlange.rotation.z = Math.PI / 2
  frontFlange.position.set(0.17, 0.47, -0.15)
  motor.add(frontFlange)
  // 法兰螺栓（6颗）
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2
    const b = bolt(0.01, 0.028, boltMat)
    b.rotation.z = Math.PI / 2
    b.position.set(0.16, 0.47 + Math.sin(a) * 0.09, -0.15 + Math.cos(a) * 0.09)
    motor.add(b)
  }
  // 电机输出轴
  const motorShaft = cylinder(0.022, 0.06, pmetal('#b8c2be', 0.2, 0.95, 0.6), 24)
  motorShaft.rotation.z = Math.PI / 2
  motorShaft.position.set(0.135, 0.47, -0.15)
  motor.add(motorShaft)
  // 电机减震底座
  const motorBase = roundedBox(0.24, 0.04, 0.22, 0.012, darkMat)
  motorBase.position.set(0.38, 0.3, -0.15)
  motor.add(motorBase)
  // 减震垫（4个）
  for (const x of [-1, 1]) {
    for (const z of [-1, 1]) {
      const pad = cylinder(0.025, 0.01, new THREE.MeshPhysicalMaterial({ color: 0x1a1f1d, roughness: 0.9, metalness: 0.05 }), 16)
      pad.position.set(0.38 + x * 0.09, 0.282, -0.15 + z * 0.085)
      motor.add(pad)
    }
  }
  g.add(motor)

  // ---------- 皮带传动（更精确的两轮+皮带套） ----------
  const beltGroup = new THREE.Group()
  // 主皮带轮（电机侧，带齿型）
  const drivePulley = new THREE.Group()
  const driveCore = cylinder(0.055, 0.055, beltMat, 28)
  driveCore.rotation.z = Math.PI / 2
  drivePulley.add(driveCore)
  // 皮带轮两侧凸缘
  for (const sx of [-1, 1]) {
    const flange = cylinder(0.07, 0.008, pmetal('#c49a1c', 0.5, 0.55, 0.15), 28)
    flange.rotation.z = Math.PI / 2
    flange.position.set(sx * 0.026, 0, 0)
    drivePulley.add(flange)
  }
  // 主轮安装
  drivePulley.position.set(0.28, 0.47, -0.07)
  beltGroup.add(drivePulley)
  // 同步带连接传动轴
  const pulleyShaft = cylinder(0.014, 0.18, pmetal('#8a9a94', 0.2, 0.95, 0.6), 20)
  pulleyShaft.rotation.z = Math.PI / 2
  pulleyShaft.position.set(0.28, 0.47, -0.07)
  beltGroup.add(pulleyShaft)

  // 传动轴上的从动轮
  const drivenPulley = new THREE.Group()
  const drivenCore = cylinder(0.045, 0.05, beltMat, 28)
  drivenCore.rotation.z = Math.PI / 2
  drivenPulley.add(drivenCore)
  for (const sx of [-1, 1]) {
    const flange = cylinder(0.058, 0.007, pmetal('#c49a1c', 0.5, 0.55, 0.15), 28)
    flange.rotation.z = Math.PI / 2
    flange.position.set(sx * 0.025, 0, 0)
    drivenPulley.add(flange)
  }
  drivenPulley.position.set(-0.08, 0.5, -0.07)
  beltGroup.add(drivenPulley)

  // 皮带（CatmullRom 贝塞尔曲线包裹两轮）
  const p1 = new THREE.Vector3(0.28, 0.47, -0.07)
  const p2 = new THREE.Vector3(-0.08, 0.5, -0.07)
  const beltCurvePoints: THREE.Vector3[] = []
  for (let t = 0; t < 16; t++) {
    const s = t / 15
    const cx = p1.x + (p2.x - p1.x) * s
    const cy = p1.y + Math.sin(s * Math.PI) * 0.06
    beltCurvePoints.push(new THREE.Vector3(cx, cy + 0.03, -0.07))
  }
  for (let t = 0; t < 16; t++) {
    const s = t / 15
    const cx = p2.x + (p1.x - p2.x) * s
    const cy = p2.y - Math.sin(s * Math.PI) * 0.06
    beltCurvePoints.push(new THREE.Vector3(cx, cy - 0.03, -0.07))
  }
  const beltCurve = new THREE.CatmullRomCurve3(beltCurvePoints, true)
  const beltStrap = new THREE.Mesh(
    new THREE.TubeGeometry(beltCurve, 80, 0.009, 12, true),
    new THREE.MeshPhysicalMaterial({ color: 0xf6c845, roughness: 0.7, metalness: 0.22, clearcoat: 0.2 }),
  )
  beltGroup.add(beltStrap)
  g.add(beltGroup)

  // ---------- 传动轴（绿色，3个带法兰轴承座） ----------
  const shaftGroup = new THREE.Group()
  const mainShaft = cylinder(0.028, 1.5, shaftMat, 28)
  mainShaft.rotation.z = Math.PI / 2
  mainShaft.position.set(0, 0.55, 0)
  shaftGroup.add(mainShaft)
  // 传动轴上的防滑槽
  for (let i = 0; i < 20; i++) {
    const s = cylinder(0.03, 0.004, shaftDark, 20)
    s.rotation.z = Math.PI / 2
    s.position.set(-0.7 + i * 0.075, 0.55, 0)
    shaftGroup.add(s)
  }
  // 3个轴承座（高精密度样式）
  for (const x of [-0.5, 0, 0.5]) {
    const bearing = new THREE.Group()
    // 轴承外环
    const outer = cylinder(0.055, 0.05, pmetal('#78827e', 0.32, 0.92, 0.5), 32)
    outer.rotation.z = Math.PI / 2
    bearing.add(outer)
    // 密封环
    for (const sx of [-1, 1]) {
      const seal = cylinder(0.048, 0.006, pmetal('#4a524f', 0.5, 0.75, 0.3), 32)
      seal.rotation.z = Math.PI / 2
      seal.position.set(sx * 0.022, 0, 0)
      bearing.add(seal)
    }
    // 安装底板
    const plate = roundedBox(0.12, 0.015, 0.1, 0.006, darkMat)
    plate.position.set(0, -0.06, 0)
    bearing.add(plate)
    // 底板2颗螺栓
    for (const zx of [-1, 1]) {
      const b = bolt(0.012, 0.03, boltMat)
      b.position.set(zx * 0.038, -0.052, zx * 0.028)
      bearing.add(b)
    }
    // 支架立柱
    const col = roundedBox(0.04, 0.18, 0.04, 0.005, darkMat)
    col.position.set(0, -0.15, 0.04)
    bearing.add(col)
    // 移动到整体坐标
    bearing.position.set(x, 0.55, 0.12)
    shaftGroup.add(bearing)
  }
  // 联轴器（连接传动轴和绿色皮带轮）
  const coupling = cylinder(0.04, 0.06, pmetal('#3a4543', 0.35, 0.88, 0.45), 24)
  coupling.rotation.z = Math.PI / 2
  coupling.position.set(-0.04, 0.55, -0.07)
  shaftGroup.add(coupling)
  // 联轴器螺钉
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2
    const bs = bolt(0.006, 0.015, boltMat)
    bs.position.set(-0.04, 0.55 + Math.cos(a) * 0.03, -0.07 + Math.sin(a) * 0.03)
    shaftGroup.add(bs)
  }
  // 传动轴上的绿色皮带轮
  const shaftPulley = new THREE.Group()
  const spCore = cylinder(0.062, 0.05, pemissive('#3fa94a', 0.35), 28)
  spCore.rotation.z = Math.PI / 2
  shaftPulley.add(spCore)
  for (const sx of [-1, 1]) {
    const f = cylinder(0.075, 0.008, pmetal('#2f7a38', 0.45, 0.6, 0.25), 28)
    f.rotation.z = Math.PI / 2
    f.position.set(sx * 0.025, 0, 0)
    shaftPulley.add(f)
  }
  shaftPulley.position.set(-0.08, 0.55, -0.07)
  shaftGroup.add(shaftPulley)
  // 传动轴两端端盖
  for (const sx of [-1, 1]) {
    const endCap = cylinder(0.04, 0.018, pmetal('#78827e', 0.32, 0.9, 0.5), 24)
    endCap.rotation.z = Math.PI / 2
    endCap.position.set(sx * 0.72, 0.55, 0)
    shaftGroup.add(endCap)
  }
  g.add(shaftGroup)

  // ---------- 去毛刺机构（粉色，含涡轮蜗杆） ----------
  const deburrGroup = new THREE.Group()
  // 机构主体
  const deburrBody = roundedBox(0.38, 0.14, 0.28, 0.022, deburrMat)
  deburrBody.position.set(-0.62, 0.44, 0.12)
  deburrGroup.add(deburrBody)
  // 主体盖板螺栓
  for (let i = 0; i < 4; i++) {
    const b = bolt(0.01, 0.025, boltMat)
    b.position.set(-0.62 + (i % 2 - 0.5) * 0.3, 0.515, 0.12 + (Math.floor(i / 2) - 0.5) * 0.2)
    deburrGroup.add(b)
  }
  // 去毛刺头（毛刷，更精细）
  const brush = new THREE.Group()
  const brushCore = cylinder(0.045, 0.09, pmetal('#9c3c55', 0.55, 0.45, 0.15), 24)
  brushCore.position.y = 0
  brush.add(brushCore)
  // 多层刷毛（螺旋排布）
  const bristleMaterial = new THREE.MeshPhysicalMaterial({ color: 0xf0b8c5, roughness: 0.85, metalness: 0.1 })
  for (let layer = 0; layer < 5; layer++) {
    const ly = -0.04 + layer * 0.02
    const count = 16
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + layer * 0.2
      const bst = new THREE.Mesh(new THREE.CylinderGeometry(0.0025, 0.0015, 0.04, 4), bristleMaterial)
      bst.position.set(Math.cos(a) * 0.05, ly, Math.sin(a) * 0.05)
      bst.rotation.z = -a
      bst.rotation.x = 0.15
      brush.add(bst)
    }
  }
  // 刷头顶盖
  const brushCap = cylinder(0.042, 0.008, deburrSoft, 20)
  brushCap.position.y = 0.045
  brush.add(brushCap)
  brush.position.set(-0.62, 0.56, 0.12)
  deburrGroup.add(brush)
  // 去毛刺机构左侧的粉色蜗杆轴（输入轴）
  const wormShaft = cylinder(0.022, 0.16, deburrSoft, 20)
  wormShaft.rotation.z = Math.PI / 2
  wormShaft.position.set(-0.8, 0.56, 0.12)
  deburrGroup.add(wormShaft)
  // 蜗杆齿
  for (let i = 0; i < 12; i++) {
    const tooth = cylinder(0.028, 0.005, pmetal('#b04060', 0.5, 0.55, 0.2), 20)
    tooth.rotation.z = Math.PI / 2
    tooth.rotation.y = i * 0.3
    tooth.position.set(-0.73 + i * 0.01, 0.56, 0.12)
    deburrGroup.add(tooth)
  }
  // 蜗杆左端输入头（粉色连接头）
  const wormIn = cylinder(0.035, 0.04, pmetal('#b05878', 0.4, 0.75, 0.3), 18)
  wormIn.rotation.z = Math.PI / 2
  wormIn.position.set(-0.88, 0.56, 0.12)
  deburrGroup.add(wormIn)
  // 机构支架（三角型）
  for (const x of [-0.7, -0.55]) {
    for (const z of [0, 0.24]) {
      const leg = roundedBox(0.025, 0.22, 0.025, 0.005, darkMat)
      leg.position.set(x, 0.37, z)
      deburrGroup.add(leg)
    }
  }
  // 安装底板
  const mountPlate = roundedBox(0.4, 0.012, 0.32, 0.006, darkMat)
  mountPlate.position.set(-0.62, 0.3, 0.12)
  deburrGroup.add(mountPlate)
  g.add(deburrGroup)

  // ---------- 控制面板（含屏幕显示+操作按钮） ----------
  const controlPanel = new THREE.Group()
  const panelBody = roundedBox(0.2, 0.32, 0.12, 0.018, panelMat)
  panelBody.position.set(0.7, 0.38, 0.36)
  controlPanel.add(panelBody)
  // 面板门框
  const panelDoor = roundedBox(0.18, 0.3, 0.012, 0.012, pmetal('#5d6965', 0.4, 0.86, 0.42))
  panelDoor.position.set(0.7, 0.38, 0.415)
  controlPanel.add(panelDoor)
  // 门铰链（2个）
  for (const y of [-1, 1]) {
    const hinge = roundedBox(0.008, 0.03, 0.02, 0.002, boltMat)
    hinge.position.set(0.62, 0.38 + y * 0.1, 0.41)
    controlPanel.add(hinge)
  }
  // 门把手
  const panelHandle = roundedBox(0.008, 0.08, 0.01, 0.003, boltMat)
  panelHandle.position.set(0.77, 0.38, 0.425)
  controlPanel.add(panelHandle)
  // 显示屏
  const screenBg = roundedBox(0.11, 0.065, 0.005, 0.005, pmetal('#1a1f1d', 0.7, 0.3, 0.1))
  screenBg.position.set(0.7, 0.48, 0.425)
  controlPanel.add(screenBg)
  // 屏幕发光（青色显示）
  const screen = roundedBox(0.1, 0.055, 0.001, 0.004, pemissive('#00e6c8', 0.7))
  screen.position.set(0.7, 0.48, 0.428)
  controlPanel.add(screen)
  // 屏幕文字（用发光方块模拟数字显示）
  for (let i = 0; i < 4; i++) {
    const d = roundedBox(0.018, 0.025, 0.0005, 0.001, pemissive('#ffffff', 0.9))
    d.position.set(0.665 + i * 0.02, 0.478, 0.429)
    controlPanel.add(d)
  }
  // 按钮组
  const btnColors: [string, string][] = [
    ['#5cb85c', '启动'],
    ['#f4c20d', '复位'],
    ['#d34c3f', '停止'],
  ]
  btnColors.forEach(([c], i) => {
    const btn = cylinder(0.013, 0.012, pemissive(c, 0.35), 18)
    btn.rotation.x = Math.PI / 2
    btn.position.set(0.67 + i * 0.03, 0.38, 0.427)
    controlPanel.add(btn)
    // 按钮底座
    const bezel = cylinder(0.018, 0.004, pmetal('#3a4543', 0.5, 0.6, 0.2), 18)
    bezel.rotation.x = Math.PI / 2
    bezel.position.set(0.67 + i * 0.03, 0.38, 0.422)
    controlPanel.add(bezel)
  })
  // 急停按钮（大红色蘑菇头）
  const eStopBase = cylinder(0.022, 0.008, darkMat, 20)
  eStopBase.rotation.x = Math.PI / 2
  eStopBase.position.set(0.7, 0.3, 0.422)
  controlPanel.add(eStopBase)
  const eStop = cylinder(0.026, 0.025, pemissive('#e02222', 0.6), 24)
  eStop.rotation.x = Math.PI / 2
  eStop.position.set(0.7, 0.3, 0.432)
  controlPanel.add(eStop)
  const eStopRing = cylinder(0.035, 0.004, pmetal('#a82222', 0.45, 0.5, 0.2), 24)
  eStopRing.rotation.x = Math.PI / 2
  eStopRing.position.set(0.7, 0.3, 0.42)
  controlPanel.add(eStopRing)
  // 数字显示屏下方的小LED
  for (let i = 0; i < 3; i++) {
    const led = cylinder(0.004, 0.003, pemissive(['#5cb85c', '#f4c20d', '#00e6ff'][i], 0.6), 10)
    led.rotation.x = Math.PI / 2
    led.position.set(0.66 + i * 0.02, 0.44, 0.427)
    controlPanel.add(led)
  }
  g.add(controlPanel)

  // ---------- 电缆布线（电机→控制面板） ----------
  const cable1 = new THREE.Mesh(
    new THREE.TubeGeometry(
      new THREE.CatmullRomCurve3([
        new THREE.Vector3(0.58, 0.4, -0.15),
        new THREE.Vector3(0.58, 0.28, 0.1),
        new THREE.Vector3(0.7, 0.28, 0.3),
        new THREE.Vector3(0.7, 0.26, 0.35),
      ]),
      20, 0.01, 10, false,
    ),
    cableMat,
  )
  g.add(cable1)
  // 去毛刺→控制面板信号线
  const cable2 = new THREE.Mesh(
    new THREE.TubeGeometry(
      new THREE.CatmullRomCurve3([
        new THREE.Vector3(-0.62, 0.36, 0.12),
        new THREE.Vector3(-0.2, 0.32, 0.5),
        new THREE.Vector3(0.3, 0.32, 0.5),
        new THREE.Vector3(0.7, 0.34, 0.35),
      ]),
      20, 0.008, 10, false,
    ),
    new THREE.MeshPhysicalMaterial({ color: 0x3a7ae0, roughness: 0.6, metalness: 0.15 }),
  )
  g.add(cable2)
  // 控制面板→底部出线
  const cable3 = new THREE.Mesh(
    new THREE.TubeGeometry(
      new THREE.CatmullRomCurve3([
        new THREE.Vector3(0.7, 0.24, 0.36),
        new THREE.Vector3(0.7, 0.12, 0.5),
        new THREE.Vector3(0.4, 0.1, 0.52),
      ]),
      16, 0.012, 10, false,
    ),
    cableMat,
  )
  g.add(cable3)

  // ---------- 顶部三灯（R-Y-G） ----------
  const stackLight = new THREE.Group()
  const stackBase = roundedBox(0.05, 0.02, 0.05, 0.005, darkMat)
  stackBase.position.set(0.38, 0.82, -0.15)
  stackLight.add(stackBase)
  const stackColors = ['#e02222', '#f6c845', '#3cdd56']
  const stackLights: THREE.MeshStandardMaterial[] = []
  stackColors.forEach((c, i) => {
    const m = pemissive(c, 0.35)
    stackLights.push(m)
    const shell = cylinder(0.028, 0.07, m, 20)
    shell.position.set(0.38, 0.88 + i * 0.08, -0.15)
    stackLight.add(shell)
    // 外壳透明层
    const cover = cylinder(0.032, 0.06, pglass(c, 0.25), 20)
    cover.position.set(0.38, 0.88 + i * 0.08, -0.15)
    stackLight.add(cover)
  })
  // 顶部蜂鸣器
  const buzzer = cylinder(0.02, 0.015, pmetal('#3a4543', 0.45, 0.7, 0.25), 16)
  buzzer.position.set(0.38, 0.88 + 3 * 0.08 + 0.01, -0.15)
  stackLight.add(buzzer)
  g.add(stackLight)

  // ---------- 警示条 ----------
  const stripe = warningStrip(1.4, 0.035)
  stripe.position.set(0, 0.26, 0.52)
  stripe.rotation.x = -Math.PI / 2
  g.add(stripe)

  // ---------- 底座下部支脚（4个） ----------
  for (const x of [-1, 1]) {
    for (const z of [-1, 1]) {
      const leg = cylinder(0.035, 0.18, bodyMatDark, 20)
      leg.position.set(x * 0.65, 0.07, z * 0.45)
      g.add(leg)
      // 调节脚垫
      const pad = cylinder(0.05, 0.02, pmetal('#2a302c', 0.55, 0.55, 0.2), 20)
      pad.position.set(x * 0.65, 0.17, z * 0.45)
      g.add(pad)
    }
  }

  // ---------- 工件（被去毛刺的零件，随工序移动+渐变） ----------
  const workpiece = createWorkpiece({
    geometry: 'cylinder',
    size: [0.06, 0.16, 0.06],
    position: [-0.3, 0.6, 0],
    rawColor: '#5a6058',
    finishedColor: '#e8c47a',
  })
  g.add(workpiece.mesh)
  // 工件底座托板
  const workHolder = roundedBox(0.22, 0.02, 0.14, 0.006, pmetal('#78827e', 0.4, 0.85, 0.4))
  workHolder.position.set(workpiece.mesh.position.x, 0.585, 0)
  g.add(workHolder)

  return {
    group: g,
    update: (t, dt) => {
      // 电机主轴旋转
      motorBody.rotation.y += dt * 14
      // 风扇旋转
      for (let i = 4; i <= 7; i++) {
        if (motor.children[i]) {
          const blade = motor.children[i] as THREE.Mesh
          blade.rotation.z += dt * 30
        }
      }
      // 皮带轮组旋转（按传动比）
      drivePulley.rotation.x += dt * 14
      drivenPulley.rotation.x += dt * 17
      // 传动轴旋转
      mainShaft.rotation.y += dt * 17
      // 去毛刺头高速旋转
      brush.rotation.y += dt * 21
      // 蜗杆旋转
      wormShaft.rotation.y += dt * 6
      for (let i = 14; i <= 25; i++) {
        if (deburrGroup.children[i]) {
          (deburrGroup.children[i] as THREE.Mesh).rotation.y += dt * 6
        }
      }
      // 三灯依次闪烁
      stackLights.forEach((m, i) => {
        m.emissiveIntensity = 0.35 + Math.abs(Math.sin(t * (1.5 + i * 0.4))) * 0.75
      })
      // 顶部照明灯常亮但有呼吸
      const lit = lightEmitter.material as THREE.MeshStandardMaterial
      lit.emissiveIntensity = 0.85 + Math.sin(t * 1) * 0.1
      // 屏幕亮度闪烁
      const scm = screen.material as THREE.MeshStandardMaterial
      scm.emissiveIntensity = 0.65 + Math.abs(Math.sin(t * 1.5)) * 0.15
      // 工件循环（原料→加工→成品输出）
      const { progress, offset } = computeCycle(t, 11)
      workpiece.setProgress(progress)
      workpiece.mesh.position.x = -0.35 + offset * 0.25
      workpiece.mesh.position.y = 0.6
      if (progress > 0 && progress < 1) {
        // 加工中工件振动 + 缓慢自转
        workpiece.mesh.position.y = 0.6 + Math.sin(t * 25) * 0.004
        workpiece.mesh.rotation.y += dt * 0.6
      }
      // 托板跟随X位移
      workHolder.position.x = workpiece.mesh.position.x
    },
  }
}

export function createProceduralEquipment(def: ObjectDef): ProceduralModel {
  switch (def.type) {
    case 'press': return createPress(def)
    case 'smelter': return createCncCell(def)
    case 'machine': return createCncCell(def)
    case 'washing': return createDeburrMachine(def)  // 使用新的去毛刺机模型
    case 'storage': return createStorage(def)
    case 'oreMiner': return createRawRack(def)
    case 'inboundWarehouse': return createStorage(def)
    case 'outboundWarehouse': return createStorage(def)
    case 'conveyor':
    case 'inclineUp':
    case 'inclineDown': return createBelt(def)
    case 'splitter': return createFlowNode(def, 3, false)
    case 'merger': return createFlowNode(def, 3, true)
    case 'inspection': return createInspectionCell(def)
    case 'agv': return createAgvForklift(def)
    case 'assembler': return createRobotArm(def)
    case 'source': return createMaterialInfeed(def)
    default: return createBelt(def)
  }
}
