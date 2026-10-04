/** 纯前端数据层的公共类型：与全栈版后端返回的结构保持一致，换回后端时页面不用改。 */

export type EntryRow = {
  id: number
  status: string
  pending: boolean
  abnormal: boolean
  [field: string]: string | number | boolean | null
}

export type ModuleMeta = {
  key: string
  name: string
  entity: string
  desc: string
  fields: string[]
  statuses: string[]
  actions: string[]
  actionTargets: Record<string, string>
  metrics: string[]
}

export type PageResult = {
  items: EntryRow[]
  total: number
  page: number
  size: number
}

export type ActionResult = {
  ok: boolean
  message: string
}

export type OverviewResult = {
  cards: { label: string; value: number }[]
  modules: { name: string; created: number; pending: number; abnormal: number }[]
}

/** 保障班组登记入参。 */
export type CreateTeamInput = {
  班组名称: string
  负责区域: string
  在岗人数: number
  班次时段: string
  带班人员: string
  轮休安排: string
}

/** 在岗确认记录：同一班组一段连续在岗只记一次，刷新后仍可查。 */
export type DutyLog = {
  id: number
  teamId: number
  teamCode: string
  teamName: string
  operator: string
  confirmedAt: string
  source: '登记即在岗' | '确认在岗'
}

/** 整批排班：每个班组一条需求。 */
export type DispatchGroupInput = {
  teamId: number
  /** 该班组负责区域在本班次需要的保障人数。 */
  demand: number
}

export type DispatchResult = {
  ok: boolean
  message: string
  shiftSlot: string
  groups: {
    teamId: number
    teamCode: string
    teamName: string
    area: string
    onDuty: number
    demand: number
    shortfall: number
    /** 本班组富余、被调借给其它班组的人数。 */
    lentOut: number
    /** 从其它班组调剂进来的人数。 */
    borrowedIn: number
    planNo: string
    planId: number
    status: '已下发' | '待调整'
    detail: string
  }[]
  /** 班组之间调剂流水，写明依据。 */
  transfers: { from: string; to: string; people: number; reason: string }[]
  remainGap: number
}

/** 调度侧读取的班组在岗人数，必须与班组台账同源。 */
export type TeamHeadcount = {
  teamId: number
  teamCode: string
  teamName: string
  status: string
  onDuty: number
}

export type EnrichedRow = EntryRow & {
  /** 从班组台账同源解析出的在岗人数；无法对应班组时为 null。 */
  sourceOnDuty: number | null
  /** 清单里登记的在岗人数与台账不一致时置 true，页面标红。 */
  drift: boolean
}
