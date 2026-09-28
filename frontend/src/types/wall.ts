/** 四壁方向 */
export const WALLS = ['北壁', '东壁', '南壁', '西壁'] as const
export type WallName = (typeof WALLS)[number]

/** 某一地层单位在壁面上的顶、底界线备注 */
export interface WallBoundaryNote {
  stratumId: string
  /** 顶界备注 */
  topNote: string
  /** 底界备注 */
  bottomNote: string
}

/**
 * WallRecord 探方单壁剖面记录
 * 每个探方的每一壁（北/东/南/西）最多一条，id 由 trenchId + wall 确定性生成
 */
export interface WallRecord {
  id: string
  trenchId: string
  wall: WallName
  /** 记录人 */
  recorder: string
  /** 绘图号 */
  drawingNo: string
  /** 各地层顶底界线备注 */
  boundaries: WallBoundaryNote[]
  /** 是否已确认（现场复核通过） */
  confirmed: boolean
  /** 待复核：相关地层深度改动后置为 true，复核确认时清除 */
  needsReview: boolean
  /** 触发待复核的地层单位 id（用于界面提示） */
  reviewStratumIds: string[]
  updatedAt: string
}

/** 生成探方某一壁记录的固定 id */
export function wallRecordId(trenchId: string, wall: WallName): string {
  return `wr_${trenchId}_${wall}`
}

/** 该壁是否已填写（记录人与绘图号均填写才算已留存） */
export function isWallFilled(record?: Pick<WallRecord, 'recorder' | 'drawingNo'> | null): boolean {
  return !!record && record.recorder.trim() !== '' && record.drawingNo.trim() !== ''
}

/** 壁面工作状态 */
export type WallStatus = '待补' | '待确认' | '待复核' | '已确认'

/** 壁面状态：已填写未确认 → 待确认；深度改动 → 待复核；确认后 → 已确认 */
export function wallStatusOf(record?: WallRecord | null): WallStatus {
  if (!isWallFilled(record)) return '待补'
  if (record!.needsReview) return '待复核'
  return record!.confirmed ? '已确认' : '待确认'
}

/** 已确认壁数 */
export function countConfirmedWalls(records: WallRecord[]): number {
  return records.filter((item) => wallStatusOf(item) === '已确认').length
}

/** 探方四壁是否全部确认（剖面完成） */
export function isSectionComplete(records: WallRecord[]): boolean {
  return WALLS.every((wall) => {
    const record = records.find((item) => item.wall === wall)
    return wallStatusOf(record) === '已确认'
  })
}
