/**
 * 仿真引擎回归脚本。
 *
 * 覆盖演示闭环之外最容易回归的路径：
 * - 90° 转弯传送带可以把物料送到下游机器
 * - 分流器能够轮询三条支路
 * - 汇流器能够收集两条输入并满足多输入配方
 * - 下游拒收时传送带头堵，物料不会凭空消失
 *
 * 运行：npm run sim:regression
 */
import { SimulationEngine } from '../src/game/simulation'
import type { FactoryObject } from '../src/game/types'
import type { Recipe } from '../src/game/item'
import { stationRackDocks } from '../src/game/grid'

const iron = 'item_iron'
const gear = 'item_gear'

function recipe(id: string, qty = 1): Recipe {
  return {
    id,
    name: id,
    inputs: [{ itemId: iron, qty }],
    outputs: [{ itemId: gear, qty: 1 }],
    durationSec: 1,
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function withRackSupply(objects: FactoryObject[]): FactoryObject[] {
  return objects.flatMap((object) => {
    if (object.type !== 'source' || !object.itemId) return [object]
    const station: FactoryObject = { ...object, stationProgram: { mode: 'pickup', transferIntervalSec: 1, rackAssignments: { [object.itemId]: 'back' } } }
    const dock = stationRackDocks(station).find((entry) => entry.side === 'back')!
    const rack: FactoryObject = { id: `${object.id}-rack`, type: 'oreMiner', pos: dock.anchor, rotation: 0, floorId: object.floorId, storageConfig: { capacity: 1000, initialInventory: { [object.itemId]: 1000 } } }
    return [station, rack]
  })
}

function runCase(name: string, fn: () => void): boolean {
  try {
    fn()
    console.log(`✅ ${name}`)
    return true
  } catch (error) {
    console.error(`❌ ${name}: ${(error as Error).message}`)
    return false
  }
}

function closedLoop(): void {
  const r = recipe('closed-loop')
  const objects: FactoryObject[] = [
    { id: 'src', type: 'source', pos: { x: -4, z: -1 }, rotation: 0, itemId: iron },
    { id: 'in', type: 'conveyor', pos: { x: 0, z: 0 }, rotation: 0 },
    { id: 'machine', type: 'machine', pos: { x: 1, z: 0 }, rotation: 0, recipeId: r.id },
    { id: 'out', type: 'conveyor', pos: { x: 2, z: 0 }, rotation: 0 },
  ]
  const engine = new SimulationEngine(20260813)
  engine.init(withRackSupply(objects), [r])
  engine.advance(30)
  const snap = engine.getSnapshot()
  const machine = snap.machines.find((runtime) => runtime.objectId === 'machine')
  assert(Math.abs(snap.timeSec - 30) < 0.05, `逻辑时间应接近 30s，实际为 ${snap.timeSec}`)
  assert(machine && machine.processingTime > 0, '闭环机器没有加工物料')
  assert(Object.keys(snap.stats.consumed).length === 0 && Object.keys(snap.stats.produced).length === 0, '普通货架与机器内部转换不应写入工厂边界账本')
}

function turningRoute(): void {
  const r = recipe('turning-route')
  const objects: FactoryObject[] = [
    { id: 'src', type: 'source', pos: { x: -1, z: -3 }, rotation: 90, itemId: iron },
    { id: 'vertical', type: 'conveyor', pos: { x: 0, z: 1 }, rotation: 90 },
    { id: 'corner', type: 'conveyor', pos: { x: 0, z: 2 }, rotation: 0 },
    { id: 'horizontal', type: 'conveyor', pos: { x: 1, z: 2 }, rotation: 0 },
    { id: 'machine', type: 'machine', pos: { x: 2, z: 2 }, rotation: 0, recipeId: r.id },
  ]
  const engine = new SimulationEngine(11)
  engine.init(withRackSupply(objects), [r])
  engine.advance(24)
  const snap = engine.getSnapshot()
  assert((snap.machines.find((runtime) => runtime.objectId === 'machine')?.processingTime ?? 0) > 0, '转弯线路没有把物料送到机器')
}

function splitterRoute(): void {
  const r = recipe('splitter-route')
  const objects: FactoryObject[] = [
    { id: 'src', type: 'source', pos: { x: -4, z: -1 }, rotation: 0, itemId: iron },
    { id: 'feed', type: 'conveyor', pos: { x: 0, z: 0 }, rotation: 0 },
    { id: 'split', type: 'splitter', pos: { x: 1, z: 0 }, rotation: 0 },
    { id: 'east-belt', type: 'conveyor', pos: { x: 2, z: 0 }, rotation: 0 },
    { id: 'east-machine', type: 'machine', pos: { x: 3, z: 0 }, rotation: 0, recipeId: r.id },
    { id: 'north-belt', type: 'conveyor', pos: { x: 1, z: 1 }, rotation: 90 },
    { id: 'north-machine', type: 'machine', pos: { x: 1, z: 2 }, rotation: 90, recipeId: r.id },
    { id: 'south-belt', type: 'conveyor', pos: { x: 1, z: -1 }, rotation: 270 },
    { id: 'south-machine', type: 'machine', pos: { x: 1, z: -2 }, rotation: 270, recipeId: r.id },
  ]
  const engine = new SimulationEngine(12)
  engine.init(withRackSupply(objects), [r])
  engine.advance(36)
  const snap = engine.getSnapshot()
  for (const id of ['east-machine', 'north-machine', 'south-machine']) {
    const runtime = snap.machines.find((machine) => machine.objectId === id)
    assert(runtime && runtime.processingTime > 0, `分流支路 ${id} 没有处理物料`)
  }
}

function mergerRoute(): void {
  const r = recipe('merger-route', 2)
  const objects: FactoryObject[] = [
    { id: 'src-a', type: 'source', pos: { x: -4, z: -1 }, rotation: 0, itemId: iron },
    { id: 'belt-a', type: 'conveyor', pos: { x: 0, z: 0 }, rotation: 0 },
    { id: 'src-b', type: 'source', pos: { x: 0, z: 2 }, rotation: 270, itemId: iron },
    { id: 'belt-b', type: 'conveyor', pos: { x: 1, z: 1 }, rotation: 270 },
    { id: 'merge', type: 'merger', pos: { x: 1, z: 0 }, rotation: 0 },
    { id: 'out', type: 'conveyor', pos: { x: 2, z: 0 }, rotation: 0 },
    { id: 'machine', type: 'machine', pos: { x: 3, z: 0 }, rotation: 0, recipeId: r.id },
  ]
  const engine = new SimulationEngine(13)
  engine.init(withRackSupply(objects), [r])
  engine.advance(36)
  const snap = engine.getSnapshot()
  assert((snap.machines.find((runtime) => runtime.objectId === 'machine')?.processingTime ?? 0) > 0, '汇流线路没有完成双输入加工')
}

function blockedHead(): void {
  const r = recipe('blocked-head')
  const objects: FactoryObject[] = [
    { id: 'src', type: 'source', pos: { x: -4, z: -1 }, rotation: 0, itemId: iron },
    { id: 'belt', type: 'conveyor', pos: { x: 0, z: 0 }, rotation: 0 },
    // 没有绑定配方的机器会拒收物料，模拟下游停机造成的头堵。
    { id: 'blocked-machine', type: 'machine', pos: { x: 1, z: 0 }, rotation: 0 },
  ]
  const engine = new SimulationEngine(14)
  engine.init(withRackSupply(objects), [r])
  engine.advance(8)
  const snap = engine.getSnapshot()
  const lot = snap.itemLots.find((item) => item.conveyorId === 'belt')
  assert(lot, '头堵时物料不应消失')
  assert(lot.offset === 1, `头堵物料应停在末端，实际 offset=${lot.offset}`)
  assert((snap.stats.produced[gear] ?? 0) === 0, '头堵场景不应有产出')
}

function largeMachineMiddleLanes(): void {
  const r = recipe('large-machine-middle-lanes')
  const objects: FactoryObject[] = [
    { id: 'src', type: 'source', pos: { x: -3, z: -1 }, rotation: 0, itemId: iron },
    { id: 'in-a', type: 'conveyor', pos: { x: 1, z: 0 }, rotation: 0 },
    { id: 'in-b', type: 'conveyor', pos: { x: 2, z: 0 }, rotation: 0 },
    // The 3x2 machine accepts either of its two central inlet lanes.
    { id: 'large', type: 'smelter', pos: { x: 3, z: 0 }, rotation: 0, recipeId: r.id },
    // Use the other central outlet lane to prove output routing is symmetric.
    { id: 'out', type: 'conveyor', pos: { x: 6, z: 1 }, rotation: 0 },
  ]
  const engine = new SimulationEngine(15)
  engine.init(withRackSupply(objects), [r])
  engine.advance(24)
  const snap = engine.getSnapshot()
  const machine = snap.machines.find((runtime) => runtime.objectId === 'large')
  assert(machine && machine.processingTime > 0, '大尺寸设备没有从中间入口通道收料')
  assert(snap.itemLots.some((lot) => lot.itemId === gear && lot.conveyorId === 'out'), '大尺寸设备没有从中间出口向传送带出货')
}

function sourceTransferLifecycle(): void {
  const objects: FactoryObject[] = [
    { id: 'src', type: 'source', pos: { x: -4, z: -1 }, rotation: 0, itemId: iron },
    { id: 'belt', type: 'conveyor', pos: { x: 0, z: 0 }, rotation: 0 },
  ]
  const engine = new SimulationEngine(16)
  engine.init(withRackSupply(objects), [])
  let sawPicking = false
  let sawPlacing = false
  let sawGridLot = false
  for (let step = 0; step < 100; step++) {
    engine.advance(0.05)
    const snapshot = engine.getSnapshot()
    const state = snapshot.sources.find((source) => source.objectId === 'src')?.state
    sawPicking ||= state === 'picking'
    sawPlacing ||= state === 'placing'
    sawGridLot ||= snapshot.itemLots.some((lot) => lot.conveyorId === 'belt')
  }
  assert(sawPicking && sawPlacing, 'source did not pass through picking and placing states')
  assert(sawGridLot, 'source did not hand the item to the grid conveyor')
}

function visibleMachineInterfaceRoute(): void {
  const r = recipe('visible-machine-interface')
  const objects: FactoryObject[] = [
    { id: 'src', type: 'source', pos: { x: -8, z: -1 }, rotation: 0, itemId: iron },
    { id: 'in-a', type: 'conveyor', pos: { x: -4, z: 0 }, rotation: 0 },
    // The final infeed belt and first outfeed belt sit directly on the
    // visible blue/yellow beacons of the 2.5x production model.
    { id: 'in-port', type: 'conveyor', pos: { x: -3, z: 0 }, rotation: 0 },
    { id: 'machine', type: 'smelter', pos: { x: 0, z: 0 }, rotation: 0, recipeId: r.id },
    { id: 'out-port', type: 'conveyor', pos: { x: 5, z: 0 }, rotation: 0 },
  ]
  const engine = new SimulationEngine(18)
  engine.init(withRackSupply(objects), [r])
  engine.advance(24)
  const snapshot = engine.getSnapshot()
  const machine = snapshot.machines.find((runtime) => runtime.objectId === 'machine')
  assert(machine && machine.processingTime > 0, '外置蓝色标记上的传送带没有向机器供货')
  assert(snapshot.itemLots.some((lot) => lot.itemId === gear && lot.conveyorId === 'out-port'), '机器没有从外置黄色标记向传送带出货')
}

function openBeltEndRetainsCargo(): void {
  const objects: FactoryObject[] = [
    { id: 'src', type: 'source', pos: { x: -4, z: -1 }, rotation: 0, itemId: iron },
    { id: 'belt', type: 'conveyor', pos: { x: 0, z: 0 }, rotation: 0 },
  ]
  const engine = new SimulationEngine(19)
  engine.init(withRackSupply(objects), [])
  engine.advance(8)
  const lot = engine.getSnapshot().itemLots.find((item) => item.conveyorId === 'belt')
  assert(lot?.offset === 1, '未连接的传送带末端必须保留货物并形成背压')
}

function longAdvance(): void {
  const engine = new SimulationEngine(17)
  engine.init([], [])
  engine.advance(1800)
  assert(Math.abs(engine.getSnapshot().timeSec - 1800) < 0.05, `长时仿真被截断为 ${engine.getSnapshot().timeSec}s`)
}

const cases: Array<[string, () => void]> = [
  ['基础闭环', closedLoop],
  ['90° 转弯线路', turningRoute],
  ['三向分流', splitterRoute],
  ['双输入汇流', mergerRoute],
  ['下游拒收头堵', blockedHead],
]

cases.push(['large-machine-middle-lanes', largeMachineMiddleLanes])
cases.push(['source-transfer-lifecycle', sourceTransferLifecycle])
cases.push(['visible-machine-interface-route', visibleMachineInterfaceRoute])
cases.push(['open-belt-end-retains-cargo', openBeltEndRetainsCargo])
cases.push(['long-advance-no-truncation', longAdvance])

const passed = cases.filter(([name, fn]) => runCase(name, fn)).length
console.log(`\n仿真回归：${passed}/${cases.length} 通过`)
if (passed !== cases.length) process.exit(1)
