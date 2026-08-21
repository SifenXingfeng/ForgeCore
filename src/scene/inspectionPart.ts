import * as THREE from 'three'

/** 被测件类型：seed → 缺陷，与 ai-service 的判定词（scratch/burr/dent）对齐 */
export const PART_TYPES = [
  { seed: 0, label: '干净', en: 'CLEAN' },
  { seed: 1, label: '划痕', en: 'SCRATCH' },
  { seed: 2, label: '毛刺', en: 'BURR' },
  { seed: 3, label: '凹痕', en: 'DENT' },
]

function mulberry32(seed: number) {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * 程序化生成被测件表面贴图：基色 + 金属噪点 + 按 seed 渲染的缺陷。
 * 缺陷必须真实进入像素，下游 OpenCV 才检得出。
 */
export function createPartTexture(seed: number): THREE.CanvasTexture {
  const size = 256
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')!
  const rng = mulberry32(seed * 7919 + 13)

  // 基色 + 细微金属噪点
  ctx.fillStyle = '#c98b4b'
  ctx.fillRect(0, 0, size, size)
  for (let i = 0; i < 900; i += 1) {
    ctx.fillStyle = `rgba(0,0,0,${(0.03 + rng() * 0.05).toFixed(3)})`
    ctx.fillRect(rng() * size, rng() * size, 1.5, 1.5)
  }

  const type = seed % 4
  if (type === 1) {
    // 划痕：暗色细长线
    ctx.strokeStyle = 'rgba(22,18,14,0.9)'
    ctx.lineWidth = 3
    for (let i = 0; i < 2; i += 1) {
      const x1 = 40 + rng() * 140
      const y1 = 30 + rng() * 160
      const x2 = x1 + (rng() - 0.35) * 160
      const y2 = y1 + (rng() - 0.35) * 140
      ctx.beginPath()
      ctx.moveTo(x1, y1)
      ctx.lineTo(x2, y2)
      ctx.stroke()
    }
  } else if (type === 2) {
    // 毛刺：暗色小斑
    ctx.fillStyle = 'rgba(15,12,9,0.92)'
    for (let i = 0; i < 5; i += 1) {
      ctx.beginPath()
      ctx.arc(rng() * size, rng() * size, 6 + rng() * 7, 0, Math.PI * 2)
      ctx.fill()
    }
  } else if (type === 3) {
    // 凹痕：大片暗区
    ctx.fillStyle = 'rgba(32,28,24,0.9)'
    ctx.beginPath()
    ctx.arc(size / 2, size / 2, size * 0.24, 0, Math.PI * 2)
    ctx.fill()
  }

  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = 4
  return texture
}
