import { compareSimulationBranches, type SimulationBranchOperation, type SimulationBranchResult } from '../domain/simulationBranch'
import { forgeSimulationKernel } from '../store/useForgeStore'
import type { ForgeProjectData } from '../types'

const clone = <T>(value: T): T => structuredClone(value)

export const simulationBranchRepository = {
  async compare(project: ForgeProjectData, operations: SimulationBranchOperation[], horizonSec: number): Promise<SimulationBranchResult> {
    const local = () => compareSimulationBranches(clone(project), clone(operations), horizonSec, forgeSimulationKernel)
    if (typeof Worker === 'undefined') return local()
    try {
      const worker = new Worker(new URL('../workers/simulationBranchWorker.ts', import.meta.url), { type: 'module', name: 'forgecore-simulation-branch' })
      const requestId = `branch-request-${Date.now().toString(36)}`
      return await new Promise<SimulationBranchResult>((resolve, reject) => {
        const timeout = window.setTimeout(() => {
          worker.terminate()
          reject(new Error('仿真分支运行超时。'))
        }, 120_000)
        worker.onmessage = (event: MessageEvent<{ requestId: string; ok: boolean; result?: SimulationBranchResult; error?: string }>) => {
          if (event.data.requestId !== requestId) return
          window.clearTimeout(timeout)
          worker.terminate()
          if (event.data.ok && event.data.result) resolve(event.data.result)
          else reject(new Error(event.data.error || '仿真分支运行失败。'))
        }
        worker.onerror = (event) => {
          window.clearTimeout(timeout)
          worker.terminate()
          reject(new Error(event.message || '仿真 Worker 加载失败。'))
        }
        worker.postMessage({ requestId, project: clone(project), operations: clone(operations), horizonSec })
      })
    } catch {
      return local()
    }
  },
}
