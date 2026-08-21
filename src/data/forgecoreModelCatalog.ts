import type { ModelParameterValue } from '../game/item'

export interface ForgeCoreModelRecord {
  id: string
  nameZh: string
  nameEn: string
  category: string
  relativePath: string
  previewPath: string
  parameterizationLevel: number
  description: string
  metrics?: { triangleCount?: number; vertexCount?: number }
  defaultParameters?: Record<string, ModelParameterValue | null>
  parameters?: Record<string, ForgeCoreParameterSchema>
}

export interface ForgeCoreParameterSchema {
  type: 'number' | 'integer' | 'enum' | 'color' | 'boolean' | 'string'
  default: ModelParameterValue
  min?: number | null
  max?: number | null
  step?: number | null
  unit?: string | null
  options?: ModelParameterValue[] | null
  affects?: string[]
  activeWhen?: Record<string, ModelParameterValue> | null
}

export interface ForgeCoreModelCatalog {
  libraryId: string
  libraryVersion?: string
  modelCount: number
  models: ForgeCoreModelRecord[]
}

export async function loadForgeCoreModelCatalog(signal?: AbortSignal): Promise<ForgeCoreModelCatalog> {
  const response = await fetch('/models/forgecore/items/catalog.json', { signal })
  if (!response.ok) throw new Error(`模型目录加载失败（HTTP ${response.status}）`)
  const value: unknown = await response.json()
  if (!isRecord(value) || !Array.isArray(value.models)) throw new Error('模型目录格式非法')
  return {
    libraryId: typeof value.libraryId === 'string' ? value.libraryId : 'FORGECORE_DEFAULT_ITEM_MODELS',
    libraryVersion: typeof value.libraryVersion === 'string' ? value.libraryVersion : undefined,
    modelCount: typeof value.modelCount === 'number' ? value.modelCount : value.models.length,
    models: value.models.filter(isModelRecord),
  }
}

function isModelRecord(value: unknown): value is ForgeCoreModelRecord {
  return isRecord(value)
    && typeof value.id === 'string'
    && typeof value.nameZh === 'string'
    && typeof value.nameEn === 'string'
    && typeof value.category === 'string'
    && typeof value.relativePath === 'string'
    && typeof value.previewPath === 'string'
    && typeof value.parameterizationLevel === 'number'
    && typeof value.description === 'string'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
