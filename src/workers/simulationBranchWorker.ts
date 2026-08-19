/// <reference lib="webworker" />

import { compareSimulationBranches, type SimulationBranchOperation } from '../domain/simulationBranch'
import { forgeSimulationKernel } from '../store/useForgeStore'
import type { ForgeProjectData } from '../types'

interface BranchWorkerRequest {
  requestId: string
  project: ForgeProjectData
  operations: SimulationBranchOperation[]
  horizonSec: number
}

self.onmessage = (event: MessageEvent<BranchWorkerRequest>) => {
  const { requestId, project, operations, horizonSec } = event.data
  try {
    const result = compareSimulationBranches(project, operations, horizonSec, forgeSimulationKernel)
    self.postMessage({ requestId, ok: true, result })
  } catch (error) {
    self.postMessage({ requestId, ok: false, error: error instanceof Error ? error.message : 'Simulation branch failed' })
  }
}

export {}
