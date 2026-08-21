import { useEffect, useMemo, useState } from 'react'
import { loadForgeCoreModelCatalog, type ForgeCoreModelCatalog, type ForgeCoreModelRecord } from '../data/forgecoreModelCatalog'
import { CATEGORY_COLORS, CATEGORY_LABELS, type Item, type ItemCategory } from '../game/item'
import { useForgeMindStore } from '../store/forgeMind'

type Props = {
  selectedItemId: string | null
  onSelectItem: (item: Item) => void
}

const FILTERS = [
  ['all', '全部'],
  ['basic', '基础'],
  ['material', '材料'],
  ['mechanical', '机械'],
  ['electronic', '电子'],
  ['package', '包装'],
] as const

export function ProductionModelLibrary({ selectedItemId, onSelectItem }: Props) {
  const items = useForgeMindStore((state) => state.items)
  const addItem = useForgeMindStore((state) => state.addItem)
  const [catalog, setCatalog] = useState<ForgeCoreModelCatalog | null>(null)
  const [selectedModelId, setSelectedModelId] = useState<string | null>(null)
  const [filter, setFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [itemName, setItemName] = useState('')
  const [itemCategory, setItemCategory] = useState<ItemCategory>('raw')

  useEffect(() => {
    const controller = new AbortController()
    loadForgeCoreModelCatalog(controller.signal)
      .then((next) => {
        setCatalog(next)
        setSelectedModelId(next.models[0]?.id ?? null)
      })
      .catch(() => undefined)
    return () => controller.abort()
  }, [])

  const models = useMemo(() => {
    const query = search.trim().toLowerCase()
    return (catalog?.models ?? []).filter((model) => (
      (filter === 'all' || model.category === filter)
      && (!query || `${model.id} ${model.nameZh} ${model.nameEn}`.toLowerCase().includes(query))
    ))
  }, [catalog?.models, filter, search])

  const selectedModel = catalog?.models.find((model) => model.id === selectedModelId) ?? models[0]
  const boundItems = selectedModel
    ? items.filter((item) => item.modelId === selectedModel.id || item.modelPath === selectedModel.relativePath)
    : []

  const createItem = () => {
    const name = itemName.trim()
    if (!name || !selectedModel) return
    addItem(name, itemCategory, CATEGORY_COLORS[itemCategory], selectedModel.relativePath, selectedModel.id)
    setItemName('')
  }

  return (
    <section className="fm-route-model-library" aria-label="生产物品与模型库">
      <header className="fm-route-model-head">
        <div><span>ITEM / MODEL LIBRARY</span><h2>物品与模型库</h2><p>先绑定生产物料，再在下方配方目录里定义物料流转关系。</p></div>
        <div className="fm-route-model-count"><b>{catalog?.modelCount ?? '—'}</b><span>模型模板</span><b>{items.length}</b><span>业务物品</span></div>
      </header>
      <div className="fm-route-model-layout">
        <div className="fm-route-model-main">
          <div className="fm-route-model-toolbar"><div>{FILTERS.map(([key, label]) => <button key={key} type="button" className={filter === key ? 'is-active' : ''} onClick={() => setFilter(key)}>{label}</button>)}</div><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索模型 / Model ID" aria-label="搜索模型" /></div>
          {models.length > 0 ? <div className="fm-route-model-grid">{models.map((model) => <ModelCard key={model.id} model={model} active={selectedModel?.id === model.id} onClick={() => setSelectedModelId(model.id)} />)}</div> : <div className="fm-route-model-empty">模型目录加载中，或没有匹配项。</div>}
        </div>
        <aside className="fm-route-model-inspector">
          {selectedModel ? <ModelInspector model={selectedModel} boundItems={boundItems} selectedItemId={selectedItemId} onSelectItem={onSelectItem} itemName={itemName} setItemName={setItemName} itemCategory={itemCategory} setItemCategory={setItemCategory} onCreateItem={createItem} /> : <div className="fm-route-model-empty">模型目录尚未加载。</div>}
        </aside>
      </div>
    </section>
  )
}

function ModelCard({ model, active, onClick }: { model: ForgeCoreModelRecord; active: boolean; onClick: () => void }) {
  return <button type="button" className={`fm-route-model-card${active ? ' is-active' : ''}`} onClick={onClick}><ModelPreview model={model} /><span><strong>{model.nameZh}</strong><small>{model.nameEn} · {model.id}</small><em>{model.metrics?.triangleCount ?? '—'} tris · L{model.parameterizationLevel}</em></span></button>
}

function ModelInspector({ model, boundItems, selectedItemId, onSelectItem, itemName, setItemName, itemCategory, setItemCategory, onCreateItem }: { model: ForgeCoreModelRecord; boundItems: Item[]; selectedItemId: string | null; onSelectItem: (item: Item) => void; itemName: string; setItemName: (value: string) => void; itemCategory: ItemCategory; setItemCategory: (value: ItemCategory) => void; onCreateItem: () => void }) {
  return <>
    <div className="fm-route-model-hero"><ModelPreview model={model} large /><div><span>{model.category.toUpperCase()} / LEVEL {model.parameterizationLevel}</span><h3>{model.nameZh}</h3><small>{model.nameEn} · {model.id}</small></div></div>
    <p className="fm-route-model-description">{model.description}</p>
    <div className="fm-route-model-meta"><span><b>{model.metrics?.triangleCount ?? '—'}</b> tris</span><span><b>{boundItems.length}</b> 个引用</span><span><b>GLB 2.0</b> runtime</span></div>
    <div className="fm-route-model-section-head"><span>BOUND BUSINESS ITEMS</span><b>{boundItems.length}</b></div>
    {boundItems.map((item) => <button key={item.id} type="button" className={`fm-route-bound-item${selectedItemId === item.id ? ' is-active' : ''}`} onClick={() => onSelectItem(item)}><i style={{ background: item.color }} /><span><strong>{item.name}</strong><small>{CATEGORY_LABELS[item.category]} · 点击绑定到当前生产配置</small></span></button>)}
    <div className="fm-route-new-item"><span>CREATE BUSINESS ITEM</span><input value={itemName} onChange={(event) => setItemName(event.target.value)} placeholder="物品名称" /><div><select value={itemCategory} onChange={(event) => setItemCategory(event.target.value as ItemCategory)}>{(Object.keys(CATEGORY_LABELS) as ItemCategory[]).map((category) => <option key={category} value={category}>{CATEGORY_LABELS[category]}</option>)}</select><button type="button" onClick={onCreateItem} disabled={!itemName.trim()}>添加</button></div></div>
  </>
}

function ModelPreview({ model, large = false }: { model: ForgeCoreModelRecord; large?: boolean }) {
  const [failed, setFailed] = useState(false)
  return <span className={`fm-route-model-preview${large ? ' is-large' : ''}`}>{failed ? <span>◇</span> : <img src={`/models/forgecore/items/${model.previewPath}`} alt="" onError={() => setFailed(true)} />}</span>
}
