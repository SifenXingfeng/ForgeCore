import fs from 'node:fs'
import path from 'node:path'
import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js'

// GLTFExporter uses the browser FileReader API for the final GLB blob.
// Node 20+ already provides Blob.arrayBuffer(), so this small adapter keeps
// the asset generation script deterministic and browser-independent.
globalThis.FileReader ??= class {
  result = null
  onloadend = null
  readAsArrayBuffer(blob) {
    blob.arrayBuffer().then((result) => {
      this.result = result
      this.onloadend?.()
    })
  }
}

const outputDir = path.resolve('public/models/industrial')
fs.mkdirSync(outputDir, { recursive: true })

const palette = {
  frame: '#687772',
  frameLight: '#aeb9b3',
  dark: '#263432',
  panel: '#5e747c',
  amber: '#e4b52b',
  cyan: '#72d4d2',
  steel: '#c6d0ca',
  crate: '#9b6c42',
  crateLight: '#c39154',
}

function mat(color, roughness = 0.52, metalness = 0.68, emissive = null) {
  return new THREE.MeshStandardMaterial({
    color,
    roughness,
    metalness,
    emissive: emissive ?? '#000000',
    emissiveIntensity: emissive ? 0.35 : 0,
  })
}

function box(parent, name, size, position, color, options = {}) {
  const geometry = options.radius
    ? new RoundedBoxGeometry(size[0], size[1], size[2], 3, options.radius)
    : new THREE.BoxGeometry(...size)
  const mesh = new THREE.Mesh(geometry, mat(color, options.roughness ?? 0.52, options.metalness ?? 0.68, options.emissive))
  mesh.name = name
  mesh.position.set(...position)
  if (options.rotation) mesh.rotation.set(...options.rotation)
  mesh.castShadow = true
  mesh.receiveShadow = true
  parent.add(mesh)
  return mesh
}

function cylinder(parent, name, radius, height, position, color, options = {}) {
  const mesh = new THREE.Mesh(
    new THREE.CylinderGeometry(radius, options.bottomRadius ?? radius, height, options.segments ?? 16),
    mat(color, options.roughness ?? 0.48, options.metalness ?? 0.72, options.emissive),
  )
  mesh.name = name
  mesh.position.set(...position)
  if (options.rotation) mesh.rotation.set(...options.rotation)
  mesh.castShadow = true
  mesh.receiveShadow = true
  parent.add(mesh)
  return mesh
}

function torus(parent, name, radius, tube, position, color, rotation = [Math.PI / 2, 0, 0]) {
  const mesh = new THREE.Mesh(new THREE.TorusGeometry(radius, tube, 10, 24), mat(color, 0.42, 0.72))
  mesh.name = name
  mesh.position.set(...position)
  mesh.rotation.set(...rotation)
  mesh.castShadow = true
  parent.add(mesh)
  return mesh
}

function pipe(parent, name, points, radius, color) {
  const curve = new THREE.CatmullRomCurve3(points.map((point) => new THREE.Vector3(...point)))
  const mesh = new THREE.Mesh(new THREE.TubeGeometry(curve, 18, radius, 8, false), mat(color, 0.42, 0.64))
  mesh.name = name
  mesh.castShadow = true
  parent.add(mesh)
  return mesh
}

function industrialBase(root, width, depth) {
  box(root, 'base_lower', [width, 0.12, depth], [0, 0.06, 0], palette.frame, { roughness: 0.72, metalness: 0.38, radius: 0.035 })
  box(root, 'base_deck', [width - 0.12, 0.035, depth - 0.12], [0, 0.135, 0], palette.frameLight, { roughness: 0.54, metalness: 0.42, radius: 0.015 })
  for (const x of [-1, 1]) for (const z of [-1, 1]) cylinder(root, `anchor_${x}_${z}`, 0.055, 0.06, [x * (width / 2 - 0.16), 0.19, z * (depth / 2 - 0.16)], palette.steel, { segments: 12 })
}

function createPress() {
  const root = new THREE.Group()
  root.name = 'HydraulicPress_Detailed'
  industrialBase(root, 1.8, 1.75)
  box(root, 'left_column', [0.11, 1.4, 0.13], [-0.56, 0.86, 0], palette.frameLight, { radius: 0.025 })
  box(root, 'right_column', [0.11, 1.4, 0.13], [0.56, 0.86, 0], palette.frameLight, { radius: 0.025 })
  box(root, 'top_beam', [1.48, 0.25, 1.2], [0, 1.48, 0], palette.panel, { radius: 0.04 })
  box(root, 'top_inlay', [1.2, 0.03, 0.94], [0, 1.615, 0], palette.amber, { emissive: palette.amber, roughness: 0.42, metalness: 0.45 })
  cylinder(root, 'hydraulic_cylinder', 0.14, 0.3, [0, 1.78, 0], palette.steel, { bottomRadius: 0.17, segments: 20 })
  cylinder(root, 'piston_rod', 0.055, 0.46, [0, 1.5, 0], palette.steel, { segments: 16 })
  box(root, 'moving_platen', [0.98, 0.13, 0.74], [0, 1.02, 0], palette.amber, { emissive: palette.amber, radius: 0.025 })
  box(root, 'die_table', [0.62, 0.09, 0.52], [0, 0.37, 0], palette.dark, { roughness: 0.3, metalness: 0.58, radius: 0.02 })
  torus(root, 'pressure_gauge', 0.095, 0.018, [0.78, 1.0, -0.34], palette.steel)
  cylinder(root, 'gauge_needle', 0.014, 0.055, [0.78, 1.0, -0.34], palette.amber, { rotation: [Math.PI / 2, 0, 0], segments: 10, emissive: palette.amber })
  box(root, 'hydraulic_unit', [0.34, 0.72, 0.36], [0.76, 0.57, 0.3], palette.dark, { radius: 0.025 })
  cylinder(root, 'hydraulic_reservoir', 0.13, 0.25, [0.76, 0.98, 0.3], palette.frameLight, { rotation: [0, 0, Math.PI / 2], segments: 16 })
  pipe(root, 'hydraulic_hose', [[0.6, 1.0, 0.3], [0.46, 1.32, 0.22], [0.16, 1.6, 0.08], [0, 1.65, 0]], 0.025, palette.dark)
  box(root, 'control_panel', [0.28, 0.62, 0.2], [0.94, 0.58, 0.22], palette.dark, { radius: 0.02 })
  box(root, 'control_screen', [0.17, 0.14, 0.025], [0.94, 0.73, 0.33], palette.cyan, { emissive: palette.cyan, metalness: 0.2 })
  return root
}

function createWash() {
  const root = new THREE.Group()
  root.name = 'DeburrWashCell_Detailed'
  industrialBase(root, 1.75, 1.75)
  box(root, 'wash_body', [1.34, 0.9, 1.18], [0, 0.68, 0], palette.panel, { radius: 0.055 })
  box(root, 'wash_front_window', [0.9, 0.46, 0.035], [0, 0.78, 0.61], palette.dark, { emissive: palette.cyan, roughness: 0.2, metalness: 0.42, radius: 0.02 })
  box(root, 'wash_door_frame_top', [1.0, 0.06, 0.08], [0, 1.05, 0.64], palette.steel, { radius: 0.015 })
  box(root, 'wash_door_frame_left', [0.06, 0.52, 0.08], [-0.47, 0.79, 0.64], palette.steel, { radius: 0.015 })
  box(root, 'wash_door_frame_right', [0.06, 0.52, 0.08], [0.47, 0.79, 0.64], palette.steel, { radius: 0.015 })
  box(root, 'wash_tank', [1.1, 0.18, 0.8], [0, 0.3, 0], palette.dark, { radius: 0.025 })
  for (const x of [-0.42, 0, 0.42]) cylinder(root, `wash_roller_${x}`, 0.06, 0.9, [x, 0.47, 0.05], palette.steel, { rotation: [0, 0, Math.PI / 2], segments: 16 })
  for (const x of [-0.28, 0, 0.28]) {
    cylinder(root, `spray_nozzle_${x}`, 0.035, 0.18, [x, 1.28, 0.2], palette.cyan, { emissive: palette.cyan, segments: 12 })
    pipe(root, `spray_pipe_${x}`, [[x, 1.14, 0.2], [x, 1.34, 0.2]], 0.018, palette.steel)
  }
  box(root, 'spray_manifold', [0.86, 0.05, 0.05], [0, 1.38, 0.2], palette.steel, { radius: 0.01 })
  cylinder(root, 'wash_motor', 0.18, 0.34, [-0.5, 1.2, -0.08], palette.dark, { segments: 16 })
  torus(root, 'wash_motor_ring', 0.13, 0.018, [-0.5, 1.2, 0.1], palette.cyan, [0, Math.PI / 2, 0])
  box(root, 'wash_control', [0.28, 0.62, 0.2], [0.75, 0.58, -0.22], palette.dark, { radius: 0.02 })
  box(root, 'wash_status', [0.17, 0.14, 0.025], [0.75, 0.74, -0.11], palette.cyan, { emissive: palette.cyan, metalness: 0.2 })
  return root
}

function createStorage() {
  const root = new THREE.Group()
  root.name = 'PalletBufferRack_Detailed'
  industrialBase(root, 1.75, 1.75)
  for (const x of [-0.68, 0.68]) for (const z of [-0.58, 0.58]) box(root, `rack_post_${x}_${z}`, [0.07, 1.52, 0.07], [x, 0.92, z], palette.frameLight, { radius: 0.018 })
  for (const y of [0.36, 0.86, 1.36]) {
    box(root, `rack_shelf_${y}`, [1.5, 0.07, 1.24], [0, y, 0], palette.frame, { radius: 0.018 })
    box(root, `rack_front_beam_${y}`, [1.52, 0.08, 0.06], [0, y + 0.04, 0.62], palette.steel, { radius: 0.012 })
  }
  for (const y of [0.55, 1.05]) for (const x of [-0.34, 0.34]) {
    box(root, `crate_${x}_${y}`, [0.52, 0.3, 0.62], [x, y, -0.12], x < 0 ? palette.crate : palette.crateLight, { roughness: 0.78, metalness: 0.15, radius: 0.018 })
    box(root, `crate_label_${x}_${y}`, [0.28, 0.08, 0.018], [x, y + 0.02, 0.2], palette.amber, { emissive: palette.amber, metalness: 0.2 })
  }
  box(root, 'rack_header', [1.48, 0.08, 1.3], [0, 1.64, 0], palette.frame, { radius: 0.02 })
  box(root, 'rack_status', [0.86, 0.035, 0.025], [0, 1.69, 0.67], palette.amber, { emissive: palette.amber, metalness: 0.25 })
  for (const x of [-0.5, 0.5]) box(root, `rack_brace_${x}`, [0.035, 1.2, 0.035], [x, 0.92, -0.61], palette.steel, { rotation: [0, 0, x < 0 ? -0.34 : 0.34] })
  return root
}

function createFlowNode() {
  const root = new THREE.Group()
  root.name = 'FlowNode_Detailed'
  industrialBase(root, 1.75, 1.75)
  cylinder(root, 'flow_hub', 0.46, 0.42, [0, 0.42, 0], palette.panel, { bottomRadius: 0.5, segments: 12 })
  for (const [name, position, size] of [
    ['front', [0.52, 0.36, 0], [0.64, 0.12, 0.22]],
    ['back', [-0.52, 0.36, 0], [0.64, 0.12, 0.22]],
    ['left', [0, 0.36, 0.52], [0.22, 0.12, 0.64]],
    ['right', [0, 0.36, -0.52], [0.22, 0.12, 0.64]],
  ]) {
    box(root, `flow_arm_${name}`, size, position, palette.dark, { radius: 0.025 })
    cylinder(root, `flow_socket_${name}`, 0.13, 0.08, [position[0], 0.47, position[2]], palette.cyan, { emissive: palette.cyan, segments: 16 })
  }
  torus(root, 'flow_status_ring', 0.36, 0.026, [0, 0.65, 0], palette.amber)
  return root
}

function exportAsset(name, scene) {
  const exporter = new GLTFExporter()
  exporter.parse(scene, (result) => {
    const data = Buffer.from(result)
    fs.writeFileSync(path.join(outputDir, name), data)
    console.log(`generated ${name} (${data.length} bytes)`)
  }, (error) => {
    throw error
  }, { binary: true, trs: true })
}

exportAsset('hydraulic_press_detail.glb', createPress())
exportAsset('wash_deburr_detail.glb', createWash())
exportAsset('pallet_buffer_detail.glb', createStorage())
exportAsset('flow_node_detail.glb', createFlowNode())
