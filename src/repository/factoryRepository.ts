import type { PersistedForgeState } from '../types'
import { authRepository } from './authRepository'

export const FACTORY_STORAGE_KEY = 'forgecore.factory.workspace.v1'
export const UI_PAGE_STORAGE_KEY = 'forgecore.ui.last-page.v1'

export type RepositoryResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string }

const getStorage = (): Storage | null => {
  if (typeof window === 'undefined' || !window.localStorage) return null
  return window.localStorage
}

const isPersistedState = (value: unknown): value is PersistedForgeState => {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<PersistedForgeState>
  return (
    candidate.persistenceSchemaVersion === 1 &&
    typeof candidate.savedAt === 'string' &&
    Boolean(candidate.factory && typeof candidate.factory.id === 'string') &&
    Array.isArray(candidate.floors) &&
    Array.isArray(candidate.objects) &&
    Array.isArray(candidate.items) &&
    Array.isArray(candidate.recipes) &&
    Array.isArray(candidate.inventory) &&
    Array.isArray(candidate.transportCapabilities) &&
    Boolean(candidate.simulation && typeof candidate.simulation === 'object') &&
    Boolean(candidate.metrics && typeof candidate.metrics === 'object') &&
    Array.isArray(candidate.metricSeries) &&
    Array.isArray(candidate.activities)
  )
}

const clone = <T>(value: T): T => {
  if (typeof structuredClone === 'function') return structuredClone(value)
  return JSON.parse(JSON.stringify(value)) as T
}

const scopedKey = (baseKey: string): string | null => {
  const userId = authRepository.activeUserId()
  return userId ? `${baseKey}.${userId}` : null
}

export const factoryRepository = {
  load(): RepositoryResult<PersistedForgeState | null> {
    const storage = getStorage()
    if (!storage) return { ok: true, value: null }

    try {
      const key = scopedKey(FACTORY_STORAGE_KEY)
      if (!key) return { ok: false, error: '请先登录，再读取工厂存档。' }
      const raw = storage.getItem(key)
      if (!raw) return { ok: true, value: null }

      const parsed: unknown = JSON.parse(raw)
      if (!isPersistedState(parsed)) {
        return {
          ok: false,
          error: '本地工厂数据版本无法识别，已保留原数据供审查。',
        }
      }

      return { ok: true, value: clone(parsed) }
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? `读取本地工厂失败：${error.message}` : '读取本地工厂失败。',
      }
    }
  },

  save(snapshot: PersistedForgeState): RepositoryResult<string> {
    const storage = getStorage()
    if (!storage) {
      return { ok: false, error: '当前环境不支持本地持久化。' }
    }

    try {
      const key = scopedKey(FACTORY_STORAGE_KEY)
      if (!key) return { ok: false, error: '请先登录，再保存工厂。' }
      storage.setItem(key, JSON.stringify(snapshot))
      return { ok: true, value: snapshot.savedAt }
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? `保存工厂失败：${error.message}` : '保存工厂失败。',
      }
    }
  },

  clear(): RepositoryResult<null> {
    const storage = getStorage()
    if (!storage) return { ok: true, value: null }

    try {
      const key = scopedKey(FACTORY_STORAGE_KEY)
      if (key) storage.removeItem(key)
      return { ok: true, value: null }
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? `清理本地工厂失败：${error.message}` : '清理本地工厂失败。',
      }
    }
  },

  exists(): boolean {
    const storage = getStorage()
    if (!storage) return false
    try {
      const key = scopedKey(FACTORY_STORAGE_KEY)
      return key ? storage.getItem(key) !== null : false
    } catch {
      return false
    }
  },
}

export const uiPreferenceRepository = {
  loadPage<T extends string>(allowed: readonly T[], fallback: T): T {
    const storage = getStorage()
    if (!storage) return fallback
    try {
      const key = scopedKey(UI_PAGE_STORAGE_KEY)
      if (!key) return fallback
      const page = storage.getItem(key)
      return page && allowed.includes(page as T) ? page as T : fallback
    } catch {
      return fallback
    }
  },

  savePage(page: string): void {
    const storage = getStorage()
    if (!storage) return
    try {
      const key = scopedKey(UI_PAGE_STORAGE_KEY)
      if (key) storage.setItem(key, page)
    } catch {
      // UI preference persistence is best-effort and never blocks factory work.
    }
  },
}
