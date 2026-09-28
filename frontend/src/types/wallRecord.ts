import type { Stratum } from './stratum'

/** 四壁方向 */
export const WALL_KEYS = ['north', 'east', 'south', 'west'] as const
export type WallKey = (typeof WALL_KEYS)[number]

export const WALL_LABELS: Record<WallKey, string> = {
  north: '北壁',
  east: '东壁',
  south: '南壁',
  west: '西壁'
}

/** 某一地层单位在单壁上的顶界 / 底界备注 */
export interface WallBoundaryNote {
  stratumId: string
  /** 顶界备注 */
  top: string
  /** 底界备注 */
  bottom: string
}

/** WallRecord 单壁剖面记录（每个探方维护北、东、南、西四条） */
export interface WallRecord {
  /** `${trenchId}_${wall}` 确定性主键，保证一壁仅一条记录 */
  id: string
  trenchId: string
  wall: WallKey
  /** 记录人 */
  recorder: string
  /** 绘图号 */
  drawingNo: string
  /** 探方内各地层单位在该壁的顶底界线备注 */
  boundaries: WallBoundaryNote[]
  /** 涉及该壁的地层深度被改动后，置为待复核 */
  needsReview: boolean
  /** 复核通过并确认该壁记录完成 */
  confirmed: boolean
  updatedAt: string
  confirmedAt: string
}

/**
 * 壁记录状态：
 * - missing 待补：尚未建立记录
 * - incomplete 待补：记录人 / 绘图号 / 各层顶底界线备注未填齐
 * - ready 已完成待确认：资料填齐，等待人工确认
 * - review 待复核：地层深度改动后失效，复核前不得确认
 * - confirmed 已确认
 */
export type WallStatus = 'missing' | 'incomplete' | 'ready' | 'review' | 'confirmed'

/** 壁记录确定性主键 */
export function wallRecordId(trenchId: string, wall: WallKey): string {
  return `wr_${trenchId}_${wall}`
}

/** 记录是否填齐：记录人、绘图号不为空，且探方内每个地层单位的顶、底界备注均已填写 */
export function isWallRecordComplete(
  record: Pick<WallRecord, 'recorder' | 'drawingNo' | 'boundaries'>,
  strata: Pick<Stratum, 'id'>[]
): boolean {
  if (!record.recorder.trim() || !record.drawingNo.trim()) return false
  return strata.every((stratum) => {
    const note = record.boundaries.find((item) => item.stratumId === stratum.id)
    return !!note && note.top.trim() !== '' && note.bottom.trim() !== ''
  })
}

/** 计算单壁状态 */
export function wallStatusOf(record: WallRecord | undefined, strata: Pick<Stratum, 'id'>[]): WallStatus {
  if (!record) return 'missing'
  const complete = isWallRecordComplete(record, strata)
  if (record.needsReview) return 'review'
  if (record.confirmed && complete) return 'confirmed'
  return complete ? 'ready' : 'incomplete'
}

/** 探方内已确认的壁数（状态为 confirmed 才计数） */
export function confirmedWallCount(
  trenchId: string,
  records: WallRecord[],
  strata: Stratum[]
): number {
  const trenchStrata = strata.filter((item) => item.trenchId === trenchId)
  return WALL_KEYS.filter((wall) => {
    const record = records.find((item) => item.trenchId === trenchId && item.wall === wall)
    return wallStatusOf(record, trenchStrata) === 'confirmed'
  }).length
}

/** 四壁全部确认后，探方剖面才算完成 */
export function isTrenchSectionsComplete(
  trenchId: string,
  records: WallRecord[],
  strata: Stratum[]
): boolean {
  return confirmedWallCount(trenchId, records, strata) === WALL_KEYS.length
}
