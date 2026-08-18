import type { ReactNode } from 'react'
import { AlertTriangle, CheckCircle2, Info, X } from 'lucide-react'

export function Panel({
  title,
  eyebrow: _eyebrow,
  action,
  children,
  className = '',
}: {
  title?: string
  eyebrow?: string
  action?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section className={`panel ${className}`}>
      {(title || action) && (
        <header className="panel__header">
          <div>
            {title && <h2>{title}</h2>}
          </div>
          {action && <div className="panel__action">{action}</div>}
        </header>
      )}
      <div className="panel__body">{children}</div>
    </section>
  )
}

export function StatusBadge({
  tone = 'neutral',
  children,
}: {
  tone?: 'neutral' | 'success' | 'info' | 'warning' | 'danger'
  children: ReactNode
}) {
  const Icon = tone === 'success' ? CheckCircle2 : tone === 'warning' || tone === 'danger' ? AlertTriangle : Info
  return (
    <span className={`status-badge status-badge--${tone}`}>
      <Icon aria-hidden="true" size={13} />
      {children}
    </span>
  )
}

export function MetricCard({
  label,
  value,
  unit,
  change,
  tone = 'dark',
}: {
  label: string
  value: string | number
  unit?: string
  change?: string
  tone?: 'dark' | 'light' | 'yellow'
}) {
  return (
    <article className={`metric-card metric-card--${tone}`}>
      <span className="metric-card__label">{label}</span>
      <div className="metric-card__value">
        {value}
        {unit && <small>{unit}</small>}
      </div>
      {change && <span className="fc-sr-only">{change}</span>}
    </article>
  )
}

export function EmptyState({ icon, title, description, action }: { icon?: ReactNode; title: string; description: string; action?: ReactNode }) {
  return (
    <div className="empty-state">
      {icon && <div className="empty-state__icon">{icon}</div>}
      <h3>{title}</h3>
      <p>{description}</p>
      {action}
    </div>
  )
}

export function Modal({ title, children, onClose, wide = false }: { title: string; children: ReactNode; onClose: () => void; wide?: boolean }) {
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section className={`modal ${wide ? 'modal--wide' : ''}`} role="dialog" aria-modal="true" aria-label={title} onMouseDown={(event) => event.stopPropagation()}>
        <header className="modal__header">
          <div>
            <h2>{title}</h2>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="关闭对话框"><X size={18} /></button>
        </header>
        <div className="modal__body">{children}</div>
      </section>
    </div>
  )
}

export function Donut({ value, label, tone = 'var(--success)' }: { value: number; label: string; tone?: string }) {
  return (
    <div className="donut" style={{ '--donut-value': `${Math.max(0, Math.min(100, value)) * 3.6}deg`, '--donut-tone': tone } as React.CSSProperties}>
      <div className="donut__inner"><strong>{Math.round(value)}%</strong><span>{label}</span></div>
    </div>
  )
}
