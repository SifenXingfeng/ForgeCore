import { useEffect, useMemo, useState } from 'react'
import { useForgeMindStore } from '../store/forgeMind'
import type { Recipe, RecipePort } from '../game/item'
import { RecipePanel } from './RecipePanel'

interface ProductionRouteWorkspaceProps {
  onClose: () => void
}

export function ProductionRouteWorkspace({ onClose }: ProductionRouteWorkspaceProps) {
  const items = useForgeMindStore((state) => state.items)
  const recipes = useForgeMindStore((state) => state.recipes)
  const removeRecipe = useForgeMindStore((state) => state.removeRecipe)
  const [selectedId, setSelectedId] = useState(recipes[0]?.id ?? '')
  const [editorRecipeId, setEditorRecipeId] = useState<string | null | undefined>(undefined)

  useEffect(() => {
    if (selectedId && recipes.some((recipe) => recipe.id === selectedId)) return
    setSelectedId(recipes[0]?.id ?? '')
  }, [recipes, selectedId])

  const selected = useMemo(
    () => recipes.find((recipe) => recipe.id === selectedId) ?? recipes[0],
    [recipes, selectedId],
  )

  return (
    <section className="fm-route-workspace" aria-label="生产路线工作区">
      <header className="fm-route-header">
        <div>
          <span className="fm-production-kicker"><i>06</i> / PROCESS DEFINITION / RECIPE FLOW</span>
          <h1>配方与工艺路线</h1>
          <p>定义输入、输出和处理时间；仿真会直接读取这里的生产关系。</p>
        </div>
        <div className="fm-route-header-actions">
          <span>{recipes.length.toString().padStart(2, '0')} RECIPES</span>
          <button type="button" className="fm-route-primary" onClick={() => setEditorRecipeId(null)}>＋ 新建工艺</button>
          <button type="button" className="fm-route-close" onClick={onClose} aria-label="关闭生产路线">×</button>
        </div>
      </header>

      <div className="fm-route-layout">
        <section className="fm-route-panel fm-route-list-panel">
          <div className="fm-route-panel-heading"><span>RECIPE CATALOG</span><b>生产配方</b></div>
          <div className="fm-route-list">
            {recipes.map((recipe, index) => (
              <button key={recipe.id} type="button" className={selected?.id === recipe.id ? 'is-active' : ''} onClick={() => setSelectedId(recipe.id)}>
                <span className="fm-route-index">{String(index + 1).padStart(2, '0')}</span>
                <span className="fm-route-list-name"><strong>{recipe.name}</strong><small>{recipe.id.toUpperCase()}</small></span>
                <em>{recipe.enabled === false ? '已停用' : '参与仿真'}</em>
              </button>
            ))}
            {recipes.length === 0 && <div className="fm-route-empty">还没有配方。点击右上角新建第一条输入→输出关系。</div>}
          </div>
        </section>

        <section className="fm-route-panel fm-route-detail-panel">
          <div className="fm-route-panel-heading"><span>RECIPE DEFINITION</span><b>{selected?.name ?? '请选择配方'}</b></div>
          {selected ? <RecipeDetail recipe={selected} items={items} onEdit={() => setEditorRecipeId(selected.id)} onDelete={() => removeRecipe(selected.id)} /> : <div className="fm-route-empty fm-route-empty-large">从左侧选择配方，查看输入、处理周期和输出。</div>}
        </section>

        <section className="fm-route-panel fm-route-flow-panel">
          <div className="fm-route-panel-heading"><span>MATERIAL FLOW</span><b>当前工艺链</b></div>
          <div className="fm-route-flow-list">
            {recipes.map((recipe, index) => (
              <div key={recipe.id} className="fm-route-flow-step">
                <span className="fm-route-flow-node"><i>{String(index + 1).padStart(2, '0')}</i>{lineSummary(recipe.inputs, items)}</span>
                <span className="fm-route-flow-connector"><b>→</b><small>{recipe.durationSec}s</small></span>
                <span className="fm-route-flow-node is-output">{lineSummary(recipe.outputs, items)}</span>
              </div>
            ))}
            {recipes.length === 0 && <div className="fm-route-empty">暂无工艺链。</div>}
          </div>
          <div className="fm-route-audit"><b>执行口径</b><span>配方在本页维护；基础加工机器只能从“机械制造”录入这里已经建立且端口容量相容的路线。</span></div>
        </section>
      </div>

      {editorRecipeId !== undefined && (
        <section className="fm-route-editor-overlay" role="dialog" aria-label={editorRecipeId ? '编辑生产工艺' : '新建生产工艺'}>
          <header>
            <div><span>PROCESS ROUTE EDITOR</span><h2>{editorRecipeId ? '编辑生产工艺' : '新建生产工艺'}</h2><p>保存后返回原有路线总览，机械制造会读取更新后的路线。</p></div>
            <button type="button" onClick={() => setEditorRecipeId(undefined)} aria-label="关闭工艺编辑器">×</button>
          </header>
          <main><RecipePanel key={editorRecipeId ?? 'new'} initialRecipeId={editorRecipeId ?? undefined} onDone={() => setEditorRecipeId(undefined)} /></main>
        </section>
      )}
    </section>
  )
}

function RecipeDetail({ recipe, items, onEdit, onDelete }: { recipe: Recipe; items: ReturnType<typeof useForgeMindStore.getState>['items']; onEdit: () => void; onDelete: () => void }) {
  return (
    <div className="fm-route-detail">
      <p className="fm-route-detail-copy">{recipe.name} 将输入物料转化为输出物料，并在仿真中作为机器可绑定的工艺关系。</p>
      <div className="fm-route-definition">
        <RouteGroup label="INPUT / 输入" lines={recipe.inputs} items={items} />
        <div className="fm-route-process"><span>处理周期</span><strong>{recipe.durationSec} 秒</strong><small>标准处理时间</small></div>
        <div className="fm-route-arrow">→</div>
        <RouteGroup label="OUTPUT / 输出" lines={recipe.outputs} items={items} output />
      </div>
      <dl className="fm-route-meta">
        <div><dt>配方编码</dt><dd>{recipe.id}</dd></div>
        <div><dt>输入种类</dt><dd>{recipe.inputs.length}</dd></div>
        <div><dt>输出种类</dt><dd>{recipe.outputs.length}</dd></div>
        <div><dt>运行状态</dt><dd>{recipe.enabled === false ? '已停用' : '参与仿真'}</dd></div>
      </dl>
      <footer className="fm-route-detail-actions"><span>工艺定义仅在本页维护</span><div><button type="button" className="is-edit" onClick={onEdit}>编辑配方</button><button type="button" onClick={onDelete}>删除配方</button></div></footer>
    </div>
  )
}

function RouteGroup({ label, lines, items, output = false }: { label: string; lines: RecipePort[]; items: ReturnType<typeof useForgeMindStore.getState>['items']; output?: boolean }) {
  return <div className={`fm-route-group ${output ? 'is-output' : ''}`}><span>{label}</span>{lines.map((line, index) => <div key={`${line.itemId}-${index}`}><strong>{itemName(items, line.itemId)}</strong><small>× {line.qty}</small></div>)}</div>
}

function itemName(items: ReturnType<typeof useForgeMindStore.getState>['items'], id: string) {
  return items.find((item) => item.id === id)?.name ?? id
}

function lineSummary(lines: RecipePort[], items: ReturnType<typeof useForgeMindStore.getState>['items']) {
  return lines.map((line) => `${itemName(items, line.itemId)}×${line.qty}`).join(' + ') || '未绑定'
}
