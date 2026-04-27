package intelligence

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	intelDomain "druz9/intelligence/domain"
	sharedpg "druz9/shared/pkg/pg"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ─── Reader adapters (raw SQL, no hone import) ────────────────────────────

// intelFocusReader реализует intelDomain.FocusReader через hone_focus_sessions.
//
// Раньше читал из hone_streak_days и брал sessions_count → метил его как
// `pomodoros` в LLM-prompt'е. sessions_count = «сколько раз нажал Start»,
// НЕ pomodoros (25-min completed units). Юзер 10 раз начинал и сразу
// останавливал — coach писал «10 pomodoros completed». Bullshit.
//
// Сейчас: SUM(pomodoros_completed) из реальных focus_sessions + фильтр
// seconds_focused >= 60 чтобы insta-stop сессии не загрязняли картину.
type intelFocusReader struct{ pool *pgxpool.Pool }

func (r *intelFocusReader) LastNDays(ctx context.Context, userID uuid.UUID, n int) ([]intelDomain.FocusDay, error) {
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
		return nil, fmt.Errorf("intelligence.intelFocusReader.LastNDays: %w", err)
	}
	defer rows.Close()
	out := make([]intelDomain.FocusDay, 0, n)
	for rows.Next() {
		var (
			day       time.Time
			seconds   int32
			pomodoros int32
		)
		if err := rows.Scan(&day, &seconds, &pomodoros); err != nil {
			return nil, fmt.Errorf("intelligence.intelFocusReader.LastNDays: scan: %w", err)
		}
		out = append(out, intelDomain.FocusDay{
			Day:       day,
			Seconds:   int(seconds),
			Pomodoros: int(pomodoros),
		})
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("intelligence.intelFocusReader.LastNDays: rows: %w", err)
	}
	return out, nil
}

// intelPlanReader реализует intelDomain.PlanReader через hone_daily_plans.items jsonb.
type intelPlanReader struct{ pool *pgxpool.Pool }

func (r *intelPlanReader) SkippedItems(ctx context.Context, userID uuid.UUID, since time.Time) ([]intelDomain.SkippedPlanItem, error) {
	return r.scanItems(ctx, userID, since, true)
}

func (r *intelPlanReader) CompletedItems(ctx context.Context, userID uuid.UUID, since time.Time) ([]intelDomain.CompletedPlanItem, error) {
	skipped, err := r.scanItems(ctx, userID, since, false)
	if err != nil {
		return nil, err
	}
	out := make([]intelDomain.CompletedPlanItem, 0, len(skipped))
	for _, s := range skipped {
		out = append(out, intelDomain.CompletedPlanItem(s))
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
func (r *intelPlanReader) scanItems(
	ctx context.Context,
	userID uuid.UUID,
	since time.Time,
	skippedNotCompleted bool,
) ([]intelDomain.SkippedPlanItem, error) {
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
		return nil, fmt.Errorf("intelligence.intelPlanReader.scanItems: %w", err)
	}
	defer rows.Close()

	type rawItem struct {
		ID        string `json:"ID"`
		Title     string `json:"Title"`
		SkillKey  string `json:"SkillKey"`
		Dismissed bool   `json:"Dismissed"`
		Completed bool   `json:"Completed"`
	}

	out := make([]intelDomain.SkippedPlanItem, 0, 16)
	for rows.Next() {
		var (
			planDate time.Time
			rawItems []byte
		)
		if err := rows.Scan(&planDate, &rawItems); err != nil {
			return nil, fmt.Errorf("intelligence.intelPlanReader.scanItems: scan: %w", err)
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
			out = append(out, intelDomain.SkippedPlanItem{
				ItemID:   it.ID,
				Title:    it.Title,
				SkillKey: it.SkillKey,
				PlanDate: planDate,
			})
		}
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("intelligence.intelPlanReader.scanItems: rows: %w", err)
	}
	return out, nil
}

// intelNotesReader реализует intelDomain.NotesReader через hone_notes.
type intelNotesReader struct{ pool *pgxpool.Pool }

// reflectionPattern — note titles стилизованные «… — YYYY-MM-DD».
// Просим Postgres матчить по regex, чтобы не хайдратить весь корпус.
const reflectionPattern = `[[:space:]]—[[:space:]]\d{4}-\d{2}-\d{2}$`

func (r *intelNotesReader) RecentReflections(ctx context.Context, userID uuid.UUID, limit int) ([]intelDomain.Reflection, error) {
	if limit <= 0 || limit > 50 {
		limit = 5
	}
	rows, err := r.pool.Query(ctx,
		`SELECT id, title, body_md, created_at
		   FROM hone_notes
		  WHERE user_id=$1 AND title ~ $2
		  ORDER BY created_at DESC
		  LIMIT $3`,
		sharedpg.UUID(userID), reflectionPattern, int32(limit),
	)
	if err != nil {
		return nil, fmt.Errorf("intelligence.intelNotesReader.RecentReflections: %w", err)
	}
	defer rows.Close()
	out := make([]intelDomain.Reflection, 0, limit)
	for rows.Next() {
		var (
			id        pgtype.UUID
			title     string
			body      string
			createdAt time.Time
		)
		if err := rows.Scan(&id, &title, &body, &createdAt); err != nil {
			return nil, fmt.Errorf("intelligence.intelNotesReader.RecentReflections: scan: %w", err)
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
		out = append(out, intelDomain.Reflection{
			NoteID:    sharedpg.UUIDFrom(id),
			Title:     title,
			BodyHead:  head,
			CreatedAt: createdAt,
		})
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("intelligence.intelNotesReader.RecentReflections: rows: %w", err)
	}
	return out, nil
}

func (r *intelNotesReader) RecentNotes(ctx context.Context, userID uuid.UUID, limit int) ([]intelDomain.NoteHead, error) {
	if limit <= 0 || limit > 50 {
		limit = 5
	}
	rows, err := r.pool.Query(ctx,
		`SELECT id, title, LEFT(body_md, 220), updated_at
		   FROM hone_notes
		  WHERE user_id=$1
		  ORDER BY updated_at DESC
		  LIMIT $2`,
		sharedpg.UUID(userID), int32(limit),
	)
	if err != nil {
		return nil, fmt.Errorf("intelligence.intelNotesReader.RecentNotes: %w", err)
	}
	defer rows.Close()
	out := make([]intelDomain.NoteHead, 0, limit)
	for rows.Next() {
		var (
			id        pgtype.UUID
			title     string
			excerpt   string
			updatedAt time.Time
		)
		if err := rows.Scan(&id, &title, &excerpt, &updatedAt); err != nil {
			return nil, fmt.Errorf("intelligence.intelNotesReader.RecentNotes: scan: %w", err)
		}
		out = append(out, intelDomain.NoteHead{
			NoteID:    sharedpg.UUIDFrom(id),
			Title:     title,
			Excerpt:   excerpt,
			UpdatedAt: updatedAt,
		})
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("intelligence.intelNotesReader.RecentNotes: rows: %w", err)
	}
	return out, nil
}

func (r *intelNotesReader) EmbeddedCorpus(ctx context.Context, userID uuid.UUID) ([]intelDomain.NoteEmbedding, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT id, title, LEFT(body_md, 2048), LEFT(body_md, 140), embedding
		   FROM hone_notes
		  WHERE user_id=$1 AND embedding IS NOT NULL`,
		sharedpg.UUID(userID),
	)
	if err != nil {
		return nil, fmt.Errorf("intelligence.intelNotesReader.EmbeddedCorpus: %w", err)
	}
	defer rows.Close()
	out := make([]intelDomain.NoteEmbedding, 0, 32)
	for rows.Next() {
		var (
			id        pgtype.UUID
			title     string
			body      string
			snippet   string
			embedding []float32
		)
		if err := rows.Scan(&id, &title, &body, &snippet, &embedding); err != nil {
			return nil, fmt.Errorf("intelligence.intelNotesReader.EmbeddedCorpus: scan: %w", err)
		}
		out = append(out, intelDomain.NoteEmbedding{
			NoteID:    sharedpg.UUIDFrom(id),
			Title:     title,
			Body:      body,
			Snippet:   snippet,
			Embedding: embedding,
		})
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("intelligence.intelNotesReader.EmbeddedCorpus: rows: %w", err)
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
