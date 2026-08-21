import { streamAssistant, type AssistantReply } from './api'
import { executeAssistantToolCall, getCurrentFactoryAssistantContext, type AssistantExecutionResult } from './assistantExecutor'
import type { AssistantToolCall } from './assistantProtocol'

const AI_TTS_URL = 'http://127.0.0.1:8000/api/ai/tts'

export interface AssistantRequestResult {
  answer: string
  execution: AssistantExecutionResult | null
  pendingConfirmation: AssistantToolCall | null
}

export function dispatchAssistantState(detail: {
  phase: 'idle' | 'listening' | 'thinking' | 'speaking' | 'error'
  message?: string
  level?: number
}) {
  window.dispatchEvent(new CustomEvent('forgemind:assistant-state', { detail }))
}

export async function requestAssistant(question: string): Promise<AssistantRequestResult> {
  const prompt = question.trim()
  if (!prompt) throw new Error('请输入要交给智能管家的问题。')

  dispatchAssistantState({ phase: 'thinking', message: '正在读取工厂信号' })
  try {
    const context = getCurrentFactoryAssistantContext()
    const speech = createSpeechQueue()
    let streamedText = ''
    let speechBuffer = ''
    let reply: AssistantReply
    try {
      reply = await streamAssistant(
        prompt,
        context as unknown as Record<string, unknown>,
        (delta) => {
          streamedText += delta
          speechBuffer += delta
          dispatchAssistantState({ phase: 'speaking', message: streamedText.trim().slice(-54) })
          const extracted = extractSpeechFragments(speechBuffer)
          speechBuffer = extracted.remainder
          extracted.fragments.forEach((fragment) => speech.enqueue(fragment))
        },
      )
    } catch {
      reply = createBuiltInRuleReply(prompt)
      dispatchAssistantState({ phase: 'speaking', message: reply.answer })
    }
    let execution: AssistantExecutionResult | null = null
    let pendingConfirmation: AssistantToolCall | null = null

    if (reply.action && reply.validated) {
      execution = executeAssistantToolCall(reply.action)
      if (execution.status === 'awaiting_confirmation') pendingConfirmation = execution.call
    } else if (reply.action && !reply.validated) {
      execution = { status: 'rejected', answer: reply.note || '动作未通过安全校验。' }
    }

    const answer = execution?.answer ?? reply.answer
    if (execution) {
      speechBuffer = ''
      speech.enqueue(answer)
    } else if (streamedText.trim()) {
      const tail = speechBuffer.trim()
      if (tail) speech.enqueue(tail)
    } else {
      speech.enqueue(answer)
    }
    await speech.finish()
    return { answer, execution, pendingConfirmation }
  } catch (error) {
    const message = error instanceof Error ? error.message : '智能助手暂不可用。'
    dispatchAssistantState({ phase: 'error', message })
    throw error
  }
}

function createBuiltInRuleReply(question: string): AssistantReply {
  const normalized = question.toLowerCase().replace(/\s+/gu, '')
  let action: AssistantToolCall | null = null

  if (['重置仿真', '重新开始', '清空进度'].some((word) => normalized.includes(word))) {
    action = { protocolVersion: '1.0.0', name: 'reset_simulation', arguments: {} }
  } else {
    const speedMatch = normalized.match(/([0-9]+(?:\.[0-9]+)?)\s*(?:倍|x)/u)
    if (speedMatch && ['倍率', '倍速', '速度', '调到', '设置'].some((word) => normalized.includes(word))) {
      action = { protocolVersion: '1.0.0', name: 'set_simulation_speed', arguments: { speed: Number(speedMatch[1]) } }
    } else if (['暂停仿真', '停止仿真', '暂停生产'].some((word) => normalized.includes(word))) {
      action = { protocolVersion: '1.0.0', name: 'set_simulation_running', arguments: { running: false } }
    } else if (['启动仿真', '开始仿真', '开始生产', '继续仿真'].some((word) => normalized.includes(word))) {
      action = { protocolVersion: '1.0.0', name: 'set_simulation_running', arguments: { running: true } }
    } else if (['工厂状态', '运行情况', '生产情况', '累计产出', '在途物料'].some((word) => normalized.includes(word))) {
      action = { protocolVersion: '1.0.0', name: 'query_factory_status', arguments: {} }
    }
  }

  const validSpeed = action?.name !== 'set_simulation_speed' || (action.arguments.speed >= 0.1 && action.arguments.speed <= 4)
  return {
    answer: action ? '规则助手已识别工厂操作。' : '规则助手已就绪。可查询工厂状态、启停仿真、调整倍率或发起重置确认。',
    source: 'rule',
    note: '浏览器规则模式，不需要本地部署大语言模型。',
    protocolVersion: '1.0.0',
    action,
    validated: Boolean(action && validSpeed),
    requiresConfirmation: action?.name === 'reset_simulation',
  }
}

export async function confirmAssistantAction(call: AssistantToolCall): Promise<AssistantExecutionResult> {
  const execution = executeAssistantToolCall(call, { confirmed: true })
  await speakAssistantText(execution.status === 'executed' ? execution.answer : execution.answer)
  return execution
}

async function speakAssistantText(text: string) {
  if (!text.trim()) {
    dispatchAssistantState({ phase: 'idle', message: '等待驾驶员指令' })
    return
  }

  const speech = createSpeechQueue()
  speech.enqueue(text)
  await speech.finish()
}

async function synthesizeAssistantAudio(text: string): Promise<HTMLAudioElement> {
  const response = await fetch(AI_TTS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  })
  if (!response.ok) throw new Error(`BT TTS 返回 ${response.status}`)
  const audio = new Audio(URL.createObjectURL(await response.blob()))
  audio.preload = 'auto'
  return audio
}

function createSpeechQueue() {
  let playback = Promise.resolve()
  let failed = false
  return {
    enqueue(text: string) {
      const fragment = text.trim()
      if (!fragment) return
      // 合成请求立即发出；播放仍按入队顺序进行，实现 LLM、TTS、播放三段并行。
      const audioResult = synthesizeAssistantAudio(fragment).then(
        (audio) => ({ audio, error: null as unknown }),
        (error: unknown) => ({ audio: null, error }),
      )
      playback = playback.then(async () => {
        const result = await audioResult
        if (!result.audio) {
          failed = true
          return
        }
        await playWithMeter(result.audio, fragment)
      }).catch(() => { failed = true })
    },
    async finish() {
      await playback
      dispatchAssistantState({
        phase: 'idle',
        message: failed ? '文字回复已就绪，语音服务未连接' : '等待驾驶员指令',
      })
    },
  }
}

function extractSpeechFragments(buffer: string): { fragments: string[]; remainder: string } {
  const fragments: string[] = []
  let remainder = buffer
  const targetLength = 14
  const maxLength = 18
  while (true) {
    // 标点优先；没有标点时按短语长度切分，让 TTS 在模型继续生成时立即开始。
    const punctuation = /[，。！？!?；]/.exec(remainder)
    let end = -1
    if (punctuation && punctuation.index !== undefined && punctuation.index < maxLength) {
      end = punctuation.index + punctuation[0].length
    } else if (remainder.length >= targetLength) {
      const window = remainder.slice(0, maxLength)
      const boundaries = [...window.matchAll(/[、，,；;：:]/g)]
      const boundary = boundaries[boundaries.length - 1]
      end = boundary && boundary.index !== undefined && boundary.index >= 6
        ? boundary.index + boundary[0].length
        : targetLength
    }
    if (end < 0) break
    const fragment = remainder.slice(0, end).trim()
    remainder = remainder.slice(end)
    if (fragment) fragments.push(fragment)
  }
  return { fragments, remainder }
}

async function playWithMeter(audio: HTMLAudioElement, message: string): Promise<void> {
  const AudioContextCtor = window.AudioContext || window.webkitAudioContext
  if (!AudioContextCtor) {
    dispatchAssistantState({ phase: 'speaking', message })
    await playAudio(audio)
    URL.revokeObjectURL(audio.src)
    return
  }

  const audioContext = new AudioContextCtor()
  const analyser = audioContext.createAnalyser()
  analyser.fftSize = 128
  const source = audioContext.createMediaElementSource(audio)
  source.connect(analyser)
  analyser.connect(audioContext.destination)
  const samples = new Uint8Array(analyser.frequencyBinCount)
  let frame = 0
  const sample = () => {
    analyser.getByteFrequencyData(samples)
    const average = samples.reduce((sum, value) => sum + value, 0) / samples.length / 255
    window.dispatchEvent(new CustomEvent('forgemind:assistant-audio-level', { detail: { level: average } }))
    frame = requestAnimationFrame(sample)
  }

  dispatchAssistantState({ phase: 'speaking', message })
  try {
    await audioContext.resume()
    sample()
    await playAudio(audio)
  } finally {
    cancelAnimationFrame(frame)
    source.disconnect()
    analyser.disconnect()
    await audioContext.close()
    URL.revokeObjectURL(audio.src)
  }
}

function playAudio(audio: HTMLAudioElement): Promise<void> {
  return new Promise((resolve, reject) => {
    const onEnded = () => { cleanup(); resolve() }
    const onError = () => { cleanup(); reject(new Error('BT TTS 音频播放失败')) }
    const cleanup = () => {
      audio.removeEventListener('ended', onEnded)
      audio.removeEventListener('error', onError)
    }
    audio.addEventListener('ended', onEnded)
    audio.addEventListener('error', onError)
    audio.play().catch((error) => { cleanup(); reject(error) })
  })
}

declare global {
  interface Window {
    webkitAudioContext?: typeof AudioContext
  }
}
