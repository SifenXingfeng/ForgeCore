import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import * as THREE from 'three'
import { OrbitControls, GLTFLoader } from 'three-stdlib'
import { RoomEnvironment } from 'three-stdlib'
import type { FactoryObject, BuildType, ObjectDef } from '../game/types'
import { createProceduralEquipment, type ProceduralModel } from './proceduralEquipment'

interface Props {
  obj: FactoryObject
  def: ObjectDef
  onClose: () => void
}

/**
 * 每个设备类型对应的 GLB 模型路径。
 * 这些模型来自 realvirtual.io 工业数字孪生资源包和项目内置模型库。
 * 对于没有专属 GLB 的类型，使用 null 走精细程序化建模。
 */
const MODEL_PATH_MAP: Partial<Record<BuildType, string>> = {
  machine: '/models/industrial/cnc_machining_center.glb',
  smelter: '/models/industrial/cnc_machining_center.glb',
  press: '/models/industrial/hydraulic_press_detail.glb',
  washing: '/models/industrial/wash_deburr_detail.glb',
  storage: '/models/industrial/pallet_buffer_detail.glb',
  splitter: '/models/industrial/flow_node_detail.glb',
  merger: '/models/industrial/flow_node_detail.glb',
  conveyor: '/models/industrial/roller_conveyor_segment.glb',
  inclineUp: '/models/industrial/roller_conveyor_segment.glb',
  inclineDown: '/models/industrial/roller_conveyor_segment.glb',
  agv: '/models/forklift_agv.glb',
  inspection: '/models/industrial/sensor_pack.glb',
  assembler: '/models/robot_irb2400.glb',
  oreMiner: '/models/industrial/pallet_buffer_detail.glb',
  source: '/models/industrial/realvirtual_high_detail.glb',
}

/** 自动归一化 GLB 模型到目标尺寸，居中对齐地面 */
function normalizeGLTF(gltf: THREE.Group, targetSize = 2.2): THREE.Group {
  const scene = gltf.clone(true)
  scene.position.set(0, 0, 0)
  scene.rotation.set(0, 0, 0)
  const box = new THREE.Box3().setFromObject(scene)
  const size = box.getSize(new THREE.Vector3())
  const maxDim = Math.max(size.x, size.y, size.z, 0.0001)
  const scale = targetSize / maxDim
  scene.scale.setScalar(scale)
  scene.updateMatrixWorld(true)
  const normalizedBox = new THREE.Box3().setFromObject(scene)
  const center = normalizedBox.getCenter(new THREE.Vector3())
  scene.position.set(-center.x, -normalizedBox.min.y, -center.z)
  scene.updateMatrixWorld(true)
  scene.traverse((node) => {
    if (node instanceof THREE.Mesh) {
      node.castShadow = true
      node.receiveShadow = true
    }
  })
  return scene
}

function createGridHelper(): THREE.Group {
  const group = new THREE.Group()
  const grid = new THREE.GridHelper(10, 20, 0x5a6a66, 0x3a4a46)
  grid.position.y = 0.001
  group.add(grid)
  return group
}

/** 创建带渐变的圆形地面阴影 */
function createGround(): THREE.Mesh {
  const geom = new THREE.CircleGeometry(3.5, 64)
  const mat = new THREE.MeshStandardMaterial({
    color: 0x161e1c,
    roughness: 0.85,
    metalness: 0.15,
    transparent: true,
    opacity: 0.92,
  })
  const mesh = new THREE.Mesh(geom, mat)
  mesh.rotation.x = -Math.PI / 2
  mesh.position.y = 0
  mesh.receiveShadow = true
  return mesh
}

export function Model3DViewer({ obj, def, onClose }: Props) {
  const [pos, setPos] = useState({ x: 0, y: 0 })
  const [loading, setLoading] = useState(true)
  const [useProcedural, setUseProcedural] = useState(false)
  const [animating, setAnimating] = useState(false)
  const [hasAnimation, setHasAnimation] = useState(false)
  const mountRef = useRef<HTMLDivElement>(null)
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null)
  const sceneRef = useRef<THREE.Scene | null>(null)
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null)
  const controlsRef = useRef<OrbitControls | null>(null)
  const frameIdRef = useRef<number>(0)
  const introTRef = useRef<number>(0)
  const animUpdateRef = useRef<ProceduralModel['update'] | null>(null)
  const animatingRef = useRef<boolean>(false)
  const animTimeRef = useRef<number>(0)
  const modelGroupRef = useRef<THREE.Group | null>(null)
  const addProceduralRef = useRef<() => void>(() => {})
  const dragRef = useRef<{ startX: number; startY: number; baseX: number; baseY: number } | null>(null)

  useEffect(() => { animatingRef.current = animating }, [animating])

  useEffect(() => {
    const width = 620
    const height = 500
    setPos({
      x: Math.max(16, Math.round((window.innerWidth - width) / 2)),
      y: Math.max(16, Math.round((window.innerHeight - height) / 2)),
    })
  }, [])

  useEffect(() => {
    if (!mountRef.current) return
    const container = mountRef.current
    const rect = container.getBoundingClientRect()
    if (rect.width < 2 || rect.height < 2) return

    // ---------- Renderer（精细化渲染管线） ----------
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.setSize(rect.width, rect.height)
    renderer.setClearColor(0x0f1917, 1)
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFSoftShadowMap
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 1.05
    renderer.outputColorSpace = THREE.SRGBColorSpace
    container.appendChild(renderer.domElement)
    rendererRef.current = renderer

    // ---------- Scene ----------
    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0x0f1917)
    sceneRef.current = scene

    // ---------- 环境光照（用于金属反射） ----------
    const pmrem = new THREE.PMREMGenerator(renderer)
    const envScene = RoomEnvironment()
    const envMap = pmrem.fromScene(envScene as unknown as THREE.Scene, 0.04).texture
    scene.environment = envMap

    // ---------- Camera（带入场动画初始位置） ----------
    const camera = new THREE.PerspectiveCamera(42, rect.width / rect.height, 0.1, 100)
    const finalPos = new THREE.Vector3(3.2, 2.6, 3.8)
    camera.position.copy(finalPos.clone().multiplyScalar(2.4))
    camera.lookAt(0, 1, 0)
    cameraRef.current = camera

    // ---------- Lights ----------
    const ambient = new THREE.AmbientLight(0xffffff, 0.35)
    scene.add(ambient)

    const keyLight = new THREE.DirectionalLight(0xffffff, 1.4)
    keyLight.position.set(5, 7, 4)
    keyLight.castShadow = true
    keyLight.shadow.mapSize.width = 2048
    keyLight.shadow.mapSize.height = 2048
    keyLight.shadow.camera.near = 0.5
    keyLight.shadow.camera.far = 30
    keyLight.shadow.camera.left = -4
    keyLight.shadow.camera.right = 4
    keyLight.shadow.camera.top = 4
    keyLight.shadow.camera.bottom = -4
    keyLight.shadow.bias = -0.0005
    keyLight.shadow.radius = 4
    scene.add(keyLight)

    const fillLight = new THREE.DirectionalLight(0x8fb4ff, 0.4)
    fillLight.position.set(-4, 5, -3)
    scene.add(fillLight)

    const rimLight = new THREE.DirectionalLight(def.accent, 0.55)
    rimLight.position.set(0, 3, -5)
    scene.add(rimLight)

    // ---------- Ground + Grid ----------
    scene.add(createGround())
    scene.add(createGridHelper())

    // ---------- Controls ----------
    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.dampingFactor = 0.08
    controls.minDistance = 1.8
    controls.maxDistance = 9
    controls.maxPolarAngle = Math.PI * 0.52
    controls.target.set(0, 1, 0)
    controls.update()
    controlsRef.current = controls

    // ---------- 加载模型 ----------
    // washing（清洗去毛刺单元）：优先使用程序化精细建模，带完整机械动画、工件渐变、线缆布线等
    // washing/inspection/machine/smelter 均使用精细化程序化模型（带完整机械动画）
    // 这些设备在 3D 观测中直接显示「▶ 拟运作」按钮，不显示切换按钮
    const PROCEDURAL_FIRST: BuildType[] = ['washing', 'inspection', 'machine', 'smelter']
    const preferProcedural = PROCEDURAL_FIRST.includes(obj.type)
    const modelPath = MODEL_PATH_MAP[obj.type]
    animUpdateRef.current = null
    setHasAnimation(false)

    const addProcedural = () => {
      if (modelGroupRef.current && sceneRef.current) {
        sceneRef.current.remove(modelGroupRef.current)
        modelGroupRef.current.traverse((n) => {
          if (n instanceof THREE.Mesh) {
            n.geometry?.dispose()
            const mat = n.material
            if (Array.isArray(mat)) mat.forEach((m) => m.dispose())
            else mat?.dispose()
          }
        })
      }

      const model = createProceduralEquipment(def)
      const mesh = model.group
      const box = new THREE.Box3().setFromObject(mesh)
      const size = box.getSize(new THREE.Vector3())
      const maxDim = Math.max(size.x, size.y, size.z, 0.0001)
      const scale = 2.2 / maxDim
      mesh.scale.setScalar(scale)
      mesh.updateMatrixWorld(true)
      const nb = new THREE.Box3().setFromObject(mesh)
      const center = nb.getCenter(new THREE.Vector3())
      mesh.position.set(-center.x, -nb.min.y, -center.z)
      scene.add(mesh)
      modelGroupRef.current = mesh
      animUpdateRef.current = model.update ?? null
      animTimeRef.current = 0
      setHasAnimation(!!model.update)
      setLoading(false)
      setUseProcedural(true)
    }
    addProceduralRef.current = addProcedural

    if (preferProcedural) {
      // 去毛刺机等：直接用程序化精细建模（优先）
      addProcedural()
    } else if (modelPath) {
      const loader = new GLTFLoader()
      loader.load(
        modelPath,
        (gltf) => {
          try {
            const mesh = normalizeGLTF(gltf.scene.clone(true), 2.2)
            scene.add(mesh)
            modelGroupRef.current = mesh
            animUpdateRef.current = null
            setHasAnimation(false)
            setLoading(false)
            setUseProcedural(false)
          } catch {
            addProcedural()
          }
        },
        undefined,
        () => addProcedural(),
      )
    } else {
      addProcedural()
    }

    // ---------- Animation Loop（含入场动画 + 工作动画） ----------
    introTRef.current = 0
    animTimeRef.current = 0
    let lastTime = performance.now()
    const animate = () => {
      frameIdRef.current = requestAnimationFrame(animate)
      const now = performance.now()
      const dt = Math.min(0.05, (now - lastTime) / 1000)
      lastTime = now

      // 入场动画
      if (introTRef.current < 1) {
        introTRef.current = Math.min(1, introTRef.current + 0.018)
        const t = 1 - Math.pow(1 - introTRef.current, 3)
        camera.position.lerpVectors(finalPos.clone().multiplyScalar(2.4), finalPos, t)
        camera.lookAt(0, 1, 0)
      }

      // 工作动画（仅在「拟运作」开启时）
      if (animatingRef.current && animUpdateRef.current) {
        animTimeRef.current += dt
        animUpdateRef.current(animTimeRef.current, dt)
      }

      controls.update()
      renderer.render(scene, camera)
    }
    animate()

    // ---------- Resize handler ----------
    const onResize = () => {
      if (!mountRef.current) return
      const r = mountRef.current.getBoundingClientRect()
      renderer.setSize(r.width, r.height)
      camera.aspect = r.width / r.height
      camera.updateProjectionMatrix()
    }
    const resizeObserver = new ResizeObserver(onResize)
    resizeObserver.observe(container)

    return () => {
      resizeObserver.disconnect()
      cancelAnimationFrame(frameIdRef.current)
      controls.dispose()
      pmrem.dispose()
      envMap.dispose()
      renderer.dispose()
      if (renderer.domElement.parentNode) {
        renderer.domElement.parentNode.removeChild(renderer.domElement)
      }
    }
  }, [obj.type, def])

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      if (!dragRef.current) return
      const nextX = dragRef.current.baseX + (e.clientX - dragRef.current.startX)
      const nextY = dragRef.current.baseY + (e.clientY - dragRef.current.startY)
      setPos({
        x: Math.max(0, Math.min(window.innerWidth - 620, nextX)),
        y: Math.max(0, Math.min(window.innerHeight - 40, nextY)),
      })
    }
    const onUp = () => { dragRef.current = null }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
  }, [])

  const startDrag = (e: React.PointerEvent) => {
    dragRef.current = { startX: e.clientX, startY: e.clientY, baseX: pos.x, baseY: pos.y }
  }

  const node = (
    <div className="fm-3dviewer-overlay" style={{ left: pos.x, top: pos.y, width: 620 }}>
      <div className="fm-3dviewer-inner">
        <div className="fm-3dviewer-head" onPointerDown={startDrag}>
          <div>
            <span className="fm-eyebrow">3D VIEW / {obj.id.slice(-6)}</span>
            <h4>{def.label} · 3D 观测</h4>
          </div>
          <button className="fm-3dviewer-close" onClick={onClose} aria-label="关闭">✕</button>
        </div>
        <div className="fm-3dviewer-body" style={{ position: 'relative', height: 440 }}>
          <div ref={mountRef} style={{ width: '100%', height: '100%' }} />
          {loading && (
            <div style={{
              position: 'absolute', top: '50%', left: '50%',
              transform: 'translate(-50%, -50%)',
              color: '#72d4d2', fontSize: 13, letterSpacing: '0.1em',
            }}>
              加载精细模型中...
            </div>
          )}
          <div className="fm-3dviewer-source-tag">
            {useProcedural ? '程序化精细建模 · PROCEDURAL HD' : '真实导入模型 · STEP → GLB'}
          </div>
          {!loading && (
            <div className="fm-3dviewer-actions">
              {hasAnimation ? (
                <button
                  className={`fm-3d-action-btn ${animating ? 'active' : ''}`}
                  onClick={() => setAnimating((v) => !v)}
                >
                  {animating ? '⏸ 停止运作' : '▶ 拟运作'}
                </button>
              ) : (
                // 存储类部件（storage / oreMiner）不显示「切换为动画模型」按钮
                !useProcedural && obj.type !== 'storage' && obj.type !== 'oreMiner' && (
                  <button
                    className="fm-3d-action-btn"
                    onClick={() => addProceduralRef.current()}
                  >
                    切换为动画模型
                  </button>
                )
              )}
              {animating && (
                <span className="fm-3d-status">运作中</span>
              )}
            </div>
          )}
          <div className="fm-3dviewer-hint">
            鼠标左键：旋转 &nbsp;|&nbsp; 滚轮：缩放 &nbsp;|&nbsp; 右键：平移
          </div>
        </div>
      </div>
    </div>
  )

  return createPortal(node, document.body)
}
