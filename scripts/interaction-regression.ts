import assert from 'node:assert/strict'
import { appendGridTrace } from '../src/game/conveyorTrace'
import type { GridPos } from '../src/game/types'

const cells = (trace: GridPos[]) => trace.map(({ x, z }) => `${x},${z}`)

let trace = appendGridTrace([], { x: 0, z: 0 })
trace = appendGridTrace(trace, { x: 3, z: 0 })
assert.deepEqual(cells(trace), ['0,0', '1,0', '2,0', '3,0'], '快速横向拖动应自动补齐经过的网格')

trace = appendGridTrace(trace, { x: 3, z: 2 })
assert.deepEqual(
  cells(trace),
  ['0,0', '1,0', '2,0', '3,0', '3,1', '3,2'],
  '改变拖动方向时应自动生成直角转点',
)

trace = appendGridTrace(trace, { x: 3, z: 1 })
assert.deepEqual(cells(trace), ['0,0', '1,0', '2,0', '3,0', '3,1'], '沿原路回拖应擦除末端')

let diagonal = appendGridTrace([{ x: 0, z: 0 }, { x: 1, z: 0 }], { x: 3, z: 2 })
assert.deepEqual(
  cells(diagonal),
  ['0,0', '1,0', '2,0', '3,0', '3,1', '3,2'],
  '指针跨越两个坐标轴时应优先延续既有方向再转弯',
)

diagonal = appendGridTrace(diagonal, { x: 1, z: 0 })
assert.deepEqual(cells(diagonal), ['0,0', '1,0'], '重新进入旧网格时应裁掉闭环，避免线路自重叠')

console.log('interaction regression: passed')
