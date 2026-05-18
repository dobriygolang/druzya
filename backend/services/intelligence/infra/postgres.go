// Package infra — Postgres repos + LLM adapters for the intelligence
// service. Hand-rolled pgx (matches hone/whiteboard_rooms style — sqlc
// migration is unfinished elsewhere; consistency wins over zealotry).
package infra

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
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
	BriefID         string                  `json:"brief_id,omitempty"`
	Headline        string                  `json:"headline"`
	Narrative       string                  `json:"narrative"`
	Recommendations []recommendationPayload `json:"recommendations"`
	// severity wire. Empty string in legacy rows = treat as cruise on read.
	Severity       string `json:"severity,omitempty"`
	SeverityReason string `json:"severity_reason,omitempty"`
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
		BriefID:        uuidOrNil(p.BriefID),
		Headline:       p.Headline,
		Narrative:      p.Narrative,
		GeneratedAt:    generatedAt,
		Severity:       severityFromPayload(p.Severity),
		SeverityReason: p.SeverityReason,
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

// severityFromPayload — пустая строка в payload (legacy rows) = cruise;
// невалидное значение тоже = cruise (мы не хотим UNSPECIFIED в кеше,
// фронт опирается на one-of-four).
func severityFromPayload(s string) domain.InsightSeverity {
	sev := domain.InsightSeverity(s)
	if sev.IsValid() {
		return sev
	}
	return domain.InsightSeverityCruise
}

// RecentForUser feeds the Hone /coach view: briefs за последние sinceDays
// дней, newest first. Limit hard-capped в caller'е.
//
// payload jsonb mapping: briefPayload struct (см. выше) — те же поля
// что и в GetForDate, плюс severity / severity_reason для UI окраски.
func (r *DailyBriefs) RecentForUser(ctx context.Context, userID uuid.UUID, sinceDays, limit int) ([]domain.DailyBrief, error) {
	if sinceDays <= 0 {
		sinceDays = 30
	}
	if limit <= 0 || limit > 60 {
		limit = 30
	}
	rows, err := r.pool.Query(ctx,
		`SELECT brief_date, payload, generated_at
		   FROM hone_daily_briefs
		  WHERE user_id  = $1
		    AND brief_date >= CURRENT_DATE - ($2 || ' days')::interval
		  ORDER BY brief_date DESC
		  LIMIT $3`,
		sharedpg.UUID(userID), fmt.Sprintf("%d", sinceDays), int32(limit),
	)
	if err != nil {
		return nil, fmt.Errorf("intelligence.DailyBriefs.RecentForUser: %w", err)
	}
	defer rows.Close()
	out := make([]domain.DailyBrief, 0, limit)
	for rows.Next() {
		var (
			briefDate   time.Time
			raw         []byte
			generatedAt time.Time
		)
		if err := rows.Scan(&briefDate, &raw, &generatedAt); err != nil {
			return nil, fmt.Errorf("intelligence.DailyBriefs.RecentForUser: scan: %w", err)
		}
		var p briefPayload
		if err := json.Unmarshal(raw, &p); err != nil {
			// Skip битые row'ы а не валим весь запрос — feed не критичен.
			continue
		}
		brief := domain.DailyBrief{
			BriefID:        uuidOrNil(p.BriefID),
			Headline:       p.Headline,
			Narrative:      p.Narrative,
			GeneratedAt:    generatedAt,
			Severity:       severityFromPayload(p.Severity),
			SeverityReason: p.SeverityReason,
		}
		for _, rec := range p.Recommendations {
			brief.Recommendations = append(brief.Recommendations, domain.Recommendation{
				Kind:      domain.RecommendationKind(rec.Kind),
				Title:     rec.Title,
				Rationale: rec.Rationale,
				TargetID:  rec.TargetID,
			})
		}
		out = append(out, brief)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("intelligence.DailyBriefs.RecentForUser: rows: %w", err)
	}
	return out, nil
}

// Upsert replaces the brief for (user, date).
func (r *DailyBriefs) Upsert(ctx context.Context, userID uuid.UUID, date time.Time, b domain.DailyBrief) error {
	p := briefPayload{
		Headline:       b.Headline,
		Narrative:      b.Narrative,
		Severity:       string(b.Severity),
		SeverityReason: b.SeverityReason,
	}
	if b.BriefID != uuid.Nil {
		p.BriefID = b.BriefID.String()
	}
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

func uuidOrNil(s string) uuid.UUID {
	id, err := uuid.Parse(strings.TrimSpace(s))
	if err != nil {
		return uuid.Nil
	}
	return id
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
