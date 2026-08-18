import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { MODEL_DEFINITIONS, buildModel } from './src/definitions.mjs';
import { readGlb } from './src/glb-reader.mjs';
import { buildLibrary, buildSingleModel } from './build.mjs';

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = path.resolve(moduleDir, '../../assets/3d/core/items/v1');
const GEOMETRY_AFFECTS = new Set(['geometry', 'topology', 'bounds']);
const ALLOWED_AFFECTS = new Set(['geometry', 'topology', 'bounds', 'material', 'rendering', 'uv']);
const PARAMETER_SCHEMA_KEYS = ['type', 'default', 'min', 'max', 'step', 'unit', 'options', 'affects', 'activeWhen'];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

function finiteArray(values, label) {
  for (let index = 0; index < values.length; index += 1) {
    assert(Number.isFinite(values[index]), `${label}[${index}] is not finite`);
  }
}

function accessorBounds(values, components) {
  const min = new Array(components).fill(Number.POSITIVE_INFINITY);
  const max = new Array(components).fill(Number.NEGATIVE_INFINITY);
  for (let index = 0; index < values.length; index += components) {
    for (let component = 0; component < components; component += 1) {
      const value = values[index + component];
      min[component] = Math.min(min[component], value);
      max[component] = Math.max(max[component], value);
    }
  }
  return { min, max };
}

function approximately(left, right, epsilon = 1e-4) {
  return Math.abs(left - right) <= epsilon;
}

function triangleBudget(modelId) {
  const complex = new Set([
    'RAW_GRANULE',
    'MATERIAL_WIRE_COIL',
    'PART_GEAR',
    'PART_BEARING',
    'PART_SPRING',
    'PART_FLANGE',
    'RAW_LOG',
    'ELEC_PCB',
    'ELEC_CHIP',
    'ELEC_MOTOR',
    'PACK_CRATE',
    'PACK_BIN',
    'PACK_PALLET',
    'CONTAINER_DRUM',
    'CONTAINER_BOTTLE',
  ]);
  return complex.has(modelId) ? 2000 : 800;
}

function validateParameterSchema(definition) {
  assert(definition.parameters && typeof definition.parameters === 'object' && !Array.isArray(definition.parameters), `${definition.id}: missing parameters`);
  assert(Object.keys(definition.parameters).length > 0, `${definition.id}: parameters cannot be empty`);
  for (const [name, schema] of Object.entries(definition.parameters)) {
    assert(name.length > 0, `${definition.id}: empty parameter name`);
    assert(schema && typeof schema === 'object', `${definition.id}.${name}: invalid schema`);
    for (const key of PARAMETER_SCHEMA_KEYS) {
      assert(Object.prototype.hasOwnProperty.call(schema, key), `${definition.id}.${name}: schema is missing ${key}`);
    }
    assert(['number', 'integer', 'boolean', 'enum', 'color', 'string'].includes(schema.type), `${definition.id}.${name}: unsupported type`);
    assert(Array.isArray(schema.affects) && schema.affects.length > 0, `${definition.id}.${name}: missing affects`);
    assert(new Set(schema.affects).size === schema.affects.length, `${definition.id}.${name}: duplicate affects entries`);
    for (const effect of schema.affects) {
      assert(ALLOWED_AFFECTS.has(effect), `${definition.id}.${name}: unsupported affects value ${effect}`);
    }
    assert(schema.unit === null || (typeof schema.unit === 'string' && schema.unit.length > 0), `${definition.id}.${name}: invalid unit`);
    assert(schema.activeWhen === null || (schema.activeWhen && typeof schema.activeWhen === 'object' && !Array.isArray(schema.activeWhen)), `${definition.id}.${name}: invalid activeWhen`);
    if (schema.activeWhen) {
      assert(Object.keys(schema.activeWhen).length > 0, `${definition.id}.${name}: activeWhen cannot be empty`);
      for (const dependency of Object.keys(schema.activeWhen)) {
        assert(dependency !== name, `${definition.id}.${name}: activeWhen cannot reference itself`);
        assert(Object.prototype.hasOwnProperty.call(definition.parameters, dependency), `${definition.id}.${name}: activeWhen references unknown parameter ${dependency}`);
      }
    }
    if (schema.type === 'number' || schema.type === 'integer') {
      assert(Number.isFinite(schema.default), `${definition.id}.${name}: non-finite default`);
      assert(Number.isFinite(schema.min), `${definition.id}.${name}: numeric minimum is required`);
      assert(Number.isFinite(schema.max), `${definition.id}.${name}: numeric maximum is required`);
      assert(Number.isFinite(schema.step) && schema.step > 0, `${definition.id}.${name}: positive numeric step is required`);
      assert(schema.min <= schema.max, `${definition.id}.${name}: minimum exceeds maximum`);
      assert(schema.default >= schema.min, `${definition.id}.${name}: default below minimum`);
      assert(schema.default <= schema.max, `${definition.id}.${name}: default above maximum`);
      if (schema.type === 'integer') {
        assert(Number.isInteger(schema.default), `${definition.id}.${name}: integer default is not an integer`);
        assert(Number.isInteger(schema.min), `${definition.id}.${name}: integer minimum is not an integer`);
        assert(Number.isInteger(schema.max), `${definition.id}.${name}: integer maximum is not an integer`);
        assert(Number.isInteger(schema.step), `${definition.id}.${name}: integer step is not an integer`);
      }
      assert(schema.options === null, `${definition.id}.${name}: numeric parameter must not define options`);
    }
    if (schema.type === 'enum') {
      assert(Array.isArray(schema.options) && schema.options.length > 0, `${definition.id}.${name}: enum options are required`);
      assert(new Set(schema.options).size === schema.options.length, `${definition.id}.${name}: enum options must be unique`);
      assert(schema.options.includes(schema.default), `${definition.id}.${name}: invalid enum default`);
    }
    if (schema.type === 'boolean') {
      assert(typeof schema.default === 'boolean', `${definition.id}.${name}: boolean default is not boolean`);
      assert(schema.options === null, `${definition.id}.${name}: boolean parameter must not define options`);
    }
    if (schema.type === 'color') {
      assert(typeof schema.default === 'string' && /^#[0-9a-f]{6}([0-9a-f]{2})?$/iu.test(schema.default), `${definition.id}.${name}: invalid color default`);
    }
    if (schema.type === 'string') {
      assert(typeof schema.default === 'string', `${definition.id}.${name}: string default is not a string`);
    }
  }
}

function validateGeometryContract(definition, geometry, context = definition.id) {
  assert(geometry && typeof geometry === 'object', `${context}: missing geometry`);
  assert(Array.isArray(geometry.primitives) && geometry.primitives.length > 0, `${context}: no primitives`);
  let triangleCount = 0;
  let vertexCount = 0;
  const measuredMin = [Infinity, Infinity, Infinity];
  const measuredMax = [-Infinity, -Infinity, -Infinity];
  geometry.primitives.forEach((primitive, primitiveIndex) => {
    const prefix = `${context}.primitives[${primitiveIndex}]`;
    assert(primitive && typeof primitive === 'object', `${prefix}: invalid primitive`);
    assert((Array.isArray(primitive.positions) || ArrayBuffer.isView(primitive.positions)) && primitive.positions.length > 0 && primitive.positions.length % 3 === 0, `${prefix}: malformed positions`);
    assert((Array.isArray(primitive.normals) || ArrayBuffer.isView(primitive.normals)) && primitive.normals.length === primitive.positions.length, `${prefix}: malformed normals`);
    assert((Array.isArray(primitive.uvs) || ArrayBuffer.isView(primitive.uvs)) && primitive.uvs.length / 2 === primitive.positions.length / 3, `${prefix}: malformed UVs`);
    assert((Array.isArray(primitive.indices) || ArrayBuffer.isView(primitive.indices)) && primitive.indices.length > 0 && primitive.indices.length % 3 === 0, `${prefix}: malformed indices`);
    finiteArray(primitive.positions, `${prefix}.positions`);
    finiteArray(primitive.normals, `${prefix}.normals`);
    finiteArray(primitive.uvs, `${prefix}.uvs`);
    const primitiveVertexCount = primitive.positions.length / 3;
    for (let index = 0; index < primitive.indices.length; index += 1) {
      const value = primitive.indices[index];
      assert(Number.isInteger(value) && value >= 0 && value < primitiveVertexCount, `${prefix}.indices[${index}] is out of range`);
    }
    for (let index = 0; index < primitive.positions.length; index += 3) {
      for (let axis = 0; axis < 3; axis += 1) {
        const value = primitive.positions[index + axis];
        measuredMin[axis] = Math.min(measuredMin[axis], value);
        measuredMax[axis] = Math.max(measuredMax[axis], value);
      }
    }
    vertexCount += primitiveVertexCount;
    triangleCount += primitive.indices.length / 3;
  });
  assert(vertexCount > 0, `${context}: no vertices`);
  assert(triangleCount > 0, `${context}: no triangles`);
  assert(geometry.bounds && Array.isArray(geometry.bounds.min) && Array.isArray(geometry.bounds.max), `${context}: missing bounds`);
  assert(geometry.bounds.min.length === 3 && geometry.bounds.max.length === 3, `${context}: malformed bounds`);
  finiteArray(geometry.bounds.min, `${context}.bounds.min`);
  finiteArray(geometry.bounds.max, `${context}.bounds.max`);
  for (let axis = 0; axis < 3; axis += 1) {
    assert(geometry.bounds.min[axis] <= geometry.bounds.max[axis], `${context}: inverted bounds axis ${axis}`);
    assert(approximately(geometry.bounds.min[axis], measuredMin[axis], 1e-5), `${context}: bounds minimum mismatch on axis ${axis}`);
    assert(approximately(geometry.bounds.max[axis], measuredMax[axis], 1e-5), `${context}: bounds maximum mismatch on axis ${axis}`);
  }
  assert(approximately(geometry.bounds.min[1], 0, 1e-5), `${context}: pivot is not grounded`);
  assert(approximately(geometry.bounds.min[0] + geometry.bounds.max[0], 0, 1e-5), `${context}: X is not centered`);
  assert(approximately(geometry.bounds.min[2] + geometry.bounds.max[2], 0, 1e-5), `${context}: Z is not centered`);
  return { triangleCount, vertexCount, primitiveCount: geometry.primitives.length };
}

function validateGeneratedGeometry(definition) {
  const result = buildModel(definition.id);
  const geometry = result.geometry ?? result;
  const contract = validateGeometryContract(definition, geometry);
  const triangleCount = contract.triangleCount;
  assert(triangleCount <= 3000, `${definition.id}: exceeds hard 3000 triangle limit (${triangleCount})`);
  assert(triangleCount <= triangleBudget(definition.id), `${definition.id}: exceeds target budget (${triangleCount})`);
  assert(geometry.primitives.length <= 4, `${definition.id}: exceeds 4 primitive/material budget`);
  return { triangleCount, primitiveCount: geometry.primitives.length };
}

function sameValue(left, right) {
  return Object.is(left, right);
}

function alternativeValues(schema) {
  if (schema.type === 'boolean') return [!schema.default];
  if (schema.type === 'enum') return schema.options.filter((value) => !sameValue(value, schema.default));
  if (schema.type !== 'number' && schema.type !== 'integer') return [];

  const minimum = schema.min;
  const maximum = schema.max;
  const defaultValue = schema.default;
  const span = maximum - minimum;
  const step = schema.step;
  const raw = [
    defaultValue + step,
    defaultValue - step,
    minimum + span * 0.5,
    minimum + span * 0.25,
    minimum + span * 0.75,
    minimum + span * 0.1,
    minimum + span * 0.9,
    minimum + step,
    maximum - step,
    minimum,
    maximum,
  ];
  const unique = [];
  const seen = new Set();
  for (let value of raw) {
    if (schema.type === 'integer') value = Math.round(value);
    if (!Number.isFinite(value) || value < minimum || value > maximum || sameValue(value, defaultValue)) continue;
    const key = `${typeof value}:${String(value)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(value);
  }
  // Try nearby values first; farther values remain available to reveal changes
  // hidden by topology thresholds or numeric quantization.
  unique.sort((left, right) => Math.abs(left - defaultValue) - Math.abs(right - defaultValue));
  return unique;
}

function geometryFingerprint(geometry) {
  const hash = createHash('sha256');
  hash.update(`primitives:${geometry.primitives.length}\n`);
  for (const primitive of geometry.primitives) {
    hash.update(`material:${String(primitive.material ?? '')}\n`);
    for (const [name, values] of [
      ['positions', primitive.positions],
      ['normals', primitive.normals],
      ['uvs', primitive.uvs],
      ['indices', primitive.indices],
    ]) {
      hash.update(`${name}:${values.length}:`);
      // JSON number formatting gives the same fingerprint for Arrays and
      // TypedArrays and is independent of host endianness.
      hash.update(JSON.stringify(Array.from(values)));
      hash.update('\n');
    }
  }
  return hash.digest('hex');
}

function resolvedParameterMatches(actual, requested) {
  if (typeof requested === 'number') return Number(actual) === requested;
  return sameValue(actual, requested);
}

function validateParameterVariants(definitions) {
  const changed = [];
  const unchanged = [];
  let schemaParameterCount = 0;
  let relevantParameterCount = 0;
  let attemptedBuildCount = 0;

  for (const definition of definitions) {
    const baselineResult = buildModel(definition.id);
    const baselineGeometry = baselineResult.geometry ?? baselineResult;
    validateGeometryContract(definition, baselineGeometry, `${definition.id}.default`);

    for (const [parameter, schema] of Object.entries(definition.parameters)) {
      schemaParameterCount += 1;
      if (!schema.affects.some((effect) => GEOMETRY_AFFECTS.has(effect))) continue;
      relevantParameterCount += 1;
      const candidates = alternativeValues(schema);
      assert(candidates.length > 0, `${definition.id}.${parameter}: no safe alternative value exists in the schema`);
      const activationOverrides = schema.activeWhen ?? {};
      const parameterBaselineResult = Object.keys(activationOverrides).length > 0
        ? buildModel(definition.id, activationOverrides)
        : baselineResult;
      for (const [dependency, expected] of Object.entries(activationOverrides)) {
        assert(resolvedParameterMatches(parameterBaselineResult.parameters?.[dependency], expected), `${definition.id}.${parameter}: activeWhen ${dependency} was not retained`);
      }
      const parameterBaselineGeometry = parameterBaselineResult.geometry ?? parameterBaselineResult;
      validateGeometryContract(definition, parameterBaselineGeometry, `${definition.id}.${parameter}.activeBaseline`);
      const parameterBaselineFingerprint = geometryFingerprint(parameterBaselineGeometry);
      const failures = [];
      let firstSuccessful = null;
      let changedVariant = null;

      for (const candidate of candidates) {
        attemptedBuildCount += 1;
        try {
          const result = buildModel(definition.id, { ...activationOverrides, [parameter]: candidate });
          assert(resolvedParameterMatches(result.parameters?.[parameter], candidate), `${definition.id}.${parameter}: override ${JSON.stringify(candidate)} was not retained`);
          const geometry = result.geometry ?? result;
          const contract = validateGeometryContract(
            definition,
            geometry,
            `${definition.id}.${parameter}=${JSON.stringify(candidate)}`,
          );
          const variant = {
            modelId: definition.id,
            parameter,
            affects: [...schema.affects],
            defaultValue: schema.default,
            alternativeValue: candidate,
            fingerprint: geometryFingerprint(geometry),
            triangles: contract.triangleCount,
          };
          if (!firstSuccessful) firstSuccessful = variant;
          if (variant.fingerprint !== parameterBaselineFingerprint) {
            changedVariant = variant;
            break;
          }
        } catch (error) {
          failures.push(`${JSON.stringify(candidate)}: ${error.message}`);
        }
      }

      assert(
        firstSuccessful,
        `${definition.id}.${parameter}: every alternative failed (${failures.join('; ')})`,
      );
      if (changedVariant) {
        changed.push({
          modelId: changedVariant.modelId,
          parameter: changedVariant.parameter,
          affects: changedVariant.affects,
          defaultValue: changedVariant.defaultValue,
          alternativeValue: changedVariant.alternativeValue,
        });
      } else {
        unchanged.push({
          modelId: firstSuccessful.modelId,
          parameter: firstSuccessful.parameter,
          affects: firstSuccessful.affects,
          defaultValue: firstSuccessful.defaultValue,
          testedAlternativeValues: candidates,
          note: 'All buildable alternatives produced the default geometry fingerprint.',
        });
      }
    }
  }

  assert(relevantParameterCount === changed.length + unchanged.length, 'parameter variant accounting mismatch');
  return {
    definitionCount: definitions.length,
    schemaParameterCount,
    geometryAffectingParameterCount: relevantParameterCount,
    attemptedBuildCount,
    changedFingerprintCount: changed.length,
    unchangedFingerprintCount: unchanged.length,
    unchanged,
  };
}

function validateGlb(definition, buffer, expectedHash) {
  assert(sha256(buffer) === expectedHash, `${definition.id}: SHA-256 differs from catalog`);
  assert(buffer.length <= 262144, `${definition.id}: GLB exceeds 256 KiB hard limit`);
  const parsed = readGlb(buffer);
  const json = parsed.json;
  assert(json.asset?.version === '2.0', `${definition.id}: not glTF 2.0`);
  assert(json.asset?.extras?.forgecore?.modelId === definition.id, `${definition.id}: embedded modelId mismatch`);
  assert(json.asset?.extras?.forgecore?.units === 'meter', `${definition.id}: units metadata mismatch`);
  assert(json.asset?.extras?.forgecore?.upAxis === '+Y', `${definition.id}: up-axis metadata mismatch`);
  assert(json.asset?.extras?.forgecore?.forwardAxis === '+Z', `${definition.id}: forward-axis metadata mismatch`);
  assert(json.asset?.extras?.forgecore?.pivot === 'ground-center', `${definition.id}: pivot metadata mismatch`);
  assert(json.asset?.extras?.forgecore?.sourceType === 'forgecore-original-procedural', `${definition.id}: source type metadata mismatch`);
  assert((json.scenes ?? []).length === 1 && json.scene === 0, `${definition.id}: expected one default scene`);
  assert(Array.isArray(json.scenes[0].nodes) && json.scenes[0].nodes.length === 1 && json.scenes[0].nodes[0] === 0, `${definition.id}: scene root mismatch`);
  assert((json.nodes ?? []).length === 1, `${definition.id}: expected one root node`);
  assert((json.meshes ?? []).length === 1, `${definition.id}: expected one mesh`);
  const rootNode = json.nodes[0];
  assert(rootNode.mesh === 0, `${definition.id}: root node does not reference the only mesh`);
  for (const transform of ['matrix', 'translation', 'rotation', 'scale']) {
    assert(rootNode[transform] === undefined, `${definition.id}: root ${transform} must remain identity`);
  }
  assert(!(json.images?.length), `${definition.id}: unexpected images`);
  assert(!(json.textures?.length), `${definition.id}: unexpected textures`);
  assert(!(json.animations?.length), `${definition.id}: unexpected animations`);
  assert(!(json.skins?.length), `${definition.id}: unexpected skins`);
  assert(!(json.cameras?.length), `${definition.id}: unexpected cameras`);
  assert(!(json.extensionsUsed?.length), `${definition.id}: unexpected used extensions`);
  assert(!(json.extensionsRequired?.length), `${definition.id}: unexpected required extensions`);
  assert((json.buffers ?? []).length === 1, `${definition.id}: expected one embedded buffer`);
  for (const resource of [...(json.buffers ?? []), ...(json.images ?? [])]) {
    assert(!resource.uri, `${definition.id}: external URI is forbidden`);
  }

  let triangleCount = 0;
  for (const primitive of json.meshes[0].primitives) {
    assert(primitive.mode === undefined || primitive.mode === 4, `${definition.id}: primitive is not TRIANGLES`);
    assert(primitive.attributes.POSITION !== undefined, `${definition.id}: primitive missing POSITION`);
    assert(primitive.attributes.NORMAL !== undefined, `${definition.id}: primitive missing NORMAL`);
    assert(primitive.attributes.TEXCOORD_0 !== undefined, `${definition.id}: primitive missing TEXCOORD_0`);
    const positions = parsed.readAccessor(primitive.attributes.POSITION);
    const normals = parsed.readAccessor(primitive.attributes.NORMAL);
    const uvs = parsed.readAccessor(primitive.attributes.TEXCOORD_0);
    const indices = parsed.readAccessor(primitive.indices);
    finiteArray(positions, `${definition.id}.POSITION`);
    finiteArray(normals, `${definition.id}.NORMAL`);
    finiteArray(uvs, `${definition.id}.TEXCOORD_0`);
    assert(positions.length % 3 === 0, `${definition.id}: malformed POSITION`);
    assert(normals.length === positions.length, `${definition.id}: normal count mismatch`);
    assert(uvs.length / 2 === positions.length / 3, `${definition.id}: UV count mismatch`);
    assert(indices.length % 3 === 0, `${definition.id}: indices are not triangles`);
    const vertexCount = positions.length / 3;
    for (const index of indices) assert(index >= 0 && index < vertexCount, `${definition.id}: index out of range`);
    for (let index = 0; index < normals.length; index += 3) {
      const length = Math.hypot(normals[index], normals[index + 1], normals[index + 2]);
      assert(approximately(length, 1, 2e-3), `${definition.id}: non-unit normal`);
    }
    const bounds = accessorBounds(positions, 3);
    const accessor = json.accessors[primitive.attributes.POSITION];
    for (let component = 0; component < 3; component += 1) {
      assert(approximately(bounds.min[component], accessor.min[component], 1e-5), `${definition.id}: accessor min mismatch`);
      assert(approximately(bounds.max[component], accessor.max[component], 1e-5), `${definition.id}: accessor max mismatch`);
    }
    triangleCount += indices.length / 3;
  }
  assert(triangleCount <= 3000, `${definition.id}: GLB exceeds hard triangle limit`);
  return { parsed, triangleCount };
}

async function validateSingleModelOverrides() {
  const built = await buildSingleModel('BASIC_BOX', {
    length: 1.37,
    color: '#e64519',
    metalness: 0.23,
    roughness: 0.71,
    opacity: 0.62,
    emission: '#102030',
  });
  assert(approximately(built.geometry.bounds.size[0], 1.37, 1e-6), 'single-model geometry override was not applied');
  const parsed = readGlb(built.glb);
  assert(parsed.json.asset?.extras?.forgecore?.parameters?.length === 1.37, 'single-model metadata does not retain overrides');
  const primary = parsed.json.materials?.find((material) => material.extras?.forgecore?.id === 'neutral');
  assert(primary, 'single-model primary material is missing');
  const pbr = primary.pbrMetallicRoughness;
  const expectedColor = [0xe6 / 255, 0x45 / 255, 0x19 / 255, 0.62];
  expectedColor.forEach((value, index) => assert(approximately(pbr.baseColorFactor[index], value, 1e-6), `single-model color override mismatch at ${index}`));
  assert(approximately(pbr.metallicFactor, 0.23, 1e-6), 'single-model metalness override mismatch');
  assert(approximately(pbr.roughnessFactor, 0.71, 1e-6), 'single-model roughness override mismatch');
  assert(primary.alphaMode === 'BLEND', 'single-model opacity override did not enable blending');
  const expectedEmission = [0x10 / 255, 0x20 / 255, 0x30 / 255];
  expectedEmission.forEach((value, index) => assert(approximately(primary.emissiveFactor[index], value, 1e-6), `single-model emission override mismatch at ${index}`));
  return {
    modelId: 'BASIC_BOX',
    geometryOverride: true,
    pbrOverrides: ['color', 'metalness', 'roughness', 'opacity', 'emission'],
    embeddedParameters: true,
  };
}

async function listFilesRecursively(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const result = [];
  for (const entry of entries) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await listFilesRecursively(absolute));
    else result.push(absolute);
  }
  return result;
}

async function directorySnapshot(directory) {
  const files = await listFilesRecursively(directory);
  const records = [];
  for (const absolute of files) {
    const relative = path.relative(directory, absolute).replaceAll('\\', '/');
    const buffer = await readFile(absolute);
    records.push({ relative, buffer, bytes: buffer.byteLength, sha256: sha256(buffer) });
  }
  records.sort((left, right) => left.relative.localeCompare(right.relative));
  return records;
}

function snapshotFingerprint(records) {
  const hash = createHash('sha256');
  for (const record of records) {
    hash.update(record.relative, 'utf8');
    hash.update(Buffer.from([0]));
    hash.update(record.buffer);
    hash.update(Buffer.from([0]));
  }
  return hash.digest('hex');
}

function assertSafeTemporaryRoot(temporaryRoot, temporaryBase) {
  const resolvedRoot = path.resolve(temporaryRoot);
  const resolvedBase = path.resolve(temporaryBase);
  const relative = path.relative(resolvedBase, resolvedRoot);
  assert(relative.length > 0 && !relative.startsWith('..') && !path.isAbsolute(relative), `unsafe temporary cleanup path: ${resolvedRoot}`);
  assert(path.basename(resolvedRoot).startsWith('forgecore-item-validation-'), `unexpected temporary directory name: ${resolvedRoot}`);
}

async function validateReproducibility() {
  const temporaryBase = path.resolve(tmpdir());
  const temporaryRoot = await mkdtemp(path.join(temporaryBase, 'forgecore-item-validation-'));
  const firstRoot = path.join(temporaryRoot, 'run-a');
  const secondRoot = path.join(temporaryRoot, 'run-b');
  try {
    await buildLibrary(firstRoot);
    await buildLibrary(secondRoot);
    const first = await directorySnapshot(firstRoot);
    const second = await directorySnapshot(secondRoot);
    assert(first.length === second.length, `reproducibility file-count mismatch: ${first.length} vs ${second.length}`);
    let totalBytes = 0;
    for (let index = 0; index < first.length; index += 1) {
      const left = first[index];
      const right = second[index];
      assert(left.relative === right.relative, `reproducibility path mismatch: ${left.relative} vs ${right.relative}`);
      assert(left.bytes === right.bytes, `reproducibility size mismatch: ${left.relative}`);
      assert(left.buffer.equals(right.buffer), `reproducibility byte mismatch: ${left.relative}`);
      totalBytes += left.bytes;
    }
    const firstFingerprint = snapshotFingerprint(first);
    const secondFingerprint = snapshotFingerprint(second);
    assert(firstFingerprint === secondFingerprint, 'reproducibility tree fingerprint mismatch');
    return {
      runs: 2,
      generatedFileCountPerRun: first.length,
      generatedBytesPerRun: totalBytes,
      treeSha256: firstFingerprint,
      byteIdentical: true,
    };
  } finally {
    assertSafeTemporaryRoot(temporaryRoot, temporaryBase);
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

export async function validateLibrary(root = DEFAULT_ROOT) {
  const resolvedRoot = path.resolve(root);
  const catalog = JSON.parse(await readFile(path.join(resolvedRoot, 'catalog.json'), 'utf8'));
  assert(catalog.modelCount === 36, `catalog modelCount must be 36, got ${catalog.modelCount}`);
  assert(Array.isArray(catalog.models) && catalog.models.length === 36, 'catalog models must contain 36 entries');
  assert(MODEL_DEFINITIONS.length === 36, `definitions must contain 36 entries, got ${MODEL_DEFINITIONS.length}`);

  const definitionIds = new Set();
  for (const definition of MODEL_DEFINITIONS) {
    assert(!definitionIds.has(definition.id), `duplicate definition id: ${definition.id}`);
    definitionIds.add(definition.id);
    validateParameterSchema(definition);
  }
  const parameterValidation = validateParameterVariants(MODEL_DEFINITIONS);
  const singleModelOverrideValidation = await validateSingleModelOverrides();

  const catalogIds = new Set();
  const reports = [];
  for (const record of catalog.models) {
    assert(definitionIds.has(record.id), `catalog contains unknown model: ${record.id}`);
    assert(!catalogIds.has(record.id), `catalog duplicate id: ${record.id}`);
    catalogIds.add(record.id);
    const definition = MODEL_DEFINITIONS.find((entry) => entry.id === record.id);
    assert(record.relativePath === definition.relativePath, `${record.id}: catalog path mismatch`);
    const geometryReport = validateGeneratedGeometry(definition);
    const buffer = await readFile(path.join(resolvedRoot, ...record.relativePath.split('/')));
    const glbReport = validateGlb(definition, buffer, record.sha256);
    assert(geometryReport.triangleCount === glbReport.triangleCount, `${record.id}: geometry/GLB triangle mismatch`);
    const preview = await readFile(path.join(resolvedRoot, ...record.previewPath.split('/')));
    assert(preview.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])), `${record.id}: invalid PNG preview`);
    assert(sha256(preview) === record.previewSha256, `${record.id}: preview SHA-256 mismatch`);
    reports.push({ id: record.id, triangles: glbReport.triangleCount, bytes: buffer.length });
  }
  assert(catalogIds.size === definitionIds.size, 'catalog/definition coverage mismatch');

  const checksumLines = (await readFile(path.join(resolvedRoot, 'SHA256SUMS'), 'utf8')).trim().split(/\r?\n/u);
  const checksumMap = new Map(checksumLines.map((line) => {
    const match = /^([0-9a-f]{64})  (.+)$/u.exec(line);
    assert(match, `invalid checksum line: ${line}`);
    return [match[2], match[1]];
  }));
  const allFiles = await listFilesRecursively(resolvedRoot);
  for (const absolute of allFiles) {
    const relative = path.relative(resolvedRoot, absolute).replaceAll('\\', '/');
    if (relative === 'SHA256SUMS') continue;
    assert(checksumMap.has(relative), `SHA256SUMS missing ${relative}`);
    assert(sha256(await readFile(absolute)) === checksumMap.get(relative), `SHA256SUMS mismatch for ${relative}`);
  }
  assert(checksumMap.size === allFiles.length - 1, 'SHA256SUMS contains extra or missing paths');

  const reproducibility = await validateReproducibility();

  return {
    root: resolvedRoot,
    modelCount: reports.length,
    totalTriangles: reports.reduce((sum, record) => sum + record.triangles, 0),
    totalGlbBytes: reports.reduce((sum, record) => sum + record.bytes, 0),
    maxTriangles: reports.reduce((current, record) => record.triangles > current.triangles ? record : current, reports[0]),
    maxBytes: reports.reduce((current, record) => record.bytes > current.bytes ? record : current, reports[0]),
    parameterValidation,
    singleModelOverrideValidation,
    reproducibility,
    reports,
  };
}

async function main() {
  const rootIndex = process.argv.indexOf('--root');
  const root = rootIndex >= 0 ? process.argv[rootIndex + 1] : DEFAULT_ROOT;
  const result = await validateLibrary(root);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
if (invokedPath === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error.stack ?? error.message}\n`);
    process.exitCode = 1;
  });
}
