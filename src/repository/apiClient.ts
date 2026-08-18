const ACCESS_TOKEN_KEY = 'forgecore.api.access-token.v1'
const REFRESH_TOKEN_KEY = 'forgecore.api.refresh-token.v1'

export class ApiError extends Error {
  readonly status: number | null
  readonly unavailable: boolean

  constructor(message: string, status: number | null = null, unavailable = false) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.unavailable = unavailable
  }
}

const storage = (): Storage | null => {
  if (typeof window === 'undefined' || !window.localStorage) return null
  return window.localStorage
}

export const getAccessToken = (): string | null => storage()?.getItem(ACCESS_TOKEN_KEY) ?? null
export const getRefreshToken = (): string | null => storage()?.getItem(REFRESH_TOKEN_KEY) ?? null

export const setApiTokens = (tokens: { accessToken: string; refreshToken: string }) => {
  storage()?.setItem(ACCESS_TOKEN_KEY, tokens.accessToken)
  storage()?.setItem(REFRESH_TOKEN_KEY, tokens.refreshToken)
}

export const clearApiTokens = () => {
  storage()?.removeItem(ACCESS_TOKEN_KEY)
  storage()?.removeItem(REFRESH_TOKEN_KEY)
}

const parseError = async (response: Response): Promise<string> => {
  try {
    const body = await response.json() as { detail?: unknown }
    if (typeof body.detail === 'string') return body.detail
  } catch {
    // The server may return an empty body during shutdown.
  }
  return `请求失败（${response.status}）`
}

const isUnavailableStatus = (status: number): boolean => status === 502 || status === 503 || status === 504

const refresh = async (): Promise<boolean> => {
  const refreshToken = getRefreshToken()
  if (!refreshToken) return false
  try {
    const response = await fetch('/api/auth/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: refreshToken }),
    })
    if (!response.ok) {
      clearApiTokens()
      return false
    }
    const data = await response.json() as { access_token: string; refresh_token: string }
    setApiTokens({ accessToken: data.access_token, refreshToken: data.refresh_token })
    return true
  } catch {
    return false
  }
}

export async function apiRequest<T>(path: string, init: RequestInit = {}, retry = true): Promise<T> {
  const headers = new Headers(init.headers)
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
  const accessToken = getAccessToken()
  if (accessToken) headers.set('Authorization', `Bearer ${accessToken}`)

  let response: Response
  try {
    response = await fetch(path, { ...init, headers })
  } catch (error) {
    throw new ApiError(error instanceof Error ? error.message : '后端暂时不可用', null, true)
  }

  if (response.status === 401 && retry && path !== '/api/auth/refresh' && await refresh()) {
    return apiRequest<T>(path, init, false)
  }
  if (!response.ok) throw new ApiError(await parseError(response), response.status, isUnavailableStatus(response.status))
  if (response.status === 204) return undefined as T
  return await response.json() as T
}

export { ACCESS_TOKEN_KEY, REFRESH_TOKEN_KEY }
