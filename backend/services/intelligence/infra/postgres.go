// Package infra — Postgres repos + LLM adapters for the intelligence
// service. Hand-rolled pgx (matches hone/whiteboard_rooms style — sqlc
// migration is unfinished elsewhere; consistency wins over zealotry).
package infra

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"druz9/intelligence/domain"
	sharedpg "druz9/shared/pkg/pg"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ─── DailyBriefs (own table) ──────────────────────────────────────────────

// DailyBriefs implements domain.DailyBriefRepo over hone_daily_briefs.
type DailyBriefs struct {
	pool *pgxpool.Pool
}

// NewDailyBriefs wraps a pool.
func NewDailyBriefs(pool *pgxpool.Pool) *DailyBriefs { return &DailyBriefs{pool: pool} }

// briefPayload is the on-wire shape stored in payload jsonb. Distinct from
// the domain struct so we can evolve the column without breaking the type
// passed to use cases.
type briefPayload struct {
	Headline        string                  `json:"headline"`
	Narrative       string                  `json:"narrative"`
	Recommendations []recommendationPayload `json:"recommendations"`
}

type recommendationPayload struct {
	Kind      string `json:"kind"`
	Title     string `json:"title"`
	Rationale string `json:"rationale"`
	TargetID  string `json:"target_id"`
}

// GetForDate returns the brief for (user, date). ErrNotFound if none.
func (r *DailyBriefs) GetForDate(ctx context.Context, userID uuid.UUID, date time.Time) (domain.DailyBrief, error) {
	var (
		raw         []byte
		generatedAt time.Time
	)
	err := r.pool.QueryRow(ctx,
		`SELECT payload, generated_at
		   FROM hone_daily_briefs
		  WHERE user_id=$1 AND brief_date=$2`,
		sharedpg.UUID(userID), pgtype.Date{Time: date, Valid: true},
	).Scan(&raw, &generatedAt)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.DailyBrief{}, domain.ErrNotFound
		}
		return domain.DailyBrief{}, fmt.Errorf("intelligence.DailyBriefs.GetForDate: %w", err)
	}
	var p briefPayload
	if err := json.Unmarshal(raw, &p); err != nil {
		return domain.DailyBrief{}, fmt.Errorf("intelligence.DailyBriefs.GetForDate: unmarshal: %w", err)
	}
	out := domain.DailyBrief{
		Headline:    p.Headline,
		Narrative:   p.Narrative,
		GeneratedAt: generatedAt,
	}
	for _, rec := range p.Recommendations {
		out.Recommendations = append(out.Recommendations, domain.Recommendation{
			Kind:      domain.RecommendationKind(rec.Kind),
			Title:     rec.Title,
			Rationale: rec.Rationale,
			TargetID:  rec.TargetID,
		})
	}
	return out, nil
}

// Upsert replaces the brief for (user, date).
func (r *DailyBriefs) Upsert(ctx context.Context, userID uuid.UUID, date time.Time, b domain.DailyBrief) error {
	p := briefPayload{Headline: b.Headline, Narrative: b.Narrative}
	for _, rec := range b.Recommendations {
		p.Recommendations = append(p.Recommendations, recommendationPayload{
			Kind:      string(rec.Kind),
			Title:     rec.Title,
			Rationale: rec.Rationale,
			TargetID:  rec.TargetID,
		})
	}
	raw, err := json.Marshal(p)
	if err != nil {
		return fmt.Errorf("intelligence.DailyBriefs.Upsert: marshal: %w", err)
	}
	_, err = r.pool.Exec(ctx,
		`INSERT INTO hone_daily_briefs (user_id, brief_date, payload, generated_at)
		 VALUES ($1, $2, $3, $4)
		 ON CONFLICT (user_id, brief_date) DO UPDATE
		   SET payload      = EXCLUDED.payload,
		       generated_at = EXCLUDED.generated_at`,
		sharedpg.UUID(userID), pgtype.Date{Time: date, Valid: true}, raw, b.GeneratedAt,
	)
	if err != nil {
		return fmt.Errorf("intelligence.DailyBriefs.Upsert: %w", err)
	}
	return nil
}

// LastForcedAt returns the most-recent generated_at across the user's
// briefs. Used as a 1/h gate on force=true. Zero time when none.
func (r *DailyBriefs) LastForcedAt(ctx context.Context, userID uuid.UUID) (time.Time, error) {
	var t pgtype.Timestamptz
	err := r.pool.QueryRow(ctx,
		`SELECT MAX(generated_at) FROM hone_daily_briefs WHERE user_id=$1`,
		sharedpg.UUID(userID),
	).Scan(&t)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return time.Time{}, nil
		}
		return time.Time{}, fmt.Errorf("intelligence.DailyBriefs.LastForcedAt: %w", err)
	}
	if !t.Valid {
		return time.Time{}, nil
	}
	return t.Time, nil
}

// ─── interface guards ─────────────────────────────────────────────────────

var _ domain.DailyBriefRepo = (*DailyBriefs)(nil)
