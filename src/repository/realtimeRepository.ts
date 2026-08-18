import { getAccessToken } from './apiClient'

export interface FactoryRealtimeHandlers {
  onMetrics?: (sample: Record<string, unknown>) => void
  onActivity?: (event: Record<string, unknown>) => void
  onSimulation?: (state: Record<string, unknown>) => void
  onFactorySynced?: () => void
}

const parseBlock = (block: string): { event: string; data: Record<string, unknown> } | null => {
  const event = block.match(/^event:\s*(.+)$/m)?.[1]?.trim() ?? 'message'
  const dataLine = block.match(/^data:\s*(.+)$/m)?.[1]?.trim()
  if (!dataLine) return null
  try {
    const data = JSON.parse(dataLine) as unknown
    return data && typeof data === 'object' ? { event, data: data as Record<string, unknown> } : null
  } catch {
    return null
  }
}

export function subscribeFactoryEvents(factoryId: string, handlers: FactoryRealtimeHandlers): () => void {
  const controller = new AbortController()
  const consume = async () => {
    try {
      const response = await fetch(`/api/realtime/factory/${encodeURIComponent(factoryId)}/events`, {
        headers: { Accept: 'text/event-stream', ...(getAccessToken() ? { Authorization: `Bearer ${getAccessToken()}` } : {}) },
        signal: controller.signal,
      })
      if (!response.ok || !response.body) return
      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      while (!controller.signal.aborted) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const blocks = buffer.split(/\r?\n\r?\n/)
        buffer = blocks.pop() ?? ''
        for (const block of blocks) {
          const parsed = parseBlock(block)
          if (!parsed) continue
          if (parsed.event === 'metrics') handlers.onMetrics?.(parsed.data)
          else if (parsed.event === 'activity') handlers.onActivity?.(parsed.data)
          else if (parsed.event === 'simulation') handlers.onSimulation?.(parsed.data)
          else if (parsed.event === 'factory_synced') handlers.onFactorySynced?.()
        }
      }
      reader.releaseLock()
    } catch {
      // Realtime is an enhancement; the local simulation keeps running if the stream drops.
    }
  }
  void consume()
  return () => controller.abort()
}
