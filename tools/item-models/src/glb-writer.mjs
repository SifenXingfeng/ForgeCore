/**
 * Minimal, dependency-free glTF 2.0 binary writer for ForgeCore item models.
 *
 * The writer intentionally emits a small and conservative subset of glTF:
 * one mesh, triangle primitives, PBR materials and a single embedded BIN chunk.
 */

const GLB_MAGIC = 0x46546c67;
const GLB_VERSION = 2;
const JSON_CHUNK_TYPE = 0x4e4f534a;
const BIN_CHUNK_TYPE = 0x004e4942;
const ARRAY_BUFFER = 34962;
const ELEMENT_ARRAY_BUFFER = 34963;

const COMPONENT_TYPE = Object.freeze({
  FLOAT: 5126,
  UNSIGNED_SHORT: 5123,
  UNSIGNED_INT: 5125,
});

function align4(value) {
  return (value + 3) & ~3;
}

function finiteNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp01(value, fallback = 1) {
  return Math.min(1, Math.max(0, finiteNumber(value, fallback)));
}

function plainJson(value, fallback = {}) {
  if (value === undefined) return fallback;
  try {
    const serialized = JSON.stringify(value);
    return serialized === undefined ? fallback : JSON.parse(serialized);
  } catch (error) {
    throw new TypeError(`ForgeCore metadata must be JSON-serializable: ${error.message}`);
  }
}

function parseHexColor(value) {
  if (typeof value !== 'string') return null;
  const match = /^#([0-9a-f]{6}|[0-9a-f]{8})$/i.exec(value.trim());
  if (!match) return null;
  const hex = match[1];
  return [
    Number.parseInt(hex.slice(0, 2), 16) / 255,
    Number.parseInt(hex.slice(2, 4), 16) / 255,
    Number.parseInt(hex.slice(4, 6), 16) / 255,
    hex.length === 8 ? Number.parseInt(hex.slice(6, 8), 16) / 255 : 1,
  ];
}

function colorFactor(material) {
  const source = material.baseColorFactor ?? material.baseColor ?? material.color;
  const hex = parseHexColor(source);
  if (hex) return hex;
  if (!Array.isArray(source) && !ArrayBuffer.isView(source)) {
    return [0.65, 0.68, 0.7, clamp01(material.opacity ?? material.alpha, 1)];
  }
  const values = Array.from(source).slice(0, 4);
  const scale = values.slice(0, 3).some((entry) => Number(entry) > 1) ? 255 : 1;
  const alpha = values.length >= 4 ? values[3] : material.opacity ?? material.alpha ?? 1;
  const alphaScale = Number(alpha) > 1 ? 255 : 1;
  return [
    clamp01(finiteNumber(values[0], 0.65) / scale),
    clamp01(finiteNumber(values[1], 0.68) / scale),
    clamp01(finiteNumber(values[2], 0.7) / scale),
    clamp01(finiteNumber(alpha, 1) / alphaScale),
  ];
}

function materialEntries(materials) {
  if (materials == null) return [];
  if (Array.isArray(materials)) {
    return materials.map((definition, index) => [definition?.id ?? String(index), definition ?? {}]);
  }
  if (materials instanceof Map) return Array.from(materials.entries());
  if (typeof materials === 'object') {
    if ('id' in materials && ('baseColorFactor' in materials || 'color' in materials)) {
      return [[materials.id, materials]];
    }
    return Object.entries(materials).map(([id, definition]) => [id, definition ?? {}]);
  }
  throw new TypeError('materials must be an array, object, Map, or undefined');
}

function gltfMaterial(id, definition) {
  if (typeof definition !== 'object' || Array.isArray(definition)) definition = {};
  const baseColorFactor = colorFactor(definition);
  const alphaMode = String(
    definition.alphaMode ?? (baseColorFactor[3] < 1 ? 'BLEND' : 'OPAQUE'),
  ).toUpperCase();
  if (!['OPAQUE', 'MASK', 'BLEND'].includes(alphaMode)) {
    throw new RangeError(`Unsupported alphaMode for material ${id}: ${alphaMode}`);
  }

  const material = {
    name: String(definition.name ?? definition.nameEn ?? definition.nameZh ?? id),
    pbrMetallicRoughness: {
      baseColorFactor,
      metallicFactor: clamp01(definition.metallicFactor ?? definition.metalness, 0),
      roughnessFactor: clamp01(definition.roughnessFactor ?? definition.roughness, 0.78),
    },
    alphaMode,
    doubleSided: Boolean(definition.doubleSided),
    extras: {
      forgecore: {
        id: String(id),
        ...(definition.nameZh ? { nameZh: String(definition.nameZh) } : {}),
        ...(definition.nameEn ? { nameEn: String(definition.nameEn) } : {}),
      },
    },
  };
  if (alphaMode === 'MASK') material.alphaCutoff = clamp01(definition.alphaCutoff, 0.5);
  if (definition.emissiveFactor) {
    material.emissiveFactor = Array.from(definition.emissiveFactor)
      .slice(0, 3)
      .map((entry) => clamp01(entry, 0));
  }
  return material;
}

function normalizeMaterials(materials, primitives) {
  const definitions = [];
  const byId = new Map();

  for (const [rawId, rawDefinition] of materialEntries(materials)) {
    const id = String(rawDefinition?.id ?? rawId);
    if (byId.has(id)) throw new Error(`Duplicate material id: ${id}`);
    byId.set(id, definitions.length);
    definitions.push(gltfMaterial(id, rawDefinition));
  }

  // A missing semantic material should not make a generated model unusable.
  // Preserve its id and emit a neutral PBR fallback so the omission is auditable.
  for (const primitive of primitives) {
    if (primitive.material == null || typeof primitive.material === 'number') continue;
    const id = String(primitive.material);
    if (!byId.has(id)) {
      byId.set(id, definitions.length);
      definitions.push(gltfMaterial(id, { id, name: id }));
    }
  }

  return { definitions, byId };
}

function numericArray(value, label) {
  if (!Array.isArray(value) && !ArrayBuffer.isView(value)) {
    throw new TypeError(`${label} must be an Array or TypedArray`);
  }
  return value;
}

function float32Buffer(value, multiple, label) {
  const source = numericArray(value, label);
  if (source.length === 0 || source.length % multiple !== 0) {
    throw new RangeError(`${label}.length must be a non-zero multiple of ${multiple}`);
  }
  const array = new Float32Array(source.length);
  for (let index = 0; index < source.length; index += 1) {
    const number = Number(source[index]);
    if (!Number.isFinite(number)) throw new RangeError(`${label}[${index}] is not finite`);
    array[index] = number;
    if (!Number.isFinite(array[index])) throw new RangeError(`${label}[${index}] cannot be represented as Float32`);
  }
  return Buffer.from(array.buffer, array.byteOffset, array.byteLength);
}

function indexBuffer(value, vertexCount, label) {
  const source = numericArray(value, label);
  if (source.length === 0 || source.length % 3 !== 0) {
    throw new RangeError(`${label}.length must be a non-zero multiple of 3`);
  }
  let maximum = 0;
  for (let index = 0; index < source.length; index += 1) {
    const number = Number(source[index]);
    if (!Number.isInteger(number) || number < 0 || number >= vertexCount) {
      throw new RangeError(`${label}[${index}] (${source[index]}) is outside the vertex range`);
    }
    if (number > maximum) maximum = number;
  }
  const ArrayType = maximum <= 0xffff ? Uint16Array : Uint32Array;
  const array = new ArrayType(source.length);
  for (let index = 0; index < source.length; index += 1) array[index] = Number(source[index]);
  return {
    buffer: Buffer.from(array.buffer, array.byteOffset, array.byteLength),
    componentType: ArrayType === Uint16Array ? COMPONENT_TYPE.UNSIGNED_SHORT : COMPONENT_TYPE.UNSIGNED_INT,
  };
}

function positionBounds(buffer) {
  const view = new Float32Array(buffer.buffer, buffer.byteOffset, buffer.byteLength / 4);
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let index = 0; index < view.length; index += 3) {
    for (let axis = 0; axis < 3; axis += 1) {
      const value = view[index + axis];
      if (value < min[axis]) min[axis] = value;
      if (value > max[axis]) max[axis] = value;
    }
  }
  return { min, max };
}

function metadataName(metadata) {
  return String(metadata.nameEn ?? metadata.nameZh ?? metadata.name ?? metadata.id ?? 'ForgeCore item');
}

/**
 * Write a finalized ForgeCore geometry as a self-contained GLB 2.0 Buffer.
 *
 * @param {object} geometry finalized geometry with a `primitives` array
 * @param {Array|object|Map} materials material definitions keyed by semantic id
 * @param {object} metadata JSON metadata written to asset.extras.forgecore
 * @returns {Buffer}
 */
export function writeGlb(geometry, materials = [], metadata = {}) {
  if (!geometry || typeof geometry !== 'object' || !Array.isArray(geometry.primitives)) {
    throw new TypeError('geometry.primitives must be an array');
  }
  if (geometry.primitives.length === 0) throw new RangeError('geometry.primitives cannot be empty');

  const cleanMetadata = plainJson(metadata, {});
  const forgecore =
    cleanMetadata && typeof cleanMetadata === 'object' && !Array.isArray(cleanMetadata)
      ? { ...cleanMetadata }
      : { value: cleanMetadata };
  if (geometry.bounds !== undefined && forgecore.bounds === undefined) {
    forgecore.bounds = plainJson(geometry.bounds, null);
  }
  if (geometry.metrics !== undefined && forgecore.metrics === undefined) {
    forgecore.metrics = plainJson(geometry.metrics, null);
  }

  const normalizedMaterials = normalizeMaterials(materials, geometry.primitives);
  const gltf = {
    asset: {
      version: '2.0',
      generator: 'ForgeCore item-models glb-writer',
      extras: { forgecore },
    },
    scene: 0,
    scenes: [{ name: metadataName(forgecore), nodes: [0] }],
    nodes: [{ name: metadataName(forgecore), mesh: 0 }],
    meshes: [{ name: metadataName(forgecore), primitives: [] }],
    materials: normalizedMaterials.definitions,
    buffers: [{ byteLength: 0 }],
    bufferViews: [],
    accessors: [],
  };

  const binaryParts = [];
  let binaryLength = 0;

  function appendBufferView(data, target) {
    const alignedOffset = align4(binaryLength);
    if (alignedOffset > binaryLength) binaryParts.push(Buffer.alloc(alignedOffset - binaryLength));
    binaryLength = alignedOffset;
    const index = gltf.bufferViews.length;
    gltf.bufferViews.push({ buffer: 0, byteOffset: binaryLength, byteLength: data.byteLength, target });
    binaryParts.push(data);
    binaryLength += data.byteLength;
    return index;
  }

  function appendAccessor(data, options) {
    const bufferView = appendBufferView(data, options.target);
    const accessor = {
      bufferView,
      byteOffset: 0,
      componentType: options.componentType,
      count: options.count,
      type: options.type,
    };
    if (options.min) accessor.min = options.min;
    if (options.max) accessor.max = options.max;
    gltf.accessors.push(accessor);
    return gltf.accessors.length - 1;
  }

  geometry.primitives.forEach((primitive, primitiveIndex) => {
    if (!primitive || typeof primitive !== 'object') {
      throw new TypeError(`geometry.primitives[${primitiveIndex}] must be an object`);
    }
    const prefix = `geometry.primitives[${primitiveIndex}]`;
    const positionData = float32Buffer(primitive.positions, 3, `${prefix}.positions`);
    const vertexCount = positionData.byteLength / 12;
    const bounds = positionBounds(positionData);
    const attributes = {
      POSITION: appendAccessor(positionData, {
        target: ARRAY_BUFFER,
        componentType: COMPONENT_TYPE.FLOAT,
        count: vertexCount,
        type: 'VEC3',
        min: bounds.min,
        max: bounds.max,
      }),
    };

    if (primitive.normals != null && primitive.normals.length !== 0) {
      const normalData = float32Buffer(primitive.normals, 3, `${prefix}.normals`);
      if (normalData.byteLength / 12 !== vertexCount) {
        throw new RangeError(`${prefix}.normals must contain one normal per vertex`);
      }
      attributes.NORMAL = appendAccessor(normalData, {
        target: ARRAY_BUFFER,
        componentType: COMPONENT_TYPE.FLOAT,
        count: vertexCount,
        type: 'VEC3',
      });
    }

    if (primitive.uvs != null && primitive.uvs.length !== 0) {
      const uvData = float32Buffer(primitive.uvs, 2, `${prefix}.uvs`);
      if (uvData.byteLength / 8 !== vertexCount) {
        throw new RangeError(`${prefix}.uvs must contain one UV pair per vertex`);
      }
      attributes.TEXCOORD_0 = appendAccessor(uvData, {
        target: ARRAY_BUFFER,
        componentType: COMPONENT_TYPE.FLOAT,
        count: vertexCount,
        type: 'VEC2',
      });
    }

    const indices = indexBuffer(primitive.indices, vertexCount, `${prefix}.indices`);
    const primitiveJson = {
      attributes,
      indices: appendAccessor(indices.buffer, {
        target: ELEMENT_ARRAY_BUFFER,
        componentType: indices.componentType,
        count: indices.buffer.byteLength / (indices.componentType === COMPONENT_TYPE.UNSIGNED_SHORT ? 2 : 4),
        type: 'SCALAR',
      }),
      mode: 4,
    };

    if (typeof primitive.material === 'number') {
      if (!Number.isInteger(primitive.material) || primitive.material < 0 || primitive.material >= gltf.materials.length) {
        throw new RangeError(`${prefix}.material is not a valid material index`);
      }
      primitiveJson.material = primitive.material;
    } else if (primitive.material != null) {
      primitiveJson.material = normalizedMaterials.byId.get(String(primitive.material));
    }
    gltf.meshes[0].primitives.push(primitiveJson);
  });

  const paddedBinaryLength = align4(binaryLength);
  if (paddedBinaryLength > binaryLength) binaryParts.push(Buffer.alloc(paddedBinaryLength - binaryLength));
  const binary = Buffer.concat(binaryParts, paddedBinaryLength);
  gltf.buffers[0].byteLength = binary.byteLength;

  const jsonBytes = Buffer.from(JSON.stringify(gltf), 'utf8');
  const paddedJsonLength = align4(jsonBytes.byteLength);
  const jsonChunk = Buffer.alloc(paddedJsonLength, 0x20);
  jsonBytes.copy(jsonChunk);

  const totalLength = 12 + 8 + jsonChunk.byteLength + 8 + binary.byteLength;
  if (totalLength > 0xffffffff) throw new RangeError('GLB exceeds the 4 GiB container limit');
  const output = Buffer.allocUnsafe(totalLength);
  let offset = 0;
  output.writeUInt32LE(GLB_MAGIC, offset);
  output.writeUInt32LE(GLB_VERSION, offset + 4);
  output.writeUInt32LE(totalLength, offset + 8);
  offset += 12;
  output.writeUInt32LE(jsonChunk.byteLength, offset);
  output.writeUInt32LE(JSON_CHUNK_TYPE, offset + 4);
  jsonChunk.copy(output, offset + 8);
  offset += 8 + jsonChunk.byteLength;
  output.writeUInt32LE(binary.byteLength, offset);
  output.writeUInt32LE(BIN_CHUNK_TYPE, offset + 4);
  binary.copy(output, offset + 8);
  return output;
}

export default writeGlb;
