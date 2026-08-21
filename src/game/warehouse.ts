import type { GridPos } from './types'

/** A-01 左侧仓储区：和 baseA01 的货架布局、AGV 任务点共用一份坐标。 */
export const WAREHOUSE_ZONE = {
  minX: -23,
  maxX: -13,
  minZ: -13,
  maxZ: -4,
}

export interface WarehouseNavPoint {
  id: string
  label: string
  position: { x: number; z: number }
  kind: 'warehouse' | 'line-side'
}

/** 点位落在网格中心，便于导航引擎和三维场景共享。 */
export const WAREHOUSE_NAV_POINTS: WarehouseNavPoint[] = [
  { id: 'warehouse-dock-east', label: '仓储东侧装卸口', position: { x: -14.5, z: -12.5 }, kind: 'warehouse' },
  { id: 'warehouse-dock-rack', label: '原料货架装卸口', position: { x: -14.5, z: -8.5 }, kind: 'warehouse' },
  { id: 'line-side-raw', label: '原料上线点', position: { x: -15.5, z: 3.5 }, kind: 'line-side' },
]

export const WAREHOUSE_RACKS: Array<{ id: string; pos: GridPos; label: string; tone: 'raw' | 'finished' }> = [
  { id: 'a01_warehouse_raw_rack_01', pos: { x: -21, z: -10 }, label: '原料货架 A', tone: 'raw' },
  { id: 'a01_warehouse_raw_rack_02', pos: { x: -17, z: -10 }, label: '原料货架 B', tone: 'raw' },
  { id: 'a01_warehouse_finished_rack_01', pos: { x: -21, z: -6 }, label: '成品缓存 A', tone: 'finished' },
  { id: 'a01_warehouse_finished_rack_02', pos: { x: -17, z: -6 }, label: '成品缓存 B', tone: 'finished' },
]

export const WAREHOUSE_AGV_ROUTE = [
  WAREHOUSE_NAV_POINTS[0],
  WAREHOUSE_NAV_POINTS[2],
  WAREHOUSE_NAV_POINTS[1],
  WAREHOUSE_NAV_POINTS[2],
]
