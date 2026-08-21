import type { Rotation } from './types'

/**
 * 方向工具（Day 5）：格坐标的四邻方向 + 旋转角换算。
 *
 * 方向约定：对象 rotation 表示其「朝向」（0=+X，90=+Z，180=-X，270=-Z）。
 * 传送带物品沿带子朝向流动。
 */

/** 四方向向量 */
export interface Dir {
  dx: number
  dz: number
}

/** 旋转角 → 单位方向向量（+X 为 0°，逆时针） */
export function rotationToDir(r: Rotation): Dir {
  switch (r) {
    case 0:
      return { dx: 1, dz: 0 }
    case 90:
      return { dx: 0, dz: 1 }
    case 180:
      return { dx: -1, dz: 0 }
    case 270:
      return { dx: 0, dz: -1 }
  }
}

/** 方向向量 → 旋转角（四方向，就近取整） */
export function dirToRotation(d: Dir): Rotation {
  if (d.dx === 1) return 0
  if (d.dz === 1) return 90
  if (d.dx === -1) return 180
  return 270
}

/** 反向 */
export function reverseDir(d: Dir): Dir {
  return { dx: -d.dx, dz: -d.dz }
}

/** 判断两方向是否相反 */
export function isOpposite(a: Dir, b: Dir): boolean {
  return a.dx === -b.dx && a.dz === -b.dz
}

/** 相邻四方向（+X, -X, +Z, -Z） */
export const CARDINALS: Dir[] = [
  { dx: 1, dz: 0 },
  { dx: -1, dz: 0 },
  { dx: 0, dz: 1 },
  { dx: 0, dz: -1 },
]

/** 格子 key */
export function cellKey(x: number, z: number): string {
  return `${x},${z}`
}
