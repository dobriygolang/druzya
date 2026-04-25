// Package domain — quota policy per tier для Phase 5+ subscription model.
//
// Квоты определяют что юзер может делать на данном tier'е. Не storage
// per se (у нас infinite OS-disk на клиенте через IndexedDB), а
// **server-side resources**: published notes (cloud-synced), shared
// boards/rooms (multi-user collab требующая backend relay), AI calls
// (cost-bound).
//
// Модель:
//   - Free: notes ВСЕ локально (IndexedDB), Publish → cloud (counts toward
//     SyncedNotes quota). Shared board/room: 1 active с 24h TTL → авто-
//     downgrade в private + удаление с backend'а.
//   - Seeker: middle tier — cross-device sync для всех notes (counts toward
//     SyncedNotes quota), 5 active shared boards/rooms без TTL.
//   - Ascended: top tier — unlimited.
//
// Числа — стартовая прикидка (Phase 5 alpha). Tweak под рыночные данные
// после первых retention-метрик.

package domain

import "time"

// QuotaPolicy — лимиты one tier'а на server-side ресурсы.
//
// Все unlimited-поля закодированы константой `Unlimited = -1` чтобы
// нумерический код мог `if used >= policy.SyncedNotes` сравнивать без
// special case'ов (Unlimited никогда не пересекается).
type QuotaPolicy struct {
	// SyncedNotes — сколько notes юзер может держать на backend'е (cross-
	// device sync + AI search-able). Free: 10 (только публичные).
	SyncedNotes int

	// ActiveSharedBoards — сколько одновременно активных shared whiteboard'ов.
	// Free: 1 на 24h, потом авто-downgrade в private.
	ActiveSharedBoards int

	// ActiveSharedRooms — то же для code-rooms.
	ActiveSharedRooms int

	// SharedTTL — длительность shared-доступа для free-tier'а. Tier Seeker+
	// = 0 (no TTL = бессрочно). Cron-job в whiteboard_rooms / editor сервисах
	// downgrade'ит room'ы которые exceeded TTL и принадлежат free-tier
	// owner'у.
	SharedTTL time.Duration

	// AIMonthly — сколько /ask-style AI invocations в месяц. Cost-bound.
	// 0 = AI disabled полностью (показывать upgrade-prompt).
	AIMonthly int
}

// Unlimited — sentinel для int-полей policy. Use only via comparison
// helpers below; не интерпретируется как "0".
const Unlimited = -1

// PolicyDefaults returns hardcoded fallback policy. Production reads
// admin-editable values из dynamic_config через PolicyResolver
// (см. app/quota_resolver.go). Defaults используются при cache-miss
// и при missing config row'ах.
func PolicyDefaults(t Tier) QuotaPolicy {
	return Policy(t)
}

// Policy — legacy alias. NEW code should use PolicyResolver injected
// via app layer (allows admin override через dynamic_config). Эта функция
// возвращает hardcoded defaults — годится для tests или when DB unavailable.
//
// При добавлении нового tier'а — добавить case + frontend копию.
func Policy(t Tier) QuotaPolicy {
	switch t {
	case TierAscended:
		return QuotaPolicy{
			SyncedNotes:        Unlimited,
			ActiveSharedBoards: Unlimited,
			ActiveSharedRooms:  Unlimited,
			SharedTTL:          0, // no TTL
			AIMonthly:          1000,
		}
	case TierSeeker:
		return QuotaPolicy{
			SyncedNotes:        100,
			ActiveSharedBoards: 5,
			ActiveSharedRooms:  5,
			SharedTTL:          0, // no TTL
			AIMonthly:          100,
		}
	case TierFree:
		fallthrough
	default:
		return QuotaPolicy{
			SyncedNotes:        10,
			ActiveSharedBoards: 1,
			ActiveSharedRooms:  1,
			SharedTTL:          24 * time.Hour,
			// AI: unlimited на Free — мы используем бесплатные turbo-LLM'ы
			// (см. project_llmchain notes). Cost-per-call ~0; нет смысла
			// ставить квоту. Платные tier'ы получают доступ к более качественным
			// моделям, что и есть value-prop'ом для upgrade.
			AIMonthly: Unlimited,
		}
	}
}

// Allows checks if `used + 1` would exceed limit. Returns true if action
// can proceed. Unlimited (-1) → always true.
func (q QuotaPolicy) Allows(used int, getter func(QuotaPolicy) int) bool {
	limit := getter(q)
	if limit == Unlimited {
		return true
	}
	return used < limit
}

// Field accessors для type-safe Allows() calls. Использование:
//
//	if !policy.Allows(currentCount, domain.QSyncedNotes) { reject }
var (
	QSyncedNotes        = func(p QuotaPolicy) int { return p.SyncedNotes }
	QActiveSharedBoards = func(p QuotaPolicy) int { return p.ActiveSharedBoards }
	QActiveSharedRooms  = func(p QuotaPolicy) int { return p.ActiveSharedRooms }
	QAIMonthly          = func(p QuotaPolicy) int { return p.AIMonthly }
)

// QuotaUsage — текущее использование per-resource. Считается use-case'ом
// `app/get_quota.go` через прямые SELECT count'ы (или materialized counters
// если cost'ит много на больших dataset'ах).
type QuotaUsage struct {
	SyncedNotes        int
	ActiveSharedBoards int
	ActiveSharedRooms  int
	AIThisMonth        int
}
