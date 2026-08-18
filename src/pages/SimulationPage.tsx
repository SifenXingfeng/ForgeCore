import { Activity, AlertTriangle, Boxes, Clock3, Gauge, Pause, Play, RotateCcw, TimerReset } from 'lucide-react'
import { MiniBars, Sparkline } from '../components/charts'
import { Donut, MetricCard, Panel, StatusBadge } from '../components/ui'
import { useForgeStore } from '../store/useForgeStore'
import type { SimulationSpeed } from '../types'

const speeds: SimulationSpeed[] = [1, 2, 5, 10]

export function SimulationPage() {
  const { simulation, metrics, metricSeries, objects, activities, playSimulation, pauseSimulation, setSimulationSpeed, resetSimulation } = useForgeStore()
  const machines = objects.filter((object) => object.kind === 'machine')
  const running = simulation.status === 'running'
  const history = metricSeries.map((sample) => sample.throughputPerMin)

  return (
    <div className="page">
      <header className="page-heading">
        <div><span className="eyebrow">DETERMINISTIC SIMULATION / OPERATIONS</span><h1>生产仿真监控</h1><p>本地模拟时钟驱动物料消耗、设备处理、输送与成品入库；刷新后可从已保存状态继续</p></div>
        <div className="page-heading__actions">
          <StatusBadge tone={running ? 'success' : 'warning'}>{running ? '仿真运行中' : simulation.status === 'paused' ? '仿真已暂停' : '等待启动'}</StatusBadge>
          <button className="button button--primary" onClick={running ? pauseSimulation : playSimulation}>{running ? <Pause size={16} /> : <Play size={16} />}{running ? '暂停' : '运行'}</button>
        </div>
      </header>

      <section className="simulation-control-strip">
        <div><Clock3 /><span>模拟时长</span><strong>{formatDuration(simulation.elapsedSimSec)}</strong></div>
        <div><Gauge /><span>时间倍率</span><span className="segmented-control">{speeds.map((speed) => <button key={speed} className={simulation.speed === speed ? 'is-active' : ''} onClick={() => setSimulationSpeed(speed)}>{speed}×</button>)}</span></div>
        <div><Activity /><span>仿真步数</span><strong>{simulation.tickCount.toLocaleString('zh-CN')}</strong></div>
        <button className="button button--secondary" onClick={resetSimulation}><RotateCcw size={15} />重置运行</button>
      </section>

      <div className="metric-grid">
        <MetricCard label="当前吞吐" value={metrics.currentThroughputPerMin.toFixed(1)} unit="件/分钟" change={`目标 ${metrics.targetThroughputPerMin.toFixed(1)}`} tone="yellow" />
        <MetricCard label="累计成品" value={metrics.totalProduced} unit="件" change="由实际完成事件累计" />
        <MetricCard label="在制品" value={metrics.workInProgress} unit="件" change={`${simulation.transitItems.length} 批正在输送`} tone="light" />
        <MetricCard label="阻塞对象" value={metrics.blockedObjectCount} unit="个" change={metrics.blockedObjectCount ? '需要检查输出容量' : '产线流动正常'} />
      </div>

      <div className="simulation-grid">
        <Panel title="实时吞吐趋势" eyebrow="THROUGHPUT / MIN" className="simulation-grid__wide" action={<StatusBadge tone="info">真实仿真序列</StatusBadge>}>
          <div className="chart-summary"><div><strong>{metrics.currentThroughputPerMin.toFixed(1)}</strong><span>件 / 分钟</span></div><span className="muted">最近 {Math.max(1, metricSeries.length)} 个采样点</span></div>
          <Sparkline values={history.length > 1 ? history : [0, metrics.currentThroughputPerMin]} color="#111111" height={154} />
        </Panel>

        <Panel title="产线健康" eyebrow="FLOW HEALTH">
          <div className="health-donuts"><Donut value={average(Object.values(metrics.machineUtilization))} label="设备利用率" /><Donut value={metrics.conveyorUtilization} label="输送占用" tone="var(--info)" /></div>
          <div className="health-row"><TimerReset size={16} /><span>平均运输</span><strong>{metrics.averageTransportSec.toFixed(1)}s</strong></div>
          <div className="health-row"><Boxes size={16} /><span>库存总量</span><strong>{metrics.inventoryTotal}</strong></div>
        </Panel>

        <Panel title="设备运行状态" eyebrow="MACHINE RUNTIME" className="simulation-grid__wide">
          <div className="machine-runtime-list">
            {machines.map((machine) => {
              const runtime = simulation.machineRuntime[machine.id]
              const utilization = metrics.machineUtilization[machine.id] ?? 0
              return <article key={machine.id}>
                <div className="machine-runtime-list__head"><div><span className={`status-light status-light--${runtime?.state ?? 'idle'}`} /><strong>{machine.name}</strong></div><StatusBadge tone={runtime?.state === 'processing' ? 'success' : runtime?.state === 'blocked' ? 'danger' : 'warning'}>{runtimeLabel(runtime?.state)}</StatusBadge></div>
                <div className="runtime-progress"><i style={{ width: `${Math.round((runtime?.progress ?? 0) * 100)}%` }} /></div>
                <div className="machine-runtime-list__meta"><span>周期进度 {Math.round((runtime?.progress ?? 0) * 100)}%</span><span>已完成 {runtime?.processedCycles ?? 0}</span><span>利用率 {Math.round(utilization)}%</span></div>
              </article>
            })}
          </div>
          <MiniBars values={machines.map((machine) => metrics.machineUtilization[machine.id] ?? 0)} labels={machines.map((machine) => machine.name)} />
        </Panel>

        <Panel title="最近生产事件" eyebrow="TRACEABLE EVENTS">
          <ol className="activity-list activity-list--dense">
            {activities.slice(0, 7).map((event) => <li key={event.id}><span className={`activity-list__icon activity-list__icon--${event.tone}`}><Activity size={13} /></span><div><strong>{event.title}</strong><small>{formatDuration(event.elapsedSimSec)} · {event.description}</small></div></li>)}
          </ol>
          {!activities.length && <div className="signal-card"><AlertTriangle size={18} /><div><strong>尚无运行事件</strong><p>启动仿真后，这里会显示真实的处理与运输记录</p></div></div>}
        </Panel>
      </div>
    </div>
  )
}

function average(values: number[]) { return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0 }
function runtimeLabel(state?: string) { return ({ processing: '处理中', 'waiting-input': '等待输入', blocked: '输出阻塞', idle: '空闲' } as Record<string, string>)[state ?? 'idle'] ?? '空闲' }
function formatDuration(seconds: number) { const h = Math.floor(seconds / 3600); const m = Math.floor((seconds % 3600) / 60); const s = Math.floor(seconds % 60); return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` }
