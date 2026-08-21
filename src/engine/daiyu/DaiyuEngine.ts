import type * as THREE from 'three'
import {
  DAIYU_4060_LAPTOP_BUDGET,
  DAIYU_ENGINE_NAME,
  DAIYU_ENGINE_VERSION,
  type DaiyuBudget,
} from './config'

export type DaiyuPhase = 'cold' | 'prewarming' | 'ready' | 'running'

export interface DaiyuSnapshot {
  name: string
  version: string
  phase: DaiyuPhase
  fps: number
  frameMs: number
  p95FrameMs: number
  drawCalls: number
  triangles: number
  geometries: number
  textures: number
  budget: Readonly<DaiyuBudget>
  overBudget: string[]
}

type Listener = (snapshot: DaiyuSnapshot) => void

/**
 * 黛玉领域渲染内核。
 *
 * Three.js 继续负责 GPU 指令和材质系统；黛玉负责工厂场景的预算、
 * 生命周期、预热和后续批处理调度。该类不持有 React 状态，避免每帧
 * 统计触发组件树更新。
 */
export class DaiyuEngine {
  readonly name = DAIYU_ENGINE_NAME
  readonly version = DAIYU_ENGINE_VERSION
  readonly budget: Readonly<DaiyuBudget>

  private phase: DaiyuPhase = 'cold'
  private frameSamples: number[] = []
  private lastPublishAt = 0
  private listeners = new Set<Listener>()
  private rendererStats = { drawCalls: 0, triangles: 0, geometries: 0, textures: 0 }

  constructor(budget: Readonly<DaiyuBudget> = DAIYU_4060_LAPTOP_BUDGET) {
    this.budget = budget
  }

  setPhase(phase: DaiyuPhase) {
    if (this.phase === phase) return
    this.phase = phase
    this.publish(true)
  }

  sampleFrame(deltaSec: number, renderer: THREE.WebGLRenderer) {
    const frameMs = Math.min(Math.max(deltaSec * 1000, 0), 250)
    this.frameSamples.push(frameMs)
    if (this.frameSamples.length > 180) this.frameSamples.shift()

    const info = renderer.info
    this.rendererStats = {
      drawCalls: info.render.calls,
      triangles: info.render.triangles,
      geometries: info.memory.geometries,
      textures: info.memory.textures,
    }
    this.publish(false)
  }

  subscribe(listener: Listener) {
    this.listeners.add(listener)
    listener(this.getSnapshot())
    return () => this.listeners.delete(listener)
  }

  getSnapshot(): DaiyuSnapshot {
    const samples = this.frameSamples.length > 0 ? this.frameSamples : [0]
    const frameMs = samples.reduce((sum, value) => sum + value, 0) / samples.length
    const sorted = [...samples].sort((a, b) => a - b)
    const p95FrameMs = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))]
    const overBudget: string[] = []
    if (p95FrameMs > this.budget.frameBudgetMs) overBudget.push('frame-time')
    if (this.rendererStats.drawCalls > this.budget.maxDrawCalls) overBudget.push('draw-calls')
    if (this.rendererStats.triangles > this.budget.maxVisibleTriangles) overBudget.push('triangles')
    if (this.rendererStats.geometries > this.budget.maxGeometries) overBudget.push('geometries')
    if (this.rendererStats.textures > this.budget.maxTextures) overBudget.push('textures')

    return {
      name: this.name,
      version: this.version,
      phase: this.phase,
      fps: frameMs > 0 ? 1000 / frameMs : 0,
      frameMs,
      p95FrameMs,
      ...this.rendererStats,
      budget: this.budget,
      overBudget,
    }
  }

  private publish(force: boolean) {
    const now = performance.now()
    if (!force && now - this.lastPublishAt < 500) return
    this.lastPublishAt = now
    const snapshot = this.getSnapshot()
    this.listeners.forEach((listener) => listener(snapshot))
  }
}

export const daiyuEngine = new DaiyuEngine()
