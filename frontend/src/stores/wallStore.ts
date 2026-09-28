import { createStore } from 'zustand/vanilla'
import type { WallBoundaryNote, WallName, WallRecord } from '@/types'
import { isWallFilled, wallRecordId } from '@/types'
import { db, syncAll, syncPut } from '@/hooks/usePersistentStore'

export interface WallState {
  wallRecords: WallRecord[]
  loaded: boolean
  hydrate: () => Promise<void>
  /** 保存壁面记录内容（不改变确认/复核状态） */
  saveDraft: (trenchId: string, wall: WallName, recorder: string, drawingNo: string, boundaries: WallBoundaryNote[]) => Promise<boolean>
  /** 确认壁面剖面；待复核或内容不全时拒绝，返回 false */
  setConfirmed: (trenchId: string, wall: WallName, confirmed: boolean) => Promise<boolean>
  /** 复核通过并确认（清除待复核标记）；内容不全时拒绝 */
  reviewAndConfirm: (trenchId: string, wall: WallName) => Promise<boolean>
  /** 地层深度改动后，将探方内相关壁面标记为待复核，返回受影响的壁数 */
  invalidateByDepthChange: (trenchId: string, stratumId: string) => Promise<number>
  /** 删除地层单位时清理界线备注 */
  removeStratumFromBoundaries: (stratumId: string) => Promise<void>
  /** 删除探方时连带清理四壁记录 */
  removeByTrench: (trenchId: string) => Promise<void>
}

export const wallStore = createStore<WallState>((set, get) => ({
  wallRecords: [],
  loaded: false,
  hydrate: async () => {
    const wallRecords = await syncAll<WallRecord>(db.wallRecords)
    wallRecords.sort((a, b) => a.trenchId.localeCompare(b.trenchId) || a.wall.localeCompare(b.wall, 'zh-Hans-CN'))
    set({ wallRecords, loaded: true })
  },

  saveDraft: async (trenchId, wall, recorder, drawingNo, boundaries) => {
    const id = wallRecordId(trenchId, wall)
    const existing = await db.wallRecords.get(id)
    const row: WallRecord = {
      id,
      trenchId,
      wall,
      recorder: recorder.trim(),
      drawingNo: drawingNo.trim(),
      boundaries: boundaries
        .map((item) => ({
          stratumId: item.stratumId,
          topNote: item.topNote.trim(),
          bottomNote: item.bottomNote.trim()
        }))
        // 未留痕的层位不写入，保持记录精简
        .filter((item) => item.topNote !== '' || item.bottomNote !== ''),
      confirmed: existing?.confirmed ?? false,
      needsReview: existing?.needsReview ?? false,
      reviewStratumIds: existing?.reviewStratumIds ?? [],
      updatedAt: new Date().toISOString().slice(0, 10)
    }
    await syncPut<WallRecord>(db.wallRecords, row)
    await get().hydrate()
    return isWallFilled(row)
  },

  setConfirmed: async (trenchId, wall, confirmed) => {
    const id = wallRecordId(trenchId, wall)
    const existing = await db.wallRecords.get(id)
    if (!existing || !isWallFilled(existing)) return false
    // 待复核（地层深度改动后未复核）不能确认完成
    if (confirmed && existing.needsReview) return false
    await syncPut<WallRecord>(db.wallRecords, { ...existing, confirmed })
    await get().hydrate()
    return true
  },

  reviewAndConfirm: async (trenchId, wall) => {
    const id = wallRecordId(trenchId, wall)
    const existing = await db.wallRecords.get(id)
    if (!existing || !isWallFilled(existing)) return false
    await syncPut<WallRecord>(db.wallRecords, {
      ...existing,
      needsReview: false,
      reviewStratumIds: [],
      confirmed: true,
      updatedAt: new Date().toISOString().slice(0, 10)
    })
    await get().hydrate()
    return true
  },

  invalidateByDepthChange: async (trenchId, stratumId) => {
    const targets = (await db.wallRecords.where('trenchId').equals(trenchId).toArray()).filter(
      (item) => isWallFilled(item)
    )
    await Promise.all(
      targets.map((item) =>
        syncPut<WallRecord>(db.wallRecords, {
          ...item,
          needsReview: true,
          confirmed: false,
          reviewStratumIds: Array.from(new Set([...item.reviewStratumIds, stratumId]))
        })
      )
    )
    if (targets.length > 0) await get().hydrate()
    return targets.length
  },

  removeStratumFromBoundaries: async (stratumId) => {
    const targets = (await syncAll<WallRecord>(db.wallRecords)).filter((item) =>
      item.boundaries.some((boundary) => boundary.stratumId === stratumId)
    )
    await Promise.all(
      targets.map((item) =>
        syncPut<WallRecord>(db.wallRecords, {
          ...item,
          boundaries: item.boundaries.filter((boundary) => boundary.stratumId !== stratumId),
          reviewStratumIds: item.reviewStratumIds.filter((id) => id !== stratumId)
        })
      )
    )
    if (targets.length > 0) await get().hydrate()
  },

  removeByTrench: async (trenchId) => {
    const targets = await db.wallRecords.where('trenchId').equals(trenchId).toArray()
    await Promise.all(targets.map((item) => db.wallRecords.delete(item.id)))
    if (targets.length > 0) await get().hydrate()
  }
}))
