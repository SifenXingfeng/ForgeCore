/** Dependency-free GLB 2.0 reader and accessor decoder used by asset audits. */

const GLB_MAGIC = 0x46546c67;
const JSON_CHUNK_TYPE = 0x4e4f534a;
const BIN_CHUNK_TYPE = 0x004e4942;

const COMPONENTS = Object.freeze({
  SCALAR: 1,
  VEC2: 2,
  VEC3: 3,
  VEC4: 4,
  MAT2: 4,
  MAT3: 9,
  MAT4: 16,
});

const COMPONENT_INFO = Object.freeze({
  5120: { bytes: 1, ArrayType: Int8Array, read: 'getInt8', signed: true },
  5121: { bytes: 1, ArrayType: Uint8Array, read: 'getUint8', signed: false },
  5122: { bytes: 2, ArrayType: Int16Array, read: 'getInt16', signed: true },
  5123: { bytes: 2, ArrayType: Uint16Array, read: 'getUint16', signed: false },
  5125: { bytes: 4, ArrayType: Uint32Array, read: 'getUint32', signed: false },
  5126: { bytes: 4, ArrayType: Float32Array, read: 'getFloat32', float: true },
});

function asBuffer(value) {
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  if (value instanceof ArrayBuffer) return Buffer.from(value);
  throw new TypeError('GLB input must be a Buffer, Uint8Array, or ArrayBuffer');
}

function assertInteger(value, label, minimum = 0) {
  if (!Number.isInteger(value) || value < minimum) throw new RangeError(`${label} must be an integer >= ${minimum}`);
}

function validateStructure(json, bin) {
  if (!json || typeof json !== 'object' || Array.isArray(json)) throw new Error('GLB JSON root must be an object');
  if (String(json.asset?.version) !== '2.0') throw new Error('GLB JSON asset.version must be "2.0"');
  const buffers = json.buffers ?? [];
  if (!Array.isArray(buffers)) throw new TypeError('glTF buffers must be an array');
  if (buffers.length > 0) {
    assertInteger(buffers[0].byteLength, 'buffers[0].byteLength', 1);
    if (buffers[0].uri != null) throw new Error('GLB primary buffer must not have a URI');
    if (!bin && buffers[0].byteLength > 0) throw new Error('GLB is missing its declared BIN chunk');
    if (bin && buffers[0].byteLength > bin.byteLength) throw new RangeError('BIN chunk is shorter than buffers[0].byteLength');
  }
  if (buffers.length > 1) {
    throw new Error('External or multiple buffers are not supported by the ForgeCore GLB reader');
  }

  const views = json.bufferViews ?? [];
  if (!Array.isArray(views)) throw new TypeError('glTF bufferViews must be an array');
  views.forEach((view, index) => {
    if (!view || typeof view !== 'object') throw new TypeError(`bufferViews[${index}] must be an object`);
    if (view.buffer !== 0) throw new Error(`bufferViews[${index}] does not reference the embedded buffer`);
    const byteOffset = view.byteOffset ?? 0;
    assertInteger(byteOffset, `bufferViews[${index}].byteOffset`);
    assertInteger(view.byteLength, `bufferViews[${index}].byteLength`, 1);
    if (!bin || byteOffset + view.byteLength > bin.byteLength) {
      throw new RangeError(`bufferViews[${index}] exceeds the BIN chunk`);
    }
    if (buffers[0] && byteOffset + view.byteLength > buffers[0].byteLength) {
      throw new RangeError(`bufferViews[${index}] exceeds buffers[0].byteLength`);
    }
    if (view.byteStride != null) assertInteger(view.byteStride, `bufferViews[${index}].byteStride`, 1);
  });

  const accessors = json.accessors ?? [];
  if (!Array.isArray(accessors)) throw new TypeError('glTF accessors must be an array');
  accessors.forEach((accessor, index) => {
    if (!accessor || typeof accessor !== 'object') throw new TypeError(`accessors[${index}] must be an object`);
    if (!COMPONENT_INFO[accessor.componentType]) {
      throw new RangeError(`accessors[${index}] has unsupported componentType ${accessor.componentType}`);
    }
    if (!COMPONENTS[accessor.type]) throw new RangeError(`accessors[${index}] has unsupported type ${accessor.type}`);
    assertInteger(accessor.count, `accessors[${index}].count`, 1);
    assertInteger(accessor.byteOffset ?? 0, `accessors[${index}].byteOffset`);
    if ((accessor.byteOffset ?? 0) % COMPONENT_INFO[accessor.componentType].bytes !== 0) {
      throw new RangeError(`accessors[${index}].byteOffset is not component-aligned`);
    }
    if (accessor.bufferView != null) {
      assertInteger(accessor.bufferView, `accessors[${index}].bufferView`);
      if (!views[accessor.bufferView]) throw new RangeError(`accessors[${index}] references a missing bufferView`);
    } else if (!accessor.sparse && accessor.count > 0) {
      // An accessor without a view is valid and initialized to zero in glTF.
    }
    if (accessor.sparse) throw new Error(`Sparse accessor ${index} is not supported`);
  });
}

/**
 * Parse and validate a GLB 2.0 container.
 * @returns {{json: object, bin: Buffer|null, header: object, chunks: Array, readAccessor: Function}}
 */
export function readGlb(input) {
  const buffer = asBuffer(input);
  if (buffer.byteLength < 20) throw new RangeError('GLB is too short');
  const magic = buffer.readUInt32LE(0);
  const version = buffer.readUInt32LE(4);
  const length = buffer.readUInt32LE(8);
  if (magic !== GLB_MAGIC) throw new Error('Invalid GLB magic');
  if (version !== 2) throw new Error(`Unsupported GLB version ${version}`);
  if (length !== buffer.byteLength) {
    throw new RangeError(`GLB declared length ${length} does not match actual length ${buffer.byteLength}`);
  }

  const chunks = [];
  let offset = 12;
  while (offset < length) {
    if (offset + 8 > length) throw new RangeError('Truncated GLB chunk header');
    const chunkLength = buffer.readUInt32LE(offset);
    const type = buffer.readUInt32LE(offset + 4);
    if (chunkLength % 4 !== 0) throw new Error('GLB chunk length is not 4-byte aligned');
    const start = offset + 8;
    const end = start + chunkLength;
    if (end > length) throw new RangeError('GLB chunk exceeds declared container length');
    chunks.push({ type, byteLength: chunkLength, data: buffer.subarray(start, end) });
    offset = end;
  }
  if (offset !== length) throw new RangeError('GLB chunks do not end at the declared length');
  if (chunks.length === 0 || chunks[0].type !== JSON_CHUNK_TYPE) {
    throw new Error('The first GLB chunk must be JSON');
  }
  const jsonChunks = chunks.filter((chunk) => chunk.type === JSON_CHUNK_TYPE);
  const binChunks = chunks.filter((chunk) => chunk.type === BIN_CHUNK_TYPE);
  if (jsonChunks.length !== 1) throw new Error('GLB must contain exactly one JSON chunk');
  if (binChunks.length > 1) throw new Error('GLB cannot contain more than one BIN chunk');

  let json;
  try {
    const text = jsonChunks[0].data.toString('utf8').replace(/[\u0000\u0020]+$/u, '');
    json = JSON.parse(text);
  } catch (error) {
    throw new SyntaxError(`Invalid GLB JSON chunk: ${error.message}`);
  }
  const bin = binChunks[0]?.data ?? null;
  validateStructure(json, bin);
  const result = {
    json,
    bin,
    header: { magic, version, length },
    chunks,
  };
  result.readAccessor = (index, options) => readAccessor(result, index, options);
  return result;
}

function normalizedInteger(value, componentType) {
  switch (componentType) {
    case 5120:
      return Math.max(value / 127, -1);
    case 5121:
      return value / 255;
    case 5122:
      return Math.max(value / 32767, -1);
    case 5123:
      return value / 65535;
    case 5125:
      return value / 4294967295;
    default:
      return value;
  }
}

/**
 * Decode an accessor to a tightly packed TypedArray.
 * Pass `{ normalized: true }` to apply glTF integer normalization and receive a
 * Float32Array. Float accessors always return Float32Array.
 */
export function readAccessor(document, accessorIndex, options = {}) {
  const json = document?.json ?? document;
  const bin = document?.bin ?? options.bin ?? null;
  if (!json || typeof json !== 'object') throw new TypeError('document must be a readGlb result or glTF JSON object');
  assertInteger(accessorIndex, 'accessorIndex');
  const accessor = json.accessors?.[accessorIndex];
  if (!accessor) throw new RangeError(`Accessor ${accessorIndex} does not exist`);
  if (accessor.sparse) throw new Error(`Sparse accessor ${accessorIndex} is not supported`);
  const info = COMPONENT_INFO[accessor.componentType];
  const components = COMPONENTS[accessor.type];
  if (!info || !components) throw new Error(`Accessor ${accessorIndex} has an unsupported format`);
  const normalized = Boolean(options.normalized && accessor.normalized && !info.float);
  const ArrayType = normalized ? Float32Array : info.ArrayType;
  const output = new ArrayType(accessor.count * components);
  if (accessor.bufferView == null || output.length === 0) return output;
  if (!bin) throw new Error('An embedded BIN chunk is required to read this accessor');

  const view = json.bufferViews?.[accessor.bufferView];
  if (!view) throw new RangeError(`Accessor ${accessorIndex} references a missing bufferView`);
  const elementBytes = components * info.bytes;
  const stride = view.byteStride ?? elementBytes;
  if (stride < elementBytes || stride % info.bytes !== 0) {
    throw new RangeError(`Accessor ${accessorIndex} has an invalid byteStride`);
  }
  const start = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  const requiredEnd = accessor.count === 0 ? start : start + (accessor.count - 1) * stride + elementBytes;
  const viewEnd = (view.byteOffset ?? 0) + view.byteLength;
  if (requiredEnd > viewEnd || requiredEnd > bin.byteLength) {
    throw new RangeError(`Accessor ${accessorIndex} exceeds its bufferView`);
  }

  const dataView = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
  let outputIndex = 0;
  for (let element = 0; element < accessor.count; element += 1) {
    const elementOffset = start + element * stride;
    for (let component = 0; component < components; component += 1) {
      const value = dataView[info.read](elementOffset + component * info.bytes, true);
      output[outputIndex] = normalized ? normalizedInteger(value, accessor.componentType) : value;
      outputIndex += 1;
    }
  }
  return output;
}

export const readAccessorData = readAccessor;
export default readGlb;
