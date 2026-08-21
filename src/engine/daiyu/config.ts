/** ForgeMind 黛玉引擎在 RTX 4060 Laptop + 5 GiB LLM 下的默认预算。 */
export const DAIYU_ENGINE_NAME = '黛玉'
export const DAIYU_ENGINE_VERSION = '0.1.0'

export interface DaiyuBudget {
  targetFps: number
  frameBudgetMs: number
  maxDrawCalls: number
  maxVisibleTriangles: number
  maxTextures: number
  maxGeometries: number
  maxRendererMemoryMb: number
}

export const DAIYU_4060_LAPTOP_BUDGET: Readonly<DaiyuBudget> = Object.freeze({
  targetFps: 60,
  frameBudgetMs: 1000 / 60,
  maxDrawCalls: 550,
  maxVisibleTriangles: 3_000_000,
  maxTextures: 420,
  maxGeometries: 900,
  maxRendererMemoryMb: 1024,
})

export const DAIYU_WARMUP_DELAYS_MS = [200, 900, 2400, 5200] as const
