import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { EquipmentCategory, ImportedResource, ObjectRole, PortSide } from '../game/types'
import { importResourcePack, type ResourceImportForm } from '../game/resourcePack'
import { persistImportedResource } from '../api/resources'

const DEFAULT_FORM: ResourceImportForm = {
  id: '',
  name: '',
  category: '加工',
  role: 'machine',
  subtitle: 'IMPORTED RESOURCE',
  description: '',
  width: 2,
  depth: 2,
  height: 1.5,
  throughput: '',
  power: '',
  inputPort: 'back',
  outputPort: 'front',
}

export function ResourceImportDialog({ open, onClose, onImported }: { open: boolean; onClose: () => void; onImported: (resource: ImportedResource) => void }) {
  const [projectFile, setProjectFile] = useState<File | null>(null)
  const [modelFile, setModelFile] = useState<File | null>(null)
  const [form, setForm] = useState<ResourceImportForm>(DEFAULT_FORM)
  const [error, setError] = useState('')
  const [isImporting, setIsImporting] = useState(false)

  const fileSummary = useMemo(() => {
    if (!projectFile && !modelFile) return '拖入资源定义 JSON 与 GLB 模型，或点击选择文件'
    return `${projectFile ? `JSON · ${projectFile.name}` : 'JSON · 待选择'}  /  ${modelFile ? `GLB · ${modelFile.name}` : 'GLB · 待选择'}`
  }, [modelFile, projectFile])

  if (!open) return null

  const update = <K extends keyof ResourceImportForm>(key: K, value: ResourceImportForm[K]) => setForm((current) => ({ ...current, [key]: value }))
  const acceptFiles = (files: FileList | File[]) => {
    const entries = Array.from(files)
    const json = entries.find((file) => file.name.toLowerCase().endsWith('.json'))
    const glb = entries.find((file) => file.name.toLowerCase().endsWith('.glb'))
    if (json) setProjectFile(json)
    if (glb) setModelFile(glb)
    if (!json && !glb) setError('请提供一个 JSON 资源定义文件和一个 GLB 模型文件')
    else setError('')
  }

  const submit = async () => {
    if (!projectFile || !modelFile) {
      setError('还缺少资源定义 JSON 或 GLB 模型文件')
      return
    }
    if (!form.name.trim()) {
      setError('请填写设备名称')
      return
    }
    setIsImporting(true)
    setError('')
    try {
      const resource = await importResourcePack(projectFile, modelFile, form)
      const savedResource = await persistImportedResource(projectFile, modelFile, resource)
      onImported(savedResource)
      setProjectFile(null)
      setModelFile(null)
      setForm(DEFAULT_FORM)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '资源导入失败')
    } finally {
      setIsImporting(false)
    }
  }

  return createPortal((
    <div className="fm-resource-import-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <section className="fm-resource-import-dialog" role="dialog" aria-modal="true" aria-labelledby="resource-import-title">
        <header className="fm-resource-import-head">
          <div><span>设备资源 / IMPORT</span><h2 id="resource-import-title">导入新设备</h2><p>添加设备参数和三维模型，完成后即可在建造目录中使用。</p></div>
          <button type="button" className="fm-resource-import-close" onClick={onClose} aria-label="关闭导入窗口">×</button>
        </header>

        <div className="fm-resource-import-body">
          <div className="fm-resource-import-drop" onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); acceptFiles(event.dataTransfer.files) }}>
            <div className="fm-resource-import-drop-mark">↥</div>
            <strong>{fileSummary}</strong>
            <small>支持 .forgemind-project.json / .json 与 .glb，可分别选择</small>
            <div className="fm-resource-import-file-actions">
              <label>选择 JSON<input type="file" accept=".json,application/json" onChange={(event) => event.target.files && acceptFiles(event.target.files)} /></label>
              <label>选择 GLB<input type="file" accept=".glb,model/gltf-binary" onChange={(event) => event.target.files && acceptFiles(event.target.files)} /></label>
            </div>
          </div>

          <div className="fm-resource-import-form">
            <div className="fm-resource-import-form-title"><span>设备参数</span><b>填写设备信息</b></div>
            <div className="fm-resource-import-fields">
              <Field label="设备名称"><input value={form.name} onChange={(event) => update('name', event.target.value)} placeholder="例如：VMC-850 立式加工中心" /></Field>
              <Field label="设备编码"><input value={form.id} onChange={(event) => update('id', event.target.value)} placeholder="自动生成稳定 ID" /></Field>
              <Field label="设备类别"><select value={form.category} onChange={(event) => update('category', event.target.value as EquipmentCategory)}><option value="采集">原料采集</option><option value="加工">基础加工</option><option value="装配">精密装配</option><option value="物流">物流仓储</option></select></Field>
              <Field label="设备角色"><select value={form.role} onChange={(event) => update('role', event.target.value as ObjectRole)}><option value="machine">加工设备</option><option value="conveyor">物流节点</option><option value="storage">缓存仓储</option><option value="source">来料站</option></select></Field>
              <Field label="占地宽度"><input type="number" min={1} step={1} value={form.width} onChange={(event) => update('width', Number(event.target.value) || 1)} /></Field>
              <Field label="占地深度"><input type="number" min={1} step={1} value={form.depth} onChange={(event) => update('depth', Number(event.target.value) || 1)} /></Field>
              <Field label="设备高度 / m"><input type="number" min={0.2} step={0.1} value={form.height} onChange={(event) => update('height', Number(event.target.value) || 0.2)} /></Field>
              <Field label="额定吞吐"><input value={form.throughput} onChange={(event) => update('throughput', event.target.value)} placeholder="例如：18 / min" /></Field>
              <Field label="功率"><input value={form.power} onChange={(event) => update('power', event.target.value)} placeholder="例如：22 kW" /></Field>
              <Field label="输入端口"><select value={form.inputPort} onChange={(event) => update('inputPort', event.target.value as PortSide)}><option value="back">后侧</option><option value="front">前侧</option><option value="left">左侧</option><option value="right">右侧</option></select></Field>
              <Field label="输出端口"><select value={form.outputPort} onChange={(event) => update('outputPort', event.target.value as PortSide)}><option value="front">前侧</option><option value="back">后侧</option><option value="left">左侧</option><option value="right">右侧</option></select></Field>
              <Field label="目录副标题"><input value={form.subtitle} onChange={(event) => update('subtitle', event.target.value)} /></Field>
            </div>
            <Field label="功能说明"><textarea rows={2} value={form.description} onChange={(event) => update('description', event.target.value)} placeholder="描述它在工厂中的作用，便于建造和诊断页面识别" /></Field>
          </div>
        </div>

        <footer className="fm-resource-import-foot">
          <div>{error ? <span className="fm-resource-import-error">! {error}</span> : <span><i /> 导入后会自动生成模型封面，并加入建造目录。</span>}</div>
          <div className="fm-resource-import-actions"><button type="button" onClick={onClose}>取消</button><button type="button" className="is-primary" disabled={isImporting} onClick={() => void submit()}>{isImporting ? '正在保存资源…' : '导入设备'}</button></div>
        </footer>
      </section>
    </div>
  ), document.body)
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="fm-resource-import-field"><span>{label}</span>{children}</label>
}
