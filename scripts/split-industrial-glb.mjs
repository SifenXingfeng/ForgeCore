import fs from 'node:fs'
import path from 'node:path'

const sourcePath = process.argv[2] ?? 'public/models/industrial_line_demo.glb'
const outputDir = process.argv[3] ?? 'public/models/industrial'
const source = fs.readFileSync(sourcePath)

const jsonLength = source.readUInt32LE(12)
const jsonStart = 20
const json = JSON.parse(new TextDecoder().decode(source.subarray(jsonStart, jsonStart + jsonLength)))
const binHeader = jsonStart + jsonLength
const binLength = source.readUInt32LE(binHeader)
const binStart = binHeader + 8
const sourceBin = source.subarray(binStart, binStart + binLength)

const components = [
  { file: 'cnc_machining_center.glb', label: 'CNC machining center', roots: [30] },
  { file: 'robot_cell.glb', label: 'industrial robot cell', roots: [0, 51] },
  { file: 'safety_fence.glb', label: 'safety fence and door', roots: [53] },
  { file: 'roller_conveyor.glb', label: 'roller conveyor line', roots: [78] },
  { file: 'roller_conveyor_segment.glb', label: 'single roller conveyor segment', roots: [79] },
  { file: 'control_cabinet.glb', label: 'standing control cabinet', roots: [135] },
  { file: 'sensor_pack.glb', label: 'entry and exit sensors', roots: [166] },
]

function copy(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value))
}

function align4(value) {
  return (value + 3) & ~3
}

function writeGlb(document, binary) {
  const jsonBytes = Buffer.from(JSON.stringify(document), 'utf8')
  const paddedJsonLength = align4(jsonBytes.length)
  const paddedJson = Buffer.concat([jsonBytes, Buffer.alloc(paddedJsonLength - jsonBytes.length, 0x20)])
  const paddedBinLength = align4(binary.length)
  const paddedBin = Buffer.concat([binary, Buffer.alloc(paddedBinLength - binary.length)])
  const totalLength = 12 + 8 + paddedJson.length + 8 + paddedBin.length
  const header = Buffer.alloc(12)
  header.writeUInt32LE(0x46546c67, 0)
  header.writeUInt32LE(2, 4)
  header.writeUInt32LE(totalLength, 8)
  const jsonHeader = Buffer.alloc(8)
  jsonHeader.writeUInt32LE(paddedJson.length, 0)
  jsonHeader.writeUInt32LE(0x4e4f534a, 4)
  const binHeader = Buffer.alloc(8)
  binHeader.writeUInt32LE(paddedBin.length, 0)
  binHeader.writeUInt32LE(0x004e4942, 4)
  return Buffer.concat([header, jsonHeader, paddedJson, binHeader, paddedBin])
}

function createComponent(spec) {
  const nodeMap = new Map()
  const meshMap = new Map()
  const accessorMap = new Map()
  const viewMap = new Map()
  const materialMap = new Map()
  const textureMap = new Map()
  const imageMap = new Map()
  const samplerMap = new Map()
  const binaryParts = []
  let binarySize = 0

  function copySampler(index) {
    if (index === undefined || samplerMap.has(index)) return samplerMap.get(index)
    const local = samplerMap.size
    samplerMap.set(index, local)
    document.samplers.push(copy(json.samplers[index]))
    return local
  }

  function copyBufferView(index) {
    if (viewMap.has(index)) return viewMap.get(index)
    const sourceView = json.bufferViews[index]
    const sourceOffset = sourceView.byteOffset ?? 0
    const offset = align4(binarySize)
    binaryParts.push(Buffer.alloc(offset - binarySize))
    binaryParts.push(sourceBin.subarray(sourceOffset, sourceOffset + sourceView.byteLength))
    binarySize = offset + sourceView.byteLength
    const local = viewMap.size
    viewMap.set(index, local)
    const view = copy(sourceView)
    view.buffer = 0
    view.byteOffset = offset
    document.bufferViews.push(view)
    return local
  }

  function copyImage(index) {
    if (imageMap.has(index)) return imageMap.get(index)
    const local = imageMap.size
    imageMap.set(index, local)
    const image = copy(json.images[index])
    if (image.bufferView !== undefined) image.bufferView = copyBufferView(image.bufferView)
    document.images.push(image)
    return local
  }

  function copyTexture(index) {
    if (textureMap.has(index)) return textureMap.get(index)
    const local = textureMap.size
    textureMap.set(index, local)
    const texture = copy(json.textures[index])
    if (texture.sampler !== undefined) texture.sampler = copySampler(texture.sampler)
    if (texture.source !== undefined) texture.source = copyImage(texture.source)
    document.textures.push(texture)
    return local
  }

  function remapTextureRef(ref) {
    if (ref?.index !== undefined) ref.index = copyTexture(ref.index)
  }

  function copyMaterial(index) {
    if (materialMap.has(index)) return materialMap.get(index)
    const local = materialMap.size
    materialMap.set(index, local)
    const material = copy(json.materials[index])
    if (material.pbrMetallicRoughness) {
      remapTextureRef(material.pbrMetallicRoughness.baseColorTexture)
      remapTextureRef(material.pbrMetallicRoughness.metallicRoughnessTexture)
    }
    remapTextureRef(material.normalTexture)
    remapTextureRef(material.occlusionTexture)
    remapTextureRef(material.emissiveTexture)
    const specular = material.extensions?.KHR_materials_pbrSpecularGlossiness
    if (specular) {
      remapTextureRef(specular.diffuseTexture)
      remapTextureRef(specular.specularGlossinessTexture)
    }
    document.materials.push(material)
    return local
  }

  function copyAccessor(index) {
    if (accessorMap.has(index)) return accessorMap.get(index)
    const local = accessorMap.size
    accessorMap.set(index, local)
    const accessor = copy(json.accessors[index])
    if (accessor.bufferView !== undefined) accessor.bufferView = copyBufferView(accessor.bufferView)
    if (accessor.sparse) {
      if (accessor.sparse.indices?.bufferView !== undefined) accessor.sparse.indices.bufferView = copyBufferView(accessor.sparse.indices.bufferView)
      if (accessor.sparse.values?.bufferView !== undefined) accessor.sparse.values.bufferView = copyBufferView(accessor.sparse.values.bufferView)
    }
    document.accessors.push(accessor)
    return local
  }

  function copyMesh(index) {
    if (meshMap.has(index)) return meshMap.get(index)
    const local = meshMap.size
    meshMap.set(index, local)
    const mesh = copy(json.meshes[index])
    mesh.primitives = mesh.primitives.map((primitive) => {
      const next = copy(primitive)
      next.attributes = Object.fromEntries(Object.entries(primitive.attributes).map(([name, accessor]) => [name, copyAccessor(accessor)]))
      if (primitive.indices !== undefined) next.indices = copyAccessor(primitive.indices)
      if (primitive.material !== undefined) next.material = copyMaterial(primitive.material)
      if (primitive.targets) next.targets = primitive.targets.map((target) => Object.fromEntries(Object.entries(target).map(([name, accessor]) => [name, copyAccessor(accessor)])))
      return next
    })
    document.meshes.push(mesh)
    return local
  }

  function copyNode(index) {
    if (nodeMap.has(index)) return nodeMap.get(index)
    const local = nodeMap.size
    nodeMap.set(index, local)
    // Reserve the parent slot before recursing so scene/node indices remain stable.
    document.nodes.push(null)
    const node = copy(json.nodes[index])
    if (node.children) node.children = node.children.map(copyNode)
    if (node.mesh !== undefined) node.mesh = copyMesh(node.mesh)
    if (node.skin !== undefined) delete node.skin
    if (node.camera !== undefined) delete node.camera
    document.nodes[local] = node
    return local
  }

  const document = {
    asset: copy(json.asset),
    scene: 0,
    scenes: [{ name: spec.label, nodes: [] }],
    nodes: [],
    meshes: [],
    accessors: [],
    bufferViews: [],
    buffers: [{ byteLength: 0 }],
    materials: [],
    textures: [],
    images: [],
    samplers: [],
    extensionsUsed: copy(json.extensionsUsed),
    extensionsRequired: copy(json.extensionsRequired),
  }

  document.scenes[0].nodes = spec.roots.map(copyNode)
  document.buffers[0].byteLength = binarySize
  const output = writeGlb(document, Buffer.concat(binaryParts))
  return { file: spec.file, label: spec.label, roots: spec.roots, nodes: document.nodes.length, meshes: document.meshes.length, bytes: output.length, output }
}

fs.mkdirSync(outputDir, { recursive: true })
const manifest = []
for (const component of components) {
  const result = createComponent(component)
  fs.writeFileSync(path.join(outputDir, result.file), result.output)
  manifest.push({ file: result.file, label: result.label, roots: result.roots, nodes: result.nodes, meshes: result.meshes, bytes: result.bytes })
}
fs.writeFileSync(path.join(outputDir, 'manifest.json'), JSON.stringify({ source: path.basename(sourcePath), components: manifest }, null, 2))
console.log(JSON.stringify(manifest, null, 2))
