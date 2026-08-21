/**
 * 背压验证：传送带下游是另一条「死路」传送带（无出口）时，
 * 物品应在末端停住，不会凭空消失，也不会穿透。
 */
import { SimulationEngine } from '../src/game/simulation'
import type { FactoryObject } from '../src/game/types'
import type { Recipe } from '../src/game/item'
import { stationRackDocks } from '../src/game/grid'

const ironId = 'item_iron'
const gearId = 'item_gear'
const recipe: Recipe = {
  id: 'r',
  name: '铁→齿',
  inputs: [{ itemId: ironId, qty: 1 }],
  outputs: [{ itemId: gearId, qty: 1 }],
  durationSec: 1.0,
}

// 没有绑定配方的机器会拒收物料，模拟下游停机造成的头堵。
const station: FactoryObject = { id: 'src', type: 'source', pos: { x: -4, z: -1 }, rotation: 0, itemId: ironId, stationProgram: { mode: 'pickup', transferIntervalSec: 1, rackAssignments: { [ironId]: 'back' } } }
const supplyDock = stationRackDocks(station).find((entry) => entry.side === 'back')!
const objects: FactoryObject[] = [
  station,
  { id: 'rack', type: 'oreMiner', pos: supplyDock.anchor, rotation: 0, storageConfig: { capacity: 20, initialInventory: { [ironId]: 20 } } },
  { id: 'belt', type: 'conveyor', pos: { x: 0, z: 0 }, rotation: 0 },
  { id: 'blocked-machine', type: 'machine', pos: { x: 1, z: 0 }, rotation: 0 },
]

const engine = new SimulationEngine(1)
engine.init(objects, [recipe])
engine.advance(20)

const snap = engine.getSnapshot()
const lot = snap.itemLots.find((l) => l.conveyorId === 'belt')
console.log('belt 上的物品:', lot ? `offset=${lot.offset.toFixed(2)}` : '无')

// 头堵时应停在下游末端 offset≈1，不消失
if (lot && lot.offset === 1 && (snap.stats.produced[gearId] ?? 0) === 0) {
  console.log('✅ 背压生效：物品没有凭空消失')
} else {
  console.log('❌ 背压失效：物品消失了')
  process.exit(1)
}
