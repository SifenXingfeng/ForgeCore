import { AnimatePresence, motion } from 'motion/react'
import {
  AlertTriangle,
  ArrowRight,
  Bot,
  Check,
  CheckCircle2,
  Circle,
  Clock3,
  Cpu,
  Factory,
  FileDiff,
  Gauge,
  LoaderCircle,
  LocateFixed,
  PackageOpen,
  Play,
  RefreshCw,
  ShieldCheck,
  Square,
  Undo2,
  Workflow,
  XCircle,
} from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import type { AppPage } from '../components/Sidebar'
import { ApiError } from '../repository/apiClient'
import {
  agentRepository,
  type AgentFinding,
  type AgentPatch,
  type AgentRun,
  type AgentRunMode,
  type AgentRunStatus,
} from '../repository/agentRepository'
import { factoryRepository } from '../repository/factoryRepository'
import { subscribeAgentEvents } from '../repository/realtimeRepository'
import { useForgeStore } from '../store/useForgeStore'

const ease = [0.16, 1, 0.3, 1] as const
const DEFAULT_OBJECTIVE = '检查当前工厂的生产、库存和物流瓶颈'

export function AgentPage({ onNavigate }: { onNavigate: (page: AppPage) => void }) {
  const [objective, setObjective] = useState(DEFAULT_OBJECTIVE)
  const [mode, setMode] = useState<AgentRunMode>('read_only')
  const [run, setRun] = useState<AgentRun | null>(null)
  const [history, setHistory] = useState<AgentRun[]>([])
  const [busy, setBusy] = useState(false)
  const [patchBusy, setPatchBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const streamDisposer = useRef<(() => void) | null>(null)
  const refreshQueued = useRef(false)
  const { factory, saveStatus, saveFactory, selectObject, restoreFactory } = useForgeStore()

  const loadHistory = useCallback(async () => {
    const factoryId = factoryRepository.activeRemoteFactoryId()
    if (!factoryId) return
    try {
      setHistory(await agentRepository.listRuns(factoryId))
    } catch {
      // History is secondary to starting a new grounded run.
    }
  }, [])

  useEffect(() => {
    void loadHistory()
    return () => streamDisposer.current?.()
  }, [loadHistory])

  const refreshRun = useCallback((runId: string) => {
    if (refreshQueued.current) return
    refreshQueued.current = true
    window.setTimeout(() => {
      refreshQueued.current = false
      void agentRepository.getRun(runId).then(setRun).catch(() => undefined)
    }, 90)
  }, [])

  const startAnalysis = async () => {
    const command = objective.trim()
    if (!command || busy) return
    setBusy(true)
    setError(null)
    streamDisposer.current?.()

    try {
      if (saveStatus !== 'saved' || !factoryRepository.activeRemoteFactoryId()) {
        const saved = await saveFactory()
        if (!saved) throw new Error('工厂保存失败')
      }
      const factoryId = factoryRepository.activeRemoteFactoryId()
      if (!factoryId) throw new Error('当前工厂尚未同步到后端')
      const created = await agentRepository.createRun(factoryId, command, mode)
      setRun(created)

      let analysisStarted = false
      const analyze = async () => {
        if (analysisStarted) return
        analysisStarted = true
        try {
          const completed = await agentRepository.analyzeRun(created.id)
          setRun(completed)
          await loadHistory()
        } catch (reason) {
          setError(errorMessage(reason))
          setRun(await agentRepository.getRun(created.id).catch(() => created))
        } finally {
          setBusy(false)
          streamDisposer.current?.()
          streamDisposer.current = null
        }
      }

      streamDisposer.current = subscribeAgentEvents(created.id, {
        onReady: () => void analyze(),
        onEvent: () => refreshRun(created.id),
      })
      window.setTimeout(() => void analyze(), 500)
    } catch (reason) {
      setBusy(false)
      setError(errorMessage(reason))
    }
  }

  const cancel = async () => {
    if (!run || !busy) return
    try {
      setRun(await agentRepository.cancelRun(run.id))
    } finally {
      setBusy(false)
      streamDisposer.current?.()
      streamDisposer.current = null
    }
  }

  const openRun = async (runId: string) => {
    setError(null)
    try {
      setRun(await agentRepository.getRun(runId))
    } catch (reason) {
      setError(errorMessage(reason))
    }
  }

  const locate = (finding: AgentFinding) => {
    const objectId = finding.object_ids[0] ?? finding.evidence.find((item) => item.object_id)?.object_id
    if (!objectId) return
    selectObject(objectId)
    onNavigate('editor')
  }

  const withPatchAction = async (action: () => Promise<AgentPatch>) => {
    if (!run || patchBusy) return
    setPatchBusy(true)
    setError(null)
    try {
      await action()
      const refreshed = await agentRepository.getRun(run.id)
      setRun(refreshed)
      await loadHistory()
    } catch (reason) {
      setError(errorMessage(reason))
      if (run) setRun(await agentRepository.getRun(run.id).catch(() => run))
    } finally {
      setPatchBusy(false)
    }
  }

  const approveAndApply = async (patch: AgentPatch) => {
    await withPatchAction(async () => {
      if (patch.status === 'awaiting_approval' || patch.status === 'validated') {
        await agentRepository.approvePatch(patch.id)
      }
      const applied = await agentRepository.applyPatch(patch.id)
      await restoreFactory()
      return applied
    })
  }

  const rejectPatch = async (patch: AgentPatch) => {
    await withPatchAction(() => agentRepository.rejectPatch(patch.id))
  }

  const rollbackPatch = async (patch: AgentPatch) => {
    await withPatchAction(async () => {
      const rolled = await agentRepository.rollbackPatch(patch.id)
      await restoreFactory()
      return rolled
    })
  }

  const status = run?.status ?? 'created'
  const running = busy || isRunning(status)
  const activePatch = run?.patches?.[0] ?? null

  return (
    <div className="page page--agent">
      <header className="page-heading agent-heading">
        <div><h1>Factory Agent</h1></div>
        <div className="page-heading__actions">
          <span className={`agent-status agent-status--${status}`}><StatusIcon status={status} />{statusLabel(status)}</span>
          {running && <button className="button button--secondary" onClick={() => void cancel()}><Square size={14} />停止</button>}
        </div>
      </header>

      <section className="agent-command" aria-label="Agent 目标">
        <Bot aria-hidden="true" />
        <textarea value={objective} maxLength={2000} onChange={(event) => setObjective(event.target.value)} aria-label="工厂分析目标" />
        <div className="agent-command__modes" role="group" aria-label="工作模式">
          <button
            type="button"
            className={`agent-command__mode ${mode === 'read_only' ? 'is-active' : ''}`}
            disabled={running}
            onClick={() => setMode('read_only')}
          >
            <ShieldCheck />只读分析
          </button>
          <button
            type="button"
            className={`agent-command__mode ${mode === 'plan_design' ? 'is-active' : ''}`}
            disabled={running}
            onClick={() => setMode('plan_design')}
          >
            <FileDiff />方案设计
          </button>
        </div>
        <button className="agent-command__run" disabled={running || !objective.trim()} onClick={() => void startAnalysis()}>
          {running ? <LoaderCircle className="fc-spin" /> : <Play />}<span>{running ? '执行中' : mode === 'plan_design' ? '生成方案' : '开始分析'}</span>
        </button>
      </section>

      {error && <div className="agent-error" role="alert"><AlertTriangle /> <strong>{error}</strong></div>}

      {run?.compiled_goal && <section className="agent-goal-summary" aria-label="结构化目标">
        <strong>{goalIntentLabel(run.compiled_goal.intent)}</strong>
        <span className={`agent-goal-status is-${run.compiled_goal.status}`}>{goalStatusLabel(run.compiled_goal.status)}</span>
        {run.compiled_goal.metrics.map((metric, index) => <span key={`${metric.key}-${index}`}>
          {goalMetricLabel(metric.key)} {goalOperatorLabel(metric.operator)} {metric.target ?? '最优'} {metric.unit}
        </span>)}
        {run.compiled_goal.hard_constraints.map((constraint, index) => <span key={`${constraint.key}-${index}`}>
          {goalConstraintLabel(constraint.key)} {constraint.operator === 'eq' ? '固定' : constraint.operator} {constraint.value ?? ''}{constraint.unit ?? ''}
        </span>)}
        {run.compiled_goal.conflicts.map((conflict, index) => <span key={`conflict-${index}`} className="is-conflict">{conflict.message}</span>)}
        {run.compiled_goal.missing_constraints.map((item, index) => <span key={`missing-${index}`} className="is-missing">{item}</span>)}
        <span>{formatDuration(run.compiled_goal.time_horizon_sec)} 窗口</span>
        <span>{providerLabel(run.provider, run.llm_configured)}</span>
      </section>}

      {run ? (
        <motion.div className="agent-workspace" initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, ease }}>
          <aside className="agent-plan" aria-label="执行计划">
            <div className="agent-section-title"><span>执行计划</span><strong>{run.steps.filter((step) => step.status === 'completed').length}/{run.steps.length}</strong></div>
            <ol className="agent-steps">
              {run.steps.map((step) => <li key={step.id} className={`is-${step.status}`}>
                <span><StepIcon status={step.status} /></span>
                <div><strong>{step.title}</strong><p>{step.detail || '等待执行'}</p></div>
              </li>)}
            </ol>
            <div className="agent-section-title"><span>工具活动</span><strong>{run.tool_calls.length}</strong></div>
            <ol className="agent-tools">
              {run.tool_calls.map((tool) => <li key={tool.id}><Cpu /><span>{toolLabel(tool.tool_name)}</span><strong>{tool.duration_ms ?? 0}ms</strong></li>)}
              {!run.tool_calls.length && <li className="is-empty"><Clock3 /><span>等待工具调用</span></li>}
            </ol>
          </aside>

          <section className="agent-findings">
            <div className="agent-result-head">
              <div><span>诊断结果</span><h2>{run.result?.headline ?? (running ? '正在检查工厂' : '等待分析')}</h2></div>
              {run.result && <strong>{Math.round(run.result.confidence * 100)}% 置信度</strong>}
            </div>

            {activePatch && (
              <article className={`agent-patch agent-patch--${activePatch.status}`} aria-label="方案变更">
                <div className="agent-patch__head">
                  <div>
                    <span>方案变更</span>
                    <h3>{patchStatusLabel(activePatch.status)} · {riskLabel(activePatch.risk_level)}</h3>
                    <p>{activePatch.diff_summary.operation_count ?? activePatch.operations.length} 项操作
                      {(activePatch.diff_summary.added_object_count || activePatch.diff_summary.removed_object_count)
                        ? ` · 新增 ${activePatch.diff_summary.added_object_count ?? 0} / 删除 ${activePatch.diff_summary.removed_object_count ?? 0}`
                        : ''}
                      {' · '}基线 {formatVersion(activePatch.base_version)}</p>
                  </div>
                  <FileDiff />
                </div>
                {(activePatch.validation.errors?.length || activePatch.validation.warnings?.length) ? (
                  <div className="agent-patch__validation">
                    {activePatch.validation.errors?.map((item) => <span key={item} className="is-error">{item}</span>)}
                    {activePatch.validation.warnings?.map((item) => <span key={item} className="is-warning">{item}</span>)}
                  </div>
                ) : null}
                <ol className="agent-patch__ops">
                  {activePatch.operations.map((op) => (
                    <li key={op.op_id}>
                      <strong>{opKindLabel(op.kind)}</strong>
                      <span>{op.summary || op.object_id || op.op_id}</span>
                      <small>{riskLabel(op.risk)}</small>
                    </li>
                  ))}
                </ol>
                <div className="agent-patch__actions">
                  {(activePatch.status === 'awaiting_approval' || activePatch.status === 'validated' || activePatch.status === 'approved') && (
                    <>
                      <button className="button" disabled={patchBusy || running} onClick={() => void approveAndApply(activePatch)}>
                        {patchBusy ? <LoaderCircle className="fc-spin" /> : <Check />}批准并应用
                      </button>
                      <button className="button button--secondary" disabled={patchBusy || running} onClick={() => void rejectPatch(activePatch)}>
                        <XCircle />拒绝
                      </button>
                    </>
                  )}
                  {activePatch.status === 'applied' && (
                    <button className="button button--secondary" disabled={patchBusy || running} onClick={() => void rollbackPatch(activePatch)}>
                      <Undo2 />回滚
                    </button>
                  )}
                  {activePatch.error && <strong className="agent-patch__error">{activePatch.error}</strong>}
                </div>
              </article>
            )}

            <AnimatePresence mode="popLayout">
              {run.result?.findings.map((finding, index) => (
                <motion.article
                  className={`agent-finding agent-finding--${finding.severity}`}
                  key={finding.id}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.5, delay: index * 0.06, ease }}
                >
                  <div className="agent-finding__signal"><FindingIcon severity={finding.severity} /></div>
                  <div className="agent-finding__body">
                    <span>{categoryLabel(finding.category)}</span>
                    <h3>{finding.title}</h3>
                    <p>{finding.detail}</p>
                    <div className="agent-evidence-row">{finding.evidence.map((evidence) => <span key={`${evidence.label}-${evidence.value}`}><small>{evidence.label}</small><strong>{evidence.value}</strong></span>)}</div>
                    <div className="agent-recommendation"><ArrowRight />{finding.recommendation}</div>
                  </div>
                  {finding.object_ids.length > 0 && <button className="agent-locate" onClick={() => locate(finding)} title="在工厂编辑器中定位"><LocateFixed /><span>定位</span></button>}
                </motion.article>
              ))}
            </AnimatePresence>
            {!run.result && <div className="agent-analyzing"><div className="agent-analyzing__pulse"><Bot /></div><strong>{running ? '正在建立工厂证据链' : '运行尚未开始'}</strong></div>}
          </section>

          <aside className="agent-evidence" aria-label="工厂证据">
            <div className="agent-section-title"><span>运行证据</span><Gauge /></div>
            <dl className="agent-metrics">
              <Metric label="当前吞吐" value={formatNumber(run.result?.metrics.throughput_per_min)} unit="件/分钟" />
              <Metric label="在制品" value={formatNumber(run.result?.metrics.work_in_progress)} unit="件" />
              <Metric label="成品" value={formatNumber(run.result?.metrics.finished_goods)} unit="件" />
              <Metric label="仿真时间" value={formatDuration(run.result?.metrics.elapsed_sim_sec ?? 0)} />
            </dl>
            <div className="agent-section-title"><span>工厂版本</span><Factory /></div>
            <dl className="agent-facts">
              <Fact icon={<Factory />} label="对象" value={run.result?.snapshot.object_count ?? 0} />
              <Fact icon={<Workflow />} label="配方" value={run.result?.snapshot.recipe_count ?? 0} />
              <Fact icon={<PackageOpen />} label="物品" value={run.result?.snapshot.item_count ?? 0} />
              <Fact icon={<Gauge />} label="指标样本" value={run.result?.metrics.sample_count ?? 0} />
            </dl>
            <button className="agent-rerun" disabled={running} onClick={() => void startAnalysis()}><RefreshCw />重新分析当前版本</button>
          </aside>
        </motion.div>
      ) : (
        <div className="agent-empty">
          <div><Bot /><strong>{factory.name}</strong></div>
          <span>生产</span><span>库存</span><span>物流</span><span>配方</span><span>设备</span>
        </div>
      )}

      {history.length > 0 && <section className="agent-history">
        <div className="agent-section-title"><span>历史运行</span><strong>{history.length}</strong></div>
        <div>{history.slice(0, 6).map((item) => <button key={item.id} className={item.id === run?.id ? 'is-active' : ''} onClick={() => void openRun(item.id)}>
          <StatusIcon status={item.status} /><span><strong>{item.summary || item.objective}</strong><small>{formatDate(item.created_at)} · {modeLabel(item.mode)}</small></span><ArrowRight />
        </button>)}</div>
      </section>}
    </div>
  )
}

function StatusIcon({ status }: { status: AgentRunStatus }) {
  if (status === 'completed') return <CheckCircle2 />
  if (status === 'failed' || status === 'rejected') return <XCircle />
  if (status === 'cancelled') return <Square />
  if (status === 'awaiting_approval') return <FileDiff />
  if (isRunning(status)) return <LoaderCircle className="fc-spin" />
  return <Circle />
}

function StepIcon({ status }: { status: AgentRun['steps'][number]['status'] }) {
  if (status === 'completed') return <Check />
  if (status === 'running') return <LoaderCircle className="fc-spin" />
  if (status === 'failed') return <XCircle />
  return <Circle />
}

function FindingIcon({ severity }: Pick<AgentFinding, 'severity'>) {
  if (severity === 'success') return <CheckCircle2 />
  if (severity === 'critical' || severity === 'warning') return <AlertTriangle />
  return <Gauge />
}

function Metric({ label, value, unit }: { label: string; value: string; unit?: string }) {
  return <div><dt>{label}</dt><dd>{value}<small>{unit}</small></dd></div>
}

function Fact({ icon, label, value }: { icon: ReactNode; label: string; value: number }) {
  return <div><dt>{icon}{label}</dt><dd>{value}</dd></div>
}

function isRunning(status: AgentRunStatus) {
  return status === 'planning' || status === 'contextualizing' || status === 'executing_tools' || status === 'applying'
}
function statusLabel(status: AgentRunStatus) {
  return ({
    created: '准备就绪',
    planning: '编译目标',
    contextualizing: '读取上下文',
    executing_tools: '执行工具',
    awaiting_approval: '待审批',
    applying: '应用中',
    completed: '分析完成',
    rejected: '已拒绝',
    failed: '执行失败',
    cancelled: '已停止',
  } as const)[status]
}
function categoryLabel(category: string) { return ({ configuration: '配置', evidence: '证据', production: '生产', inventory: '库存', logistics: '物流', system: '系统' } as Record<string, string>)[category] ?? category }
function toolLabel(tool: string) { return ({ explain_constraint: '编译目标约束', get_factory_snapshot: '读取工厂快照', get_factory_graph: '构建依赖图', get_simulation_metrics: '读取仿真指标', query_event_timeline: '读取事件时间线', inspect_inventory: '检查库存', inspect_machine: '检查机器', inspect_recipe_chain: '检查配方链', inspect_conveyors: '检查传送带', inspect_logistics: '检查物流', calculate_capacity: '计算理论产能', inspect_bottlenecks: '诊断瓶颈' } as Record<string, string>)[tool] ?? tool }
function goalIntentLabel(intent: string) { return ({ diagnose: '诊断', explain: '解释', optimize: '优化', monitor: '监控' } as Record<string, string>)[intent] ?? intent }
function goalMetricLabel(key: string) { return ({ throughput_per_min: '吞吐', work_in_progress: '在制品' } as Record<string, string>)[key] ?? key }
function goalOperatorLabel(operator: string) { return ({ eq: '=', gte: '>=', lte: '<=', maximize: '最大化', minimize: '最小化' } as Record<string, string>)[operator] ?? operator }
function goalConstraintLabel(key: string) { return ({ floor_area_m2: '面积', agv_count: 'AGV', drone_count: '无人机', machine_count: '机器' } as Record<string, string>)[key] ?? key }
function goalStatusLabel(status: string) { return ({ ready: '目标就绪', needs_clarification: '待澄清', conflicting: '约束冲突' } as Record<string, string>)[status] ?? status }
function modeLabel(mode: AgentRunMode) { return mode === 'plan_design' ? '方案设计' : '只读分析' }
function providerLabel(provider: string, llmConfigured: boolean) {
  if (provider === 'deterministic') return llmConfigured ? '确定性降级' : '确定性分析'
  return `模型 ${provider}`
}
function patchStatusLabel(status: string) {
  return ({
    proposed: '已提出',
    validated: '已校验',
    awaiting_approval: '待审批',
    approved: '已批准',
    rejected: '已拒绝',
    applied: '已应用',
    failed: '失败',
    superseded: '已失效',
    rolled_back: '已回滚',
  } as Record<string, string>)[status] ?? status
}
function riskLabel(risk: string) { return ({ low: '低风险', medium: '中风险', high: '高风险' } as Record<string, string>)[risk] ?? risk }
function opKindLabel(kind: string) { return ({ move_object: '移动对象', update_config: '更新配置', adjust_inventory: '调整库存', add_object: '新增对象', remove_object: '删除对象' } as Record<string, string>)[kind] ?? kind }
function formatNumber(value?: number) { return Number.isFinite(value) ? Number(value).toFixed(1) : '0.0' }
function formatDuration(seconds: number) { const m = Math.floor(seconds / 60); const s = Math.floor(seconds % 60); return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` }
function formatDate(value: string) { return new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(value)) }
function formatVersion(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value.slice(0, 19) : formatDate(value)
}
function errorMessage(reason: unknown) { return reason instanceof ApiError || reason instanceof Error ? reason.message : 'Agent 暂时无法执行' }
