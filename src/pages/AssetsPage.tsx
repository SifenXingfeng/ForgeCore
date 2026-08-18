import { useEffect, useMemo, useState } from 'react'
import { Boxes, FileCheck2, PackageOpen, ShieldCheck } from 'lucide-react'
import { ModelPreview } from '../components/factory/ModelPreview'
import { Panel, StatusBadge } from '../components/ui'

interface CatalogModel { id: string; nameZh: string; category: string; previewPath: string; metrics: { triangleCount: number; glbBytes?: number } }
interface CoreCatalog { modelCount: number; models: CatalogModel[] }

const vendorAssets = [
  { id: 'kenney', name: 'Kenney Factory Kit 3.0', scope: '143 个轻量工厂 GLB', license: 'CC0 1.0', tone: 'success' as const, status: '视觉可用', note: '保留 GLB format 与 Textures 的原始相对目录关系', path: 'assets/3d/vendor/kenney-factory-kit-3.0/' },
  { id: 'warehouse', name: 'Low-poly Warehouse Kit', scope: '开放式大货架、容器与仓库原件', license: 'CC0 1.0', tone: 'success' as const, status: '视觉可用', note: 'mastjie rack.glb 用于独立货架视觉并组合 Kenney 货物陈列；货物仓库仍使用 Kenney 候选 F', path: 'assets/3d/vendor/mastjie-low-poly-warehouse-kit/' },
  { id: 'agv', name: 'Industrial AGV Trolley', scope: '3.24 MB · 73,645 tris', license: 'CC BY 4.0', tone: 'warning' as const, status: '业务可用 · 视觉待派生', note: 'Cels 主体以 2× 视觉尺度展示；A*、安全包络、库存与调度来自独立业务层，不将 vendor 网格标记为 derived-ready', path: 'assets/3d/vendor/cels-industrial-agv-trolley/' },
  { id: 'drone', name: 'Futuristic Delivery Drone', scope: '6.39 MB · 10 张内嵌纹理', license: 'CC BY 4.0', tone: 'warning' as const, status: '业务可用 · 视觉待派生', note: 'Count Infinity 主体已作为单实例视觉层接入；26 邻域三维 A*、载荷、库存与多机协调来自独立业务层，不将 vendor 原件标记为 derived-ready', path: 'assets/3d/vendor/count-infinity-futuristic-delivery-drone/' },
]

export function AssetsPage() {
  const [catalog, setCatalog] = useState<CoreCatalog | null>(null)
  useEffect(() => { fetch('/3d/core/items/v1/catalog.json').then((response) => response.json()).then(setCatalog).catch(() => setCatalog(null)) }, [])
  const triangles = useMemo(() => catalog?.models.reduce((sum, model) => sum + model.metrics.triangleCount, 0) ?? 0, [catalog])
  const samples = catalog?.models.filter((_, index) => index % 7 === 0).slice(0, 5) ?? []
  return (
    <div className="page">
      <header className="page-heading"><div><span className="eyebrow">3D ASSET GOVERNANCE / RUNTIME READINESS</span><h1>三维资产中心</h1><p>统一查看项目原创模型、第三方原件、许可边界与运行时适用状态。资产入库不等于仿真语义就绪</p></div><StatusBadge tone="success"><ShieldCheck size={13} />审计规则已接入</StatusBadge></header>

      <div className="asset-summary">
        <article><Boxes /><span><strong>{catalog?.modelCount ?? '—'}</strong>核心默认模型</span><StatusBadge tone="success">GLB-only</StatusBadge></article>
        <article><PackageOpen /><span><strong>{vendorAssets.length}</strong>第三方资产组</span><StatusBadge tone="info">来源已登记</StatusBadge></article>
        <article><FileCheck2 /><span><strong>{triangles.toLocaleString('zh-CN')}</strong>核心三角形</span><StatusBadge tone="success">轻量可用</StatusBadge></article>
      </div>

      <Panel title="ForgeCore 默认基础模型" eyebrow="FIRST-PARTY CORE / V1" action={<span className="path-label">assets/3d/core/items/v1/</span>}>
        <div className="core-model-strip">{samples.map((model) => <article key={model.id}><ModelPreview src={`/3d/core/items/v1/${model.previewPath}`} alt={model.nameZh} /><div><strong>{model.nameZh}</strong><small>{model.id}</small></div><span>{model.metrics.triangleCount} tris</span></article>)}</div>
        <div className="asset-callout"><FileCheck2 /><div><strong>运行时入口：catalog.json</strong></div></div>
      </Panel>

      <section className="vendor-section"><div className="section-heading"><div><span className="eyebrow">VENDOR ASSETS</span><h2>第三方资产</h2></div></div><div className="vendor-grid">{vendorAssets.map((asset) => <article className="vendor-card" key={asset.id}><div className="vendor-card__top"><span className={`vendor-symbol vendor-symbol--${asset.id}`}>{asset.id === 'drone' ? 'DR' : asset.id === 'agv' ? 'AG' : asset.id === 'kenney' ? 'KF' : 'WH'}</span><StatusBadge tone={asset.tone}>{asset.status}</StatusBadge></div><h3>{asset.name}</h3><p>{asset.scope}</p><dl><div><dt>许可</dt><dd>{asset.license}</dd></div></dl><code>{asset.path}</code></article>)}</div></section>
    </div>
  )
}
