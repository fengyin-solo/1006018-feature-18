import { MODULE_BY_KEY } from '@/data/modules'
import {
  allRows,
  listDutyLogs,
  listRows,
  resetRows,
  saveDutyLogs,
  saveRows,
} from '@/data/local-store'
import type {
  ActionResult,
  CreateTeamInput,
  DispatchGroupInput,
  DispatchResult,
  DutyLog,
  EnrichedRow,
  EntryRow,
  ModuleMeta,
  OverviewResult,
  PageResult,
  TeamHeadcount,
} from '@/data/types'

// 会写进数据的「往回走」动作：命中就把这条记录标成异常态，看板上能一眼看出来。
const NEGATIVE_ACTIONS = ['撤销', '作废', '拒绝', '驳回', '停用', '忽略', '下线', '回滚']

// 班组状态只能按 在岗 → 轮休 → 培训中 依次推进；已解散是终态。
const TEAM_STATUS_ORDER = ['在岗', '轮休', '培训中']
const TEAM_DISMISSED = '已解散'

export function moduleMeta(key: string): ModuleMeta {
  const meta = MODULE_BY_KEY.get(key)
  if (!meta) {
    throw new Error(`没有登记名为 ${key} 的业务模块`)
  }
  return meta
}

export function filterRows(rows: EntryRow[], filters: Record<string, string>): EntryRow[] {
  const pairs = Object.entries(filters).filter(([, value]) => value.trim() !== '')
  if (pairs.length === 0) {
    return rows
  }
  return rows.filter((row) =>
    pairs.every(([field, value]) => String(row[field] ?? '').includes(value.trim())),
  )
}

export function listEntries(key: string, filters: Record<string, string> = {}): PageResult {
  const matched = filterRows(listRows(key), filters)
  return { items: matched, total: matched.length, page: 1, size: matched.length }
}

// ---------- 保障班组：负责区域 ----------

/** 区域串按逗号/顿号/分号/斜杠拆成区域集合，去空白；大小写不敏感。 */
export function parseAreas(raw: string): string[] {
  return raw
    .split(/[,，、;；/／]+/)
    .map((item) => item.trim())
    .filter(Boolean)
}

function areaSet(raw: string): Set<string> {
  return new Set(parseAreas(raw).map((area) => area.toLowerCase()))
}

export type AreaOverlap = {
  /** 新班组区域被某个在岗班组区域完全包住：登记必须挡回。 */
  fullyCoveredBy: { teamCode: string; teamName: string; areas: string[] }[]
  /** 仅部分重叠：允许登记，但要提示。 */
  partialWith: { teamCode: string; teamName: string; shared: string[] }[]
}

/**
 * 登记校验：负责区域不能与其它「在岗」班组完全重叠。
 * 完全重叠 = 新班组的每个区域都落在同一个在岗班组的负责区域内；
 * 区域你中有我（只重叠一部分）不算撞区，放行但提示。
 */
export function checkAreaOverlap(areaText: string, excludeId?: number): AreaOverlap {
  const mine = areaSet(areaText)
  const result: AreaOverlap = { fullyCoveredBy: [], partialWith: [] }
  if (mine.size === 0) {
    return result
  }
  for (const row of listRows('team')) {
    if (excludeId !== undefined && Number(row.id) === excludeId) {
      continue
    }
    if (String(row.status) !== '在岗') {
      continue
    }
    const other = areaSet(String(row['负责区域'] ?? ''))
    const shared = [...mine].filter((area) => other.has(area))
    if (shared.length === 0) {
      continue
    }
    if (shared.length === mine.size) {
      result.fullyCoveredBy.push({
        teamCode: String(row['班组编号'] ?? ''),
        teamName: String(row['班组名称'] ?? ''),
        areas: shared,
      })
    } else {
      result.partialWith.push({
        teamCode: String(row['班组编号'] ?? ''),
        teamName: String(row['班组名称'] ?? ''),
        shared,
      })
    }
  }
  return result
}

// ---------- 保障班组：登记 ----------

export type CreateTeamResult = ActionResult & {
  overlap?: AreaOverlap
  teamId?: number
}

export function createTeam(input: CreateTeamInput): CreateTeamResult {
  const name = input.班组名称.trim()
  const areaText = input.负责区域.trim()
  const shiftSlot = input.班次时段.trim()
  const leader = input.带班人员.trim()
  if (!name) {
    return { ok: false, message: '班组名称不能为空' }
  }
  if (parseAreas(areaText).length === 0) {
    return { ok: false, message: '负责区域至少要登记一个区域（多个区域用逗号分隔）' }
  }
  if (!Number.isInteger(input.在岗人数) || input.在岗人数 < 1) {
    return { ok: false, message: '在岗人数必须是大于 0 的整数' }
  }
  if (!shiftSlot) {
    return { ok: false, message: '班次时段不能为空' }
  }
  const rows = listRows('team')
  if (rows.some((row) => String(row['班组名称']).trim() === name)) {
    return { ok: false, message: `班组名称「${name}」已存在` }
  }
  const overlap = checkAreaOverlap(areaText)
  if (overlap.fullyCoveredBy.length > 0) {
    const hit = overlap.fullyCoveredBy
      .map((item) => `${item.teamCode} ${item.teamName}（区域 ${item.areas.join('、')}）`)
      .join('；')
    return {
      ok: false,
      message: `登记挡回：负责区域与在岗班组完全重叠，撞了 ${hit}。请调整负责区域或待其轮休后再登记。`,
      overlap,
    }
  }
  const id = rows.reduce((max, row) => Math.max(max, Number(row.id)), 0) + 1
  const code = `TEAM-${String(id).padStart(4, '0')}`
  const row: EntryRow = {
    id,
    status: '在岗',
    pending: true,
    abnormal: false,
    班组编号: code,
    班组名称: name,
    负责区域: parseAreas(areaText).join(','),
    在岗人数: input.在岗人数,
    班次时段: shiftSlot,
    带班人员: leader || '—',
    轮休安排: input.轮休安排.trim() || '暂无',
    班组状态: '在岗',
  }
  saveRows('team', [...rows, row])
  // 登记即在岗：同一班组重复确认在岗只记一次，登记本身就是这一段在岗的第一次确认。
  appendDutyLog(row, '登记即在岗')
  return {
    ok: true,
    teamId: id,
    overlap,
    message:
      overlap.partialWith.length > 0
        ? `班组 ${code} 已登记在岗；与 ${overlap.partialWith
            .map((item) => `${item.teamCode} ${item.teamName}`)
            .join('、')} 存在部分共区（${overlap.partialWith
            .flatMap((item) => item.shared)
            .join('、')}），未完全重叠，已放行`
        : `班组 ${code} 已登记并确认在岗`,
  }
}

// ---------- 保障班组：状态流转 ----------

/**
 * 班组动作合法性：只能按 在岗 → 轮休 → 培训中 依次推进；
 * 轮休可回岗（一次新的在岗）；在岗不能直接跳培训；已解散是终态，回不到在岗。
 */
function teamTransition(current: string, action: string): { ok: boolean; message: string } {
  if (current === TEAM_DISMISSED) {
    return { ok: false, message: '该班组已解散，不能再变更状态（已解散回不到在岗）' }
  }
  const index = TEAM_STATUS_ORDER.indexOf(current)
  switch (action) {
    case '安排轮休':
      if (current === '轮休') {
        return { ok: false, message: '班组已在轮休，不用重复安排' }
      }
      if (current !== '在岗') {
        return { ok: false, message: `班组状态只能依次推进：${TEAM_STATUS_ORDER.join(' → ')}，培训中不能直接轮休` }
      }
      return { ok: true, message: '' }
    case '提交培训':
      if (current === '培训中') {
        return { ok: false, message: '班组已在培训中，不用重复提交' }
      }
      if (current !== '轮休') {
        return {
          ok: false,
          message: `班组状态只能依次推进：${TEAM_STATUS_ORDER.join(' → ')}，在岗须先安排轮休再提交培训`,
        }
      }
      return { ok: true, message: '' }
    case '确认在岗':
      // 在岗 → 在岗 属于重复确认：只记一次，这里直接挡下。
      if (current === '在岗') {
        return { ok: false, message: '该班组当前已在岗：同一班组重复确认在岗只记一次，未重复登记' }
      }
      if (current !== '轮休') {
        return {
          ok: false,
          message: `班组状态只能依次推进：${TEAM_STATUS_ORDER.join(' → ')}，培训中须先完成轮休衔接再回岗`,
        }
      }
      return { ok: true, message: '' }
    case '解散班组':
      return { ok: true, message: '' }
    default:
      return { ok: false, message: `保障班组没有登记「${action}」这个动作` }
  }
}

function runTeamAction(id: number, action: string): ActionResult {
  const rows = listRows('team')
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的保障班组` }
  }
  const row = rows[index]
  const current = String(row.status)
  const guard = teamTransition(current, action)
  if (!guard.ok) {
    return guard
  }
  const target =
    action === '解散班组'
      ? TEAM_DISMISSED
      : ({ 确认在岗: '在岗', 安排轮休: '轮休', 提交培训: '培训中' } as Record<string, string>)[action]
  const updated: EntryRow = {
    ...row,
    status: target,
    pending: target !== TEAM_DISMISSED,
    abnormal: false,
    班组状态: target,
  }
  if (target !== '在岗') {
    // 离开在岗：编制人数保留在台账里，在岗人数归零，排班与调度同源读到 0。
    if (typeof row['在岗人数'] === 'number') {
      updated['编制人数'] = row['在岗人数']
    }
    updated['在岗人数'] = 0
  } else if (typeof row['编制人数'] === 'number') {
    // 轮休回岗：按原编制恢复在岗人数。
    updated['在岗人数'] = row['编制人数']
    delete updated['编制人数']
  }
  const next = [...rows]
  next[index] = updated
  saveRows('team', next)
  if (action === '确认在岗') {
    appendDutyLog(updated, '确认在岗')
  }
  return {
    ok: true,
    message:
      action === '确认在岗'
        ? `班组已${action}，当前状态「${target}」，本次在岗已记入确认记录`
        : `班组已${action}，当前状态「${target}」`,
  }
}

export function runAction(key: string, id: number, action: string): ActionResult {
  const meta = moduleMeta(key)
  if (key === 'team') {
    return runTeamAction(id, action)
  }
  const target = meta.actionTargets[action]
  if (!target) {
    return { ok: false, message: `${meta.entity}没有登记「${action}」这个动作` }
  }
  const rows = listRows(key)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的${meta.entity}` }
  }
  const current = String(rows[index].status)
  if (current === target) {
    return { ok: false, message: `${meta.entity}已经是「${target}」，不用重复操作` }
  }
  const lastStatus = meta.statuses[meta.statuses.length - 1]
  const updated: EntryRow = {
    ...rows[index],
    status: target,
    pending: target !== lastStatus,
    abnormal: NEGATIVE_ACTIONS.some((verb) => action.startsWith(verb)),
  }
  const next = [...rows]
  next[index] = updated
  saveRows(key, next)
  return { ok: true, message: `${meta.entity}已${action}，当前状态「${target}」` }
}

// ---------- 在岗确认记录（同一班组一段连续在岗只记一次） ----------

export function dutyLogs(): DutyLog[] {
  return [...listDutyLogs()].sort((a, b) => (a.confirmedAt < b.confirmedAt ? 1 : -1))
}

function appendDutyLog(team: EntryRow, source: DutyLog['source']): void {
  const logs = listDutyLogs()
  const id = logs.reduce((max, log) => Math.max(max, log.id), 0) + 1
  const now = new Date()
  const pad = (value: number) => String(value).padStart(2, '0')
  const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(
    now.getHours(),
  )}:${pad(now.getMinutes())}`
  saveDutyLogs([
    ...logs,
    {
      id,
      teamId: Number(team.id),
      teamCode: String(team['班组编号']),
      teamName: String(team['班组名称']),
      operator: '值班管理员',
      confirmedAt: stamp,
      source,
    },
  ])
}

// ---------- 班组在岗人数：排班与调度共用同一数据出口（同源） ----------

export function onDutyHeadcounts(): TeamHeadcount[] {
  return listRows('team').map((row) => ({
    teamId: Number(row.id),
    teamCode: String(row['班组编号'] ?? ''),
    teamName: String(row['班组名称'] ?? ''),
    status: String(row.status),
    onDuty: Number(row['在岗人数'] ?? 0),
  }))
}

/** 从「TEAM-0001 机坪保障一班」这类班组字段里解析班组编号。 */
function parseTeamCode(value: unknown): string {
  const match = String(value ?? '').match(/TEAM-\d{4}/i)
  return match ? match[0].toUpperCase() : ''
}

// ---------- 整批排班下发 ----------

/**
 * 整批下发：一次选中多个班组，按班次时段整组分配任务。
 * 逐组判定，只有「在岗人数顶不住需求、且同批调剂后仍有缺口」的组留在待调整，其余照常下发。
 *
 * 缺口调剂规则（依据写进每条清单的「调剂说明」）：
 * 1. 只在同批下发、状态在岗的班组之间调剂，不跨班次、不动轮休/培训班组；
 * 2. 优先借「负责区域与缺口区域有重叠」的班组——熟区域、不用转场；
 * 3. 同样可借时，富余人数多的先出（削峰），仍并列按班组编号升序（可预期、可追溯）；
 * 4. 借出后自己仍要满足本班组需求，不会把别人也借成缺口；
 * 5. 全网富余都补不上的缺口留在待调整，写清还差几人。
 */
export function dispatchTeams(shiftSlot: string, groups: DispatchGroupInput[]): DispatchResult {
  const slot = shiftSlot.trim()
  if (!slot) {
    return {
      ok: false,
      message: '班次时段不能为空',
      shiftSlot: shiftSlot,
      groups: [],
      transfers: [],
      remainGap: 0,
    }
  }
  if (groups.length === 0) {
    return { ok: false, message: '请至少勾选一个班组再整批下发', shiftSlot: slot, groups: [], transfers: [], remainGap: 0 }
  }

  const teams = listRows('team')
  const picked = groups.map((group) => {
    const row = teams.find((item) => Number(item.id) === group.teamId)
    return { row, demand: Math.max(0, Math.floor(group.demand)) }
  })
  const notFound = picked.filter((item) => !item.row)
  if (notFound.length > 0) {
    return { ok: false, message: '勾选的班组中有已不存在的记录，请刷新后重选', shiftSlot: slot, groups: [], transfers: [], remainGap: 0 }
  }
  const notOnDuty = picked.filter((item) => item.row && String(item.row.status) !== '在岗')
  if (notOnDuty.length > 0) {
    return {
      ok: false,
      message: `只有在岗班组才能排班下发：${notOnDuty
        .map((item) => `${item.row!['班组编号']}（${item.row!.status}）`)
        .join('、')}，请先完成状态流转`,
      shiftSlot: slot,
      groups: [],
      transfers: [],
      remainGap: 0,
    }
  }

  const state = picked.map((item) => {
    const row = item.row!
    const onDuty = Number(row['在岗人数'] ?? 0)
    return {
      teamId: Number(row.id),
      code: String(row['班组编号']),
      name: String(row['班组名称']),
      area: String(row['负责区域']),
      onDuty,
      demand: item.demand,
      available: onDuty - item.demand, // 满足自身需求后的可借出富余（负数即缺口）
      lentOut: 0,
      borrowedIn: 0,
    }
  })

  const transfers: DispatchResult['transfers'] = []
  // 缺口从大到小补：优先救最急的区域。
  const gapOrder = [...state].sort((a, b) => b.demand - b.demand || a.teamId - b.teamId)
  for (const deficit of gapOrder) {
    let need = Math.max(0, -deficit.available - deficit.borrowedIn)
    if (need <= 0) {
      continue
    }
    while (need > 0) {
      const areas = areaSet(deficit.area)
      const lenders = state
        .filter((candidate) => candidate.teamId !== deficit.teamId)
        .filter((candidate) => candidate.available - candidate.lentOut > 0)
        .map((candidate) => {
          const overlap = [...areas].some((area) => areaSet(candidate.area).has(area))
          const surplus = candidate.available - candidate.lentOut
          return { candidate, surplus, overlap }
        })
        // 依据②区域重叠优先；依据③富余多者先出，再按编号升序。
        .sort((a, b) => {
          if (a.overlap !== b.overlap) {
            return a.overlap ? -1 : 1
          }
          if (a.surplus !== b.surplus) {
            return b.surplus - a.surplus
          }
          return a.candidate.teamId - b.candidate.teamId
        })
      const lender = lenders[0]
      if (!lender) {
        break
      }
      const people = Math.min(need, lender.surplus)
      lender.candidate.lentOut += people
      deficit.borrowedIn += people
      need -= people
      const reason = lender.overlap
        ? `与缺口区域 ${deficit.area} 有共区（${[...areas]
            .filter((area) => areaSet(lender.candidate.area).has(area))
            .join('、')}），无需转场`
        : '共区班组无富余，按富余削峰跨区支援'
      transfers.push({ from: lender.candidate.code, to: deficit.code, people, reason })
    }
  }

  const planRows = listRows('resplan')
  let planSeq = planRows.reduce((max, row) => {
    const match = String(row['计划编号'] ?? '').match(/RESP-(\d+)/)
    return Math.max(max, match ? Number(match[1]) : 0)
  }, 0)
  let planId = planRows.reduce((max, row) => Math.max(max, Number(row.id)), 0)

  const results = state.map((item) => {
    const shortfall = Math.max(0, item.demand - item.onDuty - item.borrowedIn)
    const status = shortfall > 0 ? '待调整' : '已下发'
    const parts: string[] = []
    if (item.demand <= item.onDuty) {
      parts.push(`在岗${item.onDuty}人 ≥ 需求${item.demand}人，富余${item.onDuty - item.demand}人`)
    } else {
      parts.push(`在岗${item.onDuty}人，需求${item.demand}人，缺口${item.demand - item.onDuty}人`)
    }
    const incoming = transfers.filter((transfer) => transfer.to === item.code)
    if (incoming.length > 0) {
      parts.push(
        `按「共区优先、富余削峰」从 ${incoming
          .map((transfer) => `${transfer.from}借调${transfer.people}人`)
          .join('、')} 补入`,
      )
    }
    const outgoing = transfers.filter((transfer) => transfer.from === item.code)
    if (outgoing.length > 0) {
      parts.push(`富余${outgoing.reduce((sum, transfer) => sum + transfer.people, 0)}人借调给其它班组`)
    }
    if (shortfall > 0) {
      parts.push(`同批仍补不齐，缺口${shortfall}人，本批次留在待调整`)
    }
    planSeq += 1
    planId += 1
    const planNo = `RESP-${String(planSeq).padStart(4, '0')}`
    const plan: EntryRow = {
      id: planId,
      status,
      pending: status !== '已下发',
      abnormal: shortfall > 0,
      计划编号: planNo,
      保障班组: `${item.code} ${item.name}`,
      负责区域: item.area,
      班次时段: slot,
      需求人数: item.demand,
      班组在岗人数: item.onDuty,
      在岗人数来源: `班组台账 ${item.code}`,
      人员缺口: shortfall,
      调剂说明: parts.join('；'),
      调度人员: '值班管理员',
      计划状态: status,
    }
    planRows.push(plan)
    return {
      teamId: item.teamId,
      teamCode: item.code,
      teamName: item.name,
      area: item.area,
      onDuty: item.onDuty,
      demand: item.demand,
      shortfall,
      lentOut: item.lentOut,
      borrowedIn: item.borrowedIn,
      planNo,
      planId: Number(plan.id),
      status,
      detail: parts.join('；'),
    } as DispatchResult['groups'][number]
  })
  saveRows('resplan', planRows)

  const adjusted = results.filter((item) => item.status === '待调整')
  const remainGap = adjusted.reduce((sum, item) => sum + item.shortfall, 0)
  return {
    ok: true,
    shiftSlot: slot,
    groups: results,
    transfers,
    remainGap,
    message:
      adjusted.length === 0
        ? `本批 ${results.length} 个班组全部照常落实，计划编号 ${results
            .map((item) => item.planNo)
            .join('、')}`
        : `${results.length - adjusted.length} 个班组已落实；${adjusted
            .map((item) => `${item.teamCode} 缺${item.shortfall}人`)
            .join('、')} 留在待调整，共缺 ${remainGap} 人`,
  }
}

// ---------- 人员需求清单：在岗人数与班组台账同源 ----------

/**
 * 调度侧读人员需求清单：在岗人数不存第二份，每次都从班组台账解析。
 * 清单里历史记录的数字一旦与台账对不上就标 drift，页面标红，避免拿着旧人数排班。
 */
export function listStaffingPlans(filters: Record<string, string> = {}): (PageResult & { items: EnrichedRow[] }) {
  const headcounts = onDutyHeadcounts()
  const byCode = new Map(headcounts.map((item) => [item.teamCode, item]))
  const enriched: EnrichedRow[] = listRows('resplan').map((row) => {
    const code = parseTeamCode(row['保障班组'])
    const source = code ? byCode.get(code) ?? null : null
    const sourceOnDuty = source ? source.onDuty : null
    const recorded = Number(row['班组在岗人数'] ?? NaN)
    const drift = sourceOnDuty !== null && Number.isFinite(recorded) && recorded !== sourceOnDuty
    return { ...row, sourceOnDuty, drift }
  })
  const matched = filterRows(enriched as EntryRow[], filters) as EnrichedRow[]
  return { items: matched, total: matched.length, page: 1, size: matched.length }
}

export function resetModule(key: string): PageResult {
  resetRows(key)
  return listEntries(key)
}

export function exportEntries(key: string): { filename: string; content: string } {
  const meta = moduleMeta(key)
  const header = ['编号', ...meta.fields, '当前状态']
  const lines = [header.join(',')]
  for (const row of listRows(key)) {
    lines.push([row.id, ...meta.fields.map((field) => row[field] ?? ''), row.status].join(','))
  }
  return { filename: `${meta.name}-清单.csv`, content: `﻿${lines.join('\n')}` }}

export function downloadEntries(key: string): void {
  const { filename, content } = exportEntries(key)
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

export function loadOverview(): OverviewResult {
  const rows = allRows()
  const modules = [...MODULE_BY_KEY.values()].map((meta) => {
    const entries = rows[meta.key] ?? []
    return {
      name: meta.name,
      created: entries.length,
      pending: entries.filter((row) => row.pending).length,
      abnormal: entries.filter((row) => row.abnormal).length,
    }
  })
  const cards = [
    { label: '业务模块', value: modules.length },
    { label: '登记总量', value: modules.reduce((sum, item) => sum + item.created, 0) },
    { label: '待处理', value: modules.reduce((sum, item) => sum + item.pending, 0) },
    { label: '异常量', value: modules.reduce((sum, item) => sum + item.abnormal, 0) },
  ]
  return { cards, modules }
}
