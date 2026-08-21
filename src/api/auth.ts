/**
 * 认证后端 API 客户端。带超时，错误时抛出后端返回的中文信息。
 */

const AUTH_BASE = 'http://localhost:8080'

export interface AuthResult {
  token: string
  username: string
}

export interface MeResult {
  id: string
  username: string
}

async function withTimeout<T>(p: Promise<T>, ms = 5000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('请求超时，请确认后端已启动')), ms)
  })
  try {
    return await Promise.race([p, timeout])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await withTimeout(fetch(`${AUTH_BASE}${path}`, init))
  if (!res.ok) {
    let message = `后端返回 ${res.status}`
    try {
      const body = (await res.json()) as { error?: string }
      if (body?.error) message = body.error
    } catch {
      /* 保留状态码信息 */
    }
    throw new Error(message)
  }
  return (await res.json()) as T
}

function json(method: string, body?: unknown, token?: string): RequestInit {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (token) headers.Authorization = `Bearer ${token}`
  return { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }
}

export function register(username: string, password: string): Promise<AuthResult> {
  return request('/api/auth/register', json('POST', { username, password }))
}

export function login(username: string, password: string): Promise<AuthResult> {
  return request('/api/auth/login', json('POST', { username, password }))
}

export function fetchMe(token: string): Promise<MeResult> {
  return request('/api/auth/me', json('GET', undefined, token))
}

export function logout(token: string): Promise<{ status: string }> {
  return request('/api/auth/logout', json('POST', undefined, token))
}
