import type { FactoryFloorId } from '../game/types'
import type { FactoryFloorDefinition } from '../game/floorConfig'

export function FloorSwitcher({
  activeFloor,
  visibleFloors,
  floors,
  onChange,
  onToggleVisibility,
  onAddFloor,
  onRenameFloor,
  canAddFloor = true,
}: {
  activeFloor: FactoryFloorId
  visibleFloors: ReadonlySet<FactoryFloorId>
  floors: readonly FactoryFloorDefinition[]
  onChange: (floor: FactoryFloorId) => void
  onToggleVisibility: (floor: FactoryFloorId) => void
  onAddFloor: () => void
  onRenameFloor: (floor: FactoryFloorId, name: string) => void
  canAddFloor?: boolean
}) {
  const current = floors.find((floor) => floor.id === activeFloor) ?? floors[0]
  if (!current) return null
  return (
    <div className="fm-floor-switcher" aria-label="楼层切换">
      <div className="fm-floor-switcher-head">
        <span>VERTICAL GRID</span>
        <b>{String(activeFloor).padStart(2, '0')} / {String(floors.length).padStart(2, '0')}</b>
      </div>
      <div className="fm-floor-switcher-list">
        {floors.map((floor) => (
          <div key={floor.id} className={`fm-floor-switcher-row${floor.id === activeFloor ? ' is-active' : ''}${visibleFloors.has(floor.id) ? '' : ' is-hidden'}`}>
            <button
              type="button"
              className="fm-floor-select"
              aria-pressed={floor.id === activeFloor}
              onClick={() => onChange(floor.id)}
            >
              <span>{floor.code}</span>
              <input
                value={floor.name}
                aria-label={`${floor.code} 楼层名称`}
                onClick={(event) => event.stopPropagation()}
                onChange={(event) => onRenameFloor(floor.id, event.target.value)}
              />
            </button>
            <button
              type="button"
              className="fm-floor-visibility"
              aria-label={`${visibleFloors.has(floor.id) ? '关闭' : '开启'} ${floor.name}上下文显示`}
              aria-pressed={visibleFloors.has(floor.id)}
              title={floor.id === activeFloor ? '当前层仍由选择优先显示；此开关将在切走后生效' : visibleFloors.has(floor.id) ? '隐藏此层只读上下文' : '显示此层只读上下文'}
              onClick={() => onToggleVisibility(floor.id)}
            >
              <i />
            </button>
          </div>
        ))}
      </div>
      <button type="button" className="fm-floor-add" onClick={onAddFloor} disabled={!canAddFloor}>
        <span>＋</span> 添加楼层
      </button>
      <div className="fm-floor-switcher-foot">
        <strong>{current.description}</strong>
        <span>{current.elevation.toFixed(1)}M DATUM / ACTIVE GRID · {visibleFloors.size} CONTEXT · READ-ONLY</span>
      </div>
    </div>
  )
}
