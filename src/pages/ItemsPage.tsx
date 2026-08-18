import { useEffect, useMemo, useState } from 'react'
import { Box, Check, PackageOpen, Pencil, Plus, RotateCcw, Search, SlidersHorizontal, Trash2 } from 'lucide-react'
import { ModelPreview } from '../components/factory/ModelPreview'
import { ParametricModelPreview } from '../components/factory/ParametricItemModel'
import { Modal, StatusBadge } from '../components/ui'
import {
  RUNTIME_MATERIAL_LIBRARY,
  isModelParameterActive,
  normalizeModelParameterOverrides,
  type ItemModelParameterSchema,
} from '../data/itemModelRuntime'
import { useForgeStore } from '../store/useForgeStore'
import type { Item, ItemCategory, ModelParameters, ModelParameterValue } from '../types'

interface ItemModelRecord {
  id: string
  nameZh: string
  nameEn: string
  category: string
  previewPath: string
  relativePath: string
  description: string
  parameterizationLevel: number
  parameters: Record<string, ItemModelParameterSchema>
  metrics: { triangleCount: number }
}

interface ItemModelCatalog { modelCount: number; models: ItemModelRecord[] }

type ItemEditorState =
  | { mode: 'create'; initialModelId?: string }
  | { mode: 'edit'; item: Item }

const categoryNames: Record<string, string> = { basic: '基础形状', material: '工业原料', mechanical: '机械零件', electronic: '电子部件', package: '包装物流' }

const parameterNames: Record<string, string> = {
  materialPreset: '材质预设', color: '主颜色', metalness: '金属度', roughness: '粗糙度', opacity: '不透明度', emission: '自发光颜色', texture: '程序纹理键',
  length: '长度', width: '宽度', height: '高度', cornerRadius: '倒角半径', bottomDiameter: '底部直径', topDiameter: '顶部直径', sides: '圆周分段', diameter: '直径', hollow: '中空结构', wallThickness: '壁厚', thickness: '厚度', centerHoleDiameter: '中心孔直径', outerDiameter: '外径', innerDiameter: '内径',
  scaleX: 'X 轴尺寸', scaleY: 'Y 轴尺寸', scaleZ: 'Z 轴尺寸', subdivisions: '细分级别', bodyHeight: '主体高度', bodyDiameter: '主体直径', neckHeight: '瓶颈高度', neckDiameter: '瓶颈直径', capHeight: '封盖高度', shoulderRatio: '肩部比例', bandCount: '加强环数量', lidStyle: '顶盖样式', shape: '结构形状', terminalSize: '端子尺寸', pinCount: '引脚数量', pinStyle: '引脚样式', pinLength: '引脚长度', portCount: '接口数量', portStyle: '接口样式', ledCount: '指示灯数量',
  bodyLength: '主体长度', shaftLength: '轴伸长度', shaftDiameter: '轴径', baseWidth: '底座宽度', baseHeight: '底座高度', coolingFinCount: '散热片数量', componentCount: '元件数量', connectorCount: '连接器数量', layoutSeed: '布局种子', crossSection: '截面形状', wireDiameter: '线径', coilDiameter: '线圈直径', coilWidth: '线圈宽度', turns: '匝数', openingStyle: '开口样式', ribCount: '加强筋数量', closureStyle: '封口样式',
  slatCount: '板条数量', closed: '封闭状态', slatThickness: '板条厚度', deckSlatCount: '面板条数量', runnerCount: '底梁数量', deckThicknessRatio: '面板厚度比例', fullness: '填充饱满度', neckRatio: '束口比例', ballCount: '滚珠数量', headDiameter: '头部直径', headHeight: '头部高度', headType: '头部类型', threadBandCount: '螺纹圈数量', boltHoleCount: '螺栓孔数量', boltHoleDiameter: '螺栓孔直径', boltCircleDiameter: '孔中心圆直径', toothCount: '齿数', toothHeight: '齿高', toothWidthRatio: '齿宽比例', endDiameter: '端部直径', steppedEnds: '阶梯端部', stepLength: '阶梯长度', coilCount: '弹簧圈数', segmentsPerCoil: '每圈分段', tireThickness: '轮胎厚度', hubDiameter: '轮毂直径',
  size: '整体尺寸', irregularity: '不规则度', elongation: '拉伸比例', seed: '形态种子', granuleSize: '颗粒尺寸', particleCount: '颗粒数量', granuleShape: '颗粒形状', spread: '散布范围', sideSlope: '侧面坡度', regularity: '规则程度', endRingCount: '端环数量',
}

const optionNames: Record<string, string> = {
  auto: '自动匹配', closed: '封闭', open: '开启', bung: '桶塞', prismatic: '棱柱形', cylindrical: '圆柱形', gullwing: '鸥翼脚', straight: '直脚', pad: '焊盘', socket: '插座', terminal: '端子', round: '圆形', rectangular: '矩形', i: '工字形', h: 'H 形', u: 'U 形', l: 'L 形', square: '方形', hexagonal: '六边形', top: '顶部', front: '前部', drawer: '抽屉式', sealed: '密封', taped: '胶带封装', hex: '六角', angular: '棱角颗粒', flake: '片状颗粒',
}

function modelDefaultParameters(model: ItemModelRecord | undefined): ModelParameters {
  return Object.fromEntries(Object.entries(model?.parameters ?? {}).map(([key, schema]) => [key, schema.default]))
}

function parameterLabel(key: string): string {
  return parameterNames[key] ?? key.replace(/([a-z])([A-Z])/gu, '$1 $2')
}

function unitLabel(unit: string | null): string {
  if (unit === 'm') return '米'
  if (unit === 'ratio') return '比例'
  if (unit === 'count') return '个'
  return unit ?? ''
}

function optionLabel(value: ModelParameterValue): string {
  if (typeof value === 'string' && RUNTIME_MATERIAL_LIBRARY[value]) return RUNTIME_MATERIAL_LIBRARY[value].nameZh
  return typeof value === 'string' ? optionNames[value] ?? value : String(value)
}

export function ItemsPage() {
  const { items, recipes, inventory, objects, simulation, upsertItem, removeItem } = useForgeStore()
  const [catalog, setCatalog] = useState<ItemModelCatalog | null>(null)
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('all')
  const [selected, setSelected] = useState<ItemModelRecord | null>(null)
  const [itemEditor, setItemEditor] = useState<ItemEditorState | null>(null)
  const [pendingDelete, setPendingDelete] = useState<Item | null>(null)
  const [visibleCount, setVisibleCount] = useState(12)

  useEffect(() => {
    fetch('/3d/core/items/v1/catalog.json').then((response) => response.json()).then(setCatalog).catch(() => setCatalog(null))
  }, [])
  const models = useMemo(() => (catalog?.models ?? []).filter((model) => (category === 'all' || model.category === category) && `${model.id} ${model.nameZh} ${model.nameEn}`.toLowerCase().includes(query.toLowerCase())), [catalog, category, query])
  useEffect(() => { setVisibleCount(12) }, [category, query])
  const visibleModels = models.slice(0, visibleCount)

  return (
    <div className="page">
      <header className="page-heading">
        <div><span className="eyebrow">ITEM & MODEL REGISTRY</span><h1>物品与模型库</h1><p>以 36 个 ForgeCore 原创参数化模型定义原料、半成品和产品。业务属性与视觉参数保持分离。</p></div>
        <button className="button button--primary" disabled={!catalog} onClick={() => setItemEditor({ mode: 'create', initialModelId: selected?.id })}><Plus size={16} />创建物品</button>
      </header>
      <BusinessItemLibrary
        items={items}
        models={catalog?.models ?? []}
        usageForItem={(itemId) => {
          const usage: string[] = []
          if (recipes.some((recipe) => recipe.inputs.some((line) => line.itemId === itemId) || recipe.outputs.some((line) => line.itemId === itemId))) usage.push('配方')
          if (inventory.some((record) => record.itemId === itemId && (
            record.quantity > 0
            || record.infiniteSupply
            || record.reservedOutboundQuantity > 0
            || record.reservedInboundCapacity > 0
            || (record.reservedQuantity ?? 0) > 0
          ))) usage.push('库存')
          if (objects.some((object) => object.config.kind === 'vehicle' && object.config.agvProgram?.itemId === itemId)) usage.push('AGV 程序')
          if (Object.values(simulation.agvRuntime ?? {}).some((runtime) => runtime.cargoItemId === itemId && runtime.cargoQuantity > 0)) usage.push('AGV 车载')
          return usage
        }}
        onEdit={(item) => setItemEditor({ mode: 'edit', item })}
        onDelete={setPendingDelete}
      />
      <div className="items-layout">
        <aside className="items-sidebar panel">
          <div className="panel__body">
            <span className="eyebrow">MODEL CATEGORIES</span>
            <h3>模型分类</h3>
            <nav className="category-nav">
              <button className={category === 'all' ? 'is-active' : ''} onClick={() => setCategory('all')}><Box />全部模型 <span>{catalog?.modelCount ?? 36}</span></button>
              {Object.entries(categoryNames).map(([id, label]) => <button className={category === id ? 'is-active' : ''} key={id} onClick={() => setCategory(id)}><span className="category-mark" />{label}<span>{catalog?.models.filter((model) => model.category === id).length ?? '—'}</span></button>)}
            </nav>
            <div className="item-business-summary"><span className="eyebrow">BUSINESS ITEMS</span><strong>{items.length}</strong><p>个业务物品引用当前模型库</p></div>
          </div>
        </aside>
        <main className="items-main">
          <div className="toolbar-row">
            <label className="search-field"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索模型 ID 或名称" /></label>
            <span className="toolbar-count">显示 {visibleModels.length} / {models.length} 项</span>
          </div>
          {!catalog && <div className="loading-card">正在读取已审计模型目录…</div>}
          <div className="model-grid">
            {visibleModels.map((model) => (
              <button className={`model-card ${selected?.id === model.id ? 'is-selected' : ''}`} key={model.id} onClick={() => setSelected(model)}>
                <ModelPreview src={`/3d/core/items/v1/${model.previewPath}`} alt={`${model.nameZh} 模型预览`} />
                <div className="model-card__content"><span className="model-card__category">{categoryNames[model.category]}</span><h3>{model.nameZh}</h3><p>{model.nameEn}</p><div><StatusBadge tone="success">核心可用</StatusBadge><small>{model.metrics.triangleCount} tris</small></div></div>
                {selected?.id === model.id && <span className="model-card__check"><Check size={14} /></span>}
              </button>
            ))}
          </div>
          {visibleCount < models.length && <div className="model-load-more"><button className="button button--secondary" onClick={() => setVisibleCount((count) => Math.min(models.length, count + 12))}>加载更多模型（剩余 {models.length - visibleCount}）</button></div>}
        </main>
        <aside className="model-inspector panel">
          <div className="panel__body">
            {selected ? <ModelInspector model={selected} onUse={() => setItemEditor({ mode: 'create', initialModelId: selected.id })} /> : <div className="inspector-placeholder"><SlidersHorizontal /><h3>选择一个模型</h3><p>查看参数 schema、几何预算与运行时契约。</p></div>}
          </div>
        </aside>
      </div>
      {itemEditor && <ItemEditorModal
        key={itemEditor.mode === 'edit' ? itemEditor.item.id : `create-${itemEditor.initialModelId ?? 'default'}`}
        models={catalog?.models ?? []}
        initialModel={itemEditor.mode === 'create' ? itemEditor.initialModelId : undefined}
        initialItem={itemEditor.mode === 'edit' ? itemEditor.item : undefined}
        onClose={() => setItemEditor(null)}
        onSave={(payload) => { if (upsertItem(payload)) setItemEditor(null) }}
      />}
      {pendingDelete && <DeleteItemModal
        item={pendingDelete}
        onClose={() => setPendingDelete(null)}
        onConfirm={() => { if (removeItem(pendingDelete.id)) setPendingDelete(null) }}
      />}
    </div>
  )
}

function BusinessItemLibrary({
  items,
  models,
  usageForItem,
  onEdit,
  onDelete,
}: {
  items: Item[]
  models: ItemModelRecord[]
  usageForItem: (itemId: string) => string[]
  onEdit: (item: Item) => void
  onDelete: (item: Item) => void
}) {
  return (
    <section className="business-item-library panel" aria-label="已添加物品管理">
      <header>
        <div><span className="eyebrow">BUSINESS ITEM MANAGEMENT</span><h2>已添加物品</h2><p>编辑业务字段或重新生成参数模型；引用中的物品受到删除保护。</p></div>
        <strong>{items.length}</strong>
      </header>
      {items.length === 0 ? (
        <div className="business-item-library__empty"><PackageOpen /><div><strong>还没有业务物品</strong><span>从下方模型库选择基础模型，或直接使用右上角“创建物品”。</span></div></div>
      ) : (
        <div className="business-item-grid">
          {items.map((item) => {
            const model = models.find((candidate) => candidate.id === item.itemModelId)
            const usage = usageForItem(item.id)
            return (
              <article className="business-item-card" key={item.id}>
                <div className="business-item-card__preview">
                  {model ? <ModelPreview src={`/3d/core/items/v1/${model.previewPath}`} alt={`${item.name} 模型预览`} /> : <PackageOpen />}
                  <span>{Object.keys(item.modelParameters).length} 项参数覆盖</span>
                </div>
                <div className="business-item-card__body">
                  <span className="business-item-card__category">{item.category === 'raw-material' ? '原材料' : item.category === 'finished-good' ? '成品' : '在制品'}</span>
                  <h3>{item.name}</h3>
                  <code>{item.code}</code>
                  <dl><div><dt>模型</dt><dd>{model?.nameZh ?? item.itemModelId}</dd></div><div><dt>质量</dt><dd>{item.massKg}kg</dd></div><div><dt>堆叠</dt><dd>{item.maxStackSize}</dd></div></dl>
                  <p className={usage.length > 0 ? 'is-referenced' : ''}>{usage.length > 0 ? `使用中：${usage.join('、')}` : '未被引用，可安全删除'}</p>
                </div>
                <footer>
                  <button type="button" className="button button--secondary button--compact" aria-label={`编辑物品 ${item.name}`} onClick={() => onEdit(item)}><Pencil size={14} />编辑</button>
                  <button type="button" className="button button--danger button--compact" aria-label={`删除物品 ${item.name}`} disabled={usage.length > 0} title={usage.length > 0 ? `请先解除：${usage.join('、')}` : undefined} onClick={() => onDelete(item)}><Trash2 size={14} />删除</button>
                </footer>
              </article>
            )
          })}
        </div>
      )}
    </section>
  )
}

function ModelInspector({ model, onUse }: { model: ItemModelRecord; onUse: () => void }) {
  const parameters = Object.entries(model.parameters).filter(([name]) => !['texture', 'emission'].includes(name)).slice(0, 8)
  return <><span className="eyebrow">MODEL DETAILS</span><h2>{model.nameZh}</h2><p className="muted">{model.description}</p><div className="inspector-preview"><ModelPreview src={`/3d/core/items/v1/${model.previewPath}`} alt={model.nameZh} /></div><dl className="detail-list"><div><dt>Model ID</dt><dd>{model.id}</dd></div><div><dt>参数等级</dt><dd>Level {model.parameterizationLevel}</dd></div><div><dt>三角形</dt><dd>{model.metrics.triangleCount}</dd></div><div><dt>格式</dt><dd>GLB 2.0</dd></div></dl><h3 className="section-title">可调参数</h3><div className="parameter-chips">{parameters.map(([name]) => <span key={name}>{parameterLabel(name)}</span>)}</div><button className="button button--primary button--full" onClick={onUse}>使用此模型创建物品</button></>
}

function ItemEditorModal({ models, initialModel, initialItem, onClose, onSave }: { models: ItemModelRecord[]; initialModel?: string; initialItem?: Item; onClose: () => void; onSave: (item: Item) => void }) {
  const initialModelId = initialItem?.itemModelId ?? initialModel ?? models[0]?.id ?? 'BASIC_BOX'
  const initialSelectedModel = models.find((model) => model.id === initialModelId) ?? models[0]
  const initialOverrides = initialItem ? normalizeModelParameterOverrides(initialModelId, initialItem.modelParameters) : {}
  const [name, setName] = useState(initialItem?.name ?? '新物品')
  const [code, setCode] = useState(initialItem?.code ?? `ITEM-${Date.now().toString().slice(-4)}`)
  const [description, setDescription] = useState(initialItem?.description ?? '')
  const [modelId, setModelId] = useState(initialModelId)
  const [category, setCategory] = useState<ItemCategory>(initialItem?.category ?? 'work-in-progress')
  const [massKg, setMassKg] = useState(initialItem?.massKg ?? 1)
  const [maxStackSize, setMaxStackSize] = useState(initialItem?.maxStackSize ?? 20)
  const selectedModel = models.find((model) => model.id === modelId) ?? models[0]
  const [parameters, setParameters] = useState<ModelParameters>(() => ({ ...modelDefaultParameters(initialSelectedModel), ...initialOverrides }))
  const [parameterOverrides, setParameterOverrides] = useState<ModelParameters>(initialOverrides)

  const overrides = useMemo(() => normalizeModelParameterOverrides(modelId, parameterOverrides), [modelId, parameterOverrides])
  const structuralParameters = Object.entries(selectedModel?.parameters ?? {}).filter(([, schema]) => schema.affects.some((affect) => ['geometry', 'topology', 'bounds'].includes(affect)))
  const materialParameters = Object.entries(selectedModel?.parameters ?? {}).filter(([, schema]) => !schema.affects.some((affect) => ['geometry', 'topology', 'bounds'].includes(affect)))
  const updateParameter = (key: string, value: ModelParameterValue) => {
    setParameters((current) => ({ ...current, [key]: value }))
    setParameterOverrides((current) => ({ ...current, [key]: value }))
  }
  const changeModel = (nextModelId: string) => {
    const nextModel = models.find((model) => model.id === nextModelId)
    setModelId(nextModelId)
    setParameters(modelDefaultParameters(nextModel))
    setParameterOverrides({})
  }

  return (
    <Modal title={initialItem ? '编辑业务物品' : '创建业务物品'} wide onClose={onClose}>
      <form className="item-builder" onSubmit={(event) => {
        event.preventDefault()
        if (!selectedModel) return
        onSave({ id: initialItem?.id ?? `item-${Date.now()}`, name, code, category, description: description.trim() || `${name.trim()}的业务物品定义`, itemModelId: modelId, modelParameters: overrides, icon: initialItem?.icon ?? null, massKg, maxStackSize })
      }}>
        <section className="item-builder__identity">
          <ParametricModelPreview modelId={modelId} parameters={overrides} label={name || selectedModel?.nameZh || '物品'} />
          <div className="item-builder__model-summary">
            <span>{selectedModel?.nameZh}</span><code>{modelId}</code><strong>{Object.keys(overrides).length} 项参数已修改</strong>
          </div>
          <div className="form-grid item-builder__business-fields">
            <label>物品名称<input value={name} onChange={(event) => setName(event.target.value)} required /></label>
            <label>物品编码<input value={code} onChange={(event) => setCode(event.target.value)} required /></label>
            <label>业务分类<select value={category} onChange={(event) => setCategory(event.target.value as ItemCategory)}><option value="raw-material">原材料</option><option value="work-in-progress">在制品</option><option value="finished-good">成品</option></select></label>
            <label>基础模型<select value={modelId} onChange={(event) => changeModel(event.target.value)}>{models.map((model) => <option key={model.id} value={model.id}>{model.nameZh} · {model.id}</option>)}</select></label>
            <label>单位质量（kg）<input type="number" min={0} step={0.1} value={massKg} onChange={(event) => setMassKg(Number(event.target.value))} /></label>
            <label>最大堆叠数<input type="number" min={1} step={1} value={maxStackSize} onChange={(event) => setMaxStackSize(Number(event.target.value))} /></label>
            <label className="item-builder__description">物品描述<textarea value={description} rows={3} onChange={(event) => setDescription(event.target.value)} placeholder="说明该物品的业务用途或工艺含义" /></label>
          </div>
          <div className="form-note">质量与最大堆叠数属于 Item 业务属性，不会改变模型网格。右侧参数会实时重建预览，并作用于传送带和 AGV 车载物品实例。编辑会保留 Item ID 与现有引用。</div>
        </section>
        <section className="item-builder__parameters">
          <header><div><span className="eyebrow">PARAMETRIC MODEL</span><h3>建模参数</h3><p>数值会按模型 schema 自动限幅；条件参数仅在依赖成立时生效。</p></div><button type="button" className="button button--secondary button--compact" onClick={() => { setParameters(modelDefaultParameters(selectedModel)); setParameterOverrides({}) }}><RotateCcw size={14} />恢复默认</button></header>
          <ParameterSection title="结构与几何" entries={structuralParameters} parameters={parameters} onChange={updateParameter} />
          <ParameterSection title="材质与表现" entries={materialParameters} parameters={parameters} onChange={updateParameter} />
        </section>
        <footer className="modal__footer item-builder__footer"><button type="button" className="button button--secondary" onClick={onClose}>取消</button><button className="button button--primary" disabled={!selectedModel}>{initialItem ? '保存更改' : '创建物品'}</button></footer>
      </form>
    </Modal>
  )
}

function DeleteItemModal({ item, onClose, onConfirm }: { item: Item; onClose: () => void; onConfirm: () => void }) {
  return (
    <Modal title="删除业务物品" onClose={onClose}>
      <div className="item-delete-confirm">
        <Trash2 />
        <div><strong>确认删除“{item.name}”？</strong><p>编码 {item.code} 及其无引用的零库存记录将一并删除。此操作不会删除核心模型资产。</p></div>
      </div>
      <footer className="modal__footer"><button type="button" className="button button--secondary" onClick={onClose}>取消</button><button type="button" className="button button--danger" onClick={onConfirm}>确认删除</button></footer>
    </Modal>
  )
}

function ParameterSection({ title, entries, parameters, onChange }: { title: string; entries: Array<[string, ItemModelParameterSchema]>; parameters: ModelParameters; onChange: (key: string, value: ModelParameterValue) => void }) {
  if (entries.length === 0) return null
  return (
    <div className="model-parameter-section">
      <h4>{title}<span>{entries.length}</span></h4>
      <div className="model-parameter-grid">
        {entries.map(([key, schema]) => <ParameterControl key={key} parameterKey={key} schema={schema} value={parameters[key] ?? schema.default} parameters={parameters} onChange={(value) => onChange(key, value)} />)}
      </div>
    </div>
  )
}

function ParameterControl({ parameterKey, schema, value, parameters, onChange }: { parameterKey: string; schema: ItemModelParameterSchema; value: ModelParameterValue; parameters: ModelParameters; onChange: (value: ModelParameterValue) => void }) {
  const active = isModelParameterActive(schema, parameters)
  const dependency = schema.activeWhen ? Object.entries(schema.activeWhen).map(([key, expected]) => `${parameterLabel(key)} = ${optionLabel(expected)}`).join('、') : null
  const heading = <span className="model-parameter-field__heading"><strong>{parameterLabel(parameterKey)}</strong><code>{parameterKey}</code>{schema.unit && <small>{unitLabel(schema.unit)}</small>}</span>

  if (schema.type === 'boolean') {
    return <div className={`model-parameter-field ${active ? '' : 'is-disabled'}`}>{heading}<button type="button" role="switch" aria-checked={Boolean(value)} disabled={!active} className={`parameter-switch ${value ? 'is-on' : ''}`} onClick={() => onChange(!value)}><i /><span>{value ? '已启用' : '已关闭'}</span></button>{!active && <em>需满足：{dependency}</em>}</div>
  }
  if (schema.type === 'enum') {
    return <label className={`model-parameter-field ${active ? '' : 'is-disabled'}`}>{heading}<select disabled={!active} value={String(value)} onChange={(event) => { const option = schema.options?.find((candidate) => String(candidate) === event.target.value); onChange(option ?? schema.default) }}>{schema.options?.map((option) => <option key={String(option)} value={String(option)}>{optionLabel(option)}</option>)}</select>{!active && <em>需满足：{dependency}</em>}</label>
  }
  if (schema.type === 'color') {
    return <label className={`model-parameter-field ${active ? '' : 'is-disabled'}`}>{heading}<span className="parameter-color"><input type="color" disabled={!active} value={typeof value === 'string' ? value.slice(0, 7) : '#808080'} onChange={(event) => onChange(event.target.value)} /><input type="text" disabled={!active} value={String(value)} pattern="#[0-9a-fA-F]{6}" onChange={(event) => onChange(event.target.value)} /></span>{!active && <em>需满足：{dependency}</em>}</label>
  }
  if (schema.type === 'string') {
    return <label className={`model-parameter-field ${active ? '' : 'is-disabled'}`}>{heading}<input disabled={!active} value={String(value ?? '')} placeholder={parameterKey === 'texture' ? '留空或输入程序纹理键' : ''} onChange={(event) => onChange(event.target.value)} />{parameterKey === 'texture' && <em>相同键生成并复用同一程序纹理，不读取网络地址。</em>}{!active && <em>需满足：{dependency}</em>}</label>
  }
  const numericValue = Number(value)
  return (
    <label className={`model-parameter-field ${active ? '' : 'is-disabled'}`}>
      {heading}
      <span className="parameter-number">
        {schema.min !== null && schema.max !== null && <input aria-label={`${parameterLabel(parameterKey)}滑块`} type="range" disabled={!active} min={schema.min} max={schema.max} step={schema.step ?? 'any'} value={numericValue} onChange={(event) => onChange(schema.type === 'integer' ? Math.round(Number(event.target.value)) : Number(event.target.value))} />}
        <input aria-label={parameterLabel(parameterKey)} type="number" disabled={!active} min={schema.min ?? undefined} max={schema.max ?? undefined} step={schema.type === 'integer' ? schema.step ?? 1 : 'any'} value={numericValue} onChange={(event) => onChange(schema.type === 'integer' ? Math.round(Number(event.target.value)) : Number(event.target.value))} />
      </span>
      <span className="parameter-range">{schema.min ?? '—'} – {schema.max ?? '—'} {unitLabel(schema.unit)}</span>
      {!active && <em>需满足：{dependency}</em>}
    </label>
  )
}
