import type { ImportedResource } from '../game/types'

const RESOURCE_BASE = 'http://localhost:8080'

interface StoredResourceResponse extends Omit<ImportedResource, 'objectDef'> {
  objectDef: ImportedResource['objectDef']
  modelUrl?: string
  updatedAt?: string
}

function authHeaders(): Record<string, string> {
  const token = localStorage.getItem('forgemind.token')
  return token ? { Authorization: `Bearer ${token}` } : {}
}

async function readError(response: Response): Promise<string> {
  try {
    const body = await response.json() as { error?: string }
    return body.error ?? `后端返回 ${response.status}`
  } catch {
    return `后端返回 ${response.status}`
  }
}

export async function persistImportedResource(
  projectFile: File,
  modelFile: File,
  resource: ImportedResource,
): Promise<ImportedResource> {
  const form = new FormData()
  const metadata = {
    ...resource,
    objectDef: { ...resource.objectDef, assetPath: undefined },
  }
  form.append('metadata', JSON.stringify(metadata))
  form.append('project', projectFile, projectFile.name)
  form.append('model', modelFile, modelFile.name)

  const response = await fetch(`${RESOURCE_BASE}/api/resources`, {
    method: 'POST',
    headers: authHeaders(),
    body: form,
  })
  if (!response.ok) throw new Error(`设备保存失败：${await readError(response)}`)

  const saved = await response.json() as StoredResourceResponse
  return withModelUrl(saved, URL.createObjectURL(modelFile))
}

export async function loadImportedResources(): Promise<ImportedResource[]> {
  const response = await fetch(`${RESOURCE_BASE}/api/resources`, { headers: authHeaders() })
  if (!response.ok) throw new Error(`设备资源加载失败：${await readError(response)}`)
  const resources = await response.json() as StoredResourceResponse[]
  return Promise.all(resources.map(async (resource) => {
    const modelUrl = resource.modelUrl ?? `/api/resources/${encodeURIComponent(resource.id)}/model`
    const modelResponse = await fetch(`${RESOURCE_BASE}${modelUrl}`, { headers: authHeaders() })
    if (!modelResponse.ok) throw new Error(`模型加载失败：${resource.name}`)
    const blob = await modelResponse.blob()
    return withModelUrl(resource, URL.createObjectURL(blob))
  }))
}

function withModelUrl(resource: StoredResourceResponse, modelUrl: string): ImportedResource {
  return {
    id: resource.id,
    name: resource.name,
    modelFileName: resource.modelFileName,
    sourceFileName: resource.sourceFileName,
    sourceFormat: resource.sourceFormat,
    previewDataUrl: resource.previewDataUrl,
    warnings: resource.warnings ?? [],
    importedAt: resource.updatedAt ?? new Date().toISOString(),
    objectDef: { ...resource.objectDef, type: 'imported', assetPath: modelUrl },
  }
}
