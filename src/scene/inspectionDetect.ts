import { inspectionRegistry } from './inspectionRegistry'

const VISION_URL = 'http://localhost:8000/api/vision/detect'

export interface VisionDefect {
  type: string
  x: number
  y: number
  size: number
  severity: number
}

export interface VisionResult {
  verdict: 'pass' | 'fail' | 'error'
  defects: VisionDefect[]
  confidence: number
  note?: string | null
}

function frameToBase64(width: number, height: number, pixels: Uint8Array): string {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')!
  const rowBytes = width * 4
  const flipped = new Uint8ClampedArray(pixels.length)
  for (let y = 0; y < height; y += 1) {
    const src = y * rowBytes
    const dst = (height - 1 - y) * rowBytes
    flipped.set(pixels.subarray(src, src + rowBytes), dst)
  }
  ctx.putImageData(new ImageData(flipped, width, height), 0, 0)
  return canvas.toDataURL('image/png').split(',')[1]
}

/**
 * 实时视觉检测：抓当前帧 → 跑全部检测项 → 写 verdict + 广播结果事件（面板展示）。
 * 摄像头环绕到货物进视野时自动调用；面板按钮也可手动触发。
 */
export async function runInspection(): Promise<void> {
  const frame = inspectionRegistry.frame
  const emit = (json: VisionResult) => {
    inspectionRegistry.lastVerdict = json.verdict === 'pass' ? 'pass' : json.verdict === 'fail' ? 'fail' : 'error'
    window.dispatchEvent(new CustomEvent('forgemind:inspection-result', { detail: json }))
  }
  if (!frame) {
    emit({ verdict: 'error', defects: [], confidence: 0, note: '相机画面尚未就绪' })
    return
  }
  try {
    const res = await fetch(VISION_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        image: frameToBase64(frame.width, frame.height, frame.pixels),
        partId: `part_${inspectionRegistry.partSeed}`,
      }),
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const json = (await res.json()) as VisionResult
    emit(json)
  } catch {
    emit({ verdict: 'error', defects: [], confidence: 0, note: 'AI 服务不可用' })
  }
}
