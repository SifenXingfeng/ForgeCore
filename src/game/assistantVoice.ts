import { requestAssistant, dispatchAssistantState, type AssistantRequestResult } from './assistantRuntime'

const AI_ASR_URL = 'http://127.0.0.1:8000/api/ai/asr'
const TARGET_SAMPLE_RATE = 16000

interface AssistantRecorder {
  stop: () => Promise<Blob>
}

export interface KeywordWakeListener {
  stop: () => Promise<void>
}

export const ASSISTANT_WAKE_WORD = 'BT'

export async function startAssistantRecorder(): Promise<AssistantRecorder> {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('当前浏览器不支持麦克风访问。')
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } })
  const audioContext = new AudioContext()
  await audioContext.resume()
  const source = audioContext.createMediaStreamSource(stream)
  const processor = audioContext.createScriptProcessor(4096, 1, 1)
  const sink = audioContext.createGain()
  const chunks: Float32Array[] = []
  sink.gain.value = 0
  processor.onaudioprocess = (event) => chunks.push(new Float32Array(event.inputBuffer.getChannelData(0)))
  source.connect(processor)
  processor.connect(sink)
  sink.connect(audioContext.destination)

  const sourceSampleRate = audioContext.sampleRate
  return {
    stop: async () => {
      processor.onaudioprocess = null
      source.disconnect()
      processor.disconnect()
      sink.disconnect()
      stream.getTracks().forEach((track) => track.stop())
      await audioContext.close()
      return encodeWav(resample(chunks.flatMap((chunk) => Array.from(chunk)), sourceSampleRate, TARGET_SAMPLE_RATE), TARGET_SAMPLE_RATE)
    },
  }
}

export async function askFromMicrophone(): Promise<AssistantRequestResult> {
  dispatchAssistantState({ phase: 'listening', message: '正在接收语音输入' })
  const recorder = await startAssistantRecorder()
  // The caller controls when stop() is invoked through the button component.
  return requestAssistantFromRecorder(recorder)
}

export async function transcribeAssistantWav(audio: Blob): Promise<string> {
  dispatchAssistantState({ phase: 'thinking', message: '正在识别语音' })
  const text = await recognizeAssistantWav(audio)
  if (!text) throw new Error('没有识别到清晰语音。')
  return text
}

/** 本地短窗识别，供关键字监听使用；静默片段不会改变主界面状态。 */
export async function recognizeAssistantWav(audio: Blob): Promise<string> {
  const response = await fetch(AI_ASR_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'audio/wav' },
    body: audio,
  })
  if (!response.ok) throw new Error(`本地 ASR 返回 ${response.status}`)
  const result = (await response.json()) as { text?: string }
  return result.text?.trim() ?? ''
}

/**
 * 开启本地关键字监听。浏览器只保留麦克风音频在内存中的短片段，
 * 每个有明显能量的窗口才发送到本地 ASR，不上传到第三方服务。
 */
export async function startKeywordWakeListener(onWake: (transcript: string) => void | Promise<void>): Promise<KeywordWakeListener> {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('当前浏览器不支持麦克风访问。')
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } })
  const audioContext = new AudioContext()
  await audioContext.resume()
  const source = audioContext.createMediaStreamSource(stream)
  const processor = audioContext.createScriptProcessor(4096, 1, 1)
  const sink = audioContext.createGain()
  const chunks: number[] = []
  const sourceSampleRate = audioContext.sampleRate
  let stopped = false
  let inFlight = false
  let timer: number | null = null

  sink.gain.value = 0
  processor.onaudioprocess = (event) => {
    const input = event.inputBuffer.getChannelData(0)
    for (let index = 0; index < input.length; index += 1) chunks.push(input[index])
  }
  source.connect(processor)
  processor.connect(sink)
  sink.connect(audioContext.destination)

  const scan = async () => {
    if (stopped || inFlight || chunks.length === 0) return
    const samples = chunks.splice(0, chunks.length)
    if (rootMeanSquare(samples) < 0.012) return
    inFlight = true
    try {
      const audio = encodeWav(resample(samples, sourceSampleRate, TARGET_SAMPLE_RATE), TARGET_SAMPLE_RATE)
      const transcript = await recognizeAssistantWav(audio)
      if (isAssistantWakeWord(transcript)) await onWake(transcript)
    } catch {
      // ASR 服务短暂不可用时继续监听，手动语音仍可显示明确错误。
    } finally {
      inFlight = false
    }
  }

  timer = window.setInterval(() => { void scan() }, 1800)
  return {
    stop: async () => {
      if (stopped) return
      stopped = true
      if (timer !== null) window.clearInterval(timer)
      chunks.length = 0
      processor.onaudioprocess = null
      source.disconnect()
      processor.disconnect()
      sink.disconnect()
      stream.getTracks().forEach((track) => track.stop())
      await audioContext.close()
    },
  }
}

export function isAssistantWakeWord(text: string): boolean {
  const normalized = text.toLocaleLowerCase().replace(/[\s\-_—－]/g, '')
  const remainder = normalized.slice(2)
  return normalized === 'bt'
    || (normalized.startsWith('bt') && /^[\u4e00-\u9fff，,。.!！？?：:、]/u.test(remainder))
    || normalized.startsWith('逼提')
}

export function removeAssistantWakeWord(text: string): string {
  return text
    .replace(/^\s*b\s*t\s*/iu, '')
    .replace(/^\s*逼提\s*/u, '')
    .trim()
    .replace(/^[，,。.!！？?：:、\s]+/, '')
}

function rootMeanSquare(samples: number[]): number {
  if (!samples.length) return 0
  let total = 0
  for (const sample of samples) total += sample * sample
  return Math.sqrt(total / samples.length)
}

export async function requestAssistantFromRecorder(recorder: AssistantRecorder): Promise<AssistantRequestResult> {
  const audio = await recorder.stop()
  const text = await transcribeAssistantWav(audio)
  return requestAssistant(text)
}

function resample(samples: number[], fromRate: number, toRate: number): Float32Array {
  if (fromRate === toRate) return Float32Array.from(samples)
  const targetLength = Math.max(1, Math.round(samples.length * toRate / fromRate))
  const result = new Float32Array(targetLength)
  const ratio = (samples.length - 1) / Math.max(1, targetLength - 1)
  for (let index = 0; index < targetLength; index += 1) {
    const position = index * ratio
    const left = Math.floor(position)
    const right = Math.min(samples.length - 1, left + 1)
    const amount = position - left
    result[index] = (samples[left] ?? 0) * (1 - amount) + (samples[right] ?? 0) * amount
  }
  return result
}

function encodeWav(samples: Float32Array, sampleRate: number): Blob {
  const buffer = new ArrayBuffer(44 + samples.length * 2)
  const view = new DataView(buffer)
  writeAscii(view, 0, 'RIFF')
  view.setUint32(4, 36 + samples.length * 2, true)
  writeAscii(view, 8, 'WAVE')
  writeAscii(view, 12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  writeAscii(view, 36, 'data')
  view.setUint32(40, samples.length * 2, true)
  for (let index = 0; index < samples.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, samples[index] ?? 0))
    view.setInt16(44 + index * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true)
  }
  return new Blob([buffer], { type: 'audio/wav' })
}

function writeAscii(view: DataView, offset: number, value: string) {
  for (let index = 0; index < value.length; index += 1) view.setUint8(offset + index, value.charCodeAt(index))
}
