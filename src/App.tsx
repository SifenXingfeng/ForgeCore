import { Component, lazy, Suspense, type ErrorInfo, type ReactNode, useEffect, useState } from 'react'
import { AlertTriangle, CheckCircle2, Info, X } from 'lucide-react'
import { AppShell } from './components/AppShell'
import type { AppPage } from './components/Sidebar'
import { AssetsPage } from './pages/AssetsPage'
import { LogisticsPage } from './pages/LogisticsPage'
import { OverviewPage } from './pages/OverviewPage'
import { RecipesPage } from './pages/RecipesPage'
import { SimulationPage } from './pages/SimulationPage'
import { AuthPage } from './pages/AuthPage'
import { MainMenuPage } from './pages/MainMenuPage'
import { useForgeStore } from './store/useForgeStore'
import { useShallow } from 'zustand/react/shallow'
import { factoryRepository, uiPreferenceRepository } from './repository/factoryRepository'
import { authRepository, type AuthUser } from './repository/authRepository'
import { subscribeFactoryEvents } from './repository/realtimeRepository'
import type { ActivityEvent, MetricSample } from './types'

const pageTitles: Record<AppPage, string> = {
  overview: '运行总览', editor: '工厂编辑器', items: '物品模型', recipes: '配方工艺', simulation: '仿真监控', logistics: '物流仓储', assets: '资产中心',
}
const pageIds = Object.keys(pageTitles) as AppPage[]
const FactoryEditorPage = lazy(() => import('./pages/FactoryEditorPage').then((module) => ({ default: module.FactoryEditorPage })))
const ItemsPage = lazy(() => import('./pages/ItemsPage').then((module) => ({ default: module.ItemsPage })))
const SIMULATION_UI_INTERVAL_MS = 200

export default function App() {
  const [page, setPage] = useState<AppPage>(() => readInitialPage())
  const [user, setUser] = useState<AuthUser | null>(() => authRepository.session())
  const [surface, setSurface] = useState<'auth' | 'menu' | 'workspace'>(() => authRepository.session() ? 'menu' : 'auth')
  const [hasSavedFactory, setHasSavedFactory] = useState(false)
  const {
    factoryName, simulationStatus, simulationSpeed, saveStatus, toasts, createFactory, clearWorkspace, restoreFactory, saveFactory,
    tickSimulation, playSimulation, pauseSimulation, dismissToast, applyRealtimeMetric, applyRealtimeActivity,
  } = useForgeStore(useShallow((state) => ({
    factoryName: state.factory.name,
    simulationStatus: state.simulation.status,
    simulationSpeed: state.simulation.speed,
    saveStatus: state.saveStatus,
    toasts: state.toasts,
    createFactory: state.createFactory,
    clearWorkspace: state.clearWorkspace,
    restoreFactory: state.restoreFactory,
    saveFactory: state.saveFactory,
    tickSimulation: state.tickSimulation,
    playSimulation: state.playSimulation,
    pauseSimulation: state.pauseSimulation,
    dismissToast: state.dismissToast,
    applyRealtimeMetric: state.applyRealtimeMetric,
    applyRealtimeActivity: state.applyRealtimeActivity,
  })))
  const running = simulationStatus === 'running'

  useEffect(() => {
    if (surface === 'workspace') uiPreferenceRepository.savePage(page)
    document.title = surface === 'auth' ? '登录 · ForgeCore' : surface === 'menu' ? '主菜单 · ForgeCore' : `${pageTitles[page]} · ForgeCore`
  }, [page, surface])
  useEffect(() => {
    if (!user || surface !== 'menu') return
    let active = true
    void factoryRepository.exists().then((exists) => { if (active) setHasSavedFactory(exists) })
    return () => { active = false }
  }, [surface, user])
  useEffect(() => {
    if (surface !== 'workspace' || !running) return
    const timer = window.setInterval(() => tickSimulation(SIMULATION_UI_INTERVAL_MS / 1000), SIMULATION_UI_INTERVAL_MS)
    return () => window.clearInterval(timer)
  }, [running, surface, tickSimulation])
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (surface === 'workspace' && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); void saveFactory() }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [saveFactory, surface])
  useEffect(() => {
    if (surface !== 'workspace') return
    const remoteFactoryId = factoryRepository.activeRemoteFactoryId()
    if (!remoteFactoryId) return
    return subscribeFactoryEvents(remoteFactoryId, {
      onMetrics: (data) => {
        const sample = realtimeMetric(data)
        if (sample) applyRealtimeMetric(sample)
      },
      onActivity: (data) => {
        const event = realtimeActivity(data)
        if (event) applyRealtimeActivity(event)
      },
    })
  }, [applyRealtimeActivity, applyRealtimeMetric, saveStatus, surface])

  const handleAuthenticated = async (authenticatedUser: AuthUser) => {
    clearWorkspace()
    setUser(authenticatedUser)
    setHasSavedFactory(await factoryRepository.exists())
    setSurface('menu')
  }

  const handleCreateFactory = (input: { name: string; widthM: number; lengthM: number; gridSizeM: number }) => {
    factoryRepository.prepareNewFactory()
    createFactory(input)
    setPage('editor')
    setSurface('workspace')
  }

  const handleContinue = async () => {
    if (!await restoreFactory()) {
      setHasSavedFactory(false)
      return
    }
    setPage(readInitialPage())
    setSurface('workspace')
  }

  const handleOpenMainMenu = async () => {
    pauseSimulation()
    setHasSavedFactory(await factoryRepository.exists())
    setSurface('menu')
  }

  const handleLogout = () => {
    pauseSimulation()
    clearWorkspace()
    authRepository.logout()
    setUser(null)
    setHasSavedFactory(false)
    setSurface('auth')
  }

  if (!user || surface === 'auth') {
    return <AppErrorBoundary><AuthPage onAuthenticated={handleAuthenticated} /></AppErrorBoundary>
  }

  if (surface === 'menu') {
    return <AppErrorBoundary><MainMenuPage user={user} hasSavedFactory={hasSavedFactory} onContinue={handleContinue} onCreateFactory={handleCreateFactory} onLogout={handleLogout} /></AppErrorBoundary>
  }

  return <AppErrorBoundary>
    <AppShell currentPage={page} onNavigate={setPage} topbarProps={{ factoryName, saveState: topbarSaveState(saveStatus), simRunning: running, simSpeed: simulationSpeed, onSave: saveFactory, onToggleSimulation: running ? pauseSimulation : playSimulation, onOpenMainMenu: handleOpenMainMenu }}>
      {page === 'overview' && <OverviewPage onNavigate={setPage} />}
      {page === 'editor' && <Suspense fallback={<div className="page-loading" role="status">正在初始化三维工厂编辑器…</div>}><FactoryEditorPage onNavigate={setPage} /></Suspense>}
      {page === 'items' && <Suspense fallback={<div className="page-loading" role="status">正在载入参数化物品建模器…</div>}><ItemsPage /></Suspense>}
      {page === 'recipes' && <RecipesPage onNavigate={setPage} />}
      {page === 'simulation' && <SimulationPage />}
      {page === 'logistics' && <LogisticsPage />}
      {page === 'assets' && <AssetsPage />}
    </AppShell>
    <div className="toast-stack" aria-live="polite">{toasts.map((toast) => <article className={`toast toast--${toast.tone}`} key={toast.id}>{toast.tone === 'success' ? <CheckCircle2 /> : toast.tone === 'warning' || toast.tone === 'error' ? <AlertTriangle /> : <Info />}<div><strong>{toast.title}</strong>{toast.description && <p>{toast.description}</p>}</div><button onClick={() => dismissToast(toast.id)} aria-label="关闭通知"><X /></button></article>)}</div>
  </AppErrorBoundary>
}

const finiteNumber = (value: unknown): number | null => typeof value === 'number' && Number.isFinite(value) ? value : null

function realtimeMetric(data: Record<string, unknown>): MetricSample | null {
  const elapsedSimSec = finiteNumber(data.elapsed_sim_sec)
  if (elapsedSimSec === null) return null
  return {
    elapsedSimSec,
    throughputPerMin: finiteNumber(data.throughput_per_min) ?? 0,
    workInProgress: finiteNumber(data.work_in_progress) ?? 0,
    finishedGoods: finiteNumber(data.finished_goods) ?? 0,
    machineAUtilization: finiteNumber(data.machine_a_utilization) ?? 0,
    machineBUtilization: finiteNumber(data.machine_b_utilization) ?? 0,
  }
}

function realtimeActivity(data: Record<string, unknown>): ActivityEvent | null {
  const elapsedSimSec = finiteNumber(data.elapsed_sim_sec)
  if (typeof data.id !== 'string' || typeof data.title !== 'string' || elapsedSimSec === null) return null
  const tone = data.tone === 'success' || data.tone === 'warning' || data.tone === 'info' ? data.tone : 'neutral'
  return {
    id: data.id,
    elapsedSimSec,
    title: data.title,
    description: typeof data.description === 'string' ? data.description : '',
    tone,
    ...(typeof data.object_id === 'string' ? { objectId: data.object_id } : {}),
  }
}

function readInitialPage(): AppPage {
  return uiPreferenceRepository.loadPage(pageIds, 'overview')
}

function topbarSaveState(status: string): 'saved' | 'saving' | 'unsaved' | 'error' {
  if (status === 'saving') return 'saving'
  if (status === 'error') return 'error'
  if (status === 'dirty') return 'unsaved'
  return 'saved'
}

class AppErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }
  static getDerivedStateFromError(error: Error) { return { error } }
  componentDidCatch(error: Error, info: ErrorInfo) { console.error('ForgeCore UI crashed', error, info) }
  render() {
    if (!this.state.error) return this.props.children
    return <main className="fatal-error"><AlertTriangle /><h1>界面发生错误</h1><p>{this.state.error.message}</p><button className="button button--primary" onClick={() => window.location.reload()}>重新载入</button></main>
  }
}
