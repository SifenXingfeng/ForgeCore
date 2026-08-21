import { useMemo } from 'react'
import * as THREE from 'three'
import {
  CONVEYOR_CORNER_BELT_INNER_RADIUS_M,
  CONVEYOR_CORNER_BELT_OUTER_RADIUS_M,
  CONVEYOR_CORNER_INNER_RAIL_RADIUS_M,
  CONVEYOR_CORNER_OUTER_RAIL_RADIUS_M,
  CONVEYOR_VISUAL_SURFACE_Y_M,
  conveyorCornerArcPoint,
  conveyorCornerArcSpec,
  type ConveyorCornerArcSpec,
} from './industrialVisualScale'

const ALUMINUM = '#d7ddd9'
const ALUMINUM_SHADOW = '#aeb8b3'
const BELT = '#4f5b58'
const BELT_EDGE = '#26312f'
const SENSOR_BLUE = '#1d75c5'
const LEG_TOP_Y = CONVEYOR_VISUAL_SURFACE_Y_M - 0.105
const RAIL_LOW_Y = CONVEYOR_VISUAL_SURFACE_Y_M + 0.035
const RAIL_TOP_Y = CONVEYOR_VISUAL_SURFACE_Y_M + 0.18

function sectorShape(spec: ConveyorCornerArcSpec) {
  const shape = new THREE.Shape()
  const outerStart = conveyorCornerArcPoint(spec, CONVEYOR_CORNER_BELT_OUTER_RADIUS_M, 0)
  const innerEnd = conveyorCornerArcPoint(spec, CONVEYOR_CORNER_BELT_INNER_RADIUS_M, 1)
  shape.moveTo(outerStart.x - spec.centerX, outerStart.z - spec.centerZ)
  shape.absarc(0, 0, CONVEYOR_CORNER_BELT_OUTER_RADIUS_M, spec.startAngle, spec.endAngle, spec.clockwise)
  shape.lineTo(innerEnd.x - spec.centerX, innerEnd.z - spec.centerZ)
  shape.absarc(0, 0, CONVEYOR_CORNER_BELT_INNER_RADIUS_M, spec.endAngle, spec.startAngle, !spec.clockwise)
  shape.closePath()
  return shape
}

function BeamBetween({ start, end, size = 0.03, color = ALUMINUM, metalness = 0.78 }: {
  start: [number, number, number]
  end: [number, number, number]
  size?: number
  color?: string
  metalness?: number
}) {
  const dx = end[0] - start[0]
  const dz = end[2] - start[2]
  const length = Math.hypot(dx, dz)
  return <mesh
    position={[(start[0] + end[0]) / 2, (start[1] + end[1]) / 2, (start[2] + end[2]) / 2]}
    rotation={[0, -Math.atan2(dz, dx), 0]}
    castShadow
    receiveShadow
  >
    <boxGeometry args={[length, size, size]} />
    <meshStandardMaterial color={color} roughness={0.32} metalness={metalness} />
  </mesh>
}

function ArcBeam({ spec, radius, y, size = 0.028, color = ALUMINUM }: {
  spec: ConveyorCornerArcSpec
  radius: number
  y: number
  size?: number
  color?: string
}) {
  const geometry = useMemo(() => {
    const points = Array.from({ length: 25 }, (_, index) => {
      const point = conveyorCornerArcPoint(spec, radius, index / 24)
      return new THREE.Vector3(point.x, y, point.z)
    })
    const path = new THREE.CatmullRomCurve3(points, false, 'centripetal')
    const profile = new THREE.Shape()
    profile.moveTo(-size / 2, -size / 2)
    profile.lineTo(size / 2, -size / 2)
    profile.lineTo(size / 2, size / 2)
    profile.lineTo(-size / 2, size / 2)
    profile.closePath()
    return new THREE.ExtrudeGeometry(profile, { steps: 24, bevelEnabled: false, extrudePath: path })
  }, [color, radius, size, spec, y])
  return <mesh geometry={geometry} castShadow receiveShadow>
    <meshStandardMaterial color={color} roughness={0.32} metalness={0.78} />
  </mesh>
}

function RadialBeam({ spec, progress, y, size = 0.028, color = ALUMINUM_SHADOW }: {
  spec: ConveyorCornerArcSpec
  progress: number
  y: number
  size?: number
  color?: string
}) {
  const inner = conveyorCornerArcPoint(spec, CONVEYOR_CORNER_INNER_RAIL_RADIUS_M, progress)
  const outer = conveyorCornerArcPoint(spec, CONVEYOR_CORNER_OUTER_RAIL_RADIUS_M, progress)
  return <BeamBetween start={[inner.x, y, inner.z]} end={[outer.x, y, outer.z]} size={size} color={color} />
}

function Upright({ x, z }: { x: number; z: number }) {
  const height = RAIL_TOP_Y - RAIL_LOW_Y
  return <mesh position={[x, RAIL_LOW_Y + height / 2, z]} castShadow>
    <boxGeometry args={[0.028, height, 0.028]} />
    <meshStandardMaterial color={ALUMINUM} roughness={0.32} metalness={0.78} />
  </mesh>
}

function SupportLeg({ x, z }: { x: number; z: number }) {
  return <group>
    <mesh position={[x, LEG_TOP_Y / 2, z]} castShadow>
      <boxGeometry args={[0.047, LEG_TOP_Y, 0.047]} />
      <meshStandardMaterial color={ALUMINUM} roughness={0.34} metalness={0.76} />
    </mesh>
    <mesh position={[x, 0.016, z]} castShadow>
      <cylinderGeometry args={[0.055, 0.064, 0.032, 12]} />
      <meshStandardMaterial color="#202725" roughness={0.72} metalness={0.3} />
    </mesh>
  </group>
}

function BeltSeam({ spec, progress }: { spec: ConveyorCornerArcSpec; progress: number }) {
  const inner = conveyorCornerArcPoint(spec, CONVEYOR_CORNER_BELT_INNER_RADIUS_M + 0.015, progress)
  const outer = conveyorCornerArcPoint(spec, CONVEYOR_CORNER_BELT_OUTER_RADIUS_M - 0.015, progress)
  return <BeamBetween start={[inner.x, CONVEYOR_VISUAL_SURFACE_Y_M + 0.009, inner.z]} end={[outer.x, CONVEYOR_VISUAL_SURFACE_Y_M + 0.009, outer.z]} size={0.012} color={BELT_EDGE} metalness={0.35} />
}

/**
 * A final-scale 90° belt corner matching the imported straight section.
 * Input arrives from local ±Z and output leaves along local +X.
 */
export function ConveyorCornerModel({ inputSide, accent }: { inputSide: 'left' | 'right'; accent: string }) {
  const spec = useMemo(() => conveyorCornerArcSpec(inputSide), [inputSide])
  const shape = useMemo(() => sectorShape(spec), [spec])
  const railProgress = [0, 0.25, 0.5, 0.75, 1]
  const legLocations = [
    conveyorCornerArcPoint(spec, CONVEYOR_CORNER_OUTER_RAIL_RADIUS_M, 0),
    conveyorCornerArcPoint(spec, CONVEYOR_CORNER_OUTER_RAIL_RADIUS_M, 0.5),
    conveyorCornerArcPoint(spec, CONVEYOR_CORNER_OUTER_RAIL_RADIUS_M, 1),
    { x: spec.centerX, z: spec.centerZ },
  ]
  void accent

  return <group>
    {/* Deep belt body and upper conveying skin share the straight model height. */}
    <mesh position={[spec.centerX, CONVEYOR_VISUAL_SURFACE_Y_M, spec.centerZ]} rotation={[Math.PI / 2, 0, 0]} castShadow receiveShadow>
      <extrudeGeometry args={[shape, { depth: 0.095, bevelEnabled: false, curveSegments: 48 }]} />
      <meshStandardMaterial color={BELT_EDGE} roughness={0.62} metalness={0.42} side={THREE.DoubleSide} />
    </mesh>
    <mesh position={[spec.centerX, CONVEYOR_VISUAL_SURFACE_Y_M + 0.006, spec.centerZ]} rotation={[Math.PI / 2, 0, 0]} receiveShadow>
      <shapeGeometry args={[shape, 48]} />
      <meshStandardMaterial color={BELT} roughness={0.76} metalness={0.18} side={THREE.DoubleSide} />
    </mesh>

    {/* Aluminum side frame, under-frame and guard rails follow the same arc. */}
    {[CONVEYOR_CORNER_INNER_RAIL_RADIUS_M, CONVEYOR_CORNER_OUTER_RAIL_RADIUS_M].flatMap((radius) => [
      <ArcBeam key={`frame-${radius}`} spec={spec} radius={radius} y={CONVEYOR_VISUAL_SURFACE_Y_M - 0.075} size={0.04} color={ALUMINUM_SHADOW} />,
      <ArcBeam key={`lip-${radius}`} spec={spec} radius={radius} y={RAIL_LOW_Y} size={0.035} />,
    ])}
    <ArcBeam spec={spec} radius={CONVEYOR_CORNER_OUTER_RAIL_RADIUS_M} y={RAIL_TOP_Y} size={0.03} />
    <mesh position={[spec.centerX, CONVEYOR_VISUAL_SURFACE_Y_M - 0.005, spec.centerZ]} castShadow receiveShadow>
      <cylinderGeometry args={[0.105, 0.105, 0.09, 24]} />
      <meshStandardMaterial color={ALUMINUM} roughness={0.34} metalness={0.74} />
    </mesh>
    {[0.05, 0.28, 0.5, 0.72, 0.95].map((progress) => <RadialBeam key={`cross-${progress}`} spec={spec} progress={progress} y={CONVEYOR_VISUAL_SURFACE_Y_M - 0.08} size={0.034} />)}
    {railProgress.map((progress) => {
      const point = conveyorCornerArcPoint(spec, CONVEYOR_CORNER_OUTER_RAIL_RADIUS_M, progress)
      return <Upright key={`post-${progress}`} x={point.x} z={point.z} />
    })}

    {/* Structural legs and feet use the same light extrusion language. */}
    {legLocations.map((point, index) => <SupportLeg key={`leg-${index}`} x={point.x} z={point.z} />)}
    {[0, 0.5, 1].map((progress) => <RadialBeam key={`brace-${progress}`} spec={spec} progress={progress} y={0.23} size={0.025} color={ALUMINUM_SHADOW} />)}

    {/* Belt joints and blue photoelectric sensors echo the imported straight asset. */}
    <BeltSeam spec={spec} progress={0} />
    <BeltSeam spec={spec} progress={1} />
    {[0.12, 0.88].map((progress) => {
      const point = conveyorCornerArcPoint(spec, CONVEYOR_CORNER_OUTER_RAIL_RADIUS_M, progress)
      return <mesh key={`sensor-${progress}`} position={[point.x, RAIL_TOP_Y + 0.026, point.z]} castShadow>
        <boxGeometry args={[0.06, 0.052, 0.045]} />
        <meshStandardMaterial color={SENSOR_BLUE} emissive={SENSOR_BLUE} emissiveIntensity={0.08} roughness={0.34} metalness={0.45} />
      </mesh>
    })}
  </group>
}
