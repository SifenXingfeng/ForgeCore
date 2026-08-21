import * as THREE from 'three'
import { useThree } from '@react-three/fiber'
import { useRef, useEffect } from 'react'
import { useForgeMindStore } from '../store/forgeMind'
import type { FactoryFloorId, GridPos, Rotation } from '../game/types'
import { dirToRotation } from '../game/dir'
import { canPlace, snapCargoStoragePlacement, snapConveyorCellToObjectPort } from '../game/grid'
import { appendGridTrace } from '../game/conveyorTrace'
import { getFloorElevation } from './FactoryFloorSystem'
import { isInclineConveyorType, objectsTouchingFloor, snapConveyorCellToIncline, snapInclinePlacement } from '../game/inclineConveyor'

/**
 * 网格建造的指针交互层（Day 2）：
 * - 有建造工具时：射线打到地面 → 更新 ghost 位置，左键放置；
 * - 按住左键直接拖绘传送带，轨迹随鼠标自动补格、转弯和回退；
 * - 建造模式下右键取消当前放置工具。
 * - 无工具时：左键点地面清除选中。
 *
 * 键盘（挂在 window）：R 旋转 ghost，Escape 退出建造工具。
 */
export function BuildPlacer({ enabled = true, floorId = 1 }: { enabled?: boolean; floorId?: FactoryFloorId }) {
  const { camera, gl } = useThree()
  const raycaster = useRef(new THREE.Raycaster())
  const plane = useRef(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0))

  const buildType = useForgeMindStore((s) => s.buildType)
  const updateGhost = useForgeMindStore((s) => s.updateGhost)
  const setGhostPath = useForgeMindStore((s) => s.setGhostPath)
  const setGhostPathValid = useForgeMindStore((s) => s.setGhostPathValid)
  const objects = useForgeMindStore((s) => s.objects)
  const rotateGhost = useForgeMindStore((s) => s.rotateGhost)
  const placeAt = useForgeMindStore((s) => s.placeAt)
  const select = useForgeMindStore((s) => s.select)
  const setBuildType = useForgeMindStore((s) => s.setBuildType)

  const isPlacing = enabled && buildType !== null
  const drag = useRef<{ trace: GridPos[]; current: GridPos; pointerId: number } | null>(null)

  useEffect(() => {
    plane.current.constant = -getFloorElevation(floorId)
  }, [floorId])

  // 指针 → 网格坐标
  const pointerToGrid = (e: { clientX: number; clientY: number }): GridPos | null => {
    const rect = gl.domElement.getBoundingClientRect()
    const ndc = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    )
    raycaster.current.setFromCamera(ndc, camera)
    const hit = new THREE.Vector3()
    const ok = raycaster.current.ray.intersectPlane(plane.current, hit)
    if (!ok) return null
    return { x: Math.floor(hit.x), z: Math.floor(hit.z) }
  }

  const snapBuildPosition = (pos: GridPos): GridPos => {
    if (buildType === 'conveyor') return snapConveyorCellToObjectPort(snapConveyorCellToIncline(pos, floorId, objects), floorId, objects)
    if (buildType && isInclineConveyorType(buildType)) {
      const rotation = useForgeMindStore.getState().ghost.rotation
      return snapInclinePlacement(pos, buildType, rotation, floorId, objects).lowPos
    }
    if (buildType === 'source' || buildType === 'oreMiner' || buildType === 'storage') {
      return snapCargoStoragePlacement(pos, buildType, useForgeMindStore.getState().ghost.rotation, floorId, objects)
    }
    return pos
  }

  const pathRotations = (path: GridPos[]): Rotation[] => path.map((cell, index) => {
    const forward = index < path.length - 1
    const neighbor = forward ? path[index + 1] : path[index - 1]
    return neighbor
      ? dirToRotation({
          dx: forward ? neighbor.x - cell.x : cell.x - neighbor.x,
          dz: forward ? neighbor.z - cell.z : cell.z - neighbor.z,
        })
      : useForgeMindStore.getState().ghost.rotation
  })

  const validatePath = (path: GridPos[]): boolean[] => {
    const staged = objectsTouchingFloor(objects, floorId)
    return pathRotations(path).map((rotation, index) => {
      const pos = path[index]
      const valid = canPlace(pos, 'conveyor', rotation, staged)
      if (valid) staged.push({ id: `ghost-${index}`, type: 'conveyor', pos, rotation, floorId })
      return valid
    })
  }

  const updatePathPreview = (path: GridPos[]) => {
    setGhostPath(path)
    setGhostPathValid(validatePath(path))
  }

  useEffect(() => {
    const el = gl.domElement

    const onMove = (e: PointerEvent) => {
      if (!isPlacing) return
      const rawPos = pointerToGrid(e)
      const pos = rawPos ? snapBuildPosition(rawPos) : null
      updateGhost(pos, floorId)
      if (pos && drag.current) {
        drag.current.current = pos
        drag.current.trace = appendGridTrace(drag.current.trace, pos)
        updatePathPreview(drag.current.trace)
      }
    }
    const onDown = (e: PointerEvent) => {
      if (e.button !== 0) return
      if (!isPlacing && e.shiftKey) return
      if (isPlacing) {
        const rawPos = pointerToGrid(e)
        const pos = rawPos ? snapBuildPosition(rawPos) : null
        if (!pos) return
        if (buildType === 'conveyor') {
          e.preventDefault()
          e.stopPropagation()
          drag.current = { trace: [pos], current: pos, pointerId: e.pointerId }
          el.setPointerCapture?.(e.pointerId)
          updateGhost(pos, floorId)
          updatePathPreview([pos])
        } else {
          const rotation = useForgeMindStore.getState().ghost.rotation
          updateGhost(pos, floorId)
          placeAt(pos, rotation, floorId)
        }
      } else {
        select(null)
      }
    }
    const onContextMenu = (e: MouseEvent) => {
      if (!isPlacing) return
      e.preventDefault()
      e.stopPropagation()
      const activeDrag = drag.current
      if (activeDrag && el.hasPointerCapture?.(activeDrag.pointerId)) {
        el.releasePointerCapture(activeDrag.pointerId)
      }
      drag.current = null
      setGhostPath([])
      setGhostPathValid([])
      setBuildType(null)
    }
    const onUp = (e: PointerEvent) => {
      if (e.button !== 0 || !drag.current || buildType !== 'conveyor') return
      const path = appendGridTrace(drag.current.trace, drag.current.current)
      const rotations = pathRotations(path)
      const valid = validatePath(path)
      if (valid.every(Boolean)) {
        path.forEach((cell, index) => placeAt(cell, rotations[index], floorId))
      }
      drag.current = null
      setGhostPath([])
      setGhostPathValid([])
      if (el.hasPointerCapture?.(e.pointerId)) el.releasePointerCapture(e.pointerId)
    }

    const cancelStroke = (e: PointerEvent) => {
      if (!drag.current || e.pointerId !== drag.current.pointerId) return
      drag.current = null
      setGhostPath([])
      setGhostPathValid([])
    }

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'r' || e.key === 'R') {
        if (isPlacing) rotateGhost()
      } else if (e.key === 'Escape') {
        const activeDrag = drag.current
        if (activeDrag && el.hasPointerCapture?.(activeDrag.pointerId)) {
          el.releasePointerCapture(activeDrag.pointerId)
        }
        drag.current = null
        setBuildType(null)
      }
    }

    el.addEventListener('pointermove', onMove)
    el.addEventListener('pointerdown', onDown)
    el.addEventListener('contextmenu', onContextMenu)
    el.addEventListener('pointerup', onUp)
    el.addEventListener('pointercancel', cancelStroke)
    el.addEventListener('lostpointercapture', cancelStroke)
    window.addEventListener('keydown', onKey)
    return () => {
      el.removeEventListener('pointermove', onMove)
      el.removeEventListener('pointerdown', onDown)
      el.removeEventListener('contextmenu', onContextMenu)
      el.removeEventListener('pointerup', onUp)
      el.removeEventListener('pointercancel', cancelStroke)
      el.removeEventListener('lostpointercapture', cancelStroke)
      window.removeEventListener('keydown', onKey)
    }
  }, [floorId, isPlacing, buildType, updateGhost, setGhostPath, setGhostPathValid, placeAt, select, rotateGhost, setBuildType, camera, gl, objects])

  // 建造模式时禁用 OrbitControls 的旋转（否则拖动会同时旋转相机与放置）
  useEffect(() => {
    const controls = (gl.domElement as HTMLCanvasElement)
    if (isPlacing) {
      // OrbitControls 内部在 mousedown 时接管；这里通过 CSS cursor 提示即可
      controls.style.cursor = 'crosshair'
    } else {
      controls.style.cursor = enabled ? 'default' : 'grab'
    }
  }, [enabled, isPlacing, gl])

  return null
}
