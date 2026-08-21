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
  setHome,
} from './PandaArmModel'
import { INSPECTION_STATION, inspectionRegistry } from './inspectionRegistry'
import { runInspection } from './inspectionDetect'

const MANUAL_SPEED = 0.18
/** 摄像头使用紧凑型机械臂，缩短工作包络，避免与夹取臂争用空间。 */
const CAMERA_ARM_SCALE = 0.82
const WORKSPACE = { halfXZ: 0.5, yMin: 0.1, yMax: 1.15 }
/** 环绕扫描参数：贴近货物上方完整水平环绕，距离保持在 Panda 可达区内。 */
/** 摄像头环绕层抬到夹爪上方，避免整圈运动时穿过夹持连杆。 */
/** 小臂抬头在货物上方环绕，整圈不进入夹爪所在高度层。 */
const ORBIT_RADIUS = 0.30
const ORBIT_HEIGHT = 0.28
const ORBIT_SPEED = 0.42
const ORBIT_BLEND_SECONDS = 0.85
/** 完整环绕一周并留出缓冲后再触发检测，保证所有侧面都进入视野。 */
const DETECT_DELAY = 15.0

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function captureJointAngles(robot: URDFRobot) {
  return Object.entries(robot.joints).map(([name, joint]) => [name, joint.angle] as [string, number])
}

function restoreJointAngles(robot: URDFRobot, snapshot: Array<[string, number]>) {
  snapshot.forEach(([name, angle]) => robot.joints[name]?.setJointValue(angle))
}

type CamMode = 'standby' | 'orbit' | 'returning' | 'manual'

/**
 * 质检摄像头机械臂：在悬空货物外侧完整环绕扫描。
 * 货物进视野即实时自动检测（跑全部检测项）→ 出结果后归位。
 * 空闲时手柄/键盘手动控制。
 */
export function InspectionCameraArm() {
  const [robot, setRobot] = useState<URDFRobot | null>(null)
  const stationRef = useRef<THREE.Group>(null)
  const armRef = useRef<THREE.Group>(null)
  const housingRef = useRef<THREE.Group | null>(null)
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null)
  const targetPos = useRef(new THREE.Vector3())
  const targetQuat = useRef(new THREE.Quaternion())
  const homePose = useRef<{ x: number; y: number; z: number; q: THREE.Quaternion } | null>(null)
  const initialized = useRef(false)
  const mode = useRef<CamMode>('standby')
  const orbitTime = useRef(0)
  const orbitBlend = useRef(0)
  const orbitEntryLocal = useRef(new THREE.Vector3())
  const orbitCenterLocal = useRef(new THREE.Vector3())
  const cameraTargetWorld = useRef(new THREE.Vector3())
  const cameraPoseReady = useRef(false)
  const detectFired = useRef(false)
  const stationPos = useMemo(
    () => new THREE.Vector3(INSPECTION_STATION.pos.x, 0, INSPECTION_STATION.pos.z),
    [],
  )
  const ik = useMemo(() => (robot ? createDlsIk(robot) : null), [robot])

  // 加载 Panda 模板 → 归一化 → 挂相机到末端
  useEffect(() => {
    let disposed = false
    loadPandaTemplate()
      .then((template) => {
        if (disposed) return
        const loaded = template.clone(true) as URDFRobot
        normalizeRobot(loaded)
        loaded.scale.multiplyScalar(CAMERA_ARM_SCALE)
        setHome(loaded)
        loaded.updateMatrixWorld(true)

        const cam = new THREE.PerspectiveCamera(42, 1, 0.03, 60)
        cameraRef.current = cam
        inspectionRegistry.camera = cam
        inspectionRegistry.cameraOccluder = loaded
        stationRef.current?.add(cam)

        // 摄像头臂：藏掉夹爪手指，末端加相机本体
        loaded.traverse((node) => {
          if (node.name.includes('finger')) node.visible = false
        })
        const end = loaded.links[END_LINK]
        if (end) {
          const housing = new THREE.Group()
          housing.name = 'inspection-camera-housing'
          housing.position.set(0.02, 0.05, 0.1)
          housingRef.current = housing
          const body = new THREE.Mesh(
            new THREE.BoxGeometry(0.06, 0.06, 0.09),
            new THREE.MeshStandardMaterial({ color: '#2b3133', roughness: 0.4, metalness: 0.5 }),
          )
          const lens = new THREE.Mesh(
            new THREE.CylinderGeometry(0.028, 0.028, 0.03, 20),
            new THREE.MeshStandardMaterial({ color: '#14181a', roughness: 0.15, metalness: 0.85 }),
          )
          lens.rotation.x = -Math.PI / 2
          lens.position.z = -0.06
          const ring = new THREE.Mesh(
            new THREE.TorusGeometry(0.03, 0.008, 8, 24),
            new THREE.MeshStandardMaterial({ color: '#5b9b99', roughness: 0.3, metalness: 0.6 }),
          )
          ring.position.z = -0.05
          cam.position.set(0, 0, -0.075)
          cam.rotation.set(0, 0, 0)
          housing.add(body, lens, ring)
          end.add(housing)
        }
        setRobot(loaded)
      })
      .catch(() => {})
    return () => {
      disposed = true
      inspectionRegistry.camera = null
      inspectionRegistry.cameraOccluder = null
    }
  }, [])

  useEffect(() => {
    if (!robot) return
    const onReset = (event: Event) => {
      const detail = (event as CustomEvent<{ arm?: string }>).detail
      if (detail.arm !== 'camera') return
      const end = robot.links[END_LINK]
      if (!end) return
      setHome(robot)
      robot.updateMatrixWorld(true)
      end.getWorldPosition(targetPos.current)
      end.getWorldQuaternion(targetQuat.current)
      mode.current = 'standby'
    }
    window.addEventListener('forgemind:inspection-reset-arm', onReset)
    return () => window.removeEventListener('forgemind:inspection-reset-arm', onReset)
  }, [robot])

  // 键盘/手柄输入集
  useEffect(() => {
    const keys = new Set<string>()
    const onDown = (event: KeyboardEvent) => keys.add(event.code)
    const onUp = (event: KeyboardEvent) => keys.delete(event.code)
    window.addEventListener('keydown', onDown)
    window.addEventListener('keyup', onUp)
    ;(window as Window & { __forgeKeys?: Set<string> }).__forgeKeys = keys
    return () => {
      window.removeEventListener('keydown', onDown)
      window.removeEventListener('keyup', onUp)
    }
  }, [])

  useFrame((_, delta) => {
    if (!stationRef.current || !armRef.current || !robot || !ik) return
    robot.updateMatrixWorld(true)
    const end = robot.links[END_LINK]
    if (!end) return

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

    const phase = inspectionRegistry.phase
    const verdict = inspectionRegistry.lastVerdict
    // 环绕中心 = 货物实际位置（夹取爪举着），否则退回检测位
    const centerLocal = inspectionRegistry.heldPartPos ?? INSPECTION_STATION.inspectPoseLocal
    const solveCameraPosition = (iterations: number) => {
      const snapshot = captureJointAngles(robot)
      ik.solvePosition(targetPos.current, iterations)
      robot.updateMatrixWorld(true)
      const gripper = inspectionRegistry.gripperCollider
      if (!gripper) return
      const cameraBox = new THREE.Box3().setFromObject(robot)
      const gripperBox = new THREE.Box3().setFromObject(gripper).expandByScalar(0.035)
      if (!cameraBox.intersectsBox(gripperBox)) return
      // 目标点进入另一条机械臂的包络时，回滚整组关节而不是让 DLS 反复换解抽搐。
      restoreJointAngles(robot, snapshot)
      robot.updateMatrixWorld(true)
      end.getWorldPosition(targetPos.current)
      end.getWorldQuaternion(targetQuat.current)
    }
    const manualActive = inspectionRegistry.paused && inspectionRegistry.manualArm === 'camera'

    if (manualActive) {
      mode.current = 'manual'
      const input = readInput()
      if (input.resetEdge) {
        setHome(robot)
        robot.updateMatrixWorld(true)
        end.getWorldPosition(targetPos.current)
        end.getWorldQuaternion(targetQuat.current)
      } else {
        targetPos.current.x += input.move.x * MANUAL_SPEED * delta
        targetPos.current.y += input.move.y * MANUAL_SPEED * delta
        targetPos.current.z += input.move.z * MANUAL_SPEED * delta
        if (homePose.current) {
          targetPos.current.x = clamp(targetPos.current.x, homePose.current.x - WORKSPACE.halfXZ, homePose.current.x + WORKSPACE.halfXZ)
          targetPos.current.z = clamp(targetPos.current.z, homePose.current.z - WORKSPACE.halfXZ, homePose.current.z + WORKSPACE.halfXZ)
        }
        targetPos.current.y = clamp(targetPos.current.y, WORKSPACE.yMin, WORKSPACE.yMax)
        const euler = new THREE.Euler(
          input.rot.pitch * 0.85 * delta,
          input.rot.yaw * 0.85 * delta,
          input.rot.roll * 0.85 * delta,
          'XYZ',
        )
        targetQuat.current.premultiply(new THREE.Quaternion().setFromEuler(euler)).normalize()
        solveCameraPosition(3)
      }
    } else if (inspectionRegistry.paused) {
      // 暂停但尚未选择接管对象：两条机械臂保持当前姿态，不推进自动流程。
      mode.current = 'standby'
    } else if (phase === 'inspecting' && verdict === null) {
      // 环绕扫描：末端贴近货物并抬高到夹爪上方，完整转一圈时不穿过夹持连杆。
      if (mode.current !== 'orbit') {
        mode.current = 'orbit'
        orbitTime.current = 0
        orbitBlend.current = 0
        orbitCenterLocal.current.copy(centerLocal)
        const entryWorld = new THREE.Vector3()
        end.getWorldPosition(entryWorld)
        orbitEntryLocal.current.copy(stationRef.current.worldToLocal(entryWorld))
        detectFired.current = false
      }
      orbitTime.current += delta
      orbitBlend.current = Math.min(1, orbitBlend.current + delta / ORBIT_BLEND_SECONDS)
      orbitCenterLocal.current.lerp(centerLocal, Math.min(1, delta * 4))
      const alpha = orbitTime.current * ORBIT_SPEED - Math.PI / 2
      const orbitPos = new THREE.Vector3(
        orbitCenterLocal.current.x + ORBIT_RADIUS * Math.cos(alpha),
        orbitCenterLocal.current.y + ORBIT_HEIGHT,
        orbitCenterLocal.current.z + ORBIT_RADIUS * Math.sin(alpha),
      )
      const blendedLocal = orbitEntryLocal.current.clone().lerp(
        orbitPos,
        THREE.MathUtils.smootherstep(orbitBlend.current, 0, 1),
      )
      targetPos.current.copy(stationRef.current.localToWorld(blendedLocal))
      solveCameraPosition(4)

      // 实时检测：环绕开始后相机到位即自动识别一次（跑全部检测项）
      if (!detectFired.current && orbitTime.current > DETECT_DELAY) {
        detectFired.current = true
        void runInspection()
      }
    } else if (verdict !== null) {
      // 出结果 → 摄像头臂归位
      mode.current = 'returning'
      if (homePose.current) {
        const homeV = new THREE.Vector3(homePose.current.x, homePose.current.y, homePose.current.z)
        targetPos.current.lerp(homeV, Math.min(1, delta * 2.5))
        targetQuat.current.copy(homePose.current.q)
        solveCameraPosition(4)
        if (targetPos.current.distanceTo(homeV) < 0.04) {
          // 返回时最后直接写回 HOME 关节，避免仅靠 IK 逼近造成复位漂移。
          setHome(robot)
          robot.updateMatrixWorld(true)
          end.getWorldPosition(targetPos.current)
          end.getWorldQuaternion(targetQuat.current)
          mode.current = 'standby'
        }
      }
    } else {
      // 空闲：手动控制（无输入则停在原位）
      mode.current = 'standby'
      const input = readInput()
      const hasInput =
        input.move.x !== 0 || input.move.y !== 0 || input.move.z !== 0 ||
        input.rot.pitch !== 0 || input.rot.yaw !== 0 || input.rot.roll !== 0
      if (input.resetEdge && homePose.current) {
        setHome(robot)
        robot.updateMatrixWorld(true)
        end.getWorldPosition(targetPos.current)
        end.getWorldQuaternion(targetQuat.current)
        mode.current = 'standby'
      } else if (hasInput) {
        targetPos.current.x += input.move.x * MANUAL_SPEED * delta
        targetPos.current.y += input.move.y * MANUAL_SPEED * delta
        targetPos.current.z += input.move.z * MANUAL_SPEED * delta
        if (homePose.current) {
          targetPos.current.x = clamp(targetPos.current.x, homePose.current.x - WORKSPACE.halfXZ, homePose.current.x + WORKSPACE.halfXZ)
          targetPos.current.z = clamp(targetPos.current.z, homePose.current.z - WORKSPACE.halfXZ, homePose.current.z + WORKSPACE.halfXZ)
        }
        targetPos.current.y = clamp(targetPos.current.y, WORKSPACE.yMin, WORKSPACE.yMax)
        const euler = new THREE.Euler(
          input.rot.pitch * 0.85 * delta,
          input.rot.yaw * 0.85 * delta,
          input.rot.roll * 0.85 * delta,
          'XYZ',
        )
        targetQuat.current.premultiply(new THREE.Quaternion().setFromEuler(euler)).normalize()
        ik.solve(targetPos.current, targetQuat.current, 3)
      }
    }

    // 云台：实体镜头跟随末端并朝向货物。
    const cam = cameraRef.current
    if (cam && stationRef.current) {
      const targetLocal = mode.current === 'orbit' ? orbitCenterLocal.current : centerLocal
      const targetWorld = stationRef.current.localToWorld(targetLocal.clone())
      const targetBlend = Math.min(1, delta * 8)
      if (!cameraPoseReady.current) cameraTargetWorld.current.copy(targetWorld)
      else cameraTargetWorld.current.lerp(targetWorld, targetBlend)
      housingRef.current?.lookAt(cameraTargetWorld.current)
      housingRef.current?.updateMatrixWorld(true)

      // 虚拟相机跟随实体镜头的光心，而不是法兰中心；这样机械臂转动时画面不会跳位。
      const lensWorld = housingRef.current
        ? housingRef.current.localToWorld(new THREE.Vector3(0, 0, -0.06))
        : end.getWorldPosition(new THREE.Vector3())
      const lensLocal = stationRef.current.worldToLocal(lensWorld)
      if (!cameraPoseReady.current) cam.position.copy(lensLocal)
      else cam.position.lerp(lensLocal, Math.min(1, delta * 10))
      cam.lookAt(cameraTargetWorld.current)
      cam.updateMatrixWorld(true)
      cameraPoseReady.current = true
    }
  })

  return (
    <group ref={stationRef} position={stationPos.toArray()}>
      <group ref={armRef} position={INSPECTION_STATION.armLocal.toArray()}>
        <mesh position={[0, 0.05, 0]} castShadow>
          <cylinderGeometry args={[0.22, 0.26, 0.1, 24]} />
          <meshStandardMaterial color="#4b5559" roughness={0.5} metalness={0.35} />
        </mesh>
        {robot && <primitive object={robot} />}
      </group>
    </group>
  )
}
