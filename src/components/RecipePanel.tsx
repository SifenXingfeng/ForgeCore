import { useState, type ReactNode } from 'react'
import type { Item, Recipe, RecipePort } from '../game/item'
import { useForgeMindStore } from '../store/forgeMind'
import { ItemModelThumbnail } from './ItemModelThumbnail'

const blankRecipe = (): Recipe => ({ id: '', code: '', name: '', description: '', enabled: true, inputs: [], outputs: [], durationSec: 1 })

export function RecipePanel({ initialRecipeId, onDone }: { initialRecipeId?: string; onDone?: () => void } = {}) {
  const items = useForgeMindStore((state) => state.items)
  const recipes = useForgeMindStore((state) => state.recipes)
  const createRecipe = useForgeMindStore((state) => state.createRecipe)
  const updateRecipe = useForgeMindStore((state) => state.updateRecipe)
  const initial = initialRecipeId ? recipes.find((recipe) => recipe.id === initialRecipeId) : undefined
  const [draft, setDraft] = useState<Recipe>(() => initial ? { ...initial, inputs: initial.inputs.map((entry) => ({ ...entry })), outputs: initial.outputs.map((entry) => ({ ...entry })) } : blankRecipe())
  const [error, setError] = useState('')
  const patch = (value: Partial<Recipe>) => setDraft((current) => ({ ...current, ...value }))
  const save = () => {
    if (items.length === 0) return setError('请先在“物品详情”中创建物品')
    if (!draft.id.trim() || !draft.name.trim() || !draft.inputs.length || !draft.outputs.length) return setError('工艺 ID、名称、输入和输出都不能为空')
    if (new Set(draft.inputs.map((entry) => entry.itemId)).size !== draft.inputs.length || new Set(draft.outputs.map((entry) => entry.itemId)).size !== draft.outputs.length) return setError('同一侧不能重复选择同一种物品')
    const next = { ...draft, id: draft.id.trim(), code: draft.code?.trim() || draft.id.trim(), name: draft.name.trim(), description: draft.description?.trim(), durationSec: Math.max(.1, Number(draft.durationSec) || 1), enabled: draft.enabled !== false }
    const ok = initial ? updateRecipe(initial.id, next) : createRecipe(next)
    if (!ok) return setError('工艺路线 ID 已存在')
    onDone?.()
  }
  return <div className="fm-recipe-editor">
    <section className="fm-recipe-identity"><div className="fm-form-grid"><Field label="工艺路线 ID"><input value={draft.id} onChange={(event) => patch({ id: event.target.value })} placeholder="ROUTE_CNC_001" /></Field><Field label="业务编码"><input value={draft.code ?? ''} onChange={(event) => patch({ code: event.target.value })} placeholder="默认等于工艺 ID" /></Field><Field label="路线名称"><input value={draft.name} onChange={(event) => patch({ name: event.target.value })} placeholder="例如：机械轴精车" /></Field><Field label="加工时长 / 秒"><input type="number" min=".1" step=".1" value={draft.durationSec} onChange={(event) => patch({ durationSec: Number(event.target.value) })} /></Field></div><Field label="工艺说明"><textarea rows={2} value={draft.description ?? ''} onChange={(event) => patch({ description: event.target.value })} placeholder="说明加工目标、质量标准或适用机器" /></Field><label className="fm-toggle-line"><input type="checkbox" checked={draft.enabled !== false} onChange={(event) => patch({ enabled: event.target.checked })} /><span>启用这条工艺路线并允许机器录入</span></label></section>
    <section className="fm-recipe-flow-builder"><PortEditor title="INPUT / 输入物品" ports={draft.inputs} items={items} onChange={(inputs) => patch({ inputs })} /><div className="fm-recipe-process-node"><span>PROCESS</span><b>{Math.max(.1, Number(draft.durationSec) || 1)} s</b><small>标准加工周期</small><i>→</i></div><PortEditor title="OUTPUT / 输出物品" ports={draft.outputs} items={items} onChange={(outputs) => patch({ outputs })} output /></section>
    {error && <p className="fm-form-error">{error}</p>}<footer className="fm-modal-actions"><button type="button" onClick={onDone}>取消</button><button type="button" className="primary" onClick={save}>{initial ? '保存工艺修改' : '加入生产路线'}</button></footer>
  </div>
}

function PortEditor({ title, ports, items, onChange, output = false }: { title: string; ports: RecipePort[]; items: Item[]; onChange: (ports: RecipePort[]) => void; output?: boolean }) {
  const [itemId, setItemId] = useState('')
  const [qty, setQty] = useState(1)
  const add = () => { if (!itemId || ports.some((entry) => entry.itemId === itemId)) return; onChange([...ports, { itemId, qty: Math.max(1, qty) }]); setItemId(''); setQty(1) }
  return <section className={`fm-recipe-port-editor${output ? ' is-output' : ''}`}><header><span>{title}</span><b>{ports.length} 种</b></header><div className="fm-route-port-add"><select aria-label={`${title}选择物品`} value={itemId} onChange={(event) => setItemId(event.target.value)}><option value="">选择物品</option>{items.filter((item) => !ports.some((entry) => entry.itemId === item.id)).map((item) => <option key={item.id} value={item.id}>{item.name} · {item.id}</option>)}</select><input aria-label={`${title}数量`} type="number" min="1" step="1" value={qty} onChange={(event) => setQty(Math.max(1, Number(event.target.value) || 1))} /><button type="button" onClick={add}>＋ 添加</button></div><div className="fm-recipe-port-list">{ports.length === 0 && <p>尚未添加{output ? '输出' : '输入'}物品</p>}{ports.map((port) => { const item = items.find((entry) => entry.id === port.itemId); return <article key={port.itemId}><ItemModelThumbnail item={item} /><span><strong>{item?.name ?? port.itemId}</strong><small>{port.itemId}</small></span><label>数量<input type="number" min="1" step="1" value={port.qty} onChange={(event) => onChange(ports.map((entry) => entry.itemId === port.itemId ? { ...entry, qty: Math.max(1, Number(event.target.value) || 1) } : entry))} /></label><button type="button" onClick={() => onChange(ports.filter((entry) => entry.itemId !== port.itemId))}>×</button></article>})}</div></section>
}

function Field({ label, children }: { label: string; children: ReactNode }) { return <label className="fm-manufacturing-field"><span>{label}</span>{children}</label> }
