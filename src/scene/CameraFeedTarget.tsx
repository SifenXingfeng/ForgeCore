import { useEffect, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { inspectionRegistry } from './inspectionRegistry'

const FEED_WIDTH = 512
const FEED_HEIGHT = 384
/** 离屏渲染 + 画面帧率上限（性能引擎：避免每帧整场景二次渲染拖垮主循环） */
const OFFSCREEN_FPS = 30
const OFFSCREEN_INTERVAL = 1000 / OFFSCREEN_FPS

/**
 * 质检相机离屏渲染（性能优化版）：
 * 以 OFFSCREEN_FPS 限频把主场景从「摄像头臂末端相机」渲染进 WebGLRenderTarget，
 * 随即读像素写入 inspectionRegistry 供右面板轮询。不再每帧整场景二次渲染。
 */
export function CameraFeedTarget() {
  const { gl, scene } = useThree()
  const rtRef = useRef<THREE.WebGLRenderTarget | null>(null)
  const bufferRef = useRef<Uint8Array | null>(null)
  const renderCam = useRef<THREE.PerspectiveCamera | null>(null)
  const lastRenderAt = useRef(0)
  const frameVersion = useRef(0)

  useEffect(() => {
    const rt = new THREE.WebGLRenderTarget(FEED_WIDTH, FEED_HEIGHT, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
    })
    rtRef.current = rt
    bufferRef.current = new Uint8Array(FEED_WIDTH * FEED_HEIGHT * 4)
    renderCam.current = new THREE.PerspectiveCamera(55, FEED_WIDTH / FEED_HEIGHT, 0.03, 60)
    // 调试：暴露场景图到 window
    if (import.meta.env.DEV) {
      ;(window as unknown as { __scene?: unknown }).__scene = scene
    }
    return () => rt.dispose()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useFrame(() => {
    const cam = inspectionRegistry.camera
    const rt = rtRef.current
    const renderer = gl as THREE.WebGLRenderer
    const renderCamNow = renderCam.current
    if (!cam || !rt || !renderCamNow) return

    const now = performance.now()
    if (now - lastRenderAt.current < OFFSCREEN_INTERVAL) return
    lastRenderAt.current = now

    // renderCam 是独立相机（无父节点），必须用世界位姿
    cam.getWorldPosition(renderCamNow.position)
    cam.getWorldQuaternion(renderCamNow.quaternion)
    renderCamNow.fov = cam.fov
    renderCamNow.aspect = FEED_WIDTH / FEED_HEIGHT
    renderCamNow.updateProjectionMatrix()
    renderCamNow.updateMatrixWorld(true)

    // 视觉检测不拍摄摄像头臂自身，避免连杆遮挡货物；主视图仍正常显示完整机械臂。
    const occluder = inspectionRegistry.cameraOccluder
    const occluderVisible = occluder?.visible
    if (occluder) occluder.visible = false

    // 检测画面关阴影 + 关色调映射：避免机械臂阴影/ACES 压暗被视觉检测误判
    const hadShadows = renderer.shadowMap.enabled
    const hadTone = renderer.toneMapping
    renderer.shadowMap.enabled = false
    renderer.toneMapping = THREE.NoToneMapping
    renderer.setRenderTarget(rt)
    renderer.render(scene, renderCamNow)
    renderer.setRenderTarget(null)
    renderer.shadowMap.enabled = hadShadows
    renderer.toneMapping = hadTone
    if (occluder && occluderVisible !== undefined) occluder.visible = occluderVisible

    const buffer = bufferRef.current
    if (buffer) {
      renderer.readRenderTargetPixels(rt, 0, 0, FEED_WIDTH, FEED_HEIGHT, buffer)
      inspectionRegistry.frame = {
        pixels: buffer,
        width: FEED_WIDTH,
        height: FEED_HEIGHT,
        version: ++frameVersion.current,
      }
    }
  })

  return null
}
