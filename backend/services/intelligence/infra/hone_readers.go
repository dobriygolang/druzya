// Reader adapters (raw SQL, no hone import) — Hone-domain signals
// (focus sessions, daily plan items, notes) consumed by the daily-brief
// prompt. Implementations live in intelligence/infra so the
// intelligence-domain never imports hone-infra.
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

// FocusReader implements domain.FocusReader через hone_focus_sessions.
//
// Раньше читал из hone_streak_days и брал sessions_count → метил его как
// `pomodoros` в LLM-prompt'е. sessions_count = «сколько раз нажал Start»,
// НЕ pomodoros (25-min completed units). Юзер 10 раз начинал и сразу
// останавливал — coach писал «10 pomodoros completed». Bullshit.
//
// Сейчас: SUM(pomodoros_completed) из реальных focus_sessions + фильтр
// seconds_focused >= 60 чтобы insta-stop сессии не загрязняли картину.
type FocusReader struct{ pool *pgxpool.Pool }

// NewFocusReader wraps a pool.
func NewFocusReader(pool *pgxpool.Pool) *FocusReader { return &FocusReader{pool: pool} }

func (r *FocusReader) LastNDays(ctx context.Context, userID uuid.UUID, n int) ([]domain.FocusDay, error) {
	if n <= 0 || n > 60 {
		n = 7
	}
	rows, err := r.pool.Query(ctx,
		`SELECT date_trunc('day', started_at)::date AS day,
		        COALESCE(SUM(seconds_focused), 0)::int    AS seconds,
		        COALESCE(SUM(pomodoros_completed), 0)::int AS pomodoros
		   FROM hone_focus_sessions
		  WHERE user_id=$1
		    AND started_at >= CURRENT_DATE - $2::int
		    AND ended_at IS NOT NULL
		    AND seconds_focused >= 60
		  GROUP BY date_trunc('day', started_at)
		  ORDER BY day ASC`,
		sharedpg.UUID(userID), n,
	)
	if err != nil {
		return nil, fmt.Errorf("intelligence.FocusReader.LastNDays: %w", err)
	}
	defer rows.Close()
	out := make([]domain.FocusDay, 0, n)
	for rows.Next() {
		var (
			day       time.Time
			seconds   int32
			pomodoros int32
		)
		if err := rows.Scan(&day, &seconds, &pomodoros); err != nil {
			return nil, fmt.Errorf("intelligence.FocusReader.LastNDays: scan: %w", err)
		}
		out = append(out, domain.FocusDay{
			Day:       day,
			Seconds:   int(seconds),
			Pomodoros: int(pomodoros),
		})
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("intelligence.FocusReader.LastNDays: rows: %w", err)
	}
	return out, nil
}

// PlanReader implements domain.PlanReader через hone_daily_plans.items jsonb.
type PlanReader struct{ pool *pgxpool.Pool }

// NewPlanReader wraps a pool.
func NewPlanReader(pool *pgxpool.Pool) *PlanReader { return &PlanReader{pool: pool} }

func (r *PlanReader) SkippedItems(ctx context.Context, userID uuid.UUID, since time.Time) ([]domain.SkippedPlanItem, error) {
	return r.scanItems(ctx, userID, since, true)
}

func (r *PlanReader) CompletedItems(ctx context.Context, userID uuid.UUID, since time.Time) ([]domain.CompletedPlanItem, error) {
	skipped, err := r.scanItems(ctx, userID, since, false)
	if err != nil {
		return nil, err
	}
	out := make([]domain.CompletedPlanItem, 0, len(skipped))
	for _, s := range skipped {
		out = append(out, domain.CompletedPlanItem(s))
	}
	return out, nil
}

// scanItems walks plan_date >= since и фильтрует items по флагу
// dismissed (true) или completed (true) в зависимости от skipped.
//
// Implementation note: items — jsonb-array, поэтому распаковываем в Go,
// а не в SQL (jsonb_array_elements + ->> filtering работает, но плодит
// query'ю на 5 строк — на ~hundreds of plan rows in 14 day window это не
// узкое место).
func (r *PlanReader) scanItems(
	ctx context.Context,
	userID uuid.UUID,
	since time.Time,
	skippedNotCompleted bool,
) ([]domain.SkippedPlanItem, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT plan_date, items
		   FROM hone_daily_plans
		  WHERE user_id=$1 AND plan_date >= $2`,
		sharedpg.UUID(userID), pgtype.Date{Time: since, Valid: true},
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, fmt.Errorf("intelligence.PlanReader.scanItems: %w", err)
	}
	defer rows.Close()

	type rawItem struct {
		ID        string `json:"ID"`
		Title     string `json:"Title"`
		SkillKey  string `json:"SkillKey"`
		Dismissed bool   `json:"Dismissed"`
		Completed bool   `json:"Completed"`
	}

	out := make([]domain.SkippedPlanItem, 0, 16)
	for rows.Next() {
		var (
			planDate time.Time
			rawItems []byte
		)
		if err := rows.Scan(&planDate, &rawItems); err != nil {
			return nil, fmt.Errorf("intelligence.PlanReader.scanItems: scan: %w", err)
		}
		var items []rawItem
		if err := unmarshalJSONLenient(rawItems, &items); err != nil {
			// Skip malformed rows — better than aborting whole reader.
			continue
		}
		for _, it := range items {
			if skippedNotCompleted && !it.Dismissed {
				continue
			}
			if !skippedNotCompleted && !it.Completed {
				continue
			}
			out = append(out, domain.SkippedPlanItem{
				ItemID:   it.ID,
				Title:    it.Title,
				SkillKey: it.SkillKey,
				PlanDate: planDate,
			})
		}
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("intelligence.PlanReader.scanItems: rows: %w", err)
	}
	return out, nil
}

// NotesReader implements domain.NotesReader через hone_notes.
type NotesReader struct{ pool *pgxpool.Pool }

// NewNotesReader wraps a pool.
func NewNotesReader(pool *pgxpool.Pool) *NotesReader { return &NotesReader{pool: pool} }

// reflectionPattern — note titles стилизованные «… — YYYY-MM-DD».
// Просим Postgres матчить по regex, чтобы не хайдратить весь корпус.
const reflectionPattern = `[[:space:]]—[[:space:]]\d{4}-\d{2}-\d{2}$`

func (r *NotesReader) RecentReflections(ctx context.Context, userID uuid.UUID, limit int) ([]domain.Reflection, error) {
	if limit <= 0 || limit > 50 {
		limit = 5
	}
	// Same temporal/encryption filters as RecentNotes — coach should not
	// surface reflections that are weeks old or that the server cannot read.
	rows, err := r.pool.Query(ctx,
		`SELECT id, title, body_md, created_at
		   FROM hone_notes
		  WHERE user_id=$1 AND title ~ $2
		    AND COALESCE(encrypted, false) = false
		    AND created_at >= now() - interval '30 days'
		  ORDER BY created_at DESC
		  LIMIT $3`,
		sharedpg.UUID(userID), reflectionPattern, int32(limit),
	)
	if err != nil {
		return nil, fmt.Errorf("intelligence.NotesReader.RecentReflections: %w", err)
	}
	defer rows.Close()
	out := make([]domain.Reflection, 0, limit)
	for rows.Next() {
		var (
			id        pgtype.UUID
			title     string
			body      string
			createdAt time.Time
		)
		if err := rows.Scan(&id, &title, &body, &createdAt); err != nil {
			return nil, fmt.Errorf("intelligence.NotesReader.RecentReflections: scan: %w", err)
		}
		// EndFocusSession пишет body как «<reflection>\n\n---\nSession: …».
		// Берём фрагмент до разделителя.
		head := body
		if idx := indexOfDivider(head); idx > 0 {
			head = head[:idx]
		}
		if len(head) > 240 {
			head = head[:240] + "…"
		}
		out = append(out, domain.Reflection{
			NoteID:    sharedpg.UUIDFrom(id),
			Title:     title,
			BodyHead:  head,
			CreatedAt: createdAt,
		})
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("intelligence.NotesReader.RecentReflections: rows: %w", err)
	}
	return out, nil
}

func (r *NotesReader) RecentNotes(ctx context.Context, userID uuid.UUID, limit int) ([]domain.NoteHead, error) {
	if limit <= 0 || limit > 50 {
		limit = 5
	}
	// Coach retrieval window: last 7 days only — older notes lead to stale,
	// off-topic recommendations. Encrypted notes are excluded (server can't
	// read the plaintext to summarise / cite).
	rows, err := r.pool.Query(ctx,
		`SELECT id, title, LEFT(body_md, 220), updated_at
		   FROM hone_notes
		  WHERE user_id=$1
		    AND COALESCE(encrypted, false) = false
		    AND updated_at >= now() - interval '7 days'
		  ORDER BY updated_at DESC
		  LIMIT $2`,
		sharedpg.UUID(userID), int32(limit),
	)
	if err != nil {
		return nil, fmt.Errorf("intelligence.NotesReader.RecentNotes: %w", err)
	}
	defer rows.Close()
	out := make([]domain.NoteHead, 0, limit)
	for rows.Next() {
		var (
			id        pgtype.UUID
			title     string
			excerpt   string
			updatedAt time.Time
		)
		if err := rows.Scan(&id, &title, &excerpt, &updatedAt); err != nil {
			return nil, fmt.Errorf("intelligence.NotesReader.RecentNotes: scan: %w", err)
		}
		out = append(out, domain.NoteHead{
			NoteID:    sharedpg.UUIDFrom(id),
			Title:     title,
			Excerpt:   excerpt,
			UpdatedAt: updatedAt,
		})
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("intelligence.NotesReader.RecentNotes: rows: %w", err)
	}
	return out, nil
}

func (r *NotesReader) EmbeddedCorpus(ctx context.Context, userID uuid.UUID) ([]domain.NoteEmbedding, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT id, title, LEFT(body_md, 2048), LEFT(body_md, 140), embedding
		   FROM hone_notes
		  WHERE user_id=$1 AND embedding IS NOT NULL`,
		sharedpg.UUID(userID),
	)
	if err != nil {
		return nil, fmt.Errorf("intelligence.NotesReader.EmbeddedCorpus: %w", err)
	}
	defer rows.Close()
	out := make([]domain.NoteEmbedding, 0, 32)
	for rows.Next() {
		var (
			id        pgtype.UUID
			title     string
			body      string
			snippet   string
			embedding []float32
		)
		if err := rows.Scan(&id, &title, &body, &snippet, &embedding); err != nil {
			return nil, fmt.Errorf("intelligence.NotesReader.EmbeddedCorpus: scan: %w", err)
		}
		out = append(out, domain.NoteEmbedding{
			NoteID:    sharedpg.UUIDFrom(id),
			Title:     title,
			Body:      body,
			Snippet:   snippet,
			Embedding: embedding,
		})
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("intelligence.NotesReader.EmbeddedCorpus: rows: %w", err)
	}
	return out, nil
}

// indexOfDivider returns the index of "\n---" (the EndFocusSession reflection
// divider) or -1 when absent.
func indexOfDivider(body string) int {
	const div = "\n\n---\n"
	if idx := indexOf(body, div); idx >= 0 {
		return idx
	}
	return -1
}

func indexOf(haystack, needle string) int {
	hl, nl := len(haystack), len(needle)
	if nl == 0 || nl > hl {
		return -1
	}
	for i := 0; i+nl <= hl; i++ {
		if haystack[i:i+nl] == needle {
			return i
		}
	}
	return -1
}

// unmarshalJSONLenient — пытается json.Unmarshal; ошибка не валит вызовущий
// loop (silent-skip для одного плохого ряда плана).
func unmarshalJSONLenient(raw []byte, v any) error {
	if len(raw) == 0 {
		return nil
	}
	return jsonUnmarshal(raw, v)
}

// jsonUnmarshal — однострочная индирекция; оборачиваем ошибку для wrapcheck.
func jsonUnmarshal(raw []byte, v any) error {
	if err := json.Unmarshal(raw, v); err != nil {
		return fmt.Errorf("json.Unmarshal: %w", err)
	}
	return nil
}
