/**
 * 仿真引擎集成测试（一次性验证脚本，非产品代码）。
 *
 * 跑 §7.1 演示脚本的纯逻辑版：
 *   Source(产出铁板) → 传送带[0,0] → 机器[1,0](铁板→齿轮) → 传送带[2,0] → 出口
 * 验证物品沿带流动、机器收料加工、产物吐出、真实货架供货与边界账本隔离。
 *
 * 运行：npx tsx scripts/sim-smoke.ts
 */
import { SimulationEngine } from '../src/game/simulation'
import type { FactoryObject } from '../src/game/types'
import type { Recipe } from '../src/game/item'
import { stationRackDocks } from '../src/game/grid'

// 物品与配方
const ironId = 'item_iron'
const gearId = 'item_gear'
const recipe: Recipe = {
  id: 'recipe_1',
  name: '铁板→齿轮',
  inputs: [{ itemId: ironId, qty: 1 }],
  outputs: [{ itemId: gearId, qty: 1 }],
  durationSec: 1.0,
}

// 布局（rotation 方向：+X=0）
// Source 在 [-1,0] 朝 +X；传送带在 [0,0]、[2,0] 朝 +X；机器在 [1,0] 朝 +X
const station: FactoryObject = { id: 'src', type: 'source', pos: { x: -4, z: -1 }, rotation: 0, itemId: ironId, stationProgram: { mode: 'pickup', transferIntervalSec: 1, rackAssignments: { [ironId]: 'back' } } }
const supplyDock = stationRackDocks(station).find((entry) => entry.side === 'back')!
const objects: FactoryObject[] = [
  station,
  { id: 'rack', type: 'oreMiner', pos: supplyDock.anchor, rotation: 0, storageConfig: { capacity: 100, initialInventory: { [ironId]: 100 } } },
  { id: 'belt_in', type: 'conveyor', pos: { x: 0, z: 0 }, rotation: 0 },
  { id: 'machine', type: 'machine', pos: { x: 1, z: 0 }, rotation: 0, recipeId: recipe.id },
  { id: 'belt_out', type: 'conveyor', pos: { x: 2, z: 0 }, rotation: 0 },
]

const engine = new SimulationEngine(20260813)
engine.init(objects, [recipe])

// 推进 30 秒逻辑时间
engine.advance(30)

const snap = engine.getSnapshot()
console.log('=== 30s 逻辑时间后 ===')
console.log('逻辑时间:', snap.timeSec.toFixed(1), 's')
console.log('在途物品数:', snap.itemLots.length)
console.log('边界产出(齿轮):', snap.stats.produced[gearId] ?? 0)
console.log('边界消耗(铁板):', snap.stats.consumed[ironId] ?? 0)

const machine = snap.machines.find((m) => m.objectId === 'machine')
console.log('机器状态:', machine?.state, '进度:', machine?.progress.toFixed(2))

let pass = true
if (!machine || machine.processingTime <= 0 || !snap.itemLots.some((lot) => lot.itemId === gearId && lot.conveyorId === 'belt_out')) {
  console.error('FAIL: 30s 内机器没有加工并向出料带输出齿轮')
  pass = false
}
if (Object.keys(snap.stats.consumed).length > 0 || Object.keys(snap.stats.produced).length > 0) {
  console.error('FAIL: 普通货架与机器加工不应写入入货/出货边界台账')
  pass = false
}

console.log(pass ? '\n✅ 闭环验证通过' : '\n❌ 闭环验证失败')
process.exit(pass ? 0 : 1)
