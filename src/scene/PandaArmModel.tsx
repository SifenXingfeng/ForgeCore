import { useEffect, useMemo, useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import URDFLoader, { type URDFJoint, type URDFRobot } from 'urdf-loader'

export const JOINT_NAMES = ['panda_joint1', 'panda_joint2', 'panda_joint3', 'panda_joint4', 'panda_joint5', 'panda_joint6', 'panda_joint7']
export const END_LINK = 'panda_link8'
const FINGER_JOINTS = ['panda_finger_joint1', 'panda_finger_joint2']
export const HOME_JOINTS: Record<string, number> = {
  panda_joint1: 0,
  panda_joint2: -0.785,
  panda_joint3: 0,
  panda_joint4: -2.356,
  panda_joint5: 0,
  panda_joint6: 1.571,
  panda_joint7: 0.785,
}
export const DEADZONE = 0.16
/** 统一关节运动上限：避免 IK 每帧大幅改关节造成视觉抽搐。 */
export const MAX_JOINT_STEP = 0.010
/** 更强阻尼让机械臂接近目标时不在相邻解之间来回切换。 */
export const DAMPING = 0.18
const previousPadButtons: boolean[] = []

type RobotMode = 'auto' | 'manual'
type RobotTask = 'sort' | 'weld' | 'assemble'
type RobotControl = { mode: RobotMode; task: RobotTask; gripOpen: boolean; reset: boolean }
type PandaArmBehavior = 'assembly' | 'infeed'

let pandaTemplatePromise: Promise<URDFRobot> | null = null

/** 黛玉资产复用：URDF/DAE只解析一次，各设备克隆独立关节树。 */
export function loadPandaTemplate(): Promise<URDFRobot> {
  if (pandaTemplatePromise) return pandaTemplatePromise

  const manager = new THREE.LoadingManager()
  const loader = new URDFLoader(manager)
  loader.packages = {}
  loader.parseCollision = false
  pandaTemplatePromise = loader.loadAsync('/models/panda/panda.urdf').then(async (loaded) => {
    await waitForRobotVisuals(loaded)
    setHome(loaded)
    setGripper(loaded, 1)
    loaded.updateMatrixWorld(true)
    normalizeRobot(loaded)
    return loaded
  }).catch((error) => {
    pandaTemplatePromise = null
    throw error
  })
  return pandaTemplatePromise
}

export function preloadPandaArm() {
  void loadPandaTemplate().catch(() => {})
}

export function PandaArmModel({ behavior = 'assembly', active = true, running = true, progress = 0, rackSide = 'back', reverse = false, castShadows = true }: { behavior?: PandaArmBehavior; active?: boolean; running?: boolean; progress?: number; rackSide?: 'back' | 'left' | 'right'; reverse?: boolean; castShadows?: boolean }) {
  const [robot, setRobot] = useState<URDFRobot | null>(null)
  const [robotReady, setRobotReady] = useState(false)

  useEffect(() => {
    let disposed = false
    loadPandaTemplate().then((template) => {
      if (disposed) return
      const loaded = template.clone(true) as URDFRobot
      loaded.traverse((node) => {
        if (node instanceof THREE.Mesh) node.castShadow = castShadows
      })
      setHome(loaded)
      setGripper(loaded, 1)
      loaded.updateMatrixWorld(true)
      setRobot(loaded)
      setRobotReady(true)
    }).catch(() => {
      // The precise GLB remains a safe fallback if the optional URDF asset is unavailable.
    })
    return () => { disposed = true }
  }, [castShadows])

  if (!robot || !robotReady) return <PandaArmFallback />
  return <PandaArmRuntime robot={robot} behavior={behavior} active={active} running={running} progress={progress} rackSide={rackSide} reverse={reverse} />
}

async function waitForRobotVisuals(robot: URDFRobot): Promise<void> {
  const startedAt = performance.now()
  let lastCount = -1
  let stableRounds = 0
  while (true) {
    let meshCount = 0
    robot.traverse((node) => {
      if (node instanceof THREE.Mesh && node.geometry?.attributes.position?.count > 0) meshCount += 1
    })
    robot.updateMatrixWorld(true)
    const bounds = new THREE.Box3().setFromObject(robot)
    const size = bounds.getSize(new THREE.Vector3())
    const finiteBounds = [bounds.min.x, bounds.min.y, bounds.min.z, bounds.max.x, bounds.max.y, bounds.max.z]
      .every(Number.isFinite)

    // Collada 网格是渐进加载的：等网格数连续多轮不再增长（完全加载）再返回，
    // 避免提前用不完整几何做 normalizeRobot 导致后续网格错位/缺部件。
    if (meshCount >= 10 && meshCount === lastCount && finiteBounds && size.lengthSq() > 0.01) {
      stableRounds += 1
      if (stableRounds >= 5) return
    } else {
      stableRounds = 0
    }
    lastCount = meshCount
    if (performance.now() - startedAt > 20_000) throw new Error('Panda visual meshes timed out')
    await new Promise<void>((resolve) => window.setTimeout(resolve, 40))
  }
}

function PandaArmFallback() {
  return <group position={[0, 0.2, 0]}>
    <mesh castShadow><cylinderGeometry args={[0.2, 0.24, 0.18, 20]} /><meshStandardMaterial color="#cbd3d7" metalness={0.35} roughness={0.42} /></mesh>
    <mesh position={[0, 0.32, 0]} rotation={[0, 0, -0.35]} castShadow><boxGeometry args={[0.16, 0.52, 0.16]} /><meshStandardMaterial color="#dbe1e4" metalness={0.28} roughness={0.44} /></mesh>
    <mesh position={[0.08, 0.62, 0]} rotation={[0, 0, 0.8]} castShadow><boxGeometry args={[0.14, 0.42, 0.14]} /><meshStandardMaterial color="#b8c2c7" metalness={0.3} roughness={0.45} /></mesh>
    <mesh position={[0.18, 0.86, 0]} castShadow><boxGeometry args={[0.18, 0.2, 0.18]} /><meshStandardMaterial color="#eef1f2" metalness={0.22} roughness={0.38} /></mesh>
  </group>
}

function PandaArmRuntime({ robot, behavior, active, running, progress, rackSide, reverse }: { robot: URDFRobot; behavior: PandaArmBehavior; active: boolean; running: boolean; progress: number; rackSide: 'back' | 'left' | 'right'; reverse: boolean }) {
  const runtimeRef = useRef<THREE.Group>(null)
  const control = useRef<RobotControl>({ mode: 'auto', task: 'sort', gripOpen: true, reset: false })
  const targetPos = useRef(new THREE.Vector3())
  const targetQuat = useRef(new THREE.Quaternion())
  const payloadPosition = useRef(new THREE.Vector3())
  const payloadRef = useRef<THREE.Mesh>(null)
  const homePose = useRef<{ x: number; y: number; z: number; quaternion: THREE.Quaternion } | null>(null)
  const initialized = useRef(false)
  const visualProgress = useRef(0)
  const gripperAmount = useRef(1)
  const ik = useMemo(() => createDlsIk(robot), [robot])

  useEffect(() => {
    const onCommand = (event: Event) => {
      const detail = (event as CustomEvent<{ mode?: RobotMode; task?: RobotTask; action?: string }>).detail
      if (detail.mode) control.current.mode = detail.mode
      if (detail.task) control.current.task = detail.task
      if (detail.action === 'grip') control.current.gripOpen = !control.current.gripOpen
      if (detail.action === 'reset') control.current.reset = true
    }
    window.addEventListener('forgemind:robot-command', onCommand)
    return () => window.removeEventListener('forgemind:robot-command', onCommand)
  }, [])

  useEffect(() => {
    const keys = new Set<string>()
    const onDown = (event: KeyboardEvent) => keys.add(event.code)
    const onUp = (event: KeyboardEvent) => keys.delete(event.code)
    window.addEventListener('keydown', onDown)
    window.addEventListener('keyup', onUp)
    ;(window as Window & { __forgeKeys?: Set<string> }).__forgeKeys = keys
    return () => { window.removeEventListener('keydown', onDown); window.removeEventListener('keyup', onUp) }
  }, [])

  useFrame(({ clock }, delta) => {
    // 登录舱期间工厂会以不可见状态预热。祖先节点不可见时跳过 IK，
    // 避免十余个机械臂在后台消耗主线程，舱门动画因此不再与 IK 抢帧。
    if (!runtimeRef.current || !isHierarchyVisible(runtimeRef.current)) return
    robot.updateMatrixWorld(true)
    const end = robot.links[END_LINK]
    if (!end) return
    if (!initialized.current) {
      setHome(robot)
      robot.updateMatrixWorld(true)
      end.getWorldPosition(targetPos.current)
      end.getWorldQuaternion(targetQuat.current)
      homePose.current = { x: targetPos.current.x, y: targetPos.current.y, z: targetPos.current.z, quaternion: targetQuat.current.clone() }
      initialized.current = true
      return
    }

    if (behavior === 'infeed') {
      if (!running) return
      if (!active) {
        visualProgress.current = THREE.MathUtils.damp(visualProgress.current, 0, 3.5, delta)
        if (homePose.current) {
          targetPos.current.set(homePose.current.x, homePose.current.y, homePose.current.z)
          targetQuat.current.copy(homePose.current.quaternion)
          ik.solve(targetPos.current, targetQuat.current, 1)
        }
        gripperAmount.current = THREE.MathUtils.damp(gripperAmount.current, 1, 7, delta)
        setGripper(robot, gripperAmount.current)
        if (payloadRef.current) payloadRef.current.visible = false
        return
      }

      const targetPhase = THREE.MathUtils.clamp(progress, 0, 0.9999)
      if (targetPhase + 0.35 < visualProgress.current) visualProgress.current = targetPhase
      visualProgress.current = THREE.MathUtils.damp(visualProgress.current, targetPhase, 9, delta)
      const phase = reverse ? 1 - visualProgress.current : visualProgress.current
      const pose = sampleInfeedPose(phase, rackSide)
      targetPos.current.set(pose[0], pose[1], pose[2])
      runtimeRef.current?.localToWorld(targetPos.current)
      if (homePose.current) targetQuat.current.copy(homePose.current.quaternion)
      ik.solve(targetPos.current, targetQuat.current, 1)
      const carrying = phase >= 0.34 && phase < 0.84
      const payloadVisible = phase >= 0.34 && phase < 0.995
      gripperAmount.current = THREE.MathUtils.damp(gripperAmount.current, phase >= 0.3 && phase < 0.87 ? 0 : 1, 10, delta)
      setGripper(robot, gripperAmount.current)
      if (payloadRef.current) {
        payloadRef.current.visible = payloadVisible
        if (carrying) {
          robot.updateMatrixWorld(true)
          robot.links[END_LINK]?.getWorldPosition(payloadPosition.current)
          runtimeRef.current?.worldToLocal(payloadPosition.current)
          payloadPosition.current.y -= 0.1
        } else {
          const beltPhase = smootherstep(THREE.MathUtils.clamp((phase - 0.84) / 0.155, 0, 1))
          payloadPosition.current.set(
            THREE.MathUtils.lerp(0.95, 1.33, beltPhase),
            0.49,
            -0.31,
          )
        }
        payloadRef.current.position.copy(payloadPosition.current)
      }
      return
    }

    if (!active && control.current.mode === 'auto') {
      if (homePose.current) {
        targetPos.current.set(homePose.current.x, homePose.current.y, homePose.current.z)
        targetQuat.current.copy(homePose.current.quaternion)
        ik.solve(targetPos.current, targetQuat.current, 1)
      }
      gripperAmount.current = THREE.MathUtils.damp(gripperAmount.current, 1, 7, delta)
      setGripper(robot, gripperAmount.current)
      return
    }

    if (control.current.reset) {
      setHome(robot)
      end.getWorldPosition(targetPos.current)
      end.getWorldQuaternion(targetQuat.current)
      control.current.reset = false
    }

    const input = readInput()
    if (input.gripEdge) control.current.gripOpen = !control.current.gripOpen
    if (input.resetEdge) control.current.reset = true
    if (control.current.mode === 'manual') {
      targetPos.current.x += input.move.x * 0.18 * delta
      targetPos.current.y += input.move.y * 0.18 * delta
      targetPos.current.z += input.move.z * 0.18 * delta
      targetPos.current.y = THREE.MathUtils.clamp(targetPos.current.y, 0.12, 1.0)
      targetPos.current.x = THREE.MathUtils.clamp(targetPos.current.x, -0.78, 0.78)
      targetPos.current.z = THREE.MathUtils.clamp(targetPos.current.z, 0.1, 1.0)
      const euler = new THREE.Euler(input.rot.pitch * 0.85 * delta, input.rot.yaw * 0.85 * delta, input.rot.roll * 0.85 * delta, 'XYZ')
      targetQuat.current.premultiply(new THREE.Quaternion().setFromEuler(euler)).normalize()
      ik.solve(targetPos.current, targetQuat.current, 3)
    } else {
      const phase = clock.getElapsedTime() * (control.current.task === 'weld' ? 1.35 : control.current.task === 'assemble' ? 0.82 : 0.58)
      const home = homePose.current ?? getHomePose(robot)
      targetPos.current.set(home.x + Math.sin(phase) * 0.14, home.y + 0.08 + Math.sin(phase * 0.5) * 0.04, home.z + Math.cos(phase) * 0.12)
      targetQuat.current.copy(home.quaternion)
      ik.solve(targetPos.current, targetQuat.current, 1)
    }
    setGripper(robot, control.current.gripOpen ? 1 : 0)
  })

  return (
    <group ref={runtimeRef}>
      <primitive object={robot} />
      {behavior === 'infeed' && (
        <mesh ref={payloadRef} visible={false} castShadow>
          <boxGeometry args={[0.16, 0.12, 0.16]} />
          <meshStandardMaterial color="#b98245" roughness={0.76} />
        </mesh>
      )}
    </group>
  )
}

function isHierarchyVisible(object: THREE.Object3D) {
  let current: THREE.Object3D | null = object
  while (current) {
    if (!current.visible) return false
    current = current.parent
  }
  return true
}

export function normalizeRobot(robot: URDFRobot) {
  // Keep the Collada visuals in the link frames created by URDFLoader. Only
  // the complete Z-up robot root is converted to the factory's Y-up space.
  robot.rotation.x = -Math.PI / 2
  robot.updateMatrixWorld(true)
  const box = new THREE.Box3().setFromObject(robot)
  const size = box.getSize(new THREE.Vector3())
  const scale = Math.min(1.25 / Math.max(size.y, 0.001), 1.1 / Math.max(size.x, size.z, 0.001))
  robot.scale.setScalar(scale)
  robot.updateMatrixWorld(true)
  const normalized = new THREE.Box3().setFromObject(robot)
  // setFromObject returns world-space bounds. Convert them back into the
  // robot runtime group's local space before correcting the origin; otherwise
  // the station's grid position is accidentally baked into robot.position.
  const localBounds = boxInParentSpace(normalized, robot.parent)
  const center = localBounds.getCenter(new THREE.Vector3())
  robot.position.x -= center.x
  robot.position.z -= center.z
  robot.position.y -= localBounds.min.y
  robot.traverse((node) => {
    if (!(node instanceof THREE.Mesh)) return
    node.castShadow = true
    node.receiveShadow = true
    const materials = Array.isArray(node.material) ? node.material : [node.material]
    node.material = materials.map((material) => new THREE.MeshStandardMaterial({
      color: material.color?.isColor ? material.color : new THREE.Color('#d8dde0'),
      roughness: 0.45,
      metalness: 0.18,
      side: THREE.DoubleSide,
    }))
    if (Array.isArray(node.material) && node.material.length === 1) node.material = node.material[0]
  })
}

function boxInParentSpace(box: THREE.Box3, parent: THREE.Object3D | null) {
  if (!parent) return box.clone()
  const local = new THREE.Box3()
  for (const x of [box.min.x, box.max.x]) {
    for (const y of [box.min.y, box.max.y]) {
      for (const z of [box.min.z, box.max.z]) {
        local.expandByPoint(parent.worldToLocal(new THREE.Vector3(x, y, z)))
      }
    }
  }
  return local
}

const INFEED_POSES: Array<{ at: number; position: [number, number, number] }> = [
  { at: 0, position: [-0.02, 0.82, 0.1] },
  { at: 0.14, position: [-1.08, 0.82, 0.1] },
  { at: 0.28, position: [-1.08, 0.58, 0.1] },
  { at: 0.38, position: [-1.08, 0.58, 0.1] },
  { at: 0.5, position: [-1.08, 0.82, 0.1] },
  { at: 0.68, position: [1.145, 0.82, -0.31] },
  { at: 0.8, position: [1.145, 0.59, -0.31] },
  { at: 0.88, position: [1.145, 0.59, -0.31] },
  { at: 1, position: [-0.02, 0.82, 0.1] },
]

function sampleInfeedPose(phase: number, rackSide: 'back' | 'left' | 'right' = 'back'): [number, number, number] {
  const value = THREE.MathUtils.clamp(phase, 0, 0.9999)
  const nextIndex = INFEED_POSES.findIndex((keyframe) => keyframe.at > value)
  const index = Math.max(0, nextIndex < 0 ? INFEED_POSES.length - 2 : nextIndex - 1)
  const from = INFEED_POSES[index]
  const to = INFEED_POSES[Math.min(index + 1, INFEED_POSES.length - 1)]
  const t = (value - from.at) / Math.max(to.at - from.at, 0.0001)
  const eased = smootherstep(THREE.MathUtils.clamp(t, 0, 1))
  const pose: [number, number, number] = [
    THREE.MathUtils.lerp(from.position[0], to.position[0], eased),
    THREE.MathUtils.lerp(from.position[1], to.position[1], eased),
    THREE.MathUtils.lerp(from.position[2], to.position[2], eased),
  ]
  // Only retarget the rack half of the cycle; the conveyor hand-off remains
  // fixed on the station's front side.
  if (value < 0.58) {
    if (rackSide === 'left') { pose[0] = -0.18; pose[2] = 1.18 }
    if (rackSide === 'right') { pose[0] = -0.18; pose[2] = -1.18 }
  }
  return pose
}

function smootherstep(value: number) {
  return value * value * value * (value * (value * 6 - 15) + 10)
}

export function setHome(robot: URDFRobot) {
  Object.entries(HOME_JOINTS).forEach(([name, value]) => robot.joints[name]?.setJointValue(value))
}

export function setGripper(robot: URDFRobot, open: number) {
  FINGER_JOINTS.forEach((name) => robot.joints[name]?.setJointValue(open * 0.04))
}

export function getHomePose(robot: URDFRobot) {
  setHome(robot)
  robot.updateMatrixWorld(true)
  const position = new THREE.Vector3()
  const quaternion = new THREE.Quaternion()
  robot.links[END_LINK].getWorldPosition(position)
  robot.links[END_LINK].getWorldQuaternion(quaternion)
  return { x: position.x, y: position.y, z: position.z, quaternion }
}

export function readInput() {
  const keys = (window as Window & { __forgeKeys?: Set<string> }).__forgeKeys ?? new Set<string>()
  const pad = Array.from(navigator.getGamepads?.() ?? []).find((candidate) => candidate?.connected)
  const axis = (index: number) => {
    const value = pad?.axes[index] ?? 0
    return Math.abs(value) < DEADZONE ? 0 : Math.sign(value) * ((Math.abs(value) - DEADZONE) / (1 - DEADZONE)) ** 1.6
  }
  const buttons = pad?.buttons.map((button) => button.pressed) ?? []
  const gripEdge = Boolean(buttons[2] && !previousPadButtons[2])
  const resetEdge = Boolean(buttons[3] && !previousPadButtons[3])
  previousPadButtons.splice(0, previousPadButtons.length, ...buttons)
  return {
    move: {
      x: axis(0) || ((keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0)),
      y: axis(1) * -1 || ((keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0)),
      z: axis(3) * -1 || ((keys.has('KeyR') ? 1 : 0) - (keys.has('KeyF') ? 1 : 0)),
    },
    rot: {
      yaw: axis(2) || ((keys.has('ArrowRight') ? 1 : 0) - (keys.has('ArrowLeft') ? 1 : 0)),
      pitch: (pad?.buttons[12]?.pressed ? 1 : 0) - (pad?.buttons[13]?.pressed ? 1 : 0) || ((keys.has('ArrowUp') ? 1 : 0) - (keys.has('ArrowDown') ? 1 : 0)),
      roll: (pad?.buttons[15]?.pressed ? 1 : 0) - (pad?.buttons[14]?.pressed ? 1 : 0) || ((keys.has('KeyU') ? 1 : 0) - (keys.has('KeyO') ? 1 : 0)),
    },
    gripEdge,
    resetEdge,
  }
}

export function createDlsIk(robot: URDFRobot) {
  const joints = JOINT_NAMES.map((name) => robot.joints[name]).filter((joint): joint is URDFJoint => Boolean(joint))
  const axes = joints.map((joint) => joint.axis.clone())
  const pEE = new THREE.Vector3()
  const qEE = new THREE.Quaternion()

  const solve = (target: THREE.Vector3, targetQuat: THREE.Quaternion, maxIterations = 2) => {
    solveInternal(target, targetQuat, maxIterations)
  }

  // 摄像头环绕时只约束末端位置。相机的真实朝向由外部 camera.lookAt
  // 控制，避免固定 Panda 末端姿态让圆周上的某些点变成不可达姿态。
  const solvePosition = (target: THREE.Vector3, maxIterations = 2) => {
    solveInternal(target, null, maxIterations)
  }

  const solveInternal = (target: THREE.Vector3, targetQuat: THREE.Quaternion | null, maxIterations: number) => {
    const end = robot.links[END_LINK]
    const angles = joints.map((joint) => joint.angle)
    for (let iteration = 0; iteration < maxIterations; iteration += 1) {
      robot.updateMatrixWorld(true)
      end.getWorldPosition(pEE)
      end.getWorldQuaternion(qEE)
      const positionError = target.clone().sub(pEE)
      const rotationError = targetQuat
        ? quatToVector(targetQuat.clone().multiply(qEE.clone().invert()))
        : new THREE.Vector3()
      if (positionError.length() < 0.004 && rotationError.length() < 0.02) break
      const jacobian = joints.map((joint, index) => {
        const origin = new THREE.Vector3()
        const worldAxis = axes[index].clone()
        const rotation = new THREE.Quaternion()
        joint.getWorldPosition(origin)
        joint.getWorldQuaternion(rotation)
        worldAxis.applyQuaternion(rotation).normalize()
        const linear = new THREE.Vector3().crossVectors(worldAxis, pEE.clone().sub(origin))
        return [linear.x, linear.y, linear.z, worldAxis.x, worldAxis.y, worldAxis.z]
      })
      const error = [positionError.x, positionError.y, positionError.z, rotationError.x, rotationError.y, rotationError.z]
      const delta = solveDls(jacobian, error)
      joints.forEach((joint, index) => {
        const limit = joint.limit
        const next = THREE.MathUtils.clamp(angles[index] + THREE.MathUtils.clamp(delta[index], -MAX_JOINT_STEP, MAX_JOINT_STEP), limit?.lower ?? -Infinity, limit?.upper ?? Infinity)
        angles[index] = next
        joint.setJointValue(next)
      })
    }
  }
  return { solve, solvePosition }
}

function quatToVector(quaternion: THREE.Quaternion) {
  const vector = new THREE.Vector3(quaternion.x, quaternion.y, quaternion.z)
  const length = vector.length()
  if (length < 1e-8) return vector
  const w = quaternion.w < 0 ? -quaternion.w : quaternion.w
  if (quaternion.w < 0) vector.multiplyScalar(-1)
  return vector.multiplyScalar((2 * Math.atan2(length, w)) / length)
}

function solveDls(jacobian: number[][], error: number[]) {
  const n = jacobian.length
  const a = Array.from({ length: 6 }, (_, row) => Array.from({ length: 6 }, (_, col) => {
    let sum = 0
    for (let index = 0; index < n; index += 1) sum += jacobian[index][row] * jacobian[index][col]
    return sum + (row === col ? DAMPING * DAMPING : 0)
  }))
  const x = gaussian(a, [...error])
  return Array.from({ length: n }, (_, index) => jacobian[index].reduce((sum, value, row) => sum + value * x[row], 0))
}

function gaussian(matrix: number[][], values: number[]) {
  for (let column = 0; column < 6; column += 1) {
    let pivot = column
    for (let row = column + 1; row < 6; row += 1) if (Math.abs(matrix[row][column]) > Math.abs(matrix[pivot][column])) pivot = row
    if (pivot !== column) { [matrix[column], matrix[pivot]] = [matrix[pivot], matrix[column]]; [values[column], values[pivot]] = [values[pivot], values[column]] }
    const divisor = matrix[column][column] || 1e-9
    for (let row = column + 1; row < 6; row += 1) {
      const factor = matrix[row][column] / divisor
      for (let col = column; col < 6; col += 1) matrix[row][col] -= factor * matrix[column][col]
      values[row] -= factor * values[column]
    }
  }
  const result = Array(6).fill(0) as number[]
  for (let row = 5; row >= 0; row -= 1) {
    let value = values[row]
    for (let col = row + 1; col < 6; col += 1) value -= matrix[row][col] * result[col]
    result[row] = value / (matrix[row][row] || 1e-9)
  }
  return result
}
