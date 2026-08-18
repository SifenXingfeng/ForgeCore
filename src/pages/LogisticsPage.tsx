import { Box, Boxes, Plane, Route, Truck, Warehouse } from 'lucide-react'
import { Panel, StatusBadge } from '../components/ui'
import { useForgeStore } from '../store/useForgeStore'

export function LogisticsPage() {
  const { transportCapabilities, objects, inventory, items, simulation, adjustInventory, setInventoryInfiniteSupply } = useForgeStore()
  const warehouses = objects.filter((object) => object.kind === 'rack')
  const shelves = objects.filter((object) => object.kind === 'shelf')
  const conveyors = objects.filter((object) => object.kind === 'conveyor')
  const vehicles = objects.filter((object) => object.kind === 'agv' || object.kind === 'drone')
  const activeAgvs = Object.values(simulation.agvRuntime ?? {}).filter((runtime) => runtime.motionStatus === 'moving' || runtime.motionStatus === 'yielding').length
  const activeDrones = Object.values(simulation.droneRuntime ?? {}).filter((runtime) => runtime.motionStatus === 'moving' || runtime.motionStatus === 'yielding').length

  return (
    <div className="page">
      <header className="page-heading">
        <div><span className="eyebrow">INTRALOGISTICS / CAPABILITY LAYERS</span><h1>物流与仓储</h1><p>传送带、1F AGV 与跨层无人机均已接入真实库存结算；无人机使用 26 邻域三维 A*、净空列安全下降和多机协调。</p></div>
        <StatusBadge tone="info">{conveyors.length} 条输送对象 · {activeAgvs} 台 AGV / {activeDrones} 架无人机运行</StatusBadge>
      </header>

      <div className="capability-grid">
        {transportCapabilities.map((capability) => <article className={`capability-card capability-card--${capability.mode}`} key={capability.id}>
          <div className="capability-card__icon">{capability.mode === 'conveyor' ? <Route /> : capability.mode === 'agv' ? <Truck /> : <Plane />}</div>
          <div className="capability-card__head"><span className="eyebrow">{capability.mode.toUpperCase()}</span><StatusBadge tone={capability.status === 'available' ? 'success' : capability.status === 'runtime-asset-pending' ? 'warning' : 'neutral'}>{statusLabel(capability.status)}</StatusBadge></div>
          <h2>{capability.label}</h2>
        </article>)}
      </div>

      <div className="logistics-grid">
        <Panel title="仓储库存" eyebrow="MANUAL INVENTORY CONTROL" action={<StatusBadge tone="success">变更可保存</StatusBadge>}>
          <div className="inventory-table-wrap"><table className="inventory-table"><thead><tr><th>位置</th><th>物品</th><th>数量</th><th>供应方式</th><th>出库预留</th><th>入库占位</th><th>容量</th><th>调整</th></tr></thead><tbody>
            {inventory.map((record) => {
              const item = items.find((candidate) => candidate.id === record.itemId)
              const infinite = record.infiniteSupply === true
              const storageId = record.locationType === 'rack-slot' ? record.locationId.split(':')[0] : null
              const storageObject = storageId ? objects.find((object) => object.id === storageId) : undefined
              const unbounded = storageObject?.kind === 'shelf'
              return <tr key={record.id}><td><span className="table-leading-icon"><Box size={14} />{storageObject?.name ?? record.locationId}</span></td><td><strong>{item?.name ?? record.itemId}</strong><small>{item?.code}</small></td><td className="numeric-cell">{infinite ? '∞' : record.quantity}{infinite ? <small>实存 {record.quantity}</small> : null}</td><td>{record.locationType === 'rack-slot' ? <button className={`inventory-supply-toggle ${infinite ? 'is-active' : ''}`} aria-pressed={infinite} onClick={() => setInventoryInfiniteSupply(record.id, !infinite)}>{infinite ? '无限供应' : '有限库存'}</button> : <span>有限库存</span>}</td><td className="numeric-cell">{record.reservedOutboundQuantity ?? 0}</td><td className="numeric-cell">{record.reservedInboundCapacity ?? 0}</td><td className="numeric-cell">{unbounded ? '∞' : record.capacity}</td><td><span className="stepper"><button aria-label={`减少 ${item?.name ?? '库存'}`} onClick={() => adjustInventory(record.id, -1)} disabled={infinite || record.quantity <= (record.reservedOutboundQuantity ?? 0)}>−</button><button aria-label={`增加 ${item?.name ?? '库存'}`} onClick={() => adjustInventory(record.id, 1)} disabled={infinite || (!unbounded && record.quantity >= record.capacity)}>＋</button></span></td></tr>
            })}
          </tbody></table></div>
        </Panel>

        <Panel title="场景物流对象" eyebrow="SCENE INVENTORY">
          <div className="resource-stat"><Route /><span><strong>{conveyors.length}</strong>输送对象</span><StatusBadge tone="success">运行可用</StatusBadge></div>
          <div className="resource-stat"><Warehouse /><span><strong>{warehouses.length}</strong>货物仓库</span><StatusBadge tone="success">输送可用</StatusBadge></div>
          <div className="resource-stat"><Boxes /><span><strong>{shelves.length}</strong>货架</span><StatusBadge tone="success">无限堆叠</StatusBadge></div>
          <div className="resource-stat"><Truck /><span><strong>{vehicles.filter((v) => v.kind === 'agv').length}</strong>AGV 实体</span><StatusBadge tone="success">运输可用</StatusBadge></div>
          <div className="resource-stat"><Plane /><span><strong>{vehicles.filter((v) => v.kind === 'drone').length}</strong>无人机实体</span><StatusBadge tone="success">跨层运输可用</StatusBadge></div>
        </Panel>
      </div>
    </div>
  )
}

function statusLabel(status: string) { return ({ available: '运行可用', 'runtime-asset-pending': '资产待派生', planned: '规划中' } as Record<string, string>)[status] ?? status }
