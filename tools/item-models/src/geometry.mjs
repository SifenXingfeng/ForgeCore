/**
 * ForgeCore deterministic low-poly geometry kernel.
 *
 * Conventions:
 * - metres
 * - right-handed, Y-up coordinates
 * - column-major 4x4 matrices and column vectors
 * - Euler rotations are radians and are applied X, then Y, then Z
 * - triangles use counter-clockwise front faces
 *
 * The kernel deliberately duplicates vertices per triangle. This produces
 * dependable flat face normals, deterministic material grouping and simple
 * sequential indices, which are desirable for the default low-poly library.
 */

const EPSILON = 1e-10;

function fail(name, message) {
  throw new TypeError(`${name}: ${message}`);
}

function finiteNumber(value, name) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    fail(name, "expected a finite number");
  }
  return value;
}

function positiveNumber(value, name, { allowZero = false } = {}) {
  finiteNumber(value, name);
  if (allowZero ? value < 0 : value <= 0) {
    fail(name, `expected a ${allowZero ? "non-negative" : "positive"} number`);
  }
  return value;
}

function integerAtLeast(value, minimum, name) {
  if (!Number.isInteger(value) || value < minimum) {
    fail(name, `expected an integer >= ${minimum}`);
  }
  return value;
}

function vec2(value, name) {
  if (!Array.isArray(value) && !ArrayBuffer.isView(value)) {
    fail(name, "expected [x, y]");
  }
  if (value.length !== 2) fail(name, "expected exactly 2 components");
  return [finiteNumber(value[0], `${name}[0]`), finiteNumber(value[1], `${name}[1]`)];
}

function vec3(value, name, fallback) {
  const source = value ?? fallback;
  if (!Array.isArray(source) && !ArrayBuffer.isView(source)) {
    fail(name, "expected [x, y, z]");
  }
  if (source.length !== 3) fail(name, "expected exactly 3 components");
  return [
    finiteNumber(source[0], `${name}[0]`),
    finiteNumber(source[1], `${name}[1]`),
    finiteNumber(source[2], `${name}[2]`),
  ];
}

function positiveVec3(value, name, fallback = [1, 1, 1]) {
  const result = vec3(value, name, fallback);
  for (let i = 0; i < 3; i += 1) positiveNumber(result[i], `${name}[${i}]`);
  return result;
}

function materialId(value, fallback = "default") {
  const result = value ?? fallback;
  if (typeof result !== "string" || result.trim().length === 0) {
    fail("material", "expected a non-empty string id");
  }
  return result;
}

function sub(a, b) {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function add(a, b) {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function mulScalar(a, scalar) {
  return [a[0] * scalar, a[1] * scalar, a[2] * scalar];
}

function dot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function cross(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function length(a) {
  return Math.hypot(a[0], a[1], a[2]);
}

function normalize(a, name = "vector") {
  const magnitude = length(a);
  if (magnitude <= EPSILON) fail(name, "cannot normalize a zero-length vector");
  return mulScalar(a, 1 / magnitude);
}

function cleanZero(value) {
  return Math.abs(value) <= 1e-12 ? 0 : value;
}

/** Return a new 4x4 identity matrix (column-major). */
export function identity() {
  return [
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1,
  ];
}

function matrix4(value, name = "matrix") {
  if ((!Array.isArray(value) && !ArrayBuffer.isView(value)) || value.length !== 16) {
    fail(name, "expected 16 column-major components");
  }
  return Array.from(value, (component, index) => finiteNumber(component, `${name}[${index}]`));
}

/** Multiply column-major matrices, returning a * b. */
export function multiply(aValue, bValue) {
  const a = matrix4(aValue, "a");
  const b = matrix4(bValue, "b");
  const out = new Array(16).fill(0);
  for (let column = 0; column < 4; column += 1) {
    for (let row = 0; row < 4; row += 1) {
      let value = 0;
      for (let k = 0; k < 4; k += 1) {
        value += a[k * 4 + row] * b[column * 4 + k];
      }
      out[column * 4 + row] = cleanZero(value);
    }
  }
  return out;
}

function translationMatrix([x, y, z]) {
  const matrix = identity();
  matrix[12] = x;
  matrix[13] = y;
  matrix[14] = z;
  return matrix;
}

function scaleMatrix([x, y, z]) {
  return [
    x, 0, 0, 0,
    0, y, 0, 0,
    0, 0, z, 0,
    0, 0, 0, 1,
  ];
}

function rotationXMatrix(angle) {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return [
    1, 0, 0, 0,
    0, c, s, 0,
    0, -s, c, 0,
    0, 0, 0, 1,
  ];
}

function rotationYMatrix(angle) {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return [
    c, 0, -s, 0,
    0, 1, 0, 0,
    s, 0, c, 0,
    0, 0, 0, 1,
  ];
}

function rotationZMatrix(angle) {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return [
    c, s, 0, 0,
    -s, c, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1,
  ];
}

/**
 * Compose a TRS matrix.
 *
 * Accepted forms:
 *   compose({ translation, rotation, scale })
 *   compose(translation, rotation, scale)
 *
 * `center` and `position` are aliases for `translation`. `rotationDegrees`
 * may be used instead of `rotation`. Rotations are applied X -> Y -> Z.
 */
export function compose(options = {}, rotationArgument, scaleArgument) {
  let translation;
  let rotation;
  let scale;

  if (Array.isArray(options) || ArrayBuffer.isView(options)) {
    translation = vec3(options, "translation", [0, 0, 0]);
    rotation = vec3(rotationArgument, "rotation", [0, 0, 0]);
    scale = vec3(scaleArgument, "scale", [1, 1, 1]);
  } else {
    if (options === null || typeof options !== "object") fail("compose", "expected an options object");
    translation = vec3(options.translation ?? options.position ?? options.center, "translation", [0, 0, 0]);
    if (options.rotationDegrees !== undefined) {
      const degrees = vec3(options.rotationDegrees, "rotationDegrees", [0, 0, 0]);
      rotation = degrees.map((angle) => angle * Math.PI / 180);
    } else {
      rotation = vec3(options.rotation, "rotation", [0, 0, 0]);
    }
    scale = vec3(options.scale, "scale", [1, 1, 1]);
  }

  const t = translationMatrix(translation);
  const rx = rotationXMatrix(rotation[0]);
  const ry = rotationYMatrix(rotation[1]);
  const rz = rotationZMatrix(rotation[2]);
  const s = scaleMatrix(scale);
  return multiply(multiply(multiply(multiply(t, rz), ry), rx), s);
}

/** Transform a 3D point with a column-major affine matrix. */
export function transformPoint(matrixValue, pointValue) {
  const matrix = matrix4(matrixValue);
  const [x, y, z] = vec3(pointValue, "point");
  const w = matrix[3] * x + matrix[7] * y + matrix[11] * z + matrix[15];
  if (Math.abs(w) <= EPSILON) fail("transformPoint", "matrix produced w=0");
  return [
    cleanZero((matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12]) / w),
    cleanZero((matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13]) / w),
    cleanZero((matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14]) / w),
  ];
}

function genericTriangleUvs(a, b, c, normal) {
  const ab = sub(b, a);
  const ac = sub(c, a);
  const width = length(ab);
  if (width <= EPSILON) return [[0, 0], [1, 0], [0, 1]];
  const uAxis = mulScalar(ab, 1 / width);
  const vAxis = normalize(cross(normal, uAxis), "UV projection axis");
  return [
    [0, 0],
    [width, 0],
    [dot(ac, uAxis), dot(ac, vAxis)],
  ];
}

function triangleUvs(value, a, b, c, normal) {
  if (value === undefined || value === null) return genericTriangleUvs(a, b, c, normal);
  if (!Array.isArray(value) || value.length !== 3) fail("uvs", "expected 3 UV pairs");
  return value.map((uv, index) => vec2(uv, `uvs[${index}]`));
}

/**
 * Triangle accumulator with a composable transform stack and material groups.
 * All public point input is transformed immediately; finalize() never mutates
 * the accumulated source geometry and may be called repeatedly.
 */
export class MeshBuilder {
  constructor({ transform = identity(), defaultMaterial = "default" } = {}) {
    this.defaultMaterial = materialId(defaultMaterial);
    this._transformStack = [matrix4(transform, "transform")];
    this._groups = new Map();
    this._degenerateTrianglesDropped = 0;
  }

  get transform() {
    return this._transformStack[this._transformStack.length - 1].slice();
  }

  setTransform(matrix) {
    this._transformStack[this._transformStack.length - 1] = matrix4(matrix);
    return this;
  }

  pushTransform(localTransform = identity()) {
    const combined = multiply(this._transformStack[this._transformStack.length - 1], localTransform);
    this._transformStack.push(combined);
    return this;
  }

  popTransform() {
    if (this._transformStack.length === 1) fail("MeshBuilder.popTransform", "cannot pop the root transform");
    this._transformStack.pop();
    return this;
  }

  withTransform(localTransform, callback) {
    if (typeof callback !== "function") fail("MeshBuilder.withTransform", "expected a callback");
    this.pushTransform(localTransform);
    try {
      return callback(this);
    } finally {
      this.popTransform();
    }
  }

  _group(material) {
    const id = materialId(material, this.defaultMaterial);
    if (!this._groups.has(id)) {
      this._groups.set(id, { material: id, positions: [], normals: [], uvs: [] });
    }
    return this._groups.get(id);
  }

  /**
   * Add one triangle. Preferred signature:
   *   addTriangle(a, b, c, { material, uvs })
   * The convenience signature addTriangle(material, a, b, c, uvs) is also
   * accepted. Degenerate triangles are deterministically discarded.
   */
  addTriangle(first, second, third, fourth = {}, fifth) {
    let material;
    let aValue;
    let bValue;
    let cValue;
    let uvsValue;

    if (typeof first === "string") {
      material = materialId(first, this.defaultMaterial);
      aValue = second;
      bValue = third;
      cValue = fourth;
      uvsValue = fifth;
    } else {
      const options = fourth ?? {};
      if (typeof options !== "object" || Array.isArray(options)) {
        fail("MeshBuilder.addTriangle", "expected an options object");
      }
      material = materialId(options.material, this.defaultMaterial);
      aValue = first;
      bValue = second;
      cValue = third;
      uvsValue = options.uvs;
    }

    const matrix = this._transformStack[this._transformStack.length - 1];
    const a = transformPoint(matrix, vec3(aValue, "triangle.a"));
    const b = transformPoint(matrix, vec3(bValue, "triangle.b"));
    const c = transformPoint(matrix, vec3(cValue, "triangle.c"));
    const faceCross = cross(sub(b, a), sub(c, a));
    const areaTwice = length(faceCross);
    if (areaTwice <= EPSILON) {
      this._degenerateTrianglesDropped += 1;
      return false;
    }

    const normal = mulScalar(faceCross, 1 / areaTwice);
    const uvs = triangleUvs(uvsValue, a, b, c, normal);
    const group = this._group(material);
    group.positions.push(...a, ...b, ...c);
    group.normals.push(...normal, ...normal, ...normal);
    group.uvs.push(...uvs[0], ...uvs[1], ...uvs[2]);
    return true;
  }

  /** Add a quad as triangles (a,b,c) and (a,c,d). */
  addQuad(a, b, c, d, options = {}) {
    const quadUvs = options.uvs ?? [[0, 0], [1, 0], [1, 1], [0, 1]];
    if (!Array.isArray(quadUvs) || quadUvs.length !== 4) fail("quad uvs", "expected 4 UV pairs");
    const common = { material: options.material };
    this.addTriangle(a, b, c, { ...common, uvs: [quadUvs[0], quadUvs[1], quadUvs[2]] });
    this.addTriangle(a, c, d, { ...common, uvs: [quadUvs[0], quadUvs[2], quadUvs[3]] });
    return this;
  }

  /**
   * Return material primitives normalized to X/Z centre and minY=0.
   * Every primitive receives sequential 0..N-1 indices.
   */
  finalize() {
    const sourceMin = [Infinity, Infinity, Infinity];
    const sourceMax = [-Infinity, -Infinity, -Infinity];
    let sourceVertexCount = 0;

    for (const group of this._groups.values()) {
      sourceVertexCount += group.positions.length / 3;
      for (let index = 0; index < group.positions.length; index += 3) {
        for (let axis = 0; axis < 3; axis += 1) {
          const value = group.positions[index + axis];
          sourceMin[axis] = Math.min(sourceMin[axis], value);
          sourceMax[axis] = Math.max(sourceMax[axis], value);
        }
      }
    }

    if (sourceVertexCount === 0) {
      const zeroBounds = { min: [0, 0, 0], max: [0, 0, 0], size: [0, 0, 0], center: [0, 0, 0] };
      return {
        units: "meters",
        coordinateSystem: "right-handed-y-up",
        primitives: [],
        bounds: zeroBounds,
        sourceBounds: zeroBounds,
        normalization: { translation: [0, 0, 0] },
        metrics: {
          vertexCount: 0,
          triangleCount: 0,
          primitiveCount: 0,
          materialCount: 0,
          degenerateTrianglesDropped: this._degenerateTrianglesDropped,
          trianglesByMaterial: {},
        },
        vertexCount: 0,
        triangleCount: 0,
      };
    }

    const sourceCenter = sourceMin.map((minimum, axis) => (minimum + sourceMax[axis]) / 2);
    const translation = [-sourceCenter[0], -sourceMin[1], -sourceCenter[2]].map(cleanZero);
    const normalizedMin = [Infinity, Infinity, Infinity];
    const normalizedMax = [-Infinity, -Infinity, -Infinity];
    const trianglesByMaterial = {};

    const groups = [...this._groups.values()].sort((a, b) => (a.material < b.material ? -1 : a.material > b.material ? 1 : 0));
    const primitives = groups.map((group) => {
      const positions = group.positions.slice();
      for (let index = 0; index < positions.length; index += 3) {
        for (let axis = 0; axis < 3; axis += 1) {
          positions[index + axis] = cleanZero(positions[index + axis] + translation[axis]);
          normalizedMin[axis] = Math.min(normalizedMin[axis], positions[index + axis]);
          normalizedMax[axis] = Math.max(normalizedMax[axis], positions[index + axis]);
        }
      }
      const vertexCount = positions.length / 3;
      const indices = Array.from({ length: vertexCount }, (_, index) => index);
      trianglesByMaterial[group.material] = vertexCount / 3;
      return {
        material: group.material,
        positions,
        normals: group.normals.slice(),
        uvs: group.uvs.slice(),
        indices,
      };
    });

    const size = normalizedMin.map((minimum, axis) => cleanZero(normalizedMax[axis] - minimum));
    const center = normalizedMin.map((minimum, axis) => cleanZero((minimum + normalizedMax[axis]) / 2));
    const vertexCount = primitives.reduce((sum, primitive) => sum + primitive.positions.length / 3, 0);
    const triangleCount = vertexCount / 3;
    const bounds = {
      min: normalizedMin.map(cleanZero),
      max: normalizedMax.map(cleanZero),
      size,
      center,
    };
    const sourceSize = sourceMin.map((minimum, axis) => cleanZero(sourceMax[axis] - minimum));

    return {
      units: "meters",
      coordinateSystem: "right-handed-y-up",
      primitives,
      bounds,
      sourceBounds: {
        min: sourceMin.map(cleanZero),
        max: sourceMax.map(cleanZero),
        size: sourceSize,
        center: sourceCenter.map(cleanZero),
      },
      normalization: { translation },
      metrics: {
        vertexCount,
        triangleCount,
        primitiveCount: primitives.length,
        materialCount: primitives.length,
        degenerateTrianglesDropped: this._degenerateTrianglesDropped,
        trianglesByMaterial,
      },
      vertexCount,
      triangleCount,
    };
  }
}

function requireBuilder(builder) {
  if (!(builder instanceof MeshBuilder)) fail("builder", "expected a MeshBuilder instance");
  return builder;
}

function optionTransform(options) {
  const translation = options.center ?? options.position ?? options.translation ?? [0, 0, 0];
  const transformScale = options.transformScale ?? [1, 1, 1];
  const trs = compose({
    translation,
    rotation: options.rotation,
    rotationDegrees: options.rotationDegrees,
    scale: transformScale,
  });
  const explicit = options.transform ?? options.matrix;
  return explicit === undefined ? trs : multiply(trs, matrix4(explicit, "options.transform"));
}

function generate(builder, options, callback) {
  requireBuilder(builder);
  if (options === null || typeof options !== "object" || Array.isArray(options)) {
    fail("options", "expected an object");
  }
  builder.withTransform(optionTransform(options), callback);
  return builder;
}

function faceMaterial(options, face, fallback = options.material) {
  return materialId(options[`${face}Material`] ?? options.faceMaterials?.[face] ?? fallback, "default");
}

function polarPoint(radius, y, angle) {
  return [radius * Math.cos(angle), y, radius * Math.sin(angle)];
}

function polygonCentroid(points) {
  const result = [0, 0, 0];
  for (const point of points) {
    result[0] += point[0];
    result[1] += point[1];
    result[2] += point[2];
  }
  return result.map((value) => value / points.length);
}

function addOutwardFace(builder, points, material) {
  if (points.length < 3) return;
  let ordered = points;
  const normal = cross(sub(points[1], points[0]), sub(points[2], points[0]));
  if (dot(normal, polygonCentroid(points)) < 0) ordered = [...points].reverse();
  for (let index = 1; index < ordered.length - 1; index += 1) {
    builder.addTriangle(ordered[0], ordered[index], ordered[index + 1], { material });
  }
}

/** Add a rectangular or chamfered box centred on options.center. */
export function addBox(builder, options = {}) {
  const sizeValue = typeof options.size === "number" ? [options.size, options.size, options.size] : options.size;
  const [width, height, depth] = positiveVec3(sizeValue, "size", [1, 1, 1]);
  const x = width / 2;
  const y = height / 2;
  const z = depth / 2;
  const requestedRadius = positiveNumber(options.cornerRadius ?? options.chamfer ?? 0, "cornerRadius", { allowZero: true });
  const radius = Math.min(requestedRadius, Math.min(x, y, z) * 0.49);
  const vertices = [
    [-x, -y, -z], [x, -y, -z], [x, -y, z], [-x, -y, z],
    [-x, y, -z], [x, y, -z], [x, y, z], [-x, y, z],
  ];

  return generate(builder, options, () => {
    if (radius > EPSILON) {
      // A stable low-poly chamfer uses an eight-point horizontal footprint.
      // Top and bottom remain single planar caps, avoiding ambiguous 3D corner
      // caps and keeping thin plates artifact-free.
      const footprint = [
        [x - radius, z], [x, z - radius], [x, -z + radius], [x - radius, -z],
        [-x + radius, -z], [-x, -z + radius], [-x, z - radius], [-x + radius, z],
      ];
      const bottom = footprint.map(([px, pz]) => [px, -y, pz]);
      const top = footprint.map(([px, pz]) => [px, y, pz]);
      addOutwardFace(builder, bottom, faceMaterial(options, "bottom"));
      addOutwardFace(builder, top, faceMaterial(options, "top"));
      for (let index = 0; index < footprint.length; index += 1) {
        const next = (index + 1) % footprint.length;
        const face = [bottom[index], bottom[next], top[next], top[index]];
        const isFront = index === 7;
        const isBack = index === 3;
        const isRight = index === 1;
        const isLeft = index === 5;
        const material = isFront ? faceMaterial(options, "front")
          : isBack ? faceMaterial(options, "back")
            : isRight ? faceMaterial(options, "right")
              : isLeft ? faceMaterial(options, "left")
                : faceMaterial(options, "side");
        addOutwardFace(builder, face, material);
      }
      return;
    }
    builder.addQuad(vertices[0], vertices[1], vertices[2], vertices[3], { material: faceMaterial(options, "bottom") });
    builder.addQuad(vertices[7], vertices[6], vertices[5], vertices[4], { material: faceMaterial(options, "top") });
    builder.addQuad(vertices[0], vertices[3], vertices[7], vertices[4], { material: faceMaterial(options, "left") });
    builder.addQuad(vertices[2], vertices[1], vertices[5], vertices[6], { material: faceMaterial(options, "right") });
    builder.addQuad(vertices[3], vertices[2], vertices[6], vertices[7], { material: faceMaterial(options, "front") });
    builder.addQuad(vertices[1], vertices[0], vertices[4], vertices[5], { material: faceMaterial(options, "back") });
  });
}

/** Add a solid or hollow vertical cylinder. */
export function addCylinder(builder, options = {}) {
  const radius = positiveNumber(options.radius ?? 0.5, "radius");
  const innerRadius = positiveNumber(options.innerRadius ?? options.hollowRadius ?? 0, "innerRadius", { allowZero: true });
  if (innerRadius > 0) {
    return addAnnularCylinder(builder, { ...options, outerRadius: radius, innerRadius });
  }
  const height = positiveNumber(options.height ?? 1, "height");
  const segments = integerAtLeast(options.segments ?? 12, 3, "segments");
  const halfHeight = height / 2;
  const caps = options.caps !== false;

  return generate(builder, options, () => {
    for (let index = 0; index < segments; index += 1) {
      const angle = index * Math.PI * 2 / segments;
      const nextAngle = (index + 1) * Math.PI * 2 / segments;
      const bottom = polarPoint(radius, -halfHeight, angle);
      const nextBottom = polarPoint(radius, -halfHeight, nextAngle);
      const top = polarPoint(radius, halfHeight, angle);
      const nextTop = polarPoint(radius, halfHeight, nextAngle);
      builder.addQuad(nextBottom, bottom, top, nextTop, { material: faceMaterial(options, "side") });
      if (caps) {
        builder.addTriangle([0, -halfHeight, 0], bottom, nextBottom, { material: faceMaterial(options, "bottom", options.capMaterial) });
        builder.addTriangle([0, halfHeight, 0], nextTop, top, { material: faceMaterial(options, "top", options.capMaterial) });
      }
    }
  });
}

function size2(value, name, fallback) {
  const result = vec2(value ?? fallback, name);
  positiveNumber(result[0], `${name}[0]`, { allowZero: true });
  positiveNumber(result[1], `${name}[1]`, { allowZero: true });
  return result;
}

/**
 * Add a circular cone/frustum, or a rectangular frustum when bottomSize or
 * topSize ([x,z]) is supplied. Either end may collapse to an apex/ridge.
 */
export function addFrustum(builder, options = {}) {
  const height = positiveNumber(options.height ?? 1, "height");
  const halfHeight = height / 2;
  const caps = options.caps !== false;
  const rectangular = options.bottomSize !== undefined || options.topSize !== undefined;

  if (rectangular) {
    const bottomSize = size2(options.bottomSize, "bottomSize", options.topSize ?? [1, 1]);
    const topSize = size2(options.topSize, "topSize", options.bottomSize ?? [0.5, 0.5]);
    if (bottomSize[0] * bottomSize[1] <= EPSILON && topSize[0] * topSize[1] <= EPSILON) {
      fail("addFrustum", "at least one rectangular end must have area");
    }
    const requestedRadius = positiveNumber(options.cornerRadius ?? options.chamfer ?? 0, "cornerRadius", { allowZero: true });
    const ring = (size, y) => {
      const x = size[0] / 2;
      const z = size[1] / 2;
      const radius = Math.min(requestedRadius, Math.min(x, z) * 0.49);
      if (radius > EPSILON) {
        return [
          [x - radius, y, z], [x, y, z - radius], [x, y, -z + radius], [x - radius, y, -z],
          [-x + radius, y, -z], [-x, y, -z + radius], [-x, y, z - radius], [-x + radius, y, z],
        ];
      }
      return [[x, y, -z], [x, y, z], [-x, y, z], [-x, y, -z]];
    };
    const bottom = ring(bottomSize, -halfHeight);
    const top = ring(topSize, halfHeight);
    return generate(builder, options, () => {
      for (let index = 0; index < bottom.length; index += 1) {
        const next = (index + 1) % bottom.length;
        addOutwardFace(builder, [bottom[index], bottom[next], top[next], top[index]], faceMaterial(options, "side"));
      }
      if (caps && bottomSize[0] * bottomSize[1] > EPSILON) {
        addOutwardFace(builder, bottom, faceMaterial(options, "bottom", options.capMaterial));
      }
      if (caps && topSize[0] * topSize[1] > EPSILON) {
        addOutwardFace(builder, top, faceMaterial(options, "top", options.capMaterial));
      }
    });
  }

  const bottomRadius = positiveNumber(options.bottomRadius ?? options.radius ?? 0.5, "bottomRadius", { allowZero: true });
  const topRadius = positiveNumber(options.topRadius ?? options.radius ?? 0.25, "topRadius", { allowZero: true });
  if (bottomRadius <= EPSILON && topRadius <= EPSILON) fail("addFrustum", "at least one radius must be positive");
  const segments = integerAtLeast(options.segments ?? 12, 3, "segments");

  return generate(builder, options, () => {
    for (let index = 0; index < segments; index += 1) {
      const angle = index * Math.PI * 2 / segments;
      const nextAngle = (index + 1) * Math.PI * 2 / segments;
      const bottom = polarPoint(bottomRadius, -halfHeight, angle);
      const nextBottom = polarPoint(bottomRadius, -halfHeight, nextAngle);
      const top = polarPoint(topRadius, halfHeight, angle);
      const nextTop = polarPoint(topRadius, halfHeight, nextAngle);
      builder.addQuad(nextBottom, bottom, top, nextTop, { material: faceMaterial(options, "side") });
      if (caps && bottomRadius > EPSILON) {
        builder.addTriangle([0, -halfHeight, 0], bottom, nextBottom, { material: faceMaterial(options, "bottom", options.capMaterial) });
      }
      if (caps && topRadius > EPSILON) {
        builder.addTriangle([0, halfHeight, 0], nextTop, top, { material: faceMaterial(options, "top", options.capMaterial) });
      }
    }
  });
}

/** Add a UV-layout low-poly sphere or ellipsoid. */
export function addSphere(builder, options = {}) {
  const radius = positiveNumber(options.radius ?? 0.5, "radius");
  const ellipsoidScale = positiveVec3(options.scale, "scale", [1, 1, 1]);
  const segments = integerAtLeast(options.segments ?? 12, 3, "segments");
  const rings = integerAtLeast(options.rings ?? 6, 2, "rings");
  const point = (phi, theta) => [
    radius * ellipsoidScale[0] * Math.sin(phi) * Math.cos(theta),
    radius * ellipsoidScale[1] * Math.cos(phi),
    radius * ellipsoidScale[2] * Math.sin(phi) * Math.sin(theta),
  ];

  return generate(builder, options, () => {
    const ringPoints = [];
    for (let ring = 1; ring < rings; ring += 1) {
      const phi = ring * Math.PI / rings;
      ringPoints.push(Array.from({ length: segments }, (_, segment) => point(phi, segment * Math.PI * 2 / segments)));
    }
    const top = [0, radius * ellipsoidScale[1], 0];
    const bottom = [0, -radius * ellipsoidScale[1], 0];
    const firstRing = ringPoints[0];
    const lastRing = ringPoints[ringPoints.length - 1];
    for (let segment = 0; segment < segments; segment += 1) {
      const next = (segment + 1) % segments;
      builder.addTriangle(top, firstRing[next], firstRing[segment], { material: faceMaterial(options, "surface") });
      for (let ring = 0; ring < ringPoints.length - 1; ring += 1) {
        builder.addQuad(
          ringPoints[ring][segment],
          ringPoints[ring][next],
          ringPoints[ring + 1][next],
          ringPoints[ring + 1][segment],
          { material: faceMaterial(options, "surface") },
        );
      }
      builder.addTriangle(bottom, lastRing[segment], lastRing[next], { material: faceMaterial(options, "surface") });
    }
  });
}

/** Add a torus around the Y axis. */
export function addTorus(builder, options = {}) {
  const majorRadius = positiveNumber(options.majorRadius ?? 0.5, "majorRadius");
  const tubeRadius = positiveNumber(options.tubeRadius ?? 0.12, "tubeRadius");
  if (tubeRadius >= majorRadius && options.allowSelfIntersection !== true) {
    fail("addTorus", "tubeRadius must be smaller than majorRadius");
  }
  const radialSegments = integerAtLeast(options.radialSegments ?? options.segments ?? 12, 3, "radialSegments");
  const tubularSegments = integerAtLeast(options.tubularSegments ?? options.tubeSegments ?? 6, 3, "tubularSegments");
  const point = (theta, phi) => {
    const ringRadius = majorRadius + tubeRadius * Math.cos(phi);
    return [ringRadius * Math.cos(theta), tubeRadius * Math.sin(phi), ringRadius * Math.sin(theta)];
  };

  return generate(builder, options, () => {
    // Follow the established torus convention: tubularSegments travels along
    // the main ring, while radialSegments resolves the tube cross-section.
    for (let tubular = 0; tubular < tubularSegments; tubular += 1) {
      const theta = tubular * Math.PI * 2 / tubularSegments;
      const nextTheta = (tubular + 1) * Math.PI * 2 / tubularSegments;
      for (let radial = 0; radial < radialSegments; radial += 1) {
        const phi = radial * Math.PI * 2 / radialSegments;
        const nextPhi = (radial + 1) * Math.PI * 2 / radialSegments;
        builder.addQuad(
          point(theta, phi),
          point(theta, nextPhi),
          point(nextTheta, nextPhi),
          point(nextTheta, phi),
          { material: faceMaterial(options, "surface") },
        );
      }
    }
  });
}

/** Add a vertical hollow cylinder with top and bottom annular faces. */
export function addAnnularCylinder(builder, options = {}) {
  const outerRadius = positiveNumber(options.outerRadius ?? options.radius ?? 0.5, "outerRadius");
  const innerRadius = positiveNumber(options.innerRadius ?? options.hollowRadius ?? outerRadius * 0.65, "innerRadius");
  if (innerRadius >= outerRadius) fail("addAnnularCylinder", "innerRadius must be smaller than outerRadius");
  const height = positiveNumber(options.height ?? 0.2, "height");
  const segments = integerAtLeast(options.segments ?? 12, 3, "segments");
  const halfHeight = height / 2;
  const caps = options.caps !== false;

  return generate(builder, options, () => {
    for (let index = 0; index < segments; index += 1) {
      const angle = index * Math.PI * 2 / segments;
      const nextAngle = (index + 1) * Math.PI * 2 / segments;
      const outerBottom = polarPoint(outerRadius, -halfHeight, angle);
      const outerNextBottom = polarPoint(outerRadius, -halfHeight, nextAngle);
      const outerTop = polarPoint(outerRadius, halfHeight, angle);
      const outerNextTop = polarPoint(outerRadius, halfHeight, nextAngle);
      const innerBottom = polarPoint(innerRadius, -halfHeight, angle);
      const innerNextBottom = polarPoint(innerRadius, -halfHeight, nextAngle);
      const innerTop = polarPoint(innerRadius, halfHeight, angle);
      const innerNextTop = polarPoint(innerRadius, halfHeight, nextAngle);

      builder.addQuad(outerNextBottom, outerBottom, outerTop, outerNextTop, { material: faceMaterial(options, "outer") });
      builder.addQuad(innerBottom, innerNextBottom, innerNextTop, innerTop, { material: faceMaterial(options, "inner") });
      if (caps) {
        builder.addQuad(outerTop, innerTop, innerNextTop, outerNextTop, { material: faceMaterial(options, "top", options.capMaterial) });
        builder.addQuad(outerBottom, outerNextBottom, innerNextBottom, innerBottom, { material: faceMaterial(options, "bottom", options.capMaterial) });
      }
    }
  });
}

function contour2(value, name) {
  if (!Array.isArray(value) || value.length < 3) fail(name, "expected at least 3 [x,z] points");
  return value.map((point, index) => vec2(point, `${name}[${index}]`));
}

function signedContourArea(points) {
  let areaTwice = 0;
  for (let index = 0; index < points.length; index += 1) {
    const next = points[(index + 1) % points.length];
    areaTwice += points[index][0] * next[1] - next[0] * points[index][1];
  }
  return areaTwice / 2;
}

function positiveContour(points, name) {
  const area = signedContourArea(points);
  if (Math.abs(area) <= EPSILON) fail(name, "contour has zero signed area");
  if (area > 0) return points;
  return [points[0], ...points.slice(1).reverse()];
}

/**
 * Extrude a ring along Y. `outer` and `inner` are equal-length, corresponding
 * [x,z] contours. Aliases outerPoints/innerPoints and points2D.{outer,inner}
 * are accepted. Winding is normalized without changing the first point.
 */
export function addExtrudedRing(builder, options = {}) {
  const outerValue = options.outer ?? options.outerPoints ?? options.points2D?.outer;
  const innerValue = options.inner ?? options.innerPoints ?? options.points2D?.inner;
  const outer = positiveContour(contour2(outerValue, "outer"), "outer");
  const inner = positiveContour(contour2(innerValue, "inner"), "inner");
  if (outer.length !== inner.length) fail("addExtrudedRing", "outer and inner contours must have equal point counts");
  const height = positiveNumber(options.height ?? 0.2, "height");
  const halfHeight = height / 2;
  const caps = options.caps !== false;
  const toPoint = (point, y) => [point[0], y, point[1]];

  return generate(builder, options, () => {
    for (let index = 0; index < outer.length; index += 1) {
      const next = (index + 1) % outer.length;
      const outerBottom = toPoint(outer[index], -halfHeight);
      const outerNextBottom = toPoint(outer[next], -halfHeight);
      const outerTop = toPoint(outer[index], halfHeight);
      const outerNextTop = toPoint(outer[next], halfHeight);
      const innerBottom = toPoint(inner[index], -halfHeight);
      const innerNextBottom = toPoint(inner[next], -halfHeight);
      const innerTop = toPoint(inner[index], halfHeight);
      const innerNextTop = toPoint(inner[next], halfHeight);

      builder.addQuad(outerNextBottom, outerBottom, outerTop, outerNextTop, { material: faceMaterial(options, "outer") });
      builder.addQuad(innerBottom, innerNextBottom, innerNextTop, innerTop, { material: faceMaterial(options, "inner") });
      if (caps) {
        builder.addQuad(outerTop, innerTop, innerNextTop, outerNextTop, { material: faceMaterial(options, "top", options.capMaterial) });
        builder.addQuad(outerBottom, outerNextBottom, innerNextBottom, innerBottom, { material: faceMaterial(options, "bottom", options.capMaterial) });
      }
    }
  });
}

function path3(value) {
  if (!Array.isArray(value) || value.length < 2) fail("points", "expected at least 2 [x,y,z] points");
  const points = value.map((point, index) => vec3(point, `points[${index}]`));
  for (let index = 1; index < points.length; index += 1) {
    if (length(sub(points[index], points[index - 1])) <= EPSILON) {
      fail("points", `adjacent points ${index - 1} and ${index} are coincident`);
    }
  }
  return points;
}

function leastAlignedAxis(direction) {
  const axes = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  axes.sort((a, b) => Math.abs(dot(direction, a)) - Math.abs(dot(direction, b)));
  return axes[0];
}

function pathTangents(points) {
  return points.map((point, index) => {
    if (index === 0) return normalize(sub(points[1], point), "path start tangent");
    if (index === points.length - 1) return normalize(sub(point, points[index - 1]), "path end tangent");
    const incoming = normalize(sub(point, points[index - 1]), `path tangent ${index} incoming`);
    const outgoing = normalize(sub(points[index + 1], point), `path tangent ${index} outgoing`);
    const average = add(incoming, outgoing);
    return length(average) <= EPSILON ? outgoing : normalize(average, `path tangent ${index}`);
  });
}

function pathFrames(tangents) {
  const frames = [];
  let previousNormal;
  for (let index = 0; index < tangents.length; index += 1) {
    const tangent = tangents[index];
    let normal;
    if (index === 0) {
      normal = normalize(cross(leastAlignedAxis(tangent), tangent), "initial tube normal");
    } else {
      const projected = sub(previousNormal, mulScalar(tangent, dot(previousNormal, tangent)));
      normal = length(projected) <= EPSILON
        ? normalize(cross(leastAlignedAxis(tangent), tangent), `tube normal ${index}`)
        : normalize(projected, `tube normal ${index}`);
      if (dot(normal, previousNormal) < 0) normal = mulScalar(normal, -1);
    }
    const binormal = normalize(cross(tangent, normal), `tube binormal ${index}`);
    frames.push({ tangent, normal, binormal });
    previousNormal = normal;
  }
  return frames;
}

/** Add a capped tube following a 3D polyline using transported frames. */
export function addTubePath(builder, options = {}) {
  const points = path3(options.points ?? options.path);
  const radius = positiveNumber(options.radius ?? 0.05, "radius");
  const segments = integerAtLeast(options.segments ?? 8, 3, "segments");
  const radii = options.radii === undefined
    ? points.map(() => radius)
    : (() => {
      if (!Array.isArray(options.radii) || options.radii.length !== points.length) {
        fail("radii", "expected one radius per path point");
      }
      return options.radii.map((value, index) => positiveNumber(value, `radii[${index}]`));
    })();
  const tangents = pathTangents(points);
  const frames = pathFrames(tangents);
  const rings = points.map((point, pointIndex) => Array.from({ length: segments }, (_, segment) => {
    const angle = segment * Math.PI * 2 / segments;
    const offset = add(
      mulScalar(frames[pointIndex].normal, Math.cos(angle) * radii[pointIndex]),
      mulScalar(frames[pointIndex].binormal, Math.sin(angle) * radii[pointIndex]),
    );
    return add(point, offset);
  }));

  return generate(builder, options, () => {
    for (let pointIndex = 0; pointIndex < rings.length - 1; pointIndex += 1) {
      for (let segment = 0; segment < segments; segment += 1) {
        const next = (segment + 1) % segments;
        builder.addQuad(
          rings[pointIndex][segment],
          rings[pointIndex][next],
          rings[pointIndex + 1][next],
          rings[pointIndex + 1][segment],
          { material: faceMaterial(options, "surface") },
        );
      }
    }
    if (options.caps !== false) {
      for (let segment = 0; segment < segments; segment += 1) {
        const next = (segment + 1) % segments;
        builder.addTriangle(points[0], rings[0][next], rings[0][segment], { material: faceMaterial(options, "start", options.capMaterial) });
        const last = rings.length - 1;
        builder.addTriangle(points[last], rings[last][segment], rings[last][next], { material: faceMaterial(options, "end", options.capMaterial) });
      }
    }
  });
}

function revolveProfile(value) {
  if (!Array.isArray(value) || value.length < 2) fail("profile", "expected at least 2 [radius,y] points");
  return value.map((point, index) => {
    const result = vec2(point, `profile[${index}]`);
    positiveNumber(result[0], `profile[${index}].radius`, { allowZero: true });
    return result;
  });
}

/** Revolve a [radius,y] profile around the Y axis. */
export function addRevolved(builder, options = {}) {
  const profile = revolveProfile(options.profile);
  const segments = integerAtLeast(options.segments ?? 12, 3, "segments");
  const surfaceMaterial = faceMaterial(options, "surface");
  const point = ([radius, y], segment) => polarPoint(radius, y, segment * Math.PI * 2 / segments);

  return generate(builder, options, () => {
    for (let profileIndex = 0; profileIndex < profile.length - 1; profileIndex += 1) {
      if (profile[profileIndex][0] <= EPSILON && profile[profileIndex + 1][0] <= EPSILON) continue;
      for (let segment = 0; segment < segments; segment += 1) {
        const next = (segment + 1) % segments;
        const a = point(profile[profileIndex], segment);
        const b = point(profile[profileIndex + 1], segment);
        const c = point(profile[profileIndex + 1], next);
        const d = point(profile[profileIndex], next);
        const candidateNormal = cross(sub(b, a), sub(c, a));
        const radial = [a[0] + b[0] + c[0] + d[0], 0, a[2] + b[2] + c[2] + d[2]];
        if (dot(candidateNormal, radial) < -EPSILON) {
          builder.addQuad(d, c, b, a, { material: surfaceMaterial });
        } else {
          builder.addQuad(a, b, c, d, { material: surfaceMaterial });
        }
      }
    }

    if (options.caps !== false) {
      const first = profile[0];
      const last = profile[profile.length - 1];
      const direction = last[1] >= first[1] ? 1 : -1;
      for (let segment = 0; segment < segments; segment += 1) {
        const next = (segment + 1) % segments;
        if (first[0] > EPSILON) {
          const center = [0, first[1], 0];
          const currentPoint = point(first, segment);
          const nextPoint = point(first, next);
          if (direction > 0) builder.addTriangle(center, currentPoint, nextPoint, { material: faceMaterial(options, "start", options.capMaterial) });
          else builder.addTriangle(center, nextPoint, currentPoint, { material: faceMaterial(options, "start", options.capMaterial) });
        }
        if (last[0] > EPSILON) {
          const center = [0, last[1], 0];
          const currentPoint = point(last, segment);
          const nextPoint = point(last, next);
          if (direction > 0) builder.addTriangle(center, nextPoint, currentPoint, { material: faceMaterial(options, "end", options.capMaterial) });
          else builder.addTriangle(center, currentPoint, nextPoint, { material: faceMaterial(options, "end", options.capMaterial) });
        }
      }
    }
  });
}

function seedHash(seed) {
  const text = String(seed ?? 1);
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function deterministicNoise(baseSeed, a, b) {
  let value = baseSeed ^ Math.imul(a + 1, 0x9e3779b1) ^ Math.imul(b + 1, 0x85ebca6b);
  value ^= value >>> 16;
  value = Math.imul(value, 0x7feb352d);
  value ^= value >>> 15;
  value = Math.imul(value, 0x846ca68b);
  value ^= value >>> 16;
  return (value >>> 0) / 0xffffffff * 2 - 1;
}

/** Add a deterministic faceted rock (a radially perturbed low-poly sphere). */
export function addIrregularRock(builder, options = {}) {
  const radius = positiveNumber(options.radius ?? 0.5, "radius");
  const rockScale = positiveVec3(options.scale, "scale", [1, 0.8, 1]);
  const irregularity = positiveNumber(options.irregularity ?? 0.22, "irregularity", { allowZero: true });
  if (irregularity >= 0.9) fail("irregularity", "expected a value below 0.9");
  const segments = integerAtLeast(options.segments ?? 9, 3, "segments");
  const rings = integerAtLeast(options.rings ?? 5, 2, "rings");
  const baseSeed = seedHash(options.seed ?? 1);
  const factor = (ring, segment) => 1 + deterministicNoise(baseSeed, ring, segment) * irregularity;
  const point = (ring, segment) => {
    const phi = ring * Math.PI / rings;
    const theta = segment * Math.PI * 2 / segments;
    const localRadius = radius * factor(ring, segment % segments);
    return [
      localRadius * rockScale[0] * Math.sin(phi) * Math.cos(theta),
      localRadius * rockScale[1] * Math.cos(phi),
      localRadius * rockScale[2] * Math.sin(phi) * Math.sin(theta),
    ];
  };

  return generate(builder, options, () => {
    const ringPoints = [];
    for (let ring = 1; ring < rings; ring += 1) {
      ringPoints.push(Array.from({ length: segments }, (_, segment) => point(ring, segment)));
    }
    const top = [0, radius * rockScale[1] * factor(0, 0), 0];
    const bottom = [0, -radius * rockScale[1] * factor(rings, 0), 0];
    for (let segment = 0; segment < segments; segment += 1) {
      const next = (segment + 1) % segments;
      builder.addTriangle(top, ringPoints[0][next], ringPoints[0][segment], { material: faceMaterial(options, "surface") });
      for (let ring = 0; ring < ringPoints.length - 1; ring += 1) {
        builder.addQuad(
          ringPoints[ring][segment],
          ringPoints[ring][next],
          ringPoints[ring + 1][next],
          ringPoints[ring + 1][segment],
          { material: faceMaterial(options, "surface") },
        );
      }
      builder.addTriangle(bottom, ringPoints[ringPoints.length - 1][segment], ringPoints[ringPoints.length - 1][next], { material: faceMaterial(options, "surface") });
    }
  });
}
