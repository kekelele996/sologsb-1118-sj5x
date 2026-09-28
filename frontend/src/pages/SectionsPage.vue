<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { ElMessage } from 'element-plus'
import type { Artifact, Stratum, WallKey, WallRecord, WallStatus } from '@/types'
import {
  WALL_KEYS,
  WALL_LABELS,
  isWallRecordComplete,
  wallRecordId,
  wallStatusOf,
  confirmedWallCount,
  isTrenchSectionsComplete,
  stratumThickness
} from '@/types'
import StratumDepthBar from '@/components/common/StratumDepthBar.vue'
import { useStore } from '@/hooks/usePersistentStore'
import { stratumStore } from '@/stores/stratumStore'
import { trenchStore } from '@/stores/trenchStore'
import { artifactStore } from '@/stores/artifactStore'
import { wallRecordStore } from '@/stores/wallRecordStore'

const route = useRoute()

const stratumState = useStore(stratumStore)
const trenchState = useStore(trenchStore)
const artifactState = useStore(artifactStore)
const wallState = useStore(wallRecordStore)

const selectedTrenchId = ref('')
const wall = ref<WallKey>('north')
const showArtifacts = ref(true)

const CANVAS_W = 760
const CANVAS_H = 460
const SCALE_H = CANVAS_H - 70

watch(
  () => [trenchState.trenches.length, route.query.trench] as const,
  () => {
    const queryTrench = route.query.trench
    if (typeof queryTrench === 'string' && trenchState.trenches.some((item) => item.id === queryTrench)) {
      selectedTrenchId.value = queryTrench
    } else if (!selectedTrenchId.value && trenchState.trenches.length > 0) {
      selectedTrenchId.value = trenchState.trenches[0].id
    }
  },
  { immediate: true }
)

const trench = computed(() => trenchState.trenches.find((item) => item.id === selectedTrenchId.value) ?? null)

const strata = computed(() =>
  stratumState.strata
    .filter((item) => item.trenchId === selectedTrenchId.value)
    .sort((a, b) => a.topDepth - b.topDepth)
)

/** 探方四壁记录 */
const wallRecords = computed<WallRecord[]>(() =>
  wallState.wallRecords.filter((item) => item.trenchId === selectedTrenchId.value)
)

function recordOf(key: WallKey): WallRecord | undefined {
  return wallRecords.value.find((item) => item.wall === key)
}

function statusOf(key: WallKey): WallStatus {
  return wallStatusOf(recordOf(key), strata.value)
}

const STATUS_META: Record<WallStatus, { label: string; type: 'success' | 'warning' | 'info' | 'danger' | 'primary'; hint: string }> = {
  missing: { label: '待补', type: 'info', hint: '尚未建立该壁记录' },
  incomplete: { label: '待补', type: 'warning', hint: '记录人、绘图号或地层界线备注未填齐' },
  ready: { label: '已完成待确认', type: 'primary', hint: '资料已填齐，待人工确认' },
  review: { label: '待复核', type: 'danger', hint: '涉及该壁的地层深度已改动，复核前不能确认' },
  confirmed: { label: '已确认', type: 'success', hint: '该壁剖面记录已确认' }
}

const confirmedCount = computed(() => confirmedWallCount(selectedTrenchId.value, wallState.wallRecords, stratumState.strata))
const sectionsComplete = computed(() => isTrenchSectionsComplete(selectedTrenchId.value, wallState.wallRecords, stratumState.strata))

/** 壁记录中已填齐顶底界备注的地层数 / 探方地层总数 */
function boundaryProgress(record: WallRecord | undefined): { filled: number; total: number } {
  const total = strata.value.length
  if (!record) return { filled: 0, total }
  const filled = strata.value.filter((stratum) => {
    const note = record.boundaries.find((item) => item.stratumId === stratum.id)
    return !!note && note.top.trim() !== '' && note.bottom.trim() !== ''
  }).length
  return { filled, total }
}

/* ---------------- 四壁记录编辑弹窗 ---------------- */

const dialogVisible = ref(false)
const editingWall = ref<WallKey | null>(null)

const form = reactive({
  recorder: '',
  drawingNo: '',
  needsReview: false,
  boundaries: [] as { stratumId: string; top: string; bottom: string }[]
})

const editingRecord = computed<WallRecord | undefined>(() =>
  editingWall.value ? recordOf(editingWall.value) : undefined
)

/** 弹窗内按当前表单实时计算壁状态，便于展示「保存后将处于」的状态 */
const dialogStatus = computed<WallStatus>(() => {
  if (!editingWall.value) return 'missing'
  const pseudo: WallRecord = {
    id: wallRecordId(selectedTrenchId.value, editingWall.value),
    trenchId: selectedTrenchId.value,
    wall: editingWall.value,
    recorder: form.recorder,
    drawingNo: form.drawingNo,
    boundaries: form.boundaries,
    needsReview: form.needsReview,
    confirmed: editingRecord.value?.confirmed ?? false,
    updatedAt: '',
    confirmedAt: ''
  }
  return wallStatusOf(pseudo, strata.value)
})

function openWallDialog(key: WallKey): void {
  if (!selectedTrenchId.value) {
    ElMessage.warning('请先选择探方')
    return
  }
  editingWall.value = key
  wall.value = key
  const record = recordOf(key)
  form.recorder = record?.recorder ?? ''
  form.drawingNo = record?.drawingNo ?? ''
  form.needsReview = record?.needsReview ?? false
  // 以探方当前地层为准初始化界线行，已有的备注合并进来
  form.boundaries = strata.value.map((stratum) => {
    const note = record?.boundaries.find((item) => item.stratumId === stratum.id)
    return { stratumId: stratum.id, top: note?.top ?? '', bottom: note?.bottom ?? '' }
  })
  dialogVisible.value = true
}

/** 校验并收集表单；不通过返回 null 并提示 */
function collectForm():
  | { recorder: string; drawingNo: string; boundaries: WallRecord['boundaries']; needsReview: boolean }
  | null {
  if (!form.recorder.trim()) {
    ElMessage.warning('请填写记录人')
    return null
  }
  if (!form.drawingNo.trim()) {
    ElMessage.warning('请填写绘图号')
    return null
  }
  const missing = form.boundaries
    .map((note, index) => ({ note, stratum: strata.value[index] }))
    .filter(({ note }) => !note.top.trim() || !note.bottom.trim())
  if (missing.length > 0) {
    ElMessage.warning(`请补全 ${missing.map((item) => item.stratum?.code ?? '该层').join('、')} 的顶 / 底界备注`)
    return null
  }
  return {
    recorder: form.recorder.trim(),
    drawingNo: form.drawingNo.trim(),
    needsReview: form.needsReview,
    boundaries: form.boundaries.map((note) => ({
      stratumId: note.stratumId,
      top: note.top.trim(),
      bottom: note.bottom.trim()
    }))
  }
}

/**
 * 保存壁记录
 * - save：仅保存，保留原有确认状态（待复核 / 不完整时不能保持确认）
 * - confirm：资料填齐且非待复核时直接确认
 * - review：复核通过并确认（清掉待复核标记）
 */
async function submitWall(action: 'save' | 'confirm' | 'review'): Promise<void> {
  if (!editingWall.value) return
  const payload = collectForm()
  if (!payload) return
  const key = editingWall.value
  const complete = isWallRecordComplete(payload, strata.value)
  if (action === 'confirm' && (payload.needsReview || !complete)) {
    ElMessage.warning('待复核壁或界线备注未填齐，不能直接确认')
    return
  }
  await wallRecordStore.getState().save(
    {
      trenchId: selectedTrenchId.value,
      wall: key,
      recorder: payload.recorder,
      drawingNo: payload.drawingNo,
      boundaries: payload.boundaries,
      needsReview: action === 'save' ? payload.needsReview : false
    },
    strata.value
  )
  if (action !== 'save') {
    await wallRecordStore.getState().markReviewed(wallRecordId(selectedTrenchId.value, key), true, strata.value)
  }
  dialogVisible.value = false
  if (action === 'save') {
    const next = wallStatusOf(recordOf(key), strata.value)
    ElMessage.success(`「${WALL_LABELS[key]}」记录已保存（${STATUS_META[next].label}）`)
  } else {
    ElMessage.success(`「${WALL_LABELS[key]}」已${action === 'review' ? '复核并' : ''}确认`)
  }
}

async function quickConfirm(key: WallKey): Promise<void> {
  const record = recordOf(key)
  if (!record || statusOf(key) !== 'ready') return
  await wallRecordStore.getState().confirm(record.id, strata.value)
  ElMessage.success(`「${WALL_LABELS[key]}」已确认`)
}

async function quickUnconfirm(key: WallKey): Promise<void> {
  const record = recordOf(key)
  if (!record) return
  await wallRecordStore.getState().unconfirm(record.id)
  ElMessage.info(`「${WALL_LABELS[key]}」已撤销确认`)
}

/* ---------------- 剖面示意绘制 ---------------- */

const maxDepth = computed(() => {
  const deepest = strata.value.reduce((max, item) => Math.max(max, item.bottomDepth, item.topDepth), 0)
  return Math.max(0.5, Math.ceil((deepest + 0.2) * 10) / 10)
})

const depthToY = (depth: number): number => 40 + (depth / maxDepth.value) * SCALE_H

const ticks = computed(() => {
  const step = maxDepth.value <= 1 ? 0.2 : maxDepth.value <= 2 ? 0.5 : 1
  const list: number[] = []
  for (let value = 0; value <= maxDepth.value + 1e-6; value += step) {
    list.push(Math.round(value * 100) / 100)
  }
  return list
})

const artifactsOfTrench = computed<Artifact[]>(() => {
  const unitIds = strata.value.map((item) => item.id)
  return artifactState.artifacts.filter((item) => unitIds.includes(item.stratumId))
})

/** 出土物在剖面上的投影位置：X 轴按探方内 X 坐标，Y 轴按出土深度 */
function artifactPos(artifact: Artifact): { x: number; y: number } {
  const x = 90 + (Math.min(5, Math.max(0, artifact.x)) / 5) * (CANVAS_W - 150)
  return { x, y: depthToY(artifact.z) }
}

function stratumLabel(stratum: Stratum): string {
  return `${stratum.code} · ${stratum.type} · 厚 ${stratumThickness(stratum)} m`
}

const unitColors: Record<string, string> = {
  地层: '#d8c48a',
  灰坑: '#b08a5a',
  房址: '#b9a3d0',
  沟: '#8fbfae',
  墓葬: '#d99b90'
}
</script>

<template>
  <div class="page">
    <div class="page-head">
      <div>
        <h2 class="page-title">探方四壁剖面记录</h2>
        <p class="page-sub">
          每壁维护记录人、绘图号与各地层顶底界线备注；地层深度改动后涉及壁记录自动标为待复核，四壁全部确认后探方剖面才标记完成。
        </p>
      </div>
      <div class="head-actions">
        <el-select v-model="selectedTrenchId" placeholder="选择探方" style="width: 200px">
          <el-option v-for="item in trenchState.trenches" :key="item.id" :label="`${item.area} · ${item.code}`" :value="item.id" />
        </el-select>
        <el-select v-model="wall" style="width: 120px">
          <el-option v-for="key in WALL_KEYS" :key="key" :label="WALL_LABELS[key]" :value="key" />
        </el-select>
        <el-switch v-model="showArtifacts" active-text="显示出土物" />
      </div>
    </div>

    <el-alert
      v-if="!trench"
      class="alert"
      type="warning"
      :closable="false"
      show-icon
      title="请先选择探方；或先到「探方清单」建立探方"
    />
    <template v-else>
      <el-alert
        :class="['alert', sectionsComplete ? 'is-complete' : '']"
        :type="sectionsComplete ? 'success' : 'warning'"
        :closable="false"
        show-icon
        :title="sectionsComplete ? `${trench.area} · ${trench.code} 四壁记录全部确认，剖面整理完成` : `${trench.area} · ${trench.code} 已确认 ${confirmedCount} / 4 壁，剖面尚未完成`"
      >
        <template #default>
          <div class="status-line">
            <el-tag
              v-for="key in WALL_KEYS"
              :key="key"
              :type="STATUS_META[statusOf(key)].type === 'primary' ? '' : STATUS_META[statusOf(key)].type"
              size="small"
              effect="plain"
            >
              {{ WALL_LABELS[key] }} · {{ STATUS_META[statusOf(key)].label }}
            </el-tag>
          </div>
          <p v-if="trench.wallNote" class="wall-note">四壁方向备注：{{ trench.wallNote }}</p>
        </template>
      </el-alert>

      <!-- 四壁记录卡片 -->
      <el-card shadow="never" class="walls-card">
        <template #header>
          <div class="walls-head">
            <span>四壁剖面记录</span>
            <span class="muted">已确认 {{ confirmedCount }} / 4 壁；待复核壁复核确认前不能标记剖面完成</span>
          </div>
        </template>
        <div class="wall-grid">
          <div
            v-for="key in WALL_KEYS"
            :key="key"
            :class="['wall-item', `is-${statusOf(key)}`, { 'is-active': wall === key }]"
            @click="wall = key"
          >
            <div class="wall-item-head">
              <b>{{ WALL_LABELS[key] }}</b>
              <el-tag :type="STATUS_META[statusOf(key)].type === 'primary' ? '' : STATUS_META[statusOf(key)].type" size="small">
                {{ STATUS_META[statusOf(key)].label }}
              </el-tag>
            </div>
            <p class="wall-meta">记录人：{{ recordOf(key)?.recorder || '—' }}</p>
            <p class="wall-meta">绘图号：<span class="mono">{{ recordOf(key)?.drawingNo || '—' }}</span></p>
            <p class="wall-meta">
              界线备注：{{ boundaryProgress(recordOf(key)).filled }} / {{ boundaryProgress(recordOf(key)).total }} 层
            </p>
            <p v-if="recordOf(key)?.needsReview" class="wall-review">地层深度已改动，请复核顶底界线</p>
            <p v-else-if="recordOf(key)?.confirmed" class="muted">确认于 {{ recordOf(key)?.confirmedAt }}</p>
            <p v-else-if="recordOf(key)" class="muted">最近保存 {{ recordOf(key)?.updatedAt }}</p>
            <p v-else class="muted">{{ STATUS_META[statusOf(key)].hint }}</p>
            <div class="wall-actions" @click.stop>
              <el-button size="small" type="primary" plain @click="openWallDialog(key)">
                {{ statusOf(key) === 'missing' ? '补记' : statusOf(key) === 'review' ? '去复核' : '编辑' }}
              </el-button>
              <el-button
                v-if="statusOf(key) === 'ready'"
                size="small"
                type="success"
                @click="quickConfirm(key)"
              >
                确认
              </el-button>
              <el-button v-if="statusOf(key) === 'confirmed'" size="small" @click="quickUnconfirm(key)">
                撤销确认
              </el-button>
            </div>
          </div>
        </div>
      </el-card>
    </template>

    <el-alert
      v-if="trench && strata.length === 0"
      class="alert"
      type="warning"
      :closable="false"
      show-icon
      title="该探方暂无地层单位，请先到「地层单位编目」录入"
    />
    <el-alert
      v-else-if="trench"
      class="alert"
      type="info"
      :closable="false"
      show-icon
      :title="`${trench?.area} · ${trench?.code}（${trench?.size}）共 ${strata.length} 个地层单位、${artifactsOfTrench.length} 件出土物；最深 ${maxDepth} m`"
    />

    <div class="layout">
      <el-card shadow="never" class="section-card">
        <template #header>{{ WALL_LABELS[wall] }}剖面示意（深度刻度 0 – {{ maxDepth }} m）</template>
        <svg :width="CANVAS_W" :height="CANVAS_H" role="img" :aria-label="`${WALL_LABELS[wall]}剖面示意`">
          <rect :width="CANVAS_W" :height="CANVAS_H" rx="10" fill="#fbfaf6" stroke="#e6ded0" />
          <!-- 地层条带 -->
          <g v-for="stratum in strata" :key="stratum.id">
            <rect
              x="90"
              :y="depthToY(Math.min(stratum.topDepth, stratum.bottomDepth))"
              :width="CANVAS_W - 150"
              :height="Math.max(6, depthToY(Math.max(stratum.topDepth, stratum.bottomDepth)) - depthToY(Math.min(stratum.topDepth, stratum.bottomDepth)))"
              :fill="unitColors[stratum.type] ?? '#d8c48a'"
              :stroke="stratum.topDepth > stratum.bottomDepth ? '#c0392b' : '#b9a77f'"
              :stroke-width="stratum.topDepth > stratum.bottomDepth ? 2 : 1"
              opacity="0.92"
            />
            <text
              :x="97"
              :y="depthToY(Math.min(stratum.topDepth, stratum.bottomDepth)) + 14"
              font-size="11"
              fill="#4a3722"
            >
              {{ stratumLabel(stratum) }}
            </text>
            <text
              :x="CANVAS_W - 52"
              :y="depthToY(Math.min(stratum.topDepth, stratum.bottomDepth)) + 14"
              font-size="10"
              fill="#6b5b45"
            >
              {{ stratum.soil.slice(0, 8) }}
            </text>
          </g>

          <!-- 深度刻度 -->
          <g stroke="#c9bfae" stroke-width="1">
            <line v-for="tick in ticks" :key="`t${tick}`" x1="70" :y1="depthToY(tick)" x2="90" :y2="depthToY(tick)" />
          </g>
          <g font-size="10" fill="#7d7264">
            <text v-for="tick in ticks" :key="`tt${tick}`" x="14" :y="depthToY(tick) + 3">
              {{ tick.toFixed(1) }} m
            </text>
          </g>

          <!-- 出土物投影 -->
          <g v-if="showArtifacts">
            <g v-for="artifact in artifactsOfTrench" :key="artifact.id">
              <circle :cx="artifactPos(artifact).x" :cy="artifactPos(artifact).y" r="5" fill="#c0392b" stroke="#fff" stroke-width="1.4" />
              <text :x="artifactPos(artifact).x + 8" :y="artifactPos(artifact).y + 4" font-size="10" fill="#8a3a2c">
                {{ artifact.code }}
              </text>
            </g>
          </g>

          <text :x="CANVAS_W / 2 - 40" y="24" font-size="12" fill="#4a3722">
            {{ WALL_LABELS[wall] }}（地表 0 m）
          </text>
          <text v-if="strata.length === 0" :x="CANVAS_W / 2 - 60" :y="CANVAS_H / 2" font-size="13" fill="#8a97a3">
            暂无可绘制的层位数据
          </text>
        </svg>
        <div class="legend">
          <span v-for="(color, type) in unitColors" :key="type"><i :style="{ background: color }" />{{ type }}</span>
          <span><i class="artifact" />出土物投影点</span>
        </div>
      </el-card>

      <el-card shadow="never" class="list-card">
        <template #header>地层条带（深度刻度条）</template>
        <div class="bars">
          <div v-for="stratum in strata" :key="stratum.id" class="bar-row">
            <div class="bar-head">
              <span class="mono">{{ stratum.code }}</span>
              <el-tag size="small" effect="plain">{{ stratum.type }}</el-tag>
              <span class="muted">{{ stratum.openLayer }}</span>
            </div>
            <StratumDepthBar :stratum="stratum" :length="250" :max-depth="maxDepth" />
            <p class="soil">{{ stratum.soil || '未记录土质土色' }} · 包含物 {{ stratum.inclusions.join('、') || '无' }}</p>
          </div>
          <p v-if="strata.length === 0" class="muted">暂无地层单位</p>
        </div>

        <template v-if="artifactsOfTrench.length > 0">
          <h4 class="sub-title">出土物上下关系（按深度）</h4>
          <ul class="artifact-list">
            <li v-for="artifact in [...artifactsOfTrench].sort((a, b) => a.z - b.z)" :key="artifact.id">
              <span class="mono">{{ artifact.code }}</span>
              <span>{{ artifact.category }} × {{ artifact.count }}（{{ artifact.completeness }}）</span>
              <span class="muted">Z = {{ artifact.z }} m · {{ strata.find((item) => item.id === artifact.stratumId)?.code ?? '未知单位' }}</span>
            </li>
          </ul>
        </template>
      </el-card>
    </div>

    <!-- 壁记录编辑弹窗 -->
    <el-dialog
      v-model="dialogVisible"
      :title="`${editingWall ? WALL_LABELS[editingWall] : ''}剖面记录`"
      width="760px"
    >
      <div v-if="editingWall" class="dialog-body">
        <div class="dialog-status">
          <el-tag :type="STATUS_META[dialogStatus].type === 'primary' ? '' : STATUS_META[dialogStatus].type" size="small">
            当前状态：{{ STATUS_META[dialogStatus].label }}
          </el-tag>
          <span class="muted">{{ STATUS_META[dialogStatus].hint }}</span>
          <el-checkbox v-if="form.needsReview || dialogStatus === 'review'" v-model="form.needsReview" disabled>
            待复核（地层深度已改动）
          </el-checkbox>
        </div>
        <el-form label-width="92px">
          <el-row :gutter="12">
            <el-col :span="12">
              <el-form-item label="记录人" required>
                <el-input v-model="form.recorder" placeholder="现场记录该壁的人员" />
              </el-form-item>
            </el-col>
            <el-col :span="12">
              <el-form-item label="绘图号" required>
                <el-input v-model="form.drawingNo" placeholder="如 T0501-北壁-01" />
              </el-form-item>
            </el-col>
          </el-row>
        </el-form>

        <h4 class="bnd-title">各地层顶底界线备注<span class="muted">（按深度自上而下）</span></h4>
        <el-alert
          v-if="strata.length === 0"
          type="warning"
          :closable="false"
          show-icon
          title="该探方暂无地层单位，界线备注将在补录地层后填写"
          class="bnd-alert"
        />
        <div v-for="(note, index) in form.boundaries" :key="note.stratumId" class="bnd-row">
          <div class="bnd-head">
            <el-tag size="small" effect="plain">{{ strata[index]?.code }}</el-tag>
            <span class="muted">{{ strata[index]?.type }} · {{ strata[index]?.topDepth }} – {{ strata[index]?.bottomDepth }} m</span>
          </div>
          <el-input v-model="note.top" placeholder="顶界备注（如 0.25 m，与 L01 分界清晰）" />
          <el-input v-model="note.bottom" placeholder="底界备注（如 0.60 m，下为 H12 开口）" />
        </div>
      </div>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" @click="submitWall('save')">保存</el-button>
        <el-button
          v-if="dialogStatus !== 'confirmed'"
          type="success"
          :disabled="dialogStatus === 'review' || dialogStatus === 'missing' || dialogStatus === 'incomplete'"
          @click="submitWall('confirm')"
        >
          保存并确认
        </el-button>
        <el-button v-if="dialogStatus === 'review'" type="warning" @click="submitWall('review')">
          复核通过并确认
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.alert {
  margin-bottom: 14px;
}
.alert.is-complete {
  border-color: #67c23a;
}
.head-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
}
.status-line {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 4px;
}
.wall-note {
  margin: 8px 0 0;
  font-size: 12px;
}
.walls-card {
  margin-bottom: 14px;
  border-radius: 12px;
}
.walls-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
}
.wall-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 12px;
}
.wall-item {
  padding: 12px;
  border: 1px solid #e6ded0;
  border-radius: 10px;
  background: #fbfaf6;
  cursor: pointer;
  transition: border-color 0.15s, box-shadow 0.15s;
}
.wall-item:hover {
  border-color: #c9a227;
}
.wall-item.is-active {
  border-color: #a9762f;
  box-shadow: 0 0 0 2px rgba(169, 118, 47, 0.18);
}
.wall-item.is-confirmed {
  background: #f4faf0;
}
.wall-item.is-review {
  background: #fdf2f2;
  border-color: #f0b7b0;
}
.wall-item.is-ready {
  background: #f3f8fc;
}
.wall-item-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 8px;
}
.wall-meta {
  margin: 3px 0;
  font-size: 12px;
  color: #5c4b36;
}
.wall-review {
  margin: 4px 0;
  font-size: 12px;
  color: #c0392b;
}
.wall-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 10px;
}
.layout {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
  align-items: flex-start;
}
.section-card {
  flex: 1 1 620px;
  border-radius: 12px;
}
.list-card {
  flex: 1 1 320px;
  border-radius: 12px;
}
.legend {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-top: 6px;
  font-size: 12px;
  color: #6b5b45;
}
.legend span {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}
.legend i {
  width: 12px;
  height: 12px;
  border-radius: 3px;
  display: inline-block;
}
.legend i.artifact {
  background: #c0392b;
  border-radius: 50%;
}
.bars {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.bar-row {
  padding-bottom: 8px;
  border-bottom: 1px dotted #e6ded0;
}
.bar-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 4px;
  font-size: 13px;
}
.soil {
  margin: 4px 0 0;
  font-size: 11px;
  color: #8a8073;
}
.sub-title {
  margin: 16px 0 6px;
  font-size: 13px;
}
.artifact-list {
  margin: 0;
  padding-left: 16px;
  font-size: 12px;
  line-height: 1.8;
}
.dialog-body {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.dialog-status {
  display: flex;
  align-items: center;
  gap: 10px;
}
.bnd-title {
  margin: 6px 0 0;
  font-size: 14px;
}
.bnd-alert {
  margin: 0;
}
.bnd-row {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px;
  border: 1px solid #ece4d5;
  border-radius: 8px;
  background: #fbfaf6;
}
.bnd-head {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
}
</style>
