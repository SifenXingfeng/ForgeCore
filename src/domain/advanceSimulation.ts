import type {
  ActivityEvent,
  Factory,
  FactoryMetrics,
  FactoryObject,
  Floor,
  ForgeProjectData,
  InventoryRecord,
  Item,
  MachineRuntimeState,
  MetricSample,
  Recipe,
  SimulationState,
} from '../types'

export interface AdvanceSimulationKernel {
  stepSeconds: number
  maxMetricSamples: number
  rebuildReservations: (inventory: InventoryRecord[], simulation: SimulationState) => void
  updateTransit: (simulation: SimulationState, inventory: InventoryRecord[], objects: FactoryObject[], activities: ActivityEvent[], deltaSec: number) => void
  dispatchWarehouseInventory: (simulation: SimulationState, objects: FactoryObject[], inventory: InventoryRecord[]) => void
  updateAgv: (factory: Factory, floors: Floor[], objects: FactoryObject[], items: Item[], inventory: InventoryRecord[], simulation: SimulationState, activities: ActivityEvent[]) => void
  updateDrone: (factory: Factory, floors: Floor[], objects: FactoryObject[], items: Item[], inventory: InventoryRecord[], simulation: SimulationState, activities: ActivityEvent[]) => void
  getRecipe: (recipes: Recipe[], id: string) => Recipe | undefined
  getMachineObject: (objects: FactoryObject[], id: string) => FactoryObject | undefined
  updateMachineState: (runtime: MachineRuntimeState, recipe: Recipe, machineObject: FactoryObject | undefined, deltaSec: number, activities: ActivityEvent[], simulation: SimulationState) => void
  dispatchMachineOutput: (simulation: SimulationState, objects: FactoryObject[], runtime: MachineRuntimeState, conveyorId: string, targetId: string | 'finished-goods', outputItemId: string | null) => void
  calculateMetrics: (simulation: SimulationState, inventory: InventoryRecord[], objects: FactoryObject[]) => FactoryMetrics
  updateObjectStatuses: (objects: FactoryObject[], simulation: SimulationState) => void
}

/** Advance exactly one deterministic fixed step, mutating only the supplied draft. */
export function advanceSimulation(data: ForgeProjectData, kernel: AdvanceSimulationKernel): void {
  const { simulation, inventory, objects, recipes, activities } = data
  const stepSeconds = kernel.stepSeconds
  kernel.rebuildReservations(inventory, simulation)
  simulation.elapsedSimSec += stepSeconds
  simulation.tickCount += 1

  kernel.updateTransit(simulation, inventory, objects, activities, stepSeconds)
  kernel.dispatchWarehouseInventory(simulation, objects, inventory)
  kernel.updateAgv(data.factory, data.floors, objects, data.items, inventory, simulation, activities)
  kernel.updateDrone(data.factory, data.floors, objects, data.items, inventory, simulation, activities)

  for (const runtime of Object.values(simulation.machineRuntime)) {
    const recipe = kernel.getRecipe(recipes, runtime.recipeId)
    if (!recipe?.enabled) continue
    kernel.updateMachineState(runtime, recipe, kernel.getMachineObject(objects, runtime.machineObjectId), stepSeconds, activities, simulation)
    const outgoing = objects.filter((object) => object.config.kind === 'conveyor' && object.config.fromObjectId === runtime.machineObjectId)
    for (const connection of outgoing) {
      if (connection.config.kind !== 'conveyor' || !connection.config.toObjectId) continue
      const outputItemId = recipe.outputs.length === 1 ? recipe.outputs[0].itemId : connection.config.outputItemId ?? null
      kernel.dispatchMachineOutput(simulation, objects, runtime, connection.id, connection.config.toObjectId, outputItemId)
    }
  }

  simulation.completedTransportDurationsSec = simulation.completedTransportDurationsSec.slice(-120)
  data.metrics = kernel.calculateMetrics(simulation, inventory, objects)
  kernel.updateObjectStatuses(objects, simulation)

  if (simulation.elapsedSimSec >= simulation.nextMetricSampleAtSec) {
    const machineIds = objects.filter((object) => object.kind === 'machine').map((object) => object.id)
    const sample: MetricSample = {
      elapsedSimSec: simulation.elapsedSimSec,
      throughputPerMin: data.metrics.currentThroughputPerMin,
      workInProgress: data.metrics.workInProgress,
      finishedGoods: data.metrics.totalProduced,
      machineAUtilization: data.metrics.machineUtilization[machineIds[0] ?? ''] ?? 0,
      machineBUtilization: data.metrics.machineUtilization[machineIds[1] ?? ''] ?? 0,
    }
    data.metricSeries.push(sample)
    data.metricSeries.splice(0, Math.max(0, data.metricSeries.length - kernel.maxMetricSamples))
    simulation.nextMetricSampleAtSec = Math.floor(simulation.elapsedSimSec) + 1
  }
}

export function runSimulationSteps(data: ForgeProjectData, steps: number, kernel: AdvanceSimulationKernel): ForgeProjectData {
  for (let index = 0; index < Math.max(0, Math.trunc(steps)); index += 1) advanceSimulation(data, kernel)
  return data
}
