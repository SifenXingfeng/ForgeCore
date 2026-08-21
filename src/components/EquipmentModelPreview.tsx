import { OrbitControls } from '@react-three/drei'
import { Canvas } from '@react-three/fiber'
import { Component, Suspense, type ErrorInfo, type ReactNode } from 'react'
import { ImportedFactoryModel } from '../scene/ImportedFactoryModel'

class PreviewBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  componentDidCatch(error: Error, info: ErrorInfo) { console.warn('Equipment preview fallback', error, info.componentStack) }
  render() { return this.state.failed ? this.props.fallback : this.props.children }
}

function PreviewFallback() { return <div className="fm-equipment-preview-fallback"><b>◇</b><span>模型预览暂不可用</span></div> }

export function EquipmentModelPreview({ path, width, depth, height, compact = false, inputCount = 0, outputCount = 0, label }: { path?: string; width: number; depth: number; height: number; compact?: boolean; inputCount?: number; outputCount?: number; label: string }) {
  const fallback = <PreviewFallback />
  return <div className={`fm-equipment-preview${compact ? ' is-compact' : ''}`} aria-label={`${label} 三维模型预览`}>
    {path ? <PreviewBoundary fallback={fallback}><Canvas orthographic camera={{ position: [5, 4, 5], zoom: compact ? 62 : 70, near: .1, far: 100 }} dpr={[1, 1.35]} shadows>
      <color attach="background" args={['#e7eeea']} /><ambientLight intensity={1.55} /><directionalLight position={[5, 8, 5]} intensity={2.1} color="#fff6d9" castShadow /><directionalLight position={[-4, 3, -3]} intensity={.65} color="#c6d6d1" />
      <Suspense fallback={null}><group rotation={[0, -.55, 0]}><ImportedFactoryModel path={path} targetWidth={Math.max(1.2, Math.min(width, depth) * .78)} targetHeight={Math.max(.5, height)} /></group></Suspense>
      <OrbitControls makeDefault enablePan={false} enableZoom={!compact} autoRotate autoRotateSpeed={compact ? .55 : .75} minZoom={42} maxZoom={110} />
    </Canvas></PreviewBoundary> : fallback}
    {!compact && <><div className="fm-equipment-preview-floor" style={{ aspectRatio: `${Math.max(1, width)} / ${Math.max(1, depth)}` }}><span>{width} × {depth} 格</span></div><div className="fm-equipment-port-preview is-input" aria-label={`${inputCount} 个入货口`}>{Array.from({ length: inputCount }, (_, index) => <i key={index} />)}</div><div className="fm-equipment-port-preview is-output" aria-label={`${outputCount} 个出货口`}>{Array.from({ length: outputCount }, (_, index) => <i key={index} />)}</div><small>蓝色入货口 · 黄色出货口 · 拖动旋转</small></>}
  </div>
}
