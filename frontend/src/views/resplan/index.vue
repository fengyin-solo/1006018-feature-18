<template>
  <section class="page" data-module="resplan">
    <header class="page-head">
      <div>
        <h2>人员需求清单（排班下发结果）</h2>
        <p class="page-desc">
          排班结果逐组落到本清单。「台账在岗人数」实时读取保障班组台账，与清单登记值同源；
          两边对不上会标红提示，调度不得拿旧人数排班。缺口未补齐的批次保持待调整。
        </p>
      </div>
      <div class="page-actions">
        <button class="btn" type="button" @click="exportRows">导出人员需求清单</button>
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
          <th>台账在岗人数（同源）</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td v-for="column in columns" :key="column" :class="{ 'gap-cell': column === '人员缺口' && Number(row[column]) > 0 }">
            {{ row[column] ?? '—' }}
          </td>
          <td :class="{ 'drift-cell': row.drift }">
            <template v-if="row.sourceOnDuty === null">—</template>
            <template v-else>
              {{ row.sourceOnDuty }}
              <span v-if="row.drift" class="error-text" title="清单登记人数已与班组台账不一致">⚠ 台账已变</span>
            </template>
          </td>
          <td>
            <span class="tag" :class="statusClass(String(row.status))">{{ row.status }}</span>
          </td>
          <td class="row-actions">
            <template v-if="availableActions(String(row.status)).length">
              <button
                v-for="action in availableActions(String(row.status))"
                :key="action"
                class="link"
                type="button"
                @click="runAction(action, row)"
              >
                {{ action }}
              </button>
            </template>
            <span v-else class="muted-text">—</span>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 3" class="empty-state">暂无人员需求清单，请先到保障班组页整批下发排班</td>
        </tr>
      </tbody>
    </table>

    <section class="rule-box">
      <h3>缺口调剂依据（排班下发时自动执行）</h3>
      <ol>
        <li>只在同批下发、状态在岗的班组之间调剂，不跨班次，不动轮休、培训中、已解散班组。</li>
        <li>优先借负责区域与缺口区域有重叠的班组：熟区域、免转场，保障不断档。</li>
        <li>同样可借时，富余人数多的班组先出（削峰填谷），仍并列按班组编号升序，结果可预期、可追溯。</li>
        <li>借出后自身仍须满足本班组需求，不会把借出方借成新缺口。</li>
        <li>同批富余都补不上的缺口留在待调整，清单写清还差几人，由调度另行组织增援或顺延任务。</li>
      </ol>
    </section>

    <footer class="page-foot">
      <span>共 {{ total }} 条人员需求清单</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  downloadEntries,
  listStaffingPlans,
  moduleMeta,
  runAction as applyAction,
} from '@/api/local-service'
import type { EnrichedRow } from '@/data/types'

const meta = moduleMeta('resplan')
const columns = [
  '计划编号',
  '保障班组',
  '负责区域',
  '班次时段',
  '需求人数',
  '班组在岗人数',
  '在岗人数来源',
  '人员缺口',
  '调剂说明',
  '调度人员',
]

const rows = ref<EnrichedRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = ['计划编号', '保障班组', '班次时段']

const stats = computed(() => [
  { label: '已下发清单', value: rows.value.filter((row) => String(row.status) === '已下发').length },
  { label: '待调整批次', value: rows.value.filter((row) => String(row.status) === '待调整').length },
  {
    label: '存在缺口的清单',
    value: rows.value.filter((row) => Number(row['人员缺口'] ?? 0) > 0).length,
  },
  {
    label: '人数与台账不一致',
    value: rows.value.filter((row) => row.drift).length,
  },
])

const statusSummary = computed(() =>
  ['待调整', '待编制', '待审核', '已下发', '已作废'].map((status) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

function statusClass(status: string): string {
  if (status === '已下发') {
    return 'ok'
  }
  if (status === '待调整') {
    return 'danger'
  }
  if (status === '已作废') {
    return 'dead'
  }
  return 'warn'
}

/** 待调整批次需先消除缺口（在保障班组页重新下发），不允许直接下发或送审。 */
function availableActions(status: string): string[] {
  switch (status) {
    case '待编制':
      return ['提交审核', '作废计划']
    case '待审核':
      return ['下发计划', '作废计划']
    case '已下发':
      return ['作废计划']
    default:
      return []
  }
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function runAction(action: string, row: EnrichedRow) {
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
    const payload = listStaffingPlans(filters.value)
    rows.value = payload.items
    total.value = payload.total
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '人员需求清单读取失败'
  }
}

onMounted(reload)
</script>

<style scoped>
.muted-text {
  color: var(--muted);
  font-size: 12px;
}
.gap-cell {
  color: #b42318;
  font-weight: 600;
}
.drift-cell {
  background: #fef3f2;
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
.tag-danger {
  background: #fee4e2;
  color: #b42318;
}
.tag-dead {
  background: #eaecf0;
  color: #667085;
}
.rule-box {
  margin-top: 20px;
  background: #fff;
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 12px 16px;
}
.rule-box h3 {
  margin: 0 0 6px;
  font-size: 14px;
}
.rule-box ol {
  margin: 0;
  padding-left: 20px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 13px;
  color: #334155;
}
</style>
