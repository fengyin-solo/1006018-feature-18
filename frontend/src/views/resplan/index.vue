<template>
  <section class="page" data-module="resplan">
    <header class="page-head">
      <div>
        <h2>保障资源调度管理</h2>
        <p class="page-desc">维护资源计划，围绕计划编号、保障时段、机位需求、车辆需求做登记、筛选与状态流转。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记资源计划</button>
        <button class="btn" type="button" @click="exportRows">导出保障资源调度清单</button>
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
          <td :colspan="columns.length + 2" class="empty-state">暂无保障资源调度数据，可先登记资源计划</td>
        </tr>
      </tbody>
    </table>

    <section class="panel">
      <h3>人员需求清单 · 班组排班同源</h3>
      <p class="note">
        在岗人数直接读保障班组登记，与班组排班同源，调度不另行维护；当前在岗班组
        {{ dutySummary.teams }} 个，在岗人数合计 {{ dutySummary.headcount }} 人。
        <template v-if="heldCount">有 {{ heldCount }} 条排班记录待调整，请到保障班组页面处理。</template>
      </p>
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
          </tr>
          <tr v-if="!shiftRecords.length">
            <td colspan="9" class="empty-state">暂无排班下发记录</td>
          </tr>
        </tbody>
      </table>
    </section>

    <footer class="page-foot">
      <span>共 {{ total }} 条保障资源调度记录</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  downloadEntries,
  listEntries,
  moduleMeta,
  runAction as applyAction,
} from '@/api/local-service'
import { listShiftRecordViews, onDutySummary } from '@/api/team-schedule'
import type { ShiftRecordView } from '@/api/team-schedule'
import type { EntryRow } from '@/data/types'

const meta = moduleMeta('resplan')
const columns = ["计划编号", "保障时段", "机位需求", "车辆需求", "人员需求", "资源缺口", "调度人员", "计划状态"]
const actions = ["提交审核", "下发计划", "作废计划"]
const statuses = ["待编制", "待审核", "已下发", "已作废"]
const stats = [{"label": "待编制计划", "value": 0}, {"label": "已下发计划", "value": 0}, {"label": "存在缺口的计划", "value": 0}]

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)
// 班组排班同源数据：在岗人数与人员需求清单都读班组排班这一份
const shiftRecords = ref<ShiftRecordView[]>([])
const dutySummary = ref({ teams: 0, headcount: 0 })
const heldCount = computed(() => shiftRecords.value.filter((item) => item.status === '待调整').length)
const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  errorMessage.value = '资源计划登记入口尚未接入审批流'
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  const result = applyAction(meta.key, Number(row.id), action)
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
    shiftRecords.value = listShiftRecordViews()
    dutySummary.value = onDutySummary()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '保障资源调度列表读取失败'
  }
}

onMounted(reload)
</script>
