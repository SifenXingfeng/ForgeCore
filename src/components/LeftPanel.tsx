import { useEffect, useRef, useState } from 'react'
import { useForgeMindStore } from '../store/forgeMind'
import { BuildMenu } from './BuildMenu'
import { ItemPanel } from './ItemPanel'
import { RecipePanel } from './RecipePanel'
import { downloadSave, parseSave, readFileAsText } from '../game/save'

type Tab = 'build' | 'item' | 'recipe'

/**
 * 旧版左侧栏主容器。文件按钮只负责显式 JSON 导入/导出；
 * 当前后端项目保存统一由 FactoryProjectControls 负责。
 */
export function LeftPanel({ focus }: { focus?: Tab }) {
  const [tab, setTab] = useState<Tab>('build')
  const exportSave = useForgeMindStore((s) => s.exportSave)
  const importSave = useForgeMindStore((s) => s.importSave)
  const clearAll = useForgeMindStore((s) => s.clearAll)
  const fileInput = useRef<HTMLInputElement>(null)
  const [msg, setMsg] = useState<string | null>(null)

  useEffect(() => {
    if (focus) setTab(focus)
  }, [focus])

  const tabs: { key: Tab; label: string }[] = [
    { key: 'build', label: '建造' },
    { key: 'item', label: '物品' },
    { key: 'recipe', label: '配方' },
  ]

  const flash = (text: string) => {
    setMsg(text)
    setTimeout(() => setMsg(null), 2000)
  }

  const onSave = () => {
    downloadSave(exportSave())
    flash('已导出存档')
  }

  const onLoadClick = () => fileInput.current?.click()

  const onLoadFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    try {
      const text = await readFileAsText(f)
      const save = parseSave(text)
      importSave(save)
      flash('已加载存档')
    } catch (err) {
      flash(`加载失败：${err instanceof Error ? err.message : String(err)}`)
    }
  }

  return (
    <div className="flex h-full flex-col">
      {/* tab 栏 */}
      <div className="flex border-b" style={{ borderColor: 'var(--fm-edge)' }}>
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className="flex-1 border-r px-1 py-1.5 text-xs transition-colors last:border-r-0"
            style={{
              borderColor: 'var(--fm-edge)',
              color: tab === t.key ? 'var(--fm-accent)' : 'var(--fm-text-dim)',
              background: tab === t.key ? 'rgba(79,195,247,0.08)' : 'transparent',
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* 内容区 */}
      <div className="flex-1 overflow-y-auto">
        {tab === 'build' && <BuildMenu />}
        {tab === 'item' && <ItemPanel />}
        {tab === 'recipe' && <RecipePanel />}
      </div>

      {/* 底部操作区 */}
      <div className="border-t p-2" style={{ borderColor: 'var(--fm-edge)' }}>
        <div className="flex gap-1">
          <button
            onClick={onSave}
            className="flex-1 border px-1 py-1 text-xs text-[var(--fm-ok)] transition-colors hover:bg-[rgba(102,187,106,0.10)]"
            style={{ borderColor: 'var(--fm-ok)' }}
          >
            导出 JSON
          </button>
          <button
            onClick={onLoadClick}
            className="flex-1 border px-1 py-1 text-xs text-[var(--fm-accent)] transition-colors hover:bg-[rgba(79,195,247,0.10)]"
            style={{ borderColor: 'var(--fm-accent)' }}
          >
            导入 JSON
          </button>
          <button
            onClick={() => {
              if (window.confirm('清空当前工厂（对象/物品/配方）？')) {
                clearAll()
                flash('已清空')
              }
            }}
            className="flex-1 border px-1 py-1 text-xs text-[var(--fm-danger)] transition-colors hover:bg-[rgba(239,83,80,0.10)]"
            style={{ borderColor: 'var(--fm-danger)' }}
          >
            清空
          </button>
        </div>
        <input ref={fileInput} type="file" accept=".json,application/json" className="hidden" onChange={onLoadFile} />
        {msg && (
          <p className="mt-1.5 text-center font-mono text-[10px] text-[var(--fm-text-dim)]">{msg}</p>
        )}
      </div>
    </div>
  )
}
