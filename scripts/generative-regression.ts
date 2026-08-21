import { BASE_A01_OBJECTS } from '../src/game/baseA01'
import { diagnoseFactory } from '../src/game/factoryDiagnostics'
import { evaluateWhatIf, generateFactoryAdjustments, generateFactoryCandidates, parseGenerationBrief, validateGeneratedLayout, type GenerationSpec } from '../src/game/generativeFactory'
import { SimulationEngine } from '../src/game/simulation'

const defaults: GenerationSpec = {
  product: '齿轮箱',
  targetThroughputPerHour: 120,
  floorWidth: 30,
  floorDepth: 20,
  cncLimit: 4,
  agvLimit: 3,
  objective: 'energy',
}

const parsed = parseGenerationBrief('我要生产齿轮箱。每小时目标 120 件。场地 30m × 20m。CNC 最多 4 台。AGV 最多 3 台。尽量降低能耗。', defaults)
if (parsed.spec.targetThroughputPerHour !== 120 || parsed.spec.floorWidth !== 30 || parsed.spec.cncLimit !== 4 || parsed.spec.objective !== 'energy') {
  throw new Error(`需求解析回归失败：${JSON.stringify(parsed.spec)}`)
}

const candidates = generateFactoryCandidates(parsed.spec)
if (candidates.length !== 3 || candidates.some((candidate) => candidate.recipeGraph.nodes.length < 7 || candidate.equipment.length < 7)) {
  throw new Error('Recipe Graph / 设备估算没有形成完整候选')
}

for (const candidate of candidates) {
  const issues = validateGeneratedLayout(candidate.objects)
  if (issues.length > 0) {
    throw new Error(`${candidate.name}: ${issues.map((issue) => `${issue.objectId} ${issue.message}`).join('；')}`)
  }
  if (candidate.simulation.outputUnits <= 0) {
    throw new Error(`${candidate.name}: 副本仿真没有产出 ${candidate.simulation.outputItemId}`)
  }
  const conveyors = candidate.objects.filter((object) => object.type === 'conveyor').length
  console.log(`✅ ${candidate.name}: ${conveyors} 条传送带，${candidate.simulation.outputUnits} 件成品，吞吐 ${candidate.simulation.throughputPerHour.toFixed(1)}/h，瓶颈：${candidate.simulation.bottleneck}`)
}

console.log(`\n生成布局回归：${candidates.length}/${candidates.length} 通过`)

const diagnosticEngine = new SimulationEngine(20260813)
diagnosticEngine.init(candidates[0].objects, candidates[0].recipeGraph.recipes)
diagnosticEngine.advance(600)
const diagnostic = diagnoseFactory(candidates[0].objects, diagnosticEngine.getSnapshot(), candidates[0].recipeGraph.recipes)
if (diagnostic.throughputPerHour <= 0) throw new Error('动态配方终端成品没有被诊断引擎识别')
console.log(`动态终端成品诊断：${diagnostic.throughputPerHour.toFixed(1)}/h`)

const adjustmentSpec: GenerationSpec = { ...parsed.spec, product: '电机' }
const adjustments = generateFactoryAdjustments(BASE_A01_OBJECTS, adjustmentSpec, 'a01')
if (adjustments.length !== 3 || adjustments.some((candidate) => candidate.mode !== 'adjust' || !candidate.validation.passed || candidate.simulation.outputUnits <= 0)) {
  throw new Error('当前工厂调整引擎没有返回 3 个可验证方案')
}
console.log(`当前工厂调整回归：${adjustments.length}/${adjustments.length} 通过（基线 / 最小重布线 / 完整重构）`)

const scaledSpec: GenerationSpec = {
  ...parsed.spec,
  targetThroughputPerHour: 800,
  cncLimit: 3,
  agvLimit: 3,
  objective: 'throughput',
  searchRounds: 1,
}
const scaledCandidates = generateFactoryCandidates(scaledSpec)
const scaledBest = scaledCandidates.find((candidate) => candidate.equipment.some((item) => item.nodeId === 'machining' && item.count > 1)) ?? scaledCandidates[0]
if (!scaledBest || scaledBest.recipeGraph.nodes.some((node) => node.parallelCount < 1) || scaledBest.equipment.every((item) => item.count <= 1)) {
  throw new Error('自动扩容没有形成可落地的并行设备计划')
}
if (!scaledBest.validation.passed || scaledBest.simulation.outputUnits <= 0) {
  throw new Error(`自动扩容候选不可验证：${scaledBest?.validation.issues.map((issue) => issue.message).join('；')}`)
}
console.log(`自动扩容回归：${scaledBest.equipment.filter((item) => item.count > 1).length} 个工序扩容，${scaledBest.simulation.throughputPerHour.toFixed(1)}/h`)

const whatIf = evaluateWhatIf(candidates[0].objects, parsed.spec, 'add-cnc', 'a02')
if (whatIf.after.simulation.outputUnits <= 0 || !Number.isFinite(whatIf.delta.throughputPerHour) || !whatIf.after.metrics.economics) {
  throw new Error('What-if 试算没有返回有效仿真或经济指标')
}
console.log(`What-if 回归：${whatIf.label}，吞吐变化 ${whatIf.delta.throughputPerHour >= 0 ? '+' : ''}${whatIf.delta.throughputPerHour.toFixed(1)}/h，回本 ${whatIf.delta.paybackMonths?.toFixed(1) ?? '—'} 月`)
