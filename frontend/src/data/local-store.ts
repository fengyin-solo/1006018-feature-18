import { SEED_DUTY_LOGS, SEED_ROWS } from './seed'
import type { DutyLog, EntryRow } from './types'

// 本地持久化：数据放在 localStorage 里，刷新、关掉再打开都还在。
const STORAGE_KEY = 'airport-ground-ops:entries'
// 在岗确认记录单独存一份，班组数据重置时不受影响。
const DUTY_LOG_KEY = 'airport-ground-ops:duty-logs'

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function readStorage(): Record<string, EntryRow[]> {
  const fallback = clone(SEED_ROWS)
  if (typeof window === 'undefined' || !window.localStorage) {
    return fallback
  }
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, EntryRow[]>
    return { ...fallback, ...parsed }
  } catch {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
}

let cache: Record<string, EntryRow[]> | null = null

export function allRows(): Record<string, EntryRow[]> {
  if (cache === null) {
    cache = readStorage()
  }
  return cache
}

export function listRows(key: string): EntryRow[] {
  return allRows()[key] ?? []
}

export function saveRows(key: string, rows: EntryRow[]): void {
  const next = { ...allRows(), [key]: rows }
  cache = next
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  }
}

export function resetRows(key: string): EntryRow[] {
  const rows = clone(SEED_ROWS[key] ?? [])
  saveRows(key, rows)
  return rows
}

export function storageKey(): string {
  return STORAGE_KEY
}

let dutyLogCache: DutyLog[] | null = null

export function listDutyLogs(): DutyLog[] {
  if (dutyLogCache === null) {
    dutyLogCache = readDutyLogs()
  }
  return dutyLogCache
}

export function saveDutyLogs(logs: DutyLog[]): void {
  dutyLogCache = logs
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(DUTY_LOG_KEY, JSON.stringify(logs))
  }
}

function readDutyLogs(): DutyLog[] {
  const fallback = clone(SEED_DUTY_LOGS)
  if (typeof window === 'undefined' || !window.localStorage) {
    return fallback
  }
  const raw = window.localStorage.getItem(DUTY_LOG_KEY)
  if (!raw) {
    window.localStorage.setItem(DUTY_LOG_KEY, JSON.stringify(fallback))
    return fallback
  }
  try {
    return JSON.parse(raw) as DutyLog[]
  } catch {
    window.localStorage.setItem(DUTY_LOG_KEY, JSON.stringify(fallback))
    return fallback
  }
}
