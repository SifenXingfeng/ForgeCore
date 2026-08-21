import type { Recipe } from './item'
import type { SimulationSnapshot } from './simulation'
import { objectCompatiblePortCells, occupiedCells } from './grid'
import { cellKey } from './dir'
import { objectRole, type FactoryFloorId, type FactoryObject } from './types'

function diagnosticCellKey(object: Pick<FactoryObject, 'floorId'>, x: number, z: number): string {
  return `${object.floorId ?? 1}:${cellKey(x, z)}`
}

function floorLabel(floorId: number | undefined): string {
  return `L${floorId ?? 1}`
}

export interface FactoryFloorDiagnostic {
  floorId: FactoryFloorId
  status: 'STABLE' | 'ATTENTION' | 'BLOCKED'
  score: number
  throughputPerHour: number
  utilization: number
  totalObjects: number
  machineCount: number
  activeMachines: number
  blockedSources: number
  disconnectedSources: number
  backpressureSources: number
  itemLots: number
  openIssues: string[]
  recommendation: string
}

export interface FactoryDiagnosticState {
  status: 'STABLE' | 'ATTENTION' | 'BLOCKED'
  score: number
  throughputPerHour: number
  utilization: number
  activeMachines: number
  blockedSources: number
  disconnectedSources: number
  backpressureSources: number
  openIssues: string[]
  recommendation: string
  floors: FactoryFloorDiagnostic[]
}

/** Read-only live diagnosis shared by A-01 and A-02. */
export function diagnoseFactory(
  objects: FactoryObject[],
  snapshot: SimulationSnapshot,
  recipes: Recipe[],
  floorCount = Math.max(3, ...objects.map((object) => object.floorId ?? 1)),
): FactoryDiagnosticState {
  const recipeIds = new Set(recipes.map((recipe) => recipe.id))
  const machines = objects.filter((object) => objectRole(object.type) === 'machine')
  const objectsByCell = new Map<string, FactoryObject>()
  for (const object of objects) {
    for (const cell of occupiedCells(object)) objectsByCell.set(diagnosticCellKey(object, cell.x, cell.z), object)
  }
  const blockedSources = snapshot.sources.filter((source) => source.state === 'blocked').length
  const sourceObjects = objects.filter((object) => object.type === 'source' && object.itemId)
  const disconnectedSourcesByFloor = new Map<number, number>()
  const disconnectedSourceIds = new Set(sourceObjects.filter((source) => !objectCompatiblePortCells(source, 'output').some((cell) => {
    const downstream = objectsByCell.get(diagnosticCellKey(source, cell.x, cell.z))
    if (!downstream) return false
    if ((downstream.floorId ?? 1) !== (source.floorId ?? 1)) return false
    const inputCells = objectCompatiblePortCells(downstream, 'input')
    return inputCells.length === 0 || occupiedCells(source).some((occupied) => inputCells.some((input) => occupied.x === input.x && occupied.z === input.z))
  })).map((source) => {
    const floorId = source.floorId ?? 1
    disconnectedSourcesByFloor.set(floorId, (disconnectedSourcesByFloor.get(floorId) ?? 0) + 1)
    return source.id
  }))
  const disconnectedSources = disconnectedSourceIds.size
  const backpressureSources = snapshot.sources.filter((source) => source.state === 'blocked' && !disconnectedSourceIds.has(source.objectId)).length
  const targetItemId = inferTargetItemId(recipes)
  const noRecipeMachines = machines.filter((machine) => !machine.recipeId || !recipeIds.has(machine.recipeId)).length
  const activeMachines = snapshot.machines.filter((machine) => machine.state === 'processing' || machine.state === 'output').length
  const throughputPerHour = snapshot.timeSec > 0
    ? ((snapshot.stats.produced[targetItemId] ?? 0) / snapshot.timeSec) * 3600
    : 0
  const utilization = machines.length === 0 || snapshot.timeSec <= 0
    ? 0
    : Math.min(100, (snapshot.machines.reduce((sum, machine) => sum + machine.processingTime, 0) / (machines.length * snapshot.timeSec)) * 100)
  const openIssues: string[] = []

  if (objects.length === 0) openIssues.push('当前场地还没有设备')
  if (noRecipeMachines > 0) openIssues.push(`${noRecipeMachines} 台设备没有有效配方`)
  if (disconnectedSources > 0) {
    const floorSummary = [...disconnectedSourcesByFloor.entries()].map(([floorId, count]) => `${floorLabel(floorId)} ${count}`).join(' · ')
    openIssues.push(`${disconnectedSources} 个来料站没有有效物流接口${floorSummary ? `（${floorSummary}）` : ''}`)
  }
  if (backpressureSources > 0) openIssues.push(`${backpressureSources} 个来料站受到下游满载背压`)
  if (snapshot.itemLots.length > Math.max(6, objects.length * 0.7)) openIssues.push('在途物料堆积，物流节拍可能低于加工节拍')

  const status = disconnectedSources > 0 || noRecipeMachines > 0
    ? 'BLOCKED'
    : openIssues.length > 0
      ? 'ATTENTION'
      : 'STABLE'
  const score = Math.max(0, Math.round(100 - disconnectedSources * 24 - backpressureSources * 4 - noRecipeMachines * 16 - Math.max(0, snapshot.itemLots.length - objects.length * 0.35) * 2))
  const recommendation = status === 'BLOCKED'
    ? '先修复断开的来料接口和无配方设备，再运行布局优化。'
    : status === 'ATTENTION'
      ? '建议运行一次副本诊断，检查下游满载背压是否需要增加缓存或并行设备。'
      : '当前结构可以继续仿真；可用 Generative Factory 比较下一轮布局。'

  const floors = Array.from({ length: Math.max(1, floorCount) }, (_, index) => index + 1).map((floorId): FactoryFloorDiagnostic => {
    const floorObjects = objects.filter((object) => (object.floorId ?? 1) === floorId)
    const floorMachines = floorObjects.filter((object) => objectRole(object.type) === 'machine')
    const floorMachineIds = new Set(floorMachines.map((machine) => machine.id))
    const floorSourceIds = new Set(sourceObjects.filter((source) => (source.floorId ?? 1) === floorId).map((source) => source.id))
    const floorMachinesRuntime = snapshot.machines.filter((machine) => floorMachineIds.has(machine.objectId))
    const floorSourcesRuntime = snapshot.sources.filter((source) => floorSourceIds.has(source.objectId))
    const floorDisconnectedSources = sourceObjects.filter((source) => (source.floorId ?? 1) === floorId && disconnectedSourceIds.has(source.id)).length
    const floorBlockedSources = floorSourcesRuntime.filter((source) => source.state === 'blocked').length
    const floorBackpressureSources = floorSourcesRuntime.filter((source) => source.state === 'blocked' && !disconnectedSourceIds.has(source.objectId)).length
    const floorStats = snapshot.floorStats[floorId] ?? { consumed: {}, produced: {} }
    const floorLots = snapshot.itemLots.filter((lot) => lot.floorId === floorId).length
    const floorNoRecipeMachines = floorMachines.filter((machine) => !machine.recipeId || !recipeIds.has(machine.recipeId)).length
    const floorActiveMachines = floorMachinesRuntime.filter((machine) => machine.state === 'processing' || machine.state === 'output').length
    const floorThroughputPerHour = snapshot.timeSec > 0
      ? ((floorStats.produced[targetItemId] ?? 0) / snapshot.timeSec) * 3600
      : 0
    const floorUtilization = floorMachines.length === 0 || snapshot.timeSec <= 0
      ? 0
      : Math.min(100, (floorMachinesRuntime.reduce((sum, machine) => sum + machine.processingTime, 0) / (floorMachines.length * snapshot.timeSec)) * 100)
    const floorIssues: string[] = []

    if (floorObjects.length === 0) floorIssues.push('本楼层尚未布置设备')
    if (floorNoRecipeMachines > 0) floorIssues.push(`${floorNoRecipeMachines} 台设备没有有效配方`)
    if (floorDisconnectedSources > 0) floorIssues.push(`${floorDisconnectedSources} 个来料站没有有效物流接口`)
    if (floorBackpressureSources > 0) floorIssues.push(`${floorBackpressureSources} 个来料站受到满载背压`)
    if (floorLots > Math.max(6, floorObjects.length * 0.7)) floorIssues.push('在途物料堆积')

    const floorStatus = floorDisconnectedSources > 0 || floorNoRecipeMachines > 0
      ? 'BLOCKED'
      : floorIssues.length > 0
        ? 'ATTENTION'
        : 'STABLE'
    const floorScore = Math.max(0, Math.round(100 - floorDisconnectedSources * 24 - floorBackpressureSources * 4 - floorNoRecipeMachines * 16 - Math.max(0, floorLots - floorObjects.length * 0.35) * 2))
    const floorRecommendation = floorStatus === 'BLOCKED'
      ? `先修复 ${floorLabel(floorId)} 的断开接口或无配方设备，再运行副本仿真。`
      : floorStatus === 'ATTENTION'
        ? `建议检查 ${floorLabel(floorId)} 的缓存容量与运输节拍，再生成调整方案。`
        : `${floorLabel(floorId)} 当前链路稳定，可继续参与全厂仿真。`

    return {
      floorId,
      status: floorStatus,
      score: floorScore,
      throughputPerHour: floorThroughputPerHour,
      utilization: floorUtilization,
      totalObjects: floorObjects.length,
      machineCount: floorMachines.length,
      activeMachines: floorActiveMachines,
      blockedSources: floorBlockedSources,
      disconnectedSources: floorDisconnectedSources,
      backpressureSources: floorBackpressureSources,
      itemLots: floorLots,
      openIssues: floorIssues,
      recommendation: floorRecommendation,
    }
  })

  return { status, score, throughputPerHour, utilization, activeMachines, blockedSources, disconnectedSources, backpressureSources, openIssues, recommendation, floors }
}

function inferTargetItemId(recipes: Recipe[]): string {
  const inspectionOutputs = recipes
    .filter((recipe) => /inspection|inspect|质检|检/i.test(`${recipe.id} ${recipe.name}`))
    .flatMap((recipe) => recipe.outputs)
  const inspectionOutput = inspectionOutputs[inspectionOutputs.length - 1]?.itemId
  if (inspectionOutput) return inspectionOutput

  const consumed = new Set(recipes.flatMap((recipe) => recipe.inputs.map((port) => port.itemId)))
  return recipes.flatMap((recipe) => recipe.outputs).find((port) => !consumed.has(port.itemId))?.itemId ?? 'item_inspected_motor'
}
