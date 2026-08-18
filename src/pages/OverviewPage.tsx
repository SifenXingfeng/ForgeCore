import { Activity, AlertTriangle, ArrowRight, Boxes, Cpu, Factory, Gauge, PackageCheck, Play, Truck } from 'lucide-react'
import { useForgeStore } from '../store/useForgeStore'
import { MetricCard, Panel, StatusBadge, Donut } from '../components/ui'
import { MiniBars, Sparkline } from '../components/charts'
import type { AppPage } from '../components/Sidebar'

export function OverviewPage({ onNavigate }: { onNavigate: (page: AppPage) => void }) {
  const { factory, metrics, objects, simulation, metricSeries, activities, playSimulation, pauseSimulation } = useForgeStore()
  const machines = objects.filter((object) => object.kind === 'machine')
  const running = simulation.status === 'running'
  const averageUtilization = average(Object.values(metrics.machineUtilization))
  const history = metricSeries.map((sample) => sample.throughputPerMin)
  const bottleneck = deriveBottleneck(metrics.blockedObjectCount, machines)
  const hasConfiguredProduction = machines.length > 0 && Object.keys(simulation.machineRuntime).length > 0
  return (
    <div className="page page--overview">
      <header className="page-heading">
        <div>
          <span className="eyebrow">FACTORY OPERATIONS / LIVE OVERVIEW</span>
          <h1>{factory.name}</h1>
          <p>从布局、生产到库存的统一运行视图。所有初版指标均来自本地确定性仿真。</p>
        </div>
        <div className="page-heading__actions">
          <StatusBadge tone={running ? 'success' : hasConfiguredProduction ? 'warning' : 'neutral'}>{running ? `仿真运行中 · ${simulation.speed}×` : hasConfiguredProduction ? '仿真已暂停' : '等待配置生产链'}</StatusBadge>
          <button className="button button--primary" disabled={!hasConfiguredProduction} onClick={running ? pauseSimulation : playSimulation}><Play size={16} />{running ? '暂停仿真' : '启动仿真'}</button>
        </div>
      </header>

      <div className="metric-grid">
        <MetricCard label="累计成品" value={metrics.totalProduced} unit="件" change="由完成事件逐件累计" tone="yellow" />
        <MetricCard label="当前生产速率" value={metrics.currentThroughputPerMin.toFixed(1)} unit="件/分钟" change="由模拟时钟计算" />
        <MetricCard label="在制品 WIP" value={metrics.workInProgress} unit="件" change={`${metrics.queueDepth} 批排队或输送`} tone="light" />
        <MetricCard label="设备平均利用率" value={Math.round(averageUtilization)} unit="%" change={`${machines.filter((m) => m.status === 'running').length}/${machines.length} 台运行`} />
      </div>

      <div className="overview-grid">
        <Panel title="产线实时节奏" eyebrow="PRODUCTION PULSE" className="overview-grid__wide" action={<button className="text-button" onClick={() => onNavigate('simulation')}>查看监控 <ArrowRight size={14} /></button>}>
          <div className="chart-summary">
            <div><strong>{metrics.currentThroughputPerMin.toFixed(1)}</strong><span>件 / 分钟</span></div>
            <StatusBadge tone="success">数据已接入</StatusBadge>
          </div>
          <Sparkline values={history.length > 1 ? history : [0, metrics.currentThroughputPerMin]} color="#111111" height={112} />
          <div className="chart-axis"><span>-12 min</span><span>-8 min</span><span>-4 min</span><span>现在</span></div>
        </Panel>

        <Panel title="运行健康度" eyebrow="SYSTEM HEALTH">
          <div className="health-donuts">
            <Donut value={averageUtilization} label="利用率" />
            <Donut value={Math.max(0, 100 - metrics.blockedObjectCount * 20)} label="流动性" tone="var(--info)" />
          </div>
          <div className="health-row"><Activity size={16} /><span>模拟时长</span><strong>{formatTime(simulation.elapsedSimSec)}</strong></div>
          <div className="health-row"><Gauge size={16} /><span>时间倍率</span><strong>{simulation.speed}×</strong></div>
        </Panel>

        <Panel title="关键瓶颈" eyebrow="BOTTLENECK SIGNAL">
          <div className={`signal-card signal-card--${bottleneck.severity}`}>
            <AlertTriangle size={20} />
            <div><strong>{bottleneck.title}</strong><p>{bottleneck.description}</p></div>
          </div>
          <button className="button button--secondary button--full" onClick={() => onNavigate('simulation')}>定位并查看证据</button>
        </Panel>

        <Panel title="设备负载" eyebrow="MACHINE UTILIZATION" className="overview-grid__wide">
          {machines.length ? <MiniBars values={machines.map((machine) => metrics.machineUtilization[machine.id] ?? 0)} labels={machines.map((machine) => machine.name.replace('工位', ''))} /> : <div className="empty-state"><Cpu className="empty-state__icon" /><h3>还没有机器</h3><p>从工厂编辑器放置通用机器，再自行命名并绑定配方。</p></div>}
          <div className="legend-row"><span><i className="legend-dot legend-dot--green" />运行</span><span><i className="legend-dot legend-dot--yellow" />等待</span><span><i className="legend-dot" />离线</span></div>
        </Panel>

        <Panel title="工厂资源" eyebrow="FACTORY CONTENT">
          <div className="resource-list">
            <button onClick={() => onNavigate('editor')}><Factory /><span><strong>{objects.length}</strong>场景对象</span><ArrowRight /></button>
            <button onClick={() => onNavigate('items')}><Boxes /><span><strong>36</strong>默认模型</span><ArrowRight /></button>
            <button onClick={() => onNavigate('logistics')}><Truck /><span><strong>2</strong>物流资产原件</span><ArrowRight /></button>
          </div>
        </Panel>

        <Panel title="最近事件" eyebrow="ACTIVITY LOG">
          <ol className="activity-list">
            {activities.slice(0, 5).map((event) => <li key={event.id}><span className={`activity-list__icon activity-list__icon--${event.tone}`}><Cpu size={14} /></span><div><strong>{event.title}</strong><small>{formatTime(event.elapsedSimSec)} · {event.description}</small></div></li>)}
            {!activities.length && <li><span className="activity-list__icon"><Activity size={14} /></span><div><strong>等待第一条运行事件</strong><small>配置生产链并启动仿真后，事件会出现在这里。</small></div></li>}
          </ol>
        </Panel>
      </div>

      <section className="quick-start">
        <div><span className="eyebrow">EMPTY FACTORY WORKFLOW</span><h2>从空白工厂开始</h2><p>ForgeCore 不再替你假设设备和产品。先定义物品与配方，再放置并命名机器，最后铺设传送带。</p></div>
        <div className="process-strip">
          <span><PackageCheck />创建物品</span><ArrowRight /><span><Cpu />设计配方</span><ArrowRight /><span><Factory />放置机器</span><ArrowRight /><span><Boxes />铺设传送带</span>
        </div>
        <button className="button button--dark" onClick={() => onNavigate('editor')}>进入工厂编辑器 <ArrowRight size={16} /></button>
      </section>
    </div>
  )
}

function average(values: number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0
}

function deriveBottleneck(blockedObjectCount: number, machines: ReturnType<typeof useForgeStore.getState>['objects']) {
  if (!machines.length) return { severity: 'success', title: '等待工厂配置', description: '当前是空白项目，放置并配置机器后再分析瓶颈。' }
  const blocked = machines.find((machine) => machine.status === 'blocked')
  if (blockedObjectCount > 0 || blocked) return { severity: 'warning', title: `${blocked?.name ?? '产线'}发生阻塞`, description: '输出容量已达到上限，请检查下游输送或成品区。' }
  return { severity: 'success', title: '当前没有阻塞信号', description: '产线输入、处理和输出仍保持连通。' }
}

function formatTime(seconds: number) {
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const rest = Math.floor(seconds % 60)
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`
}
