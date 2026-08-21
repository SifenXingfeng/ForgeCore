import { useEffect, useRef, useState } from 'react'
import { animateIfAllowed } from '../utils/animeMotion'
import { AI_SERVICE_ENABLED } from '../game/api'
import { dispatchAssistantState, requestAssistant } from '../game/assistantRuntime'
import {
  ASSISTANT_WAKE_WORD,
  removeAssistantWakeWord,
  startAssistantRecorder,
  startKeywordWakeListener,
  transcribeAssistantWav,
  type KeywordWakeListener,
} from '../game/assistantVoice'

interface RecorderHandle {
  stop: () => Promise<Blob>
}

export function AssistantVoiceButton() {
  const [recording, setRecording] = useState(false)
  const [busy, setBusy] = useState(false)
  const [wakeEnabled, setWakeEnabled] = useState(false)
  const recorderRef = useRef<RecorderHandle | null>(null)
  const wakeRef = useRef<KeywordWakeListener | null>(null)
  const recordingRef = useRef(false)
  const busyRef = useRef(false)
  const wakeTriggeredRef = useRef(false)
  const wakeAutoEnabledRef = useRef(true)
  const autoStopRef = useRef<number | null>(null)
  const controlsRef = useRef<HTMLDivElement>(null)

  const setBusyState = (next: boolean) => {
    busyRef.current = next
    setBusy(next)
  }

  const stopWake = async () => {
    const listener = wakeRef.current
    wakeRef.current = null
    setWakeEnabled(false)
    if (listener) await listener.stop()
  }

  const finishRecording = async () => {
    if (!recordingRef.current) return
    recordingRef.current = false
    setRecording(false)
    setBusyState(true)
    try {
      const recorder = recorderRef.current
      recorderRef.current = null
      if (!recorder) return
      const text = await transcribeAssistantWav(await recorder.stop())
      await requestAssistant(text)
    } catch (error) {
      dispatchAssistantState({ phase: 'error', message: readableVoiceError(error) })
    } finally {
      setBusyState(false)
      await rearmWake()
    }
  }

  const handleWake = async (transcript: string) => {
    if (wakeTriggeredRef.current || recordingRef.current || busyRef.current) return
    wakeTriggeredRef.current = true
    await stopWake()
    const command = removeAssistantWakeWord(transcript)
    if (command) {
      setBusyState(true)
      dispatchAssistantState({ phase: 'thinking', message: '已唤醒，正在处理指令' })
      try {
        await requestAssistant(command)
      } catch (error) {
        dispatchAssistantState({ phase: 'error', message: readableVoiceError(error) })
      } finally {
        setBusyState(false)
        await rearmWake()
      }
      return
    }

    try {
      recorderRef.current = await startAssistantRecorder()
      recordingRef.current = true
      setRecording(true)
      dispatchAssistantState({ phase: 'listening', message: `已唤醒，请说出指令（${ASSISTANT_WAKE_WORD}）` })
      autoStopRef.current = window.setTimeout(() => { void finishRecording() }, 5000)
    } catch (error) {
      dispatchAssistantState({ phase: 'error', message: readableVoiceError(error) })
      await rearmWake()
    }
  }

  const enableWake = async () => {
    try {
      wakeTriggeredRef.current = false
      const listener = await startKeywordWakeListener((transcript) => handleWake(transcript))
      wakeRef.current = listener
      setWakeEnabled(true)
      dispatchAssistantState({ phase: 'idle', message: `等待唤醒词：${ASSISTANT_WAKE_WORD}` })
    } catch (error) {
      const message = readableVoiceError(error)
      dispatchAssistantState({
        phase: message === '麦克风权限未开启' ? 'idle' : 'error',
        message: message === '麦克风权限未开启' ? '请允许麦克风，关键字唤醒将自动开启' : message,
      })
    }
  }

  const toggleWake = async () => {
    if (recording || busy) return
    if (wakeEnabled) {
      wakeAutoEnabledRef.current = false
      await stopWake()
      dispatchAssistantState({ phase: 'idle', message: '关键字唤醒已关闭' })
      return
    }
    wakeAutoEnabledRef.current = true
    await enableWake()
  }

  const rearmWake = async () => {
    if (!wakeAutoEnabledRef.current || wakeRef.current || recordingRef.current || busyRef.current) return
    await enableWake()
  }

  const toggle = async () => {
    if (busy) return
    if (recording) {
      if (autoStopRef.current !== null) window.clearTimeout(autoStopRef.current)
      autoStopRef.current = null
      await finishRecording()
      return
    }

    try {
      if (wakeEnabled) await stopWake()
      recorderRef.current = await startAssistantRecorder()
      recordingRef.current = true
      setRecording(true)
      dispatchAssistantState({ phase: 'listening', message: '正在接收语音输入' })
    } catch (error) {
      dispatchAssistantState({ phase: 'error', message: readableVoiceError(error) })
    }
  }

  // 默认开启；浏览器首次访问麦克风时会先请求用户授权。
  useEffect(() => {
    if (!AI_SERVICE_ENABLED) {
      dispatchAssistantState({ phase: 'idle', message: '规则模式已启用；语音服务为可选项' })
      return
    }
    void enableWake()
    return () => {
      if (autoStopRef.current !== null) window.clearTimeout(autoStopRef.current)
      void wakeRef.current?.stop()
    }
  }, [])

  useEffect(() => {
    const controls = controlsRef.current
    if (!controls || (!recording && !wakeEnabled)) return
    const activeButton = controls.querySelector<HTMLElement>(recording ? '.fm-assistant-mic' : '.fm-assistant-wake')
    if (!activeButton) return
    const animation = animateIfAllowed(activeButton, {
      scale: [0.94, 1.06, 1],
      duration: 420,
      ease: 'out(3)',
    })
    return () => { animation?.cancel() }
  }, [recording, wakeEnabled, busy])

  return (
    <div ref={controlsRef} className="fm-assistant-controls">
      <button
        className={`fm-assistant-mic ${recording ? 'is-recording' : ''} ${busy ? 'is-busy' : ''}`}
        type="button"
        onClick={() => void toggle()}
        disabled={!AI_SERVICE_ENABLED}
        aria-label={recording ? '结束语音输入' : '开始语音输入'}
        title={!AI_SERVICE_ENABLED ? '使用 -IncludeAI 启动可选语音服务' : recording ? '结束语音输入' : '开始语音输入'}
      >
        <span>{recording ? '■' : '◉'}</span>
        <small>{recording ? '结束' : '语音'}</small>
      </button>
      <button
        className={`fm-assistant-wake ${wakeEnabled ? 'is-enabled' : ''} ${busy ? 'is-busy' : ''}`}
        type="button"
        onClick={() => void toggleWake()}
        disabled={!AI_SERVICE_ENABLED}
        aria-label={wakeEnabled ? `关闭${ASSISTANT_WAKE_WORD}关键字唤醒` : `开启${ASSISTANT_WAKE_WORD}关键字唤醒`}
        title={!AI_SERVICE_ENABLED ? '使用 -IncludeAI 启动可选语音服务' : wakeEnabled ? `关闭${ASSISTANT_WAKE_WORD}关键字唤醒` : `开启${ASSISTANT_WAKE_WORD}关键字唤醒`}
      >
        <span>⌁</span>
        <small>{wakeEnabled ? '已启用' : '唤醒'}</small>
      </button>
    </div>
  )
}

function readableVoiceError(error: unknown): string {
  const raw = error instanceof Error ? error.message : ''
  if (raw.includes('404')) return '语音服务未启动'
  if (raw.includes('权限') || raw.includes('denied') || raw.includes('NotAllowed')) return '麦克风权限未开启'
  if (raw.includes('没有识别')) return '没有听清，请再说一次'
  return raw || '语音输入失败'
}
