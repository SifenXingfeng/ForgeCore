import { useEffect, useId, useState, type CSSProperties } from 'react'

export interface ModelPreviewProps {
  src?: string | null
  alt: string
  fallbackLabel?: string
  accentColor?: string
  className?: string
  style?: CSSProperties
  fit?: 'contain' | 'cover'
  onLoad?: () => void
  onError?: () => void
}

type LoadState = 'empty' | 'loading' | 'loaded' | 'error'

function GeometryFallback({ label, accentColor, hidden }: { label: string; accentColor: string; hidden: boolean }) {
  const gradientId = useId().replace(/:/gu, '')
  return (
    <div
      role={hidden ? undefined : 'img'}
      aria-hidden={hidden || undefined}
      aria-label={hidden ? undefined : `${label}：暂无可用预览图`}
      style={{
        alignItems: 'center',
        background: 'radial-gradient(circle at 50% 35%, rgba(42, 85, 100, .34), transparent 48%), linear-gradient(145deg, #111d25, #091118)',
        display: 'flex',
        height: '100%',
        justifyContent: 'center',
        minHeight: 72,
        overflow: 'hidden',
        position: 'relative',
        width: '100%',
      }}
    >
      <svg aria-hidden="true" viewBox="0 0 160 112" width="78%" height="78%" style={{ maxHeight: 126, maxWidth: 180 }}>
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#78919e" />
            <stop offset="1" stopColor="#263945" />
          </linearGradient>
        </defs>
        <path d="M80 15 130 41 80 67 30 41Z" fill={`url(#${gradientId})`} stroke={accentColor} strokeOpacity=".72" />
        <path d="M30 41v36l50 24V67Z" fill="#172731" stroke={accentColor} strokeOpacity=".44" />
        <path d="M130 41v36l-50 24V67Z" fill="#263d48" stroke={accentColor} strokeOpacity=".44" />
        <path d="M54 56v16l26 13 26-13V56" fill="none" stroke={accentColor} strokeOpacity=".5" strokeDasharray="3 4" />
        <circle cx="80" cy="67" r="3.5" fill={accentColor} />
      </svg>
      <span
        style={{
          bottom: 8,
          color: '#8098a1',
          font: '9px/1.2 Inter, "Microsoft YaHei", sans-serif',
          left: 8,
          letterSpacing: '.06em',
          overflow: 'hidden',
          position: 'absolute',
          right: 8,
          textAlign: 'center',
          textOverflow: 'ellipsis',
          textTransform: 'uppercase',
          whiteSpace: 'nowrap',
        }}
      >
        {label}
      </span>
    </div>
  )
}

export function ModelPreview({
  src,
  alt,
  fallbackLabel = '几何预览',
  accentColor = '#3bd9ed',
  className,
  style,
  fit = 'contain',
  onLoad,
  onError,
}: ModelPreviewProps) {
  const [loadState, setLoadState] = useState<LoadState>(src ? 'loading' : 'empty')

  useEffect(() => {
    setLoadState(src ? 'loading' : 'empty')
  }, [src])

  return (
    <div
      className={className}
      data-preview-state={loadState}
      style={{
        background: '#0b151d',
        border: '1px solid rgba(83, 126, 140, .24)',
        borderRadius: 7,
        minHeight: 72,
        overflow: 'hidden',
        position: 'relative',
        ...style,
      }}
    >
      <GeometryFallback label={fallbackLabel} accentColor={accentColor} hidden={loadState === 'loaded'} />
      {src && loadState !== 'error' ? (
        <img
          src={src}
          alt={alt}
          loading="lazy"
          decoding="async"
          draggable={false}
          onLoad={() => {
            setLoadState('loaded')
            onLoad?.()
          }}
          onError={() => {
            setLoadState('error')
            onError?.()
          }}
          style={{
            background: '#0b151d',
            display: 'block',
            height: '100%',
            inset: 0,
            objectFit: fit,
            opacity: loadState === 'loaded' ? 1 : 0,
            position: 'absolute',
            transition: 'opacity 160ms ease-out',
            width: '100%',
          }}
        />
      ) : null}
      {loadState === 'loading' ? (
        <span
          role="status"
          aria-label="正在加载模型预览"
          style={{
            background: accentColor,
            borderRadius: 99,
            boxShadow: `0 0 10px ${accentColor}`,
            height: 5,
            position: 'absolute',
            right: 8,
            top: 8,
            width: 5,
          }}
        />
      ) : null}
    </div>
  )
}

export default ModelPreview
