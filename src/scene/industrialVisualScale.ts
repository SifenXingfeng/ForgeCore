import type { BuildType } from '../game/types'

/**
 * A second render-only enlargement shared by every placed building except the
 * AGV and cargo drone. Keeping it explicit prevents vehicle models from being
 * accidentally scaled through generic equipment rendering paths.
 */
export const NON_VEHICLE_BUILDING_VISUAL_SCALE = 1.25

/** Production equipment was already calibrated to 2x before the global pass. */
export const PRODUCTION_MACHINE_VISUAL_SCALE = 2 * NON_VEHICLE_BUILDING_VISUAL_SCALE

/**
 * Conveyor cells must remain one metre long so adjacent cells still join.
 * Only the vertical and cross-belt axes are enlarged. The previous 2x
 * calibration receives the same additional building multiplier while the
 * one-cell longitudinal axis remains unchanged.
 */
export const BASE_CONVEYOR_CROSS_SECTION_SCALE = 2
export const CONVEYOR_CROSS_SECTION_SCALE = BASE_CONVEYOR_CROSS_SECTION_SCALE * NON_VEHICLE_BUILDING_VISUAL_SCALE

export const CONVEYOR_MODEL_TARGET_FOOTPRINT_M = 1.05
export const CONVEYOR_MODEL_TARGET_HEIGHT_M = 0.52
export const CONVEYOR_VISUAL_SURFACE_Y_M = 0.62 * NON_VEHICLE_BUILDING_VISUAL_SCALE
export const CONVEYOR_VISUAL_WIDTH_M = 0.8 * NON_VEHICLE_BUILDING_VISUAL_SCALE

/**
 * The 4x4 cargo station's rotation-0 front port is the first of its two
 * central lanes. These are world-space offsets from the station grid centre.
 */
export const SOURCE_FRONT_PORT_OFFSET_WORLD_M = { x: 2.5, z: -0.5 } as const

/**
 * IncomingStationModel is nested under the station's 1.25x visual scale,
 * while an attached floor conveyor is authored directly in world metres.
 * Pull the embedded segment back until the two model end faces meet, and
 * pre-divide the lateral offset so both belts share the exact centreline.
 */
export const SOURCE_EMBEDDED_CONVEYOR_LOCAL_POSITION: [number, number, number] = [
  (
    SOURCE_FRONT_PORT_OFFSET_WORLD_M.x
    - CONVEYOR_MODEL_TARGET_FOOTPRINT_M / 2
    - CONVEYOR_MODEL_TARGET_FOOTPRINT_M * NON_VEHICLE_BUILDING_VISUAL_SCALE / 2
  ) / NON_VEHICLE_BUILDING_VISUAL_SCALE,
  0,
  SOURCE_FRONT_PORT_OFFSET_WORLD_M.z / NON_VEHICLE_BUILDING_VISUAL_SCALE,
]
export const SOURCE_EMBEDDED_CONVEYOR_FRONT_EDGE_LOCAL_X_M =
  SOURCE_EMBEDDED_CONVEYOR_LOCAL_POSITION[0] + CONVEYOR_MODEL_TARGET_FOOTPRINT_M / 2

/** Dedicated one-cell 90° corner, authored directly in final world metres. */
export const CONVEYOR_CORNER_CENTERLINE_RADIUS_M = 0.5
export const CONVEYOR_CORNER_BELT_INNER_RADIUS_M = 0.11
export const CONVEYOR_CORNER_BELT_OUTER_RADIUS_M = 0.89
export const CONVEYOR_CORNER_INNER_RAIL_RADIUS_M = 0.065
export const CONVEYOR_CORNER_OUTER_RAIL_RADIUS_M = 0.935

/** Shared runtime direction stripes for straight, corner and incline belts. */
export const CONVEYOR_DIRECTION_STRIPE_COLOR = '#6f7b77'
export const CONVEYOR_DIRECTION_STRIPE_OPACITY = 0.58
export const CONVEYOR_DIRECTION_STRIPE_LENGTH_M = 0.14
export const CONVEYOR_DIRECTION_STRIPE_WIDTH_M = 0.62
export const CONVEYOR_DIRECTION_STRIPE_HEIGHT_M = 0.014
export const CONVEYOR_DIRECTION_STRIPES_PER_METER = 3
export const CONVEYOR_DIRECTION_STRIPE_PHASE_RATE = 0.72

export function advanceConveyorStripePhase(phase: number, deltaSec: number, direction: 1 | -1 = 1) {
  const next = (phase + deltaSec * CONVEYOR_DIRECTION_STRIPE_PHASE_RATE * direction) % 1
  return next < 0 ? next + 1 : next
}

export function conveyorStripeCount(pathLengthM: number) {
  return Math.max(1, Math.round(pathLengthM * CONVEYOR_DIRECTION_STRIPES_PER_METER))
}

export function conveyorStripeProgress(phase: number, index: number, count: number) {
  return (phase + index / count) % 1
}

export interface ConveyorCornerArcSpec {
  inputZ: 1 | -1
  centerX: number
  centerZ: number
  startAngle: number
  endAngle: number
  clockwise: boolean
}

export function conveyorCornerArcSpec(inputSide: 'left' | 'right'): ConveyorCornerArcSpec {
  const inputZ = inputSide === 'left' ? 1 : -1
  return {
    inputZ,
    centerX: CONVEYOR_CORNER_CENTERLINE_RADIUS_M,
    centerZ: inputZ * CONVEYOR_CORNER_CENTERLINE_RADIUS_M,
    startAngle: Math.PI,
    endAngle: inputZ > 0 ? Math.PI * 1.5 : Math.PI * 0.5,
    clockwise: inputZ < 0,
  }
}

export function conveyorCornerArcPoint(spec: ConveyorCornerArcSpec, radius: number, progress: number) {
  const t = Math.max(0, Math.min(1, progress))
  const angle = spec.startAngle + (spec.endAngle - spec.startAngle) * t
  return {
    x: spec.centerX + Math.cos(angle) * radius,
    z: spec.centerZ + Math.sin(angle) * radius,
  }
}

export function conveyorCornerArcTangent(spec: ConveyorCornerArcSpec, progress: number) {
  const t = Math.max(0, Math.min(1, progress))
  const delta = spec.endAngle - spec.startAngle
  const angle = spec.startAngle + delta * t
  const sign = Math.sign(delta) || 1
  return {
    x: -Math.sin(angle) * sign,
    z: Math.cos(angle) * sign,
  }
}

const PRODUCTION_MACHINE_TYPES = new Set<BuildType>([
  'machine',
  'smelter',
  'press',
  'assembler',
  'inspection',
  'washing',
  'imported',
])

export function isProductionMachineVisualType(type: BuildType): boolean {
  return PRODUCTION_MACHINE_TYPES.has(type)
}

export function buildingVisualScaleForType(type: BuildType): number {
  if (type === 'agv' || type === 'drone') return 1
  if (isProductionMachineVisualType(type)) return PRODUCTION_MACHINE_VISUAL_SCALE
  return NON_VEHICLE_BUILDING_VISUAL_SCALE
}

/** Keep an interface beacon beyond both its real topology point and model envelope. */
export function portMarkerOutwardDistance(type: BuildType, gridHalfExtent: number, topologyDistance: number): number {
  return Math.max(topologyDistance, gridHalfExtent * buildingVisualScaleForType(type) + 0.34)
}
