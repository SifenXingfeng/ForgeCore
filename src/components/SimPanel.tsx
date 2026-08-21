import { useForgeMindStore } from '../store/forgeMind'

/**
 * 仿真控制面板（Day 4）：播放/暂停/重置/倍率 + 逻辑时间 + 产出统计。
 * 数据来自 store.simSnapshot（runner 低频写入）。
 */
export function SimPanel() {
  const snapshot = useForgeMindStore((s) => s.simSnapshot)
  const playing = useForgeMindStore((s) => s.simPlaying)
  const speed = useForgeMindStore((s) => s.simSpeed)
  const setPlaying = useForgeMindStore((s) => s.setSimPlaying)
  const setSpeed = useForgeMindStore((s) => s.setSimSpeed)
  const requestSimReset = useForgeMindStore((s) => s.requestSimReset)
  const items = useForgeMindStore((s) => s.items)

  const itemName = (id: string) => items.find((i) => i.id === id)?.name ?? id

  const produced = Object.entries(snapshot.stats.produced)
  const consumed = Object.entries(snapshot.stats.consumed)

  // 机器利用率：累计加工时间 / 逻辑时间
  const machines = snapshot.machines
  const avgUtil =
    machines.length === 0
      ? 0
      : machines.reduce((acc, m) => acc + m.processingTime, 0) /
        machines.length /
        Math.max(snapshot.timeSec, 0.001)

  const speeds = [0.35, 0.5, 1, 2]

  return (
    <div className="flex flex-col gap-3 px-3 py-3">
      <p className="font-mono text-[10px] tracking-widest text-[var(--fm-text-dim)]">
        SIMULATION
      </p>

      {/* 时间读数 */}
      <div className="border px-2 py-1.5" style={{ borderColor: 'var(--fm-edge)' }}>
        <div className="flex items-baseline justify-between">
          <span className="font-mono text-[10px] text-[var(--fm-text-dim)]">逻辑时间</span>
          <span className="font-mono text-lg leading-none text-[var(--fm-accent)]">
            {formatTime(snapshot.timeSec)}
          </span>
        </div>
        <div className="mt-1 flex items-center justify-between border-t pt-1" style={{ borderColor: 'var(--fm-edge)' }}>
          <span className="font-mono text-[10px] text-[var(--fm-text-dim)]">在途</span>
          <span className="font-mono text-xs text-[var(--fm-text)]">{snapshot.itemLots.length}</span>
        </div>
        <div className="mt-1 flex items-center justify-between">
          <span className="font-mono text-[10px] text-[var(--fm-text-dim)]">利用率</span>
          <span className="font-mono text-xs text-[var(--fm-ok)]">
            {(avgUtil * 100).toFixed(1)}%
          </span>
        </div>
      </div>

      {/* 播放控制 */}
      <div className="flex gap-1">
        <button
          onClick={() => setPlaying(!playing)}
          className="flex-1 border px-2 py-1 text-xs"
          style={{
            borderColor: playing ? 'var(--fm-amber)' : 'var(--fm-ok)',
            color: playing ? 'var(--fm-amber)' : 'var(--fm-ok)',
          }}
        >
          {playing ? '暂停' : '启动'}
        </button>
        <button
          onClick={() => requestSimReset()}
          className="flex-1 border px-2 py-1 text-xs text-[var(--fm-text-dim)]"
          style={{ borderColor: 'var(--fm-edge)' }}
        >
          重置
        </button>
      </div>

      {/* 倍率 */}
      <div className="flex gap-1">
        {speeds.map((x) => (
          <button
            key={x}
            onClick={() => setSpeed(x)}
            className="flex-1 border px-1 py-1 font-mono text-[11px]"
            style={{
              borderColor: speed === x ? 'var(--fm-accent)' : 'var(--fm-edge)',
              color: speed === x ? 'var(--fm-accent)' : 'var(--fm-text-dim)',
              background: speed === x ? 'rgba(79,195,247,0.10)' : 'transparent',
            }}
          >
            ×{x}
          </button>
        ))}
      </div>

      {/* 产出统计 */}
      <div className="space-y-1">
        <p className="font-mono text-[10px] tracking-widest text-[var(--fm-text-dim)]">
          OUTPUT
        </p>
        {produced.length === 0 ? (
          <p className="text-xs text-[var(--fm-text-dim)]">暂无产出</p>
        ) : (
          produced.map(([id, qty]) => (
            <div key={id} className="flex items-center justify-between border px-2 py-1" style={{ borderColor: 'var(--fm-edge)' }}>
              <span className="text-xs text-[var(--fm-text)]">{itemName(id)}</span>
              <span className="font-mono text-xs text-[var(--fm-ok)]">{qty}</span>
            </div>
          ))
        )}
      </div>

      {/* 消耗统计 */}
      <div className="space-y-1">
        <p className="font-mono text-[10px] tracking-widest text-[var(--fm-text-dim)]">
          INPUT
        </p>
        {consumed.length === 0 ? (
          <p className="text-xs text-[var(--fm-text-dim)]">暂无消耗</p>
        ) : (
          consumed.map(([id, qty]) => (
            <div key={id} className="flex items-center justify-between border px-2 py-1" style={{ borderColor: 'var(--fm-edge)' }}>
              <span className="text-xs text-[var(--fm-text)]">{itemName(id)}</span>
              <span className="font-mono text-xs text-[var(--fm-amber)]">{qty}</span>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

function formatTime(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = (sec % 60).toFixed(1).padStart(4, '0')
  return `${String(m).padStart(2, '0')}:${s}`
}
