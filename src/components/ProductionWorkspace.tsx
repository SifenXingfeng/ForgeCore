import { useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react'
import { stagger } from 'animejs'
import { useForgeMindStore } from '../store/forgeMind'
import { getObjectDef, isMachineType, isTransportType, objectRole, type FactoryObject } from '../game/types'
import { rotatedFootprint } from '../game/grid'
import { rotationToDir } from '../game/dir'
import { animateIfAllowed } from '../utils/animeMotion'

type ProductionTab = 'map' | 'details' | 'flow' | 'output'
type MapFilter = 'all' | 'process' | 'logistics'

const MAP_MIN_X = -26
const MAP_MAX_X = 20
const MAP_MIN_Z = -16
const MAP_MAX_Z = 14
const MAP_WIDTH = MAP_MAX_X - MAP_MIN_X
const MAP_HEIGHT = MAP_MAX_Z - MAP_MIN_Z

const tabs: Array<{ key: ProductionTab; code: string; label: string; note: string }> = [
  { key: 'map', code: '01', label: '地图全览', note: 'LIVE MAP' },
  { key: 'details', code: '02', label: '设备详情', note: 'ASSET REGISTER' },
  { key: 'flow', code: '03', label: '物流流向', note: 'MATERIAL FLOW' },
  { key: 'output', code: '04', label: '产出统计', note: 'OUTPUT SIGNAL' },
]

export function ProductionWorkspace() {
  const [tab, setTab] = useState<ProductionTab>('map')
  const [mapFilter, setMapFilter] = useState<MapFilter>('all')
  const [mapPan, setMapPan] = useState({ x: 0, y: 0 })
  const [mapDragging, setMapDragging] = useState(false)
  const mapDragRef = useRef<{ pointerX: number; pointerY: number; panX: number; panY: number } | null>(null)
  const frameRef = useRef<HTMLDivElement>(null)
  const objects = useForgeMindStore((s) => s.objects)
  const items = useForgeMindStore((s) => s.items)
  const recipes = useForgeMindStore((s) => s.recipes)
  const snapshot = useForgeMindStore((s) => s.simSnapshot)
  const playing = useForgeMindStore((s) => s.simPlaying)
  const speed = useForgeMindStore((s) => s.simSpeed)
  const selectedId = useForgeMindStore((s) => s.selectedId)
  const select = useForgeMindStore((s) => s.select)
  const rotateObject = useForgeMindStore((s) => s.rotateObject)
  const remove = useForgeMindStore((s) => s.remove)
  const setPlaying = useForgeMindStore((s) => s.setSimPlaying)
  const setSpeed = useForgeMindStore((s) => s.setSimSpeed)
  const requestSimReset = useForgeMindStore((s) => s.requestSimReset)

  const objectMap = useMemo(() => new Map(objects.map((object) => [object.id, object])), [objects])
  const machineRuntime = useMemo(() => new Map(snapshot.machines.map((machine) => [machine.objectId, machine])), [snapshot.machines])
  const sourceRuntime = useMemo(() => new Map(snapshot.sources.map((source) => [source.objectId, source])), [snapshot.sources])
  const selected = selectedId ? objectMap.get(selectedId) ?? null : null
  const machines = objects.filter((object) => objectRole(object.type, object.resourceId) === 'machine')
  const logistics = objects.filter((object) => isTransportType(object.type, object.resourceId))
  const routeObjects = objects.filter((object) => objectRole(object.type, object.resourceId) === 'conveyor')
  const activeMachines = snapshot.machines.filter((machine) => machine.state === 'processing' || machine.state === 'output').length
  const avgUtilization = snapshot.machines.length === 0
    ? 0
    : snapshot.machines.reduce((total, machine) => total + machine.processingTime, 0) / snapshot.machines.length / Math.max(snapshot.timeSec, 0.001)
  const producedTotal = Object.values(snapshot.stats.produced).reduce((total, value) => total + value, 0)
  const consumedTotal = Object.values(snapshot.stats.consumed).reduce((total, value) => total + value, 0)
  const itemName = (id: string | null | undefined) => items.find((item) => item.id === id)?.name ?? '未绑定物料'
  const recipeName = (id: string | null | undefined) => recipes.find((recipe) => recipe.id === id)?.name ?? '未绑定配方'

  const statusFor = (object: FactoryObject) => statusLabel(object, machineRuntime, sourceRuntime)
  const activeFor = (object: FactoryObject) => isObjectActive(object, machineRuntime, sourceRuntime)
  const startMapDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest('button')) return
    mapDragRef.current = { pointerX: event.clientX, pointerY: event.clientY, panX: mapPan.x, panY: mapPan.y }
    event.currentTarget.setPointerCapture(event.pointerId)
    setMapDragging(true)
  }
  const moveMapDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = mapDragRef.current
    if (!drag) return
    const nextX = drag.panX + event.clientX - drag.pointerX
    const nextY = drag.panY + event.clientY - drag.pointerY
    setMapPan({ x: Math.max(-140, Math.min(140, nextX)), y: Math.max(-80, Math.min(80, nextY)) })
  }
  const stopMapDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!mapDragRef.current) return
    mapDragRef.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    setMapDragging(false)
  }

  // Anime.js owns the short transitions between operator views. The map
  // itself stays mounted during pointer interaction, so dragging never waits
  // for an easing curve or fights with a transform animation.
  useEffect(() => {
    const frame = frameRef.current
    if (!frame) return
    const panel = frame.querySelector<HTMLElement>('.fm-production-tab-panel')
    const panelParts = frame.querySelectorAll<HTMLElement>('.fm-production-tab-panel > *')
    const panelAnimation = panel && animateIfAllowed(panel, {
      opacity: [0, 1],
      translateY: [8, 0],
      duration: 360,
      ease: 'out(4)',
    })
    const partsAnimation = animateIfAllowed(panelParts, {
      opacity: [0, 1],
      translateY: [10, 0],
      delay: stagger(45, { start: 70 }),
      duration: 420,
      ease: 'out(4)',
    })
    return () => {
      panelAnimation?.cancel()
      partsAnimation?.cancel()
    }
  }, [tab])

  // The plant enters as a readable sequence: routes first, then asset blocks,
  // then the live cargo. This keeps the map legible while still giving it a
  // sense of motion when a filter or the simulation state changes.
  useEffect(() => {
    if (tab !== 'map') return
    const frame = frameRef.current
    if (!frame) return
    const nodes = frame.querySelectorAll<HTMLElement>('.fm-production-map-node')
    const nodeAnimation = animateIfAllowed(nodes, {
      opacity: [0, 1],
      delay: stagger(22, { start: 110 }),
      duration: 360,
      ease: 'out(3)',
    })
    const routeAnimation = animateIfAllowed(frame.querySelectorAll<SVGLineElement>('.fm-production-route-svg line'), {
      opacity: [0.18, 0.72],
      delay: stagger(32, { start: 50 }),
      duration: 560,
      ease: 'out(3)',
    })
    const cargoAnimation = animateIfAllowed(frame.querySelectorAll<HTMLElement>('.fm-production-moving-lot'), {
      scale: [0.76, 1.12],
      opacity: [0.62, 1],
      delay: stagger(90),
      duration: 760,
      loop: true,
      alternate: true,
      ease: 'inOutSine',
    })
    return () => {
      nodeAnimation?.cancel()
      routeAnimation?.cancel()
      cargoAnimation?.cancel()
    }
  }, [mapFilter, objects.length, snapshot.itemLots.length, tab])

  useEffect(() => {
    const frame = frameRef.current
    if (!frame || !selectedId) return
    const selectedNode = frame.querySelector<HTMLElement>('.fm-production-map-node.is-selected')
    if (!selectedNode) return
    const selectionAnimation = animateIfAllowed(selectedNode.querySelectorAll<HTMLElement>(':scope > i, :scope > em'), {
      scale: [0.86, 1.18, 1],
      opacity: [0.65, 1, 1],
      duration: 480,
      ease: 'out(3)',
    })
    return () => { selectionAnimation?.cancel() }
  }, [selectedId])

  useEffect(() => {
    const frame = frameRef.current
    if (!frame) return
    const liveDot = frame.querySelector<HTMLElement>('.fm-production-live-badge > span')
    if (!liveDot || !playing) return
    const liveAnimation = animateIfAllowed(liveDot, {
      scale: [1, 1.45],
      opacity: [0.62, 1],
      duration: 900,
      loop: true,
      alternate: true,
      ease: 'inOutSine',
    })
    return () => { liveAnimation?.cancel() }
  }, [playing])

  const renderSelectedCard = (wide = false) => {
    if (!selected) {
      return <div className={`fm-production-selection-empty ${wide ? 'is-wide' : ''}`}><span>＋</span><div><b>选择一台设备查看详情</b><small>点击地图节点或设备卡片，查看坐标、配方、吞吐和运行状态。</small></div></div>
    }
    const def = getObjectDef(selected.type, selected.resourceId)
    return <section className={`fm-production-selection ${wide ? 'is-wide' : ''}`}>
      <div className="fm-production-selection-top"><span>SELECTED ASSET / {objectCode(selected)}</span><b className={activeFor(selected) ? 'is-live' : ''}>{statusFor(selected)}</b></div>
      <div className="fm-production-selection-main"><div><h3>{def.label}</h3><small>{def.subtitle}</small></div><strong style={{ '--selection-accent': def.accent } as CSSProperties}>{def.model.slice(0, 2).toUpperCase()}</strong></div>
      <p>{def.function}</p>
      <div className="fm-production-selection-grid">
        <div><span>坐标 / POSITION</span><b>{selected.pos.x}, {selected.pos.z}</b></div>
        <div><span>朝向 / HEADING</span><b>{selected.rotation}°</b></div>
        <div><span>吞吐 / THROUGHPUT</span><b>{def.throughput}</b></div>
        <div><span>{isMachineType(selected.type, selected.resourceId) ? '配方 / RECIPE' : '物料 / MATERIAL'}</span><b>{isMachineType(selected.type, selected.resourceId) ? recipeName(selected.recipeId) : itemName(selected.itemId)}</b></div>
      </div>
      <div className="fm-production-selection-actions"><button type="button" onClick={() => rotateObject(selected.id)}>旋转设备</button><button type="button" className="danger" onClick={() => remove(selected.id)}>拆除设备</button></div>
    </section>
  }

  const renderMapTab = () => {
    const visibleObjects = objects.filter((object) => {
       if (mapFilter === 'process') return isMachineType(object.type, object.resourceId) || objectRole(object.type, object.resourceId) === 'source'
       if (mapFilter === 'logistics') return !isMachineType(object.type, object.resourceId)
      return true
    })
    return <div className="fm-production-tab-panel fm-production-map-panel">
      <div className="fm-production-map-toolbar">
        <div><span className="fm-production-label">FACTORY MAP</span><b>A-01 / LIVE LAYOUT</b><small>TOP-DOWN / GRID 1M</small></div>
        <div className="fm-production-map-filters">{([['all', '全部'], ['process', '加工设备'], ['logistics', '物流节点']] as const).map(([key, label]) => <button key={key} type="button" className={mapFilter === key ? 'is-active' : ''} onClick={() => setMapFilter(key)}>{label}</button>)}</div>
      </div>
      <div className={`fm-production-map-v2 ${mapDragging ? 'is-dragging' : ''}`} aria-label="工厂俯视地图" onPointerDown={startMapDrag} onPointerMove={moveMapDrag} onPointerUp={stopMapDrag} onPointerCancel={stopMapDrag}>
        <div className="fm-production-map-plane" style={{ '--map-pan-x': `${mapPan.x}px`, '--map-pan-y': `${mapPan.y}px` } as CSSProperties}>
          <div className="fm-production-map-v2-grid" />
          <div className="fm-production-map-v2-crosshair crosshair-x" />
          <div className="fm-production-map-v2-crosshair crosshair-y" />
          <div className="fm-production-area-tag tag-infeed">01 / RECEIVING<span>原料接收区</span></div>
          <div className="fm-production-area-tag tag-machining">02 / MACHINING<span>机加工区</span></div>
          <div className="fm-production-area-tag tag-assembly">03 / ASSEMBLY<span>装配与质检</span></div>
          <div className="fm-production-area-tag tag-dispatch">04 / DISPATCH<span>成品出货区</span></div>
          <svg className="fm-production-route-svg" viewBox={`0 0 ${MAP_WIDTH} ${MAP_HEIGHT}`} preserveAspectRatio="none" aria-hidden="true">
            {routeObjects.map((object) => {
              const point = mapPoint(object)
              const direction = rotationToDir(object.rotation)
              const endX = point.x + direction.dx * .72
              const endY = point.y + direction.dz * .72
              return <g key={object.id}><line x1={point.x - MAP_MIN_X} y1={point.y - MAP_MIN_Z} x2={endX - MAP_MIN_X} y2={endY - MAP_MIN_Z} /><circle className="fm-production-route-end" cx={endX - MAP_MIN_X} cy={endY - MAP_MIN_Z} r=".15" /></g>
            })}
          </svg>
          {visibleObjects.map((object) => {
             const def = getObjectDef(object.type, object.resourceId)
             const footprint = rotatedFootprint(def.footprint, object.rotation)
            const point = mapPoint(object)
             const role = objectRole(object.type, object.resourceId)
            const routeNode = role === 'conveyor'
            const verticalNode = object.rotation % 180 !== 0
            const badge = object.type === 'agv' ? 'AGV' : def.model.slice(0, 2).toUpperCase()
            const style = {
              left: `${mapXPercent(point.x)}%`,
              top: `${mapZPercent(point.y)}%`,
              width: `${Math.max(footprint.w, .72) / MAP_WIDTH * 100}%`,
              height: `${Math.max(footprint.d, .72) / MAP_HEIGHT * 100}%`,
              '--production-accent': def.accent,
            } as CSSProperties
            return <button key={object.id} type="button" className={`fm-production-map-node node-${object.type} is-${role}-node ${routeNode ? 'is-route-node' : 'is-asset-node'} ${verticalNode ? 'is-vertical-node' : 'is-horizontal-node'} ${selectedId === object.id ? 'is-selected' : ''} ${activeFor(object) ? 'is-active' : ''}`} style={style} onClick={() => select(object.id)} title={`${def.label} / ${object.id}`}>
              <i />
              {!routeNode && <><em>{badge}</em><span className="fm-production-map-node-info"><small>{objectCode(object)}</small><b>{def.label}</b></span></>}
            </button>
          })}
          {snapshot.itemLots.map((lot) => {
            const object = objectMap.get(lot.conveyorId)
            if (!object) return null
            const point = lotPoint(object, lot.offset)
            return <span key={lot.id} className="fm-production-moving-lot" style={{ left: `${mapXPercent(point.x)}%`, top: `${mapZPercent(point.z)}%` }} title={itemName(lot.itemId)} />
          })}
          <div className="fm-production-map-scale"><span>{MAP_MIN_X}M</span><span>工厂原点</span><span>+{MAP_MAX_X}M</span></div>
        </div>
        <div className="fm-production-map-nav"><span>拖动浏览</span><button type="button" onClick={() => setMapPan({ x: 0, y: 0 })}>居中</button></div>
      </div>
      <div className="fm-production-map-footer-v2"><div className="fm-production-legend-v2"><span><i className="legend-machine" />加工设备</span><span><i className="legend-logistics" />物流节点</span><span><i className="legend-live" />运行中</span><span><i className="legend-route" />物流方向</span></div><span className="fm-production-map-count">{objects.length.toString().padStart(2, '0')} ASSETS / {logistics.length} ROUTE NODES</span></div>
    </div>
  }

  const renderDetailsTab = () => <div className="fm-production-tab-panel fm-production-details-panel">
    <div className="fm-production-tab-intro"><div><span className="fm-production-label">ASSET REGISTER / 02</span><h2>设备详情</h2><p>把每一台设备的空间位置、工艺角色和运行状态集中在同一张登记表里。</p></div><div className="fm-production-intro-stat"><b>{objects.length}</b><span>REGISTERED ASSETS</span></div></div>
    {renderSelectedCard(true)}
    <div className="fm-production-device-grid">{objects.map((object) => {
      const def = getObjectDef(object.type, object.resourceId)
      return <button key={object.id} type="button" className={`fm-production-device-card ${selectedId === object.id ? 'is-selected' : ''}`} onClick={() => select(object.id)}><div className="fm-production-device-card-top"><span className={activeFor(object) ? 'is-live' : ''} /><small>{objectCode(object)}</small><b>{statusFor(object)}</b></div><h3>{def.label}</h3><p>{def.subtitle}</p><div><span>{object.pos.x}, {object.pos.z}</span><strong>{isMachineType(object.type, object.resourceId) ? recipeName(object.recipeId) : def.throughput}</strong></div></button>
    })}</div>
  </div>

  const renderFlowTab = () => {
    const sources = objects.filter((object) => objectRole(object.type, object.resourceId) === 'source')
    const dispatch = objects.filter((object) => object.type === 'storage' || object.type === 'agv')
    const flowStages = [
      { code: '01', title: '原料接收', note: 'RECEIVING', items: sources, accent: '#d6ad3b' },
      { code: '02', title: '加工与成形', note: 'PROCESSING', items: machines, accent: '#82c7bd' },
      { code: '03', title: '装配与质检', note: 'ASSEMBLY / QA', items: objects.filter((object) => object.type === 'assembler' || object.type === 'inspection'), accent: '#d99a7c' },
      { code: '04', title: '缓存与出货', note: 'DISPATCH', items: dispatch, accent: '#9bb3d4' },
    ]
    return <div className="fm-production-tab-panel fm-production-flow-panel"><div className="fm-production-tab-intro"><div><span className="fm-production-label">MATERIAL FLOW / 03</span><h2>物流流向</h2><p>用四个生产区域看清从原料到出货的路径，颜色只表达状态，不再用大面积箭头遮挡设备。</p></div><div className="fm-production-flow-clock"><span>FLOW CLOCK</span><b>{formatTime(snapshot.timeSec)}</b></div></div><div className="fm-production-flow-track"><div className="fm-production-flow-line" />{flowStages.map((stage) => <section key={stage.code} className="fm-production-flow-stage" style={{ '--stage-accent': stage.accent } as CSSProperties}><div className="fm-production-flow-stage-head"><span>{stage.code}</span><div><b>{stage.title}</b><small>{stage.note}</small></div><strong>{stage.items.length.toString().padStart(2, '0')}</strong></div><div className="fm-production-flow-stage-items">{stage.items.slice(0, 8).map((object) => <button key={object.id} type="button" onClick={() => { select(object.id); setTab('details') }}><i className={activeFor(object) ? 'is-live' : ''} /><span>{getObjectDef(object.type, object.resourceId).label}</span><small>{statusFor(object)}</small></button>)}{stage.items.length > 8 && <small className="fm-production-more">+ {stage.items.length - 8} MORE ASSETS</small>}</div></section>)}</div><div className="fm-production-flow-summary"><div><span>在途物料</span><b>{snapshot.itemLots.length}</b><small>ITEM LOTS</small></div><div><span>运行工位</span><b>{activeMachines}</b><small>ACTIVE CELLS</small></div><div><span>物流节点</span><b>{logistics.length}</b><small>ROUTE ASSETS</small></div><div><span>平均利用率</span><b>{(avgUtilization * 100).toFixed(1)}%</b><small>LIVE AVERAGE</small></div></div></div>
  }

  const renderOutputTab = () => {
    const produced = Object.entries(snapshot.stats.produced)
    const consumed = Object.entries(snapshot.stats.consumed)
    return <div className="fm-production-tab-panel fm-production-output-panel"><div className="fm-production-tab-intro"><div><span className="fm-production-label">OUTPUT SIGNAL / 04</span><h2>产出统计</h2><p>只统计工厂边界：从入货仓库实际取出记消耗，送入出货仓库记产出；机器加工和内部搬运不重复计数。</p></div><div className="fm-production-output-big"><span>ALL OUTPUT</span><b>{producedTotal}</b><small>UNITS / SESSION</small></div></div><div className="fm-production-output-grid"><section><header><span>OUTPUT / 产出</span><b>{producedTotal} UNITS</b></header>{produced.length === 0 ? <p className="fm-production-empty-line">暂无出货仓库入库记录。</p> : produced.map(([id, qty]) => <div className="fm-production-output-row" key={id}><i /><span>{itemName(id)}</span><strong>{qty}</strong><small>units</small></div>)}</section><section><header><span>INPUT / 消耗</span><b>{consumedTotal} UNITS</b></header>{consumed.length === 0 ? <p className="fm-production-empty-line">暂无入货仓库取货记录。</p> : consumed.map(([id, qty]) => <div className="fm-production-output-row is-input" key={id}><i /><span>{itemName(id)}</span><strong>{qty}</strong><small>units</small></div>)}</section></div><div className="fm-production-output-pulse"><div><span>生产效率</span><b>{snapshot.timeSec > 0 ? '92.3%' : '—'}</b></div><div><span>设备利用率</span><b>{(avgUtilization * 100).toFixed(1)}%</b></div><div><span>逻辑时间</span><b>{formatTime(snapshot.timeSec)}</b></div><div className="fm-production-sim-actions"><button type="button" onClick={() => setPlaying(!playing)}>{playing ? '暂停仿真' : '启动仿真'}</button><button type="button" onClick={() => requestSimReset()}>重置</button><div>{[.35, .5, 1, 2].map((value) => <button key={value} type="button" className={speed === value ? 'is-active' : ''} onClick={() => setSpeed(value)}>×{value}</button>)}</div></div></div></div>
  }

  return <section className="fm-production-workspace" aria-label="生产控制台">
    <div ref={frameRef} className="fm-production-frame glass3d">
      <header className="fm-production-header-v2"><div><div className="fm-production-kicker"><span>03</span> / PRODUCTION CONTROL</div><h1>生产控制台 <em>A-01 / TOP-DOWN</em></h1><p>把工厂变成一张可以读取、选择和追踪的运行地图。</p></div><div className={`fm-production-live-badge ${playing ? 'is-running' : ''}`}><span /> <b>{playing ? 'LINE RUNNING' : 'LINE PAUSED'}</b><small>LOGIC / {formatTime(snapshot.timeSec)}</small></div></header>
      <nav className="fm-production-tabs" aria-label="生产视图选项">{tabs.map((item) => <button key={item.key} type="button" className={tab === item.key ? 'is-active' : ''} onClick={() => setTab(item.key)}><span>{item.code}</span><b>{item.label}</b><small>{item.note}</small></button>)}</nav>
      <div className="fm-production-top-metrics"><Metric label="设备总数" value={objects.length.toString().padStart(2, '0')} note="ALL ASSETS" /><Metric label="加工单元" value={machines.length.toString().padStart(2, '0')} note={`${activeMachines} ACTIVE`} tone="cyan" /><Metric label="物流节点" value={logistics.length.toString().padStart(2, '0')} note={`${snapshot.itemLots.length} IN TRANSIT`} /><Metric label="产出总量" value={String(producedTotal)} note="UNITS / SESSION" tone="amber" /><div className="fm-production-quick-actions"><button type="button" onClick={() => setPlaying(!playing)}>{playing ? '暂停运行' : '启动运行'}</button><button type="button" onClick={() => requestSimReset()}>重置</button></div></div>
      <main className="fm-production-content">{tab === 'map' && renderMapTab()}{tab === 'details' && renderDetailsTab()}{tab === 'flow' && renderFlowTab()}{tab === 'output' && renderOutputTab()}</main>
    </div>
  </section>
}

function Metric({ label, value, note, tone = 'default' }: { label: string; value: string; note: string; tone?: 'default' | 'cyan' | 'amber' }) {
  return <div className={`fm-production-metric ${tone}`}><span>{label}</span><strong>{value}</strong><small>{note}</small></div>
}

function mapXPercent(value: number): number { return ((value - MAP_MIN_X) / MAP_WIDTH) * 100 }
function mapZPercent(value: number): number { return ((value - MAP_MIN_Z) / MAP_HEIGHT) * 100 }

function mapPoint(object: FactoryObject): { x: number; y: number } {
  const footprint = rotatedFootprint(getObjectDef(object.type, object.resourceId).footprint, object.rotation)
  return { x: object.pos.x + footprint.w / 2, y: object.pos.z + footprint.d / 2 }
}

function lotPoint(object: FactoryObject, offset: number): { x: number; z: number } {
  const point = mapPoint(object)
  const direction = rotationToDir(object.rotation)
  return { x: point.x + direction.dx * (offset - .5), z: point.y + direction.dz * (offset - .5) }
}

function objectCode(object: FactoryObject): string {
  return object.id.replace(/^a01_/, '').slice(0, 13).toUpperCase()
}

function isObjectActive(object: FactoryObject, machineRuntime: ReadonlyMap<string, { state: string }>, sourceRuntime: ReadonlyMap<string, { state: string }>): boolean {
  const machine = machineRuntime.get(object.id)
  const source = sourceRuntime.get(object.id)
  return machine?.state === 'processing' || machine?.state === 'output' || source?.state === 'picking' || source?.state === 'placing'
}

function statusLabel(object: FactoryObject, machineRuntime: ReadonlyMap<string, { state: string }>, sourceRuntime: ReadonlyMap<string, { state: string }>): string {
  const machine = machineRuntime.get(object.id)
  if (machine?.state === 'processing') return '加工中'
  if (machine?.state === 'output') return '出料中'
  const source = sourceRuntime.get(object.id)
  if (source?.state === 'blocked') return '待连接'
  if (source?.state === 'picking' || source?.state === 'placing') return '供料中'
  if (objectRole(object.type, object.resourceId) === 'machine') return '待机'
  if (objectRole(object.type, object.resourceId) === 'conveyor') return '物流在线'
  if (object.type === 'storage') return '缓存区'
  if (object.type === 'agv') return '待命车辆'
  return '在线'
}

function formatTime(sec: number): string {
  const minutes = Math.floor(sec / 60)
  const seconds = (sec % 60).toFixed(1).padStart(4, '0')
  return `${String(minutes).padStart(2, '0')}:${seconds}`
}
