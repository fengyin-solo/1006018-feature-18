<template>
  <section class="page" data-module="team">
    <header class="page-head">
      <div>
        <h2>保障班组管理</h2>
        <p class="page-desc">维护保障班组，围绕班组编号、班组名称、负责区域、在岗人数做登记、筛选与状态流转；登记校验区域重叠，支持按班次整批排班。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="toggleCreate">登记保障班组</button>
        <button class="btn" type="button" @click="exportRows">导出保障班组清单</button>
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

    <div v-if="showCreate" class="panel">
      <h3>登记保障班组</h3>
      <p class="note">负责区域与其它在岗班组完全重叠的登记会被挡回；只共用部分区域、各有独有区域的可以登记。</p>
      <form class="form-grid" @submit.prevent="submitCreate">
        <label class="form-item">
          <span>班组名称</span>
          <input v-model="createForm.班组名称" placeholder="如：机坪保障四组" />
        </label>
        <label class="form-item">
          <span>负责区域</span>
          <input v-model="createForm.负责区域" placeholder="如：机坪A区、机位119-122" />
        </label>
        <label class="form-item">
          <span>在岗人数</span>
          <input v-model="createForm.在岗人数" type="number" min="1" placeholder="如：10" />
        </label>
        <label class="form-item">
          <span>班次时段</span>
          <input v-model="createForm.班次时段" placeholder="如：06:00-14:00" />
        </label>
        <label class="form-item">
          <span>带班人员</span>
          <input v-model="createForm.带班人员" placeholder="选填" />
        </label>
        <label class="form-item">
          <span>轮休安排</span>
          <input v-model="createForm.轮休安排" placeholder="选填" />
        </label>
        <button class="btn primary" type="submit">提交登记</button>
        <button class="btn ghost" type="button" @click="toggleCreate">取消</button>
      </form>
      <p v-if="createMessage" class="error-text">{{ createMessage }}</p>
    </div>

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
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td v-for="column in columns" :key="column">{{ row[column] ?? '—' }}</td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <button
              v-for="action in actions"
              :key="action"
              class="link"
              type="button"
              @click="runAction(action, row)"
            >
              {{ action }}
            </button>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">暂无保障班组数据，可先登记保障班组</td>
        </tr>
      </tbody>
    </table>

    <section class="panel">
      <h3>班组排班 · 整批下发</h3>
      <div class="dispatch-bar">
        <label class="form-item">
          <span>班次时段</span>
          <input v-model="shiftInput" placeholder="如：06:00-14:00" />
        </label>
        <button class="btn primary" type="button" @click="submitBatch">整批下发</button>
        <span class="note">勾选班组并填需求人数，按班次时段与在岗人数整组分配，逐组给出结果。</span>
      </div>
      <table class="data-table">
        <thead>
          <tr>
            <th>选择</th>
            <th>班组编号</th>
            <th>班组名称</th>
            <th>负责区域</th>
            <th>班次时段</th>
            <th>班组状态</th>
            <th>在岗人数</th>
            <th>本班次已占用</th>
            <th>需求人数</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="team in allTeams" :key="String(team.id)">
            <td>
              <input
                type="checkbox"
                :checked="!!selected[Number(team.id)]"
                :disabled="String(team.status) !== '在岗'"
                :title="String(team.status) !== '在岗' ? '不在岗的班组不能派班' : ''"
                @change="toggleSelect(team)"
              />
            </td>
            <td>{{ team['班组编号'] }}</td>
            <td>{{ team['班组名称'] }}</td>
            <td>{{ team['负责区域'] }}</td>
            <td>{{ team['班次时段'] }}</td>
            <td>{{ team.status }}</td>
            <td>{{ team['在岗人数'] }}</td>
            <td>{{ committedOf(Number(team.id)) }}</td>
            <td>
              <input
                v-model.number="demands[Number(team.id)]"
                class="demand-input"
                type="number"
                min="1"
                :disabled="!selected[Number(team.id)]"
              />
            </td>
          </tr>
        </tbody>
      </table>
      <details class="note basis-note">
        <summary>缺口调剂依据</summary>
        <ol>
          <li v-for="line in basis" :key="line">{{ line }}</li>
        </ol>
      </details>
      <p v-if="batchMessage" class="note">{{ batchMessage }}</p>
      <ul v-if="batchResults.length" class="result-list">
        <li
          v-for="result in batchResults"
          :key="result.teamId"
          :class="result.status === '已下发' ? 'ok' : result.status === '待调整' ? 'hold' : ''"
        >
          <span class="badge" :class="result.status === '已下发' ? 'ok' : result.status === '待调整' ? 'hold' : 'muted'">
            {{ result.status }}
          </span>
          {{ result.teamName }}：{{ result.message }}
        </li>
      </ul>
    </section>

    <section class="panel">
      <h3>人员需求清单（排班结果）</h3>
      <p class="note">在岗人数实时读班组登记，与调度（保障资源调度）页面同源；在岗人数不够的整组留在待调整，可重新调剂。</p>
      <table class="data-table">
        <thead>
          <tr>
            <th>排班编号</th>
            <th>班次时段</th>
            <th>班组名称</th>
            <th>负责区域</th>
            <th>需求人数</th>
            <th>在岗人数</th>
            <th>借调明细</th>
            <th>缺口</th>
            <th>状态</th>
            <th>登记时间</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="record in shiftRecords" :key="record.id">
            <td>{{ record.排班编号 }}</td>
            <td>{{ record.班次时段 }}</td>
            <td>{{ record.班组名称 }}</td>
            <td>{{ record.负责区域 }}</td>
            <td>{{ record.需求人数 }}</td>
            <td>{{ record.在岗人数 }}</td>
            <td>{{ record.借调明细 || '—' }}</td>
            <td>{{ record.缺口 > 0 ? `缺 ${record.缺口} 人` : '—' }}</td>
            <td>
              <span class="badge" :class="record.status === '已下发' ? 'ok' : 'hold'">{{ record.status }}</span>
            </td>
            <td>{{ record.登记时间 }}</td>
            <td>
              <button
                v-if="record.status === '待调整'"
                class="link"
                type="button"
                @click="retryRecord(record.id)"
              >
                重新调剂
              </button>
              <span v-else>—</span>
            </td>
          </tr>
          <tr v-if="!shiftRecords.length">
            <td colspan="11" class="empty-state">暂无排班记录，先在上方整批下发</td>
          </tr>
        </tbody>
      </table>
    </section>

    <footer class="page-foot">
      <span>共 {{ total }} 条保障班组记录</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'

import { downloadEntries, listEntries, moduleMeta } from '@/api/local-service'
import {
  REBALANCE_BASIS,
  TEAM_ACTIONS,
  committedByTeam,
  dispatchBatch,
  listShiftRecordViews,
  registerTeam,
  retryShiftRecord,
  runTeamAction,
} from '@/api/team-schedule'
import type { DispatchGroupResult, ShiftRecordView } from '@/api/team-schedule'
import type { EntryRow } from '@/data/types'

const meta = moduleMeta('team')
const columns = ["班组编号", "班组名称", "负责区域", "在岗人数", "班次时段", "带班人员", "轮休安排", "班组状态"]
const actions = TEAM_ACTIONS
const statuses = ["在岗", "轮休", "培训中", "已解散"]
const basis = REBALANCE_BASIS

const rows = ref<EntryRow[]>([])
const allTeams = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)

const stats = computed(() => [
  { label: '在册班组', value: allTeams.value.length },
  { label: '在岗班组', value: allTeams.value.filter((row) => String(row.status) === '在岗').length },
  { label: '轮休班组', value: allTeams.value.filter((row) => String(row.status) === '轮休').length },
])
const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: allTeams.value.filter((row) => String(row.status) === status).length,
  })),
)

// —— 登记 ——
const showCreate = ref(false)
const createMessage = ref('')
const createForm = reactive({
  班组名称: '',
  负责区域: '',
  在岗人数: '' as string | number,
  班次时段: '06:00-14:00',
  带班人员: '',
  轮休安排: '',
})

function toggleCreate() {
  showCreate.value = !showCreate.value
  createMessage.value = ''
}

function submitCreate() {
  const result = registerTeam({ ...createForm })
  if (!result.ok) {
    createMessage.value = result.message
    return
  }
  createMessage.value = ''
  showCreate.value = false
  createForm.班组名称 = ''
  createForm.负责区域 = ''
  createForm.在岗人数 = ''
  createForm.带班人员 = ''
  createForm.轮休安排 = ''
  reload()
}

// —— 整批下发 ——
const shiftInput = ref('06:00-14:00')
const selected = reactive<Record<number, boolean>>({})
const demands = reactive<Record<number, number>>({})
const batchMessage = ref('')
const batchResults = ref<DispatchGroupResult[]>([])
const scheduleTick = ref(0)

const committedView = computed(() => {
  scheduleTick.value
  return committedByTeam(shiftInput.value.trim())
})
const shiftRecords = computed<ShiftRecordView[]>(() => {
  scheduleTick.value
  return listShiftRecordViews()
})

function committedOf(teamId: number): number {
  return committedView.value.get(teamId) ?? 0
}

function toggleSelect(team: EntryRow) {
  const id = Number(team.id)
  selected[id] = !selected[id]
  if (selected[id] && !demands[id]) {
    demands[id] = Number(team['在岗人数']) || 1
  }
}

function submitBatch() {
  errorMessage.value = ''
  const items = allTeams.value
    .filter((team) => selected[Number(team.id)])
    .map((team) => ({ teamId: Number(team.id), demand: Number(demands[Number(team.id)]) }))
  const payload = dispatchBatch(shiftInput.value, items)
  batchMessage.value = payload.message
  batchResults.value = payload.results
  if (payload.ok) {
    Object.keys(selected).forEach((key) => delete selected[Number(key)])
  }
  scheduleTick.value++
  reload()
}

function retryRecord(id: number) {
  const result = retryShiftRecord(id)
  batchMessage.value = result.message
  scheduleTick.value++
  reload()
}

// —— 列表与动作 ——
function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  const result = runTeamAction(Number(row.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  reload()
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
    allTeams.value = listEntries(meta.key).items
    scheduleTick.value++
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '保障班组列表读取失败'
  }
}

onMounted(reload)
</script>
