import { api } from './client'

/** Phase 23: the "Tình trạng hệ thống" page (backend src/modules/monitoring). A figure that could not be read is null. */
export interface QueueStatus {
  name: string
  waiting: number
  active: number
  delayed: number
  failed: number
  oldestWaitingMs: number | null
}

export interface SystemStatus {
  generatedAt: string
  api: {
    windowMinutes: number
    requests: number
    requestsPerMinute: number
    serverErrors: number
    clientErrors4xx: number
    rateLimited: number
    errorRatePercent: number
    /** upper bound of the latency bucket; 5001 = slower than 5 s */
    p50Ms: number | null
    p95Ms: number | null
    slowestRoutes: Array<{ route: string; requests: number; p95Ms: number }>
  } | null
  process: { rssMb: number; uptimeSeconds: number }
  database: { up: boolean; pingMs: number | null; pool: { total: number; idle: number; waiting: number } }
  redis: { up: boolean; pingMs: number | null; usedMemoryMb: number | null }
  /** inline: jobs run inside the API (no worker process to watch) */
  worker: { mode: 'bullmq' | 'inline'; alive: boolean; lastSeenAt: string | null; ageMs: number | null }
  queues: QueueStatus[] | null
  failedJobsLastHour: number | null
  realtime: { connections: number | null }
  business: {
    paymentsFailedLastHour: number
    refundsFailed: number
    refundsPendingTooLong: number
    ordersStuck: number
    purchaseQueueWaiting: number | null
  } | null
  disk: { freePercent: number | null; freeGb: number; totalGb: number } | null
  webErrors: { windowMinutes: number; count: number } | null
}

export interface ActiveAlert {
  key: string
  title: string
  detail: string | null
  since: string
}

export interface AlertEvent {
  key: string
  title: string
  status: 'FIRING' | 'RESOLVED'
  detail: string | null
  at: string
  since: string | null
}

export interface SystemSnapshot {
  status: SystemStatus
  alerts: { active: ActiveAlert[]; history: AlertEvent[] }
}

export interface SeriesPoint {
  at: string
  requests: number
  serverErrors: number
  p95Ms: number | null
  webErrors: number
}

export interface ClientErrorGroup {
  fingerprint: string
  message: string
  stack: string | null
  page: string
  browser: string | null
  release: string | null
  count: number
  firstSeenAt: string
  lastSeenAt: string
}

export async function getSystemStatus(): Promise<SystemSnapshot> {
  return (await api.get('/admin/system')).data.data
}

export async function getSystemSeries(minutes = 60): Promise<SeriesPoint[]> {
  return (await api.get('/admin/system/series', { params: { minutes } })).data.data.series
}

export async function getClientErrors(limit = 50): Promise<ClientErrorGroup[]> {
  return (await api.get('/admin/system/client-errors', { params: { limit } })).data.data.errors
}
