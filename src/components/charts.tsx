export function Sparkline({ values, color = '#2d9c73', height = 72 }: { values: number[]; color?: string; height?: number }) {
  const width = 320
  const max = Math.max(...values, 1)
  const min = Math.min(...values, 0)
  const range = Math.max(1, max - min)
  const points = values.map((value, index) => {
    const x = values.length <= 1 ? 0 : (index / (values.length - 1)) * width
    const y = height - 7 - ((value - min) / range) * (height - 14)
    return `${x},${y}`
  }).join(' ')
  return (
    <svg className="sparkline" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="趋势图">
      <defs>
        <linearGradient id={`fill-${color.replace('#', '')}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={color} stopOpacity=".24" />
          <stop offset="1" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={`0,${height} ${points} ${width},${height}`} fill={`url(#fill-${color.replace('#', '')})`} />
      <polyline points={points} fill="none" stroke={color} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function MiniBars({ values, labels }: { values: number[]; labels?: string[] }) {
  const max = Math.max(...values, 1)
  return (
    <div className="mini-bars" role="img" aria-label="柱状对比图">
      {values.map((value, index) => (
        <div className="mini-bars__item" key={`${value}-${index}`}>
          <div className="mini-bars__track"><span style={{ height: `${Math.max(5, value / max * 100)}%` }} /></div>
          <small>{labels?.[index] ?? index + 1}</small>
        </div>
      ))}
    </div>
  )
}
