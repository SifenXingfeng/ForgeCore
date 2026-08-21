import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import { createFactoryProject, deleteFactoryProject, fetchFactoryProject, listFactoryProjects, updateFactoryAutosave, updateFactoryProject, type FactoryProjectSummary } from '../api/factoryProjects'
import { downloadSave, parseSave, readFileAsText } from '../game/save'
import { useForgeMindStore } from '../store/forgeMind'

function formatSavedAt(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '时间未知'
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).format(date)
}

export function FactoryProjectDialog({
  open,
  required = false,
  currentProject,
  onReady,
  onProjectDeleted,
  onClose,
}: {
  open: boolean
  required?: boolean
  currentProject: FactoryProjectSummary | null
  onReady: (project: FactoryProjectSummary | null) => void
  onProjectDeleted?: (projectId: string) => void
  onClose?: () => void
}) {
  const [name, setName] = useState('未命名工厂')
  const [projects, setProjects] = useState<FactoryProjectSummary[]>([])
  const [busyId, setBusyId] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)
  const newFactory = useForgeMindStore((state) => state.newFactory)
  const importSave = useForgeMindStore((state) => state.importSave)
  const exportSave = useForgeMindStore((state) => state.exportSave)
  const factoryName = useForgeMindStore((state) => state.factoryName)

  const refresh = async () => {
    setLoading(true)
    try {
      setProjects(await listFactoryProjects())
      setError('')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '后端项目列表加载失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (open) void refresh()
  }, [open])

  if (!open) return null

  const create = async () => {
    setBusyId('create')
    try {
      newFactory(name)
      setError('')
      onReady(null)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '工厂创建失败')
    } finally {
      setBusyId(null)
    }
  }

  const openProject = async (project: FactoryProjectSummary) => {
    setBusyId(project.id)
    try {
      const detail = await fetchFactoryProject(project.id)
      const raw = detail.save && typeof detail.save === 'object'
        ? { ...detail.save, name: detail.project.name }
        : detail.save
      importSave(parseSave(JSON.stringify(raw)))
      setError('')
      onReady(project.autosave ? null : detail.project)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '存档加载失败')
    } finally {
      setBusyId(null)
    }
  }

  const importJson = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setBusyId('import')
    try {
      const save = parseSave(await readFileAsText(file))
      importSave(save)
      setError('')
      onReady(null)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'JSON 导入失败')
    } finally {
      setBusyId(null)
    }
  }

  const deleteProject = async (project: FactoryProjectSummary) => {
    const label = project.autosave ? '清除自动恢复存档' : `删除存档“${project.name}”`
    if (!window.confirm(`${label}？此操作无法撤销。`)) return
    setBusyId(`delete:${project.id}`)
    try {
      await deleteFactoryProject(project.id)
      setProjects((current) => current.filter((entry) => entry.id !== project.id))
      if (!project.autosave) onProjectDeleted?.(project.id)
      setError('')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '存档删除失败')
    } finally {
      setBusyId(null)
    }
  }

  const safeName = factoryName.replace(/[\\/:*?"<>|]+/g, '-').trim() || 'forgemind-factory'

  return (
    <div className="fm-project-gate" role="dialog" aria-modal="true" aria-label="选择工厂项目">
      <div className="fm-project-dialog glass3d">
        {!required && <button type="button" className="fm-project-close" onClick={onClose} aria-label="关闭">×</button>}
        <div className="fm-project-kicker">FACTORY PROJECT / ACCOUNT ARCHIVE</div>
        <h1>{required ? '开始你的工厂' : '工厂项目库'}</h1>
        <p>新建与导入只进入当前会话；只有手动保存才会建立或覆盖正式存档。自动恢复始终只有置顶的一份。</p>

        <section className="fm-project-create" aria-label="新建工厂">
          <label className="fm-project-name">
            <span>新工厂名称</span>
            <input value={name} maxLength={80} onChange={(event) => setName(event.target.value)} />
          </label>
          <button type="button" className="is-primary" disabled={busyId !== null} onClick={() => void create()}>
            <b>＋</b><span>{busyId === 'create' ? '正在创建…' : '新建空白工厂'}<small>先作为未保存草稿打开</small></span>
          </button>
        </section>

        <section className="fm-project-library" aria-label="后端工厂存档">
          <div className="fm-project-library-head">
            <div><strong>我的工厂存档</strong><small>{projects.filter((project) => !project.autosave).length} 个正式存档</small></div>
            <button type="button" disabled={loading} onClick={() => void refresh()}>{loading ? '刷新中…' : '刷新'}</button>
          </div>
          <div className="fm-project-list">
            {loading && projects.length === 0 && <div className="fm-project-empty">正在读取账号存档…</div>}
            {!loading && projects.length === 0 && <div className="fm-project-empty">还没有存档。新建工厂后点击“手动保存存档”即可加入这里。</div>}
            {projects.map((project) => (
              <article
                key={project.id}
                className={`${currentProject?.id === project.id ? 'is-current ' : ''}${project.autosave ? 'is-autosave' : ''}`.trim()}
              >
                <button type="button" className="fm-project-entry" disabled={busyId !== null} onClick={() => void openProject(project)}>
                  <span className="fm-project-list-mark">{busyId === project.id ? '···' : project.autosave ? '↻' : '▦'}</span>
                  <span className="fm-project-list-copy">
                    <strong>{project.autosave ? '自动恢复 · ' : ''}{project.name}{currentProject?.id === project.id && <em>当前</em>}</strong>
                    <small>{project.autosave ? '固定恢复槽 · 每次覆盖 · ' : ''}更新于 {formatSavedAt(project.updatedAt)} · v{project.version}</small>
                  </span>
                  <span className="fm-project-list-stats">
                    <b>{project.floorCount}</b> 层&nbsp;&nbsp; <b>{project.objectCount}</b> 设施&nbsp;&nbsp; <b>{project.itemCount}</b> 物品&nbsp;&nbsp; <b>{project.recipeCount}</b> 工艺
                  </span>
                  <span className="fm-project-open">{project.autosave ? '恢复' : '打开'}</span>
                </button>
                <button type="button" className="fm-project-delete" disabled={busyId !== null} onClick={() => void deleteProject(project)}>{busyId === `delete:${project.id}` ? '…' : project.autosave ? '清除' : '删除'}</button>
              </article>
            ))}
          </div>
        </section>

        <div className="fm-project-transfer">
          <span>文件交换（辅助功能）</span>
          <button type="button" disabled={busyId !== null} onClick={() => fileRef.current?.click()}>{busyId === 'import' ? '导入中…' : '导入 JSON'}</button>
          {currentProject && <button type="button" onClick={() => downloadSave(exportSave(), `${safeName}.forgemind.json`)}>导出当前 JSON</button>}
        </div>
        <input ref={fileRef} className="fm-visually-hidden" type="file" accept="application/json,.json" onChange={importJson} />
        {error && <div className="fm-project-error" role="alert">{error}</div>}
      </div>
    </div>
  )
}

export function FactoryProjectControls({
  currentProject,
  onManage,
  onProjectChange,
}: {
  currentProject: FactoryProjectSummary | null
  onManage: () => void
  onProjectChange: (project: FactoryProjectSummary) => void
}) {
  const factoryName = useForgeMindStore((state) => state.factoryName)
  const exportSave = useForgeMindStore((state) => state.exportSave)
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')

  useEffect(() => {
    let disposed = false
    const timer = window.setInterval(() => {
      const state = useForgeMindStore.getState()
      void updateFactoryAutosave(state.factoryName, state.exportSave()).catch(() => {
        if (!disposed) console.warn('自动恢复存档写入失败；正式存档未受影响')
      })
    }, 60_000)
    return () => {
      disposed = true
      window.clearInterval(timer)
    }
  }, [])

  const saveToBackend = async () => {
    if (status === 'saving') return
    setStatus('saving')
    try {
      const save = exportSave()
      const detail = currentProject
        ? await updateFactoryProject(currentProject.id, factoryName, save)
        : await createFactoryProject(factoryName, save)
      onProjectChange(detail.project)
      setStatus('saved')
      window.setTimeout(() => setStatus((value) => value === 'saved' ? 'idle' : value), 1800)
    } catch {
      setStatus('error')
    }
  }

  return (
    <div className="fm-project-controls" aria-label="工厂存档操作">
      <button type="button" onClick={onManage}>项目库</button>
      <button type="button" className={status === 'error' ? 'is-error' : ''} disabled={status === 'saving'} onClick={() => void saveToBackend()}>
        {status === 'saving' ? '保存中…' : status === 'saved' ? '已保存' : status === 'error' ? '保存失败 · 重试' : '手动保存存档'}
      </button>
    </div>
  )
}
