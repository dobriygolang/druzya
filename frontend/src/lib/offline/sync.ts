// sync — outbox drain logic для offline vocab queue.
//
// Контракт:
//   - drainOutbox() FIFO-проходит по vocab_outbox; для каждой op делает
//     Connect-RPC через apiClient.api() (JSON transcoding endpoint), и при
//     успехе удаляет op из outbox.
//   - Идемпотентность: outbox op хранит operation_id (uuid). Передаём его
//     header'ом `X-Idempotency-Key` — backend dedup'ает по этому ключу
//     (TODO: backend wiring; для unwired endpoints op просто отправится
//     повторно, и server должен сам быть idempotent на (user_id, word)).
//   - При network error: оставляем op в outbox, выходим из drain — следующая
//     попытка через online-listener или manual retry.
//   - Singleton lock: одновременно не должно бежать два drain'а — у нас
//     in-memory флаг inflightDrain, который не позволяет рекурсию.
//
// Не делаем:
//   - backoff / retry counts (наивный first-pass; если будет видно spinning
//     loops в проде — добавим);
//   - кэш-инвалидацию react-query (caller вызовет invalidateQueries
//     manually после успешного drain'а).

import { api } from '../apiClient'

import {
  listOutboxOps,
  removeOutboxOp,
  type OutboxOp,
} from './vocab-db'

const HONE_SERVICE = '/hone.v1.HoneService'

let inflightDrain: Promise<DrainResult> | null = null
let onlineHandlerInstalled = false

export interface DrainResult {
  attempted: number
  succeeded: number
  failed: number
  /** Если выходим с failed > 0 — значит остановились на первой network ошибке. */
  stoppedOnError: boolean
}

/**
 * FIFO-drain. Coalesces concurrent invocations into single inflight promise
 * (e.g. user clicks «sync now» дважды быстро).
 */
export async function flushOutbox(): Promise<DrainResult> {
  if (inflightDrain) return inflightDrain
  inflightDrain = doDrain().finally(() => {
    inflightDrain = null
  })
  return inflightDrain
}

async function doDrain(): Promise<DrainResult> {
  const result: DrainResult = {
    attempted: 0,
    succeeded: 0,
    failed: 0,
    stoppedOnError: false,
  }

  // Если offline — нет смысла drain'ить. Возвращаем zeros.
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return result
  }

  let ops: (OutboxOp & { id: number })[]
  try {
    ops = await listOutboxOps()
  } catch {
    // IDB недоступен → silently skip; outbox flush возобновится при следующей
    // попытке открыть DB.
    return result
  }

  for (const op of ops) {
    result.attempted++
    try {
      await sendOp(op)
      await removeOutboxOp(op.id)
      result.succeeded++
    } catch (err) {
      result.failed++
      // Если backend вернул 4xx (validation / not-found) — op «toxic»: повторы
      // не помогут. Удаляем чтобы не зацикливаться. На 5xx / network error —
      // оставляем для retry.
      if (isPermanentFailure(err)) {
        await removeOutboxOp(op.id).catch(() => {
          /* swallow — если удаление падает, попробуем в следующий раз */
        })
      } else {
        result.stoppedOnError = true
        break
      }
    }
  }
  return result
}

async function sendOp(op: OutboxOp): Promise<void> {
  // Connect-RPC JSON transcoding: POST /hone.v1.HoneService/{Method}.
  // Тело — JSON-форма proto message. apiClient.api() сам ставит content-type
  // и bearer.
  const headers: Record<string, string> = {
    'x-idempotency-key': op.operation_id,
  }
  if (op.kind === 'review') {
    await api(`${HONE_SERVICE}/ReviewVocab`, {
      method: 'POST',
      headers,
      body: JSON.stringify(op.payload),
    })
    return
  }
  if (op.kind === 'add') {
    await api(`${HONE_SERVICE}/AddVocab`, {
      method: 'POST',
      headers,
      body: JSON.stringify(op.payload),
    })
    return
  }
  // Exhaustiveness: TS narrows к never, runtime safety на случай старых
  // outbox-ops после schema change.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  throw new Error(`unknown outbox op kind: ${(op as any).kind}`)
}

/**
 * 4xx error → drop op (won't be fixed by retry). 5xx / network → keep.
 * apiClient бросает ApiError с numeric .status, а fetch network errors —
 * TypeError. И то и другое распарсим через duck-typing чтобы не tight-coupling.
 */
function isPermanentFailure(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const status = (err as { status?: unknown }).status
  if (typeof status !== 'number') return false
  // 408 (timeout) и 429 (rate-limit) — retryable. Всё остальное 4xx — permanent.
  if (status === 408 || status === 429) return false
  return status >= 400 && status < 500
}

/**
 * Install one-time listener: когда browser переходит online → flush.
 * Idempotent — двойной вызов не дублирует listener.
 *
 * Также делает initial flush на install (если уже online) — это покрывает
 * сценарий: user открывает app online, hadrate'ит outbox с предыдущего
 * session'а, и хочет немедленный sync без ожидания offline→online transition.
 */
export function installOnlineSync(): void {
  if (onlineHandlerInstalled || typeof window === 'undefined') return
  onlineHandlerInstalled = true
  window.addEventListener('online', () => {
    void flushOutbox()
  })
  // Fire-and-forget initial drain.
  if (navigator.onLine !== false) {
    void flushOutbox()
  }
}

/** Generate operation_id для new outbox-op'ов. Использует crypto.randomUUID
 *  где доступен, fallback на time+random чтобы не падать в очень старых
 *  браузерах. Внутреннее использование, не криптографически устойчиво. */
export function makeOperationId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}
