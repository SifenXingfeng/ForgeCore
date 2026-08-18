import { deflateSync } from 'node:zlib';

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function normalize3(vector, fallback) {
  const x = finite(vector?.[0], fallback[0]);
  const y = finite(vector?.[1], fallback[1]);
  const z = finite(vector?.[2], fallback[2]);
  const length = Math.hypot(x, y, z);
  return length > 1e-12 ? [x / length, y / length, z / length] : [...fallback];
}

function cross(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function dot3(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function parseHex(value) {
  if (typeof value !== 'string') return null;
  const match = /^#([0-9a-f]{6}|[0-9a-f]{8})$/i.exec(value.trim());
  if (!match) return null;
  const text = match[1];
  return [
    Number.parseInt(text.slice(0, 2), 16) / 255,
    Number.parseInt(text.slice(2, 4), 16) / 255,
    Number.parseInt(text.slice(4, 6), 16) / 255,
    text.length === 8 ? Number.parseInt(text.slice(6, 8), 16) / 255 : 1,
  ];
}

function rgba(value, fallback = [0.65, 0.68, 0.7, 1]) {
  const hex = parseHex(value);
  if (hex) return hex;
  if (!Array.isArray(value) && !ArrayBuffer.isView(value)) return [...fallback];
  const array = Array.from(value);
  const rgbScale = array.slice(0, 3).some((entry) => Number(entry) > 1) ? 255 : 1;
  const alphaScale = Number(array[3]) > 1 ? 255 : 1;
  return [
    clamp(finite(array[0], fallback[0]) / rgbScale, 0, 1),
    clamp(finite(array[1], fallback[1]) / rgbScale, 0, 1),
    clamp(finite(array[2], fallback[2]) / rgbScale, 0, 1),
    clamp(finite(array[3], fallback[3]) / alphaScale, 0, 1),
  ];
}

function materialMap(materials) {
  const byId = new Map();
  const list = [];
  let entries;
  if (materials == null) entries = [];
  else if (Array.isArray(materials)) entries = materials.map((entry, index) => [entry?.id ?? String(index), entry ?? {}]);
  else if (materials instanceof Map) entries = Array.from(materials.entries());
  else if (typeof materials === 'object') {
    entries = 'id' in materials && ('baseColorFactor' in materials || 'color' in materials)
      ? [[materials.id, materials]]
      : Object.entries(materials);
  }
  else throw new TypeError('options.materials must be an array, object, or Map');

  for (const [key, rawDefinition] of entries) {
    const definition = rawDefinition ?? {};
    const id = String(definition.id ?? key);
    const color = rgba(definition.baseColorFactor ?? definition.baseColor ?? definition.color);
    if (definition.opacity != null || definition.alpha != null) {
      color[3] = clamp(finite(definition.opacity ?? definition.alpha, color[3]), 0, 1);
    }
    const material = {
      color,
      alphaMode: String(definition.alphaMode ?? (color[3] < 1 ? 'BLEND' : 'OPAQUE')).toUpperCase(),
      alphaCutoff: clamp(finite(definition.alphaCutoff, 0.5), 0, 1),
      doubleSided: Boolean(definition.doubleSided),
    };
    byId.set(id, material);
    list.push(material);
  }
  return { byId, list };
}

function primitiveMaterial(primitive, materials) {
  if (typeof primitive.material === 'number') return materials.list[primitive.material] ?? null;
  if (primitive.material != null) return materials.byId.get(String(primitive.material)) ?? null;
  return null;
}

function numericArray(value, label, multiple) {
  if (!Array.isArray(value) && !ArrayBuffer.isView(value)) throw new TypeError(`${label} must be an Array or TypedArray`);
  if (value.length === 0 || value.length % multiple !== 0) {
    throw new RangeError(`${label}.length must be a non-zero multiple of ${multiple}`);
  }
  return value;
}

function crcTable() {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    table[index] = value >>> 0;
  }
  return table;
}

const CRC_TABLE = crcTable();

function crc32(buffers) {
  let crc = 0xffffffff;
  for (const buffer of buffers) {
    for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const name = Buffer.from(type, 'ascii');
  const output = Buffer.allocUnsafe(12 + data.byteLength);
  output.writeUInt32BE(data.byteLength, 0);
  name.copy(output, 4);
  data.copy(output, 8);
  output.writeUInt32BE(crc32([name, data]), 8 + data.byteLength);
  return output;
}

function encodePng(width, height, pixels, compressionLevel) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const scanlines = Buffer.allocUnsafe(height * (width * 4 + 1));
  for (let row = 0; row < height; row += 1) {
    const target = row * (width * 4 + 1);
    scanlines[target] = 0;
    Buffer.from(pixels.buffer, pixels.byteOffset + row * width * 4, width * 4).copy(scanlines, target + 1);
  }
  const compressed = deflateSync(scanlines, { level: compressionLevel });
  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', compressed),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function edge(ax, ay, bx, by, px, py) {
  return (px - ax) * (by - ay) - (py - ay) * (bx - ax);
}

/**
 * Render finalized ForgeCore geometry to an isometric RGBA PNG.
 * Defaults to a transparent 512x512 image.
 *
 * @param {object} geometry finalized geometry containing triangle primitives
 * @param {object} options materials, background, cameraDirection, lightDirection,
 *   width, height, padding, ambient and compressionLevel
 * @returns {Buffer}
 */
export function createPreviewPng(geometry, options = {}) {
  if (!geometry || !Array.isArray(geometry.primitives) || geometry.primitives.length === 0) {
    throw new TypeError('geometry.primitives must be a non-empty array');
  }
  const width = Math.trunc(finite(options.width, 512));
  const height = Math.trunc(finite(options.height, 512));
  if (width < 1 || height < 1 || width > 4096 || height > 4096) {
    throw new RangeError('Preview dimensions must be between 1 and 4096 pixels');
  }
  const background = rgba(options.background ?? [0, 0, 0, 0], [0, 0, 0, 0]);
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let offset = 0; offset < pixels.length; offset += 4) {
    pixels[offset] = Math.round(background[0] * 255);
    pixels[offset + 1] = Math.round(background[1] * 255);
    pixels[offset + 2] = Math.round(background[2] * 255);
    pixels[offset + 3] = Math.round(background[3] * 255);
  }
  const depths = new Float64Array(width * height);
  depths.fill(-Infinity);

  const viewToCamera = normalize3(options.cameraDirection, normalize3([1, 0.8, 1], [0, 1, 0]));
  let right = normalize3(cross([0, 1, 0], viewToCamera), [1, 0, 0]);
  if (Math.abs(dot3(right, right)) < 1e-8) right = [1, 0, 0];
  const up = normalize3(cross(viewToCamera, right), [0, 1, 0]);
  const light = normalize3(options.lightDirection, normalize3([-0.35, 0.9, 0.45], [0, 1, 0]));
  const ambient = clamp(finite(options.ambient, 0.34), 0, 1);
  const diffuseStrength = 1 - ambient;
  const materials = materialMap(options.materials);
  const defaultMaterial = { color: rgba(options.defaultColor), alphaMode: 'OPAQUE', alphaCutoff: 0.5, doubleSided: true };

  const prepared = [];
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  geometry.primitives.forEach((primitive, primitiveIndex) => {
    const prefix = `geometry.primitives[${primitiveIndex}]`;
    const positions = numericArray(primitive.positions, `${prefix}.positions`, 3);
    const normals = primitive.normals == null || primitive.normals.length === 0 ? null : numericArray(primitive.normals, `${prefix}.normals`, 3);
    if (normals && normals.length !== positions.length) throw new RangeError(`${prefix}.normals must match positions`);
    const indices = numericArray(primitive.indices, `${prefix}.indices`, 3);
    const projected = new Float64Array((positions.length / 3) * 3);
    for (let index = 0, vertex = 0; index < positions.length; index += 3, vertex += 3) {
      const point = [finite(positions[index]), finite(positions[index + 1]), finite(positions[index + 2])];
      const x = dot3(point, right);
      const y = dot3(point, up);
      const depth = dot3(point, viewToCamera);
      projected[vertex] = x;
      projected[vertex + 1] = y;
      projected[vertex + 2] = depth;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    prepared.push({ positions, normals, indices, projected, material: primitiveMaterial(primitive, materials) ?? defaultMaterial });
  });

  if (![minX, minY, maxX, maxY].every(Number.isFinite)) throw new Error('Geometry contains no finite vertices');
  const padding = clamp(finite(options.padding, 0.08), 0, 0.45);
  const availableWidth = Math.max(1, width * (1 - padding * 2));
  const availableHeight = Math.max(1, height * (1 - padding * 2));
  const rangeX = Math.max(maxX - minX, 1e-9);
  const rangeY = Math.max(maxY - minY, 1e-9);
  const scale = Math.min(availableWidth / rangeX, availableHeight / rangeY);
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;

  for (const primitive of prepared) {
    const vertexCount = primitive.projected.length / 3;
    for (let indexOffset = 0; indexOffset < primitive.indices.length; indexOffset += 3) {
      const i0 = Number(primitive.indices[indexOffset]);
      const i1 = Number(primitive.indices[indexOffset + 1]);
      const i2 = Number(primitive.indices[indexOffset + 2]);
      if (![i0, i1, i2].every((index) => Number.isInteger(index) && index >= 0 && index < vertexCount)) {
        throw new RangeError(`Triangle index is outside the vertex range`);
      }
      const a = i0 * 3;
      const b = i1 * 3;
      const c = i2 * 3;
      const x0 = (primitive.projected[a] - centerX) * scale + width / 2;
      const y0 = height / 2 - (primitive.projected[a + 1] - centerY) * scale;
      const x1 = (primitive.projected[b] - centerX) * scale + width / 2;
      const y1 = height / 2 - (primitive.projected[b + 1] - centerY) * scale;
      const x2 = (primitive.projected[c] - centerX) * scale + width / 2;
      const y2 = height / 2 - (primitive.projected[c + 1] - centerY) * scale;
      const area = edge(x0, y0, x1, y1, x2, y2);
      if (Math.abs(area) < 1e-10) continue;

      const minPixelX = clamp(Math.floor(Math.min(x0, x1, x2)), 0, width - 1);
      const maxPixelX = clamp(Math.ceil(Math.max(x0, x1, x2)), 0, width - 1);
      const minPixelY = clamp(Math.floor(Math.min(y0, y1, y2)), 0, height - 1);
      const maxPixelY = clamp(Math.ceil(Math.max(y0, y1, y2)), 0, height - 1);

      let faceNormal = null;
      if (!primitive.normals) {
        const ab = [
          finite(primitive.positions[b]) - finite(primitive.positions[a]),
          finite(primitive.positions[b + 1]) - finite(primitive.positions[a + 1]),
          finite(primitive.positions[b + 2]) - finite(primitive.positions[a + 2]),
        ];
        const ac = [
          finite(primitive.positions[c]) - finite(primitive.positions[a]),
          finite(primitive.positions[c + 1]) - finite(primitive.positions[a + 1]),
          finite(primitive.positions[c + 2]) - finite(primitive.positions[a + 2]),
        ];
        faceNormal = normalize3(cross(ab, ac), [0, 1, 0]);
      }
      const sourceAlpha = primitive.material.alphaMode === 'MASK'
        ? primitive.material.color[3] >= primitive.material.alphaCutoff ? 1 : 0
        : primitive.material.alphaMode === 'OPAQUE' ? 1 : primitive.material.color[3];
      if (sourceAlpha <= 0) continue;

      for (let pixelY = minPixelY; pixelY <= maxPixelY; pixelY += 1) {
        for (let pixelX = minPixelX; pixelX <= maxPixelX; pixelX += 1) {
          const sampleX = pixelX + 0.5;
          const sampleY = pixelY + 0.5;
          const w0 = edge(x1, y1, x2, y2, sampleX, sampleY) / area;
          const w1 = edge(x2, y2, x0, y0, sampleX, sampleY) / area;
          const w2 = 1 - w0 - w1;
          if (w0 < -1e-9 || w1 < -1e-9 || w2 < -1e-9) continue;
          const depth = w0 * primitive.projected[a + 2] + w1 * primitive.projected[b + 2] + w2 * primitive.projected[c + 2];
          const pixelIndex = pixelY * width + pixelX;
          if (depth <= depths[pixelIndex]) continue;

          let normal;
          if (primitive.normals) {
            normal = normalize3([
              w0 * finite(primitive.normals[a]) + w1 * finite(primitive.normals[b]) + w2 * finite(primitive.normals[c]),
              w0 * finite(primitive.normals[a + 1]) + w1 * finite(primitive.normals[b + 1]) + w2 * finite(primitive.normals[c + 1]),
              w0 * finite(primitive.normals[a + 2]) + w1 * finite(primitive.normals[b + 2]) + w2 * finite(primitive.normals[c + 2]),
            ], faceNormal ?? [0, 1, 0]);
          } else normal = faceNormal;
          let lambert = dot3(normal, light);
          if (primitive.material.doubleSided) lambert = Math.abs(lambert);
          const intensity = ambient + diffuseStrength * Math.max(0, lambert);
          const outputOffset = pixelIndex * 4;
          const destinationAlpha = pixels[outputOffset + 3] / 255;
          const resultAlpha = sourceAlpha + destinationAlpha * (1 - sourceAlpha);
          for (let channel = 0; channel < 3; channel += 1) {
            const source = clamp(primitive.material.color[channel] * intensity, 0, 1);
            const destination = pixels[outputOffset + channel] / 255;
            const composited = resultAlpha > 0
              ? (source * sourceAlpha + destination * destinationAlpha * (1 - sourceAlpha)) / resultAlpha
              : 0;
            pixels[outputOffset + channel] = Math.round(clamp(composited, 0, 1) * 255);
          }
          pixels[outputOffset + 3] = Math.round(clamp(resultAlpha, 0, 1) * 255);
          depths[pixelIndex] = depth;
        }
      }
    }
  }

  return encodePng(width, height, pixels, clamp(Math.trunc(finite(options.compressionLevel, 9)), 0, 9));
}

export const renderPreview = createPreviewPng;
export const renderPreviewPng = createPreviewPng;
export default createPreviewPng;
