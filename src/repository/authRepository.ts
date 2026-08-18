export const AUTH_USERS_STORAGE_KEY = 'forgecore.auth.users.v1'
export const AUTH_SESSION_STORAGE_KEY = 'forgecore.auth.session.v1'

export interface AuthUser {
  id: string
  displayName: string
  email: string
  createdAt: string
}

interface StoredAuthUser extends AuthUser {
  salt: string
  passwordHash: string
}

export type AuthResult =
  | { ok: true; user: AuthUser }
  | { ok: false; error: string }

const getStorage = (): Storage | null => {
  if (typeof window === 'undefined' || !window.localStorage) return null
  return window.localStorage
}

const normalizeEmail = (email: string) => email.trim().toLowerCase()

const publicUser = ({ id, displayName, email, createdAt }: StoredAuthUser): AuthUser => ({
  id,
  displayName,
  email,
  createdAt,
})

const readUsers = (storage: Storage): StoredAuthUser[] => {
  const raw = storage.getItem(AUTH_USERS_STORAGE_KEY)
  if (!raw) return []
  try {
    const value: unknown = JSON.parse(raw)
    if (!Array.isArray(value)) return []
    return value.filter((entry): entry is StoredAuthUser => Boolean(
      entry && typeof entry === 'object'
      && typeof entry.id === 'string'
      && typeof entry.displayName === 'string'
      && typeof entry.email === 'string'
      && typeof entry.salt === 'string'
      && typeof entry.passwordHash === 'string'
      && typeof entry.createdAt === 'string',
    ))
  } catch {
    return []
  }
}

const digest = async (salt: string, password: string): Promise<string> => {
  const bytes = new TextEncoder().encode(`${salt}:${password}`)
  const buffer = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(buffer), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

const createSalt = (): string => {
  const bytes = new Uint8Array(18)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

const saveSession = (storage: Storage, userId: string) => {
  storage.setItem(AUTH_SESSION_STORAGE_KEY, JSON.stringify({ userId, signedInAt: new Date().toISOString() }))
}

export const authRepository = {
  session(): AuthUser | null {
    const storage = getStorage()
    if (!storage) return null
    try {
      const raw = storage.getItem(AUTH_SESSION_STORAGE_KEY)
      if (!raw) return null
      const session: unknown = JSON.parse(raw)
      if (!session || typeof session !== 'object' || typeof (session as { userId?: unknown }).userId !== 'string') return null
      const user = readUsers(storage).find((entry) => entry.id === (session as { userId: string }).userId)
      return user ? publicUser(user) : null
    } catch {
      return null
    }
  },

  activeUserId(): string | null {
    return this.session()?.id ?? null
  },

  async register(input: { displayName: string; email: string; password: string }): Promise<AuthResult> {
    const storage = getStorage()
    if (!storage || typeof crypto === 'undefined' || !crypto.subtle) return { ok: false, error: '当前环境不支持本地账户存储。' }
    const displayName = input.displayName.trim()
    const email = normalizeEmail(input.email)
    if (displayName.length < 2) return { ok: false, error: '名称至少需要 2 个字符。' }
    if (!/^\S+@\S+\.\S+$/.test(email)) return { ok: false, error: '请输入有效的邮箱地址。' }
    if (input.password.length < 8) return { ok: false, error: '密码至少需要 8 个字符。' }
    const users = readUsers(storage)
    if (users.some((user) => user.email === email)) return { ok: false, error: '该邮箱已注册，请直接登录。' }
    try {
      const salt = createSalt()
      const user: StoredAuthUser = {
        id: `user-${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}`,
        displayName,
        email,
        salt,
        passwordHash: await digest(salt, input.password),
        createdAt: new Date().toISOString(),
      }
      storage.setItem(AUTH_USERS_STORAGE_KEY, JSON.stringify([...users, user]))
      saveSession(storage, user.id)
      return { ok: true, user: publicUser(user) }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? `注册失败：${error.message}` : '注册失败。' }
    }
  },

  async login(emailInput: string, password: string): Promise<AuthResult> {
    const storage = getStorage()
    if (!storage || typeof crypto === 'undefined' || !crypto.subtle) return { ok: false, error: '当前环境不支持本地账户存储。' }
    const email = normalizeEmail(emailInput)
    const user = readUsers(storage).find((entry) => entry.email === email)
    if (!user || await digest(user.salt, password) !== user.passwordHash) {
      return { ok: false, error: '邮箱或密码不正确。' }
    }
    try {
      saveSession(storage, user.id)
      return { ok: true, user: publicUser(user) }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? `登录失败：${error.message}` : '登录失败。' }
    }
  },

  logout(): void {
    try { getStorage()?.removeItem(AUTH_SESSION_STORAGE_KEY) } catch { /* best effort */ }
  },
}
