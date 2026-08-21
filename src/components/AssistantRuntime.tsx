import { useEffect } from 'react'
import { requestAssistant } from '../game/assistantRuntime'

/**
 * 统一接入桥：文字面板、浏览器麦克风和独立 voice-chat 都可以派发同一事件。
 *
 * window.dispatchEvent(new CustomEvent('forgemind:assistant-request', {
 *   detail: { question: '现在工厂运行情况怎么样？' }
 * }))
 */
export function AssistantRuntime() {
  useEffect(() => {
    const onRequest = (event: Event) => {
      const question = (event as CustomEvent<{ question?: string }>).detail?.question
      if (typeof question === 'string' && question.trim()) void requestAssistant(question)
    }
    window.addEventListener('forgemind:assistant-request', onRequest)
    return () => window.removeEventListener('forgemind:assistant-request', onRequest)
  }, [])

  return null
}
