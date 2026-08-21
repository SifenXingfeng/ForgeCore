import assert from 'node:assert/strict'
import { portWorldOffset } from '../src/game/grid'
import { OBJECT_DEFS } from '../src/game/types'
import {
  advanceConveyorStripePhase,
  BASE_CONVEYOR_CROSS_SECTION_SCALE,
  buildingVisualScaleForType,
  CONVEYOR_CROSS_SECTION_SCALE,
  CONVEYOR_CORNER_BELT_INNER_RADIUS_M,
  CONVEYOR_CORNER_BELT_OUTER_RADIUS_M,
  CONVEYOR_CORNER_INNER_RAIL_RADIUS_M,
  CONVEYOR_CORNER_OUTER_RAIL_RADIUS_M,
  CONVEYOR_CORNER_CENTERLINE_RADIUS_M,
  CONVEYOR_DIRECTION_STRIPE_LENGTH_M,
  CONVEYOR_DIRECTION_STRIPE_PHASE_RATE,
  CONVEYOR_DIRECTION_STRIPE_WIDTH_M,
  CONVEYOR_MODEL_TARGET_FOOTPRINT_M,
  CONVEYOR_VISUAL_SURFACE_Y_M,
  CONVEYOR_VISUAL_WIDTH_M,
  NON_VEHICLE_BUILDING_VISUAL_SCALE,
  PRODUCTION_MACHINE_VISUAL_SCALE,
  SOURCE_EMBEDDED_CONVEYOR_LOCAL_POSITION,
  SOURCE_FRONT_PORT_OFFSET_WORLD_M,
  conveyorCornerArcPoint,
  conveyorCornerArcSpec,
  conveyorCornerArcTangent,
  conveyorStripeCount,
  conveyorStripeProgress,
  portMarkerOutwardDistance,
} from '../src/scene/industrialVisualScale'

assert.equal(NON_VEHICLE_BUILDING_VISUAL_SCALE, 1.25, '普通建筑应在现有比例上额外放大 1.25 倍')
assert.equal(PRODUCTION_MACHINE_VISUAL_SCALE, 2.5, '生产机器应由原 2 倍累计放大至 2.5 倍')
assert.equal(CONVEYOR_CROSS_SECTION_SCALE, 2.5, '传送带宽高应由原 2 倍累计放大至 2.5 倍')
assert.equal(CONVEYOR_CROSS_SECTION_SCALE, BASE_CONVEYOR_CROSS_SECTION_SCALE * NON_VEHICLE_BUILDING_VISUAL_SCALE)
assert.equal(CONVEYOR_VISUAL_WIDTH_M, 1, '传送带视觉床宽应同步放大至 1 米')
assert.equal(CONVEYOR_VISUAL_SURFACE_Y_M, 0.775, '在途货物与指示线应同步抬升')
assert.equal(CONVEYOR_CORNER_BELT_OUTER_RADIUS_M - CONVEYOR_CORNER_BELT_INNER_RADIUS_M, 0.78, '弯道输送面宽度应与直行段深灰带面一致')
assert.ok(CONVEYOR_CORNER_OUTER_RAIL_RADIUS_M - CONVEYOR_CORNER_INNER_RAIL_RADIUS_M < CONVEYOR_VISUAL_WIDTH_M, '弯道护轨必须保持在单格视觉宽度内')
assert.ok(CONVEYOR_DIRECTION_STRIPE_LENGTH_M < CONVEYOR_DIRECTION_STRIPE_WIDTH_M, '运行方向条纹必须是横跨带面的长方形条')
assert.ok(CONVEYOR_DIRECTION_STRIPE_WIDTH_M < CONVEYOR_CORNER_BELT_OUTER_RADIUS_M - CONVEYOR_CORNER_BELT_INNER_RADIUS_M, '运行方向条纹不得越出弯道带面')
assert.ok(CONVEYOR_DIRECTION_STRIPE_PHASE_RATE > 0, '运行方向条纹必须具有正向平滑速度')
assert.ok(advanceConveyorStripePhase(0.4, 0.1, 1) > 0.4, '取货模式条纹必须朝站体前侧向外运行')
assert.ok(advanceConveyorStripePhase(0.4, 0.1, -1) < 0.4, '存货入货模式条纹必须从当前相位反向朝站内运行')
assert.equal(conveyorStripeCount(1), 3, '每米直行传送带应显示三条低密度方向条纹')
assert.equal(conveyorStripeCount(Math.PI * CONVEYOR_CORNER_CENTERLINE_RADIUS_M / 2), 2, '单格弯道应显示两条低密度方向条纹')
assert.ok(portMarkerOutwardDistance('source', OBJECT_DEFS.source.footprint.w / 2, 2.5) > OBJECT_DEFS.source.footprint.w / 2 * NON_VEHICLE_BUILDING_VISUAL_SCALE, '接口标识必须位于缩放后存取站包络之外')
assert.ok(portMarkerOutwardDistance('machine', 1.5, 2) > 1.5 * PRODUCTION_MACHINE_VISUAL_SCALE, '生产机器蓝黄接口不得被 2.5 倍模型遮挡')
assert.ok(Math.abs(conveyorStripeProgress(0.9, 1, 3) - 0.2333333333333334) < 1e-12, '条纹越过段尾时应平滑循环到段首')

const rotateStationOffset = (x: number, z: number, rotation: 0 | 90 | 180 | 270) => rotation === 0
  ? { x, z }
  : rotation === 90
    ? { x: -z, z: x }
    : rotation === 180
      ? { x: -x, z: -z }
      : { x: z, z: -x }
const stationForward = (rotation: 0 | 90 | 180 | 270) => rotation === 0
  ? { x: 1, z: 0 }
  : rotation === 90
    ? { x: 0, z: 1 }
    : rotation === 180
      ? { x: -1, z: 0 }
      : { x: 0, z: -1 }
for (const rotation of [0, 90, 180, 270] as const) {
  const sourcePortOffset = portWorldOffset({ id: `source-alignment-${rotation}`, type: 'source', pos: { x: 0, z: 0 }, rotation }, 'output')!
  const embeddedCenterWorld = rotateStationOffset(
    SOURCE_EMBEDDED_CONVEYOR_LOCAL_POSITION[0] * NON_VEHICLE_BUILDING_VISUAL_SCALE,
    SOURCE_EMBEDDED_CONVEYOR_LOCAL_POSITION[2] * NON_VEHICLE_BUILDING_VISUAL_SCALE,
    rotation,
  )
  const forward = stationForward(rotation)
  const embeddedFrontEdgeWorld = {
    x: embeddedCenterWorld.x + forward.x * CONVEYOR_MODEL_TARGET_FOOTPRINT_M * NON_VEHICLE_BUILDING_VISUAL_SCALE / 2,
    z: embeddedCenterWorld.z + forward.z * CONVEYOR_MODEL_TARGET_FOOTPRINT_M * NON_VEHICLE_BUILDING_VISUAL_SCALE / 2,
  }
  const snappedConveyorBackEdgeWorld = {
    x: sourcePortOffset.x - forward.x * CONVEYOR_MODEL_TARGET_FOOTPRINT_M / 2,
    z: sourcePortOffset.z - forward.z * CONVEYOR_MODEL_TARGET_FOOTPRINT_M / 2,
  }
  assert.ok(Math.abs(embeddedFrontEdgeWorld.x - snappedConveyorBackEdgeWorld.x) < 1e-12, `${rotation}° 站内短带必须与实际接口处于同一横向中线`)
  assert.ok(Math.abs(embeddedFrontEdgeWorld.z - snappedConveyorBackEdgeWorld.z) < 1e-12, `${rotation}° 站内短带必须与实际接口处于同一纵向中线并端面对接`)
}
assert.deepEqual(portWorldOffset({ id: 'source-alignment', type: 'source', pos: { x: 0, z: 0 }, rotation: 0 }, 'output'), SOURCE_FRONT_PORT_OFFSET_WORLD_M, '0° 站内短带坐标必须保持既有前侧吸附格')
for (const inputSide of ['left', 'right'] as const) {
  const spec = conveyorCornerArcSpec(inputSide)
  const input = conveyorCornerArcPoint(spec, 0.5, 0)
  const output = conveyorCornerArcPoint(spec, 0.5, 1)
  assert.ok(Math.abs(input.x) < 1e-9 && Math.abs(input.z - spec.inputZ * 0.5) < 1e-9, `${inputSide} 弯道入口中心必须落在网格边界`)
  assert.ok(Math.abs(output.x - 0.5) < 1e-9 && Math.abs(output.z) < 1e-9, `${inputSide} 弯道出口中心必须落在本地 +X 边界`)
  const inputTangent = conveyorCornerArcTangent(spec, 0)
  const outputTangent = conveyorCornerArcTangent(spec, 1)
  assert.ok(Math.abs(inputTangent.x) < 1e-9 && Math.abs(inputTangent.z + spec.inputZ) < 1e-9, `${inputSide} 弯道条纹入口方向必须承接来料方向`)
  assert.ok(Math.abs(outputTangent.x - 1) < 1e-9 && Math.abs(outputTangent.z) < 1e-9, `${inputSide} 弯道条纹出口方向必须平滑转为本地 +X`)
  for (let index = 1; index <= 16; index += 1) {
    const before = conveyorCornerArcTangent(spec, (index - 1) / 16)
    const after = conveyorCornerArcTangent(spec, index / 16)
    assert.ok(before.x * after.x + before.z * after.z > 0.99, `${inputSide} 弯道条纹朝向不得出现折线跳变`)
  }
}

for (const type of Object.keys(OBJECT_DEFS) as Array<keyof typeof OBJECT_DEFS>) {
  const scale = buildingVisualScaleForType(type)
  if (type === 'agv' || type === 'drone') {
    assert.equal(scale, 1, `${type} 必须保持原尺寸`)
  } else {
    assert.ok(scale > 1, `${type} 必须进入非车辆建筑放大规则`)
  }
}

console.log('visual scale regression: passed')
