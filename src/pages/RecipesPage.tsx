import { useEffect, useMemo, useState } from 'react'
import { ArrowRight, Beaker, Clock3, Pencil, Plus, Trash2 } from 'lucide-react'
import type { AppPage } from '../components/Sidebar'
import { EmptyState, Modal, Panel, StatusBadge } from '../components/ui'
import { useForgeStore } from '../store/useForgeStore'
import type { Item, Recipe, RecipeLine } from '../types'

export function RecipesPage({ onNavigate }: { onNavigate: (page: AppPage) => void }) {
  const { items, recipes, upsertRecipe, removeRecipe } = useForgeStore()
  const [selectedId, setSelectedId] = useState(recipes[0]?.id ?? '')
  const [editing, setEditing] = useState<Recipe | 'new' | null>(null)
  const selected = recipes.find((recipe) => recipe.id === selectedId) ?? recipes[0]

  useEffect(() => {
    if (selectedId && recipes.some((recipe) => recipe.id === selectedId)) return
    setSelectedId(recipes[0]?.id ?? '')
  }, [recipes, selectedId])

  const beginCreate = () => {
    if (items.length === 0) {
      onNavigate('items')
      return
    }
    setEditing('new')
  }

  return (
    <div className="page">
      <header className="page-heading">
        <div>
          <span className="eyebrow">PROCESS DEFINITION / RECIPE FLOW</span>
          <h1>配方与工艺路线</h1>
          <p>创建最多三种原料、三种产物的配方，并把它绑定到任意通用机器。仿真直接读取这些业务数据。</p>
        </div>
        <button className="button button--primary" onClick={beginCreate}>
          <Plus size={16} />{items.length === 0 ? '先创建物品' : '新建配方'}
        </button>
      </header>

      {items.length === 0 ? (
        <div className="recipe-prerequisite" role="status">
          <Beaker />
          <div><strong>配方需要引用实际物品</strong><p>当前工厂还是空物品库。先创建原料或产品，返回后即可立即建立配方。</p></div>
          <button className="button button--primary" onClick={() => onNavigate('items')}>前往创建物品</button>
        </div>
      ) : null}

      <div className="recipes-layout">
        <Panel title="生产配方" eyebrow={`${recipes.length} RECIPES`} className="recipe-list-panel">
          <div className="recipe-list">
            {recipes.map((recipe, index) => (
              <button key={recipe.id} className={selected?.id === recipe.id ? 'is-active' : ''} onClick={() => setSelectedId(recipe.id)}>
                <span className="recipe-index">{String(index + 1).padStart(2, '0')}</span>
                <span><strong>{recipe.name}</strong><small>{recipe.code}</small></span>
                <StatusBadge tone={recipe.enabled ? 'success' : 'neutral'}>{recipe.enabled ? '已启用' : '停用'}</StatusBadge>
              </button>
            ))}
            {recipes.length === 0 ? <p className="recipe-list__empty">还没有配方。创建物品后，从这里定义第一条生产关系。</p> : null}
          </div>
        </Panel>

        <Panel title={selected?.name ?? '请选择配方'} eyebrow="RECIPE DEFINITION" className="recipe-detail-panel" action={selected && <StatusBadge tone="info">确定性流程</StatusBadge>}>
          {selected ? (
            <RecipeDetail
              recipe={selected}
              items={items}
              onEdit={() => setEditing(selected)}
              onToggle={() => upsertRecipe({ ...selected, enabled: !selected.enabled })}
              onDelete={() => { if (removeRecipe(selected.id)) setSelectedId('') }}
            />
          ) : (
            <EmptyState
              icon={<Beaker />}
              title="建立第一条工艺关系"
              description={items.length === 0 ? '先创建可被配方引用的业务物品。' : '定义输入、输出、数量和处理时间，随后可在机器属性中绑定。'}
              action={<button className="button button--primary" onClick={beginCreate}>{items.length === 0 ? '创建物品' : '新建配方'}</button>}
            />
          )}
        </Panel>

        <Panel title="当前工艺链" eyebrow="MATERIAL FLOW" className="recipe-flow-panel">
          <div className="vertical-flow">
            {recipes.filter((recipe) => recipe.enabled).map((recipe) => (
              <div className="vertical-flow__step" key={recipe.id}>
                <span className="vertical-flow__node"><Beaker size={16} />{lineSummary(recipe.inputs, items)}</span>
                <span className="vertical-flow__connector"><ArrowRight size={14} />{recipe.processingTimeSec}s</span>
                <span className="vertical-flow__node vertical-flow__node--output">{lineSummary(recipe.outputs, items)}</span>
              </div>
            ))}
            {recipes.every((recipe) => !recipe.enabled) ? <p className="muted">暂无启用的工艺链。</p> : null}
          </div>
          <div className="audit-note"><strong>执行口径</strong><p>配方只定义业务加工关系；物品质量和堆叠数不会改变模型网格。</p></div>
        </Panel>
      </div>

      {editing ? (
        <RecipeEditorModal
          key={editing === 'new' ? 'new' : editing.id}
          items={items}
          recipe={editing === 'new' ? undefined : editing}
          onClose={() => setEditing(null)}
          onSave={(recipe) => {
            upsertRecipe(recipe)
            setSelectedId(recipe.id)
            setEditing(null)
          }}
        />
      ) : null}
    </div>
  )
}

function RecipeDetail({ recipe, items, onEdit, onToggle, onDelete }: { recipe: Recipe; items: Item[]; onEdit: () => void; onToggle: () => void; onDelete: () => void }) {
  return <>
    <p className="muted">{recipe.description || '尚未填写工艺说明。'}</p>
    <div className="recipe-route">
      <RouteGroup label="INPUT" lines={recipe.inputs} items={items} />
      <div className="recipe-process"><Clock3 size={20} /><strong>{recipe.processingTimeSec} 秒</strong><span>标准处理周期</span></div>
      <ArrowRight className="recipe-route__arrow" />
      <RouteGroup label="OUTPUT" lines={recipe.outputs} items={items} output />
    </div>
    <dl className="detail-list detail-list--columns">
      <div><dt>配方编码</dt><dd>{recipe.code}</dd></div>
      <div><dt>运行状态</dt><dd>{recipe.enabled ? '参与仿真' : '不参与仿真'}</dd></div>
      <div><dt>输入种类</dt><dd>{recipe.inputs.length}</dd></div>
      <div><dt>输出种类</dt><dd>{recipe.outputs.length}</dd></div>
    </dl>
    <footer className="panel-footer-actions">
      <button className="button button--primary" onClick={onEdit}><Pencil size={15} />编辑配方</button>
      <button className="button button--secondary" onClick={onToggle}>{recipe.enabled ? '暂停此配方' : '启用此配方'}</button>
      <button className="button button--danger" onClick={onDelete}><Trash2 size={15} />删除</button>
    </footer>
  </>
}

function RouteGroup({ label, lines, items, output = false }: { label: string; lines: RecipeLine[]; items: Item[]; output?: boolean }) {
  return <div className={`route-group ${output ? 'route-group--output' : ''}`}><span className="eyebrow">{label}</span>{lines.map((line, index) => <div key={`${line.itemId}-${index}`}><strong>{getItem(items, line.itemId)?.name ?? line.itemId}</strong><small>× {line.quantity}</small></div>)}</div>
}

function RecipeEditorModal({ items, recipe, onClose, onSave }: { items: Item[]; recipe?: Recipe; onClose: () => void; onSave: (recipe: Recipe) => void }) {
  const timestamp = useMemo(() => Date.now(), [])
  const [name, setName] = useState(recipe?.name ?? '新工艺配方')
  const [code, setCode] = useState(recipe?.code ?? `RCP-${timestamp.toString().slice(-5)}`)
  const [description, setDescription] = useState(recipe?.description ?? '')
  const [seconds, setSeconds] = useState(recipe?.processingTimeSec ?? 12)
  const [enabled, setEnabled] = useState(recipe?.enabled ?? true)
  const [inputs, setInputs] = useState<RecipeLine[]>(recipe?.inputs.slice(0, 3).map((line) => ({ ...line })) ?? [{ itemId: items[0]?.id ?? '', quantity: 1 }])
  const [outputs, setOutputs] = useState<RecipeLine[]>(recipe?.outputs.slice(0, 3).map((line) => ({ ...line })) ?? [{ itemId: items[1]?.id ?? items[0]?.id ?? '', quantity: 1 }])
  const inputsUnique = new Set(inputs.map((line) => line.itemId)).size === inputs.length
  const outputsUnique = new Set(outputs.map((line) => line.itemId)).size === outputs.length
  const valid = Boolean(name.trim() && code.trim() && seconds > 0 && inputs.length > 0 && outputs.length > 0
    && inputs.length <= 3 && outputs.length <= 3 && inputsUnique && outputsUnique
    && [...inputs, ...outputs].every((line) => line.itemId && Number.isFinite(line.quantity) && line.quantity >= 1))

  return <Modal title={recipe ? '编辑工艺配方' : '创建工艺配方'} onClose={onClose} wide>
    <form className="recipe-editor" onSubmit={(event) => {
      event.preventDefault()
      if (!valid) return
      onSave({
        id: recipe?.id ?? `recipe-${timestamp}`,
        code: code.trim(),
        name: name.trim(),
        description: description.trim(),
        inputs,
        outputs,
        processingTimeSec: Math.max(0.25, seconds),
        enabled,
      })
    }}>
      <div className="form-grid recipe-editor__identity">
        <label>配方名称<input value={name} onChange={(event) => setName(event.target.value)} required /></label>
        <label>配方编码<input value={code} onChange={(event) => setCode(event.target.value)} required /></label>
        <label className="form-grid__full">工艺说明<textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={2} placeholder="说明这条配方的加工目的" /></label>
      </div>

      <div className="recipe-editor__routes">
        <RecipeLinesEditor label="输入物品" tone="input" lines={inputs} items={items} onChange={setInputs} />
        <div className="recipe-editor__process"><Clock3 /><label>处理时间<input type="number" min={0.25} max={86400} step={0.25} value={seconds} onChange={(event) => setSeconds(Number(event.target.value))} /><span>秒</span></label></div>
        <RecipeLinesEditor label="输出物品" tone="output" lines={outputs} items={items} onChange={setOutputs} />
      </div>

      <label className="recipe-editor__enabled"><input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} /><span><strong>创建后启用</strong><small>启用后可被机器绑定并参与仿真</small></span></label>
      <footer className="modal__footer"><span className="recipe-editor__validation">{valid ? `${inputs.length}/3 种原料 → ${outputs.length}/3 种产物` : '请输入 1–3 种不重复的原料与产物，并补全数量'}</span><button type="button" className="button button--secondary" onClick={onClose}>取消</button><button className="button button--primary" disabled={!valid}>{recipe ? '保存修改' : '创建并启用'}</button></footer>
    </form>
  </Modal>
}

function RecipeLinesEditor({ label, tone, lines, items, onChange }: { label: string; tone: 'input' | 'output'; lines: RecipeLine[]; items: Item[]; onChange: (lines: RecipeLine[]) => void }) {
  const update = (index: number, patch: Partial<RecipeLine>) => onChange(lines.map((line, lineIndex) => lineIndex === index ? { ...line, ...patch } : line))
  const add = () => {
    if (lines.length >= 3) return
    const candidate = items.find((item) => !lines.some((line) => line.itemId === item.id)) ?? items[0]
    if (candidate) onChange([...lines, { itemId: candidate.id, quantity: 1 }])
  }
  return <section className={`recipe-lines recipe-lines--${tone}`}>
    <header><div><span className="eyebrow">{tone.toUpperCase()}</span><strong>{label} · {lines.length}/3</strong></div><button type="button" onClick={add} disabled={lines.length >= 3}><Plus />{lines.length >= 3 ? '已达上限' : '添加一项'}</button></header>
    <div className="recipe-lines__list">
      {lines.map((line, index) => (
        <div className="recipe-line-editor" key={`${tone}-${index}`}>
          <span>{String(index + 1).padStart(2, '0')}</span>
          <select value={line.itemId} onChange={(event) => update(index, { itemId: event.target.value })}>{items.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.code}</option>)}</select>
          <label>×<input aria-label={`${label} ${index + 1} 数量`} type="number" min={1} max={99999} step={1} value={line.quantity} onChange={(event) => update(index, { quantity: Math.max(1, Math.round(Number(event.target.value))) })} /></label>
          <button type="button" onClick={() => onChange(lines.filter((_, lineIndex) => lineIndex !== index))} disabled={lines.length === 1} aria-label={`删除${label} ${index + 1}`}><Trash2 /></button>
        </div>
      ))}
    </div>
  </section>
}

function lineSummary(lines: RecipeLine[], items: Item[]) {
  if (lines.length === 0) return '未绑定'
  return lines.map((line) => `${getItem(items, line.itemId)?.name ?? line.itemId}×${line.quantity}`).join(' + ')
}

function getItem(items: Item[], id?: string) {
  return items.find((item) => item.id === id)
}
