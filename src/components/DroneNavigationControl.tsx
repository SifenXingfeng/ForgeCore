import { useEffect, useMemo, useState } from 'react'
import type { AgvProgram, FactoryObject } from '../game/types'
import { canReceiveVehicle, canSupplyVehicle, getFactoryObjectDisplayName, getObjectDef, isStorageFacilityType } from '../game/types'
import { dronePathLength } from '../game/dronePathfinding'
import { useForgeMindStore } from '../store/forgeMind'

const EMPTY_PROGRAM: AgvProgram = {
  enabled: false,
  sourceObjectId: null,
  destinationObjectId: null,
  itemId: null,
  loadQuantity: 3,
  priority: 0,
  policy: 'shortest',
  dispatchMode: 'continuous',
  sourceMinQuantity: 3,
  destinationMaxQuantity: 100,
}

function floorOf(object: FactoryObject | undefined) {
  return object?.floorId ?? 1
}

function programFor(drone: FactoryObject | undefined): AgvProgram {
  return {
    ...EMPTY_PROGRAM,
    ...drone?.agvProgram,
  }
}

function objectLabel(object: FactoryObject) {
  return `L${floorOf(object)} · ${getFactoryObjectDisplayName(object)}${object.displayName ? ` · ${getObjectDef(object.type, object.resourceId).label}` : ''} · ${object.id.replace(/^a01_/, '')}`
}

function phaseLabel(phase: string | undefined) {
  if (phase === 'to-source') return '前往跨层起点'
  if (phase === 'to-destination') return '前往跨层终点'
  if (phase === 'returning') return '返航'
  return '待命'
}

export function DroneNavigationControl() {
  const objects = useForgeMindStore((state) => state.objects)
  const items = useForgeMindStore((state) => state.items)
  const snapshot = useForgeMindStore((state) => state.simSnapshot)
  const setTransportProgram = useForgeMindStore((state) => state.setAgvProgram)
  const drones = useMemo(() => objects.filter((object) => object.type === 'drone'), [objects])
  const storage = useMemo(() => objects.filter((object) => isStorageFacilityType(object.type)), [objects])
  const sources = useMemo(() => storage.filter((object) => canSupplyVehicle(object.type)), [storage])
  const destinations = useMemo(() => storage.filter((object) => canReceiveVehicle(object.type)), [storage])
  const [selectedId, setSelectedId] = useState(drones[0]?.id ?? '')
  const selected = drones.find((drone) => drone.id === selectedId) ?? drones[0]
  const [draft, setDraft] = useState<AgvProgram>(() => programFor(selected))
  const runtime = snapshot.drones.find((drone) => drone.objectId === selected?.id)
  const source = storage.find((object) => object.id === draft.sourceObjectId)
  const destination = storage.find((object) => object.id === draft.destinationObjectId)
  const selectedItem = items.find((item) => item.id === draft.itemId)

  useEffect(() => {
    if (!drones.some((drone) => drone.id === selectedId)) setSelectedId(drones[0]?.id ?? '')
  }, [drones, selectedId])

  useEffect(() => {
    setDraft(programFor(selected))
  }, [items, selected, selected?.agvProgram, selectedId, storage])

  const applyProgram = (enabled: boolean) => {
    if (!selected) return
    const next = { ...draft, enabled, route: undefined }
    setTransportProgram(selected.id, next)
    setDraft(next)
  }

  const crossFloor = source && destination && floorOf(source) !== floorOf(destination)
  const liveDistance = runtime ? dronePathLength(runtime.path) : 0

  return (
    <section className="fm-drone-control" aria-label="无人机三维运输控制">
      <div className="fm-drone-control-heading">
        <div>
          <span className="fm-production-label">DRONE 3D A* / TRANSPORT PROGRAM</span>
          <h3>无人机任意方向跨层运输</h3>
          <p>配置任意楼层的取货与卸货点；无人机使用 26 邻域三维寻路直接改变 X / Y / Z，不再经过固定升降井。</p>
        </div>
        <div className="fm-drone-control-summary"><b>{drones.length.toString().padStart(2, '0')}</b><span>DRONES</span><small>{runtime?.motionStatus === 'moving' ? '3D ROUTE ACTIVE' : 'STANDBY'}</small></div>
      </div>

      <div className="fm-drone-control-body">
        <aside className="fm-drone-fleet" aria-label="无人机机队">
          <div className="fm-agv-control-subhead"><span>AIR CARGO FLEET</span><b>{drones.length} UNITS</b></div>
          {drones.map((drone) => {
            const state = snapshot.drones.find((entry) => entry.objectId === drone.id)
            return (
              <button key={drone.id} type="button" className={`fm-drone-fleet-item${drone.id === selected?.id ? ' is-active' : ''}`} onClick={() => setSelectedId(drone.id)}>
                <span className="fm-drone-fleet-icon">◇</span>
                <span><b>{drone.id.replace(/^a01_/, 'A01 / ')}</b><small>{phaseLabel(state?.phase)} · L{state?.targetFloor ?? floorOf(drone)}</small></span>
                <i className={state?.motionStatus === 'moving' ? 'is-live' : ''} />
              </button>
            )
          })}
          {drones.length === 0 && <div className="fm-agv-control-empty">当前场地没有货运无人机。</div>}
          <div className="fm-drone-dock-readout"><span>NAVIGATION KERNEL</span><b>26-NEIGHBOUR 3D A*</b><small>设施净空 1.2m · 多机间距 3.0m</small></div>
        </aside>

        {selected ? <div className="fm-drone-route-panel">
          <div className="fm-drone-target-switcher">
            <span>运输任务 / {draft.enabled ? 'ENABLED' : 'DISABLED'}</span>
            <div><button type="button" className={draft.enabled ? 'is-active' : ''} onClick={() => setDraft((current) => ({ ...current, enabled: !current.enabled }))}>{draft.enabled ? '已启用' : '已停用'}<small>可保存任务</small></button></div>
          </div>

          <div className="fm-drone-route-flow">
            <label className="fm-drone-route-node"><span>01 / PICKUP</span><b>跨层取货点</b><select value={draft.sourceObjectId ?? ''} onChange={(event) => setDraft((current) => ({ ...current, sourceObjectId: event.target.value || null }))}><option value="">未设置</option>{sources.map((object) => <option key={object.id} value={object.id}>{objectLabel(object)}</option>)}</select></label>
            <span className="fm-drone-route-arrow">↗</span>
            <label className="fm-drone-route-node is-accent"><span>02 / CARGO</span><b>{selectedItem?.name ?? '选择货物'}</b><select value={draft.itemId ?? ''} onChange={(event) => setDraft((current) => ({ ...current, itemId: event.target.value || null }))}><option value="">未设置</option>{items.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select><input type="number" min={1} max={100} value={draft.loadQuantity} onChange={(event) => setDraft((current) => ({ ...current, loadQuantity: Math.max(1, Math.round(Number(event.target.value) || 1)) }))} aria-label="无人机每趟数量" /></label>
            <span className="fm-drone-route-arrow">↘</span>
            <label className="fm-drone-route-node is-accent"><span>03 / DROPOFF</span><b>跨层卸货点</b><select value={draft.destinationObjectId ?? ''} onChange={(event) => setDraft((current) => ({ ...current, destinationObjectId: event.target.value || null }))}><option value="">未设置</option>{destinations.filter((object) => object.id !== draft.sourceObjectId).map((object) => <option key={object.id} value={object.id}>{objectLabel(object)}</option>)}</select></label>
          </div>

          <div className="fm-drone-route-designer">
            <div className="fm-drone-route-designer-head"><div><span className="fm-production-label">LIVE 3D PATH</span><b>{crossFloor ? `L${floorOf(source)} → L${floorOf(destination)} 任意方向跨层` : '请选择不同楼层的起点与终点'}</b><small>面对角与体对角移动均参与最短路计算；转向点由建筑体积和净空自动决定。</small></div><strong>{liveDistance.toFixed(1)} M</strong></div>
            <div className="fm-drone-route-list">{(runtime?.path ?? []).slice(0, 8).map((point, index, path) => <div key={`${point.x}-${point.y}-${point.z}-${index}`} className="fm-drone-route-stop"><span>{String(index + 1).padStart(2, '0')}</span><div><b>X {point.x.toFixed(1)} / Y {point.y.toFixed(1)} / Z {point.z.toFixed(1)}</b><small>{index === 0 ? '当前位置' : index === path.length - 1 ? '装卸安全悬停点' : '三维转向节点'}</small></div><i className={index === path.length - 1 ? 'is-target' : ''} /></div>)}</div>
          </div>

          <div className="fm-drone-live-route"><span>LIVE ROUTE</span><b>{runtime ? `${phaseLabel(runtime.phase)} · L${runtime.targetFloor}` : '等待仿真'}</b><small>{runtime ? `${runtime.currentWaypointLabel} · ${runtime.cargoQuantity > 0 ? `${selectedItem?.name ?? '货物'} × ${runtime.cargoQuantity}` : '空载'} · 已完成 ${runtime.completedTrips} 趟 · 累计 ${runtime.distanceTravelled.toFixed(1)}m` : '启动仿真后显示实际三维规划路径'}</small></div>
          <div className="fm-vehicle-dispatch-settings"><label>供货方式<select value={draft.dispatchMode ?? 'continuous'} onChange={(event) => setDraft((current) => ({ ...current, dispatchMode: event.target.value as AgvProgram['dispatchMode'] }))}><option value="continuous">一直运输</option><option value="threshold">库存条件触发</option></select></label>{draft.dispatchMode === 'threshold' && <><label>起点库存至少<input type="number" min={0} max={1000000} value={draft.sourceMinQuantity ?? draft.loadQuantity} onChange={(event) => setDraft((current) => ({ ...current, sourceMinQuantity: Math.max(0, Math.round(Number(event.target.value) || 0)) }))} /></label><label>终点库存至多<input type="number" min={0} max={1000000} value={draft.destinationMaxQuantity ?? 100} onChange={(event) => setDraft((current) => ({ ...current, destinationMaxQuantity: Math.max(0, Math.round(Number(event.target.value) || 0)) }))} /></label></>}<small>无人机可直接从任意楼层普通货架取货；缺少对应实际库存时等待，不依赖货物存取站。</small></div>
          <div className="fm-agv-control-actions"><label className="fm-agv-enable-toggle"><input type="checkbox" checked={draft.enabled} onChange={(event) => setDraft((current) => ({ ...current, enabled: event.target.checked }))} /><span>启用运输任务</span></label><button type="button" className="fm-agv-apply" disabled={!source || !destination || !draft.itemId || source.id === destination.id} onClick={() => applyProgram(true)}>应用三维任务</button><button type="button" className="fm-agv-disable" onClick={() => applyProgram(false)}>停用</button></div>
        </div> : <div className="fm-agv-control-empty">选择一架无人机开始配置。</div>}
      </div>
    </section>
  )
}
