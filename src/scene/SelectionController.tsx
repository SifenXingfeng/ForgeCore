import { useEffect, useRef } from 'react'
import { useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { useForgeMindStore } from '../store/forgeMind'
import { useAuthStore } from '../store/auth'
import { getObjectDef, type FactoryObject } from '../game/types'
import { occupiedCells } from '../game/grid'
import { isInclineConveyorType } from '../game/inclineConveyor'
import { normalizeScreenRect, screenRectsIntersect, type ScreenRect } from '../game/selection'
import { buildingVisualScaleForType, CONVEYOR_VISUAL_SURFACE_Y_M } from './industrialVisualScale'
import { getFloorElevation } from './FactoryFloorSystem'

interface DragState {
  pointerId: number
  startX: number
  startY: number
  currentX: number
  currentY: number
  overlay: HTMLDivElement
  previousCursor: string
  controls?: { enabled: boolean }
  controlsWereEnabled?: boolean
}

export function SelectionController({ enabled, selectableObjects }: { enabled: boolean; selectableObjects: FactoryObject[] }) {
  const { camera, gl, controls } = useThree()
  const phase = useAuthStore((state) => state.phase)
  const buildType = useForgeMindStore((state) => state.buildType)
  const selectMany = useForgeMindStore((state) => state.selectMany)
  const drag = useRef<DragState | null>(null)
  const interactionEnabled = enabled && phase === 'factory' && buildType === null
  const latest = useRef({ camera, controls, interactionEnabled, selectableObjects, selectMany })
  latest.current = { camera, controls, interactionEnabled, selectableObjects, selectMany }

  useEffect(() => {
    const canvas = gl.domElement
    const previousTabIndex = canvas.getAttribute('tabindex')
    canvas.tabIndex = -1
    canvas.dataset.selectionController = 'ready'

    const finishDrag = (applySelection: boolean) => {
      const active = drag.current
      if (!active) return
      if (applySelection) {
        const current = latest.current
        const marquee = normalizeScreenRect(active.startX, active.startY, active.currentX, active.currentY)
        const canvasRect = canvas.getBoundingClientRect()
        const ids = current.selectableObjects
          .filter((object) => {
            const bounds = projectObjectScreenRect(object, current.camera, canvasRect)
            return bounds ? screenRectsIntersect(marquee, bounds) : false
          })
          .map((object) => object.id)
        current.selectMany(ids)
      }
      active.overlay.remove()
      canvas.style.cursor = active.previousCursor
      if (active.controls && active.controlsWereEnabled !== undefined) active.controls.enabled = active.controlsWereEnabled
      drag.current = null
    }

    const onPointerDown = (event: PointerEvent) => {
      const current = latest.current
      if (!current.interactionEnabled || event.target !== canvas || event.button !== 0) return
      canvas.focus({ preventScroll: true })
      if (!event.shiftKey) return
      event.preventDefault()
      event.stopPropagation()
      const overlay = document.createElement('div')
      overlay.className = 'fm-selection-marquee'
      overlay.dataset.testid = 'selection-marquee'
      document.body.appendChild(overlay)
      const orbitControls = current.controls && 'enabled' in current.controls
        ? current.controls as unknown as { enabled: boolean }
        : undefined
      drag.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        currentX: event.clientX,
        currentY: event.clientY,
        overlay,
        previousCursor: canvas.style.cursor,
        controls: orbitControls,
        controlsWereEnabled: orbitControls?.enabled,
      }
      if (orbitControls) orbitControls.enabled = false
      canvas.style.cursor = 'crosshair'
      updateOverlay(overlay, normalizeScreenRect(event.clientX, event.clientY, event.clientX, event.clientY))
    }

    const onPointerMove = (event: PointerEvent) => {
      const active = drag.current
      if (!active || event.pointerId !== active.pointerId) return
      event.preventDefault()
      event.stopPropagation()
      active.currentX = event.clientX
      active.currentY = event.clientY
      updateOverlay(active.overlay, normalizeScreenRect(active.startX, active.startY, active.currentX, active.currentY))
    }

    const onPointerUp = (event: PointerEvent) => {
      if (!drag.current || event.pointerId !== drag.current.pointerId) return
      event.preventDefault()
      event.stopPropagation()
      drag.current.currentX = event.clientX
      drag.current.currentY = event.clientY
      finishDrag(true)
    }

    const onPointerCancel = (event: PointerEvent) => {
      if (!drag.current || event.pointerId !== drag.current.pointerId) return
      finishDrag(false)
    }

    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('pointermove', onPointerMove, true)
    document.addEventListener('pointerup', onPointerUp, true)
    document.addEventListener('pointercancel', onPointerCancel, true)
    return () => {
      finishDrag(false)
      delete canvas.dataset.selectionController
      if (previousTabIndex === null) canvas.removeAttribute('tabindex')
      else canvas.setAttribute('tabindex', previousTabIndex)
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('pointermove', onPointerMove, true)
      document.removeEventListener('pointerup', onPointerUp, true)
      document.removeEventListener('pointercancel', onPointerCancel, true)
    }
  }, [gl])

  return null
}

function updateOverlay(element: HTMLDivElement, rect: ScreenRect) {
  element.style.left = `${rect.left}px`
  element.style.top = `${rect.top}px`
  element.style.width = `${rect.right - rect.left}px`
  element.style.height = `${rect.bottom - rect.top}px`
}

function projectObjectScreenRect(object: FactoryObject, camera: THREE.Camera, canvas: DOMRect): ScreenRect | null {
  const cells = occupiedCells(object)
  if (cells.length === 0) return null
  const minX = Math.min(...cells.map((cell) => cell.x))
  const maxX = Math.max(...cells.map((cell) => cell.x)) + 1
  const minZ = Math.min(...cells.map((cell) => cell.z))
  const maxZ = Math.max(...cells.map((cell) => cell.z)) + 1
  const definition = getObjectDef(object.type, object.resourceId)
  const baseFloor = isInclineConveyorType(object.type) && object.incline ? object.incline.lowerFloorId : object.floorId ?? 1
  const minY = getFloorElevation(baseFloor)
  const maxY = isInclineConveyorType(object.type) && object.incline
    ? getFloorElevation(object.incline.upperFloorId) + CONVEYOR_VISUAL_SURFACE_Y_M
    : minY + Math.max(0.2, definition.height * buildingVisualScaleForType(object.type))
  const points = [minX, maxX].flatMap((x) => [minY, maxY].flatMap((y) => [minZ, maxZ].map((z) => new THREE.Vector3(x, y, z).project(camera))))
  const visible = points.filter((point) => point.z >= -1 && point.z <= 1)
  if (visible.length === 0) return null
  const xs = visible.map((point) => canvas.left + (point.x + 1) * canvas.width / 2)
  const ys = visible.map((point) => canvas.top + (1 - point.y) * canvas.height / 2)
  return {
    left: Math.min(...xs),
    top: Math.min(...ys),
    right: Math.max(...xs),
    bottom: Math.max(...ys),
  }
}
