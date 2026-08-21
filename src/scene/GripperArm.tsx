import { useEffect, useMemo, useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import type { URDFRobot } from 'urdf-loader'
import {
  createDlsIk,
  END_LINK,
  loadPandaTemplate,
  normalizeRobot,
  readInput,
  setGripper,
  setHome,
} from './PandaArmModel'
import { changeInspectionPart, INSPECTION_STATION, inspectionRegistry } from './inspectionRegistry'
import { createPartTexture } from './inspectionPart'

type GState = 'to-source' | 'pick' | 'to-inspect' | 'hold' | 'place' | 'release' | 'back'

const ST = INSPECTION_STATION
/** 货物从末端法兰下垂的安全距离，避免盒体进入腕部外壳。 */
const PAYLOAD_DROP = 0.10

/** 各状态的目标位置 + 夹爪开合(1开/0合) + 持续时间 + 末端限速。 */
const STATE_CFG: Record<GState, { pos: [number, number, number]; grip: number; dur: number; speed: number }> = {
  'to-source': { pos: [ST.sourceLocal.x, 0.85, ST.sourceLocal.z], grip: 1, dur: 2.0, speed: 0.62 },
  'pick': { pos: [ST.sourceLocal.x, 0.2, ST.sourceLocal.z], grip: 0, dur: 0.9, speed: 0.3 },
  'to-inspect': { pos: [ST.inspectPoseLocal.x, ST.inspectPoseLocal.y, ST.inspectPoseLocal.z], grip: 0, dur: 3.6, speed: 0.58 },
  'hold': { pos: [ST.inspectPoseLocal.x, ST.inspectPoseLocal.y, ST.inspectPoseLocal.z], grip: 0, dur: 999, speed: 0.2 },
  'place': { pos: [ST.sortApproachLocal.x, ST.sortApproachLocal.y, ST.sortApproachLocal.z], grip: 0, dur: 3.0, speed: 0.52 },
  'release': { pos: [ST.sortApproachLocal.x, ST.sortApproachLocal.y, ST.sortApproachLocal.z], grip: 1, dur: 0.9, speed: 0.24 },
  'back': { pos: [ST.sourceLocal.x, 0.85, ST.sourceLocal.z], grip: 1, dur: 2.0, speed: 0.62 },
}

function moveTowards(current: THREE.Vector3, target: THREE.Vector3, maxDistance: number) {
  const offset = target.clone().sub(current)
  const distance = offset.length()
  if (distance <= maxDistance || distance < 0.001) {
    current.copy(target)
    return
  }
  current.addScaledVector(offset, maxDistance / distance)
}

function captureJointAngles(robot: URDFRobot) {
  return Object.entries(robot.joints).map(([name, joint]) => [name, joint.angle] as [string, number])
}

function restoreJointAngles(robot: URDFRobot, snapshot: Array<[string, number]>) {
  snapshot.forEach(([name, angle]) => robot.joints[name]?.setJointValue(angle))
}

/**
 * 夹取机械臂（状态机）：取货 → 举到悬空检测位 → 等检测 → 按判定放到合格/不合格区。
 * 无桌子：零件悬空夹在爪上，摄像头臂环绕检测。
 */
export function GripperArm() {
  const [robot, setRobot] = useState<URDFRobot | null>(null)
  const stationRef = useRef<THREE.Group>(null)
  const armRef = useRef<THREE.Group>(null)
  const payloadRef = useRef<THREE.Mesh>(null)
  const targetPos = useRef(new THREE.Vector3())
  const targetQuat = useRef(new THREE.Quaternion())
  const homePose = useRef<{ x: number; y: number; z: number; q: THREE.Quaternion } | null>(null)
  const initialized = useRef(false)
  const state = useRef<GState>('to-source')
  const stateT = useRef(0)
  const carry = useRef(false)
  const manualMode = useRef(false)
  const manualGrip = useRef(1)
  const blockedLastFrame = useRef(false)
  const stationPos = useMemo(
    () => new THREE.Vector3(INSPECTION_STATION.pos.x, 0, INSPECTION_STATION.pos.z),
    [],
  )
  const ik = useMemo(() => (robot ? createDlsIk(robot) : null), [robot])

  // 被测件缺陷贴图（夹爪举着的货物）
  const [partSeed, setPartSeed] = useState(inspectionRegistry.partSeed)
  useEffect(() => {
    const onChange = (event: Event) => {
      const detail = (event as CustomEvent<{ seed: number }>).detail
      setPartSeed(detail.seed)
    }
    window.addEventListener('forgemind:change-part', onChange)
    return () => window.removeEventListener('forgemind:change-part', onChange)
  }, [])

  useEffect(() => {
    if (!robot) return
    const onReset = (event: Event) => {
      const detail = (event as CustomEvent<{ arm?: string }>).detail
      if (detail.arm !== 'gripper') return
      const end = robot.links[END_LINK]
      if (!end) return
      setHome(robot)
      robot.updateMatrixWorld(true)
      end.getWorldPosition(targetPos.current)
      end.getWorldQuaternion(targetQuat.current)
      manualMode.current = false
    }
    window.addEventListener('forgemind:inspection-reset-arm', onReset)
    return () => window.removeEventListener('forgemind:inspection-reset-arm', onReset)
  }, [robot])
  const partTexture = useMemo(() => createPartTexture(partSeed), [partSeed])

  useEffect(() => {
    if (payloadRef.current) {
      ;(payloadRef.current.material as THREE.MeshBasicMaterial).map = partTexture
      ;(payloadRef.current.material as THREE.MeshBasicMaterial).needsUpdate = true
    }
  }, [partTexture])

  useEffect(() => {
    let disposed = false
    loadPandaTemplate()
      .then((template) => {
        if (disposed) return
        const loaded = template.clone(true) as URDFRobot
        normalizeRobot(loaded)
        setHome(loaded)
        setGripper(loaded, 1)
        loaded.updateMatrixWorld(true)
        inspectionRegistry.gripperCollider = loaded
        setRobot(loaded)
      })
      .catch(() => {})
    return () => {
      disposed = true
      inspectionRegistry.gripperCollider = null
    }
  }, [])

  // 状态转移
  const advance = () => {
    const next: Record<GState, GState> = {
      'to-source': 'pick',
      'pick': 'to-inspect',
      'to-inspect': 'hold',
      'hold': 'place',
      'place': 'release',
      'release': 'back',
      'back': 'to-source',
    }
    state.current = next[state.current]
    stateT.current = 0
  }

  useFrame((_, delta) => {
    if (!stationRef.current || !armRef.current || !robot || !ik) return
    robot.updateMatrixWorld(true)
    const end = robot.links[END_LINK]
    if (!end) return

    const solveGripperSafely = (solve: () => void) => {
      const snapshot = captureJointAngles(robot)
      solve()
      robot.updateMatrixWorld(true)
      const cameraArm = inspectionRegistry.cameraOccluder
      if (!cameraArm) return true
      cameraArm.updateMatrixWorld(true)
      const gripperBox = new THREE.Box3().setFromObject(robot)
      const cameraBox = new THREE.Box3().setFromObject(cameraArm).expandByScalar(0.035)
      if (!gripperBox.intersectsBox(cameraBox)) return true
      // 夹取臂也必须遵守安全区：回滚到上一姿态，并让当前动作段停住等待下一帧。
      restoreJointAngles(robot, snapshot)
      robot.updateMatrixWorld(true)
      end.getWorldPosition(targetPos.current)
      end.getWorldQuaternion(targetQuat.current)
      return false
    }

    if (!initialized.current) {
      setHome(robot)
      robot.updateMatrixWorld(true)
      end.getWorldPosition(targetPos.current)
      end.getWorldQuaternion(targetQuat.current)
      homePose.current = {
        x: targetPos.current.x,
        y: targetPos.current.y,
        z: targetPos.current.z,
        q: targetQuat.current.clone(),
      }
      initialized.current = true
      return
    }

    const manualActive = inspectionRegistry.paused && inspectionRegistry.manualArm === 'gripper'
    if (manualActive) {
      if (!manualMode.current) {
        manualMode.current = true
        manualGrip.current = carry.current ? 0 : 1
        end.getWorldPosition(targetPos.current)
        end.getWorldQuaternion(targetQuat.current)
      }
      const input = readInput()
      if (input.resetEdge) {
        setHome(robot)
        robot.updateMatrixWorld(true)
        end.getWorldPosition(targetPos.current)
        end.getWorldQuaternion(targetQuat.current)
      } else {
        targetPos.current.x += input.move.x * 0.18 * delta
        targetPos.current.y += input.move.y * 0.18 * delta
        targetPos.current.z += input.move.z * 0.18 * delta
        if (homePose.current) {
          targetPos.current.x = THREE.MathUtils.clamp(targetPos.current.x, homePose.current.x - 0.55, homePose.current.x + 0.55)
          targetPos.current.z = THREE.MathUtils.clamp(targetPos.current.z, homePose.current.z - 0.55, homePose.current.z + 0.55)
        }
        targetPos.current.y = THREE.MathUtils.clamp(targetPos.current.y, 0.12, 1.15)
        const euler = new THREE.Euler(
          input.rot.pitch * 0.85 * delta,
          input.rot.yaw * 0.85 * delta,
          input.rot.roll * 0.85 * delta,
          'XYZ',
        )
        targetQuat.current.premultiply(new THREE.Quaternion().setFromEuler(euler)).normalize()
        if (input.gripEdge) manualGrip.current = manualGrip.current > 0.5 ? 0 : 1
        const solved = solveGripperSafely(() => ik.solve(targetPos.current, targetQuat.current, 3))
        blockedLastFrame.current = !solved
      }
      setGripper(robot, manualGrip.current)
      carry.current = manualGrip.current < 0.5
      if (payloadRef.current) {
        payloadRef.current.visible = carry.current
        if (carry.current) {
          robot.updateMatrixWorld(true)
          const p = new THREE.Vector3()
          end.getWorldPosition(p)
          armRef.current.worldToLocal(p)
          p.y -= PAYLOAD_DROP
          payloadRef.current.position.copy(p)
          const worldPos = new THREE.Vector3()
          payloadRef.current.getWorldPosition(worldPos)
          const localPos = stationRef.current.worldToLocal(worldPos)
          if (inspectionRegistry.heldPartPos) inspectionRegistry.heldPartPos.copy(localPos)
          else inspectionRegistry.heldPartPos = localPos.clone()
        }
      }
      return
    }
    manualMode.current = false
    if (inspectionRegistry.paused) return

    if (!blockedLastFrame.current) stateT.current += delta
    const cfg = STATE_CFG[state.current]

    // hold：等检测判定
    if (state.current === 'hold') {
      if (inspectionRegistry.lastVerdict !== null) advance()
    } else if (!blockedLastFrame.current && stateT.current >= cfg.dur) {
      // 进入取货：换新货 + 清空上次判定（让摄像头对下一个重新环绕检测）
      if (state.current === 'to-source') {
        changeInspectionPart(Math.floor(Math.random() * 4))
        inspectionRegistry.lastVerdict = null
      }
      advance()
    }

    // 根据当前状态计算目标位置。
    // 取料后先经过左前高位通道，再进入检测位，避免从两臂中间低位横穿。
    let targetLocal: [number, number, number] = STATE_CFG[state.current].pos
    if (state.current === 'to-inspect' && stateT.current < 1.35) {
      targetLocal = [ST.transferApproachLocal.x, ST.transferApproachLocal.y, ST.transferApproachLocal.z]
    }
    if (state.current === 'place' || state.current === 'release') {
      // 检测异常按安全原则进入隔离区，避免 AI/网络故障时把未判定件当作合格品放行。
      const dest = inspectionRegistry.lastVerdict === 'pass' ? ST.acceptLocal : ST.rejectLocal
      // 放置时先沿左前高位通道撤离检测区，再下降到对应料框。
      if (state.current === 'place' && stateT.current < 1.05) {
        targetLocal = [ST.sortApproachLocal.x, ST.sortApproachLocal.y, ST.sortApproachLocal.z]
      } else {
        targetLocal = [dest.x, dest.y + 0.15, dest.z]
      }
      if (state.current === 'release') targetLocal = [dest.x, dest.y, dest.z]
    }

    // 平滑移向目标
    const goal = new THREE.Vector3(...targetLocal)
    const current = stationRef.current.worldToLocal(targetPos.current.clone())
    moveTowards(current, goal, cfg.speed * delta)
    targetPos.current.copy(stationRef.current.localToWorld(current))
    // 自动夹取必须同时保持固定工具姿态；只追位置会让腕部自由翻转，导致货物穿入腕部模型。
    if (homePose.current) targetQuat.current.copy(homePose.current.q)
    blockedLastFrame.current = !solveGripperSafely(() => ik.solve(targetPos.current, targetQuat.current, 4))

    // 夹爪与阶段
    const grip = STATE_CFG[state.current].grip
    setGripper(robot, grip)
    carry.current = grip < 0.5
    inspectionRegistry.phase =
      state.current === 'hold' ? 'inspecting'
      : state.current === 'to-inspect' || state.current === 'pick' ? 'picking'
      : 'placing'

    // 载荷（悬空货物）跟随末端
    if (payloadRef.current) {
      payloadRef.current.visible = carry.current
      if (carry.current) {
        robot.updateMatrixWorld(true)
        const p = new THREE.Vector3()
        end.getWorldPosition(p)
        armRef.current.worldToLocal(p)
        p.y -= PAYLOAD_DROP
        payloadRef.current.position.copy(p)
        // 记录货物实际位置（站点局部）供摄像头瞄准/环绕
        const worldPos = new THREE.Vector3()
        payloadRef.current.getWorldPosition(worldPos)
        const localPos = stationRef.current.worldToLocal(worldPos)
        if (inspectionRegistry.heldPartPos) inspectionRegistry.heldPartPos.copy(localPos)
        else inspectionRegistry.heldPartPos = localPos.clone()
      }
    }
  })

  return (
    <group ref={stationRef} position={stationPos.toArray()}>
      <group ref={armRef} position={INSPECTION_STATION.gripperArmLocal.toArray()}>
        <mesh position={[0, 0.05, 0]} castShadow>
          <cylinderGeometry args={[0.22, 0.26, 0.1, 24]} />
          <meshStandardMaterial color="#4b5559" roughness={0.5} metalness={0.35} />
        </mesh>
        {robot && <primitive object={robot} />}
        {/* 夹持中的被测件（缺陷贴图） */}
        <mesh ref={payloadRef} visible={false} castShadow>
          <boxGeometry args={[0.12, 0.08, 0.14]} />
          <meshBasicMaterial color="#c98b4b" />
        </mesh>
      </group>

      {/* 地面取货标记（无桌子） */}
      <SourceMarker />
      {/* 合格/不合格放置区标记 */}
      <AreaMarkers />
    </group>
  )
}

function SourceMarker() {
  const s = ST.sourceLocal
  return (
    <group position={[s.x, 0, s.z]}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]} receiveShadow>
        <ringGeometry args={[0.16, 0.24, 24]} />
        <meshStandardMaterial color="#5b9b99" roughness={0.5} metalness={0.3} side={THREE.DoubleSide} />
      </mesh>
      {/* 待取货物 */}
      <mesh position={[0, 0.12, 0]} castShadow>
        <boxGeometry args={[0.12, 0.08, 0.14]} />
        <meshBasicMaterial color="#b98245" />
      </mesh>
    </group>
  )
}

function AreaMarkers() {
  const a = ST.acceptLocal
  const r = ST.rejectLocal
  const marker = (pos: [number, number, number], color: string) => (
    <group position={pos}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]} receiveShadow>
        <ringGeometry args={[0.18, 0.26, 24]} />
        <meshStandardMaterial color={color} roughness={0.5} metalness={0.2} side={THREE.DoubleSide} />
      </mesh>
    </group>
  )
  return (
    <>
      {marker([a.x, 0.02, a.z], '#2e8b57')}
      {marker([r.x, 0.02, r.z], '#c0392b')}
    </>
  )
}
