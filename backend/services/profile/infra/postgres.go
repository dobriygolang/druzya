// Package infra provides the PostgreSQL-backed ProfileRepo.
// Most queries are now served by the sqlc-generated profiledb.Queries; a few
// pieces that require dynamic SQL remain hand-rolled and are marked accordingly.
//
// File layout (split from a single 765-line postgres.go in WAVE-11; pruned
// after R1 cleanup — daily_streaks / share_tokens / percentiles dropped):
//   - postgres.go           — constructor, pool wiring, top-level bundle reads.
//   - settings_repo.go      — GetSettings / UpdateSettings.
//   - skill_nodes_repo.go   — UpsertSkillNode + ListSkillNodes.
//   - streaks_repo.go       — CountRecentActivity (XP/elo aggregates).
//   - tracks_repo.go        — Track-related lookups.
//
// All methods stay on *Postgres — splitting is purely organisational so the
// next reader can find the relevant SQL without scrolling 700 lines.
package infra

import (
	"context"
	"errors"
	"fmt"

	"druz9/profile/domain"
	profiledb "druz9/profile/infra/db"
	"druz9/shared/enums"

	sharedpg "druz9/shared/pkg/pg"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Postgres implements domain.ProfileRepo.
type Postgres struct {
	pool *pgxpool.Pool
	q    *profiledb.Queries
}

// NewPostgres wraps a pool and prepares a Queries handle.
func NewPostgres(pool *pgxpool.Pool) *Postgres {
	return &Postgres{pool: pool, q: profiledb.New(pool)}
}

// GetByUserID joins users + profiles + subscriptions via sqlc, then pulls
// ratings separately. (ai_credits table dropped in 00074, AICredits field
// returns 0 from the bundle reader.)
func (p *Postgres) GetByUserID(ctx context.Context, userID uuid.UUID) (domain.Bundle, error) {
	row, err := p.q.GetProfileBundle(ctx, sharedpg.UUID(userID))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.Bundle{}, fmt.Errorf("profile.Postgres.GetByUserID: %w", domain.ErrNotFound)
		}
		return domain.Bundle{}, fmt.Errorf("profile.Postgres.GetByUserID: %w", err)
	}
	b := domain.Bundle{}
	b.User = domain.User{
		ID:          sharedpg.UUIDFrom(row.ID),
		Username:    row.Username,
		Role:        enums.UserRole(row.Role),
		Locale:      row.Locale,
		DisplayName: pgText(row.DisplayName),
		CreatedAt:   row.CreatedAt.Time,
	}
	b.Profile = domain.Profile{
		UserID:      userID,
		CharClass:   enums.CharClass(row.CharClass),
		Level:       int(row.Level),
		XP:          row.TotalXp,
		UpdatedAt:   row.UpdatedAt.Time,
	}
	if row.Plan.Valid {
		b.Subscription = domain.Subscription{
			UserID: userID,
			Plan:   enums.SubscriptionPlan(row.Plan.String),
			Status: pgText(row.Status),
		}
		if row.CurrentPeriodEnd.Valid {
			t := row.CurrentPeriodEnd.Time
			b.Subscription.CurrentPeriodEnd = &t
		}
	} else {
		b.Subscription.Plan = enums.SubscriptionPlanFree
		b.Subscription.Status = "active"
	}
	return b, nil
}

// GetPublic returns the SEO-visible subset for /u/{username}.
func (p *Postgres) GetPublic(ctx context.Context, username string) (domain.PublicBundle, error) {
	row, err := p.q.GetProfilePublic(ctx, username)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.PublicBundle{}, fmt.Errorf("profile.Postgres.GetPublic: %w", domain.ErrNotFound)
		}
		return domain.PublicBundle{}, fmt.Errorf("profile.Postgres.GetPublic: %w", err)
	}
	b := domain.PublicBundle{}
	b.User = domain.User{
		ID:          sharedpg.UUIDFrom(row.ID),
		Username:    row.Username,
		DisplayName: pgText(row.DisplayName),
		CreatedAt:   row.CreatedAt.Time,
	}
	b.Profile = domain.Profile{
		UserID:      b.User.ID,
		CharClass:   enums.CharClass(row.CharClass),
		Level:       int(row.Level),
		XP:          row.TotalXp,
	}
	if nodes, err := p.ListSkillNodes(ctx, b.User.ID); err != nil {
		return domain.PublicBundle{}, fmt.Errorf("profile.Postgres.GetPublic: nodes: %w", err)
	} else {
		b.Atlas = nodes
	}
	return b, nil
}

// EnsureDefaults seeds profile/subscription/prefs.
func (p *Postgres) EnsureDefaults(ctx context.Context, userID uuid.UUID) error {
	tx, err := p.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("profile.Postgres.EnsureDefaults: begin: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	qtx := p.q.WithTx(tx)
	uid := sharedpg.UUID(userID)

	if err := qtx.EnsureProfile(ctx, uid); err != nil {
		return fmt.Errorf("profile.Postgres.EnsureDefaults: profile: %w", err)
	}
	if err := qtx.EnsureSubscription(ctx, uid); err != nil {
		return fmt.Errorf("profile.Postgres.EnsureDefaults: subscription: %w", err)
	}
	if err := qtx.EnsureNotificationPrefs(ctx, uid); err != nil {
		return fmt.Errorf("profile.Postgres.EnsureDefaults: prefs: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("profile.Postgres.EnsureDefaults: commit: %w", err)
	}
	return nil
}

// ApplyXPDelta updates level+xp via sqlc.
func (p *Postgres) ApplyXPDelta(ctx context.Context, userID uuid.UUID, addXP int, newLevel int, remainderXP int64) error {
	// v2: xp/level live in user_xp now. Ensure the row exists, then update.
	if err := p.q.EnsureUserXP(ctx, sharedpg.UUID(userID)); err != nil {
		return fmt.Errorf("profile.Postgres.ApplyXPDelta: ensure: %w", err)
	}
	if err := p.q.UpdateProfileXPLevel(ctx, profiledb.UpdateProfileXPLevelParams{
		UserID:  sharedpg.UUID(userID),
		Level:   int32(newLevel),
		TotalXp: remainderXP,
	}); err != nil {
		return fmt.Errorf("profile.Postgres.ApplyXPDelta: %w", err)
	}
	_ = addXP // sub-event audit пишется отдельным RecordXPEvent
	return nil
}

// RecordXPEvent — Phase H audit log row. SQL-CHECK на source гарантирует
// closed-set; некорректный source ловится тут с ошибкой 23514 → caller
// должен починить мапинг (см. xpEventSourceFromReason в profile/app).
func (p *Postgres) RecordXPEvent(ctx context.Context, userID uuid.UUID, amount int, source string, sourceID *uuid.UUID) error {
	var sid pgtype.UUID
	if sourceID != nil && *sourceID != uuid.Nil {
		sid = sharedpg.UUID(*sourceID)
	}
	if err := p.q.InsertXPEvent(ctx, profiledb.InsertXPEventParams{
		UserID:   sharedpg.UUID(userID),
		Amount:   int32(amount),
		Source:   source,
		SourceID: sid,
	}); err != nil {
		return fmt.Errorf("profile.Postgres.RecordXPEvent: %w", err)
	}
	return nil
}


// ── helpers ────────────────────────────────────────────────────────────────

func pgText(t pgtype.Text) string {
	if !t.Valid {
		return ""
	}
	return t.String
}

func parseChannels(raw []string) []enums.NotificationChannel {
	out := make([]enums.NotificationChannel, 0, len(raw))
	for _, r := range raw {
		ch := enums.NotificationChannel(r)
		if ch.IsValid() {
			out = append(out, ch)
		}
	}
	return out
}

func clampPct(p float64) int {
	v := int(p*100 + 0.5)
	if v < 0 {
		return 0
	}
	if v > 100 {
		return 100
	}
	return v
}
