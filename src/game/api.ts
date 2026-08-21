import type { FactorySave } from './save'
import type { AssistantToolCall, AssistantToolCatalog } from './assistantProtocol'

/**
 * 通用服务客户端。/api/factory 是旧版单工厂兼容接口；当前项目库使用
 * src/api/factoryProjects.ts 的 /api/factories 多存档接口。
 */

const SPRING_BASE = 'http://localhost:8080'
const AI_BASE = (import.meta.env.VITE_AI_BASE_URL as string | undefined) ?? 'http://localhost:8000'
export const AI_SERVICE_ENABLED = import.meta.env.VITE_AI_ENABLED === 'true'

function backendHeaders(): Record<string, string> {
  const token = localStorage.getItem('forgemind.token')
  return token ? { Authorization: `Bearer ${token}` } : {}
}

async function withTimeout<T>(p: Promise<T>, ms = 2500): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('请求超时')), ms)
  })
  try {
    return await Promise.race([p, timeout])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

/** 从 Spring Boot 拉取工厂存档 */
export async function fetchRemoteSave(): Promise<FactorySave> {
  const res = await withTimeout(fetch(`${SPRING_BASE}/api/factory`, { headers: backendHeaders() }))
  if (!res.ok) throw new Error(`后端返回 ${res.status}`)
  return (await res.json()) as FactorySave
}

/** 推送存档到 Spring Boot */
export async function pushRemoteSave(save: FactorySave): Promise<void> {
  const res = await withTimeout(
    fetch(`${SPRING_BASE}/api/factory`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...backendHeaders() },
      body: JSON.stringify(save),
    }),
  )
  if (!res.ok) throw new Error(`后端返回 ${res.status}`)
}

/** 探测 Spring Boot 是否在线 */
export async function isBackendOnline(): Promise<boolean> {
  try {
    const res = await withTimeout(fetch(`${SPRING_BASE}/api/factory/health`), 1500)
    return res.ok
  } catch {
    return false
  }
}

export interface AssistantReply {
  answer: string
  source: 'rule' | 'llm' | 'stub' | 'fallback'
  note: string | null
  protocolVersion: string
  action: AssistantToolCall | null
  validated: boolean
  requiresConfirmation: boolean
}

/** 调 AI 助手（离线编排占位） */
export async function askAssistant(
  question: string,
  context?: Record<string, unknown>,
): Promise<AssistantReply> {
  if (!AI_SERVICE_ENABLED) throw new Error('可选智能服务未启用。')
  const res = await withTimeout(
    fetch(`${AI_BASE}/api/ai/assistant`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question, context }),
    }),
    15_000,
  )
  if (!res.ok) throw new Error(`AI 服务返回 ${res.status}`)
  return (await res.json()) as AssistantReply
}

type AssistantStreamEvent =
  | { type: 'delta'; text: string }
  | { type: 'done'; reply: AssistantReply }
  | { type: 'error'; message: string }

/** 调用可选智能服务；工具动作只从最终 reply 读取。 */
export async function streamAssistant(
  question: string,
  context: Record<string, unknown> | undefined,
  onDelta: (text: string) => void,
): Promise<AssistantReply> {
  if (!AI_SERVICE_ENABLED) throw new Error('可选智能服务未启用。')
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 60_000)
  try {
    const res = await fetch(`${AI_BASE}/api/ai/assistant/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question, context }),
      signal: controller.signal,
    })
    if (!res.ok) throw new Error(`AI 服务返回 ${res.status}`)
    if (!res.body) throw new Error('浏览器不支持 AI 流式响应。')

    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let reply: AssistantReply | null = null

    const consumeLine = (line: string) => {
      if (!line.trim()) return
      const event = JSON.parse(line) as AssistantStreamEvent
      if (event.type === 'delta') onDelta(event.text)
      else if (event.type === 'done') reply = event.reply
      else if (event.type === 'error') throw new Error(event.message)
    }

    while (true) {
      const { done, value } = await reader.read()
      buffer += decoder.decode(value, { stream: !done })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      lines.forEach(consumeLine)
      if (done) break
    }
    consumeLine(buffer)
    if (!reply) throw new Error('AI 流式响应未正常结束。')
    return reply
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw new Error('AI 响应超时。')
    throw error
  } finally {
    clearTimeout(timer)
  }
}

/** 获取 ai-service 当前公开的版本化工具目录。 */
export async function fetchAssistantToolCatalog(): Promise<AssistantToolCatalog> {
  if (!AI_SERVICE_ENABLED) throw new Error('可选智能服务未启用。')
  const res = await withTimeout(fetch(`${AI_BASE}/api/ai/tools`))
  if (!res.ok) throw new Error(`AI 服务返回 ${res.status}`)
  return (await res.json()) as AssistantToolCatalog
}
