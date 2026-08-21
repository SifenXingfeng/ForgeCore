import type { GenerationSpec } from './generativeFactory'

const AI_BASE = (import.meta.env.VITE_AI_BASE_URL as string | undefined) ?? 'http://localhost:8000'
const AI_SERVICE_ENABLED = import.meta.env.VITE_AI_ENABLED === 'true'

export interface FactorySpecReply {
  spec: Partial<GenerationSpec>
  source: 'deepseek' | 'rule' | 'fallback'
  note: string | null
}

/** Optional LLM extraction; the caller always keeps the deterministic parser as fallback. */
export async function requestFactorySpec(brief: string, defaults: GenerationSpec): Promise<FactorySpecReply> {
  if (!AI_SERVICE_ENABLED) {
    return { spec: defaults, source: 'rule', note: '可选智能服务未启用，使用确定性规则解析。' }
  }
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), 2800)
  try {
    const response = await fetch(`${AI_BASE}/api/ai/factory-spec`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ brief, defaults }),
      signal: controller.signal,
    })
    if (!response.ok) throw new Error(`AI 服务返回 ${response.status}`)
    return (await response.json()) as FactorySpecReply
  } finally {
    window.clearTimeout(timer)
  }
}
