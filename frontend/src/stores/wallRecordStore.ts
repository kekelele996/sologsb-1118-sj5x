import { createStore } from 'zustand/vanilla'
import type { Stratum, WallRecord } from '@/types'
import { WALL_KEYS, isWallRecordComplete, wallRecordId } from '@/types'
import { db, syncAll, syncDelete, syncPut } from '@/hooks/usePersistentStore'

export interface WallRecordState {
  wallRecords: WallRecord[]
  loaded: boolean
  hydrate: () => Promise<void>
  /** 保存壁记录：按填齐情况调整确认状态；不完整或待复核时不得确认 */
  save: (
    record: Pick<WallRecord, 'trenchId' | 'wall' | 'recorder' | 'drawingNo' | 'boundaries' | 'needsReview'>,
    strata: Pick<Stratum, 'id'>[]
  ) => Promise<void>
  /** 复核通过：清掉待复核标记；若资料已填齐可一并确认 */
  markReviewed: (id: string, confirm: boolean, strata: Pick<Stratum, 'id'>[]) => Promise<void>
  /** 确认某壁（由页面校验资料填齐后调用） */
  confirm: (id: string, strata: Pick<Stratum, 'id'>[]) => Promise<void>
  /** 撤销确认 */
  unconfirm: (id: string) => Promise<void>
  /** 地层深度或所属探方改动后，把涉及该层界线的壁记录标为待复核 */
  invalidateForStratum: (stratum: Stratum) => Promise<number>
  /** 删除探方时级联清理其全部壁记录 */
  removeByTrench: (trenchId: string) => Promise<void>
}

export const wallRecordStore = createStore<WallRecordState>((set, get) => ({
  wallRecords: [],
  loaded: false,
  hydrate: async () => {
    const wallRecords = await syncAll<WallRecord>(db.wallRecords)
    wallRecords.sort((a, b) => {
      const trench = a.trenchId.localeCompare(b.trenchId)
      return trench !== 0 ? trench : WALL_KEYS.indexOf(a.wall) - WALL_KEYS.indexOf(b.wall)
    })
    set({ wallRecords, loaded: true })
  },
  save: async (input, strata) => {
    const id = wallRecordId(input.trenchId, input.wall)
    const previous = get().wallRecords.find((item) => item.id === id)
    const now = new Date().toISOString().slice(0, 10)
    const complete = isWallRecordComplete(input, strata)
    const confirmed = complete && !input.needsReview && (previous?.confirmed ?? false)
    await syncPut<WallRecord>(db.wallRecords, {
      id,
      trenchId: input.trenchId,
      wall: input.wall,
      recorder: input.recorder,
      drawingNo: input.drawingNo,
      boundaries: input.boundaries,
      needsReview: input.needsReview,
      confirmed,
      updatedAt: now,
      confirmedAt: confirmed ? previous?.confirmedAt || now : ''
    })
    await get().hydrate()
  },
  markReviewed: async (id, confirm, strata) => {
    const target = get().wallRecords.find((item) => item.id === id)
    if (!target) return
    const now = new Date().toISOString().slice(0, 10)
    const complete = isWallRecordComplete(target, strata)
    await syncPut<WallRecord>(db.wallRecords, {
      ...target,
      needsReview: false,
      confirmed: confirm && complete,
      confirmedAt: confirm && complete ? target.confirmedAt || now : ''
    })
    await get().hydrate()
  },
  confirm: async (id, strata) => {
    const target = get().wallRecords.find((item) => item.id === id)
    if (!target || target.needsReview || !isWallRecordComplete(target, strata)) return
    const now = new Date().toISOString().slice(0, 10)
    await syncPut<WallRecord>(db.wallRecords, { ...target, confirmed: true, confirmedAt: target.confirmedAt || now })
    await get().hydrate()
  },
  unconfirm: async (id) => {
    const target = get().wallRecords.find((item) => item.id === id)
    if (!target) return
    await syncPut<WallRecord>(db.wallRecords, { ...target, confirmed: false, confirmedAt: '' })
    await get().hydrate()
  },
  invalidateForStratum: async (stratum) => {
    const targets = get().wallRecords.filter(
      (item) =>
        item.trenchId === stratum.trenchId &&
        item.boundaries.some((note) => note.stratumId === stratum.id)
    )
    if (targets.length === 0) return 0
    const now = new Date().toISOString().slice(0, 10)
    await Promise.all(
      targets.map((item) =>
        syncPut<WallRecord>(db.wallRecords, {
          ...item,
          needsReview: true,
          confirmed: false,
          confirmedAt: '',
          updatedAt: now
        })
      )
    )
    await get().hydrate()
    return targets.length
  },
  removeByTrench: async (trenchId) => {
    const targets = get().wallRecords.filter((item) => item.trenchId === trenchId)
    await Promise.all(targets.map((item) => syncDelete<WallRecord>(db.wallRecords, item.id)))
    await get().hydrate()
  }
}))
