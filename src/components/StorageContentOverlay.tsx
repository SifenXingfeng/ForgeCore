import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import type { FactoryObject } from '../game/types'
import { useForgeMindStore } from '../store/forgeMind'

interface Props {
  obj: FactoryObject
  label: string
  onClose: () => void
}

export function StorageContentOverlay({ obj, label, onClose }: Props) {
  const items = useForgeMindStore((state) => state.items)
  const rack = useForgeMindStore((state) => state.simSnapshot.racks.find((entry) => entry.objectId === obj.id))
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  const entries = Object.entries(rack?.inventory ?? obj.storageConfig?.initialInventory ?? {})
  const total = entries.reduce((sum, [, quantity]) => sum + quantity, 0)
  const capacityLabel = obj.type === 'inboundWarehouse' ? '无限供货' : obj.type === 'outboundWarehouse' ? '无限容量' : `${total} / ${rack?.capacity ?? obj.storageConfig?.capacity ?? 100}`
  const node = (
    <div className="fm-storage-query-layer" role="presentation" onClick={onClose}>
      <section className="fm-storage-query" role="dialog" aria-modal="true" aria-label={`${label}内容物`} onClick={(event) => event.stopPropagation()}>
        <header className="fm-storage-query-head">
          <div>
            <span className="fm-eyebrow">CONTENTS / {obj.id.slice(-6)}</span>
            <h3>{label} · 内容物查询</h3>
          </div>
          <button type="button" onClick={onClose} aria-label="关闭内容物查询">×</button>
        </header>
        <div className="fm-storage-query-body">
          <span className="fm-storage-query-label">当前存储物 · {capacityLabel}</span>
          {obj.type === 'inboundWarehouse' && <div className="fm-storage-query-item"><span className="fm-storage-query-dot" /><strong>{items.find((item) => item.id === obj.itemId)?.name ?? '未选择物品'} · ∞</strong></div>}
          {entries.map(([itemId, quantity]) => <div className="fm-storage-query-item" key={itemId}><span className="fm-storage-query-dot" /><strong>{items.find((item) => item.id === itemId)?.name ?? itemId} × {quantity}</strong></div>)}
          {obj.type !== 'inboundWarehouse' && entries.length === 0 && <div className="fm-storage-query-item"><strong>{obj.type === 'outboundWarehouse' ? '尚无产出入库' : '空货架'}</strong></div>}
        </div>
      </section>
    </div>
  )

  return createPortal(node, document.body)
}
