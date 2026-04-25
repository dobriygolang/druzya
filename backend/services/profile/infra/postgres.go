// Package infra provides the PostgreSQL-backed ProfileRepo.
// Most queries are now served by the sqlc-generated profiledb.Queries; a few
// pieces that require dynamic SQL (settings + daily_streaks upsert) remain
// hand-rolled and are marked accordingly.
//
// File layout (split from a single 765-line postgres.go in WAVE-11):
//   - postgres.go           — constructor, pool wiring, top-level bundle reads.
//   - settings_repo.go      — GetSettings / UpdateSettings.
//   - skill_nodes_repo.go   — UpsertSkillNode + ListSkillNodes.
//   - percentiles_repo.go   — GetPercentiles.
//   - streaks_repo.go       — GetStreaks + activity / weekly XP / elo / hourly.
//   - share_tokens_repo.go  — IssueShareToken / ResolveShareToken.
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

// GetByUserID joins users + profiles + subscriptions + ai_credits via sqlc,
// then pulls ratings separately.
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
		Email:       pgText(row.Email),
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
		XP:          row.Xp,
		Title:       pgText(row.Title),
		AvatarFrame: pgText(row.AvatarFrame),
		CareerStage: domain.CareerStage(row.CareerStage),
		Attributes: domain.Attributes{
			Intellect: int(row.Intellect),
			Strength:  int(row.Strength),
			Dexterity: int(row.Dexterity),
			Will:      int(row.Will),
		},
		UpdatedAt: row.UpdatedAt.Time,
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
	if row.Balance.Valid {
		b.AICredits = int(row.Balance.Int32)
	}
	ratings, err := p.ListRatings(ctx, userID)
	if err != nil {
		return domain.Bundle{}, fmt.Errorf("profile.Postgres.GetByUserID: ratings: %w", err)
	}
	b.Ratings = ratings
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
		XP:          row.Xp,
		Title:       pgText(row.Title),
		AvatarFrame: pgText(row.AvatarFrame),
		CareerStage: domain.CareerStage(row.CareerStage),
	}
	if ratings, err := p.ListRatings(ctx, b.User.ID); err != nil {
		return domain.PublicBundle{}, fmt.Errorf("profile.Postgres.GetPublic: ratings: %w", err)
	} else {
		b.Ratings = ratings
	}
	if nodes, err := p.ListSkillNodes(ctx, b.User.ID); err != nil {
		return domain.PublicBundle{}, fmt.Errorf("profile.Postgres.GetPublic: nodes: %w", err)
	} else {
		b.Atlas = nodes
	}
	return b, nil
}

// EnsureDefaults seeds profile/subscription/ai_credits/prefs and daily_streaks.
// daily_streaks lives in a different domain (daily) but the MVP creates it here
// so new users don't 404 on first GET /daily/streak.
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
	if err := qtx.EnsureAICredits(ctx, uid); err != nil {
		return fmt.Errorf("profile.Postgres.EnsureDefaults: ai_credits: %w", err)
	}
	if err := qtx.EnsureNotificationPrefs(ctx, uid); err != nil {
		return fmt.Errorf("profile.Postgres.EnsureDefaults: prefs: %w", err)
	}
	// NOTE: daily_streaks ensure — cross-domain init, not in profile sqlc.
	if _, err := tx.Exec(ctx,
		`INSERT INTO daily_streaks(user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING`, userID); err != nil {
		return fmt.Errorf("profile.Postgres.EnsureDefaults: streak: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("profile.Postgres.EnsureDefaults: commit: %w", err)
	}
	return nil
}

// ApplyXPDelta updates level+xp via sqlc.
func (p *Postgres) ApplyXPDelta(ctx context.Context, userID uuid.UUID, addXP int, newLevel int, remainderXP int64) error {
	if err := p.q.UpdateProfileXPLevel(ctx, profiledb.UpdateProfileXPLevelParams{
		UserID: sharedpg.UUID(userID),
		Level:  int32(newLevel),
		Xp:     remainderXP,
	}); err != nil {
		return fmt.Errorf("profile.Postgres.ApplyXPDelta: %w", err)
	}
	_ = addXP // carried through via the XP event for audit
	return nil
}

// UpdateCareerStage writes back the derived seniority.
func (p *Postgres) UpdateCareerStage(ctx context.Context, userID uuid.UUID, stage domain.CareerStage) error {
	if !stage.IsValid() {
		return fmt.Errorf("profile.Postgres.UpdateCareerStage: invalid stage %q", stage)
	}
	if err := p.q.UpdateCareerStage(ctx, profiledb.UpdateCareerStageParams{
		UserID:      sharedpg.UUID(userID),
		CareerStage: stage.String(),
	}); err != nil {
		return fmt.Errorf("profile.Postgres.UpdateCareerStage: %w", err)
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
