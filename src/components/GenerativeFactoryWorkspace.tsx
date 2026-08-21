import { stagger } from 'animejs'
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { diagnoseFactory, type FactoryFloorDiagnostic } from '../game/factoryDiagnostics'
import { requestFactorySpec } from '../game/factoryAI'
import { DEFAULT_COST_ASSUMPTIONS, evaluateWhatIf, generateFactoryAdjustments, generateFactoryCandidates, parseGenerationBrief, type GeneratedCandidate, type GenerationSpec, type WhatIfMutation, type WhatIfResult } from '../game/generativeFactory'
import { occupiedCells } from '../game/grid'
import type { FactoryFloorId } from '../game/types'
import { useForgeMindStore } from '../store/forgeMind'
import { animateIfAllowed } from '../utils/animeMotion'

const GENERATION_STEPS = [
  '需求确认',
  'Recipe Graph',
  '设备需求估算',
  '布局候选搜索',
  '碰撞与边界校验',
  '物流路径规划',
  '副本仿真',
  'Top 3 排名',
]

const DEFAULT_BRIEF = '我要生产齿轮箱。每小时目标 120 件。场地 30m × 20m。CNC 最多 4 台。AGV 最多 3 台。尽量降低能耗。'

export function GenerativeFactoryWorkspace() {
  const frameRef = useRef<HTMLDivElement>(null)
  const generationRequest = useRef(0)
  const factoryId = useForgeMindStore((s) => s.factoryId)
  const applyLayout = useForgeMindStore((s) => s.applyLayout)
  const undo = useForgeMindStore((s) => s.undo)
  const canUndo = useForgeMindStore((s) => s.canUndo)
  const objects = useForgeMindStore((s) => s.objects)
  const snapshot = useForgeMindStore((s) => s.simSnapshot)
  const recipes = useForgeMindStore((s) => s.recipes)
  const floorCount = useForgeMindStore((s) => s.floorCount)
  const [brief, setBrief] = useState(DEFAULT_BRIEF)
  const [spec, setSpec] = useState<GenerationSpec>({
    product: '齿轮箱',
    targetThroughputPerHour: 120,
    floorWidth: 30,
    floorDepth: 20,
    cncLimit: 4,
    agvLimit: 3,
    objective: 'energy',
    searchRounds: 2,
    economics: { ...DEFAULT_COST_ASSUMPTIONS },
  })
  const [candidates, setCandidates] = useState<GeneratedCandidate[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [generationStep, setGenerationStep] = useState(-1)
  const [isGenerating, setIsGenerating] = useState(false)
  const [notice, setNotice] = useState('A-02 等待设计任务')
  const [specSource, setSpecSource] = useState<'deepseek' | 'rule' | 'fallback'>('rule')
  const [whatIf, setWhatIf] = useState<WhatIfResult | null>(null)
  const [isWhatIfRunning, setIsWhatIfRunning] = useState(false)
  const [selectedDiagnosticFloor, setSelectedDiagnosticFloor] = useState<FactoryFloorId | 0>(0)

  const selectedCandidate = useMemo(
    () => candidates.find((candidate) => candidate.id === selectedId) ?? candidates[0] ?? null,
    [candidates, selectedId],
  )
  const liveDiagnostic = useMemo(() => diagnoseFactory(objects, snapshot, recipes, floorCount), [floorCount, objects, recipes, snapshot])
  const hasCurrentLine = objects.length > 0

  useEffect(() => {
    generationRequest.current += 1
    setCandidates([])
    setSelectedId(null)
    setGenerationStep(-1)
    setIsGenerating(false)
    setWhatIf(null)
    setIsWhatIfRunning(false)
    setSelectedDiagnosticFloor(0)
    setNotice(`${factoryId.toUpperCase()} 等待诊断任务`)
  }, [factoryId])

  useEffect(() => {
    if (!isGenerating) return
    if (generationStep >= GENERATION_STEPS.length - 1) {
      const finishTimer = window.setTimeout(() => {
        setIsGenerating(false)
        setNotice('候选方案已完成，等待选择')
      }, 650)
      return () => window.clearTimeout(finishTimer)
    }
    const timer = window.setTimeout(() => setGenerationStep((step) => step + 1), 430)
    return () => window.clearTimeout(timer)
  }, [generationStep, isGenerating])

  useEffect(() => {
    const frame = frameRef.current
    if (!frame) return
    const parts = frame.querySelectorAll<HTMLElement>('.fm-generative-card, .fm-generative-stage-step, .fm-generative-candidate')
    const animation = animateIfAllowed(parts, {
      opacity: [0, 1],
      translateY: [10, 0],
      delay: stagger(35, { start: 0 }),
      duration: 420,
      ease: 'out(4)',
    })
    return () => { animation?.cancel() }
  }, [candidates.length])

  const updateSpec = <K extends keyof GenerationSpec>(key: K, value: GenerationSpec[K]) => {
    setSpec((current) => ({ ...current, [key]: value }))
  }

  const updateEconomics = <K extends keyof typeof DEFAULT_COST_ASSUMPTIONS>(key: K, value: number) => {
    setSpec((current) => ({
      ...current,
      economics: { ...DEFAULT_COST_ASSUMPTIONS, ...current.economics, [key]: value },
    }))
  }

  const generate = () => {
    const request = ++generationRequest.current
    const parsed = parseGenerationBrief(brief, spec)
    setSpec(parsed.spec)
    setSpecSource('rule')
    setCandidates([])
    setSelectedId(null)
    setGenerationStep(0)
    setIsGenerating(true)
    setNotice(parsed.extracted.length > 0 ? `已识别 ${parsed.extracted.length} 项约束，正在请求 AI 校对` : '使用表单约束请求 AI 校对')
    const commitGeneration = (resolvedSpec: GenerationSpec, source: typeof specSource) => {
      if (request !== generationRequest.current) return
      setSpec(resolvedSpec)
      setSpecSource(source)
      const nextCandidates = hasCurrentLine
        ? generateFactoryAdjustments(objects, resolvedSpec, factoryId)
        : generateFactoryCandidates(resolvedSpec, factoryId)
      setCandidates(nextCandidates)
      setSelectedId(nextCandidates[0]?.id ?? null)
      setNotice(`${source === 'rule' || source === 'fallback' ? '规则解析已接管' : `${source.toUpperCase()} 已返回约束`}，${hasCurrentLine ? '完成当前工厂调整评估' : '完成结构校验与副本仿真'}`)
    }
    requestFactorySpec(brief, parsed.spec)
      .then((reply) => commitGeneration(mergeGenerationSpec(parsed.spec, reply.spec), reply.source))
      .catch(() => commitGeneration(parsed.spec, 'fallback'))
  }

  const applyCandidate = () => {
    if (!selectedCandidate || !selectedCandidate.validation.passed) return
    applyLayout(selectedCandidate.objects, selectedCandidate.recipeGraph.recipes, selectedCandidate.recipeGraph.items)
    setNotice(`${selectedCandidate.strategy} 已应用到 ${factoryId.toUpperCase()}，仿真已重置`)
  }

  const previewCandidate = () => {
    if (!selectedCandidate) return
    setSelectedId(selectedCandidate.id)
    setNotice(`${selectedCandidate.strategy} 已在右侧预览，确认后再应用到 ${factoryId.toUpperCase()}`)
  }

  const rollback = () => {
    if (!canUndo) return
    undo()
    setNotice(`已撤销上一版 ${factoryId.toUpperCase()} 布局，仿真已重置`)
  }

  const runWhatIf = (mutation: WhatIfMutation) => {
    if (isWhatIfRunning) return
    setIsWhatIfRunning(true)
    const baseObjects = selectedCandidate?.objects ?? objects
    window.setTimeout(() => {
      try {
        const result = evaluateWhatIf(baseObjects, spec, mutation, factoryId)
        setWhatIf(result)
        setNotice(`What-if 已完成：${result.label}`)
      } finally {
        setIsWhatIfRunning(false)
      }
    }, 0)
  }

  return (
    <section className="fm-generative-workspace" aria-label="Generative Factory AI 工厂生成器">
      <div ref={frameRef} className="fm-generative-frame glass3d">
        <header className="fm-generative-header">
          <div>
            <div className="fm-generative-kicker"><span>04</span> / AI FACTORY DIAGNOSTICS</div>
            <h1>从诊断到调整 <em>{hasCurrentLine ? 'ADJUSTMENT ENGINE' : 'GENERATIVE FACTORY'}</em></h1>
            <p>读取当前工厂状态，优先保留可用设备并修复物流；只有原位不可行时才重建整线。最终指标以副本仿真为准。</p>
          </div>
          <div className={`fm-generative-status ${isGenerating ? 'is-running' : ''}`}>
            <i />
            <b>{isGenerating ? 'GENERATING' : 'DESIGN READY'}</b>
            <small>{notice}</small>
          </div>
        </header>

        <div className="fm-generative-live-strip">
          <div><span>当前场地</span><b>{factoryId.toUpperCase()}</b></div>
          <div><span>诊断状态</span><b className={`is-${liveDiagnostic.status.toLowerCase()}`}>{liveDiagnostic.status}</b></div>
          <div><span>实时吞吐</span><b>{liveDiagnostic.throughputPerHour.toFixed(1)} / H</b></div>
          <div><span>利用率</span><b>{liveDiagnostic.utilization.toFixed(1)}%</b></div>
          <div className="fm-generative-live-note"><i />{liveDiagnostic.recommendation}</div>
        </div>

        <FloorDiagnosticsPanel
          floors={liveDiagnostic.floors}
          selectedFloor={selectedDiagnosticFloor}
          onSelect={setSelectedDiagnosticFloor}
        />

        <div className="fm-generative-grid">
          <section className="fm-generative-card fm-generative-brief glass3d">
            <div className="fm-generative-card-head"><span>01 / REQUIREMENT INPUT</span><b>需求输入</b></div>
            <label className="fm-generative-field">
              <span>自然语言任务</span>
              <textarea value={brief} onChange={(event) => setBrief(event.target.value)} rows={5} />
            </label>
            <div className="fm-generative-field-grid">
              <label className="fm-generative-field"><span>产品</span><input value={spec.product} onChange={(event) => updateSpec('product', event.target.value)} /></label>
              <label className="fm-generative-field"><span>目标产出 / H</span><input type="number" min={1} value={spec.targetThroughputPerHour} onChange={(event) => updateSpec('targetThroughputPerHour', Number(event.target.value) || 1)} /></label>
              <label className="fm-generative-field"><span>场地宽度 / M</span><input type="number" min={10} value={spec.floorWidth} onChange={(event) => updateSpec('floorWidth', Number(event.target.value) || 10)} /></label>
              <label className="fm-generative-field"><span>场地深度 / M</span><input type="number" min={10} value={spec.floorDepth} onChange={(event) => updateSpec('floorDepth', Number(event.target.value) || 10)} /></label>
              <label className="fm-generative-field"><span>CNC 上限</span><input type="number" min={1} value={spec.cncLimit} onChange={(event) => updateSpec('cncLimit', Number(event.target.value) || 1)} /></label>
              <label className="fm-generative-field"><span>AGV 上限</span><input type="number" min={1} value={spec.agvLimit} onChange={(event) => updateSpec('agvLimit', Number(event.target.value) || 1)} /></label>
            </div>
            <label className="fm-generative-field"><span>优化优先级</span><select value={spec.objective} onChange={(event) => updateSpec('objective', event.target.value as GenerationSpec['objective'])}><option value="energy">降低能耗</option><option value="balanced">综合平衡</option><option value="throughput">最大吞吐</option></select></label>
            <div className="fm-generative-field-grid fm-generative-planning-fields">
              <label className="fm-generative-field"><span>搜索轮次</span><input type="number" min={1} max={4} value={spec.searchRounds ?? 2} onChange={(event) => updateSpec('searchRounds', Number(event.target.value) || 1)} /></label>
              <label className="fm-generative-field"><span>电价 / kWh</span><input type="number" min={0} step={0.01} value={spec.economics?.energyPricePerKwh ?? DEFAULT_COST_ASSUMPTIONS.energyPricePerKwh} onChange={(event) => updateEconomics('energyPricePerKwh', Number(event.target.value) || 0)} /></label>
              <label className="fm-generative-field"><span>单位贡献 / 件</span><input type="number" min={0} value={spec.economics?.contributionPerUnit ?? DEFAULT_COST_ASSUMPTIONS.contributionPerUnit} onChange={(event) => updateEconomics('contributionPerUnit', Number(event.target.value) || 0)} /></label>
              <label className="fm-generative-field"><span>月运行 / H</span><input type="number" min={1} value={spec.economics?.operatingHoursPerMonth ?? DEFAULT_COST_ASSUMPTIONS.operatingHoursPerMonth} onChange={(event) => updateEconomics('operatingHoursPerMonth', Number(event.target.value) || 1)} /></label>
            </div>
            <button className="fm-generative-primary" type="button" onClick={generate} disabled={isGenerating}>
              <span>{isGenerating ? '分析中…' : hasCurrentLine ? 'AI ADJUST CURRENT FACTORY' : 'AI GENERATE FACTORY'}</span><b>↗</b>
            </button>
            <div className="fm-generative-input-note"><i /> {specSource.toUpperCase()} → {hasCurrentLine ? 'DIAGNOSE → ADJUSTMENT ENGINE' : 'RECIPE GRAPH → PORT ROUTER'} → SIMULATION</div>
          </section>

          <section className="fm-generative-card fm-generative-stage glass3d">
            <div className="fm-generative-card-head"><span>02 / FACTORY SYNTHESIS</span><b>工厂生成过程</b></div>
            <div className="fm-generative-stage-map">
              <div className="fm-generative-map-grid" />
              <div className="fm-generative-map-cross cross-x" />
              <div className="fm-generative-map-cross cross-y" />
              <div className="fm-generative-map-label label-top">{factoryId.toUpperCase()} / {spec.floorWidth} × {spec.floorDepth} M</div>
              <div className="fm-generative-map-label label-bottom">SPACE / FLOW / STATE</div>
              <div className={`fm-generative-map-signal ${candidates.length ? 'has-candidates' : ''}`}>
                {candidates.length ? <><i /><span>LAYOUT CANDIDATES READY</span></> : <><i /><span>NO GENERATED LAYOUT</span></>}
              </div>
              {selectedCandidate && <CandidateMiniMap candidate={selectedCandidate} />}
            </div>
            <div className="fm-generative-stage-steps">
              {GENERATION_STEPS.map((step, index) => {
                const active = generationStep === index
                const complete = generationStep > index || (!isGenerating && generationStep === GENERATION_STEPS.length - 1)
                return <div key={step} className={`fm-generative-stage-step ${active ? 'is-active' : ''} ${complete ? 'is-complete' : ''}`}><i>{complete ? '✓' : String(index + 1).padStart(2, '0')}</i><span>{step}</span></div>
              })}
            </div>
            <div className="fm-generative-stage-footer"><span>PLANNER STATUS</span><b>{isGenerating ? GENERATION_STEPS[generationStep] : candidates.length ? 'CANDIDATES VERIFIED' : 'IDLE / AWAITING INPUT'}</b></div>
            {selectedCandidate && <div className="fm-generative-graph-summary"><div><span>RECIPE GRAPH</span><b>{selectedCandidate.recipeGraph.nodes.length} 工序 · {selectedCandidate.recipeGraph.edges.length} 条物流边</b></div><div><span>EQUIPMENT PLAN</span><b>{selectedCandidate.equipment.reduce((sum, item) => sum + item.count, 0)} 台设备</b></div><div><span>SEARCH / ROUND</span><b>BEAM {selectedCandidate.searchRound + 1} / {spec.searchRounds ?? 2}</b></div><div><span>BOTTLENECK</span><b>{selectedCandidate.simulation.bottleneck}</b></div></div>}
          </section>

          <aside className="fm-generative-card fm-generative-results glass3d">
            <div className="fm-generative-card-head"><span>03 / TOP 3 SOLUTIONS</span><b>候选方案</b></div>
            {candidates.length === 0 ? <div className="fm-generative-empty"><span>＋</span><b>{hasCurrentLine ? '还没有调整方案' : '还没有生成方案'}</b><small>{hasCurrentLine ? '输入目标后，ForgeMind 会先诊断当前产线，再返回最小调整、重布线和完整重构方案。' : '填写需求后，ForgeMind 会生成并仿真 3 个可比较的布局策略。'}</small></div> : <div className="fm-generative-candidate-list">{candidates.map((candidate, index) => <button type="button" key={candidate.id} className={`fm-generative-candidate glass3d ${selectedId === candidate.id ? 'is-selected' : ''}`} onClick={() => setSelectedId(candidate.id)}><div className="fm-generative-candidate-top"><span>{String(index + 1).padStart(2, '0')}</span><small>{candidate.validation.passed ? 'SIMULATION VERIFIED' : 'REVIEW REQUIRED'}</small><i>{selectedId === candidate.id ? 'SELECTED' : `SCORE ${candidate.score.toFixed(1)}`}</i></div><h3>{candidate.name}</h3><p>{candidate.description}</p><div className="fm-generative-candidate-metrics"><Metric label="THROUGHPUT" value={`${candidate.metrics.throughputPerHour.toFixed(1)} / H`} /><Metric label="UTILIZATION" value={`${candidate.metrics.utilization.toFixed(1)}%`} /><Metric label="ENERGY / UNIT" value={`${candidate.metrics.energyPerUnit.toFixed(1)} kWh`} /><Metric label="LOGISTICS" value={`${candidate.metrics.logisticsEfficiency.toFixed(1)}%`} /><Metric label="PAYBACK" value={candidate.metrics.economics.paybackMonths === null ? '—' : `${candidate.metrics.economics.paybackMonths.toFixed(1)} M`} /></div><div className="fm-generative-candidate-foot"><span>{candidate.simulation.outputUnits} 件成品 / {candidate.simulation.simulatedSeconds}s</span><b>{candidate.simulation.bottleneck}</b></div>{candidate.adjustments.length > 0 && <small className="fm-generative-adjustment-note">{candidate.adjustments.map((action) => action.title).join(' · ')}</small>}<small className="fm-generative-diff-note">Δ +{candidate.diff.added} / −{candidate.diff.removed} · 移动 {candidate.diff.moved} · 改造成本 {candidate.metrics.changeCost.toFixed(1)} · P{candidate.paretoRank}</small>{candidate.equipment.some((item) => item.count > 1) && <small className="fm-generative-scale-note">AUTO SCALE · {candidate.equipment.filter((item) => item.count > 1).map((item) => `${item.nodeId} ×${item.count}`).join(' · ')}</small>}{candidate.warnings.map((warning) => <small className="fm-generative-warning" key={warning}>! {warning}</small>)}</button>)}</div>}
            {selectedCandidate && <div className="fm-generative-comparison"><div><span>LIVE → CANDIDATE</span><b>{liveDiagnostic.throughputPerHour.toFixed(1)} → {selectedCandidate.metrics.throughputPerHour.toFixed(1)} / H</b></div><div><span>ASSETS</span><b>{objects.length} → {selectedCandidate.objects.length}</b></div><div><span>CAPEX / PAYBACK</span><b>¥{Math.round(selectedCandidate.metrics.economics.incrementalCapex).toLocaleString()} · {selectedCandidate.metrics.economics.paybackMonths === null ? '—' : `${selectedCandidate.metrics.economics.paybackMonths.toFixed(1)} M`}</b></div></div>}
            <WhatIfPanel result={whatIf} running={isWhatIfRunning} onRun={runWhatIf} />
            <div className="fm-generative-result-actions"><button type="button" onClick={previewCandidate} disabled={!selectedCandidate || isGenerating}>查看方案</button><button type="button" className="is-primary" onClick={applyCandidate} disabled={!selectedCandidate || isGenerating || !selectedCandidate.validation.passed}>应用到 {factoryId.toUpperCase()}</button><button type="button" onClick={rollback} disabled={!canUndo || isGenerating}>撤销上一版</button></div>
          </aside>
        </div>

        <footer className="fm-generative-footer"><span><i /> {factoryId.toUpperCase()} / AI FACTORY DIAGNOSTICS</span><span>{objects.length.toString().padStart(2, '0')} ASSETS · {liveDiagnostic.openIssues.length} OPEN ISSUES</span><strong>{selectedCandidate ? 'SIMULATION VERIFIED / APPLY AFTER REVIEW' : 'READY FOR DIAGNOSIS'}</strong></footer>
      </div>
    </section>
  )
}

const FLOOR_DIAGNOSTIC_META: Record<number, { name: string; role: string; description: string }> = {
  1: { name: '基础物流层', role: 'RECEIVING / CORE LINE', description: '原料接收、核心加工与成品缓存' },
  2: { name: '工艺制造层', role: 'PROCESS / DRONE SUPPLY', description: '无人机供料的柔性制造单元' },
  3: { name: '装配交付层', role: 'ASSEMBLY / QA', description: '装配、质检与交付前缓冲' },
}

function FloorDiagnosticsPanel({
  floors,
  selectedFloor,
  onSelect,
}: {
  floors: FactoryFloorDiagnostic[]
  selectedFloor: FactoryFloorId | 0
  onSelect: (floorId: FactoryFloorId | 0) => void
}) {
  const selected = selectedFloor === 0 ? null : floors.find((floor) => floor.floorId === selectedFloor) ?? null

  return (
    <section className="fm-floor-diagnostics" aria-label="分楼层诊断">
      <div className="fm-floor-diagnostics-head">
        <div>
          <span>FLOOR SIGNAL / 04</span>
          <h2>分楼层诊断</h2>
          <p>按楼层隔离物流、设备与在途物料状态；生成器仍以全厂链路作为调整基线。</p>
        </div>
        <div className="fm-floor-diagnostics-filters" role="group" aria-label="楼层诊断筛选">
          <button type="button" className={selectedFloor === 0 ? 'is-active' : ''} onClick={() => onSelect(0)} aria-pressed={selectedFloor === 0}>全厂</button>
          {floors.map((floor) => <button key={floor.floorId} type="button" className={selectedFloor === floor.floorId ? 'is-active' : ''} onClick={() => onSelect(floor.floorId)} aria-pressed={selectedFloor === floor.floorId}>L{floor.floorId}</button>)}
        </div>
      </div>

      <div className="fm-floor-diagnostics-grid">
        {floors.map((floor) => {
          const meta = FLOOR_DIAGNOSTIC_META[floor.floorId] ?? { name: `扩展层 ${floor.floorId}`, role: `EXPANSION / L${floor.floorId}`, description: '用户追加的柔性制造与物流空间' }
          const statusClass = `is-${floor.status.toLowerCase()}`
          return (
            <button
              type="button"
              key={floor.floorId}
              className={`fm-floor-diagnostic-card ${statusClass} ${selectedFloor === floor.floorId ? 'is-selected' : ''}`}
              onClick={() => onSelect(floor.floorId)}
              aria-pressed={selectedFloor === floor.floorId}
            >
              <div className="fm-floor-diagnostic-card-top"><span>L{floor.floorId}</span><small>{meta.role}</small><b>{floor.status}</b></div>
              <div className="fm-floor-diagnostic-card-title"><h3>{meta.name}</h3><i /></div>
              <p>{meta.description}</p>
              <div className="fm-floor-diagnostic-metrics">
                <span><em>THROUGHPUT</em><b>{floor.throughputPerHour.toFixed(1)}<small>/H</small></b></span>
                <span><em>UTILIZATION</em><b>{floor.utilization.toFixed(1)}<small>%</small></b></span>
                <span><em>ACTIVE</em><b>{floor.activeMachines}<small>/{floor.machineCount}</small></b></span>
                <span><em>IN TRANSIT</em><b>{floor.itemLots}</b></span>
              </div>
              <div className="fm-floor-diagnostic-health"><span><i style={{ width: `${floor.score}%` }} /></span><b>{floor.score}</b><small>{floor.openIssues.length > 0 ? `${floor.openIssues.length} OPEN ISSUE${floor.openIssues.length > 1 ? 'S' : ''}` : 'LINK STABLE'}</small></div>
            </button>
          )
        })}
      </div>

      {selected && (
        <div className={`fm-floor-diagnostic-detail is-${selected.status.toLowerCase()}`}>
          <div className="fm-floor-diagnostic-detail-kicker"><span>L{selected.floorId} / FOCUS CHANNEL</span><b>{selected.status}</b></div>
          <p>{selected.recommendation}</p>
          <div className="fm-floor-diagnostic-issue-list">
            {selected.openIssues.length > 0 ? selected.openIssues.map((issue) => <span key={issue}><i />{issue}</span>) : <span><i />没有开放问题，楼层可以继续参与生成与仿真。</span>}
          </div>
        </div>
      )}
    </section>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div><span>{label}</span><b>{value}</b></div>
}

function WhatIfPanel({ result, running, onRun }: { result: WhatIfResult | null; running: boolean; onRun: (mutation: WhatIfMutation) => void }) {
  const options: Array<{ mutation: WhatIfMutation; label: string }> = [
    { mutation: 'add-cnc', label: '+ CNC' },
    { mutation: 'add-assembly', label: '+ 装配' },
    { mutation: 'add-agv', label: '+ AGV' },
    { mutation: 'remove-cnc', label: '− CNC' },
  ]
  return <div className="fm-generative-whatif glass3d">
    <div className="fm-generative-whatif-head"><span>WHAT-IF LAB</span><b>{running ? '试算中…' : '变更试算'}</b></div>
    <div className="fm-generative-whatif-actions">{options.map((option) => <button key={option.mutation} type="button" onClick={() => onRun(option.mutation)} disabled={running}>{option.label}</button>)}</div>
    {result && <div className="fm-generative-whatif-result"><div><span>{result.label}</span><b>{formatSigned(result.delta.throughputPerHour)} / H</b></div><div><span>ENERGY / UNIT</span><b>{formatSigned(result.delta.energyPerUnit)} kWh</b></div><div><span>MONTHLY BENEFIT</span><b>¥{Math.round(result.delta.monthlyBenefit).toLocaleString()}</b></div><small>基线 {result.before.metrics.throughputPerHour.toFixed(1)}/h → 试算 {result.after.metrics.throughputPerHour.toFixed(1)}/h · 回本 {result.delta.paybackMonths === null ? '不可估算' : `${result.delta.paybackMonths.toFixed(1)} 个月`}</small></div>}
  </div>
}

function formatSigned(value: number): string {
  return `${value >= 0 ? '+' : ''}${value.toFixed(1)}`
}

function mergeGenerationSpec(base: GenerationSpec, remote: Partial<GenerationSpec>): GenerationSpec {
  const objective = remote.objective === 'balanced' || remote.objective === 'throughput' || remote.objective === 'energy'
    ? remote.objective
    : base.objective
  return {
    product: typeof remote.product === 'string' && remote.product.trim() ? remote.product.trim() : base.product,
    targetThroughputPerHour: validPositiveNumber(remote.targetThroughputPerHour, base.targetThroughputPerHour),
    floorWidth: validPositiveNumber(remote.floorWidth, base.floorWidth),
    floorDepth: validPositiveNumber(remote.floorDepth, base.floorDepth),
    cncLimit: Math.round(validPositiveNumber(remote.cncLimit, base.cncLimit)),
    agvLimit: Math.round(validPositiveNumber(remote.agvLimit, base.agvLimit)),
    objective,
    searchRounds: Math.round(validPositiveNumber(remote.searchRounds, base.searchRounds ?? 2)),
    economics: { ...DEFAULT_COST_ASSUMPTIONS, ...base.economics },
  }
}

function validPositiveNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback
}

function CandidateMiniMap({ candidate }: { candidate: GeneratedCandidate }) {
  const cells = candidate.objects.flatMap(occupiedCells)
  const minX = Math.min(...cells.map((cell) => cell.x), -15) - 1
  const maxX = Math.max(...cells.map((cell) => cell.x), 14) + 1
  const minZ = Math.min(...cells.map((cell) => cell.z), -10) - 1
  const maxZ = Math.max(...cells.map((cell) => cell.z), 9) + 1
  const mapWidth = Math.max(1, maxX - minX)
  const mapDepth = Math.max(1, maxZ - minZ)
  return <div className="fm-generative-mini-layout" aria-label={`${candidate.name} layout preview`}>
    {candidate.objects.map((object) => {
      const isRoute = object.type === 'conveyor'
      const x = ((object.pos.x - minX) / mapWidth) * 100
      const y = ((object.pos.z - minZ) / mapDepth) * 100
      const width = isRoute ? 3.4 : object.type === 'assembler' ? 10 : object.type === 'smelter' ? 8 : 5
      const height = isRoute ? 3.4 : object.type === 'assembler' ? 12 : object.type === 'smelter' ? 8 : 5
      return <i key={object.id} className={`is-${object.type}`} style={{ left: `${x}%`, top: `${y}%`, width: `${width}%`, height: `${height}%`, transform: `rotate(${object.rotation}deg)` } as CSSProperties} />
    })}
  </div>
}
