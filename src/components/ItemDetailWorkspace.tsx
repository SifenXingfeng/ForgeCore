import { ItemPanel } from './ItemPanel'

export function ItemDetailWorkspace({ onClose }: { onClose: () => void }) {
  return (
    <section className="fm-manufacturing-workspace fm-item-detail-workspace" aria-label="物品详情工作区">
      <header className="fm-manufacturing-head">
        <div>
          <span>ITEM DETAILS / BUSINESS OBJECT LIBRARY</span>
          <h2>物品详情</h2>
          <p>独立维护物品 ID、业务参数和三维模型；生产路线只引用这里已经存在的物品。</p>
        </div>
        <button type="button" onClick={onClose} aria-label="关闭物品详情">×</button>
      </header>
      <main><ItemPanel /></main>
    </section>
  )
}
