// quota_enforce.go — generic quota check helpers + cron auto-downgrade
// for free-tier shared boards/rooms.
//
// Pattern:
//   - EnforceCreate(d, ctx, userID, getter, kind) → ok | err
//     где getter — функция выбирающая лимит из QuotaPolicy и текущий count
//   - При nil-полях Deps (resolver/usage/tier) — passthrough (feature
//     не loaded → не блокируем)
//
// Cron:
//   - runFreeTierShareDowngrade каждый час: SELECT shared rooms которые
//     принадлежат free-tier юзерам И expires_at < now() → flip visibility
//     на 'private'. Это enforces 24h TTL для shared-content на free tier'е
//     (см. domain.PolicyDefaults). Старые snapshot/yjs-updates сохраняются
//     для owner'а — он может продолжать редактировать private board.

package services

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"time"

	subApp "druz9/subscription/app"
	subDomain "druz9/subscription/domain"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ErrQuotaExceeded — sentinel для handlers которые хотят отдать 402.
var ErrQuotaExceeded = errors.New("quota exceeded")

// EnforceCreate checks: is this create-action allowed for user'а на его
// текущем tier'е? Если nil-deps → permissive (subscription-сервис не loaded).
//
// `field` — accessor от QuotaPolicy (см. domain.QSyncedNotes etc).
// `usageFn` — функция считающая текущее usage этого resource'а.
// При limit reached → ErrQuotaExceeded; при пустых deps / DB error → permissive.
func EnforceCreate(
	ctx context.Context,
	d Deps,
	userID uuid.UUID,
	field func(subDomain.QuotaPolicy) int,
	usageFn func(ctx context.Context, userID uuid.UUID) (int, error),
) error {
	if d.QuotaResolver == nil || d.QuotaTierGetter == nil {
		return nil // permissive — quota infrastructure not wired
	}
	tier, err := d.QuotaTierGetter.Do(ctx, userID)
	if err != nil {
		// DB error → permissive чтобы не блокировать users; warn в caller'е.
		return nil
	}
	policy := d.QuotaResolver.Get(ctx, tier)
	limit := field(policy)
	if limit == subDomain.Unlimited {
		return nil
	}
	used, err := usageFn(ctx, userID)
	if err != nil {
		return nil // permissive
	}
	if used >= limit {
		return fmt.Errorf("%w: tier %s allows %d, you have %d",
			ErrQuotaExceeded, string(tier), limit, used)
	}
	return nil
}

// ─── Cron: free-tier shared auto-downgrade ────────────────────────────────
//
// Free tier лимит: SharedTTL=24h на shared boards/rooms (см. quotas.go).
// После expires_at — visibility flip на 'private'. Owner всё ещё видит
// доску в своём списке + may continue editing локально; гости теряют
// доступ через WS/REST (visibility=private gates).
//
// Run: каждый час, начиная через 5 мин после старта (warmup).

func runFreeTierShareDowngradeWhiteboard(ctx context.Context, pool *pgxpool.Pool, log *slog.Logger) {
	first := time.NewTimer(5 * time.Minute)
	defer first.Stop()
	tick := time.NewTicker(time.Hour)
	defer tick.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-first.C:
			downgradeOnceWhiteboard(ctx, pool, log)
		case <-tick.C:
			downgradeOnceWhiteboard(ctx, pool, log)
		}
	}
}

func downgradeOnceWhiteboard(ctx context.Context, pool *pgxpool.Pool, log *slog.Logger) {
	// Free-tier owners with expired shared whiteboards → flip private.
	// JOIN against subscriptions: plan = free OR no row OR expired.
	// Column называется `plan` (не `tier`) — см. migrations/00008_social_ops.sql.
	const q = `
		UPDATE whiteboard_rooms wr
		   SET visibility = 'private'
		 WHERE wr.visibility = 'shared'
		   AND wr.expires_at < now()
		   AND COALESCE((
			   SELECT s.plan FROM subscriptions s WHERE s.user_id = wr.owner_id
		   ), 'free') = 'free'`
	tag, err := pool.Exec(ctx, q)
	if err != nil {
		log.WarnContext(ctx, "free_tier_downgrade.whiteboard", "err", err)
		return
	}
	if n := tag.RowsAffected(); n > 0 {
		log.InfoContext(ctx, "free_tier_downgrade.whiteboard", "demoted", n)
	}

	// Quota-overflow downgrade: free-tier юзеры могли набрать > policy limit
	// shared rooms из-за legacy багов (раньше visibility flip private→shared
	// шёл без quota check, и раньше /subscription/quota 500'ил из-за `notes`
	// vs `hone_notes` table-name бага → EnforceCreate падал в permissive).
	// Free tier policy лимит = 1 active shared board (см. domain.PolicyDefaults).
	// Оставляем самую недавнюю, остальные демотируем в private. Owner всё
	// ещё видит её в своём списке (просто гости теряют доступ).
	const overflowQ = `
		WITH ranked AS (
		  SELECT wr.id,
				 ROW_NUMBER() OVER (PARTITION BY wr.owner_id ORDER BY wr.created_at DESC) AS rn
			FROM whiteboard_rooms wr
		   WHERE wr.visibility = 'shared'
			 AND wr.expires_at > now()
			 AND COALESCE((
				 SELECT s.plan FROM subscriptions s WHERE s.user_id = wr.owner_id
			 ), 'free') = 'free'
		)
		UPDATE whiteboard_rooms
		   SET visibility = 'private'
		 WHERE id IN (SELECT id FROM ranked WHERE rn > 1)`
	tag2, err := pool.Exec(ctx, overflowQ)
	if err != nil {
		log.WarnContext(ctx, "free_tier_overflow_downgrade.whiteboard", "err", err)
		return
	}
	if n := tag2.RowsAffected(); n > 0 {
		log.InfoContext(ctx, "free_tier_overflow_downgrade.whiteboard", "demoted", n)
	}
}

func runFreeTierShareDowngradeEditor(ctx context.Context, pool *pgxpool.Pool, log *slog.Logger) {
	first := time.NewTimer(5 * time.Minute)
	defer first.Stop()
	tick := time.NewTicker(time.Hour)
	defer tick.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-first.C:
			downgradeOnceEditor(ctx, pool, log)
		case <-tick.C:
			downgradeOnceEditor(ctx, pool, log)
		}
	}
}

func downgradeOnceEditor(ctx context.Context, pool *pgxpool.Pool, log *slog.Logger) {
	const q = `
		UPDATE editor_rooms er
		   SET visibility = 'private'
		 WHERE er.visibility = 'shared'
		   AND er.expires_at < now()
		   AND COALESCE((
			   SELECT s.plan FROM subscriptions s WHERE s.user_id = er.owner_id
		   ), 'free') = 'free'`
	tag, err := pool.Exec(ctx, q)
	if err != nil {
		log.WarnContext(ctx, "free_tier_downgrade.editor", "err", err)
		return
	}
	if n := tag.RowsAffected(); n > 0 {
		log.InfoContext(ctx, "free_tier_downgrade.editor", "demoted", n)
	}

	// Quota-overflow: free-tier лимит = 1 active shared editor room. Юзеры
	// у которых > 1 — последствие legacy bug'ов (visibility flip без чека,
	// /quota 500'ил → permissive). Оставляем самую недавнюю, остальные
	// демотируем. Owner remains an owner — кнопка «sharing» в UI снова
	// доступна для re-flip когда он один достанется (или upgrade'а tier'а).
	const overflowQ = `
		WITH ranked AS (
		  SELECT er.id,
				 ROW_NUMBER() OVER (PARTITION BY er.owner_id ORDER BY er.created_at DESC) AS rn
			FROM editor_rooms er
		   WHERE er.visibility = 'shared'
			 AND er.expires_at > now()
			 AND COALESCE((
				 SELECT s.plan FROM subscriptions s WHERE s.user_id = er.owner_id
			 ), 'free') = 'free'
		)
		UPDATE editor_rooms
		   SET visibility = 'private'
		 WHERE id IN (SELECT id FROM ranked WHERE rn > 1)`
	tag2, err := pool.Exec(ctx, overflowQ)
	if err != nil {
		log.WarnContext(ctx, "free_tier_overflow_downgrade.editor", "err", err)
		return
	}
	if n := tag2.RowsAffected(); n > 0 {
		log.InfoContext(ctx, "free_tier_overflow_downgrade.editor", "demoted", n)
	}
}

// Var для подавления unused-warning'а если subApp пакет не используется
// напрямую в этом файле (используется через Deps fields, но Go не считает
// это явным import-usage'ом).
var _ = subApp.NewPolicyResolver
