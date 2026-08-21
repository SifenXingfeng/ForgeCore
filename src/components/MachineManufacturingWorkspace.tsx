import { useMemo, useState, type ReactNode } from 'react'
import { BUILD_ASSET_PATHS, OBJECT_DEFS, type ImportedResource, type MachineDefinition, type MachineModelType } from '../game/types'
import { useForgeMindStore } from '../store/forgeMind'
import { EquipmentModelPreview } from './EquipmentModelPreview'
import { ResourceImportDialog } from './ResourceImportDialog'
import { WorkbenchModal } from './WorkbenchModal'

type ModelKey = MachineModelType | `imported:${string}`
type EditorState = { mode: 'create'; modelKey: ModelKey } | { mode: 'edit'; definition: MachineDefinition }
interface MachineModelRecord { key: ModelKey; name: string; subtitle: string; description: string; path?: string; previewDataUrl?: string; footprint: { w: number; d: number }; height: number; throughput: string; power: string; importedResourceId?: string }

const BUILTIN_TYPES: MachineModelType[] = ['machine', 'smelter', 'press', 'washing']

function builtInRecord(type: MachineModelType): MachineModelRecord {
  const base = OBJECT_DEFS[type]
  return { key: type, name: base.label, subtitle: base.subtitle, description: base.function, path: BUILD_ASSET_PATHS[type], footprint: { ...base.footprint }, height: base.height, throughput: base.throughput, power: base.power }
}
function importedRecord(resource: ImportedResource): MachineModelRecord {
  return { key: `imported:${resource.id}`, name: resource.name, subtitle: `IMPORTED / ${resource.id}`, description: resource.objectDef.function, path: resource.objectDef.assetPath, previewDataUrl: resource.previewDataUrl, footprint: { ...resource.objectDef.footprint }, height: resource.objectDef.height, throughput: resource.objectDef.throughput, power: resource.objectDef.power, importedResourceId: resource.id }
}
function machineModelKey(definition: MachineDefinition): ModelKey { return definition.modelType === 'imported' ? `imported:${definition.importedResourceId ?? ''}` : definition.modelType }

export function MachineManufacturingWorkspace({ onClose }: { onClose: () => void }) {
  return <div className="fm-manufacturing-workspace"><header className="fm-manufacturing-head"><div><span>MECHANICAL MANUFACTURING</span><h2>机械制造</h2><p>机器仓库与模型库独立展示；新建、编辑和工艺录入在悬浮窗口完成。</p></div><button type="button" onClick={onClose} aria-label="关闭机械制造">×</button></header><main><MachineRegistry /></main></div>
}

function MachineRegistry() {
  const definitions = useForgeMindStore((state) => state.machineDefinitions)
  const recipes = useForgeMindStore((state) => state.recipes)
  const objects = useForgeMindStore((state) => state.objects)
  const importedResources = useForgeMindStore((state) => state.importedResources)
  const registerImportedResource = useForgeMindStore((state) => state.registerImportedResource)
  const addDefinition = useForgeMindStore((state) => state.addMachineDefinition)
  const updateDefinition = useForgeMindStore((state) => state.updateMachineDefinition)
  const removeDefinition = useForgeMindStore((state) => state.removeMachineDefinition)
  const models = useMemo(() => [...BUILTIN_TYPES.map(builtInRecord), ...importedResources.map(importedRecord)], [importedResources])
  const [selectedKey, setSelectedKey] = useState<ModelKey>('machine')
  const [editor, setEditor] = useState<EditorState | null>(null)
  const [pendingDelete, setPendingDelete] = useState<MachineDefinition | null>(null)
  const [importOpen, setImportOpen] = useState(false)
  const [error, setError] = useState('')
  const selected = models.find((model) => model.key === selectedKey) ?? models[0]
  const modelForDefinition = (definition: MachineDefinition) => models.find((model) => model.key === machineModelKey(definition)) ?? models[0]

  return <div className="fm-registry-page fm-machine-registry">
    <section className="fm-registry-library"><header className="fm-registry-section-head"><div><span>MACHINE DEFINITION MANAGEMENT</span><h3>已加入的机器</h3><p>这里只展示已经成为工厂资产的机器定义，不再被新建表单挤压。</p></div><div><strong>{definitions.length}</strong><button type="button" onClick={() => setImportOpen(true)}>↥ 导入模型</button><button type="button" className="primary" onClick={() => setEditor({ mode: 'create', modelKey: selected.key })}>＋ 新建机器</button></div></header>
      {definitions.length === 0 ? <div className="fm-registry-empty"><b>◇</b><span><strong>机械制造仓库为空</strong><small>在下方选择一个现有或导入模型，然后创建第一台基础加工机器。</small></span></div> : <div className="fm-business-card-grid">{definitions.map((definition) => { const placed = objects.filter((object) => object.type === 'machine' && object.resourceId === definition.id).length; const model = modelForDefinition(definition); return <article className="fm-business-card fm-machine-card" key={definition.id}><div className="fm-business-card-preview"><EquipmentModelPreview compact path={model.path} width={definition.footprint.w} depth={definition.footprint.d} height={definition.height} label={definition.name} /><span>{definition.inputPortCount} 入 / {definition.outputPortCount} 出</span></div><div className="fm-business-card-body"><span>基础加工</span><h4>{definition.name}</h4><code>{definition.id}</code><dl><div><dt>模型</dt><dd>{model.name}</dd></div><div><dt>工艺</dt><dd>{definition.recipeIds.length} 条</dd></div><div><dt>已建</dt><dd>{placed} 台</dd></div></dl><p className={placed ? 'is-used' : ''}>{placed ? `场景中有 ${placed} 台实例` : '未被场景引用，可安全删除'}</p></div><footer><button type="button" onClick={() => setEditor({ mode: 'edit', definition })}>编辑</button><button type="button" className="danger" disabled={placed > 0} title={placed ? '请先拆除场景中的机器实例' : '删除机器'} onClick={() => setPendingDelete(definition)}>删除</button></footer></article>})}</div>}
    </section>

    <section className="fm-model-library-head"><div><span>EQUIPMENT MODEL LIBRARY</span><h3>机器模型库</h3><p>内置工业设备和自行导入的 GLB 模型都在这里可视选择。</p></div><button type="button" onClick={() => setImportOpen(true)}>＋ 导入自己的机器模型</button></section>
    <div className="fm-machine-model-browser"><main className="fm-machine-model-grid">{models.map((model) => <button type="button" key={model.key} className={`fm-machine-model-card${selected.key === model.key ? ' is-selected' : ''}`} onClick={() => setSelectedKey(model.key)}><EquipmentModelPreview compact path={model.path} width={model.footprint.w} depth={model.footprint.d} height={model.height} label={model.name} /><span>{model.importedResourceId ? '用户导入' : '内置模型'}</span><strong>{model.name}</strong><small>{model.subtitle}</small><footer><b>{model.footprint.w} × {model.footprint.d} 格</b><i>{model.height} m</i></footer></button>)}</main>
      <aside className="fm-machine-model-inspector"><div><span>LIVE MODEL PREVIEW</span><h3>{selected.name}</h3><p>{selected.description}</p></div><EquipmentModelPreview path={selected.path} width={selected.footprint.w} depth={selected.footprint.d} height={selected.height} inputCount={1} outputCount={1} label={selected.name} /><dl><div><dt>模型来源</dt><dd>{selected.importedResourceId ? '用户导入' : 'ForgeMind 内置'}</dd></div><div><dt>占地</dt><dd>{selected.footprint.w} × {selected.footprint.d} 格</dd></div><div><dt>默认高度</dt><dd>{selected.height} m</dd></div><div><dt>标准吞吐</dt><dd>{selected.throughput}</dd></div><div><dt>能耗</dt><dd>{selected.power}</dd></div></dl><button type="button" className="primary" onClick={() => setEditor({ mode: 'create', modelKey: selected.key })}>使用此模型新建机器</button></aside>
    </div>{error && <p className="fm-form-error">{error}</p>}
    {editor && <MachineEditor key={editor.mode === 'edit' ? editor.definition.id : editor.modelKey} state={editor} models={models} recipes={recipes} onClose={() => setEditor(null)} onSave={(definition) => { const ok = editor.mode === 'edit' ? updateDefinition(editor.definition.id, definition) : addDefinition(definition); if (!ok) return '机器 ID 已存在，或当前定义仍被场景引用'; setEditor(null); return null }} />}
    {pendingDelete && <WorkbenchModal title="删除机器定义" subtitle="只删除机械制造中的定义，不删除模型源文件。" onClose={() => setPendingDelete(null)}><div className="fm-confirm-body"><b>!</b><div><h3>确认删除“{pendingDelete.name}”？</h3><p>机器 ID {pendingDelete.id} 将从基础加工建造目录移除。</p></div></div><footer className="fm-modal-actions"><button type="button" onClick={() => setPendingDelete(null)}>取消</button><button type="button" className="danger" onClick={() => { if (!removeDefinition(pendingDelete.id)) setError('该机器仍有场景实例，请先拆除后再删除'); setPendingDelete(null) }}>确认删除</button></footer></WorkbenchModal>}
    <ResourceImportDialog open={importOpen} onClose={() => setImportOpen(false)} onImported={(resource) => { registerImportedResource(resource, false); const key = `imported:${resource.id}` as const; setSelectedKey(key); setImportOpen(false); setEditor({ mode: 'create', modelKey: key }) }} />
  </div>
}

function MachineEditor({ state, models, recipes, onClose, onSave }: { state: EditorState; models: MachineModelRecord[]; recipes: ReturnType<typeof useForgeMindStore.getState>['recipes']; onClose: () => void; onSave: (definition: MachineDefinition) => string | null }) {
  const initial = state.mode === 'edit' ? state.definition : undefined
  const initialKey = initial ? machineModelKey(initial) : state.mode === 'create' ? state.modelKey : 'machine'
  const initialModel = models.find((model) => model.key === initialKey) ?? models[0]
  const [draft, setDraft] = useState<MachineDefinition>(() => initial ? { ...initial, footprint: { ...initial.footprint }, recipeIds: [...initial.recipeIds] } : { id: '', name: `新${initialModel.name}`, description: initialModel.description, modelType: initialModel.importedResourceId ? 'imported' : initialModel.key as MachineModelType, importedResourceId: initialModel.importedResourceId, footprint: { ...initialModel.footprint }, height: initialModel.height, throughput: initialModel.throughput, power: initialModel.power, inputPortCount: 1, outputPortCount: 1, recipeIds: [] })
  const [modelKey, setModelKey] = useState<ModelKey>(initialKey)
  const [error, setError] = useState('')
  const model = models.find((entry) => entry.key === modelKey) ?? models[0]
  const patch = (value: Partial<MachineDefinition>) => setDraft((current) => ({ ...current, ...value }))
  const changeModel = (key: ModelKey) => { const next = models.find((entry) => entry.key === key) ?? models[0]; setModelKey(key); patch({ modelType: next.importedResourceId ? 'imported' : next.key as MachineModelType, importedResourceId: next.importedResourceId, footprint: { ...next.footprint }, height: next.height, throughput: next.throughput, power: next.power, inputPortCount: Math.min(draft.inputPortCount, next.footprint.d), outputPortCount: Math.min(draft.outputPortCount, next.footprint.d), recipeIds: [] }) }
  const compatible = recipes.filter((recipe) => recipe.enabled !== false && recipe.inputs.length <= draft.inputPortCount && recipe.outputs.length <= draft.outputPortCount)
  const save = () => {
    if (!draft.id.trim() || !draft.name.trim()) return setError('机器专属 ID 和名称不能为空')
    if (draft.inputPortCount > draft.footprint.d || draft.outputPortCount > draft.footprint.d) return setError('每侧接口数量不得超过占地深度')
    if (draft.recipeIds.some((id) => !compatible.some((recipe) => recipe.id === id))) return setError('已录入工艺的输入或输出种类超过当前接口数量')
    const nextError = onSave({ ...draft, id: draft.id.trim(), name: draft.name.trim(), description: draft.description.trim(), height: Math.max(.3, Number(draft.height) || 1.5), inputPortCount: Math.max(1, Math.round(draft.inputPortCount)), outputPortCount: Math.max(1, Math.round(draft.outputPortCount)) }); if (nextError) setError(nextError)
  }
  return <WorkbenchModal title={initial ? '编辑基础加工机器' : '新建基础加工机器'} subtitle="左侧模型、占地和蓝黄接口会随参数实时变化；右侧只录入已存在的生产路线。" wide onClose={onClose}><div className="fm-machine-builder"><section className="fm-machine-builder-preview"><EquipmentModelPreview path={model.path} width={draft.footprint.w} depth={draft.footprint.d} height={draft.height} inputCount={draft.inputPortCount} outputCount={draft.outputPortCount} label={draft.name || model.name} /><div className="fm-builder-model-summary"><span>{model.name}</span><code>{model.key}</code><strong>{draft.footprint.w} × {draft.footprint.d} 格 · {draft.inputPortCount} 入 / {draft.outputPortCount} 出</strong></div></section>
    <section className="fm-machine-builder-form"><header><span>MACHINE PARAMETERS</span><h3>机器参数</h3><p>接口数以占地深度为上限；模型与全部机器参数在此窗口统一调整。</p></header><div className="fm-form-grid"><Field label="机器专属 ID"><input value={draft.id} onChange={(event) => patch({ id: event.target.value })} placeholder="MACHINE_CNC_001" /></Field><Field label="机器名称"><input value={draft.name} onChange={(event) => patch({ name: event.target.value })} /></Field><Field label="模型来源"><select value={modelKey} onChange={(event) => changeModel(event.target.value as ModelKey)}>{models.map((entry) => <option key={entry.key} value={entry.key}>{entry.name} · {entry.importedResourceId ? '用户导入' : '内置'}</option>)}</select></Field><Field label="模型高度 / m"><input type="number" min=".3" max="8" step=".1" value={draft.height} onChange={(event) => patch({ height: Number(event.target.value) || .3 })} /></Field><Field label="占地宽 / 格"><input type="number" min="1" max="12" value={draft.footprint.w} onChange={(event) => patch({ footprint: { ...draft.footprint, w: Math.max(1, Math.min(12, Number(event.target.value) || 1)) } })} /></Field><Field label="占地深 / 格"><input type="number" min="1" max="12" value={draft.footprint.d} onChange={(event) => { const d = Math.max(1, Math.min(12, Number(event.target.value) || 1)); patch({ footprint: { ...draft.footprint, d }, inputPortCount: Math.min(draft.inputPortCount, d), outputPortCount: Math.min(draft.outputPortCount, d), recipeIds: [] }) }} /></Field><Field label="蓝色入货口"><input type="number" min="1" max={draft.footprint.d} value={draft.inputPortCount} onChange={(event) => patch({ inputPortCount: Math.max(1, Math.min(draft.footprint.d, Number(event.target.value) || 1)), recipeIds: [] })} /></Field><Field label="黄色出货口"><input type="number" min="1" max={draft.footprint.d} value={draft.outputPortCount} onChange={(event) => patch({ outputPortCount: Math.max(1, Math.min(draft.footprint.d, Number(event.target.value) || 1)), recipeIds: [] })} /></Field><Field label="标准吞吐"><input value={draft.throughput} onChange={(event) => patch({ throughput: event.target.value })} /></Field><Field label="额定能耗"><input value={draft.power} onChange={(event) => patch({ power: event.target.value })} /></Field></div><Field label="机器说明"><textarea rows={3} value={draft.description} onChange={(event) => patch({ description: event.target.value })} /></Field>
      <section className="fm-machine-routes"><header><span>录入已有工艺路线</span><b>{draft.recipeIds.length} / {recipes.length}</b></header>{recipes.length === 0 ? <p>生产路线为 0。请先到“生产路线”独立页面新建工艺。</p> : recipes.map((recipe) => { const fits = recipe.enabled !== false && recipe.inputs.length <= draft.inputPortCount && recipe.outputs.length <= draft.outputPortCount; return <label key={recipe.id} className={!fits ? 'is-disabled' : ''}><input type="checkbox" disabled={!fits} checked={draft.recipeIds.includes(recipe.id)} onChange={(event) => patch({ recipeIds: event.target.checked ? [...draft.recipeIds, recipe.id] : draft.recipeIds.filter((id) => id !== recipe.id) })} /><span><strong>{recipe.name}</strong><small>{recipe.id} · {recipe.inputs.length} 种入 / {recipe.outputs.length} 种出{fits ? '' : ' · 超出接口容量'}</small></span></label>})}</section>
    </section></div>{error && <p className="fm-form-error fm-modal-error">{error}</p>}<footer className="fm-modal-actions"><button type="button" onClick={onClose}>取消</button><button type="button" className="primary" onClick={save}>{initial ? '保存机器修改' : '加入机械制造'}</button></footer></WorkbenchModal>
}

function Field({ label, children }: { label: string; children: ReactNode }) { return <label className="fm-manufacturing-field"><span>{label}</span>{children}</label> }
