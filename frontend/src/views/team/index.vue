<template>
  <section class="page" data-module="team">
    <header class="page-head">
      <div>
        <h2>保障班组排班</h2>
        <p class="page-desc">
          登记时校验负责区域不得与其它在岗班组完全重叠；勾选多个在岗班组可按班次时段整批下发任务，
          在岗人数顶不住的组留在待调整。状态只能按 在岗 → 轮休 → 培训中 依次推进，已解散不可回岗。
        </p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记保障班组</button>
        <button class="btn" type="button" :disabled="selectedIds.size === 0" @click="openDispatch">
          整批下发排班（{{ selectedIds.size }}）
        </button>
        <button class="btn" type="button" @click="exportRows">导出班组清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <form class="filter-bar" @submit.prevent="reload">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th class="col-check">
            <input
              type="checkbox"
              title="全选当前在岗班组"
              :checked="allOnDutySelected"
              @change="toggleSelectAll"
            />
          </th>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)" :class="{ 'row-dismissed': row.status === '已解散' }">
          <td>
            <input
              v-if="row.status === '在岗'"
              type="checkbox"
              :checked="selectedIds.has(Number(row.id))"
              @change="toggleSelect(Number(row.id))"
            />
          </td>
          <td v-for="column in columns" :key="column">{{ row[column] ?? '—' }}</td>
          <td>
            <span class="tag" :class="`tag-${statusClass(String(row.status))}`">{{ row.status }}</span>
          </td>
          <td class="row-actions">
            <button
              v-for="action in availableActions(String(row.status))"
              :key="action"
              class="link"
              type="button"
              @click="runAction(action, row)"
            >
              {{ action }}
            </button>
            <span v-if="availableActions(String(row.status)).length === 0" class="muted-text">—</span>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 3" class="empty-state">暂无保障班组数据，可先登记保障班组</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条保障班组记录</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>

    <section class="duty-log">
      <header class="duty-log-head">
        <h3>在岗确认记录</h3>
        <span class="muted-text">同一班组一段连续在岗只记一次：登记即在岗自动记首条，回岗再记一条</span>
      </header>
      <table class="data-table">
        <thead>
          <tr>
            <th>记录号</th>
            <th>班组编号</th>
            <th>班组名称</th>
            <th>确认时间</th>
            <th>来源</th>
            <th>操作人</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="log in logs" :key="log.id">
            <td>{{ log.id }}</td>
            <td>{{ log.teamCode }}</td>
            <td>{{ log.teamName }}</td>
            <td>{{ log.confirmedAt }}</td>
            <td>{{ log.source }}</td>
            <td>{{ log.operator }}</td>
          </tr>
          <tr v-if="!logs.length">
            <td colspan="6" class="empty-state">暂无在岗确认记录</td>
          </tr>
        </tbody>
      </table>
    </section>

    <!-- 登记保障班组 -->
    <div v-if="createOpen" class="modal-mask" @click.self="createOpen = false">
      <div class="modal">
        <h3>登记保障班组</h3>
        <p class="muted-text">
          负责区域填区域代码，多个区域用逗号分隔，如「T1区,T2区」。登记成功即确认在岗，
          区域被其它在岗班组完全包住会被挡回并指出撞了谁。
        </p>
        <form class="modal-form" @submit.prevent="submitCreate">
          <label>
            <span>班组名称 *</span>
            <input v-model="createForm.班组名称" placeholder="如：机坪保障三班" />
          </label>
          <label>
            <span>负责区域 *</span>
            <input v-model="createForm.负责区域" placeholder="如：T1区,T2区" />
          </label>
          <label>
            <span>在岗人数 *</span>
            <input v-model.number="createForm.在岗人数" type="number" min="1" step="1" />
          </label>
          <label>
            <span>班次时段 *</span>
            <input v-model="createForm.班次时段" placeholder="如：白班 08:00-20:00" />
          </label>
          <label>
            <span>带班人员</span>
            <input v-model="createForm.带班人员" placeholder="带班人姓名" />
          </label>
          <label>
            <span>轮休安排</span>
            <input v-model="createForm.轮休安排" placeholder="如：本周六轮休" />
          </label>
          <p v-if="createError" class="error-text">{{ createError }}</p>
          <p v-if="createWarn" class="warn-text">{{ createWarn }}</p>
          <div class="modal-actions">
            <button class="btn ghost" type="button" @click="createOpen = false">取消</button>
            <button class="btn primary" type="submit">登记并确认在岗</button>
          </div>
        </form>
      </div>
    </div>

    <!-- 整批下发排班 -->
    <div v-if="dispatchOpen" class="modal-mask modal-wide" @click.self="closeDispatch">
      <div class="modal">
        <h3>整批下发排班</h3>
        <p class="muted-text">
          按班次时段对勾选班组整组分配任务，逐组判定：在岗人数满足需求照常落实，写进人员需求清单；
          顶不住的先在同批班组间按「共区优先、富余削峰」借调，仍有缺口的组留在待调整。
        </p>
        <form class="modal-form" @submit.prevent="submitDispatch">
          <label class="shift-input">
            <span>班次时段 *</span>
            <input v-model="dispatchShift" placeholder="如：白班 08:00-20:00" />
          </label>
          <table class="data-table dispatch-table">
            <thead>
              <tr>
                <th>班组</th>
                <th>负责区域</th>
                <th>台账在岗人数</th>
                <th>本班次需求人数</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="item in dispatchRows" :key="item.id">
                <td>{{ item['班组编号'] }} {{ item['班组名称'] }}</td>
                <td>{{ item['负责区域'] }}</td>
                <td>{{ item['在岗人数'] }}</td>
                <td>
                  <input v-model.number="demandMap[item.id]" type="number" min="0" step="1" />
                </td>
              </tr>
            </tbody>
          </table>
          <p v-if="dispatchError" class="error-text">{{ dispatchError }}</p>
          <div v-if="dispatchResult" class="dispatch-result">
            <h4>逐组结果</h4>
            <ul>
              <li v-for="group in dispatchResult.groups" :key="group.teamId">
                <span class="tag" :class="group.status === '已下发' ? 'tag-ok' : 'tag-warn'">
                  {{ group.status }}
                </span>
                {{ group.teamCode }} {{ group.teamName }}：{{ group.detail }}
                <span class="muted-text">（清单 {{ group.planNo }}）</span>
              </li>
            </ul>
            <p v-if="dispatchResult.transfers.length" class="muted-text">
              调剂流水：
              <span v-for="(transfer, index) in dispatchResult.transfers" :key="index">
                {{ transfer.from }} → {{ transfer.to }} 调 {{ transfer.people }} 人（{{ transfer.reason }}）；
              </span>
            </p>
          </div>
          <div class="modal-actions">
            <button class="btn ghost" type="button" @click="closeDispatch">关闭</button>
            <button class="btn primary" type="submit" :disabled="!!dispatchResult">整批下发</button>
          </div>
        </form>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  createTeam,
  dispatchTeams,
  downloadEntries,
  dutyLogs,
  listEntries,
  moduleMeta,
  runAction as applyAction,
} from '@/api/local-service'
import type { CreateTeamInput, DispatchResult, DutyLog, EntryRow } from '@/data/types'

const meta = moduleMeta('team')
const columns = ['班组编号', '班组名称', '负责区域', '在岗人数', '班次时段', '带班人员', '轮休安排']

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = ['班组编号', '班组名称', '负责区域']

const logs = ref<DutyLog[]>([])
const selectedIds = ref<Set<number>>(new Set())

const stats = computed(() => [
  { label: '在册班组', value: rows.value.length },
  { label: '在岗班组', value: countByStatus('在岗') },
  { label: '轮休班组', value: countByStatus('轮休') },
  { label: '培训中班', value: countByStatus('培训中') },
])

const statusSummary = computed(() =>
  ['在岗', '轮休', '培训中', '已解散'].map((status) => ({
    status,
    count: countByStatus(status),
  })),
)

const onDutyRows = computed(() => rows.value.filter((row) => String(row.status) === '在岗'))
const allOnDutySelected = computed(
  () => onDutyRows.value.length > 0 && onDutyRows.value.every((row) => selectedIds.value.has(Number(row.id))),
)

function countByStatus(status: string): number {
  return rows.value.filter((row) => String(row.status) === status).length
}

function statusClass(status: string): string {
  if (status === '在岗') {
    return 'ok'
  }
  if (status === '已解散') {
    return 'dead'
  }
  return 'warn'
}

/** 页面只摆合法动作，业务判定仍以 local-service 的状态机为准。 */
function availableActions(status: string): string[] {
  switch (status) {
    case '在岗':
      return ['安排轮休', '解散班组']
    case '轮休':
      return ['确认在岗', '提交培训', '解散班组']
    case '培训中':
      return ['解散班组']
    default:
      return []
  }
}

function toggleSelect(id: number) {
  const next = new Set(selectedIds.value)
  if (next.has(id)) {
    next.delete(id)
  } else {
    next.add(id)
  }
  selectedIds.value = next
}

function toggleSelectAll(event: Event) {
  const checked = (event.target as HTMLInputElement).checked
  selectedIds.value = checked ? new Set(onDutyRows.value.map((row) => Number(row.id))) : new Set()
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  const result = applyAction(meta.key, Number(row.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
  }
  reload()
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
    logs.value = dutyLogs()
    const validIds = new Set(rows.value.map((row) => Number(row.id)))
    selectedIds.value = new Set([...selectedIds.value].filter((id) => validIds.has(id)))
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '保障班组列表读取失败'
  }
}

// ---------- 登记 ----------

const createOpen = ref(false)
const createError = ref('')
const createWarn = ref('')
const createForm = ref<CreateTeamInput>({
  班组名称: '',
  负责区域: '',
  在岗人数: 0,
  班次时段: '',
  带班人员: '',
  轮休安排: '',
})

function openCreate() {
  createForm.value = { 班组名称: '', 负责区域: '', 在岗人数: 0, 班次时段: '', 带班人员: '', 轮休安排: '' }
  createError.value = ''
  createWarn.value = ''
  createOpen.value = true
}

function submitCreate() {
  createError.value = ''
  createWarn.value = ''
  const result = createTeam(createForm.value)
  if (!result.ok) {
    createError.value = result.message
    return
  }
  createOpen.value = false
  errorMessage.value = ''
  reload()
}

// ---------- 整批下发 ----------

const dispatchOpen = ref(false)
const dispatchShift = ref('白班 08:00-20:00')
const demandMap = ref<Record<number, number>>({})
const dispatchError = ref('')
const dispatchResult = ref<DispatchResult | null>(null)
const dispatchRows = ref<EntryRow[]>([])

function openDispatch() {
  dispatchRows.value = rows.value.filter((row) => selectedIds.value.has(Number(row.id)))
  const initial: Record<number, number> = {}
  for (const row of dispatchRows.value) {
    initial[Number(row.id)] = Number(row['在岗人数']) || 0
  }
  demandMap.value = initial
  dispatchError.value = ''
  dispatchResult.value = null
  dispatchOpen.value = true
}

function closeDispatch() {
  dispatchOpen.value = false
  dispatchResult.value = null
  reload()
}

function submitDispatch() {
  dispatchError.value = ''
  const groups = dispatchRows.value.map((row) => ({
    teamId: Number(row.id),
    demand: Number(demandMap.value[Number(row.id)] ?? 0),
  }))
  const result = dispatchTeams(dispatchShift.value, groups)
  if (!result.ok) {
    dispatchError.value = result.message
    return
  }
  dispatchResult.value = result
}

onMounted(reload)
</script>

<style scoped>
.page-actions {
  display: flex;
  gap: 8px;
}
.col-check {
  width: 36px;
  text-align: center;
}
.row-dismissed {
  color: var(--muted);
}
.muted-text {
  color: var(--muted);
  font-size: 12px;
}
.warn-text {
  color: #b54708;
  font-size: 12px;
}
.tag {
  display: inline-block;
  border-radius: 999px;
  padding: 1px 10px;
  font-size: 12px;
}
.tag-ok {
  background: #dcfae6;
  color: #067647;
}
.tag-warn {
  background: #fef0c7;
  color: #b54708;
}
.tag-dead {
  background: #eaecf0;
  color: #667085;
}
.duty-log {
  margin-top: 20px;
}
.duty-log-head {
  display: flex;
  align-items: baseline;
  gap: 12px;
}
.duty-log-head h3 {
  margin: 0 0 6px;
  font-size: 14px;
}
.modal-mask {
  position: fixed;
  inset: 0;
  background: rgba(16, 24, 40, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 20;
}
.modal {
  background: #fff;
  border-radius: 10px;
  padding: 20px 24px;
  width: 480px;
  max-height: 86vh;
  overflow: auto;
}
.modal-wide .modal {
  width: 760px;
}
.modal h3 {
  margin: 0 0 8px;
}
.modal-form {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-top: 10px;
}
.modal-form label span {
  display: block;
  font-size: 12px;
  color: var(--muted);
  margin-bottom: 2px;
}
.modal-form input {
  width: 100%;
  padding: 6px 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
}
.modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 6px;
}
.dispatch-table input {
  width: 90px;
  padding: 4px 6px;
}
.dispatch-result h4 {
  margin: 8px 0;
  font-size: 13px;
}
.dispatch-result ul {
  margin: 0;
  padding-left: 18px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 13px;
}
.shift-input {
  max-width: 320px;
}
</style>
