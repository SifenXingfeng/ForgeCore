import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { GLTFLoader } from 'three-stdlib'
import { resolveItemAppearanceParameters, type Item, type ModelParameters } from '../game/item'
import { getParametricItemModel } from './ParametricItemModel'

interface Props {
  item?: Pick<Item, 'color' | 'modelId' | 'modelPath' | 'modelParameters'>
  modelPath?: string
  modelId?: string
  modelParameters?: ModelParameters
  color?: string
}

const thumbnailCache = new Map<string, string>()

function stableParameters(parameters: ModelParameters): string {
  return JSON.stringify(Object.entries(parameters).sort(([left], [right]) => left.localeCompare(right)))
}

/** Capture the same parametric appearance used by scene cargo, then release the temporary WebGL context. */
export function ItemModelThumbnail(props: Props) {
  const modelPath = props.item?.modelPath ?? props.modelPath
  const modelId = props.item?.modelId ?? props.modelId
  const parameters = props.item
    ? resolveItemAppearanceParameters(props.item)
    : { ...(props.modelParameters ?? {}), ...(props.color && !Object.prototype.hasOwnProperty.call(props.modelParameters ?? {}, 'color') ? { color: props.color } : {}) }
  const appearanceKey = modelId ? `${modelId}:${stableParameters(parameters)}` : ''
  const mountRef = useRef<HTMLSpanElement>(null)
  const [generatedPreview, setGeneratedPreview] = useState<string | null>(() => appearanceKey ? thumbnailCache.get(appearanceKey) ?? null : null)
  const [previewFailed, setPreviewFailed] = useState(false)
  const [hasError, setHasError] = useState(!modelPath)

  useEffect(() => {
    setPreviewFailed(false)
    setHasError(!modelPath)
  }, [appearanceKey, modelPath])

  useEffect(() => {
    if (!modelId) {
      setGeneratedPreview(null)
      return
    }
    const cachedPreview = thumbnailCache.get(appearanceKey)
    if (cachedPreview) {
      setGeneratedPreview(cachedPreview)
      return
    }
    const model = getParametricItemModel(modelId, parameters)
    if (!model) {
      setGeneratedPreview(null)
      return
    }

    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true })
    renderer.setPixelRatio(1)
    renderer.setSize(128, 128, false)
    renderer.setClearColor(0x000000, 0)
    renderer.outputColorSpace = THREE.SRGBColorSpace
    const scene = new THREE.Scene()
    scene.add(new THREE.HemisphereLight(0xf4fbf8, 0x55706a, 2.4))
    const keyLight = new THREE.DirectionalLight(0xffffff, 2.7)
    keyLight.position.set(3, 5, 4)
    scene.add(keyLight)
    const root = new THREE.Group()
    root.rotation.set(0.08, -0.55, 0)
    model.primitives.forEach((primitive) => root.add(new THREE.Mesh(primitive.geometry, primitive.material)))
    const size = model.bounds.size
    const fitScale = 1.6 / Math.max(size[0], size[1], size[2], 0.0001)
    root.scale.setScalar(fitScale)
    root.position.set(
      -((model.bounds.min[0] + model.bounds.max[0]) / 2) * fitScale,
      -((model.bounds.min[1] + model.bounds.max[1]) / 2) * fitScale,
      -((model.bounds.min[2] + model.bounds.max[2]) / 2) * fitScale,
    )
    scene.add(root)
    const camera = new THREE.OrthographicCamera(-1.15, 1.15, 1.15, -1.15, 0.01, 20)
    camera.position.set(2.8, 2.25, 2.8)
    camera.lookAt(0, 0, 0)
    renderer.render(scene, camera)
    const preview = renderer.domElement.toDataURL('image/png')
    thumbnailCache.set(appearanceKey, preview)
    setGeneratedPreview(preview)
    renderer.dispose()
    renderer.forceContextLoss()
  }, [appearanceKey, modelId])

  useEffect(() => {
    const mount = mountRef.current
    if (!mount || !modelPath || !previewFailed) return

    let disposed = false
    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true })
    renderer.setPixelRatio(1)
    renderer.setSize(32, 32, false)
    renderer.setClearColor(0x000000, 0)
    renderer.outputColorSpace = THREE.SRGBColorSpace
    mount.replaceChildren(renderer.domElement)
    const scene = new THREE.Scene()
    scene.add(new THREE.HemisphereLight(0xf4fbf8, 0x55706a, 2.2))
    const keyLight = new THREE.DirectionalLight(0xffffff, 2.5)
    keyLight.position.set(2, 4, 3)
    scene.add(keyLight)
    const camera = new THREE.PerspectiveCamera(28, 1, 0.01, 100)
    const loader = new GLTFLoader()
    loader.load(
      `/models/forgecore/items/${modelPath}`,
      (gltf) => {
        if (disposed) return
        const model = gltf.scene
        const box = new THREE.Box3().setFromObject(model)
        const size = box.getSize(new THREE.Vector3())
        const center = box.getCenter(new THREE.Vector3())
        model.position.sub(center)
        model.scale.setScalar(1.5 / Math.max(size.x, size.y, size.z, 0.001))
        model.rotation.y = -0.55
        scene.add(model)
        camera.position.set(2.15, 1.65, 2.15)
        camera.lookAt(0, 0, 0)
        renderer.render(scene, camera)
        setHasError(false)
      },
      undefined,
      () => { if (!disposed) setHasError(true) },
    )

    return () => {
      disposed = true
      renderer.dispose()
      mount.replaceChildren()
    }
  }, [modelPath, previewFailed])

  return (
    <span className="fm-item-model-thumbnail" aria-hidden="true">
      {generatedPreview
        ? <img className="fm-item-model-preview" src={generatedPreview} alt="" />
        : !modelPath
          ? <span className="fm-item-model-fallback">◇</span>
          : !previewFailed
            ? <img className="fm-item-model-preview" src={`/models/forgecore/items/previews/${modelPath.replace(/\.glb$/iu, '.png')}`} alt="" onError={() => setPreviewFailed(true)} />
            : <span ref={mountRef} className="fm-item-model-canvas" />}
      {previewFailed && hasError && <span className="fm-item-model-fallback">◇</span>}
    </span>
  )
}
