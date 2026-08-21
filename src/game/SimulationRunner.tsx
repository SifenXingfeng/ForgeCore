import { useEffect } from 'react'
import { useForgeMindStore } from '../store/forgeMind'
import { SimulationEngine } from './simulation'

/**
 * 仿真运行时 runner（Day 4）—— 全应用唯一的引擎驱动器。
 *
 * 挂在 App 顶层，用 requestAnimationFrame 按真实时间推进引擎（受倍率/暂停控制），
 * 快照按 20Hz 写入 store（§3.1「后端 tick 快照 10~20Hz」）。
 * 引擎实例保存在模块级单例，不进入 React 状态，避免响应式开销。
 *
 * 引擎无 UI，返回 null；仿真数据由 store.simSnapshot 供各面板读取。
 */

/** 快照推送频率（Hz） */
// 20Hz keeps the simulation target close enough for the renderer's
// interpolation to stay responsive without forcing a React update every frame.
const SNAPSHOT_HZ = 20
const SNAPSHOT_INTERVAL = 1000 / SNAPSHOT_HZ

/** 种子：MVP 固定种子，保证可复现（§3.3） */
const SEED = 20260813

let engine: SimulationEngine | null = null

export function SimulationRunner() {
  const objects = useForgeMindStore((s) => s.objects)
  const recipes = useForgeMindStore((s) => s.recipes)
  const simResetTick = useForgeMindStore((s) => s.simResetTick)

  // 引擎单例
  if (!engine) engine = new SimulationEngine(SEED)

  // 结构变化 / 手动重置 → 重建引擎（重置逻辑时钟与状态）
  useEffect(() => {
    engine!.init(objects, recipes)
    useForgeMindStore.getState().setSimSnapshot(engine!.getSnapshot())
    useForgeMindStore.getState().setSimPlaying(false)
  }, [objects, recipes, simResetTick])

  // rAF 主循环（只依赖一次挂载）
  useEffect(() => {
    let raf = 0
    let last = performance.now()
    let lastPush = 0

    const loop = (now: number) => {
      const dtReal = (now - last) / 1000
      last = now

      const st = useForgeMindStore.getState()
      if (st.simPlaying) {
        engine!.advance(dtReal * st.simSpeed)
      }

      if (now - lastPush >= SNAPSHOT_INTERVAL) {
        lastPush = now
        st.setSimSnapshot(engine!.getSnapshot())
      }

      raf = requestAnimationFrame(loop)
    }

    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [])

  return null
}
