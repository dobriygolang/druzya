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

package subscription

import (
	"context"
	"errors"
	"fmt"
	"log/slog"

	monolithServices "druz9/cmd/monolith/services"
	subApp "druz9/subscription/app"
	subDomain "druz9/subscription/domain"
	subInfra "druz9/subscription/infra"

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
	d monolithServices.Deps,
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

// ─── Cron facades — actual logic in services/subscription/app ──────────────
//
// These three exported entry points are kept with their original signatures
// because cmd/monolith/services/{hone,whiteboard_rooms,editor} call them
// directly. Each one composes a QuotaSweepRunner + QuotaSweepRepo and
// delegates to the corresponding Run* method.

func newSweepRunner(pool *pgxpool.Pool, log *slog.Logger) *subApp.QuotaSweepRunner {
	return &subApp.QuotaSweepRunner{
		Repo: subInfra.NewQuotaSweepRepo(pool),
		Log:  log,
	}
}

func RunFreeTierShareDowngradeWhiteboard(ctx context.Context, pool *pgxpool.Pool, log *slog.Logger) {
	newSweepRunner(pool, log).RunWhiteboards(ctx)
}

func RunFreeTierShareDowngradeEditor(ctx context.Context, pool *pgxpool.Pool, log *slog.Logger) {
	newSweepRunner(pool, log).RunEditorRooms(ctx)
}

func RunFreeTierNotesOverflowArchive(ctx context.Context, pool *pgxpool.Pool, log *slog.Logger) {
	newSweepRunner(pool, log).RunNotesArchive(ctx)
}
