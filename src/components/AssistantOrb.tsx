import { useEffect, useMemo, useRef, useState } from 'react'

export type AssistantPresencePhase = 'idle' | 'listening' | 'thinking' | 'speaking' | 'error'

interface AssistantPresenceDetail {
  phase?: AssistantPresencePhase
  message?: string
  level?: number
}

interface AssistantAudioLevelDetail {
  level?: number
}

const PHASE_COPY: Record<AssistantPresencePhase, { label: string; detail: string }> = {
  idle: { label: '待命', detail: '等待驾驶员指令' },
  listening: { label: '聆听中', detail: '正在接收语音输入' },
  thinking: { label: '分析中', detail: '正在读取工厂信号' },
  speaking: { label: '播报中', detail: '正在向驾驶员报告' },
  error: { label: '链路异常', detail: '可选智能服务未连接' },
}

/**
 * Assistant presence surface. The optional voice service can drive it with:
 * window.dispatchEvent(new CustomEvent('forgemind:assistant-state', {
 *   detail: { phase: 'speaking', message: '...', level: 0.72 }
 * }))
 *
 * `level` is deliberately an event contract instead of an audio dependency: the
 * TTS player may be local BT audio, a browser AudioBuffer, or a future stream.
 */
export function AssistantOrb({ compact = false }: { compact?: boolean }) {
  const [phase, setPhase] = useState<AssistantPresencePhase>('idle')
  const [message, setMessage] = useState('等待驾驶员指令')
  const [targetLevel, setTargetLevel] = useState(0.16)
  const [level, setLevel] = useState(0.16)
  const targetRef = useRef(0.16)
  const phaseRef = useRef<AssistantPresencePhase>('idle')
  const barSeeds = useMemo(() => Array.from({ length: 28 }, (_, index) => 0.56 + ((index * 17) % 11) / 22), [])
  const byteGlyphs = useMemo(() => createByteGlyphs(64), [])

  useEffect(() => {
    const onState = (event: Event) => {
      const detail = (event as CustomEvent<AssistantPresenceDetail>).detail ?? {}
      const nextPhase = detail.phase ?? 'idle'
      phaseRef.current = nextPhase
      setPhase(nextPhase)
      setMessage(detail.message || PHASE_COPY[nextPhase].detail)
      if (typeof detail.level === 'number') {
        const nextLevel = clamp(detail.level)
        targetRef.current = nextLevel
        setTargetLevel(nextLevel)
      }
    }
    const onLevel = (event: Event) => {
      const detail = (event as CustomEvent<AssistantAudioLevelDetail>).detail ?? {}
      if (typeof detail.level !== 'number') return
      const nextLevel = clamp(detail.level)
      targetRef.current = nextLevel
      setTargetLevel(nextLevel)
    }

    window.addEventListener('forgemind:assistant-state', onState)
    window.addEventListener('forgemind:assistant-audio-level', onLevel)
    return () => {
      window.removeEventListener('forgemind:assistant-state', onState)
      window.removeEventListener('forgemind:assistant-audio-level', onLevel)
    }
  }, [])

  useEffect(() => {
    let frame = 0
    const startedAt = performance.now()
    const tick = (now: number) => {
      const elapsed = (now - startedAt) / 1000
      const speaking = phaseRef.current === 'speaking'
      const listening = phaseRef.current === 'listening'
      const breathing = speaking
        ? 0.12 + Math.abs(Math.sin(elapsed * 5.4)) * 0.48
        : listening
          ? 0.13 + Math.abs(Math.sin(elapsed * 2.3)) * 0.16
          : 0.1 + Math.abs(Math.sin(elapsed * 1.3)) * 0.045
      const desired = Math.max(targetRef.current, breathing)
      setLevel((current) => current + (desired - current) * 0.18)
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [])

  const copy = PHASE_COPY[phase]
  const displayMessage = message || copy.detail
  const displayLevel = Math.max(level, targetLevel * 0.72)
  const displayPercent = compact ? Math.min(16, Math.round(displayLevel * 16)) : Math.round(displayLevel * 100)

  return (
    <section className={`fm-assistant-orb ${compact ? 'is-compact' : ''} fm-assistant-orb-${phase}`} aria-label="ForgeMind BT-7274 智能管家" role="status" aria-live="polite">
      {compact ? (
        <div className="fm-assistant-compact-copy">
          <span className="fm-assistant-orb-kicker">RULE CORE / OPTIONAL AI</span>
          <div>
            <strong>BT-7274</strong>
            <b>{copy.label}</b>
            <span className="fm-assistant-inline-wave" aria-label="语音能量">
              {barSeeds.slice(0, 7).map((seed, index) => (
                <i key={index} style={{ height: `${(2 + displayLevel * (5 + seed * 5) * (0.62 + Math.abs(Math.sin(index * 1.7 + level * 8)) * 0.58)).toFixed(1)}px` }} />
              ))}
            </span>
          </div>
          <small>{displayMessage}</small>
        </div>
      ) : (
        <div className="fm-assistant-orb-head">
          <div>
            <span className="fm-assistant-orb-kicker">RULE INTELLIGENCE / OPTIONAL AI</span>
            <strong>BT-7274</strong>
          </div>
          <span className="fm-assistant-orb-link"><i /> READY</span>
        </div>
      )}

      <div className="fm-assistant-orb-stage" style={{ '--assistant-level': displayLevel } as React.CSSProperties}>
        <div className="fm-assistant-orb-halo fm-assistant-orb-halo-one" />
        <div className="fm-assistant-orb-halo fm-assistant-orb-halo-two" />
        <div className="fm-assistant-orb-wave" aria-hidden="true">
          {barSeeds.map((seed, index) => {
            const pulse = 0.65 + Math.abs(Math.sin(index * 0.82 + level * 8)) * 0.75
            const height = compact ? 4 + displayLevel * 14 * seed * pulse : 7 + displayLevel * 27 * seed * pulse
            const radius = compact ? 27 : 42
            return <i key={index} style={{ height: `${height.toFixed(1)}px`, transform: `rotate(${(360 / barSeeds.length) * index}deg) translateY(-${radius}px)` }} />
          })}
        </div>
        <div className="fm-assistant-orb-core">
          <div className="fm-assistant-byte-sphere" aria-hidden="true">
            {byteGlyphs.map((glyph, index) => (
              <span
                key={index}
                style={{
                  left: `${glyph.x * 100}%`,
                  top: `${glyph.y * 100}%`,
                  opacity: glyph.opacity,
                  color: glyph.color,
                  transform: `translate(-50%, -50%) scale(${glyph.scale})`,
                }}
              >
                {glyph.value}
              </span>
            ))}
          </div>
        </div>
      </div>

      {compact ? (
        <span className="fm-assistant-orb-meter">{displayPercent.toString().padStart(2, '0')}%</span>
      ) : (
        <div className="fm-assistant-orb-foot">
          <div><b>{copy.label}</b><span>{displayMessage}</span></div>
          <span className="fm-assistant-orb-meter">{displayPercent.toString().padStart(2, '0')}%</span>
        </div>
      )}
    </section>
  )
}

function clamp(value: number): number {
  return Math.min(1, Math.max(0, value))
}

interface ByteGlyph {
  x: number
  y: number
  scale: number
  opacity: number
  color: string
  value: '0' | '1' | '·'
}

function createByteGlyphs(count: number): ByteGlyph[] {
  const goldenAngle = Math.PI * (3 - Math.sqrt(5))
  return Array.from({ length: count }, (_, index) => {
    const t = (index + 0.5) / count
    const latitude = Math.acos(1 - 2 * t)
    const longitude = goldenAngle * index
    const depth = (Math.sin(latitude) * Math.sin(longitude) + 1) / 2
    return {
      x: 0.5 + Math.sin(latitude) * Math.cos(longitude) * 0.46,
      y: 0.5 + Math.cos(latitude) * 0.46,
      scale: 0.55 + depth * 0.8,
      opacity: 0.2 + depth * 0.7,
      color: index % 11 === 0 ? '#d7a522' : depth > 0.62 ? '#70c7c0' : '#397f82',
      value: index % 7 === 0 ? '·' : index % 2 === 0 ? '0' : '1',
    }
  })
}
