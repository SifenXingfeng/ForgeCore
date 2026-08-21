import { deflateSync } from 'node:zlib';

const GLB_MAGIC = 0x46546c67;
const JSON_CHUNK = 0x4e4f534a;
const BIN_CHUNK = 0x004e4942;
const COMPONENTS = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 };
const COMPONENT_INFO = {
  5120: { bytes: 1, ArrayType: Int8Array, read: 'getInt8' },
  5121: { bytes: 1, ArrayType: Uint8Array, read: 'getUint8' },
  5122: { bytes: 2, ArrayType: Int16Array, read: 'getInt16' },
  5123: { bytes: 2, ArrayType: Uint16Array, read: 'getUint16' },
  5125: { bytes: 4, ArrayType: Uint32Array, read: 'getUint32' },
  5126: { bytes: 4, ArrayType: Float32Array, read: 'getFloat32' },
};

export function readGlb(buffer) {
  if (buffer.length < 20) throw new Error('GLB is too short');
  if (buffer.readUInt32LE(0) !== GLB_MAGIC) throw new Error('invalid GLB magic');
  if (buffer.readUInt32LE(4) !== 2) throw new Error('GLB version is not 2');
  if (buffer.readUInt32LE(8) !== buffer.length) throw new Error('GLB length does not match file size');

  let offset = 12;
  let jsonChunk = null;
  let binChunk = null;
  while (offset < buffer.length) {
    const length = buffer.readUInt32LE(offset);
    const type = buffer.readUInt32LE(offset + 4);
    const start = offset + 8;
    const end = start + length;
    if (end > buffer.length) throw new Error('GLB chunk exceeds file length');
    if (type === JSON_CHUNK) jsonChunk = buffer.subarray(start, end);
    if (type === BIN_CHUNK) binChunk = buffer.subarray(start, end);
    offset = end;
  }
  if (!jsonChunk) throw new Error('GLB has no JSON chunk');
  const json = JSON.parse(jsonChunk.toString('utf8').replace(/[\u0000\u0020]+$/u, ''));
  if (json.asset?.version !== '2.0') throw new Error('glTF asset.version is not 2.0');
  return { json, bin: binChunk };
}

export function readAccessor(document, accessorIndex) {
  const accessor = document.json.accessors?.[accessorIndex];
  if (!accessor) throw new Error(`missing accessor ${accessorIndex}`);
  const info = COMPONENT_INFO[accessor.componentType];
  const components = COMPONENTS[accessor.type];
  if (!info || !components) throw new Error(`unsupported accessor ${accessorIndex}`);
  const output = new info.ArrayType(accessor.count * components);
  if (accessor.bufferView == null) return output;
  const view = document.json.bufferViews?.[accessor.bufferView];
  if (!view || !document.bin) throw new Error(`missing buffer view for accessor ${accessorIndex}`);
  const stride = view.byteStride ?? info.bytes * components;
  const start = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  const dataView = new DataView(document.bin.buffer, document.bin.byteOffset, document.bin.byteLength);
  for (let index = 0; index < accessor.count; index += 1) {
    const elementOffset = start + index * stride;
    for (let component = 0; component < components; component += 1) {
      output[index * components + component] = dataView[info.read](elementOffset + component * info.bytes, true);
    }
  }
  return output;
}

function multiplyMatrixPoint(matrix, point) {
  return [
    matrix[0] * point[0] + matrix[4] * point[1] + matrix[8] * point[2] + matrix[12],
    matrix[1] * point[0] + matrix[5] * point[1] + matrix[9] * point[2] + matrix[13],
    matrix[2] * point[0] + matrix[6] * point[1] + matrix[10] * point[2] + matrix[14],
  ];
}

function primitiveGeometry(document, primitive) {
  const positionAccessor = primitive.attributes?.POSITION;
  if (positionAccessor == null) return null;
  const positions = readAccessor(document, positionAccessor);
  const normals = primitive.attributes.NORMAL == null ? null : readAccessor(document, primitive.attributes.NORMAL);
  const indices = primitive.indices == null
    ? Uint32Array.from({ length: positions.length / 3 }, (_, index) => index)
    : readAccessor(document, primitive.indices);
  const material = document.json.materials?.[primitive.material ?? 0];
  const factor = material?.pbrMetallicRoughness?.baseColorFactor ?? material?.baseColorFactor ?? [0.45, 0.5, 0.54, 1];
  return { positions, normals, indices, color: factor };
}

export function extractGeometry(document) {
  const primitives = [];
  for (const mesh of document.json.meshes ?? []) {
    for (const primitive of mesh.primitives ?? []) {
      const geometry = primitiveGeometry(document, primitive);
      if (geometry) primitives.push(geometry);
    }
  }
  if (primitives.length === 0) throw new Error('GLB contains no POSITION primitives');
  return { primitives };
}

function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
function length(vector) { return Math.hypot(vector[0], vector[1], vector[2]) || 1; }
function normalize(vector) { const scale = 1 / length(vector); return vector.map((value) => value * scale); }
function edge(ax, ay, bx, by, px, py) { return (px - ax) * (by - ay) - (py - ay) * (bx - ax); }
function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const name = Buffer.from(type);
  const output = Buffer.alloc(12 + data.length);
  output.writeUInt32BE(data.length, 0);
  name.copy(output, 4);
  data.copy(output, 8);
  output.writeUInt32BE(crc32(Buffer.concat([name, data])), 8 + data.length);
  return output;
}

export function encodePng(width, height, pixels) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  const scanlines = Buffer.alloc(height * (width * 4 + 1));
  for (let row = 0; row < height; row += 1) {
    const start = row * (width * 4 + 1);
    Buffer.from(pixels.buffer, pixels.byteOffset + row * width * 4, width * 4).copy(scanlines, start + 1);
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(scanlines, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

export function renderPreview(geometry, { width = 512, height = 512 } = {}) {
  const view = normalize([1, 0.8, 1]);
  const right = normalize(cross([0, 1, 0], view));
  const up = normalize(cross(view, right));
  const light = normalize([-0.35, 0.9, 0.45]);
  const projected = [];
  let minX = Infinity; let maxX = -Infinity; let minY = Infinity; let maxY = -Infinity;
  for (const primitive of geometry.primitives) {
    const points = [];
    for (let index = 0; index < primitive.positions.length; index += 3) {
      const point = [primitive.positions[index], primitive.positions[index + 1], primitive.positions[index + 2]];
      const x = dot(point, right); const y = dot(point, up); const depth = dot(point, view);
      points.push([x, y, depth]);
      minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    }
    projected.push({ primitive, points });
  }
  const scale = Math.min(width * 0.82 / Math.max(maxX - minX, 1e-6), height * 0.82 / Math.max(maxY - minY, 1e-6));
  const centerX = (minX + maxX) / 2; const centerY = (minY + maxY) / 2;
  const pixels = new Uint8ClampedArray(width * height * 4);
  const depths = new Float64Array(width * height).fill(-Infinity);
  for (const { primitive, points } of projected) {
    for (let index = 0; index + 2 < primitive.indices.length; index += 3) {
      const indices = [primitive.indices[index], primitive.indices[index + 1], primitive.indices[index + 2]];
      const vertices = indices.map((vertexIndex) => points[vertexIndex]);
      if (vertices.some((vertex) => !vertex)) continue;
      const screen = vertices.map(([x, y, depth]) => [
        (x - centerX) * scale + width / 2,
        height / 2 - (y - centerY) * scale,
        depth,
      ]);
      const area = edge(...screen[0].slice(0, 2), ...screen[1].slice(0, 2), ...screen[2].slice(0, 2));
      if (Math.abs(area) < 1e-6) continue;
      const normal = normalize(cross(
        [vertices[1][0] - vertices[0][0], vertices[1][1] - vertices[0][1], vertices[1][2] - vertices[0][2]],
        [vertices[2][0] - vertices[0][0], vertices[2][1] - vertices[0][1], vertices[2][2] - vertices[0][2]],
      ));
      const intensity = 0.34 + 0.66 * Math.max(0, dot(normal, light));
      const color = primitive.color ?? [0.45, 0.5, 0.54, 1];
      const minPixelX = clamp(Math.floor(Math.min(...screen.map((point) => point[0]))), 0, width - 1);
      const maxPixelX = clamp(Math.ceil(Math.max(...screen.map((point) => point[0]))), 0, width - 1);
      const minPixelY = clamp(Math.floor(Math.min(...screen.map((point) => point[1]))), 0, height - 1);
      const maxPixelY = clamp(Math.ceil(Math.max(...screen.map((point) => point[1]))), 0, height - 1);
      for (let pixelY = minPixelY; pixelY <= maxPixelY; pixelY += 1) {
        for (let pixelX = minPixelX; pixelX <= maxPixelX; pixelX += 1) {
          const sampleX = pixelX + 0.5; const sampleY = pixelY + 0.5;
          const w0 = edge(screen[1][0], screen[1][1], screen[2][0], screen[2][1], sampleX, sampleY) / area;
          const w1 = edge(screen[2][0], screen[2][1], screen[0][0], screen[0][1], sampleX, sampleY) / area;
          const w2 = 1 - w0 - w1;
          if (w0 < 0 || w1 < 0 || w2 < 0) continue;
          const depth = w0 * screen[0][2] + w1 * screen[1][2] + w2 * screen[2][2];
          const pixelIndex = pixelY * width + pixelX;
          if (depth <= depths[pixelIndex]) continue;
          const target = pixelIndex * 4;
          pixels[target] = Math.round(clamp(color[0] * intensity, 0, 1) * 255);
          pixels[target + 1] = Math.round(clamp(color[1] * intensity, 0, 1) * 255);
          pixels[target + 2] = Math.round(clamp(color[2] * intensity, 0, 1) * 255);
          pixels[target + 3] = Math.round(clamp(color[3] ?? 1, 0, 1) * 255);
          depths[pixelIndex] = depth;
        }
      }
    }
  }
  return encodePng(width, height, pixels);
}

export function isGitLfsPointer(buffer) {
  return buffer.subarray(0, 80).toString('utf8').startsWith('version https://git-lfs.github.com/spec/v1');
}
