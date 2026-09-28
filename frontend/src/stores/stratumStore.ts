import { createStore } from 'zustand/vanilla'
import type { Stratum, UnitType } from '@/types'
import { db, syncAll, syncDelete, syncPut } from '@/hooks/usePersistentStore'
import { wallStore } from './wallStore'

export interface StratumState {
  strata: Stratum[]
  loaded: boolean
  hydrate: () => Promise<void>
  /** 保存地层单位；若顶/底深度发生变化，相关壁面标记待复核，返回受影响的壁数 */
  save: (stratum: Stratum) => Promise<number>
  remove: (id: string) => Promise<void>
  bulkSetType: (ids: string[], type: UnitType) => Promise<void>
}

function sameDepth(a: Pick<Stratum, 'topDepth' | 'bottomDepth'>, b: Pick<Stratum, 'topDepth' | 'bottomDepth'>): boolean {
  return a.topDepth === b.topDepth && a.bottomDepth === b.bottomDepth
}

export const stratumStore = createStore<StratumState>((set, get) => ({
  strata: [],
  loaded: false,
  hydrate: async () => {
    const strata = await syncAll<Stratum>(db.strata)
    strata.sort((a, b) => (a.topDepth === b.topDepth ? a.code.localeCompare(b.code, 'zh-Hans-CN') : a.topDepth - b.topDepth))
    set({ strata, loaded: true })
  },
  save: async (stratum) => {
    const previous = get().strata.find((item) => item.id === stratum.id)
    const depthChanged = !!previous && !sameDepth(previous, stratum)
    await syncPut<Stratum>(db.strata, stratum)
    // 地层深度改动 → 该探方涉及该层界线的壁面记录标为待复核
    const affectedWalls = depthChanged
      ? await wallStore.getState().invalidateByDepthChange(stratum.trenchId, stratum.id)
      : 0
    await get().hydrate()
    return affectedWalls
  },
  remove: async (id) => {
    await syncDelete<Stratum>(db.strata, id)
    // 同步清理四壁记录中的该层界线备注
    await wallStore.getState().removeStratumFromBoundaries(id)
    await get().hydrate()
  },
  bulkSetType: async (ids, type) => {
    const targets = get().strata.filter((item) => ids.includes(item.id))
    await Promise.all(targets.map((item) => syncPut<Stratum>(db.strata, { ...item, type })))
    await get().hydrate()
  }
}))
