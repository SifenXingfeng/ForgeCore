import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const appOrigin = process.env.FORGEMIND_APP_ORIGIN ?? 'http://127.0.0.1:5173'
const suppliedDebugOrigin = process.env.FORGEMIND_CDP_ORIGIN
const debugOrigin = suppliedDebugOrigin ?? 'http://127.0.0.1:9223'

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))

let browserProfile = null
if (!suppliedDebugOrigin) {
  const edgeCandidates = [
    process.env.FORGEMIND_EDGE_PATH,
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  ].filter(Boolean)
  const edgeExecutable = edgeCandidates.find((candidate) => existsSync(candidate))
  if (!edgeExecutable) throw new Error('Microsoft Edge was not found; set FORGEMIND_EDGE_PATH or FORGEMIND_CDP_ORIGIN')
  browserProfile = await mkdtemp(join(tmpdir(), 'forgemind-selection-audit-'))
  const browserLauncher = spawn(edgeExecutable, [
    '--headless=new',
    '--no-first-run',
    '--disable-extensions',
    '--remote-debugging-port=9223',
    `--user-data-dir=${browserProfile}`,
    '--window-size=1920,1080',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--ignore-gpu-blocklist',
    appOrigin,
  ], { stdio: 'ignore', windowsHide: true })
  browserLauncher.unref()
}

async function waitForTarget(timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const targets = await fetch(`${debugOrigin}/json/list`).then((response) => response.json())
      const target = targets.find((candidate) => candidate.type === 'page' && candidate.url.startsWith(appOrigin))
      if (target?.webSocketDebuggerUrl) return target
    } catch {
      // Edge may still be opening its remote-debugging endpoint.
    }
    await delay(100)
  }
  throw new Error(`No ForgeMind page target found at ${debugOrigin}`)
}

class CdpSession {
  constructor(url) {
    this.nextId = 1
    this.pending = new Map()
    this.socket = new WebSocket(url)
  }

  async open() {
    await new Promise((resolve, reject) => {
      this.socket.addEventListener('open', resolve, { once: true })
      this.socket.addEventListener('error', reject, { once: true })
    })
  }

  send(method, params = {}) {
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.socket.send(JSON.stringify({ id, method, params }))
      const timeout = setTimeout(() => {
        if (!this.pending.delete(id)) return
        reject(new Error(`CDP command timed out: ${method}`))
      }, 15_000)
      this.pending.get(id).timeout = timeout
    })
  }

  listen() {
    this.socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data)
      if (!message.id) return
      const pending = this.pending.get(message.id)
      if (!pending) return
      clearTimeout(pending.timeout)
      this.pending.delete(message.id)
      if (message.error) pending.reject(new Error(`${message.error.code}: ${message.error.message}`))
      else pending.resolve(message.result)
    })
  }

  close() {
    this.socket.close()
  }
}

const target = await waitForTarget()
const cdp = new CdpSession(target.webSocketDebuggerUrl)
cdp.listen()
await cdp.open()
await cdp.send('Runtime.enable')
await cdp.send('Page.enable')
await cdp.send('Page.reload', { ignoreCache: true })

async function evaluate(expression) {
  const response = await cdp.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
    userGesture: true,
  })
  if (response.exceptionDetails) {
    const detail = response.exceptionDetails.exception?.description ?? response.exceptionDetails.text
    throw new Error(`Browser evaluation failed: ${detail}`)
  }
  return response.result.value
}

async function waitFor(expression, label, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await evaluate(expression)) return
    await delay(100)
  }
  throw new Error(`Timed out waiting for ${label}`)
}

try {
  await waitFor("document.readyState === 'complete' && Boolean(document.querySelector('.fmi-nav-cta'))", 'intro page')
  await evaluate("document.querySelector('.fmi-nav-cta').click(); true")
  await waitFor("!document.querySelector('.fmi-nav-cta')", 'workspace shell')
  await evaluate(`(async () => {
    const { useAuthStore } = await import('/src/store/auth.ts')
    useAuthStore.setState({ phase: 'factory', user: 'codex-selection-probe', token: null, busy: false })
    return true
  })()`)
  await waitFor("Boolean(document.querySelector('.fm-project-create button'))", 'new factory dialog')
  await evaluate("document.querySelector('.fm-project-create button').click(); true")
  await waitFor("Boolean(document.querySelector('.fm-viewport canvas')) && !document.querySelector('.fm-project-dialog')", 'factory viewport')
  await waitFor("document.querySelector('.fm-viewport canvas')?.dataset.selectionController === 'ready'", 'selection controller')

  const injected = await evaluate(`(async () => {
    const { useForgeMindStore } = await import('/src/store/forgeMind.ts')
    const objects = [
      { id: 'browser-select-a', type: 'conveyor', pos: { x: -2, z: 0 }, rotation: 0, floorId: 1 },
      { id: 'browser-select-b', type: 'conveyor', pos: { x: 0, z: 0 }, rotation: 0, floorId: 1 },
      { id: 'browser-select-c', type: 'conveyor', pos: { x: 2, z: 0 }, rotation: 0, floorId: 1 },
    ]
    useForgeMindStore.setState({ objects, selectedId: null, selectedIds: [], buildType: null })
    return useForgeMindStore.getState().objects.map((object) => object.id)
  })()`)
  assert.deepEqual(injected, ['browser-select-a', 'browser-select-b', 'browser-select-c'])
  await delay(500)

  const focusedBeforeDrag = await evaluate(`(() => {
    const input = document.createElement('input')
    input.id = 'selection-focus-probe'
    input.style.cssText = 'position:fixed;right:0;top:0;width:20px;height:20px;z-index:9999'
    document.body.appendChild(input)
    input.focus()
    return document.activeElement?.id
  })()`)
  assert.equal(focusedBeforeDrag, 'selection-focus-probe', 'The audit must begin with an input owning keyboard focus')

  const dragGeometry = await evaluate(`(() => {
    const canvas = document.querySelector('.fm-viewport canvas')
    const rect = canvas.getBoundingClientRect()
    const candidates = []
    for (let y = rect.top + 8; y < rect.bottom - 8; y += 16) {
      for (let x = rect.left + 8; x < rect.right - 8; x += 16) {
        if (document.elementFromPoint(x, y) === canvas) candidates.push({ x, y })
      }
    }
    const upperLeft = candidates
      .filter((point) => point.x < rect.left + rect.width * 0.35 && point.y < rect.top + rect.height * 0.5)
      .sort((left, right) => (left.x + left.y) - (right.x + right.y))[0]
      ?? candidates.sort((left, right) => (left.x + left.y) - (right.x + right.y))[0]
    if (!upperLeft) return null
    return { start: upperLeft, end: { x: rect.right - 8, y: rect.bottom - 8 }, rect: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom } }
  })()`)
  assert.ok(dragGeometry, 'A canvas hit point must be available for Shift-drag')

  const { start, end } = dragGeometry
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: start.x, y: start.y, modifiers: 8 })
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: start.x, y: start.y, button: 'left', buttons: 1, clickCount: 1, modifiers: 8 })
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: (start.x + end.x) / 2, y: (start.y + end.y) / 2, button: 'left', buttons: 1, modifiers: 8 })
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: end.x, y: end.y, button: 'left', buttons: 1, modifiers: 8 })

  const focusedDuringDrag = await evaluate("document.activeElement?.tagName")
  assert.equal(focusedDuringDrag, 'CANVAS', 'Shift-drag must transfer keyboard focus from the prior input to the factory canvas')

  const marquee = await evaluate(`(() => {
    const overlay = document.querySelector('[data-testid="selection-marquee"]')
    if (!overlay) return null
    const rect = overlay.getBoundingClientRect()
    return { width: rect.width, height: rect.height }
  })()`)
  assert.ok(marquee && marquee.width > 100 && marquee.height > 100, 'Shift-drag must render a visible marquee')

  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: end.x, y: end.y, button: 'left', buttons: 0, clickCount: 1, modifiers: 8 })
  await waitFor(`(async () => {
    const { useForgeMindStore } = await import('/src/store/forgeMind.ts')
    return useForgeMindStore.getState().selectedIds.length === 3
  })()`, 'three selected buildings')

  const selectedBeforeDelete = await evaluate(`(async () => {
    const { useForgeMindStore } = await import('/src/store/forgeMind.ts')
    return useForgeMindStore.getState().selectedIds
  })()`)
  assert.deepEqual(selectedBeforeDelete.sort(), ['browser-select-a', 'browser-select-b', 'browser-select-c'])

  await cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Delete', code: 'Delete', windowsVirtualKeyCode: 46, nativeVirtualKeyCode: 46 })
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Delete', code: 'Delete', windowsVirtualKeyCode: 46, nativeVirtualKeyCode: 46 })
  await waitFor(`(async () => {
    const { useForgeMindStore } = await import('/src/store/forgeMind.ts')
    const state = useForgeMindStore.getState()
    return state.objects.length === 0 && state.selectedIds.length === 0
  })()`, 'Delete to remove the marquee selection')

  console.log(JSON.stringify({
    result: 'passed',
    focusBeforeDrag: focusedBeforeDrag,
    focusDuringDrag: focusedDuringDrag,
    marquee,
    selectedBeforeDelete,
    objectsAfterDelete: 0,
  }, null, 2))
} finally {
  if (!suppliedDebugOrigin) {
    try {
      await cdp.send('Browser.close')
    } catch {
      // The browser can close its target before acknowledging the command.
    }
  }
  cdp.close()
  if (browserProfile) {
    await delay(500)
    await rm(browserProfile, { recursive: true, force: true, maxRetries: 8, retryDelay: 200 })
  }
}
