import { useEffect, useMemo, useState } from 'react'
import type { AgvProgram, AgvRouteAction, AgvRouteWaypoint, FactoryObject } from '../game/types'
import { canReceiveVehicle, canSupplyVehicle, getFactoryObjectDisplayName, getObjectDef, isStorageFacilityType } from '../game/types'
import { useForgeMindStore } from '../store/forgeMind'

const EMPTY_PROGRAM: AgvProgram = {
  enabled: false,
  sourceObjectId: null,
  destinationObjectId: null,
  itemId: null,
  loadQuantity: 1,
  dispatchMode: 'continuous',
  sourceMinQuantity: 1,
  destinationMaxQuantity: 100,
}

function programFor(object: FactoryObject | undefined, storage: FactoryObject[]): AgvProgram {
  const sourceId = object?.agvProgram?.sourceObjectId ?? null
  const destinationId = object?.agvProgram?.destinationObjectId ?? null
  return {
    ...EMPTY_PROGRAM,
    sourceObjectId: sourceId,
    destinationObjectId: destinationId,
    itemId: object?.agvProgram?.itemId ?? null,
    ...object?.agvProgram,
    route: object?.agvProgram?.route ?? defaultRoute(storage, sourceId, destinationId),
    priority: object?.agvProgram?.priority ?? 0,
    policy: object?.agvProgram?.policy ?? 'balanced',
    dispatchMode: object?.agvProgram?.dispatchMode ?? 'continuous',
    sourceMinQuantity: object?.agvProgram?.sourceMinQuantity ?? object?.agvProgram?.loadQuantity ?? 1,
    destinationMaxQuantity: object?.agvProgram?.destinationMaxQuantity ?? 100,
  }
}

function waypointFor(object: FactoryObject | undefined, action: AgvRouteAction, fallbackLabel: string): AgvRouteWaypoint {
  return {
    id: `${action}-${object?.id ?? fallbackLabel}`,
    label: object ? getFactoryObjectDisplayName(object) : fallbackLabel,
    objectId: object?.id ?? null,
    position: object ? { x: object.pos.x + 0.5, z: object.pos.z + 0.5 } : { x: 0, z: 0 },
    action,
  }
}

function defaultRoute(storage: FactoryObject[], sourceId: string | null, destinationId: string | null): AgvRouteWaypoint[] {
  return [
    waypointFor(storage.find((object) => object.id === sourceId), 'load', '起点装货'),
    waypointFor(storage.find((object) => object.id === destinationId), 'unload', '终点卸货'),
  ]
}

function routeWithEndpoints(draft: AgvProgram, storage: FactoryObject[]): AgvRouteWaypoint[] {
  const source = storage.find((object) => object.id === draft.sourceObjectId)
  const destination = storage.find((object) => object.id === draft.destinationObjectId)
  const middle = (draft.route ?? []).slice(1, -1).map((waypoint) => ({ ...waypoint, action: waypoint.action === 'load' || waypoint.action === 'unload' ? 'pass' : waypoint.action }))
  return [waypointFor(source, 'load', '起点装货'), ...middle, waypointFor(destination, 'unload', '终点卸货')]
}

function objectLabel(object: FactoryObject) {
  return `${getFactoryObjectDisplayName(object)}${object.displayName ? ` · ${getObjectDef(object.type, object.resourceId).label}` : ''} · ${object.id.replace(/^a01_/, '')}`
}

function phaseLabel(phase: string | undefined) {
  if (phase === 'to-source') return '前往起点'
  if (phase === 'to-destination') return '前往终点'
  if (phase === 'to-warehouse') return '前往仓储'
  if (phase === 'to-line') return '前往产线'
  return '待命'
}

export function AgvNavigationControl() {
  const objects = useForgeMindStore((state) => state.objects)
  const items = useForgeMindStore((state) => state.items)
  const snapshot = useForgeMindStore((state) => state.simSnapshot)
  const setAgvProgram = useForgeMindStore((state) => state.setAgvProgram)
  const vehicles = useMemo(() => objects.filter((object) => object.type === 'agv'), [objects])
  const storageObjects = useMemo(() => objects.filter((object) => isStorageFacilityType(object.type)), [objects])
  const sourceObjects = useMemo(() => storageObjects.filter((object) => canSupplyVehicle(object.type)), [storageObjects])
  const destinationObjects = useMemo(() => storageObjects.filter((object) => canReceiveVehicle(object.type)), [storageObjects])
  const [selectedId, setSelectedId] = useState(vehicles[0]?.id ?? '')
  const selected = vehicles.find((vehicle) => vehicle.id === selectedId) ?? vehicles[0]
  const [draft, setDraft] = useState<AgvProgram>(() => programFor(selected, storageObjects))
  const runtime = snapshot.agvs.find((agv) => agv.objectId === selected?.id)

  useEffect(() => {
    if (!vehicles.some((vehicle) => vehicle.id === selectedId)) setSelectedId(vehicles[0]?.id ?? '')
  }, [selectedId, vehicles])

  useEffect(() => {
    setDraft(programFor(selected, storageObjects))
  }, [selectedId, selected?.agvProgram, storageObjects, items, selected])

  const selectedItem = items.find((item) => item.id === draft.itemId)

  const applyProgram = (enabled: boolean) => {
    if (!selected) return
    setAgvProgram(selected.id, { ...draft, enabled, route: routeWithEndpoints(draft, storageObjects) })
    setDraft((current) => ({ ...current, enabled }))
  }

  const addRouteStop = (object: FactoryObject) => {
    setDraft((current) => {
      const route = current.route ?? []
      const stop = waypointFor(object, 'pass', '中间站')
      return { ...current, route: route.length >= 2 ? [...route.slice(0, -1), stop, route[route.length - 1]] : [...route, stop] }
    })
  }

  const moveRouteStop = (index: number, direction: -1 | 1) => {
    setDraft((current) => {
      const route = [...(current.route ?? [])]
      const next = index + direction
      if (index <= 0 || index >= route.length - 1 || next <= 0 || next >= route.length - 1) return current
      ;[route[index], route[next]] = [route[next], route[index]]
      return { ...current, route }
    })
  }

  const removeRouteStop = (index: number) => setDraft((current) => ({ ...current, route: (current.route ?? []).filter((_, routeIndex) => routeIndex !== index) }))

  return (
    <div className="fm-agv-control">
      <div className="fm-agv-control-heading">
        <div>
          <span className="fm-production-label">AGV NAVIGATION / PROGRAM EDITOR</span>
          <h3>导航控制</h3>
          <p>为自动小车配置一条可执行的“起点 → 货物 → 终点”搬运任务。</p>
        </div>
        <div className="fm-agv-control-summary"><b>{vehicles.length.toString().padStart(2, '0')}</b><span>VEHICLES</span></div>
      </div>

      <div className="fm-agv-control-layout">
        <aside className="fm-agv-fleet" aria-label="AGV 车队">
          <div className="fm-agv-control-subhead"><span>VEHICLE FLEET</span><b>{vehicles.length} UNITS</b></div>
          {vehicles.map((vehicle) => {
            const state = snapshot.agvs.find((agv) => agv.objectId === vehicle.id)
            return (
              <button key={vehicle.id} type="button" className={`fm-agv-fleet-item${vehicle.id === selected?.id ? ' is-active' : ''}`} onClick={() => setSelectedId(vehicle.id)}>
                <span className="fm-agv-fleet-icon">AGV</span>
                <span><b>{vehicle.id.replace(/^a01_/, 'A01 / ')}</b><small>{state ? phaseLabel(state.phase) : '等待仿真'} · {state?.decision === 'yielding' ? '避让中' : state?.decision === 'replanning' ? '重新规划' : state?.motionStatus === 'moving' ? '运行中' : '待命'}</small></span>
                <i className={state?.motionStatus === 'moving' ? 'is-live' : ''} />
              </button>
            )
          })}
          {vehicles.length === 0 && <div className="fm-agv-control-empty">当前场地没有 AGV。</div>}
        </aside>

        {selected ? (
          <section className="fm-agv-program-editor" aria-label="AGV 任务编辑器">
            <div className="fm-agv-editor-topline">
              <div><span className="fm-production-label">SELECTED VEHICLE</span><h4>{selected.id}</h4></div>
              <span className={`fm-agv-program-status${draft.enabled ? ' is-enabled' : ''}`}><i />{draft.enabled ? '任务已启用' : '任务已停用'}</span>
            </div>

            <div className="fm-agv-program-flow">
              <label className="fm-agv-program-node"><span>01 / 起点</span><b>装货位置</b><select className="fm-agv-control-select" value={draft.sourceObjectId ?? ''} onChange={(event) => setDraft((current) => ({ ...current, sourceObjectId: event.target.value || null }))}><option value="">未设置</option>{sourceObjects.map((object) => <option key={object.id} value={object.id}>{objectLabel(object)}</option>)}</select></label>
              <span className="fm-agv-program-arrow">→</span>
              <label className="fm-agv-program-node"><span>02 / 货物</span><b>搬运内容</b><select className="fm-agv-control-select" value={draft.itemId ?? ''} onChange={(event) => setDraft((current) => ({ ...current, itemId: event.target.value || null }))}><option value="">未设置</option>{items.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select><input className="fm-agv-quantity" type="number" min={1} step={1} value={draft.loadQuantity} onChange={(event) => setDraft((current) => ({ ...current, loadQuantity: Math.max(1, Number(event.target.value) || 1) }))} aria-label="每趟数量" /><small>每趟数量 / units</small></label>
              <span className="fm-agv-program-arrow">→</span>
              <label className="fm-agv-program-node"><span>03 / 终点</span><b>卸货位置</b><select className="fm-agv-control-select" value={draft.destinationObjectId ?? ''} onChange={(event) => setDraft((current) => ({ ...current, destinationObjectId: event.target.value || null }))}><option value="">未设置</option>{destinationObjects.map((object) => <option key={object.id} value={object.id}>{objectLabel(object)}</option>)}</select></label>
            </div>

            <div className="fm-agv-route-designer">
              <div className="fm-agv-route-designer-head"><div><span className="fm-production-label">ROUTE DESIGNER</span><b>自定义导航路线</b><small>可插入中间站；车辆会在动态障碍出现时保留任务顺序并重新规划。</small></div><strong>{(draft.route ?? []).length.toString().padStart(2, '0')} STOPS</strong></div>
              <div className="fm-agv-route-list">{(draft.route ?? []).map((waypoint, index) => <div className="fm-agv-route-stop" key={waypoint.id}><span className="fm-agv-route-index">{String(index + 1).padStart(2, '0')}</span><div><b>{waypoint.label}</b><small>{waypoint.objectId ?? '自由点位'} · {waypoint.action === 'load' ? '装货' : waypoint.action === 'unload' ? '卸货' : '经过'}</small></div><select value={waypoint.action} disabled={index === 0 || index === (draft.route?.length ?? 0) - 1} onChange={(event) => setDraft((current) => ({ ...current, route: (current.route ?? []).map((entry, entryIndex) => entryIndex === index ? { ...entry, action: event.target.value as AgvRouteAction } : entry) }))}><option value="pass">经过</option><option value="load">装货</option><option value="unload">卸货</option></select><button type="button" onClick={() => moveRouteStop(index, -1)} disabled={index <= 1}>↑</button><button type="button" onClick={() => moveRouteStop(index, 1)} disabled={index >= (draft.route?.length ?? 0) - 2}>↓</button><button type="button" onClick={() => removeRouteStop(index)} disabled={index === 0 || index === (draft.route?.length ?? 0) - 1}>×</button></div>)}</div>
              <div className="fm-agv-route-add"><span>添加中间站</span>{storageObjects.filter((object) => !(draft.route ?? []).some((waypoint) => waypoint.objectId === object.id)).map((object) => <button type="button" key={object.id} onClick={() => addRouteStop(object)}>+ {getObjectDef(object.type, object.resourceId).label}</button>)}</div>
            </div>

            <div className="fm-agv-live-route"><span>LIVE ROUTE</span><b>{selectedItem?.name ?? '未选择货物'} × {draft.loadQuantity}</b><small>{runtime ? `${phaseLabel(runtime.phase)} · ${runtime.currentWaypointLabel} · ${runtime.decision === 'yielding' ? '正在避让车辆' : runtime.decision === 'replanning' ? '正在重新规划' : runtime.decision === 'recovering' ? '恢复动作中' : runtime.motionStatus === 'moving' ? '导航中' : '待命'} · 已完成 ${runtime.completedTrips} 趟 · ${runtime.distanceTravelled.toFixed(1)} m` : '启动仿真后显示实时路径'}</small></div>

            <div className="fm-vehicle-dispatch-settings"><label>供货方式<select value={draft.dispatchMode ?? 'continuous'} onChange={(event) => setDraft((current) => ({ ...current, dispatchMode: event.target.value as AgvProgram['dispatchMode'] }))}><option value="continuous">一直运输</option><option value="threshold">库存条件触发</option></select></label>{draft.dispatchMode === 'threshold' && <><label>起点库存至少<input type="number" min={0} max={1000000} value={draft.sourceMinQuantity ?? draft.loadQuantity} onChange={(event) => setDraft((current) => ({ ...current, sourceMinQuantity: Math.max(0, Math.round(Number(event.target.value) || 0)) }))} /></label><label>终点库存至多<input type="number" min={0} max={1000000} value={draft.destinationMaxQuantity ?? 100} onChange={(event) => setDraft((current) => ({ ...current, destinationMaxQuantity: Math.max(0, Math.round(Number(event.target.value) || 0)) }))} /></label></>}<small>普通货架直接作为起终点；没有对应物品或数量不足时，车辆等待且不会生成虚拟货物。</small></div>

            <div className="fm-agv-control-actions"><label className="fm-agv-enable-toggle"><input type="checkbox" checked={draft.enabled} onChange={(event) => setDraft((current) => ({ ...current, enabled: event.target.checked }))} /><span>启用导航任务</span></label><label className="fm-agv-policy-field">策略<select value={draft.policy ?? 'balanced'} onChange={(event) => setDraft((current) => ({ ...current, policy: event.target.value as AgvProgram['policy'] }))}><option value="balanced">平衡交通</option><option value="shortest">最短路径</option><option value="priority">优先级通行</option></select></label><label className="fm-agv-policy-field">优先级<input type="number" min={0} max={9} value={draft.priority ?? 0} onChange={(event) => setDraft((current) => ({ ...current, priority: Math.max(0, Math.min(9, Number(event.target.value) || 0)) }))} /></label><button type="button" className="fm-agv-apply" disabled={!draft.sourceObjectId || !draft.destinationObjectId || !draft.itemId} onClick={() => applyProgram(true)}>应用导航任务</button><button type="button" className="fm-agv-disable" onClick={() => applyProgram(false)}>停用</button></div>
          </section>
        ) : <div className="fm-agv-control-empty">选择一台 AGV 开始配置。</div>}
      </div>
    </div>
  )
}
