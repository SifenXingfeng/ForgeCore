/**
 * 种子化 PRNG（补充设计 §3.3 确定性随机数）。
 *
 * 引擎内置种子化随机流，配方概率产出、废品率全部走同一随机流。
 * 用途：未来「优化前后对比」这类结论必须可复现（同种子同结果）。
 * Day 4 先埋好种子机制；概率配方到 Day 5+ 才用。
 */

/** mulberry32：32 位种子，返回 [0,1) 均匀分布。快、无状态污染、可复现。 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** 从一个字符串推导 32 位种子（FNV-1a），用于「文本种子」入口。 */
export function seedFromString(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}
