import { useMemo, useState } from 'react'
import { getFactoryObjectDisplayName, getObjectDef, isStorageFacilityType } from '../game/types'
import { useForgeMindStore } from '../store/forgeMind'
import { AgvNavigationControl } from './AgvNavigationControl'
import { DroneNavigationControl } from './DroneNavigationControl'
import { ItemModelThumbnail } from './ItemModelThumbnail'

interface WarehouseWorkspaceProps {
  onClose: () => void
}

/**
 * ForgeCore 仓储语义在 ForgeMind 中的轻量映射：货物仓库/原料货架、
 * 内容物、运输层和运行中在途物料都从当前场地状态读取，避免另起一套存档。
 */
export function WarehouseWorkspace({ onClose }: WarehouseWorkspaceProps) {
  const [tab, setTab] = useState<'inventory' | 'navigation'>('inventory')
  const objects = useForgeMindStore((state) => state.objects)
  const items = useForgeMindStore((state) => state.items)
  const snapshot = useForgeMindStore((state) => state.simSnapshot)
  const select = useForgeMindStore((state) => state.select)

  const storageObjects = useMemo(
    () => objects.filter((object) => object.type === 'source' || isStorageFacilityType(object.type)),
    [objects],
  )
  const agvCount = objects.filter((object) => object.type === 'agv').length
  const droneCount = objects.filter((object) => object.type === 'drone').length
  const movingAgvCount = snapshot.agvs.filter((agv) => agv.motionStatus === 'moving').length
  const movingDroneCount = snapshot.drones.filter((drone) => drone.motionStatus === 'moving').length
  const conveyorCount = objects.filter((object) => object.type === 'conveyor' || object.type === 'inclineUp' || object.type === 'inclineDown').length
  const activityRows = useMemo(() => {
    const ids = new Set([...Object.keys(snapshot.stats.produced), ...Object.keys(snapshot.stats.consumed)])
    return [...ids].map((id) => ({
      id,
      name: items.find((item) => item.id === id)?.name ?? id,
      produced: snapshot.stats.produced[id] ?? 0,
      consumed: snapshot.stats.consumed[id] ?? 0,
    }))
  }, [items, snapshot.stats.consumed, snapshot.stats.produced])

  const selectStorage = (id: string) => {
    select(id)
    onClose()
  }

  const itemForStorage = (object: (typeof storageObjects)[number]) => items.find((item) => item.id === object.itemId)

  return (
    <section className="fm-warehouse-workspace" aria-label="仓储工作区">
      <header className="fm-warehouse-header">
        <div>
          <span className="fm-eyebrow"><b>07</b> / CARGO STORAGE CONTROL</span>
          <h2>货物仓储</h2>
          <p>把货物存取站、货物仓储架与 AGV / 无人机运输统一放在一张库存控制台中。</p>
          <nav className="fm-warehouse-tabs" aria-label="仓储工作区页面">
            <button type="button" className={tab === 'inventory' ? 'is-active' : ''} onClick={() => setTab('inventory')}>库存控制</button>
            <button type="button" className={tab === 'navigation' ? 'is-active' : ''} onClick={() => setTab('navigation')}>导航控制</button>
          </nav>
        </div>
        <button type="button" className="fm-warehouse-close" onClick={onClose} aria-label="关闭仓储工作区">×</button>
      </header>

      {tab === 'navigation' ? <div className="fm-warehouse-navigation-stack"><AgvNavigationControl /><DroneNavigationControl /></div> : <>
      <div className="fm-warehouse-kpis" aria-label="仓储统计">
        <WarehouseMetric label="货物存取站" value={storageObjects.filter((object) => object.type === 'source').length} note="ACCESS STATIONS" />
        <WarehouseMetric label="货架 / 边界仓库" value={`${storageObjects.filter((object) => object.type === 'oreMiner' || object.type === 'storage').length} / ${storageObjects.filter((object) => object.type === 'inboundWarehouse' || object.type === 'outboundWarehouse').length}`} note="RACKS / IN-OUT" />
        <WarehouseMetric label="AGV / 无人机" value={`${agvCount} / ${droneCount}`} note={`${movingAgvCount} 台 AGV · ${movingDroneCount} 台无人机运行中`} />
        <WarehouseMetric label="在途物料" value={snapshot.itemLots.length} note={`${conveyorCount} 条输送线`} />
      </div>

      <div className="fm-warehouse-grid">
        <section className="fm-warehouse-card fm-warehouse-inventory">
          <div className="fm-warehouse-card-head">
            <div><span className="fm-production-label">INVENTORY RECORDS / 01</span><h3>库存位置</h3></div>
            <span>{storageObjects.length.toString().padStart(2, '0')} LOCATIONS</span>
          </div>
          <div className="fm-warehouse-table-wrap">
            <table className="fm-warehouse-table">
              <thead><tr><th>位置</th><th>内容物</th><th>库存状态</th><th>容量</th></tr></thead>
              <tbody>
                {storageObjects.map((object) => {
                  const isRawRack = object.type === 'oreMiner' || object.type === 'storage'
                  const stationRuntime = object.type === 'source' ? snapshot.sources.find((source) => source.objectId === object.id) : undefined
                  const rackRuntime = isStorageFacilityType(object.type) ? snapshot.racks.find((rack) => rack.objectId === object.id) : undefined
                  const storedEntries = Object.entries(object.type === 'source' ? stationRuntime?.inventory ?? {} : rackRuntime?.inventory ?? {})
                  const item = itemForStorage(object) ?? items.find((entry) => entry.id === storedEntries[0]?.[0])
                  const content = object.type === 'inboundWarehouse'
                    ? `${item?.name ?? '未选择物品'} · 无限供货`
                    : storedEntries.map(([itemId, qty]) => `${items.find((entry) => entry.id === itemId)?.name ?? itemId}×${qty}`).join(' · ') || (object.type === 'source' ? object.stationProgram?.mode === 'store' ? '等待传送带来货' : '未设置或货架缺货' : object.type === 'outboundWarehouse' ? '尚无产出入库' : '空货架')
                  const connectedCount = object.type === 'source' ? Object.keys(stationRuntime?.rackConnections ?? {}).length : 0
                  const total = storedEntries.reduce((sum, [, qty]) => sum + qty, 0)
                  const capacity = isRawRack ? rackRuntime?.capacity ?? object.storageConfig?.capacity ?? 100 : null
                  const stateLabel = object.type === 'source' ? object.stationProgram?.mode === 'store' ? '存货模式' : '取货模式' : object.type === 'inboundWarehouse' ? '无限供货' : object.type === 'outboundWarehouse' ? '只进不出' : total > 0 ? '有库存' : '空货架'
                  return (
                    <tr key={object.id}>
                      <td><button type="button" className="fm-warehouse-location" onClick={() => selectStorage(object.id)}><i className={isRawRack ? 'is-raw' : 'is-finished'} /><span className="fm-warehouse-location-model"><ItemModelThumbnail item={item} /><span><b>{getFactoryObjectDisplayName(object)}</b><small>{object.displayName ? `${getObjectDef(object.type, object.resourceId).label} · ` : ''}{object.id}</small></span></span></button></td>
                      <td><strong className="fm-warehouse-content">{content}</strong><small className="fm-warehouse-muted">{object.type === 'source' ? `${connectedCount}/3 个实际货架已吸附` : object.type === 'inboundWarehouse' ? '取出数量进入消耗台账' : object.type === 'outboundWarehouse' ? '入库数量进入产出台账且不可取回' : '货架对象独立有限库存'}</small></td>
                      <td><span className="fm-warehouse-state"><i />{stateLabel}</span></td>
                      <td><b>{object.type === 'inboundWarehouse' ? '∞' : object.type === 'outboundWarehouse' ? `${total} / ∞` : capacity ? `${total} / ${capacity}` : total}</b><small>units</small></td>
                    </tr>
                  )
                })}
                {storageObjects.length === 0 && <tr><td colSpan={4} className="fm-warehouse-empty">当前场地还没有仓储设施，请从“货物仓储”建造页放置存取站或仓储架。</td></tr>}
              </tbody>
            </table>
          </div>
        </section>

        <section className="fm-warehouse-card fm-warehouse-flow">
          <div className="fm-warehouse-card-head">
            <div><span className="fm-production-label">INTRALOGISTICS / 02</span><h3>运输层</h3></div>
            <span>LIVE LAYERS</span>
          </div>
          <div className="fm-warehouse-layers">
            <div className="fm-warehouse-layer"><span className="fm-warehouse-layer-icon">⇢</span><div><b>传送带</b><small>仓库端口与生产设备之间的固定线路</small></div><strong>{conveyorCount.toString().padStart(2, '0')}</strong></div>
            <div className="fm-warehouse-layer"><span className="fm-warehouse-layer-icon">▰</span><div><b>AGV 地面运输</b><small>{movingAgvCount} 台正在导航 · 货物仓储架 / 线边库之间的托盘搬运</small></div><strong>{agvCount.toString().padStart(2, '0')}</strong></div>
            <div className="fm-warehouse-layer"><span className="fm-warehouse-layer-icon">◇</span><div><b>无人机跨层运输</b><small>轻载物料在不同楼层仓库与货架之间转运</small></div><strong>{droneCount.toString().padStart(2, '0')}</strong></div>
          </div>
          <div className="fm-warehouse-flow-note"><span className="fm-context-dot" /><span>库存数量以仓储记录为准，模型中的纸箱和货架只负责空间表现。</span></div>
        </section>

        <section className="fm-warehouse-card fm-warehouse-activity">
          <div className="fm-warehouse-card-head">
            <div><span className="fm-production-label">MATERIAL LEDGER / 03</span><h3>物料台账</h3></div>
            <span>{snapshot.itemLots.length} IN TRANSIT</span>
          </div>
          {activityRows.length > 0 ? <div className="fm-warehouse-ledger">{activityRows.map((row) => <div key={row.id}><span><i />{row.name}</span><b>+{row.produced}</b><small>−{row.consumed}</small></div>)}</div> : <div className="fm-warehouse-ledger-empty">仿真启动后，仅从入货仓库实际取出的货物记为消耗，送入出货仓库的货物记为产出。</div>}
        </section>
      </div>
      </>}
    </section>
  )
}

function WarehouseMetric({ label, value, note }: { label: string; value: number | string; note: string }) {
  return <div className="fm-warehouse-metric"><span>{label}</span><b>{value}</b><small>{note}</small></div>
}
