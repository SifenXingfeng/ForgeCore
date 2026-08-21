import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { loadForgeCoreModelCatalog, type ForgeCoreModelCatalog, type ForgeCoreModelRecord } from '../data/forgecoreModelCatalog'
import { RUNTIME_MATERIAL_LIBRARY, getRuntimeItemModelDefinition, isModelParameterActive, normalizeModelParameterOverrides, type ItemModelParameterSchema } from '../data/itemModelRuntime'
import { CATEGORY_COLORS, CATEGORY_LABELS, type Item, type ItemCategory, type ModelParameters, type ModelParameterValue } from '../game/item'
import { useForgeMindStore } from '../store/forgeMind'
import { ItemModelThumbnail } from './ItemModelThumbnail'
import { ParametricModelPreview } from './ParametricItemModel'
import { WorkbenchModal } from './WorkbenchModal'

type EditorState = { mode: 'create'; modelId?: string } | { mode: 'edit'; item: Item }

const MODEL_CATEGORY_NAMES: Record<string, string> = { basic: '基础形状', material: '工业原料', mechanical: '机械零件', electronic: '电子部件', package: '包装物流' }
const PARAMETER_NAMES: Record<string, string> = {
  materialPreset: '材质预设', color: '主颜色', metalness: '金属度', roughness: '粗糙度', opacity: '不透明度', emission: '自发光颜色', texture: '程序纹理键', length: '长度', width: '宽度', height: '高度', cornerRadius: '倒角半径', bottomDiameter: '底部直径', topDiameter: '顶部直径', sides: '圆周分段', diameter: '直径', hollow: '中空结构', wallThickness: '壁厚', thickness: '厚度', centerHoleDiameter: '中心孔直径', outerDiameter: '外径', innerDiameter: '内径', scaleX: 'X 轴尺寸', scaleY: 'Y 轴尺寸', scaleZ: 'Z 轴尺寸', subdivisions: '细分级别', bodyHeight: '主体高度', bodyDiameter: '主体直径', neckHeight: '瓶颈高度', neckDiameter: '瓶颈直径', capHeight: '封盖高度', shoulderRatio: '肩部比例', bandCount: '加强环数量', lidStyle: '顶盖样式', shape: '结构形状', terminalSize: '端子尺寸', pinCount: '引脚数量', pinStyle: '引脚样式', pinLength: '引脚长度', portCount: '接口数量', portStyle: '接口样式', ledCount: '指示灯数量', bodyLength: '主体长度', shaftLength: '轴伸长度', shaftDiameter: '轴径', baseWidth: '底座宽度', baseHeight: '底座高度', coolingFinCount: '散热片数量', componentCount: '元件数量', connectorCount: '连接器数量', layoutSeed: '布局种子', crossSection: '截面形状', wireDiameter: '线径', coilDiameter: '线圈直径', coilWidth: '线圈宽度', turns: '匝数', openingStyle: '开口样式', ribCount: '加强筋数量', closureStyle: '封口样式', slatCount: '板条数量', closed: '封闭状态', slatThickness: '板条厚度', deckSlatCount: '面板条数量', runnerCount: '底梁数量', deckThicknessRatio: '面板厚度比例', fullness: '填充饱满度', neckRatio: '束口比例', ballCount: '滚珠数量', headDiameter: '头部直径', headHeight: '头部高度', headType: '头部类型', threadBandCount: '螺纹圈数量', boltHoleCount: '螺栓孔数量', boltHoleDiameter: '螺栓孔直径', boltCircleDiameter: '孔中心圆直径', toothCount: '齿数', toothHeight: '齿高', toothWidthRatio: '齿宽比例', endDiameter: '端部直径', steppedEnds: '阶梯端部', stepLength: '阶梯长度', coilCount: '弹簧圈数', segmentsPerCoil: '每圈分段', tireThickness: '轮胎厚度', hubDiameter: '轮毂直径', size: '整体尺寸', irregularity: '不规则度', elongation: '拉伸比例', seed: '形态种子', granuleSize: '颗粒尺寸', particleCount: '颗粒数量', granuleShape: '颗粒形状', spread: '散布范围', sideSlope: '侧面坡度', regularity: '规则程度', endRingCount: '端环数量',
}
const OPTION_NAMES: Record<string, string> = { auto: '自动匹配', closed: '封闭', open: '开启', bung: '桶塞', prismatic: '棱柱形', cylindrical: '圆柱形', gullwing: '鸥翼脚', straight: '直脚', pad: '焊盘', socket: '插座', terminal: '端子', round: '圆形', rectangular: '矩形', i: '工字形', h: 'H 形', u: 'U 形', l: 'L 形', square: '方形', hexagonal: '六边形', top: '顶部', front: '前部', drawer: '抽屉式', sealed: '密封', taped: '胶带封装', hex: '六角', angular: '棱角颗粒', flake: '片状颗粒' }

function parameterLabel(key: string) { return PARAMETER_NAMES[key] ?? key.replace(/([a-z])([A-Z])/gu, '$1 $2') }
function unitLabel(unit: string | null) { return unit === 'm' ? '米' : unit === 'ratio' ? '比例' : unit === 'count' ? '个' : unit ?? '' }
function optionLabel(value: ModelParameterValue) {
  if (typeof value === 'string' && RUNTIME_MATERIAL_LIBRARY[value]) return RUNTIME_MATERIAL_LIBRARY[value].nameZh
  return typeof value === 'string' ? OPTION_NAMES[value] ?? value : String(value)
}
function defaultsFor(modelId: string): ModelParameters {
  const definition = getRuntimeItemModelDefinition(modelId)
  return Object.fromEntries(Object.entries(definition?.parameters ?? {}).map(([key, schema]) => [key, schema.default]))
}

export function ItemPanel() {
  const items = useForgeMindStore((state) => state.items)
  const recipes = useForgeMindStore((state) => state.recipes)
  const objects = useForgeMindStore((state) => state.objects)
  const createItem = useForgeMindStore((state) => state.createItem)
  const updateItem = useForgeMindStore((state) => state.updateItem)
  const removeItem = useForgeMindStore((state) => state.removeItem)
  const [catalog, setCatalog] = useState<ForgeCoreModelCatalog | null>(null)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('all')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [visibleCount, setVisibleCount] = useState(12)
  const [editor, setEditor] = useState<EditorState | null>(null)
  const [pendingDelete, setPendingDelete] = useState<Item | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    loadForgeCoreModelCatalog(controller.signal).then((next) => { setCatalog(next); setSelectedId((current) => current ?? next.models[0]?.id ?? null) }).catch((reason: unknown) => { if (!(reason instanceof Error && reason.name === 'AbortError')) setError('36 个 ForgeCore 模型目录加载失败') })
    return () => controller.abort()
  }, [])
  useEffect(() => setVisibleCount(12), [query, category])

  const models = useMemo(() => (catalog?.models ?? []).filter((model) => (category === 'all' || model.category === category) && `${model.id} ${model.nameZh} ${model.nameEn}`.toLowerCase().includes(query.trim().toLowerCase())), [catalog, category, query])
  const selected = catalog?.models.find((model) => model.id === selectedId) ?? models[0]
  const usageFor = (id: string) => {
    const usage: string[] = []
    if (recipes.some((recipe) => [...recipe.inputs, ...recipe.outputs].some((port) => port.itemId === id))) usage.push('生产路线')
    if (objects.some((object) => object.itemId === id || object.agvProgram?.itemId === id)) usage.push('场景设备')
    return usage
  }

  return <div className="fm-registry-page fm-item-registry">
    <section className="fm-registry-library">
      <header className="fm-registry-section-head"><div><span>BUSINESS ITEM MANAGEMENT</span><h3>已添加物品</h3><p>物品库占据完整工作区；新建与编辑在独立窗口完成。</p></div><div><strong>{items.length}</strong><button type="button" className="primary" disabled={!catalog} onClick={() => setEditor({ mode: 'create', modelId: selected?.id })}>＋ 创建物品</button></div></header>
      {items.length === 0 ? <div className="fm-registry-empty"><b>◇</b><span><strong>物品库为空</strong><small>从下方模型库选择一个模型，或直接点击“创建物品”。</small></span></div> : <div className="fm-business-card-grid">{items.map((item) => { const usage = usageFor(item.id); const model = catalog?.models.find((entry) => entry.id === item.modelId); return <article className="fm-business-card" key={item.id}>
        <div className="fm-business-card-preview"><ItemModelThumbnail item={item} /><span>{Object.keys(item.modelParameters ?? {}).length} 项参数覆盖</span></div>
        <div className="fm-business-card-body"><span>{CATEGORY_LABELS[item.category]}</span><h4>{item.name}</h4><code>{item.id}</code><dl><div><dt>模型</dt><dd>{model?.nameZh ?? item.modelId ?? '颜色方块'}</dd></div><div><dt>质量</dt><dd>{item.massKg ?? 1} kg</dd></div><div><dt>堆叠</dt><dd>{item.maxStackSize ?? 100}</dd></div></dl><p className={usage.length ? 'is-used' : ''}>{usage.length ? `使用中：${usage.join('、')}` : '未被引用，可安全删除'}</p></div>
        <footer><button type="button" onClick={() => setEditor({ mode: 'edit', item })}>编辑</button><button type="button" className="danger" disabled={usage.length > 0} title={usage.length ? `请先解除：${usage.join('、')}` : '删除物品'} onClick={() => setPendingDelete(item)}>删除</button></footer>
      </article>})}</div>}
    </section>

    <section className="fm-model-library-head"><div><span>FORGECORE PARAMETRIC MODEL LIBRARY</span><h3>模型库</h3><p>36 个可参数化模型，先看模型再决定创建什么物品。</p></div><label><span>⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索模型 ID 或名称" /></label></section>
    <div className="fm-model-browser">
      <aside className="fm-model-categories"><span>MODEL CATEGORIES</span><button className={category === 'all' ? 'is-active' : ''} onClick={() => setCategory('all')}>全部模型 <b>{catalog?.modelCount ?? 36}</b></button>{Object.entries(MODEL_CATEGORY_NAMES).map(([id, label]) => <button key={id} className={category === id ? 'is-active' : ''} onClick={() => setCategory(id)}>{label}<b>{catalog?.models.filter((model) => model.category === id).length ?? '—'}</b></button>)}</aside>
      <main className="fm-model-grid-wrap">{!catalog && <div className="fm-registry-empty"><span><strong>正在读取模型目录…</strong></span></div>}<div className="fm-model-grid">{models.slice(0, visibleCount).map((model) => <button type="button" key={model.id} className={`fm-model-card${selected?.id === model.id ? ' is-selected' : ''}`} onClick={() => setSelectedId(model.id)}><img src={`/models/forgecore/items/${model.previewPath}`} alt={`${model.nameZh} 模型预览`} /><span>{MODEL_CATEGORY_NAMES[model.category] ?? model.category}</span><strong>{model.nameZh}</strong><small>{model.nameEn}</small><footer><b>核心可用</b><i>{model.metrics?.triangleCount ?? '—'} tris</i></footer></button>)}</div>{visibleCount < models.length && <button type="button" className="fm-load-more" onClick={() => setVisibleCount((count) => count + 12)}>加载更多模型（剩余 {models.length - visibleCount}）</button>}</main>
      <aside className="fm-model-inspector">{selected ? <><span>MODEL DETAILS</span><h3>{selected.nameZh}</h3><p>{selected.description}</p><div className="fm-model-inspector-preview"><img src={`/models/forgecore/items/${selected.previewPath}`} alt={`${selected.nameZh} 大预览`} /></div><dl><div><dt>Model ID</dt><dd>{selected.id}</dd></div><div><dt>参数等级</dt><dd>Level {selected.parameterizationLevel}</dd></div><div><dt>三角形</dt><dd>{selected.metrics?.triangleCount ?? '—'}</dd></div><div><dt>可调参数</dt><dd>{Object.keys(getRuntimeItemModelDefinition(selected.id)?.parameters ?? {}).length} 项</dd></div></dl><div className="fm-parameter-chips">{Object.keys(getRuntimeItemModelDefinition(selected.id)?.parameters ?? {}).slice(0, 10).map((key) => <i key={key}>{parameterLabel(key)}</i>)}</div><button type="button" className="primary" onClick={() => setEditor({ mode: 'create', modelId: selected.id })}>使用此模型创建物品</button></> : <div className="fm-registry-empty"><span><strong>选择一个模型</strong><small>这里会显示大预览与完整模型资料。</small></span></div>}</aside>
    </div>
    {error && <p className="fm-form-error">{error}</p>}
    {editor && catalog && <ItemEditor key={editor.mode === 'edit' ? editor.item.id : `create-${editor.modelId ?? ''}`} state={editor} models={catalog.models} onClose={() => setEditor(null)} onSave={(item) => { const ok = editor.mode === 'edit' ? updateItem(editor.item.id, item) : createItem(item); if (!ok) return '物品专属 ID 已存在'; setEditor(null); return null }} />}
    {pendingDelete && <WorkbenchModal title="删除业务物品" subtitle="此操作不会删除 ForgeCore 核心模型资产。" onClose={() => setPendingDelete(null)}><div className="fm-confirm-body"><b>!</b><div><h3>确认删除“{pendingDelete.name}”？</h3><p>专属 ID {pendingDelete.id} 将从当前工厂物品库移除。</p></div></div><footer className="fm-modal-actions"><button type="button" onClick={() => setPendingDelete(null)}>取消</button><button type="button" className="danger" onClick={() => { removeItem(pendingDelete.id); setPendingDelete(null) }}>确认删除</button></footer></WorkbenchModal>}
  </div>
}

function ItemEditor({ state, models, onClose, onSave }: { state: EditorState; models: ForgeCoreModelRecord[]; onClose: () => void; onSave: (item: Item) => string | null }) {
  const initial = state.mode === 'edit' ? state.item : undefined
  const initialModelId = initial?.modelId ?? (state.mode === 'create' ? state.modelId : undefined) ?? models[0]?.id ?? 'BASIC_BOX'
  const [draft, setDraft] = useState<Item>(() => initial ? { ...initial, color: typeof initial.modelParameters?.color === 'string' ? initial.modelParameters.color : initial.color, modelParameters: { ...initial.modelParameters } } : { id: '', code: '', name: '新物品', category: 'raw', color: CATEGORY_COLORS.raw, size: 1, description: '', massKg: 1, maxStackSize: 100, modelId: initialModelId, modelPath: models.find((model) => model.id === initialModelId)?.relativePath, modelParameters: {} })
  const [parameters, setParameters] = useState<ModelParameters>(() => ({ ...defaultsFor(initialModelId), ...(initial?.modelParameters ?? {}) }))
  const [overrides, setOverrides] = useState<ModelParameters>(() => ({ ...(initial?.modelParameters ?? {}) }))
  const [error, setError] = useState('')
  const model = models.find((entry) => entry.id === draft.modelId) ?? models[0]
  const definition = getRuntimeItemModelDefinition(model?.id)
  const appearanceParameters = useMemo(() => ({ ...overrides, color: draft.color }), [draft.color, overrides])
  const structural = Object.entries(definition?.parameters ?? {}).filter(([, schema]) => schema.affects.some((affect) => ['geometry', 'topology', 'bounds'].includes(affect)))
  const material = Object.entries(definition?.parameters ?? {}).filter(([, schema]) => !schema.affects.some((affect) => ['geometry', 'topology', 'bounds'].includes(affect)))
  const patch = (value: Partial<Item>) => setDraft((current) => ({ ...current, ...value }))
  const changeModel = (modelId: string) => { const next = models.find((entry) => entry.id === modelId); const defaults = defaultsFor(modelId); patch({ modelId, modelPath: next?.relativePath, modelParameters: {}, color: typeof defaults.color === 'string' ? defaults.color : draft.color }); setParameters(defaults); setOverrides({}) }
  const updateParameter = (key: string, value: ModelParameterValue) => { setParameters((current) => ({ ...current, [key]: value })); setOverrides((current) => ({ ...current, [key]: value })); if (key === 'color' && typeof value === 'string') patch({ color: value }) }
  const save = () => {
    if (!draft.id.trim() || !draft.name.trim()) return setError('专属 ID 和物品名称不能为空')
    const normalized: Item = { ...draft, id: draft.id.trim(), code: draft.code?.trim() || draft.id.trim(), name: draft.name.trim(), description: draft.description?.trim(), note: draft.description?.trim(), massKg: Math.max(0, Number(draft.massKg) || 0), maxStackSize: Math.max(1, Math.round(Number(draft.maxStackSize) || 1)), modelId: model.id, modelPath: model.relativePath, modelParameters: normalizeModelParameterOverrides(model.id, appearanceParameters) }
    const nextError = onSave(normalized); if (nextError) setError(nextError)
  }
  return <WorkbenchModal title={initial ? '编辑业务物品' : '创建业务物品'} subtitle="业务属性与模型参数分开维护；参数变化会立即重建左侧三维模型。" wide onClose={onClose}>
    <div className="fm-item-builder">
      <section className="fm-item-builder-identity"><ParametricModelPreview modelId={model.id} parameters={appearanceParameters} label={draft.name || model.nameZh} /><div className="fm-builder-model-summary"><span>{model.nameZh}</span><code>{model.id}</code><strong>{Object.keys(appearanceParameters).length} 项参数已修改</strong></div>
        <div className="fm-form-grid"><Field label="专属 ID"><input value={draft.id} onChange={(event) => patch({ id: event.target.value })} placeholder="ITEM_SHAFT_001" /></Field><Field label="业务编码"><input value={draft.code ?? ''} onChange={(event) => patch({ code: event.target.value })} placeholder="默认等于专属 ID" /></Field><Field label="物品名称"><input value={draft.name} onChange={(event) => patch({ name: event.target.value })} /></Field><Field label="物品分类"><select value={draft.category} onChange={(event) => { const category = event.target.value as ItemCategory; const color = CATEGORY_COLORS[category]; patch({ category, color }); setOverrides((current) => ({ ...current, color })); setParameters((current) => ({ ...current, color })) }}>{(Object.keys(CATEGORY_LABELS) as ItemCategory[]).map((id) => <option key={id} value={id}>{CATEGORY_LABELS[id]}</option>)}</select></Field><Field label="基础模型"><select value={model.id} onChange={(event) => changeModel(event.target.value)}>{models.map((entry) => <option key={entry.id} value={entry.id}>{entry.nameZh} · {entry.id}</option>)}</select></Field><Field label="显示颜色"><input type="color" value={draft.color} onChange={(event) => updateParameter('color', event.target.value)} /></Field><Field label="单位质量 / kg"><input type="number" min="0" step="0.01" value={draft.massKg ?? 1} onChange={(event) => patch({ massKg: Number(event.target.value) })} /></Field><Field label="最大堆叠数"><input type="number" min="1" step="1" value={draft.maxStackSize ?? 100} onChange={(event) => patch({ maxStackSize: Number(event.target.value) })} /></Field></div>
        <Field label="物品说明"><textarea rows={3} value={draft.description ?? ''} onChange={(event) => patch({ description: event.target.value })} /></Field><p className="fm-builder-note">质量和堆叠属于业务属性，不改变网格；右侧参数作用于场景中的真实物品模型。</p>
      </section>
      <section className="fm-item-builder-parameters"><header><div><span>PARAMETRIC MODEL</span><h3>建模参数</h3><p>已完整读取此模型的 schema，共 {Object.keys(definition?.parameters ?? {}).length} 项。</p></div><button type="button" onClick={() => { const defaults = defaultsFor(model.id); setParameters(defaults); setOverrides({}); if (typeof defaults.color === 'string') patch({ color: defaults.color }) }}>↻ 恢复默认</button></header><ParameterSection title="结构与几何" entries={structural} parameters={parameters} onChange={updateParameter} /><ParameterSection title="材质与表现" entries={material} parameters={parameters} onChange={updateParameter} /></section>
    </div>{error && <p className="fm-form-error fm-modal-error">{error}</p>}<footer className="fm-modal-actions"><button type="button" onClick={onClose}>取消</button><button type="button" className="primary" onClick={save}>{initial ? '保存更改' : '加入物品库'}</button></footer>
  </WorkbenchModal>
}

function ParameterSection({ title, entries, parameters, onChange }: { title: string; entries: Array<[string, ItemModelParameterSchema]>; parameters: ModelParameters; onChange: (key: string, value: ModelParameterValue) => void }) {
  if (!entries.length) return null
  return <section className="fm-parameter-section"><h4>{title}<span>{entries.length}</span></h4><div className="fm-parameter-grid">{entries.map(([key, schema]) => <ParameterControl key={key} parameterKey={key} schema={schema} value={parameters[key] ?? schema.default} parameters={parameters} onChange={(value) => onChange(key, value)} />)}</div></section>
}

function ParameterControl({ parameterKey, schema, value, parameters, onChange }: { parameterKey: string; schema: ItemModelParameterSchema; value: ModelParameterValue; parameters: ModelParameters; onChange: (value: ModelParameterValue) => void }) {
  const active = isModelParameterActive(schema, parameters)
  const dependency = schema.activeWhen ? Object.entries(schema.activeWhen).map(([key, expected]) => `${parameterLabel(key)} = ${optionLabel(expected)}`).join('、') : ''
  const heading = <span className="fm-parameter-heading"><strong>{parameterLabel(parameterKey)}</strong><code>{parameterKey}</code>{schema.unit && <small>{unitLabel(schema.unit)}</small>}</span>
  if (schema.type === 'boolean') return <div className={`fm-parameter-field${active ? '' : ' is-disabled'}`}>{heading}<button type="button" role="switch" aria-checked={Boolean(value)} disabled={!active} className={`fm-parameter-switch${value ? ' is-on' : ''}`} onClick={() => onChange(!value)}><i /><span>{value ? '已启用' : '已关闭'}</span></button>{!active && <em>需满足：{dependency}</em>}</div>
  if (schema.type === 'enum') return <label className={`fm-parameter-field${active ? '' : ' is-disabled'}`}>{heading}<select disabled={!active} value={String(value)} onChange={(event) => onChange(schema.options?.find((candidate) => String(candidate) === event.target.value) ?? schema.default)}>{schema.options?.map((option) => <option key={String(option)} value={String(option)}>{optionLabel(option)}</option>)}</select>{!active && <em>需满足：{dependency}</em>}</label>
  if (schema.type === 'color') return <label className={`fm-parameter-field${active ? '' : ' is-disabled'}`}>{heading}<span className="fm-parameter-color"><input type="color" disabled={!active} value={typeof value === 'string' ? value.slice(0, 7) : '#808080'} onChange={(event) => onChange(event.target.value)} /><input type="text" disabled={!active} value={String(value)} onChange={(event) => onChange(event.target.value)} /></span>{!active && <em>需满足：{dependency}</em>}</label>
  if (schema.type === 'string') return <label className={`fm-parameter-field${active ? '' : ' is-disabled'}`}>{heading}<input disabled={!active} value={String(value ?? '')} placeholder={parameterKey === 'texture' ? '输入程序纹理键（可留空）' : ''} onChange={(event) => onChange(event.target.value)} />{parameterKey === 'texture' && <em>相同键复用同一程序纹理，不读取网络地址。</em>}{!active && <em>需满足：{dependency}</em>}</label>
  const numeric = Number(value)
  return <label className={`fm-parameter-field${active ? '' : ' is-disabled'}`}>{heading}<span className="fm-parameter-number">{schema.min !== null && schema.max !== null && <input aria-label={`${parameterLabel(parameterKey)}滑块`} type="range" disabled={!active} min={schema.min} max={schema.max} step={schema.step ?? 'any'} value={numeric} onChange={(event) => onChange(schema.type === 'integer' ? Math.round(Number(event.target.value)) : Number(event.target.value))} />}<input aria-label={parameterLabel(parameterKey)} type="number" disabled={!active} min={schema.min ?? undefined} max={schema.max ?? undefined} step={schema.type === 'integer' ? schema.step ?? 1 : 'any'} value={numeric} onChange={(event) => onChange(schema.type === 'integer' ? Math.round(Number(event.target.value)) : Number(event.target.value))} /></span><span className="fm-parameter-range">{schema.min ?? '—'} – {schema.max ?? '—'} {unitLabel(schema.unit)}</span>{!active && <em>需满足：{dependency}</em>}</label>
}

function Field({ label, children }: { label: string; children: ReactNode }) { return <label className="fm-manufacturing-field"><span>{label}</span>{children}</label> }
