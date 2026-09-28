<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import type { Artifact, Stratum, WallName, WallRecord, WallStatus } from '@/types'
import { WALLS, stratumThickness, wallStatusOf } from '@/types'
import StratumDepthBar from '@/components/common/StratumDepthBar.vue'
import { useStore } from '@/hooks/usePersistentStore'
import { stratumStore } from '@/stores/stratumStore'
import { trenchStore } from '@/stores/trenchStore'
import { artifactStore } from '@/stores/artifactStore'
import { wallStore } from '@/stores/wallStore'

const stratumState = useStore(stratumStore)
const trenchState = useStore(trenchStore)
const artifactState = useStore(artifactStore)
const wallState = useStore(wallStore)

const selectedTrenchId = ref('')
const wall = ref<WallName>('北壁')
const showArtifacts = ref(true)

const CANVAS_W = 760
const CANVAS_H = 460
const SCALE_H = CANVAS_H - 70

watch(
  () => [trenchState.trenches.length, selectedTrenchId.value] as const,
  () => {
    if (!selectedTrenchId.value && trenchState.trenches.length > 0) {
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

/* ---------------- 四壁记录 ---------------- */

/** 当前探方的四壁记录映射 */
const recordsOfTrench = computed<Map<WallName, WallRecord>>(() => {
  const map = new Map<WallName, WallRecord>()
  wallState.wallRecords
    .filter((item) => item.trenchId === selectedTrenchId.value)
    .forEach((item) => map.set(item.wall, item))
  return map
})

const currentRecord = computed<WallRecord | undefined>(() => recordsOfTrench.value.get(wall.value))

const statusMeta: Record<WallStatus, { label: string; type: 'success' | 'warning' | 'info' | 'danger' }> = {
  待补: { label: '待补', type: 'info' },
  待确认: { label: '待确认', type: 'warning' },
  待复核: { label: '待复核', type: 'danger' },
  已确认: { label: '已确认', type: 'success' }
}

const wallOverview = computed(() =>
  WALLS.map((name) => {
    const record = recordsOfTrench.value.get(name)
    const status = wallStatusOf(record)
    return { name, record, status, ...statusMeta[status] }
  })
)

const confirmedCount = computed(() => wallOverview.value.filter((item) => item.status === '已确认').length)
const reviewCount = computed(() => wallOverview.value.filter((item) => item.status === '待复核').length)
const sectionComplete = computed(() => confirmedCount.value === WALLS.length)

/** 待复核涉及的地层单位（当前壁） */
const reviewStrata = computed(() =>
  (currentRecord.value?.reviewStratumIds ?? [])
    .map((id) => strata.value.find((item) => item.id === id))
    .filter((item): item is Stratum => !!item)
)

/** 壁记录编辑表单 */
const form = reactive({
  recorder: '',
  drawingNo: '',
  boundaries: [] as { stratumId: string; topNote: string; bottomNote: string }[]
})

/** 从 store 记录同步到可编辑表单 */
function syncForm(): void {
  const record = currentRecord.value
  form.recorder = record?.recorder ?? ''
  form.drawingNo = record?.drawingNo ?? ''
  form.boundaries = strata.value.map((stratum) => {
    const note = record?.boundaries.find((item) => item.stratumId === stratum.id)
    return {
      stratumId: stratum.id,
      topNote: note?.topNote ?? '',
      bottomNote: note?.bottomNote ?? ''
    }
  })
}

/** 从 store 记录同步到可编辑表单（仅在记录真的变化时触发，避免覆盖正在编辑的内容） */
watch(
  () => {
    const record = currentRecord.value
    return [
      selectedTrenchId.value,
      wall.value,
      record ? JSON.stringify(record) : '',
      strata.value.map((item) => `${item.id}:${item.topDepth}/${item.bottomDepth}`).join('|')
    ].join('||')
  },
  syncForm,
  { immediate: true }
)

const formFilled = computed(() => form.recorder.trim() !== '' && form.drawingNo.trim() !== '')
const formDirty = computed(() => {
  const record = currentRecord.value
  if (!record) return formFilled.value || form.boundaries.some((item) => item.topNote || item.bottomNote)
  if (record.recorder !== form.recorder.trim() || record.drawingNo !== form.drawingNo.trim()) return true
  return form.boundaries.some((item) => {
    const saved = record.boundaries.find((boundary) => boundary.stratumId === item.stratumId)
    return (saved?.topNote ?? '') !== item.topNote.trim() || (saved?.bottomNote ?? '') !== item.bottomNote.trim()
  })
})

async function saveDraft(): Promise<void> {
  if (!formFilled.value) {
    ElMessage.warning('请先填写记录人与绘图号，保存后该壁才计为已留存')
    return
  }
  const filled = await wallStore.getState().saveDraft(
    selectedTrenchId.value,
    wall.value,
    form.recorder,
    form.drawingNo,
    form.boundaries
  )
  ElMessage.success(filled ? `${wall.value}记录已保存` : `${wall.value}草稿已保存（记录人/绘图号补全后才计为完成）`)
}

async function confirmWall(): Promise<void> {
  if (!formFilled.value) {
    ElMessage.warning('请先填写记录人与绘图号并保存')
    return
  }
  // 先保存当前编辑内容，再确认
  await wallStore.getState().saveDraft(selectedTrenchId.value, wall.value, form.recorder, form.drawingNo, form.boundaries)
  const ok = await wallStore.getState().setConfirmed(selectedTrenchId.value, wall.value, true)
  if (!ok) {
    ElMessage.error(`${wall.value}存在地层深度改动后的待复核项，请先「复核并确认」`)
    return
  }
  ElMessage.success(`${wall.value}剖面已确认`)
}

async function reviewAndConfirm(): Promise<void> {
  try {
    await ElMessageBox.confirm(
      `确认已按最新地层界线现场复核${wall.value}？复核后该壁将标记为已确认。`,
      '复核确认',
      { type: 'warning' }
    )
  } catch {
    return
  }
  await wallStore.getState().saveDraft(selectedTrenchId.value, wall.value, form.recorder, form.drawingNo, form.boundaries)
  const ok = await wallStore.getState().reviewAndConfirm(selectedTrenchId.value, wall.value)
  if (!ok) {
    ElMessage.error('请先填写记录人与绘图号')
    return
  }
  ElMessage.success(`${wall.value}复核完成，已确认`)
}

async function unconfirmWall(): Promise<void> {
  await wallStore.getState().setConfirmed(selectedTrenchId.value, wall.value, false)
  ElMessage.info(`${wall.value}已退回未确认状态`)
}

function noteOf(stratumId: string, key: 'topNote' | 'bottomNote'): string {
  return currentRecord.value?.boundaries.find((item) => item.stratumId === stratumId)?.[key] ?? ''
}
</script>

<template>
  <div class="page">
    <div class="page-head">
      <div>
        <h2 class="page-title">探方四壁剖面记录</h2>
        <p class="page-sub">
          逐壁维护记录人、绘图号与各地层顶底界线备注；地层深度改动后相关壁面自动转为「待复核」，四壁全部确认后探方剖面才计为完成。
        </p>
      </div>
      <div class="head-actions">
        <el-select v-model="selectedTrenchId" placeholder="选择探方" style="width: 200px">
          <el-option v-for="item in trenchState.trenches" :key="item.id" :label="`${item.area} · ${item.code}`" :value="item.id" />
        </el-select>
        <el-switch v-model="showArtifacts" active-text="显示出土物" />
      </div>
    </div>

    <el-alert
      v-if="strata.length === 0"
      class="alert"
      type="warning"
      :closable="false"
      show-icon
      title="该探方暂无地层单位，请先到「地层单位编目」录入"
    />
    <template v-else>
      <el-alert
        class="alert"
        :type="sectionComplete ? 'success' : reviewCount > 0 ? 'error' : 'warning'"
        :closable="false"
        show-icon
        :title="sectionComplete ? `四壁均已确认，${trench?.area} · ${trench?.code} 剖面记录完成` : `剖面记录未完成：已确认 ${confirmedCount} / 4 壁${reviewCount > 0 ? `，${reviewCount} 壁待复核` : ''}`"
      >
        <template #default>
          <p v-if="trench?.wallNote">四壁方向备注：{{ trench.wallNote }}</p>
        </template>
      </el-alert>

      <!-- 四壁状态总览 -->
      <div class="wall-overview">
        <button
          v-for="item in wallOverview"
          :key="item.name"
          type="button"
          class="wall-chip"
          :class="[`chip-${item.type}`, { active: item.name === wall }]"
          @click="wall = item.name"
        >
          <span class="chip-name">{{ item.name }}</span>
          <el-tag :type="item.type" size="small" effect="dark">{{ item.label }}</el-tag>
          <span v-if="item.record?.recorder" class="chip-meta">{{ item.record.recorder }} · {{ item.record.drawingNo || '无绘图号' }}</span>
          <span v-else class="chip-meta">尚未留痕</span>
        </button>
      </div>
    </template>

    <div class="layout">
      <el-card shadow="never" class="section-card">
        <template #header>
          <div class="card-head">
            <span>{{ wall }}剖面示意（深度刻度 0 – {{ maxDepth }} m）</span>
            <el-tag :type="wallOverview.find((item) => item.name === wall)?.type" size="small" effect="plain">
              {{ wallOverview.find((item) => item.name === wall)?.label }}
            </el-tag>
          </div>
        </template>
        <svg :width="CANVAS_W" :height="CANVAS_H" role="img" :aria-label="`${wall}剖面示意`">
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
            {{ wall }}（地表 0 m）
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

    <!-- 四壁记录维护 -->
    <el-card v-if="trench" shadow="never" class="wall-editor">
      <template #header>
        <div class="card-head">
          <span>{{ wall }}现场记录</span>
          <el-tag :type="wallOverview.find((item) => item.name === wall)?.type" size="small" effect="dark">
            {{ wallOverview.find((item) => item.name === wall)?.label }}
          </el-tag>
        </div>
      </template>

      <el-alert
        v-if="currentRecord?.needsReview"
        class="review-alert"
        type="error"
        :closable="false"
        show-icon
        :title="`地层深度改动后，${wall}界线需现场复核；未复核通过前不能确认该壁，探方剖面也不计完成`"
      >
        <template #default>
          <span v-if="reviewStrata.length > 0">
            涉及单位：<b v-for="item in reviewStrata" :key="item.id" class="review-unit">{{ item.code }}</b>
          </span>
        </template>
      </el-alert>

      <el-form label-width="92px" class="wall-form">
        <el-row :gutter="16">
          <el-col :span="8">
            <el-form-item label="记录人">
              <el-input v-model="form.recorder" placeholder="现场记录人姓名" />
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="绘图号">
              <el-input v-model="form.drawingNo" placeholder="如 T0501-北壁-01" />
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="更新日期">
              <el-input :model-value="currentRecord?.updatedAt ?? '保存后生成'" disabled />
            </el-form-item>
          </el-col>
        </el-row>
      </el-form>

      <h4 class="boundary-title">各地层顶、底界线备注</h4>
      <el-table :data="form.boundaries" border size="small" class="boundary-table">
        <el-table-column label="单位号" width="110">
          <template #default="{ row }: { row: { stratumId: string } }">
            <span class="mono">{{ strata.find((item) => item.id === row.stratumId)?.code ?? '—' }}</span>
          </template>
        </el-table-column>
        <el-table-column label="类型" width="90">
          <template #default="{ row }: { row: { stratumId: string } }">
            <el-tag size="small" effect="plain">{{ strata.find((item) => item.id === row.stratumId)?.type ?? '—' }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="深度（顶–底 m）" width="150">
          <template #default="{ row }: { row: { stratumId: string } }">
            <span class="muted">
              {{ strata.find((item) => item.id === row.stratumId)?.topDepth ?? '—' }} –
              {{ strata.find((item) => item.id === row.stratumId)?.bottomDepth ?? '—' }}
            </span>
          </template>
        </el-table-column>
        <el-table-column label="顶界备注" min-width="200">
          <template #default="{ row }: { row: { stratumId: string; topNote: string } }">
            <el-input v-model="row.topNote" size="small" :placeholder="noteOf(row.stratumId, 'topNote') ? '' : '如 水平、西高东低'" />
          </template>
        </el-table-column>
        <el-table-column label="底界备注" min-width="200">
          <template #default="{ row }: { row: { stratumId: string; bottomNote: string } }">
            <el-input v-model="row.bottomNote" size="small" :placeholder="noteOf(row.stratumId, 'bottomNote') ? '' : '如 与下层界面清楚'" />
          </template>
        </el-table-column>
      </el-table>
      <p v-if="form.boundaries.length === 0" class="muted empty-line">该探方暂无可登记界线的地层单位</p>

      <div class="editor-actions">
        <el-button type="primary" :disabled="!formFilled && !formDirty" @click="saveDraft">保存壁记录</el-button>
        <el-button
          v-if="currentRecord?.needsReview"
          type="danger"
          plain
          :disabled="!formFilled"
          @click="reviewAndConfirm"
        >
          复核并确认
        </el-button>
        <el-button
          v-else-if="!currentRecord?.confirmed"
          type="success"
          plain
          :disabled="!formFilled"
          @click="confirmWall"
        >
          确认该壁
        </el-button>
        <el-button v-else type="warning" plain @click="unconfirmWall">取消确认</el-button>
        <span class="action-tip">
          {{ currentRecord?.needsReview
            ? '深度改动后须现场复核，普通「确认」已锁定'
            : currentRecord?.confirmed
              ? '该壁已确认；改动地层深度会自动退回待复核'
              : '四壁全部确认后，本探方剖面才计为完成' }}
        </span>
      </div>
    </el-card>
  </div>
</template>

<style scoped>
.alert {
  margin-bottom: 14px;
}
.head-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
}
.wall-overview {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 12px;
  margin-bottom: 16px;
}
.wall-chip {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 14px;
  background: #fff;
  border: 1px solid #e6ded0;
  border-left-width: 4px;
  border-radius: 10px;
  cursor: pointer;
  text-align: left;
  font: inherit;
  transition: box-shadow 0.15s;
}
.wall-chip:hover {
  box-shadow: 0 2px 10px rgba(74, 55, 34, 0.1);
}
.wall-chip.active {
  border-color: #a9762f;
  box-shadow: 0 0 0 2px rgba(169, 118, 47, 0.18);
}
.wall-chip.chip-success { border-left-color: #67c23a; }
.wall-chip.chip-warning { border-left-color: #e6a23c; }
.wall-chip.chip-danger { border-left-color: #f56c6c; }
.wall-chip.chip-info { border-left-color: #c0b8a8; }
.chip-name {
  font-weight: 600;
  font-size: 15px;
  white-space: nowrap;
}
.chip-meta {
  font-size: 11px;
  color: #8a8073;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
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
.card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
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
.wall-editor {
  margin-top: 16px;
  border-radius: 12px;
}
.review-alert {
  margin-bottom: 14px;
}
.review-unit {
  margin: 0 4px;
}
.wall-form {
  margin-top: 4px;
}
.boundary-title {
  margin: 6px 0 8px;
  font-size: 14px;
}
.boundary-table :deep(.el-input__wrapper) {
  padding: 0 8px;
}
.empty-line {
  margin: 8px 0 0;
}
.editor-actions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 14px;
}
.action-tip {
  font-size: 12px;
  color: #8a8073;
}
</style>
