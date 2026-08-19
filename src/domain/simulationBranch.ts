import type { FactoryMetrics, FactoryObject, ForgeProjectData, MachineRuntimeState, Recipe } from '../types'
import { runSimulationSteps, type AdvanceSimulationKernel } from './advanceSimulation'

export interface SimulationBranchOperation {
  op: 'add_object' | 'remove_object' | 'update_object' | 'adjust_inventory'
  object_id?: string
  object?: Record<string, unknown>
  changes?: Record<string, unknown>
  unset?: string[]
  item_id?: string
  quantity?: number
}

export interface SimulationBranchMetrics {
  throughputPerMin: number
  totalProduced: number
  workInProgress: number
  blockedObjects: number
  averageTransportSec: number
  inventoryTotal: number
}

export interface SimulationBranchResult {
  branchId: string
  horizonSec: number
  steps: number
  baseline: SimulationBranchMetrics
  proposal: SimulationBranchMetrics
  delta: SimulationBranchMetrics
  throughputImprovementPercent: number | null
  score: number
  recommendation: 'apply' | 'iterate' | 'discard'
}

const clone = <T>(value: T): T => structuredClone(value)

function machineRuntime(machineObjectId: string, recipe: Recipe): MachineRuntimeState {
  return {
    machineObjectId,
    recipeId: recipe.id,
    state: 'waiting-input',
    progress: 0,
    cycleRemainingSec: 0,
    inputBuffer: Object.fromEntries(recipe.inputs.map((line) => [line.itemId, 0])),
    outputBuffer: Object.fromEntries(recipe.outputs.map((line) => [line.itemId, 0])),
    processedCycles: 0,
    busySeconds: 0,
    idleSeconds: 0,
    blockedSeconds: 0,
  }
}

function deepMerge(target: Record<string, unknown>, changes: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(changes)) {
    if (value && typeof value === 'object' && !Array.isArray(value) && target[key] && typeof target[key] === 'object' && !Array.isArray(target[key])) {
      deepMerge(target[key] as Record<string, unknown>, value as Record<string, unknown>)
    } else target[key] = clone(value)
  }
}

export function applySimulationBranchOperations(project: ForgeProjectData, operations: SimulationBranchOperation[]): ForgeProjectData {
  const candidate = clone(project)
  for (const operation of operations) {
    if (operation.op === 'adjust_inventory' && operation.object_id && operation.item_id) {
      const record = candidate.inventory.find((item) => (
        item.locationId === operation.object_id && item.itemId === operation.item_id
      ))
      if (record && Number.isFinite(operation.quantity)) record.quantity = Math.max(0, Number(operation.quantity))
      continue
    }
    if (operation.op === 'remove_object' && operation.object_id) {
      candidate.objects = candidate.objects.filter((object) => object.id !== operation.object_id)
      candidate.inventory = candidate.inventory.filter((record) => record.locationId !== operation.object_id && !record.locationId.startsWith(`${operation.object_id}:`))
      delete candidate.simulation.machineRuntime[operation.object_id]
      delete candidate.simulation.agvRuntime[operation.object_id]
      delete candidate.simulation.droneRuntime[operation.object_id]
      candidate.simulation.transitItems = candidate.simulation.transitItems.filter((item) => item.fromObjectId !== operation.object_id && item.toObjectId !== operation.object_id && item.conveyorObjectId !== operation.object_id)
      continue
    }
    if (operation.op === 'update_object' && operation.object_id && operation.changes) {
      const object = candidate.objects.find((item) => item.id === operation.object_id)
      if (!object) continue
      deepMerge(object as unknown as Record<string, unknown>, operation.changes)
      for (const key of operation.unset ?? []) delete (object as unknown as Record<string, unknown>)[key]
      continue
    }
    if (operation.op !== 'add_object' || !operation.object) continue
    const raw = operation.object
    const transform = raw.transform && typeof raw.transform === 'object' ? raw.transform as Record<string, unknown> : raw
    const footprint = raw.footprint && typeof raw.footprint === 'object' ? raw.footprint as Record<string, unknown> : raw
    const kind = String(raw.kind ?? '') as FactoryObject['kind']
    const id = String(raw.id ?? `branch-object-${candidate.objects.length + 1}`)
    const object: FactoryObject = {
      id,
      factoryId: candidate.factory.id,
      floorId: String(raw.floorId ?? candidate.floors[0]?.id ?? ''),
      kind,
      name: String(raw.name ?? `Branch ${kind}`),
      modelRef: typeof raw.modelRef === 'string' ? raw.modelRef : null,
      transform: { x: Number(transform.x) || 0, z: Number(transform.z) || 0, rotationY: ([0, 90, 180, 270].includes(Number(transform.rotationY)) ? Number(transform.rotationY) : 0) as 0 | 90 | 180 | 270 },
      footprint: { width: Number(footprint.width) || 1, depth: Number(footprint.depth) || 1 },
      status: 'ready',
      config: clone(raw.config) as FactoryObject['config'],
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
    }
    candidate.objects.push(object)
    if (kind === 'machine' && object.config.kind === 'machine' && object.config.recipeId) {
      const recipeId = object.config.recipeId
      const recipe = candidate.recipes.find((item) => item.id === recipeId)
      if (recipe) candidate.simulation.machineRuntime[id] = machineRuntime(id, recipe)
    }
  }
  return candidate
}

function metrics(value: FactoryMetrics, producedDuringBranch: number): SimulationBranchMetrics {
  return {
    throughputPerMin: value.currentThroughputPerMin,
    totalProduced: producedDuringBranch,
    workInProgress: value.workInProgress,
    blockedObjects: value.blockedObjectCount,
    averageTransportSec: value.averageTransportSec,
    inventoryTotal: value.inventoryTotal,
  }
}

export function compareSimulationBranches(baseProject: ForgeProjectData, operations: SimulationBranchOperation[], horizonSec: number, kernel: AdvanceSimulationKernel): SimulationBranchResult {
  const baseline = clone(baseProject)
  const proposal = applySimulationBranchOperations(baseProject, operations)
  baseline.simulation.status = 'running'
  proposal.simulation.status = 'running'
  const baselineStart = baseline.simulation.totalFinished
  const proposalStart = proposal.simulation.totalFinished
  const steps = Math.max(1, Math.ceil(Math.max(kernel.stepSeconds, horizonSec) / kernel.stepSeconds))
  runSimulationSteps(baseline, steps, kernel)
  runSimulationSteps(proposal, steps, kernel)
  const baselineMetrics = metrics(baseline.metrics, baseline.simulation.totalFinished - baselineStart)
  const proposalMetrics = metrics(proposal.metrics, proposal.simulation.totalFinished - proposalStart)
  const delta = Object.fromEntries(Object.keys(baselineMetrics).map((key) => [key, proposalMetrics[key as keyof SimulationBranchMetrics] - baselineMetrics[key as keyof SimulationBranchMetrics]])) as unknown as SimulationBranchMetrics
  const throughputImprovementPercent = baselineMetrics.throughputPerMin > 0
    ? delta.throughputPerMin / baselineMetrics.throughputPerMin * 100
    : proposalMetrics.throughputPerMin > 0 ? 100 : null
  const score = delta.throughputPerMin * 10 + delta.totalProduced * 2 - Math.max(0, delta.blockedObjects) * 3 - Math.max(0, delta.workInProgress) * 0.2
  return {
    branchId: `branch-${Date.now().toString(36)}`,
    horizonSec: steps * kernel.stepSeconds,
    steps,
    baseline: baselineMetrics,
    proposal: proposalMetrics,
    delta,
    throughputImprovementPercent,
    score,
    recommendation: score > 0.01 ? 'apply' : score < -0.01 ? 'discard' : 'iterate',
  }
}
