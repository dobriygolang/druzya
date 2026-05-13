// Public barrel for the offline-vocab infrastructure (Lingua module).
//
// Surface for Agent GG (pages/lingua/*):
//   import { useOnline, flushOutbox, queueOutboxOp, getDueCards,
//            bulkPutVocabCards, makeOperationId, type VocabCard,
//            type OutboxOp } from '@/lib/offline'
//
// Внутренние модули (vocab-db / sync / use-online) — не exposed как
// public-API; всё работает через этот barrel.

export {
  openDb,
  putVocabCard,
  bulkPutVocabCards,
  getDueCards,
  getAllCardsForUser,
  getVocabCard,
  deleteVocabCard,
  queueOutboxOp,
  listOutboxOps,
  removeOutboxOp,
  getOutboxCount,
  clearAll,
  type VocabCard,
  type OutboxOp,
} from './vocab-db'

export { flushOutbox, installOnlineSync, makeOperationId, type DrainResult } from './sync'

export { useOnline } from './use-online'
