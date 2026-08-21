import { useEffect, useRef, useState } from 'react'
import {
  changeInspectionPart,
  inspectionRegistry,
  requestInspectionArmReset,
  setInspectionManualArm,
  setInspectionPaused,
  type ManualArm,
} from '../scene/inspectionRegistry'
import { PART_TYPES } from '../scene/inspectionPart'
import { runInspection, type VisionResult } from '../scene/inspectionDetect'

const DEFECT_LABEL: Record<string, string> = { scratch: '划痕', burr: '毛刺', dent: '凹痕' }
const PHASE_LABEL: Record<string, string> = { idle: '待机', picking: '取件中', inspecting: '检测中', placing: '分拣中' }
type HistoryEntry = VisionResult & { id: number; part: string; time: string }

/** 独立视觉检测工作台：实时取景、检测控制、缺陷结果、语音状态和分拣追踪。 */
export function InspectionPanel() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const dotRef = useRef<HTMLSpanElement>(null)
  const voiceRef = useRef<HTMLAudioElement | null>(null)
  const sequenceRef = useRef(0)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<VisionResult | null>(null)
  const [partLabel, setPartLabel] = useState(() => PART_TYPES[inspectionRegistry.partSeed].label)
  const [frameReady, setFrameReady] = useState(false)
  const [phase, setPhase] = useState(inspectionRegistry.phase)
  const [paused, setPaused] = useState(inspectionRegistry.paused)
  const [manualArm, setManualArm] = useState<ManualArm | null>(inspectionRegistry.manualArm)
  const [history, setHistory] = useState<HistoryEntry[]>([])
  const [voiceState, setVoiceState] = useState<'idle' | 'speaking' | 'offline'>('idle')

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    let raf = 0
    let lastVersion = -1
    const paint = () => {
      raf = requestAnimationFrame(paint)
      const frame = inspectionRegistry.frame
      if (!frame || frame.version === lastVersion) return
      lastVersion = frame.version
      const rowBytes = frame.width * 4
      const flipped = new Uint8ClampedArray(frame.pixels.length)
      for (let y = 0; y < frame.height; y += 1) {
        const src = y * rowBytes
        const dst = (frame.height - 1 - y) * rowBytes
        flipped.set(frame.pixels.subarray(src, src + rowBytes), dst)
      }
      canvas.width = frame.width
      canvas.height = frame.height
      ctx.putImageData(new ImageData(flipped, frame.width, frame.height), 0, 0)
      setFrameReady(true)
      dotRef.current?.classList.remove('is-offline')
    }
    paint()
    return () => cancelAnimationFrame(raf)
  }, [])

  useEffect(() => {
    const timer = window.setInterval(() => {
      setPhase(inspectionRegistry.phase)
      setPaused(inspectionRegistry.paused)
      setManualArm(inspectionRegistry.manualArm)
    }, 200)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    const onResult = (event: Event) => {
      const json = (event as CustomEvent<VisionResult>).detail
      const part = PART_TYPES[inspectionRegistry.partSeed]
      setResult(json)
      setHistory((items) => [{
        ...json,
        id: sequenceRef.current++,
        part: part?.label ?? `PART-${inspectionRegistry.partSeed}`,
        time: new Date().toLocaleTimeString('zh-CN', { hour12: false }),
      }, ...items].slice(0, 5))
      void speakResult(json)
    }
    window.addEventListener('forgemind:inspection-result', onResult)
    return () => window.removeEventListener('forgemind:inspection-result', onResult)
  }, [])

  const speakResult = async (json: VisionResult) => {
    const text = json.verdict === 'pass'
      ? '视觉检测完成，判定合格，转入成品区。'
      : json.verdict === 'fail'
        ? `视觉检测完成，发现${json.defects.length}处缺陷，判定不合格，转入隔离区。`
        : '视觉检测未完成，工件已转入隔离区，请检查 AI 服务。'
    setVoiceState('speaking')
    let objectUrl: string | null = null
    try {
      const response = await fetch('http://127.0.0.1:8000/api/ai/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, length_scale: 1.0 }),
      })
      if (!response.ok) throw new Error(`TTS ${response.status}`)
      objectUrl = URL.createObjectURL(await response.blob())
      const audio = new Audio(objectUrl)
      voiceRef.current?.pause()
      voiceRef.current = audio
      await audio.play()
      await new Promise<void>((resolve) => {
        audio.onended = () => resolve()
        audio.onerror = () => resolve()
      })
      setVoiceState('idle')
    } catch {
      setVoiceState('offline')
    } finally {
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }

  const changePart = (seed: number) => {
    changeInspectionPart(seed)
    inspectionRegistry.lastVerdict = null
    setPartLabel(PART_TYPES[seed].label)
    setResult(null)
  }

  const manualDetect = async () => {
    setBusy(true)
    try {
      await runInspection()
    } finally {
      setBusy(false)
    }
  }

  const route = result?.verdict === 'pass' ? 'PASS → 成品区' : result ? 'FAIL / ERROR → 隔离区' : '等待检测结果'
  const manualLabel = manualArm === 'gripper' ? '夹取臂' : manualArm === 'camera' ? '摄像头臂' : ''

  const togglePause = () => {
    if (paused) setInspectionPaused(false)
    else setInspectionPaused(true)
  }

  return (
    <aside className="fm-inspection" aria-label="视觉检测">
      <div className="fm-inspection-head">
        <span ref={dotRef} className={`fm-inspection-dot ${frameReady ? '' : 'is-offline'}`} />
        <span className="fm-inspection-title">视觉检测</span>
        <span className="fm-inspection-code">360° SCAN / 01</span>
      </div>

      <div className="fm-inspection-status">
        <div><span>工作阶段</span><strong>{PHASE_LABEL[phase] ?? phase}</strong></div>
        <div><span>相机信号</span><strong className={frameReady ? 'is-good' : 'is-muted'}>{frameReady ? 'ONLINE' : 'WAITING'}</strong></div>
        <div><span>当前工件</span><strong>PART-{String(inspectionRegistry.partSeed).padStart(2, '0')}</strong></div>
        <div><span>语音播报</span><strong className={voiceState === 'offline' ? 'is-muted' : ''}>{voiceState === 'speaking' ? 'SPEAKING' : voiceState === 'offline' ? 'OFFLINE' : 'READY'}</strong></div>
      </div>

      <div className="fm-inspection-view">
        <canvas ref={canvasRef} className="fm-inspection-canvas" />
        <div className="fm-inspection-frame" />
        <span className="fm-inspection-camera-label">CAM / 512×384</span>
      </div>

      <div className="fm-inspection-actions">
        <button className="fm-inspection-btn fm-inspection-btn-primary" onClick={manualDetect} disabled={busy}>
          {busy ? '检测中…' : '▣ 手动检测'}
        </button>
        <div className="fm-inspection-switch">
          {PART_TYPES.map((t) => (
            <button key={t.seed} className={t.seed === inspectionRegistry.partSeed ? 'is-active' : ''} onClick={() => changePart(t.seed)}>{t.label}</button>
          ))}
        </div>
      </div>

      <div className={`fm-inspection-control ${paused ? 'is-paused' : ''}`}>
        <div className="fm-inspection-control-head">
          <span>流程控制</span>
          <strong>{paused ? (manualArm ? `${manualLabel}人工接管` : '流程已暂停') : '自动运行'}</strong>
        </div>
        <button className="fm-inspection-control-main" onClick={togglePause}>
          {paused ? '▶ 恢复自动流程' : 'Ⅱ 暂停流程'}
        </button>
        {paused && (
          <>
            <div className="fm-inspection-control-caption">选择一条机械臂接入手柄 / WASD 控制</div>
            <div className="fm-inspection-control-grid">
              <button className={manualArm === 'gripper' ? 'is-active' : ''} onClick={() => setInspectionManualArm('gripper')}>接管夹取臂</button>
              <button className={manualArm === 'camera' ? 'is-active' : ''} onClick={() => setInspectionManualArm('camera')}>接管摄像头臂</button>
            </div>
          </>
        )}
        <div className="fm-inspection-reset-row">
          <button onClick={() => requestInspectionArmReset('gripper')}>夹取臂复位</button>
          <button onClick={() => requestInspectionArmReset('camera')}>摄像头臂复位</button>
        </div>
      </div>

      <div className={`fm-inspection-result ${result ? `is-${result.verdict}` : ''}`}>
        {result ? (
          <>
            <div className="fm-inspection-verdict">
              {result.verdict === 'pass' && <strong>合格</strong>}
              {result.verdict === 'fail' && <strong>不合格</strong>}
              {result.verdict === 'error' && <strong>检测失败</strong>}
              <span>{result.defects.length} 处缺陷 · 置信 {(result.confidence * 100).toFixed(0)}%</span>
            </div>
            <ul className="fm-inspection-defects">
              {result.defects.map((d, i) => <li key={i}><span>{DEFECT_LABEL[d.type] ?? d.type}</span><span>severe {d.severity.toFixed(2)}</span></li>)}
              {result.verdict === 'pass' && result.defects.length === 0 && <li className="fm-inspection-ok">表面无缺陷</li>}
              {result.note && <li className="fm-inspection-note">{result.note}</li>}
            </ul>
          </>
        ) : <div className="fm-inspection-idle">货物进入视野后自动开始 360° 环绕检测 · 当前零件：{partLabel}</div>}
      </div>

      <div className="fm-inspection-route"><span>判定路由</span><strong className={result?.verdict === 'pass' ? 'is-pass' : result ? 'is-fail' : ''}>{route}</strong></div>

      <div className="fm-inspection-history">
        <div className="fm-inspection-history-head"><span>最近检测</span><span>{history.length.toString().padStart(2, '0')} / 05</span></div>
        {history.length === 0 ? <div className="fm-inspection-history-empty">检测完成后将在此保留最近 5 条记录</div> : history.map((item) => (
          <div className="fm-inspection-history-row" key={item.id}>
            <span className={`fm-history-badge is-${item.verdict}`}>{item.verdict === 'pass' ? 'PASS' : item.verdict === 'fail' ? 'FAIL' : 'ERR'}</span>
            <span>{item.part}</span><span>{item.defects.length} 缺陷</span><time>{item.time}</time>
          </div>
        ))}
      </div>

      <div className="fm-inspection-hint"><span>360° 环绕</span><span>实时检测</span><span>安全隔离</span></div>
    </aside>
  )
}
