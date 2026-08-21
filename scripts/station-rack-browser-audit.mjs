import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const appOrigin = process.env.FORGEMIND_APP_ORIGIN ?? 'http://127.0.0.1:5173'
const debugOrigin = 'http://127.0.0.1:9224'
const delay = (milliseconds) => new Promise((done) => setTimeout(done, milliseconds))
const edge = [
  process.env.FORGEMIND_EDGE_PATH,
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
].filter(Boolean).find(existsSync)
if (!edge) throw new Error('Microsoft Edge is required for the station browser audit')

const browserProfile = await mkdtemp(join(tmpdir(), 'forgemind-station-rack-audit-'))
const browserLauncher = spawn(edge, [
  '--headless=new', '--no-first-run', '--disable-extensions', '--remote-debugging-port=9224',
  `--user-data-dir=${browserProfile}`, '--window-size=1920,1080', '--use-angle=swiftshader',
  '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', appOrigin,
], { stdio: 'ignore', windowsHide: true })
browserLauncher.unref()

async function waitForTarget() {
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    try {
      const targets = await fetch(`${debugOrigin}/json/list`).then((response) => response.json())
      const target = targets.find((candidate) => candidate.type === 'page' && candidate.url.startsWith(appOrigin))
      if (target?.webSocketDebuggerUrl) return target
    } catch { /* Edge is still opening. */ }
    await delay(100)
  }
  throw new Error('ForgeMind browser target did not open')
}

class CdpSession {
  nextId = 1
  pending = new Map()
  events = []
  constructor(url) { this.socket = new WebSocket(url) }
  async open() {
    this.socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data)
      if (!message.id) { this.events.push(message); return }
      const pending = this.pending.get(message.id)
      if (!pending) return
      clearTimeout(pending.timeout)
      this.pending.delete(message.id)
      if (message.error) pending.reject(new Error(message.error.message))
      else pending.resolve(message.result)
    })
    await new Promise((done, fail) => {
      this.socket.addEventListener('open', done, { once: true })
      this.socket.addEventListener('error', fail, { once: true })
    })
  }
  send(method, params = {}) {
    const id = this.nextId++
    return new Promise((done, fail) => {
      const timeout = setTimeout(() => { this.pending.delete(id); fail(new Error(`CDP timeout: ${method}`)) }, 15_000)
      this.pending.set(id, { resolve: done, reject: fail, timeout })
      this.socket.send(JSON.stringify({ id, method, params }))
    })
  }
  close() { this.socket.close() }
}

const target = await waitForTarget()
const cdp = new CdpSession(target.webSocketDebuggerUrl)
await cdp.open()
await cdp.send('Runtime.enable')
await cdp.send('Log.enable')
await cdp.send('Page.enable')
await cdp.send('Page.reload', { ignoreCache: true })

async function evaluate(expression) {
  const response = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true })
  if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description ?? response.exceptionDetails.text)
  return response.result.value
}
async function waitFor(expression, label, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await evaluate(expression)) return
    await delay(100)
  }
  throw new Error(`Timed out waiting for ${label}`)
}
async function screenshot(name) {
  const outputDir = resolve('artifacts')
  await mkdir(outputDir, { recursive: true })
  const path = join(outputDir, name)
  const result = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
  await writeFile(path, Buffer.from(result.data, 'base64'))
  return path
}
async function screenshotClip(name, clip) {
  const outputDir = resolve('artifacts')
  await mkdir(outputDir, { recursive: true })
  const path = join(outputDir, name)
  const result = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false, clip })
  await writeFile(path, Buffer.from(result.data, 'base64'))
  return path
}

try {
  await waitFor("document.readyState === 'complete' && Boolean(document.querySelector('.fmi-nav-cta'))", 'intro')
  await evaluate("document.querySelector('.fmi-nav-cta').click(); true")
  await waitFor("!document.querySelector('.fmi-nav-cta')", 'workspace')
  await evaluate(`(async () => {
    const { useAuthStore } = await import('/src/store/auth.ts')
    useAuthStore.setState({ phase: 'factory', user: 'codex-station-audit', token: null, busy: false })
    return true
  })()`)
  await waitFor("Boolean(document.querySelector('.fm-project-create button'))", 'factory dialog')
  await evaluate("document.querySelector('.fm-project-create button').click(); true")
  await waitFor("Boolean(document.querySelector('.fm-viewport canvas')) && !document.querySelector('.fm-project-dialog')", 'factory canvas')

  await evaluate(`(async () => {
    const useForgeMindStore = window.__FORGEMIND_DEV_STORE__
    if (!useForgeMindStore) throw new Error('ForgeMind development store bridge is unavailable')
    const { SimulationEngine } = await import('/src/game/simulation.ts')
    const item = { id: 'ITEM_IRON', code: 'IRON', name: '测试铁件', category: '原料', modelId: 'steel-coil', color: '#9aa4a0', massKg: 1, stackSize: 100, description: '三面吸附验收物料' }
    const objects = [
      { id: 'station-main', type: 'source', pos: { x: -2, z: -2 }, rotation: 0, floorId: 1, itemId: item.id, stationProgram: { mode: 'pickup', transferIntervalSec: 0.8, rackAssignments: { [item.id]: 'left' } } },
      { id: 'rack-back', type: 'oreMiner', pos: { x: -4, z: -1 }, rotation: 0, floorId: 1 },
      { id: 'rack-left', type: 'oreMiner', pos: { x: -1, z: 2 }, rotation: 0, floorId: 1, itemId: item.id },
      { id: 'rack-right', type: 'oreMiner', pos: { x: -1, z: -4 }, rotation: 0, floorId: 1 },
      { id: 'belt-front-a', type: 'conveyor', pos: { x: 2, z: -1 }, rotation: 0, floorId: 1 },
      { id: 'belt-front-b', type: 'conveyor', pos: { x: 3, z: -1 }, rotation: 0, floorId: 1 },
    ]
    const engine = new SimulationEngine(20260820)
    engine.init(objects, [])
    window.__stationRackAuditEngine = engine
    window.__stationRackAuditLock = true
    useForgeMindStore.setState({
      items: [item], objects, selectedId: 'station-main', selectedIds: ['station-main'], buildType: null, simPlaying: false,
      simSnapshot: engine.getSnapshot(),
      setSimSnapshot: (snapshot) => {
        if (window.__stationRackAuditLock) return
        useForgeMindStore.setState({ simSnapshot: snapshot })
      },
    })
    return true
  })()`)
  await waitFor(`(async () => {
    const useForgeMindStore = window.__FORGEMIND_DEV_STORE__
    const source = useForgeMindStore.getState().simSnapshot.sources.find((entry) => entry.objectId === 'station-main')
    return Object.keys(source?.rackConnections ?? {}).length === 3
  })()`, 'three actual rack connections')
  await delay(2500)
  const canvasCenter = await evaluate(`(() => {
    const rect = document.querySelector('.fm-viewport canvas').getBoundingClientRect()
    return { x: rect.left + rect.width * 0.5, y: rect.top + rect.height * 0.52 }
  })()`)
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: canvasCenter.x, y: canvasCenter.y, deltaX: 0, deltaY: -980 })
  await delay(500)
  const pausedPath = await screenshot('station-rack-paused.png')

  await evaluate("document.querySelector('.fm-device-drawer-bar button')?.click(); true")
  await delay(250)
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: canvasCenter.x, y: canvasCenter.y - 120, button: 'left', buttons: 1, clickCount: 1 })
  for (const y of [canvasCenter.y - 60, canvasCenter.y, canvasCenter.y + 60, canvasCenter.y + 120, canvasCenter.y + 180]) {
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: canvasCenter.x, y, button: 'left', buttons: 1 })
  }
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: canvasCenter.x, y: canvasCenter.y + 180, button: 'left', buttons: 0, clickCount: 1 })
  for (let index = 0; index < 3; index += 1) {
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: canvasCenter.x, y: canvasCenter.y, deltaX: 0, deltaY: -980 })
    await delay(120)
  }
  await delay(500)
  const alignmentPath = await screenshotClip('station-conveyor-alignment.png', {
    x: canvasCenter.x - 190,
    y: canvasCenter.y - 145,
    width: 440,
    height: 340,
    scale: 3,
  })

  await evaluate(`(async () => {
    const useForgeMindStore = window.__FORGEMIND_DEV_STORE__
    window.__stationRackAuditEngine.advance(1.1)
    useForgeMindStore.setState({ simPlaying: true, simSnapshot: window.__stationRackAuditEngine.getSnapshot() })
    return true
  })()`)
  await waitFor(`(async () => {
    const useForgeMindStore = window.__FORGEMIND_DEV_STORE__
    const source = useForgeMindStore.getState().simSnapshot.sources.find((entry) => entry.objectId === 'station-main')
    return (source?.state === 'picking' || source?.state === 'placing') && source.rackObjectId === 'rack-left'
  })()`, 'left-rack arm transfer')
  await delay(700)
  const activePath = await screenshot('station-rack-active.png')
  await evaluate(`(() => { window.__FORGEMIND_DEV_STORE__.getState().setSimPlaying(false); return true })()`)
  const progressBefore = await evaluate(`(() => window.__FORGEMIND_DEV_STORE__.getState().simSnapshot.sources[0]?.progress)()`)
  await delay(650)
  const progressAfter = await evaluate(`(() => window.__FORGEMIND_DEV_STORE__.getState().simSnapshot.sources[0]?.progress)()`)
  assert.equal(progressAfter, progressBefore, 'paused station transfer must freeze')
  await evaluate(`(async () => {
    const useForgeMindStore = window.__FORGEMIND_DEV_STORE__
    window.__stationRackAuditEngine.advance(1.5)
    useForgeMindStore.setState({ simSnapshot: window.__stationRackAuditEngine.getSnapshot() })
    return true
  })()`)

  const state = await evaluate(`(async () => {
    const useForgeMindStore = window.__FORGEMIND_DEV_STORE__
    const current = useForgeMindStore.getState()
    return {
      connections: current.simSnapshot.sources[0]?.rackConnections,
      rackObjectId: current.simSnapshot.sources[0]?.rackObjectId,
      rackStock: current.simSnapshot.racks.find((rack) => rack.objectId === 'rack-left')?.inventory.ITEM_IRON,
    }
  })()`)
  assert.deepEqual(state.connections, { back: 'rack-back', left: 'rack-left', right: 'rack-right' })
  assert.equal(state.rackObjectId, 'rack-left')
  assert.ok(state.rackStock < 24, 'completed pickup must decrement the attached left rack')
  const errors = cdp.events.filter((event) => event.method === 'Runtime.exceptionThrown' || (event.method === 'Log.entryAdded' && event.params?.entry?.level === 'error' && event.params?.entry?.source === 'javascript'))
  assert.equal(errors.length, 0, 'browser console must not contain runtime errors')
  console.log(JSON.stringify({ result: 'passed', pausedPath, alignmentPath, activePath, progressFrozen: progressBefore, ...state }, null, 2))
} finally {
  try { await cdp.send('Browser.close') } catch { /* target may close first */ }
  cdp.close()
  await delay(500)
  await rm(browserProfile, { recursive: true, force: true, maxRetries: 8, retryDelay: 200 })
}
