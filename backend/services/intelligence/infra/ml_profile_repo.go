// ml_profile_repo.go — Phase K, M5 (P1) 2026-05-13.
//
// Reader для domain.MLProfileReader. Single SQL round-trip joining
// user_primary_goals + hone_user_settings — оба источника ML signal'а:
//   - user_primary_goals.kind = 'ml_offer' (committed, deliberate)
//   - hone_user_settings.active_track = 'ml' (UI exploration)
//
// Fail-soft контракт (см ml_profile.go): любая ошибка → (MLProfile{}, nil).
// Coach деградирует к default-prompt'у, never crashes. Same pattern как у
// coach_config.go (DBCoachConfigReader).
package infra

import (
	"context"

	"druz9/intelligence/domain"
	sharedpg "druz9/shared/pkg/pg"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// MLProfileReader — pgx adapter.
type MLProfileReader struct {
	pool *pgxpool.Pool
}

// NewMLProfileReader wires the adapter. nil-pool returns IsML=false reader
// (тесты + dev окружения без БД).
func NewMLProfileReader(pool *pgxpool.Pool) *MLProfileReader {
	return &MLProfileReader{pool: pool}
}

// GetMLProfile reads both signals. NEVER returns error — fail-soft to
// (MLProfile{}, nil) so coach falls back to default behaviour.
//
// Query rationale: LEFT JOIN на оба источника — user может иметь settings
// без primary_goal или vice versa. COALESCE на active=TRUE filter держит
// invariant «одна active primary goal на юзера» (см DB partial unique idx).
func (r *MLProfileReader) GetMLProfile(ctx context.Context, userID uuid.UUID) (domain.MLProfile, error) {
	if r == nil || r.pool == nil {
		return domain.MLProfile{}, nil
	}
	var (
		goalIsML  bool
		trackIsML bool
	)
	err := r.pool.QueryRow(ctx, `
		SELECT
		    COALESCE((SELECT TRUE
		                FROM user_primary_goals
		               WHERE user_id = $1
		                 AND active  = TRUE
		                 AND kind    = 'ml_offer'
		               LIMIT 1), FALSE) AS goal_is_ml,
		    COALESCE((SELECT TRUE
		                FROM hone_user_settings
		               WHERE user_id = $1
		                 AND active_track = 'ml'
		               LIMIT 1), FALSE) AS track_is_ml
	`, sharedpg.UUID(userID)).Scan(&goalIsML, &trackIsML)
	if err != nil {
		// Fail-soft: log handled by caller; this layer returns zero value
		// so coach falls back to default prompts.
		return domain.MLProfile{}, nil
	}
	return domain.MLProfile{
		IsML:                 goalIsML || trackIsML,
		PrimaryGoalIsMLOffer: goalIsML,
		ActiveTrackIsML:      trackIsML,
	}, nil
}

// Compile-time guard.
var _ domain.MLProfileReader = (*MLProfileReader)(nil)
