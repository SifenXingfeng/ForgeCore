import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  COMMON_PARAMETERS,
  MATERIAL_LIBRARY,
  MODEL_DEFINITIONS,
  buildModel,
  getModelDefinition,
} from './src/definitions.mjs';
import { writeGlb } from './src/glb-writer.mjs';
import { createPreviewPng } from './src/preview.mjs';

export const LIBRARY_ID = 'FORGECORE_DEFAULT_ITEM_MODELS';
export const LIBRARY_VERSION = '1.0.0';
export const GENERATOR_VERSION = '1.0.0';
export const REQUIREMENTS_SHA256 = '8848a43224a2c4fe8663159a4272694f4353097d76560a7558eceab35ada9b16';

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_OUTPUT_ROOT = path.resolve(moduleDir, '../../public/models/forgecore/items');

function stableJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

function toMaterialArray(materialLibrary) {
  if (Array.isArray(materialLibrary)) {
    return materialLibrary.map((material) => ({ ...material }));
  }
  return Object.entries(materialLibrary).map(([id, material]) => ({ id, ...material }));
}

function parseHexColor(value) {
  if (typeof value !== 'string') return null;
  const match = /^#([0-9a-f]{6}|[0-9a-f]{8})$/iu.exec(value.trim());
  if (!match) return null;
  const hex = match[1];
  return [
    Number.parseInt(hex.slice(0, 2), 16) / 255,
    Number.parseInt(hex.slice(2, 4), 16) / 255,
    Number.parseInt(hex.slice(4, 6), 16) / 255,
    hex.length === 8 ? Number.parseInt(hex.slice(6, 8), 16) / 255 : 1,
  ];
}

function applyRequestedMaterialOverrides(materials, definition, parameters, overrides) {
  const overrideKeys = ['color', 'metalness', 'roughness', 'opacity', 'emission'];
  if (!overrideKeys.some((key) => Object.prototype.hasOwnProperty.call(overrides, key))) return materials;
  const primaryMaterialId = parameters.materialPreset !== 'auto'
    ? parameters.materialPreset
    : Object.values(definition.defaultMaterials ?? definition.materials ?? {})[0];
  const index = materials.findIndex((material) => material.id === primaryMaterialId);
  if (index < 0) return materials;

  const next = materials.map((material) => ({ ...material }));
  const material = next[index];
  const sourceColor = Array.from(material.baseColorFactor ?? [0.5, 0.5, 0.5, 1]);
  const requestedColor = Object.prototype.hasOwnProperty.call(overrides, 'color')
    ? parseHexColor(parameters.color)
    : null;
  const opacity = Object.prototype.hasOwnProperty.call(overrides, 'opacity') ? parameters.opacity : sourceColor[3] ?? 1;
  material.baseColorFactor = [
    ...(requestedColor?.slice(0, 3) ?? sourceColor.slice(0, 3)),
    opacity,
  ];
  if (Object.prototype.hasOwnProperty.call(overrides, 'metalness')) material.metallicFactor = parameters.metalness;
  if (Object.prototype.hasOwnProperty.call(overrides, 'roughness')) material.roughnessFactor = parameters.roughness;
  if (Object.prototype.hasOwnProperty.call(overrides, 'opacity')) material.alphaMode = opacity < 1 ? 'BLEND' : 'OPAQUE';
  if (Object.prototype.hasOwnProperty.call(overrides, 'emission')) {
    const emission = parseHexColor(parameters.emission);
    if (emission) material.emissiveFactor = emission.slice(0, 3);
  }
  return next;
}

function publicDefinition(definition) {
  const {
    build: _build,
    generator: _generator,
    ...serializable
  } = definition;
  return serializable;
}

function relativePreviewPath(relativeModelPath) {
  const parsed = path.posix.parse(relativeModelPath.replaceAll('\\', '/'));
  return path.posix.join('previews', parsed.dir, `${parsed.name}.png`);
}

async function ensureParent(filePath) {
  await mkdir(path.dirname(filePath), { recursive: true });
}

function modelMetadata(definition, parameters) {
  return {
    libraryId: LIBRARY_ID,
    libraryVersion: LIBRARY_VERSION,
    generator: 'ForgeCore procedural item model generator',
    generatorVersion: GENERATOR_VERSION,
    sourceType: 'forgecore-original-procedural',
    modelId: definition.id,
    category: definition.category,
    units: 'meter',
    upAxis: '+Y',
    forwardAxis: '+Z',
    pivot: 'ground-center',
    parameters,
  };
}

export async function buildSingleModel(modelId, overrides = {}) {
  const definition = getModelDefinition(modelId);
  if (!definition) {
    throw new Error(`Unknown model id: ${modelId}`);
  }
  const result = buildModel(modelId, overrides);
  const geometry = result.geometry ?? result;
  const parameters = result.parameters ?? overrides;
  const materials = applyRequestedMaterialOverrides(toMaterialArray(MATERIAL_LIBRARY), definition, parameters, overrides);
  const metadata = modelMetadata(definition, parameters);
  const glb = writeGlb(geometry, materials, metadata);
  const preview = createPreviewPng(geometry, {
    width: 512,
    height: 512,
    materials,
    background: [238, 241, 244, 255],
  });
  return { definition, parameters, geometry, glb, preview, metadata };
}

export async function buildLibrary(outputRoot = DEFAULT_OUTPUT_ROOT) {
  const resolvedOutput = path.resolve(outputRoot);
  await mkdir(resolvedOutput, { recursive: true });

  const records = [];
  const checksumRecords = [];
  const ids = new Set();

  for (const definition of MODEL_DEFINITIONS) {
    if (ids.has(definition.id)) {
      throw new Error(`Duplicate model id: ${definition.id}`);
    }
    ids.add(definition.id);

    const built = await buildSingleModel(definition.id);
    const relativeModelPath = definition.relativePath.replaceAll('\\', '/');
    const previewPath = relativePreviewPath(relativeModelPath);
    const absoluteModelPath = path.join(resolvedOutput, ...relativeModelPath.split('/'));
    const absolutePreviewPath = path.join(resolvedOutput, ...previewPath.split('/'));

    await ensureParent(absoluteModelPath);
    await ensureParent(absolutePreviewPath);
    await writeFile(absoluteModelPath, built.glb);
    await writeFile(absolutePreviewPath, built.preview);

    const modelHash = sha256(built.glb);
    const previewHash = sha256(built.preview);
    const metrics = built.geometry.metrics ?? {
      vertexCount: built.geometry.vertexCount,
      triangleCount: built.geometry.triangleCount,
      primitiveCount: built.geometry.primitives?.length ?? 0,
    };

    records.push({
      ...publicDefinition(definition),
      relativePath: relativeModelPath,
      previewPath,
      defaultParameters: built.parameters,
      bounds: built.geometry.bounds,
      metrics,
      bytes: built.glb.length,
      sha256: modelHash,
      previewBytes: built.preview.length,
      previewSha256: previewHash,
    });
    checksumRecords.push({ path: relativeModelPath, hash: modelHash });
    checksumRecords.push({ path: previewPath, hash: previewHash });
  }

  records.sort((a, b) => a.id.localeCompare(b.id));
  const materialTemplates = toMaterialArray(MATERIAL_LIBRARY);
  const catalog = {
    schemaVersion: '1.0.0',
    libraryId: LIBRARY_ID,
    libraryVersion: LIBRARY_VERSION,
    generatedAt: '2026-08-13',
    generator: {
      name: 'ForgeCore procedural item model generator',
      version: GENERATOR_VERSION,
      entrypoint: 'tools/item-models/build.mjs',
      deterministic: true,
    },
    sourceRequirements: {
      fileName: 'ForgeCore 默认基础 3D 物品模型库设计清单.md',
      sha256: REQUIREMENTS_SHA256,
      role: 'imported requirement source; ForgeCore 项目方案.md remains authoritative',
    },
    coordinateSystem: {
      units: 'meter',
      handedness: 'right-handed',
      upAxis: '+Y',
      forwardAxis: '+Z',
      pivot: 'ground-center',
    },
    runtimeContract: {
      internalFormat: 'GLB 2.0',
      externalUrisAllowed: false,
      texturesEmbeddedByDefault: false,
      instancingRecommended: true,
      staticGlbRole: 'default geometry; geometry-affecting parameters regenerate the mesh',
      materialOverrideRole: 'color/PBR overrides are applied to the primary material; texture is an application-managed binding and is not fetched by this offline generator',
    },
    itemPropertiesNotModelParameters: ['mass', 'stackSize'],
    commonParameters: COMMON_PARAMETERS,
    materialTemplates,
    modelCount: records.length,
    models: records,
  };

  const catalogBuffer = Buffer.from(stableJson(catalog), 'utf8');
  await writeFile(path.join(resolvedOutput, 'catalog.json'), catalogBuffer);
  checksumRecords.push({ path: 'catalog.json', hash: sha256(catalogBuffer) });
  checksumRecords.sort((a, b) => a.path.localeCompare(b.path));

  const checksumText = `${checksumRecords.map(({ hash, path: recordPath }) => `${hash}  ${recordPath}`).join('\n')}\n`;
  await writeFile(path.join(resolvedOutput, 'SHA256SUMS'), checksumText, 'utf8');

  return { outputRoot: resolvedOutput, catalog, checksumRecords };
}

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[index + 1];
    if (next && !next.startsWith('--')) {
      args[key] = next;
      index += 1;
    } else {
      args[key] = true;
    }
  }
  return args;
}

function parseParameterOverrides(value) {
  if (typeof value !== 'string') throw new TypeError('--params must be a JSON object string');
  const attempts = [value];
  // Windows PowerShell 5 removes the quote characters of an inline JSON
  // argument before a native executable receives it. Accept that common
  // `{key:value}` form while still rejecting arbitrary expressions.
  if (/^\{[\s\S]*\}$/u.test(value) && !value.includes('"')) {
    attempts.push(value
      .replace(/([{,]\s*)([A-Za-z_][A-Za-z0-9_]*)(\s*:)/gu, '$1"$2"$3')
      .replace(/:\s*([^\s,{}][^,{}]*?)(\s*[,}])/gu, (match, raw, suffix) => {
        const token = raw.trim();
        if (/^(?:-?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?|true|false|null)$/iu.test(token)) return `:${token}${suffix}`;
        return `:${JSON.stringify(token)}${suffix}`;
      }));
  }
  for (const candidate of attempts) {
    try {
      const result = JSON.parse(candidate);
      if (!result || typeof result !== 'object' || Array.isArray(result)) throw new TypeError('--params must decode to an object');
      return result;
    } catch (error) {
      if (candidate === attempts.at(-1)) throw error;
    }
  }
  throw new SyntaxError('Unable to parse --params');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.model) {
    if (!args.output) {
      throw new Error('--model requires --output');
    }
    const overrides = args.params ? parseParameterOverrides(args.params) : {};
    const built = await buildSingleModel(args.model, overrides);
    const output = path.resolve(args.output);
    await ensureParent(output);
    await writeFile(output, built.glb);
    process.stdout.write(`${args.model} -> ${output}\n`);
    return;
  }

  const result = await buildLibrary(args['output-root'] ?? DEFAULT_OUTPUT_ROOT);
  process.stdout.write(`Built ${result.catalog.modelCount} ForgeCore item models in ${result.outputRoot}\n`);
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
if (invokedPath === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error.stack ?? error.message}\n`);
    process.exitCode = 1;
  });
}
