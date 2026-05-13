// vocab-db — IndexedDB wrapper для offline vocab review (Lingua module).
//
// Зачем отдельная DB вместо react-query persist-cache:
//   1. SRS-state (box / next_review_at) — first-class, не cache hint;
//   2. Outbox-pattern: write-intent должен переживать reload/airplane mode
//      и flush'иться как только online === true (см sync.ts);
//   3. Compact API specific для vocab review — не пытаемся быть general-purpose.
//
// Object stores:
//   - vocab_queue (keyPath `id`): полная карточка для SRS.
//     id = composite `${user_id}|${word}` — server side word уникален per user.
//   - vocab_outbox (keyPath `id`, autoIncrement): pending operations queue.
//     kind = 'review' | 'add'. payload — мини-DTO достаточный для replay.
//
// Все методы дешёвые wrappers вокруг idb — никакой бизнес-логики. SRS-pricing
// (когда писать review correct vs incorrect) живёт на pages/lingua/* и на backend.

import { openDB, type DBSchema, type IDBPDatabase } from 'idb'

const DB_NAME = 'druz9_lingua'
const DB_VERSION = 1

export interface VocabCard {
  /** composite `${user_id}|${word}` — keyPath. */
  id: string
  user_id: string
  word: string
  translation: string
  context_md: string
  source_material: string
  /** Leitner box 0..5; 5 = graduated (review более не due). */
  box: number
  /** unix-ms. Card is due when `next_review_at <= now`. */
  next_review_at: number
  /** unix-ms; 0 when not graduated. */
  learned_at: number
  /** unix-ms of last server-side write — used as cache-bust signal. */
  updated_at: number
}

/** Operation queued for backend replay. Shape mirrors proto request types. */
export type OutboxOp =
  | {
      kind: 'review'
      /** stable operation_id для idempotent replay — генерим uuid при enqueue. */
      operation_id: string
      payload: { word: string; correct: boolean }
      queued_at: number
    }
  | {
      kind: 'add'
      operation_id: string
      payload: {
        word: string
        translation: string
        context_md: string
        source_material: string
      }
      queued_at: number
    }

interface DruzLinguaSchema extends DBSchema {
  vocab_queue: {
    key: string
    value: VocabCard
    indexes: {
      'by-user': string
      'by-due': number
    }
  }
  vocab_outbox: {
    key: number
    value: OutboxOp & { id: number }
  }
}

let dbPromise: Promise<IDBPDatabase<DruzLinguaSchema>> | null = null

/**
 * Open (or get cached) IndexedDB connection. Idempotent — safe to call
 * многократно: первый caller инициализирует, остальные получают тот же
 * promise. На SSR / no-IDB environments возвращает rejected promise через
 * idb (caller должен ловить и degrade'нуть gracefully).
 */
export function openDb(): Promise<IDBPDatabase<DruzLinguaSchema>> {
  if (typeof window === 'undefined' || typeof indexedDB === 'undefined') {
    return Promise.reject(new Error('IndexedDB unavailable (SSR or no-IDB env)'))
  }
  if (!dbPromise) {
    dbPromise = openDB<DruzLinguaSchema>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('vocab_queue')) {
          const queue = db.createObjectStore('vocab_queue', { keyPath: 'id' })
          queue.createIndex('by-user', 'user_id')
          queue.createIndex('by-due', 'next_review_at')
        }
        if (!db.objectStoreNames.contains('vocab_outbox')) {
          db.createObjectStore('vocab_outbox', {
            keyPath: 'id',
            autoIncrement: true,
          })
        }
      },
      blocked() {
        // Старая вкладка держит prev-version connection — ничего fatal-ного.
        // В консоль warn'ом, продолжаем работать со старой версией.
        // eslint-disable-next-line no-console
        console.warn('[vocab-db] upgrade blocked — close other tabs to apply schema change')
      },
      terminated() {
        dbPromise = null
      },
    })
  }
  return dbPromise
}

/** Upsert a vocab card into queue. */
export async function putVocabCard(card: VocabCard): Promise<void> {
  const db = await openDb()
  await db.put('vocab_queue', card)
}

/** Bulk upsert — для hydrate'а кэша из ListVocabDue. */
export async function bulkPutVocabCards(cards: VocabCard[]): Promise<void> {
  if (cards.length === 0) return
  const db = await openDb()
  const tx = db.transaction('vocab_queue', 'readwrite')
  await Promise.all(cards.map((c) => tx.store.put(c)))
  await tx.done
}

/**
 * Возвращает все карточки с `next_review_at <= now`, sorted ASC (oldest due
 * first). Использует by-due index → range query, не загружая всю queue
 * целиком — критично для airplane-mode users с 1k+ карточками.
 */
export async function getDueCards(now: number = Date.now()): Promise<VocabCard[]> {
  const db = await openDb()
  const range = IDBKeyRange.upperBound(now)
  // getAll с index возвращает sorted by key — то что нужно (next_review_at ASC).
  return db.getAllFromIndex('vocab_queue', 'by-due', range)
}

/** Все карточки конкретного пользователя — для full review surface (settings/export). */
export async function getAllCardsForUser(userId: string): Promise<VocabCard[]> {
  const db = await openDb()
  return db.getAllFromIndex('vocab_queue', 'by-user', userId)
}

/** Получить одну карточку по id (composite). */
export async function getVocabCard(id: string): Promise<VocabCard | undefined> {
  const db = await openDb()
  return db.get('vocab_queue', id)
}

/** Delete a card (e.g. user forgets, or server confirms graduation purge). */
export async function deleteVocabCard(id: string): Promise<void> {
  const db = await openDb()
  await db.delete('vocab_queue', id)
}

/**
 * Append an op to outbox. Caller passes operation_id (uuid) — drainOutbox
 * sends it as request-id header так что backend может dedupe retries.
 */
export async function queueOutboxOp(op: OutboxOp): Promise<number> {
  const db = await openDb()
  // autoIncrement: id будет назначен IDB; cast safe для возвращаемого numeric key.
  const key = await db.add('vocab_outbox', op as OutboxOp & { id: number })
  return key as number
}

/** Текущие pending ops, sorted by insertion order (FIFO). */
export async function listOutboxOps(): Promise<(OutboxOp & { id: number })[]> {
  const db = await openDb()
  return db.getAll('vocab_outbox')
}

/** Remove confirmed-sent op from outbox. Called by sync.drainOutbox(). */
export async function removeOutboxOp(id: number): Promise<void> {
  const db = await openDb()
  await db.delete('vocab_outbox', id)
}

/** Counter для OfflineBanner / settings: «N pending sync». */
export async function getOutboxCount(): Promise<number> {
  const db = await openDb()
  return db.count('vocab_outbox')
}

/** Polyfill helper: clear everything (dev / signout). */
export async function clearAll(): Promise<void> {
  const db = await openDb()
  const tx = db.transaction(['vocab_queue', 'vocab_outbox'], 'readwrite')
  await Promise.all([tx.objectStore('vocab_queue').clear(), tx.objectStore('vocab_outbox').clear()])
  await tx.done
}
