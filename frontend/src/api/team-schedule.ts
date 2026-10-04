import { listRows, saveRows } from '@/data/local-store'
import type { ActionResult, EntryRow } from '@/data/types'

// 保障班组排班层：登记校验、状态流转、整批下发、缺口调剂、人员需求清单都收口在这里，
// 页面组件不做业务判断（与 local-service 的分工约定一致）。

const TEAM_KEY = 'team'
const SHIFT_KEY = 'teamshift'

// —— 班组状态流转 ——————————————————————————————————————————————
// 状态只可按 在岗 → 轮休 → 培训中 依次推进，培训中确认在岗完成一轮轮转；
// 已解散是终点：不能回到在岗，也不能再变更。在岗班组不允许直接解散，须先离岗。
const TEAM_ACTION_TARGETS: Record<string, string> = {
  确认在岗: '在岗',
  安排轮休: '轮休',
  提交培训: '培训中',
  解散班组: '已解散',
}
const TEAM_ROTATION = ['在岗', '轮休', '培训中']
const TEAM_TERMINAL = '已解散'

export const TEAM_ACTIONS = Object.keys(TEAM_ACTION_TARGETS)

function teamName(row: EntryRow): string {
  return String(row['班组名称'] ?? row['班组编号'] ?? row.id)
}

export function runTeamAction(id: number, action: string): ActionResult {
  const target = TEAM_ACTION_TARGETS[action]
  if (!target) {
    return { ok: false, message: `保障班组没有登记「${action}」这个动作` }
  }
  const rows = listRows(TEAM_KEY)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的保障班组` }
  }
  const current = String(rows[index].status)
  const name = teamName(rows[index])

  if (current === TEAM_TERMINAL) {
    return { ok: false, message: `「${name}」已解散，不能回到在岗，也不能再做状态变更` }
  }
  if (target === TEAM_TERMINAL) {
    if (current === '在岗') {
      return { ok: false, message: `「${name}」正在在岗，需先安排轮休或提交培训，离岗后再解散` }
    }
  } else if (current === target) {
    // 同一班组重复确认在岗只记一次：在岗名册由班组登记派生，天然不会重复计数
    if (target === '在岗') {
      return { ok: true, message: `「${name}」当前已在岗，重复确认只记一次，不重复登记` }
    }
    return { ok: false, message: `「${name}」已经是「${target}」，不用重复操作` }
  } else {
    const next = TEAM_ROTATION[(TEAM_ROTATION.indexOf(current) + 1) % TEAM_ROTATION.length]
    if (target !== next) {
      return {
        ok: false,
        message: `班组状态只可按 在岗→轮休→培训中 依次变更：「${name}」当前「${current}」，下一步只能转为「${next}」`,
      }
    }
  }

  const updated: EntryRow = {
    ...rows[index],
    status: target,
    pending: target !== TEAM_TERMINAL,
    abnormal: target === TEAM_TERMINAL,
    班组状态: target,
  }
  const next = [...rows]
  next[index] = updated
  saveRows(TEAM_KEY, next)
  return { ok: true, message: `「${name}」已${action}，当前状态「${target}」` }
}

// —— 登记校验：负责区域不得与其它在岗班组完全重叠 ————————————————————————

export type TeamRegistration = {
  班组名称: string
  负责区域: string
  在岗人数: number | string
  班次时段: string
  带班人员: string
  轮休安排: string
}

// 负责区域按 、，；/ 和空白切成区域片，便于逐片比对
export function parseZones(area: string): string[] {
  return [...new Set(area.split(/[、,，;；/\s]+/).map((item) => item.trim()).filter(Boolean))]
}

function coversAll(whole: string[], part: string[]): boolean {
  const pool = new Set(whole)
  return part.length > 0 && part.every((zone) => pool.has(zone))
}

// 完全重叠的判定：新班组的区域片被某个在岗班组全部覆盖，或反过来把对方全部覆盖；
// 只共用部分区域片（各有独有区域）不算完全重叠，允许登记。
export function findAreaConflicts(area: string): EntryRow[] {
  const zones = parseZones(area)
  if (!zones.length) {
    return []
  }
  return listRows(TEAM_KEY).filter((row) => {
    if (String(row.status) !== '在岗') {
      return false
    }
    const other = parseZones(String(row['负责区域'] ?? ''))
    if (!other.length) {
      return false
    }
    return coversAll(other, zones) || coversAll(zones, other)
  })
}

export function registerTeam(payload: TeamRegistration): ActionResult & { id?: number } {
  const name = String(payload.班组名称 ?? '').trim()
  const area = String(payload.负责区域 ?? '').trim()
  const shift = String(payload.班次时段 ?? '').trim()
  const headcount = Number(payload.在岗人数)
  if (!name) {
    return { ok: false, message: '班组名称不能为空' }
  }
  if (!area) {
    return { ok: false, message: '负责区域不能为空' }
  }
  if (!Number.isInteger(headcount) || headcount <= 0) {
    return { ok: false, message: '在岗人数必须是大于 0 的整数' }
  }
  if (!shift) {
    return { ok: false, message: '班次时段不能为空' }
  }
  const conflicts = findAreaConflicts(area)
  if (conflicts.length) {
    const who = conflicts.map((row) => `「${teamName(row)}(${String(row['班组编号'])})」`).join('、')
    return {
      ok: false,
      message: `负责区域与在岗班组 ${who} 完全重叠，登记被挡回；请错开负责区域，或等对方轮休、解散后再登记`,
    }
  }
  const rows = listRows(TEAM_KEY)
  const id = rows.reduce((max, row) => Math.max(max, Number(row.id)), 0) + 1
  const code = `TEAM-${String(id).padStart(4, '0')}`
  const row: EntryRow = {
    id,
    status: '在岗',
    pending: true,
    abnormal: false,
    班组编号: code,
    班组名称: name,
    负责区域: area,
    在岗人数: headcount,
    班次时段: shift,
    带班人员: String(payload.带班人员 ?? '').trim() || '待定',
    轮休安排: String(payload.轮休安排 ?? '').trim() || '待定',
    班组状态: '在岗',
  }
  saveRows(TEAM_KEY, [...rows, row])
  return { ok: true, id, message: `保障班组「${name}」已登记为在岗，编号 ${code}` }
}

// —— 同源在岗名册：调度与排班都从这里读在岗人数，不另存副本 ——————————————————

export type DutyRosterItem = {
  teamId: number
  班组编号: string
  班组名称: string
  负责区域: string
  班次时段: string
  在岗人数: number
}

export function onDutyRoster(): DutyRosterItem[] {
  return listRows(TEAM_KEY)
    .filter((row) => String(row.status) === '在岗')
    .map((row) => ({
      teamId: Number(row.id),
      班组编号: String(row['班组编号'] ?? ''),
      班组名称: String(row['班组名称'] ?? ''),
      负责区域: String(row['负责区域'] ?? ''),
      班次时段: String(row['班次时段'] ?? ''),
      在岗人数: Number(row['在岗人数']) || 0,
    }))
}

export function onDutySummary(): { teams: number; headcount: number } {
  const roster = onDutyRoster()
  return { teams: roster.length, headcount: roster.reduce((sum, item) => sum + item.在岗人数, 0) }
}

// —— 缺口调剂 ————————————————————————————————————————————————————
// 调剂依据（页面与 README 同步公示）：
// 1. 只在同一班次时段内调剂，且只从「在岗」班组借人，轮休/培训中/已解散不参与；
// 2. 第一顺位：负责区域与缺口班组有交集的在岗班组，按富余人数从多到少借调；
// 3. 第二顺位：区域无交集的其余在岗班组，同样按富余从多到少补位；
// 4. 富余人数 = 在岗人数 − 本班次已落实需求 − 已借出；每个班组最多借到富余用尽，不得借成负数；
// 5. 调剂后仍补不齐的整组留待调整，且不为它占用借调名额，重新调剂时按当时富余重算。
export const REBALANCE_BASIS: string[] = [
  '只在同一班次时段内调剂，且只从「在岗」班组借人，轮休、培训中、已解散不参与。',
  '第一顺位：负责区域与缺口班组有交集的在岗班组，按富余人数从多到少依次借调。',
  '第二顺位：区域无交集的其余在岗班组，同样按富余人数从多到少补位。',
  '富余人数 = 在岗人数 − 本班次已落实需求 − 已借出；每个班组最多借到富余用尽，不得借成负数。',
  '调剂后仍补不齐的整组留待调整，不为它占用借调名额，重新调剂时按当时富余重算。',
]

type Loan = { teamId: number; count: number }

function parseLoans(raw: unknown): Loan[] {
  if (typeof raw !== 'string' || !raw) {
    return []
  }
  try {
    const parsed = JSON.parse(raw) as Loan[]
    return Array.isArray(parsed)
      ? parsed.filter((loan) => Number(loan.teamId) > 0 && Number(loan.count) > 0)
      : []
  } catch {
    return []
  }
}

// 本班次每个班组已被占用的人数：自己已落实的需求 + 借给别人的人数
export function committedByTeam(shift: string): Map<number, number> {
  const map = new Map<number, number>()
  const add = (teamId: number, count: number) => map.set(teamId, (map.get(teamId) ?? 0) + count)
  for (const record of listRows(SHIFT_KEY)) {
    if (String(record['班次时段']) !== shift || String(record.status) !== '已下发') {
      continue
    }
    add(Number(record['班组Id']), Number(record['需求人数']) || 0)
    for (const loan of parseLoans(record['借调'])) {
      add(loan.teamId, loan.count)
    }
  }
  return map
}

function planLoans(
  shortTeam: EntryRow,
  gap: number,
  shift: string,
  committed: Map<number, number>,
): Loan[] {
  const shortZones = new Set(parseZones(String(shortTeam['负责区域'] ?? '')))
  const candidates = listRows(TEAM_KEY)
    .filter(
      (row) =>
        Number(row.id) !== Number(shortTeam.id) &&
        String(row.status) === '在岗' &&
        String(row['班次时段']) === shift,
    )
    .map((row) => ({
      row,
      spare: (Number(row['在岗人数']) || 0) - (committed.get(Number(row.id)) ?? 0),
    }))
    .filter((item) => item.spare > 0)
  const overlapped = candidates.filter((item) =>
    parseZones(String(item.row['负责区域'] ?? '')).some((zone) => shortZones.has(zone)),
  )
  const rest = candidates.filter((item) => !overlapped.includes(item))
  const bySpare = (a: (typeof candidates)[number], b: (typeof candidates)[number]) =>
    b.spare - a.spare || String(a.row['班组编号']).localeCompare(String(b.row['班组编号']))
  overlapped.sort(bySpare)
  rest.sort(bySpare)

  const loans: Loan[] = []
  let remaining = gap
  for (const item of [...overlapped, ...rest]) {
    if (remaining <= 0) {
      break
    }
    const take = Math.min(item.spare, remaining)
    loans.push({ teamId: Number(item.row.id), count: take })
    committed.set(Number(item.row.id), (committed.get(Number(item.row.id)) ?? 0) + take)
    remaining -= take
  }
  return loans
}

function loanSummary(json: unknown): string {
  const loans = parseLoans(json)
  if (!loans.length) {
    return ''
  }
  const teams = listRows(TEAM_KEY)
  return loans
    .map((loan) => {
      const team = teams.find((row) => Number(row.id) === loan.teamId)
      return `${team ? teamName(team) : `班组#${loan.teamId}`}×${loan.count}人`
    })
    .join('、')
}

// —— 整批下发 ————————————————————————————————————————————————————

export type DispatchItem = { teamId: number; demand: number }

export type DispatchGroupResult = {
  teamId: number
  teamName: string
  status: '已下发' | '待调整' | '未受理'
  message: string
  gap: number
}

export type DispatchBatchResult = {
  ok: boolean
  message: string
  results: DispatchGroupResult[]
}

function buildShiftRecord(
  id: number,
  shift: string,
  team: EntryRow,
  demand: number,
  loans: Loan[],
  gap: number,
  status: '已下发' | '待调整',
): EntryRow {
  return {
    id,
    status,
    pending: status === '待调整',
    abnormal: false,
    排班编号: `SHIFT-${String(id).padStart(4, '0')}`,
    班次时段: shift,
    班组Id: Number(team.id),
    班组编号: String(team['班组编号'] ?? ''),
    班组名称: teamName(team),
    负责区域: String(team['负责区域'] ?? ''),
    需求人数: demand,
    借调: JSON.stringify(loans),
    缺口: gap,
    登记时间: new Date().toLocaleString('zh-CN', { hour12: false }),
  }
}

export function dispatchBatch(shiftInput: string, items: DispatchItem[]): DispatchBatchResult {
  const shift = shiftInput.trim()
  if (!shift) {
    return { ok: false, message: '请先填写班次时段，再整批下发', results: [] }
  }
  if (!items.length) {
    return { ok: false, message: '请先勾选要派班的班组', results: [] }
  }
  const teams = listRows(TEAM_KEY)
  const records = listRows(SHIFT_KEY)
  const committed = committedByTeam(shift)
  const results: DispatchGroupResult[] = []
  const appended: EntryRow[] = []
  let nextId = records.reduce((max, row) => Math.max(max, Number(row.id)), 0) + 1
  const seen = new Set<number>()

  for (const item of items) {
    const teamId = Number(item.teamId)
    const team = teams.find((row) => Number(row.id) === teamId)
    if (!team) {
      results.push({ teamId, teamName: `#${teamId}`, status: '未受理', message: '班组不存在，未受理', gap: 0 })
      continue
    }
    const name = teamName(team)
    if (seen.has(teamId)) {
      results.push({ teamId, teamName: name, status: '未受理', message: `「${name}」在本批中重复出现，只受理第一次`, gap: 0 })
      continue
    }
    seen.add(teamId)
    if (String(team.status) !== '在岗') {
      results.push({
        teamId,
        teamName: name,
        status: '未受理',
        message: `「${name}」当前为「${String(team.status)}」，不在岗不予派班`,
        gap: 0,
      })
      continue
    }
    const demand = Number(item.demand)
    if (!Number.isInteger(demand) || demand <= 0) {
      results.push({ teamId, teamName: name, status: '未受理', message: `「${name}」需求人数必须是大于 0 的整数`, gap: 0 })
      continue
    }
    const headcount = Number(team['在岗人数']) || 0
    const available = Math.max(0, headcount - (committed.get(teamId) ?? 0))
    const gap = demand - available
    if (gap <= 0) {
      committed.set(teamId, (committed.get(teamId) ?? 0) + demand)
      appended.push(buildShiftRecord(nextId++, shift, team, demand, [], 0, '已下发'))
      results.push({
        teamId,
        teamName: name,
        status: '已下发',
        message: `需求 ${demand} 人 ≤ 在岗可用 ${available} 人，照常落实`,
        gap: 0,
      })
      continue
    }
    // 缺口提示：同一区域保障需求超过该班组在岗可用人数
    const loans = planLoans(team, gap, shift, committed)
    const covered = loans.reduce((sum, loan) => sum + loan.count, 0)
    const remaining = gap - covered
    const areaText = String(team['负责区域'] ?? '')
    if (remaining <= 0) {
      committed.set(teamId, (committed.get(teamId) ?? 0) + demand)
      appended.push(buildShiftRecord(nextId++, shift, team, demand, loans, 0, '已下发'))
      results.push({
        teamId,
        teamName: name,
        status: '已下发',
        message: `区域（${areaText}）需求 ${demand} 人超出在岗可用 ${available} 人，缺口 ${gap} 人；已按调剂依据借调补齐（${loanSummary(JSON.stringify(loans))}）`,
        gap: 0,
      })
    } else {
      // 待调整不占用借调名额：把 planLoans 预占的富余退回
      for (const loan of loans) {
        committed.set(loan.teamId, (committed.get(loan.teamId) ?? 0) - loan.count)
      }
      appended.push(buildShiftRecord(nextId++, shift, team, demand, [], remaining, '待调整'))
      results.push({
        teamId,
        teamName: name,
        status: '待调整',
        message: `区域（${areaText}）需求 ${demand} 人超出在岗可用 ${available} 人，缺口 ${gap} 人；同班次最多可调剂 ${covered} 人，仍缺 ${remaining} 人，整组留待调整`,
        gap: remaining,
      })
    }
  }

  saveRows(SHIFT_KEY, [...records, ...appended])
  const settled = results.filter((item) => item.status === '已下发').length
  const held = results.filter((item) => item.status === '待调整').length
  const rejected = results.filter((item) => item.status === '未受理').length
  return {
    ok: true,
    message: `整批下发完成：落实 ${settled} 组，待调整 ${held} 组${rejected ? `，未受理 ${rejected} 组` : ''}`,
    results,
  }
}

// 待调整记录重新调剂：按当前在岗人数与已落实情况重算，能补齐就落实
export function retryShiftRecord(id: number): ActionResult {
  const records = listRows(SHIFT_KEY)
  const index = records.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的排班记录` }
  }
  const record = records[index]
  if (String(record.status) !== '待调整') {
    return { ok: false, message: '只有待调整的排班记录需要重新调剂' }
  }
  const team = listRows(TEAM_KEY).find((row) => Number(row.id) === Number(record['班组Id']))
  if (!team) {
    return { ok: false, message: '该排班记录对应的班组已不存在' }
  }
  const name = teamName(team)
  if (String(team.status) !== '在岗') {
    return { ok: false, message: `「${name}」当前为「${String(team.status)}」，不在岗不能落实` }
  }
  const shift = String(record['班次时段'])
  const committed = committedByTeam(shift)
  const demand = Number(record['需求人数']) || 0
  const available = Math.max(0, (Number(team['在岗人数']) || 0) - (committed.get(Number(team.id)) ?? 0))
  const gap = demand - available
  const loans = gap > 0 ? planLoans(team, gap, shift, committed) : []
  const covered = loans.reduce((sum, loan) => sum + loan.count, 0)
  const remaining = gap - covered

  const next = [...records]
  if (remaining <= 0) {
    next[index] = { ...record, status: '已下发', pending: false, 借调: JSON.stringify(loans), 缺口: 0 }
    saveRows(SHIFT_KEY, next)
    const how = loans.length ? `，已按调剂依据借调补齐（${loanSummary(JSON.stringify(loans))}）` : '，在岗人数已够'
    return { ok: true, message: `「${name}」缺口 ${Math.max(gap, 0)} 人已消除${how}，排班记录已落实` }
  }
  next[index] = { ...record, 缺口: remaining }
  saveRows(SHIFT_KEY, next)
  return {
    ok: false,
    message: `「${name}」重新调剂后仍缺 ${remaining} 人（需求 ${demand}，在岗可用 ${available}，可调剂 ${covered}），继续留待调整`,
  }
}

// —— 人员需求清单：排班结果视图，在岗人数实时读班组登记（同源，不存快照） ——————————————

export type ShiftRecordView = {
  id: number
  排班编号: string
  班次时段: string
  班组编号: string
  班组名称: string
  负责区域: string
  需求人数: number
  在岗人数: number
  班组状态: string
  借调明细: string
  缺口: number
  status: string
  登记时间: string
}

export function listShiftRecordViews(): ShiftRecordView[] {
  const teams = listRows(TEAM_KEY)
  return listRows(SHIFT_KEY).map((record) => {
    const team = teams.find((row) => Number(row.id) === Number(record['班组Id']))
    return {
      id: Number(record.id),
      排班编号: String(record['排班编号'] ?? ''),
      班次时段: String(record['班次时段'] ?? ''),
      班组编号: team ? String(team['班组编号']) : String(record['班组编号'] ?? ''),
      班组名称: team ? teamName(team) : String(record['班组名称'] ?? ''),
      负责区域: team ? String(team['负责区域']) : String(record['负责区域'] ?? ''),
      需求人数: Number(record['需求人数']) || 0,
      在岗人数: team ? Number(team['在岗人数']) || 0 : 0,
      班组状态: team ? String(team.status) : '已删除',
      借调明细: loanSummary(record['借调']),
      缺口: Number(record['缺口']) || 0,
      status: String(record.status),
      登记时间: String(record['登记时间'] ?? ''),
    }
  })
}
