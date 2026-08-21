import type { ModelParameters, ModelParameterValue } from '../game/item'

// The audited ForgeCore generator is shared with the asset build pipeline so
// the editor preview and generated GLB catalogue always use the same rules.
// @ts-expect-error Canonical generator is a checked JavaScript ESM module.
import { MATERIAL_LIBRARY as materialLibrarySource, MODEL_DEFINITIONS as modelDefinitionsSource, buildModel as buildModelSource } from '../../tools/item-models/src/definitions.mjs'

export type ItemModelParameterType = 'number' | 'integer' | 'boolean' | 'enum' | 'color' | 'string'

export interface ItemModelParameterSchema {
  type: ItemModelParameterType
  default: ModelParameterValue
  min: number | null
  max: number | null
  step: number | null
  unit: string | null
  options: readonly ModelParameterValue[] | null
  affects: readonly string[]
  activeWhen: Readonly<Record<string, ModelParameterValue>> | null
}

export interface RuntimeItemModelDefinition {
  id: string
  nameZh: string
  nameEn: string
  category: string
  relativePath: string
  parameterizationLevel: number
  description: string
  parameters: Readonly<Record<string, ItemModelParameterSchema>>
  defaultMaterials: Readonly<Record<string, string>>
}

export interface RuntimeMaterialPreset {
  id: string
  nameZh: string
  nameEn: string
  baseColorFactor: readonly [number, number, number, number]
  metallicFactor: number
  roughnessFactor: number
  alphaMode?: 'OPAQUE' | 'BLEND'
  doubleSided?: boolean
}

interface RuntimeGeometryPrimitive {
  material: string
  positions: number[]
  normals: number[]
  uvs: number[]
  indices: number[]
}

export interface RuntimeBuildResult {
  definition: RuntimeItemModelDefinition
  parameters: Readonly<ModelParameters>
  geometry: {
    bounds: { min: [number, number, number]; max: [number, number, number]; size: [number, number, number] }
    primitives: RuntimeGeometryPrimitive[]
    metrics: { vertexCount: number; triangleCount: number; primitiveCount: number; materialCount: number }
  }
}

export const RUNTIME_ITEM_MODEL_DEFINITIONS = modelDefinitionsSource as readonly RuntimeItemModelDefinition[]
export const RUNTIME_MATERIAL_LIBRARY = materialLibrarySource as Readonly<Record<string, RuntimeMaterialPreset>>

const definitionById = new Map(RUNTIME_ITEM_MODEL_DEFINITIONS.map((definition) => [definition.id, definition]))

export function getRuntimeItemModelDefinition(modelId: string | null | undefined): RuntimeItemModelDefinition | null {
  if (!modelId) return null
  return definitionById.get(modelId.toUpperCase()) ?? null
}

function normalizedParameterValue(schema: ItemModelParameterSchema, source: ModelParameterValue | undefined): ModelParameterValue {
  let value = source ?? schema.default
  if (schema.type === 'number' || schema.type === 'integer') {
    let numeric = Number(value)
    if (!Number.isFinite(numeric)) numeric = Number(schema.default)
    if (schema.type === 'integer') numeric = Math.round(numeric)
    if (schema.min !== null) numeric = Math.max(schema.min, numeric)
    if (schema.max !== null) numeric = Math.min(schema.max, numeric)
    return numeric
  }
  if (schema.type === 'boolean') return value === true || value === 'true' || value === 1
  if (schema.type === 'enum') {
    const options = schema.options ?? []
    if (options.length > 0 && typeof options[0] === 'number') value = Number(value)
    return options.includes(value) ? value : schema.default
  }
  return value == null ? schema.default : String(value)
}

export function resolveModelParameters(modelId: string, overrides: ModelParameters = {}): ModelParameters {
  const definition = getRuntimeItemModelDefinition(modelId)
  if (!definition) return {}
  return Object.fromEntries(Object.entries(definition.parameters).map(([key, schema]) => [key, normalizedParameterValue(schema, overrides[key])]))
}

export function normalizeModelParameterOverrides(modelId: string, source: ModelParameters = {}): ModelParameters {
  const definition = getRuntimeItemModelDefinition(modelId)
  if (!definition) return {}
  const overrides: ModelParameters = {}
  for (const [key, schema] of Object.entries(definition.parameters)) {
    if (!Object.prototype.hasOwnProperty.call(source, key)) continue
    overrides[key] = normalizedParameterValue(schema, source[key])
  }
  return overrides
}

export function isModelParameterActive(schema: ItemModelParameterSchema, parameters: ModelParameters): boolean {
  if (!schema.activeWhen) return true
  return Object.entries(schema.activeWhen).every(([dependency, expected]) => parameters[dependency] === expected)
}

export function buildRuntimeItemModel(modelId: string, overrides: ModelParameters = {}): RuntimeBuildResult {
  return buildModelSource(modelId, normalizeModelParameterOverrides(modelId, overrides)) as RuntimeBuildResult
}
