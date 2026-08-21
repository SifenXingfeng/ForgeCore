import { useEffect, type ReactNode } from 'react'

export function WorkbenchModal({ title, subtitle, wide = false, children, onClose }: { title: string; subtitle?: string; wide?: boolean; children: ReactNode; onClose: () => void }) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])
  return <div className="fm-workbench-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose() }}>
    <section className={`fm-workbench-modal${wide ? ' is-wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
      <header className="fm-workbench-modal-head"><div><span>FORGEMIND WORKBENCH</span><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div><button type="button" onMouseDown={(event) => { event.preventDefault(); event.stopPropagation(); onClose() }} onClick={(event) => { event.stopPropagation(); onClose() }} aria-label={`关闭${title}`}>×</button></header>
      {children}
    </section>
  </div>
}
