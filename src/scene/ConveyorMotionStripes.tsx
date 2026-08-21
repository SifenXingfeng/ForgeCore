import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import {
  CONVEYOR_CORNER_CENTERLINE_RADIUS_M,
  CONVEYOR_DIRECTION_STRIPE_COLOR,
  CONVEYOR_DIRECTION_STRIPE_HEIGHT_M,
  CONVEYOR_DIRECTION_STRIPE_LENGTH_M,
  CONVEYOR_DIRECTION_STRIPE_OPACITY,
  CONVEYOR_DIRECTION_STRIPE_PHASE_RATE,
  CONVEYOR_DIRECTION_STRIPE_WIDTH_M,
  CONVEYOR_VISUAL_SURFACE_Y_M,
  advanceConveyorStripePhase,
  conveyorCornerArcPoint,
  conveyorCornerArcSpec,
  conveyorCornerArcTangent,
  conveyorStripeCount,
  conveyorStripeProgress,
} from './industrialVisualScale'

function StripeMesh() {
  return <mesh>
    <boxGeometry args={[
      CONVEYOR_DIRECTION_STRIPE_LENGTH_M,
      CONVEYOR_DIRECTION_STRIPE_HEIGHT_M,
      CONVEYOR_DIRECTION_STRIPE_WIDTH_M,
    ]} />
    <meshBasicMaterial
      color={CONVEYOR_DIRECTION_STRIPE_COLOR}
      transparent
      opacity={CONVEYOR_DIRECTION_STRIPE_OPACITY}
      depthWrite={false}
      toneMapped={false}
    />
  </mesh>
}

/** Repeating cross-belt bars for a local +X conveyor path. */
export function LinearConveyorMotionStripes({ running, length = 1, direction = 1 }: { running: boolean; length?: number; direction?: 1 | -1 }) {
  const group = useRef<THREE.Group>(null)
  const phaseRef = useRef(0)
  const count = conveyorStripeCount(length)

  useFrame((_, delta) => {
    if (!group.current) return
    if (running) phaseRef.current = advanceConveyorStripePhase(phaseRef.current, delta, direction)
    group.current.children.forEach((stripe, index) => {
      stripe.position.x = (conveyorStripeProgress(phaseRef.current, index, count) - 0.5) * length
    })
  })

  return <group ref={group} position={[0, CONVEYOR_VISUAL_SURFACE_Y_M + 0.018, 0]}>
    {Array.from({ length: count }, (_, index) => <StripeMesh key={index} />)}
  </group>
}

/** Cross-belt bars that rotate continuously with the tangent of a 90° bend. */
export function CornerConveyorMotionStripes({ running, inputSide }: { running: boolean; inputSide: 'left' | 'right' }) {
  const group = useRef<THREE.Group>(null)
  const phaseRef = useRef(0)
  const spec = useMemo(() => conveyorCornerArcSpec(inputSide), [inputSide])
  const pathLength = Math.PI * CONVEYOR_CORNER_CENTERLINE_RADIUS_M / 2
  const count = conveyorStripeCount(pathLength)

  useFrame((_, delta) => {
    if (!group.current) return
    if (running) phaseRef.current = (phaseRef.current + delta * CONVEYOR_DIRECTION_STRIPE_PHASE_RATE) % 1
    group.current.children.forEach((stripe, index) => {
      const progress = conveyorStripeProgress(phaseRef.current, index, count)
      const point = conveyorCornerArcPoint(spec, CONVEYOR_CORNER_CENTERLINE_RADIUS_M, progress)
      const tangent = conveyorCornerArcTangent(spec, progress)
      stripe.position.set(point.x, CONVEYOR_VISUAL_SURFACE_Y_M + 0.018, point.z)
      stripe.rotation.set(0, -Math.atan2(tangent.z, tangent.x), 0)
    })
  })

  return <group ref={group}>
    {Array.from({ length: count }, (_, index) => <StripeMesh key={index} />)}
  </group>
}
