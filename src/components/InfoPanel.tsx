import { useEffect, useState } from 'react'
import { useForgeMindStore } from '../store/forgeMind'
import { canCustomizeStorageName, canReceiveVehicle, canSupplyVehicle, getFactoryObjectDisplayName, getObjectDef, isStorageFacilityType, type AgvProgram, type FactoryObject, type StationProgram, type StorageConfig } from '../game/types'
import { isCargoStorageRack, stationRackConnections, type StationRackSide } from '../game/grid'
import type { AgvRuntimeSnapshot, DroneRuntimeSnapshot } from '../game/simulation'
import type { Item } from '../game/item'
import { Model3DViewer } from './Model3DViewer'
import { StorageContentOverlay } from './StorageContentOverlay'

export function InfoPanel() {
  const selectedId = useForgeMindStore((s) => s.selectedId)
  const objects = useForgeMindStore((s) => s.objects)
  const recipes = useForgeMindStore((s) => s.recipes)
  const items = useForgeMindStore((s) => s.items)
  const rotateObject = useForgeMindStore((s) => s.rotateObject)
  const remove = useForgeMindStore((s) => s.remove)
  const bindRecipe = useForgeMindStore((s) => s.bindRecipe)
  const bindItem = useForgeMindStore((s) => s.bindItem)
  const machineDefinitions = useForgeMindStore((s) => s.machineDefinitions)
  const setObjectPortConfig = useForgeMindStore((s) => s.setObjectPortConfig)
  const setStationProgram = useForgeMindStore((s) => s.setStationProgram)
  const setStorageConfig = useForgeMindStore((s) => s.setStorageConfig)
  const setObjectDisplayName = useForgeMindStore((s) => s.setObjectDisplayName)
  const setAgvProgram = useForgeMindStore((s) => s.setAgvProgram)
  const snapshot = useForgeMindStore((s) => s.simSnapshot)
  const [show3D, setShow3D] = useState(false)
  const [showStorageQuery, setShowStorageQuery] = useState(false)
  const obj = objects.find((item) => item.id === selectedId)

  useEffect(() => {
    setShowStorageQuery(false)
  }, [selectedId])

  if (!obj) {
    return <div className="fm-inspector fm-inspector-empty"><div className="fm-eyebrow">OBJECT INSPECTOR</div><strong>未选中设备</strong><p>从 3D 工厂中点击设备，查看它的职能、接口和运行状态。</p></div>
  }

  const def = getObjectDef(obj.type, obj.resourceId)
  const machine = def.role === 'machine'
  const source = def.role === 'source'
  const vehicle = obj.type === 'agv' || obj.type === 'drone'
  const machineDefinition = obj.type === 'machine' ? machineDefinitions.find((entry) => entry.id === obj.resourceId) : undefined
  const inputCount = source ? (obj.stationProgram?.mode === 'store' ? 1 : 0) : obj.type === 'assembler' ? obj.portConfig?.inputCount ?? 3 : def.inputPortCount ?? (def.inputPort ? 1 : 0)
  const outputCount = source ? (obj.stationProgram?.mode === 'store' ? 0 : 1) : obj.type === 'assembler' ? obj.portConfig?.outputCount ?? 1 : def.outputPortCount ?? (def.outputPort ? 1 : 0)
  const availableRecipes = obj.type === 'machine' && machineDefinition
    ? recipes.filter((recipe) => machineDefinition.recipeIds.includes(recipe.id) && recipe.enabled !== false)
    : obj.type === 'assembler'
      ? recipes.filter((recipe) => recipe.enabled !== false && recipe.inputs.length >= 2 && recipe.outputs.length === 1 && recipe.inputs.length <= inputCount && recipe.outputs.length <= outputCount)
      : recipes.filter((recipe) => recipe.enabled !== false)

  return (
    <div className="fm-inspector">
      <div className="fm-inspector-title">
        <div><div className="fm-eyebrow">{vehicle ? 'VEHICLE' : 'OBJECT'} / {obj.id.slice(-6)}</div><h3>{getFactoryObjectDisplayName(obj)}</h3><span>{obj.displayName ? `${def.label} · ${def.subtitle}` : def.subtitle}</span></div>
        <div className="fm-inspector-mark" style={{ '--equipment-accent': def.accent } as React.CSSProperties}>{def.model.slice(0, 2).toUpperCase()}</div>
      </div>
      <p className="fm-inspector-function">{def.function}</p>
      <section className="fm-inspector-section">
        <div className="fm-inspector-section-heading"><span>POSITION / CAPACITY</span><b>LIVE DATA</b></div>
        <div className="fm-inspector-specs">
          <Spec label="安装坐标" value={`(${obj.pos.x}, ${obj.pos.z})`} />
          <Spec label="朝向" value={`${obj.rotation}°`} />
          <Spec label="占地" value={`${def.footprint.w} × ${def.footprint.d}`} />
          <Spec label="标准吞吐" value={def.throughput} />
        </div>
      </section>
      {machine && <label className="fm-inspector-field"><span>生产配方 / RECIPE</span><select value={obj.recipeId ?? ''} onChange={(event) => bindRecipe(obj.id, event.target.value || null)}><option value="">未绑定配方</option>{availableRecipes.map((recipe) => <option key={recipe.id} value={recipe.id}>{recipe.name}</option>)}</select><small>{obj.type === 'machine' ? '仅显示机械制造中已录入的路线' : obj.type === 'assembler' ? '仅显示多种输入合并为一种输出、且符合当前接口容量的路线' : '显示已启用路线'}</small></label>}
      {obj.type === 'assembler' && <div className="fm-inspector-port-config"><label><span>入货口 / INPUT</span><input type="number" min="2" max={def.footprint.w + def.footprint.d * 2} value={inputCount} onChange={(event) => setObjectPortConfig(obj.id, Math.max(2, Math.min(def.footprint.w + def.footprint.d * 2, Number(event.target.value) || 2)), outputCount)} /><small>后三边最大 {def.footprint.w + def.footprint.d * 2}</small></label><label><span>出货口 / OUTPUT</span><input type="number" min="1" max={def.footprint.d} value={outputCount} onChange={(event) => setObjectPortConfig(obj.id, inputCount, Math.max(1, Math.min(def.footprint.d, Number(event.target.value) || 1)))} /><small>前边最大 {def.footprint.d}</small></label></div>}
      {canCustomizeStorageName(obj.type) && <StorageNameEditor obj={obj} setName={setObjectDisplayName} />}
      {isCargoStorageRack(obj) && <StorageConfigEditor obj={obj} items={items} setConfig={setStorageConfig} />}
      {isCargoStorageRack(obj) && <RackRuntimeInventory obj={obj} items={items} snapshot={snapshot.racks.find((entry) => entry.objectId === obj.id)} />}
      {obj.type === 'inboundWarehouse' && <label className="fm-inspector-field"><span>无限供应物品 / INBOUND SUPPLY</span><select value={obj.itemId ?? ''} onChange={(event) => bindItem(obj.id, event.target.value || null)}><option value="">未选择供应物品</option>{items.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select><small>实际从该仓库取出的数量计入消耗；仓库库存不会减少</small></label>}
      {obj.type === 'outboundWarehouse' && <div className="fm-warehouse-boundary-note is-outbound"><span>OUTBOUND SINK</span><b>无限接收 · 入库后不可取回</b><small>传送带、AGV 或无人机实际送达的数量计入产出</small></div>}
      {source && <StationProgramEditor obj={obj} objects={objects} items={items} bindItem={bindItem} setProgram={setStationProgram} />}
      {(obj.type === 'agv' || obj.type === 'drone') && <VehicleProgramEditor obj={obj} objects={objects} items={items} runtime={obj.type === 'agv' ? snapshot.agvs.find((entry) => entry.objectId === obj.id) : snapshot.drones.find((entry) => entry.objectId === obj.id)} setProgram={setAgvProgram} />}
      {!vehicle && <section className="fm-inspector-section fm-inspector-io-section">
        <div className="fm-inspector-section-heading"><span>CONNECTIONS</span><b>ROUTE MAP</b></div>
        <div className="fm-inspector-io"><div><span>INPUT / BLUE · {inputCount}</span><b>{def.inputs.join(' · ') || '无'}</b><small>每个蓝色标志均为真实吸附口</small></div><div><span>OUTPUT / AMBER · {outputCount}</span><b>{def.outputs.join(' · ') || '无'}</b><small>多个出口采用稳定轮询</small></div></div>
      </section>}
      {obj.type === 'inspection' && <InspectionEntry />}
      {(obj.type === 'assembler' || obj.type === 'machine') && <RobotWorkPanel />}
      <footer className="fm-inspector-footer">
        {!vehicle && <div className="fm-port-legend"><span><i className="fm-port-dot input" />入口 / INPUT</span><span><i className="fm-port-dot output" />出口 / OUTPUT</span></div>}
        <div className="fm-inspector-actions"><button onClick={() => rotateObject(obj.id)}><span>TRANSFORM</span>旋转 90°</button><button className="danger" onClick={() => remove(obj.id)}><span>REMOVE {vehicle ? 'VEHICLE' : 'UNIT'}</span>{vehicle ? '移除载具' : '拆除设备'}</button></div>
      </footer>
      <div className="fm-inspector-extra-actions">
        <button className="fm-3d-btn" onClick={() => setShow3D(true)}>3D 观测</button>
        {def.role === 'storage' && <button className="fm-storage-query-btn" onClick={() => setShowStorageQuery(true)}>内容物查询</button>}
      </div>
      {show3D && <Model3DViewer obj={obj} def={def} onClose={() => setShow3D(false)} />}
      {showStorageQuery && def.role === 'storage' && <StorageContentOverlay obj={obj} label={getFactoryObjectDisplayName(obj)} onClose={() => setShowStorageQuery(false)} />}
    </div>
  )
}

function StorageNameEditor({ obj, setName }: { obj: FactoryObject; setName: (objectId: string, name: string) => void }) {
  const [draft, setDraft] = useState(obj.displayName ?? '')
  useEffect(() => setDraft(obj.displayName ?? ''), [obj.id, obj.displayName])
  const commit = () => setName(obj.id, draft)
  return <label className="fm-inspector-field fm-storage-name-field"><span>位置名称 / DISPLAY NAME</span><input type="text" maxLength={40} value={draft} placeholder={getObjectDef(obj.type, obj.resourceId).label} onChange={(event) => setDraft(event.target.value)} onBlur={commit} onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur() }} /><small>用于仓储总览以及小车、无人机的起点和终点选择；留空时显示设备类型</small></label>
}

function StorageConfigEditor({ obj, items, setConfig }: { obj: FactoryObject; items: Item[]; setConfig: (objectId: string, config: StorageConfig) => void }) {
  const fallbackInventory = obj.itemId ? { [obj.itemId]: 24 } : {}
  const config = obj.storageConfig ?? { capacity: 100, initialInventory: fallbackInventory }
  const total = Object.values(config.initialInventory).reduce((sum, quantity) => sum + quantity, 0)
  const updateQuantity = (itemId: string, quantity: number) => {
    const initialInventory = { ...config.initialInventory }
    const next = Math.max(0, Math.round(quantity))
    if (next > 0) initialInventory[itemId] = next
    else delete initialInventory[itemId]
    setConfig(obj.id, { ...config, initialInventory })
  }
  return <section className="fm-storage-config"><div className="fm-inspector-section-heading"><span>FINITE RACK INVENTORY</span><b>{total} / {config.capacity}</b></div><label className="fm-storage-capacity"><span>货物上限</span><input type="number" min="1" max="1000000" value={config.capacity} onChange={(event) => setConfig(obj.id, { ...config, capacity: Math.max(1, Math.round(Number(event.target.value) || 1)) })} /><small>普通货架不会无限供货，存满后机械臂和载具会等待</small></label><div className="fm-storage-item-list"><span>仿真初始数量</span>{items.map((item) => <label key={item.id}><b><i style={{ background: item.color }} />{item.name}</b><input aria-label={`${item.name}初始数量`} type="number" min="0" max={config.capacity} value={config.initialInventory[item.id] ?? 0} onChange={(event) => updateQuantity(item.id, Number(event.target.value) || 0)} /></label>)}{items.length === 0 && <small>物品库为空，请先在“物品详情”中新建物品。</small>}</div></section>
}

function RackRuntimeInventory({ obj, items, snapshot }: { obj: FactoryObject; items: Item[]; snapshot?: { inventory: Record<string, number>; capacity: number | null } }) {
  const inventory = snapshot?.inventory ?? obj.storageConfig?.initialInventory ?? {}
  const entries = Object.entries(inventory).filter(([, quantity]) => quantity > 0)
  const total = entries.reduce((sum, [, quantity]) => sum + quantity, 0)
  const capacity = snapshot?.capacity ?? obj.storageConfig?.capacity ?? 100
  return <section className="fm-rack-runtime-inventory"><div className="fm-inspector-section-heading"><span>ACTUAL INVENTORY / 实际库存</span><b>{total} / {capacity}</b></div>{entries.length > 0 ? <div>{entries.map(([itemId, quantity]) => { const item = items.find((entry) => entry.id === itemId); return <span key={itemId}><i style={{ background: item?.color ?? '#72d4d2' }} /><b>{item?.name ?? itemId}</b><strong>× {quantity}</strong></span> })}</div> : <p>空货架：当前没有任何可供载具或存取站取得的货物。</p>}</section>
}

function VehicleProgramEditor({ obj, objects, items, runtime, setProgram }: { obj: FactoryObject; objects: FactoryObject[]; items: Item[]; runtime?: AgvRuntimeSnapshot | DroneRuntimeSnapshot; setProgram: (objectId: string, program: AgvProgram | null) => void }) {
  const emptyProgram: AgvProgram = { enabled: false, sourceObjectId: null, destinationObjectId: null, itemId: null, loadQuantity: 1, priority: 0, policy: obj.type === 'drone' ? 'shortest' : 'balanced', dispatchMode: 'continuous', sourceMinQuantity: 1, destinationMaxQuantity: 100 }
  const [draft, setDraft] = useState<AgvProgram>(() => ({ ...emptyProgram, ...obj.agvProgram }))
  useEffect(() => {
    setDraft({ ...emptyProgram, ...obj.agvProgram })
  }, [obj.id, obj.agvProgram])
  const facilities = objects.filter((entry) => isStorageFacilityType(entry.type))
  const sources = facilities.filter((entry) => canSupplyVehicle(entry.type))
  const destinations = facilities.filter((entry) => canReceiveVehicle(entry.type) && entry.id !== draft.sourceObjectId)
  const ready = Boolean(draft.sourceObjectId && draft.destinationObjectId && draft.itemId && draft.sourceObjectId !== draft.destinationObjectId)
  const label = (entry: FactoryObject) => `${obj.type === 'drone' ? `L${entry.floorId ?? 1} · ` : ''}${getFactoryObjectDisplayName(entry)}${entry.displayName ? ` · ${getObjectDef(entry.type, entry.resourceId).label}` : ''} · ${entry.id.slice(-6)}`
  const save = (enabled: boolean) => {
    const next = { ...draft, enabled: enabled && ready, route: undefined, loadQuantity: Math.max(1, Math.round(draft.loadQuantity)) }
    setProgram(obj.id, next)
    setDraft(next)
  }
  const phase = runtime ? runtime.phase === 'to-source' ? '前往起点' : runtime.phase === 'to-destination' ? '前往终点' : runtime.motionStatus === 'moving' ? '运输中' : '待命' : '等待仿真'
  return <section className="fm-vehicle-program"><div className="fm-inspector-section-heading"><span>{obj.type === 'drone' ? 'VISUAL DRONE PROGRAM' : 'VISUAL AGV PROGRAM'}</span><b className={draft.enabled ? 'is-live' : ''}>{draft.enabled ? 'ENABLED' : 'STANDBY'}</b></div><p>{obj.type === 'drone' ? '任意楼层三维取放；普通货架可直接取放，只按真实库存和容量结算。' : '八方向地面运输；普通货架可直接取放，只按真实库存和容量结算。'}</p><div className="fm-vehicle-program-flow"><label><span>01 / 起点装货</span><select value={draft.sourceObjectId ?? ''} onChange={(event) => setDraft((current) => ({ ...current, sourceObjectId: event.target.value || null }))}><option value="">选择供货位置</option>{sources.map((entry) => <option key={entry.id} value={entry.id}>{label(entry)}</option>)}</select></label><i>→</i><label><span>02 / 货物</span><select value={draft.itemId ?? ''} onChange={(event) => setDraft((current) => ({ ...current, itemId: event.target.value || null }))}><option value="">选择物品</option>{items.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select><input type="number" min="1" max="10000" value={draft.loadQuantity} onChange={(event) => setDraft((current) => ({ ...current, loadQuantity: Math.max(1, Math.round(Number(event.target.value) || 1)) }))} aria-label="每趟运输数量" /></label><i>→</i><label><span>03 / 终点卸货</span><select value={draft.destinationObjectId ?? ''} onChange={(event) => setDraft((current) => ({ ...current, destinationObjectId: event.target.value || null }))}><option value="">选择收货位置</option>{destinations.map((entry) => <option key={entry.id} value={entry.id}>{label(entry)}</option>)}</select></label></div><div className="fm-vehicle-program-settings"><label>供货方式<select value={draft.dispatchMode ?? 'continuous'} onChange={(event) => setDraft((current) => ({ ...current, dispatchMode: event.target.value as AgvProgram['dispatchMode'] }))}><option value="continuous">一直运输</option><option value="threshold">库存条件触发</option></select></label>{draft.dispatchMode === 'threshold' && <><label>起点库存至少<input type="number" min="0" max="1000000" value={draft.sourceMinQuantity ?? draft.loadQuantity} onChange={(event) => setDraft((current) => ({ ...current, sourceMinQuantity: Math.max(0, Math.round(Number(event.target.value) || 0)) }))} /></label><label>终点库存至多<input type="number" min="0" max="1000000" value={draft.destinationMaxQuantity ?? 100} onChange={(event) => setDraft((current) => ({ ...current, destinationMaxQuantity: Math.max(0, Math.round(Number(event.target.value) || 0)) }))} /></label></>}{obj.type === 'agv' && <><label>策略<select value={draft.policy ?? 'balanced'} onChange={(event) => setDraft((current) => ({ ...current, policy: event.target.value as AgvProgram['policy'] }))}><option value="balanced">平衡交通</option><option value="shortest">最短路径</option><option value="priority">优先通行</option></select></label><label>优先级<input type="number" min="0" max="9" value={draft.priority ?? 0} onChange={(event) => setDraft((current) => ({ ...current, priority: Math.max(0, Math.min(9, Math.round(Number(event.target.value) || 0))) }))} /></label></>}</div><div className="fm-vehicle-program-live"><span>LIVE</span><b>{phase}</b><small>{runtime ? `${runtime.currentWaypointLabel} · 载货 ${runtime.cargoQuantity} 件 · 已完成 ${runtime.completedTrips} 趟` : '启动仿真后显示实际任务状态'}</small></div><div className="fm-vehicle-program-actions"><button type="button" disabled={!ready} onClick={() => save(true)}>保存并启用</button><button type="button" onClick={() => save(false)}>停用任务</button></div>{!ready && <small className="fm-vehicle-program-warning">起点、物品和终点完整选择后才能启用；新放置车辆保持空载待命。</small>}</section>
}

function InspectionEntry() {
  return <section className="fm-inspection-entry">
    <div className="fm-inspection-entry-head"><div><span className="fm-eyebrow">LIVE INSPECTION</span><strong>视觉检测工作台</strong></div><span className="fm-inspection-entry-led" /></div>
    <p>进入独立检测页，查看夹取臂、摄像头臂和 360° 环绕扫描流程。</p>
    <div className="fm-inspection-entry-tags"><span>双臂协同</span><span>安全隔离</span><span>手动接管</span></div>
    <a className="fm-inspection-entry-button" href="/inspection.html" target="_blank" rel="noreferrer">进入检测详情 <b>↗</b></a>
  </section>
}

function StationProgramEditor({ obj, objects, items, bindItem, setProgram }: { obj: FactoryObject; objects: FactoryObject[]; items: Item[]; bindItem: (objectId: string, itemId: string | null) => void; setProgram: (objectId: string, program: StationProgram) => void }) {
  const program = obj.stationProgram ?? { mode: 'pickup' as const, transferIntervalSec: 2, rackAssignments: {} }
  const connections = stationRackConnections(obj, objects)
  const sideLabel: Record<StationRackSide, string> = { back: '后侧', left: '左侧', right: '右侧' }
  const update = (patch: Partial<StationProgram>) => setProgram(obj.id, { ...program, ...patch })
  return <section className="fm-station-program"><div className="fm-inspector-section-heading"><span>CARGO ACCESS PROGRAM</span><b>3-SIDE RACK</b></div><div className="fm-station-rack-status">{(['back', 'left', 'right'] as const).map((side) => <span key={side} className={connections[side] ? 'is-connected' : ''}><i />{sideLabel[side]} · {connections[side] ? `已吸附 ${connections[side]!.id.slice(-6)}` : '未连接'}</span>)}</div><div className="fm-inspector-port-config"><label><span>运行模式</span><select value={program.mode} onChange={(event) => update({ mode: event.target.value as StationProgram['mode'] })}><option value="pickup">取货 → 传送带</option><option value="store">传送带 → 存货</option></select></label><label><span>存取间隔 / 秒</span><input type="number" min="0.25" max="60" step="0.25" value={program.transferIntervalSec} onChange={(event) => update({ transferIntervalSec: Math.max(0.25, Math.min(60, Number(event.target.value) || 2)) })} /></label></div>{program.mode === 'pickup' && <label className="fm-inspector-field"><span>当前取货物品</span><select value={obj.itemId ?? ''} onChange={(event) => bindItem(obj.id, event.target.value || null)}><option value="">未绑定物品</option>{items.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}<div className="fm-station-rack-map"><span>物品 → 实际货架侧</span>{items.map((item) => <label key={item.id}><b>{item.name}</b><select value={program.rackAssignments[item.id] ?? ''} onChange={(event) => { const assignments = { ...program.rackAssignments }; const side = event.target.value as StationProgram['rackAssignments'][string] | ''; if (side) assignments[item.id] = side; else delete assignments[item.id]; update({ rackAssignments: assignments }) }}><option value="">自动分配并同类合并</option>{(['back', 'left', 'right'] as const).map((side) => <option key={side} value={side}>{sideLabel[side]}货架（{connections[side] ? '已吸附' : '未连接'}）</option>)}</select></label>)}</div></section>
}

function RobotWorkPanel() {
  const [mode, setMode] = useState<'auto' | 'manual'>('auto')
  const [task, setTask] = useState<'sort' | 'weld' | 'assemble'>('sort')
  const [pad, setPad] = useState(false)

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === '1') setTask('sort')
      if (event.key === '2') setTask('weld')
      if (event.key === '3') setTask('assemble')
      if (event.key.toLowerCase() === 'm') setMode((value) => value === 'auto' ? 'manual' : 'auto')
      if (event.code === 'Space') window.dispatchEvent(new CustomEvent('forgemind:robot-command', { detail: { action: 'grip', task } }))
    }
    const poll = window.setInterval(() => {
      const gamepads = navigator.getGamepads?.() ?? []
      setPad(Array.from(gamepads).some((gamepad) => Boolean(gamepad?.connected)))
    }, 500)
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('keydown', onKey); window.clearInterval(poll) }
  }, [task])

  const activate = (nextMode: 'auto' | 'manual') => {
    setMode(nextMode)
    window.dispatchEvent(new CustomEvent('forgemind:robot-command', { detail: { mode: nextMode, task } }))
  }

  return <div className="fm-robot-work-panel">
    <div className="fm-robot-work-head"><span>ROBOT WORKCELL</span><b>{pad ? 'GAMEPAD READY' : 'KEYBOARD READY'}</b></div>
    <div className="fm-robot-task-row">{(['sort', 'weld', 'assemble'] as const).map((name, index) => <button key={name} className={task === name ? 'is-active' : ''} onClick={() => { setTask(name); window.dispatchEvent(new CustomEvent('forgemind:robot-command', { detail: { task: name, mode } })) }}><strong>0{index + 1}</strong>{name === 'sort' ? '分拣' : name === 'weld' ? '焊接' : '装配'}</button>)}</div>
    <div className="fm-robot-controls"><button className={mode === 'auto' ? 'is-active' : ''} onClick={() => activate('auto')}>自动循环</button><button className={mode === 'manual' ? 'is-active' : ''} onClick={() => activate('manual')}>手动手柄</button></div>
    <div className="fm-robot-hint">
      <div className="fm-robot-hint-grid">
        <span><kbd>左摇杆</kbd><b>末端 XY</b></span>
        <span><kbd>右摇杆</kbd><b>高度 / 偏航</b></span>
        <span><kbd>空格</kbd><b>夹爪</b></span>
      </div>
      <span className="fm-robot-mode">MODE / {mode.toUpperCase()}</span>
    </div>
  </div>
}

function Spec({ label, value }: { label: string; value: string }) {
  return <div><span>{label}</span><strong>{value}</strong></div>
}
