import { createRoot } from 'react-dom/client'
import { Canvas } from '@react-three/fiber'
import { Grid, OrbitControls } from '@react-three/drei'
import * as THREE from 'three'
import { InspectionCameraArm } from '../scene/InspectionCameraArm'
import { GripperArm } from '../scene/GripperArm'
import { CameraFeedTarget } from '../scene/CameraFeedTarget'
import { InspectionPanel } from '../components/InspectionPanel'
import { INSPECTION_STATION } from '../scene/inspectionRegistry'
import '../index.css'
import './inspection-demo.css'

/**
 * 视觉检测工作台 · 独立 Demo（不进入主前端）。
 * 访问：/inspection.html
 */
function InspectionDemo() {
  const target = INSPECTION_STATION.pos
  return (
    <div className="id-shell">
      <header className="id-topbar">
        <span className="id-brand">FORGEMIND</span>
        <span className="id-title">视觉检测工作台 · DEMO / VISUAL INSPECTION</span>
        <span className="id-spacer" />
        <a className="id-back" href="/">← 返回基地</a>
        <span className="id-hint">手柄或 WASD+鼠标 · 摄像头臂末端视角实时渲染</span>
      </header>
      <div className="id-body">
        <div className="id-stage">
          <Canvas
            shadows
            camera={{ position: [target.x + 2.2, 2.5, target.z + 3.2], fov: 42, near: 0.1, far: 120 }}
            gl={{ antialias: true, powerPreference: 'high-performance' }}
          >
            <color attach="background" args={['#c4ceca']} />
            <fog attach="fog" args={['#c4ceca', 30, 90]} />
            <ambientLight intensity={0.55} />
            <hemisphereLight args={['#edf1f0', '#8d9794', 0.55]} />
            <directionalLight
              position={[8, 12, 6]}
              intensity={1.2}
              castShadow
              shadow-mapSize={[1024, 1024]}
              shadow-normalBias={0.025}
            />
            <Grid
              infiniteGrid
              cellSize={1}
              cellThickness={0.6}
              cellColor="#879790"
              sectionSize={5}
              sectionThickness={1}
              sectionColor="#657873"
              fadeDistance={45}
            />
            <InspectionCameraArm />
            <GripperArm />
            <CameraFeedTarget />
            <OrbitControls
              makeDefault
              target={new THREE.Vector3(target.x, 0.6, target.z - 0.4)}
              maxPolarAngle={Math.PI / 2.05}
            />
          </Canvas>
        </div>
        <InspectionPanel />
      </div>
    </div>
  )
}

createRoot(document.getElementById('root') as HTMLElement).render(<InspectionDemo />)
