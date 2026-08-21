import { OBJECT_DEFS } from '../game/types'
import type { BuildType } from '../game/types'

const ATLAS_POSITION: Record<BuildType, [number, number]> = {
  source: [0, 0],
  oreMiner: [1, 0],
  inboundWarehouse: [0, 0],
  outboundWarehouse: [3, 2],
  smelter: [2, 0],
  press: [3, 0],
  washing: [0, 1],
  assembler: [1, 1],
  inspection: [2, 1],
  conveyor: [3, 1],
  inclineUp: [3, 1],
  inclineDown: [3, 1],
  splitter: [0, 2],
  merger: [1, 2],
  agv: [2, 2],
  drone: [1, 3],
  storage: [3, 2],
  machine: [0, 3],
  imported: [2, 3],
}

export function EquipmentThumbnail({ type, previewDataUrl }: { type: BuildType; previewDataUrl?: string }) {
  const equipment = OBJECT_DEFS[type]
  const [column, row] = ATLAS_POSITION[type]
  const position = `${column * (100 / 3)}% ${row * (100 / 3)}%`

  return (
    <span className="fm-equipment-visual" aria-hidden="true">
      {previewDataUrl ? <img className="fm-equipment-imported-image" src={previewDataUrl} alt="" /> : <span className="fm-equipment-static-image" style={{ backgroundPosition: position }} />}
      <span className="fm-equipment-visual-label">CATALOG / {equipment.model}</span>
    </span>
  )
}
