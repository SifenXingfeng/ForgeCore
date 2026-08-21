import type { FactorySave } from '../game/save'

const SPRING_BASE = (import.meta.env.VITE_BACKEND_BASE_URL as string | undefined) ?? 'http://localhost:8080'

export interface FactoryProjectSummary {
  id: string
  name: string
  createdAt: string
  updatedAt: string
  version: number
  floorCount: number
  objectCount: number
  itemCount: number
  recipeCount: number
  autosave: boolean
}

export interface FactoryProjectDetail {
  project: FactoryProjectSummary
  save: unknown
}

function authHeaders(json = false): Record<string, string> {
  const token = localStorage.getItem('forgemind.token')
  return {
    ...(json ? { 'Content-Type': 'application/json' } : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), 8_000)
  try {
    const response = await fetch(`${SPRING_BASE}${path}`, { ...init, signal: controller.signal })
    if (!response.ok) {
      let message = `后端返回 ${response.status}`
      try {
        const body = await response.json() as { error?: string }
        if (body.error) message = body.error
      } catch {
        // Keep the status-based fallback for non-JSON proxy errors.
      }
      throw new Error(message)
    }
    return await response.json() as T
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw new Error('后端存档请求超时')
    throw error
  } finally {
    window.clearTimeout(timer)
  }
}

export function listFactoryProjects(): Promise<FactoryProjectSummary[]> {
  return request('/api/factories', { headers: authHeaders() })
}

export function fetchFactoryProject(projectId: string): Promise<FactoryProjectDetail> {
  return request(`/api/factories/${encodeURIComponent(projectId)}`, { headers: authHeaders() })
}

export function createFactoryProject(name: string, save: FactorySave): Promise<FactoryProjectDetail> {
  return request('/api/factories', {
    method: 'POST',
    headers: authHeaders(true),
    body: JSON.stringify({ name, save }),
  })
}

export function updateFactoryProject(projectId: string, name: string, save: FactorySave): Promise<FactoryProjectDetail> {
  return request(`/api/factories/${encodeURIComponent(projectId)}`, {
    method: 'PUT',
    headers: authHeaders(true),
    body: JSON.stringify({ name, save }),
  })
}

export function updateFactoryAutosave(name: string, save: FactorySave): Promise<FactoryProjectDetail> {
  return updateFactoryProject('autosave', name, save)
}

export function deleteFactoryProject(projectId: string): Promise<{ deleted: boolean }> {
  return request(`/api/factories/${encodeURIComponent(projectId)}`, {
    method: 'DELETE',
    headers: authHeaders(),
  })
}
