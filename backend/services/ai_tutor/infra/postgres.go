// Package infra — Postgres adapters for AI-tutor domain.
//
// Hand-rolled pgx, не sqlc. Surface маленький, dynamic SQL минимален —
// прямые QueryRow/Exec проще читать чем generated code.
package infra

import (
	"context"
	"errors"
	"fmt"
	"time"

	"druz9/ai_tutor/domain"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Postgres satisfies all four repo interfaces (Persona, Thread, Episode,
// Fact) via one struct over the shared pool — same pattern как tutor.
type Postgres struct {
	pool *pgxpool.Pool
}

func NewPostgres(pool *pgxpool.Pool) *Postgres { return &Postgres{pool: pool} }

// ── helpers ─────────────────────────────────────────────────────────

func pgUUID(id uuid.UUID) pgtype.UUID {
	return pgtype.UUID{Bytes: id, Valid: id != uuid.Nil}
}

func uuidFrom(p pgtype.UUID) uuid.UUID {
	if !p.Valid {
		return uuid.Nil
	}
	return uuid.UUID(p.Bytes)
}

func nullableUUID(p pgtype.UUID) *uuid.UUID {
	if !p.Valid {
		return nil
	}
	id := uuid.UUID(p.Bytes)
	return &id
}

func nullableTime(p pgtype.Timestamptz) *time.Time {
	if !p.Valid {
		return nil
	}
	t := p.Time
	return &t
}

// ── Personas ───────────────────────────────────────────────────────

const personaCols = `id, slug, display_name, scope_track_kind::text, prompt_template, pace_per_week, llm_task_kind, active, ai_user_id, created_at, updated_at`

func scanPersona(row pgx.Row) (domain.Persona, error) {
	var (
		p         domain.Persona
		id        pgtype.UUID
		aiUserID  pgtype.UUID
		createdAt pgtype.Timestamptz
		updatedAt pgtype.Timestamptz
	)
	if err := row.Scan(&id, &p.Slug, &p.DisplayName, &p.ScopeTrackKind, &p.PromptTemplate,
		&p.PacePerWeek, &p.LLMTaskKind, &p.Active, &aiUserID, &createdAt, &updatedAt,
	); err != nil {
		return domain.Persona{}, fmt.Errorf("scanPersona: %w", err)
	}
	p.ID = uuidFrom(id)
	p.AIUserID = nullableUUID(aiUserID)
	if createdAt.Valid {
		p.CreatedAt = createdAt.Time
	}
	if updatedAt.Valid {
		p.UpdatedAt = updatedAt.Time
	}
	return p, nil
}

func (p *Postgres) GetBySlug(ctx context.Context, slug string) (domain.Persona, error) {
	q := `SELECT ` + personaCols + ` FROM ai_tutor_personas WHERE slug = $1`
	row := p.pool.QueryRow(ctx, q, slug)
	out, err := scanPersona(row)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.Persona{}, fmt.Errorf("ai_tutor.GetBySlug: %w", domain.ErrNotFound)
		}
		return domain.Persona{}, fmt.Errorf("ai_tutor.GetBySlug: %w", err)
	}
	return out, nil
}

func (p *Postgres) GetByID(ctx context.Context, id uuid.UUID) (domain.Persona, error) {
	q := `SELECT ` + personaCols + ` FROM ai_tutor_personas WHERE id = $1`
	row := p.pool.QueryRow(ctx, q, pgUUID(id))
	out, err := scanPersona(row)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.Persona{}, fmt.Errorf("ai_tutor.GetByID: %w", domain.ErrNotFound)
		}
		return domain.Persona{}, fmt.Errorf("ai_tutor.GetByID: %w", err)
	}
	return out, nil
}

func (p *Postgres) ListActive(ctx context.Context) ([]domain.Persona, error) {
	q := `SELECT ` + personaCols + ` FROM ai_tutor_personas WHERE active = true ORDER BY display_name ASC`
	rows, err := p.pool.Query(ctx, q)
	if err != nil {
		return nil, fmt.Errorf("ai_tutor.ListActive: %w", err)
	}
	defer rows.Close()
	out := make([]domain.Persona, 0, 8)
	for rows.Next() {
		row, err := scanPersona(rows)
		if err != nil {
			return nil, fmt.Errorf("ai_tutor.ListActive: %w", err)
		}
		out = append(out, row)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("ai_tutor.ListActive: %w", err)
	}
	return out, nil
}

// SetAIUserID — идемпотентно. UPDATE … WHERE id=$1 AND ai_user_id IS NULL
// — если уже populated, ничего не трогаем (тогда RowsAffected=0,
// что мы интерпретируем как «уже выставлено», ошибки нет).
func (p *Postgres) SetAIUserID(ctx context.Context, personaID, aiUserID uuid.UUID) error {
	_, err := p.pool.Exec(ctx, `
		UPDATE ai_tutor_personas
		SET ai_user_id = $2, updated_at = now()
		WHERE id = $1 AND ai_user_id IS NULL`,
		pgUUID(personaID), pgUUID(aiUserID),
	)
	if err != nil {
		return fmt.Errorf("ai_tutor.SetAIUserID: %w", err)
	}
	return nil
}

// ── Threads ───────────────────────────────────────────────────────

const threadCols = `id, student_id, persona_id, summary_md, message_count, last_compacted_at, daily_msg_count, daily_msg_reset_date, created_at, updated_at`

func scanThread(row pgx.Row) (domain.Thread, error) {
	var (
		t                        domain.Thread
		id, studentID, personaID pgtype.UUID
		lastCompacted            pgtype.Timestamptz
		dailyResetDate           pgtype.Date
		createdAt                pgtype.Timestamptz
		updatedAt                pgtype.Timestamptz
	)
	if err := row.Scan(&id, &studentID, &personaID, &t.SummaryMD, &t.MessageCount,
		&lastCompacted, &t.DailyMsgCount, &dailyResetDate, &createdAt, &updatedAt,
	); err != nil {
		return domain.Thread{}, fmt.Errorf("scanThread: %w", err)
	}
	t.ID = uuidFrom(id)
	t.StudentID = uuidFrom(studentID)
	t.PersonaID = uuidFrom(personaID)
	t.LastCompactedAt = nullableTime(lastCompacted)
	if dailyResetDate.Valid {
		t.DailyMsgResetDate = dailyResetDate.Time
	}
	if createdAt.Valid {
		t.CreatedAt = createdAt.Time
	}
	if updatedAt.Valid {
		t.UpdatedAt = updatedAt.Time
	}
	return t, nil
}

// CreateOrGet идемпотентно: INSERT … ON CONFLICT DO NOTHING + затем SELECT.
// Альтернатива (UPSERT с RETURNING) бросает 23505 на DO NOTHING без RETURNING,
// поэтому делаем 2 запроса в одной короткой транзакции.
func (p *Postgres) CreateOrGet(ctx context.Context, studentID, personaID uuid.UUID) (domain.Thread, error) {
	_, err := p.pool.Exec(ctx, `
		INSERT INTO ai_tutor_threads (student_id, persona_id)
		VALUES ($1, $2)
		ON CONFLICT (student_id, persona_id) DO NOTHING`,
		pgUUID(studentID), pgUUID(personaID),
	)
	if err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23503" {
			// FK violation — student или persona не существует.
			return domain.Thread{}, fmt.Errorf("ai_tutor.CreateOrGet: %w", domain.ErrInvalidInput)
		}
		return domain.Thread{}, fmt.Errorf("ai_tutor.CreateOrGet: %w", err)
	}
	q := `SELECT ` + threadCols + ` FROM ai_tutor_threads WHERE student_id = $1 AND persona_id = $2`
	row := p.pool.QueryRow(ctx, q, pgUUID(studentID), pgUUID(personaID))
	out, err := scanThread(row)
	if err != nil {
		return domain.Thread{}, fmt.Errorf("ai_tutor.CreateOrGet read: %w", err)
	}
	return out, nil
}

// GetThreadByID — ThreadRepo. Renamed (не GetByID) чтобы не клэшнуть с
// PersonaRepo.GetByID на одном *Postgres struct.
func (p *Postgres) GetThreadByID(ctx context.Context, id uuid.UUID) (domain.Thread, error) {
	q := `SELECT ` + threadCols + ` FROM ai_tutor_threads WHERE id = $1`
	row := p.pool.QueryRow(ctx, q, pgUUID(id))
	out, err := scanThread(row)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.Thread{}, fmt.Errorf("ai_tutor.GetThread: %w", domain.ErrNotFound)
		}
		return domain.Thread{}, fmt.Errorf("ai_tutor.GetThread: %w", err)
	}
	return out, nil
}

func (p *Postgres) ListThreadsByStudent(ctx context.Context, studentID uuid.UUID) ([]domain.Thread, error) {
	rows, _, err := p.listThreadsPaged(ctx, studentID, 0, "")
	return rows, err
}

// ListThreadsByStudentPaged — keyset cursor variant.
// Sort: updated_at DESC, id DESC. limit clamped to 1..200, default 50.
func (p *Postgres) ListThreadsByStudentPaged(
	ctx context.Context, studentID uuid.UUID, limit int, cursor string,
) ([]domain.Thread, string, error) {
	return p.listThreadsPaged(ctx, studentID, limit, cursor)
}

func (p *Postgres) listThreadsPaged(
	ctx context.Context, studentID uuid.UUID, limit int, cursor string,
) ([]domain.Thread, string, error) {
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	c, err := decodeAITutorCursor(cursor)
	if err != nil {
		return nil, "", fmt.Errorf("ai_tutor.ListThreadsByStudent: %w", err)
	}
	args := []any{pgUUID(studentID)}
	q := `SELECT ` + threadCols + ` FROM ai_tutor_threads WHERE student_id = $1`
	if !c.UpdatedAt.IsZero() {
		cid, parseErr := uuid.Parse(c.ID)
		if parseErr != nil {
			return nil, "", fmt.Errorf("ai_tutor.ListThreadsByStudent: cursor id: %w", parseErr)
		}
		args = append(args, c.UpdatedAt, pgUUID(cid))
		q += fmt.Sprintf(` AND (updated_at, id) < ($%d, $%d)`, len(args)-1, len(args))
	}
	args = append(args, limit+1) // peek+1
	q += fmt.Sprintf(` ORDER BY updated_at DESC, id DESC LIMIT $%d`, len(args))

	rows, err := p.pool.Query(ctx, q, args...)
	if err != nil {
		return nil, "", fmt.Errorf("ai_tutor.ListThreadsByStudent: %w", err)
	}
	defer rows.Close()
	out := make([]domain.Thread, 0, limit)
	for rows.Next() {
		t, scanErr := scanThread(rows)
		if scanErr != nil {
			return nil, "", fmt.Errorf("ai_tutor.ListThreadsByStudent: %w", scanErr)
		}
		out = append(out, t)
	}
	if err := rows.Err(); err != nil {
		return nil, "", fmt.Errorf("ai_tutor.ListThreadsByStudent: %w", err)
	}
	var nextCursor string
	if len(out) > limit {
		out = out[:limit]
		last := out[len(out)-1]
		nextCursor = encodeAITutorCursor(aiTutorCursor{
			UpdatedAt: last.UpdatedAt,
			ID:        last.ID.String(),
		})
	}
	return out, nextCursor, nil
}

// IncrementCounters — atomic. Если current_date > daily_msg_reset_date,
// сбрасываем daily на 1; иначе инкрементим. Если новый daily >= limit,
// возвращаем ErrRateLimited (но запись уже сделана — это интенционально:
// фронт получает feedback что лимит достигнут на ЭТОМ ходе).
func (p *Postgres) IncrementCounters(ctx context.Context, threadID uuid.UUID, now time.Time) (domain.Thread, error) {
	today := now.UTC().Truncate(24 * time.Hour)
	q := `
		UPDATE ai_tutor_threads
		SET message_count = message_count + 1,
		    daily_msg_count = CASE
		        WHEN daily_msg_reset_date < $2 THEN 1
		        ELSE daily_msg_count + 1
		    END,
		    daily_msg_reset_date = CASE
		        WHEN daily_msg_reset_date < $2 THEN $2
		        ELSE daily_msg_reset_date
		    END,
		    updated_at = now()
		WHERE id = $1
		RETURNING ` + threadCols
	row := p.pool.QueryRow(ctx, q, pgUUID(threadID),
		pgtype.Date{Time: today, Valid: true})
	out, err := scanThread(row)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.Thread{}, fmt.Errorf("ai_tutor.IncrementCounters: %w", domain.ErrNotFound)
		}
		return domain.Thread{}, fmt.Errorf("ai_tutor.IncrementCounters: %w", err)
	}
	if out.DailyMsgCount > domain.DailyMessageLimit {
		return out, domain.ErrRateLimited
	}
	return out, nil
}

func (p *Postgres) UpdateSummary(ctx context.Context, threadID uuid.UUID, summary string, now time.Time) error {
	_, err := p.pool.Exec(ctx, `
		UPDATE ai_tutor_threads
		SET summary_md = $2,
		    last_compacted_at = $3,
		    updated_at = $3
		WHERE id = $1`,
		pgUUID(threadID), summary,
		pgtype.Timestamptz{Time: now, Valid: true},
	)
	if err != nil {
		return fmt.Errorf("ai_tutor.UpdateSummary: %w", err)
	}
	return nil
}

// ── Episodes ───────────────────────────────────────────────────────

func (p *Postgres) Append(ctx context.Context, e domain.Episode) (domain.Episode, error) {
	if !e.Role.Valid() {
		return domain.Episode{}, fmt.Errorf("ai_tutor.Append: %w", domain.ErrInvalidInput)
	}
	const q = `
		INSERT INTO ai_tutor_episodes (thread_id, role, content, model_used, tokens_in, tokens_out)
		VALUES ($1, $2, $3, $4, $5, $6)
		RETURNING id, occurred_at`
	var (
		id         pgtype.UUID
		occurredAt pgtype.Timestamptz
	)
	if err := p.pool.QueryRow(ctx, q,
		pgUUID(e.ThreadID), string(e.Role), e.Content, e.ModelUsed, e.TokensIn, e.TokensOut,
	).Scan(&id, &occurredAt); err != nil {
		return domain.Episode{}, fmt.Errorf("ai_tutor.Append: %w", err)
	}
	e.ID = uuidFrom(id)
	if occurredAt.Valid {
		e.OccurredAt = occurredAt.Time
	}
	return e, nil
}

func (p *Postgres) ListRecent(ctx context.Context, threadID uuid.UUID, limit int) ([]domain.Episode, error) {
	if limit <= 0 || limit > 100 {
		limit = 20
	}
	// Подзапрос: берём last `limit` rows DESC, потом разворачиваем ASC
	// чтобы фронт/promp получил chronological order.
	const q = `
		SELECT id, thread_id, role, content, model_used, tokens_in, tokens_out, occurred_at
		FROM (
		  SELECT * FROM ai_tutor_episodes
		  WHERE thread_id = $1
		  ORDER BY occurred_at DESC
		  LIMIT $2
		) t ORDER BY occurred_at ASC`
	rows, err := p.pool.Query(ctx, q, pgUUID(threadID), limit)
	if err != nil {
		return nil, fmt.Errorf("ai_tutor.ListRecent: %w", err)
	}
	defer rows.Close()
	out := make([]domain.Episode, 0, limit)
	for rows.Next() {
		var (
			ep         domain.Episode
			id, tid    pgtype.UUID
			role       string
			occurredAt pgtype.Timestamptz
		)
		if err := rows.Scan(&id, &tid, &role, &ep.Content, &ep.ModelUsed,
			&ep.TokensIn, &ep.TokensOut, &occurredAt,
		); err != nil {
			return nil, fmt.Errorf("ai_tutor.ListRecent scan: %w", err)
		}
		ep.ID = uuidFrom(id)
		ep.ThreadID = uuidFrom(tid)
		ep.Role = domain.EpisodeRole(role)
		if occurredAt.Valid {
			ep.OccurredAt = occurredAt.Time
		}
		out = append(out, ep)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("ai_tutor.ListRecent: %w", err)
	}
	return out, nil
}

// CountSinceCompaction. since=nil → считаем все episodes.
func (p *Postgres) CountSinceCompaction(ctx context.Context, threadID uuid.UUID, since *time.Time) (int, error) {
	q := `SELECT count(*) FROM ai_tutor_episodes WHERE thread_id = $1`
	args := []any{pgUUID(threadID)}
	if since != nil {
		q += ` AND occurred_at > $2`
		args = append(args, pgtype.Timestamptz{Time: *since, Valid: true})
	}
	var n int
	if err := p.pool.QueryRow(ctx, q, args...).Scan(&n); err != nil {
		return 0, fmt.Errorf("ai_tutor.CountSinceCompaction: %w", err)
	}
	return n, nil
}

// ── Facts ──────────────────────────────────────────────────────────

func (p *Postgres) Upsert(ctx context.Context, f domain.Fact) (domain.Fact, error) {
	if f.ThreadID == uuid.Nil || f.Key == "" {
		return domain.Fact{}, fmt.Errorf("ai_tutor.Upsert: %w", domain.ErrInvalidInput)
	}
	var sourceArg pgtype.UUID
	if f.SourceEpisodeID != nil {
		sourceArg = pgUUID(*f.SourceEpisodeID)
	}
	const q = `
		INSERT INTO ai_tutor_facts (thread_id, fact_key, fact_value, confidence, source_episode_id, last_used_at)
		VALUES ($1, $2, $3, $4, $5, now())
		ON CONFLICT (thread_id, fact_key) DO UPDATE SET
		    fact_value = EXCLUDED.fact_value,
		    confidence = EXCLUDED.confidence,
		    source_episode_id = EXCLUDED.source_episode_id,
		    last_used_at = now()
		RETURNING id, last_used_at, created_at`
	var (
		id         pgtype.UUID
		lastUsedAt pgtype.Timestamptz
		createdAt  pgtype.Timestamptz
	)
	if err := p.pool.QueryRow(ctx, q,
		pgUUID(f.ThreadID), f.Key, f.Value, f.Confidence, sourceArg,
	).Scan(&id, &lastUsedAt, &createdAt); err != nil {
		return domain.Fact{}, fmt.Errorf("ai_tutor.Upsert: %w", err)
	}
	f.ID = uuidFrom(id)
	if lastUsedAt.Valid {
		f.LastUsedAt = lastUsedAt.Time
	}
	if createdAt.Valid {
		f.CreatedAt = createdAt.Time
	}
	return f, nil
}

func (p *Postgres) TopRanked(ctx context.Context, threadID uuid.UUID, limit int) ([]domain.Fact, error) {
	if limit <= 0 || limit > 50 {
		limit = 5
	}
	const q = `
		SELECT id, thread_id, fact_key, fact_value, confidence, source_episode_id, last_used_at, created_at
		FROM ai_tutor_facts
		WHERE thread_id = $1 AND confidence > 0
		ORDER BY confidence DESC, last_used_at DESC
		LIMIT $2`
	rows, err := p.pool.Query(ctx, q, pgUUID(threadID), limit)
	if err != nil {
		return nil, fmt.Errorf("ai_tutor.TopRanked: %w", err)
	}
	defer rows.Close()
	out := make([]domain.Fact, 0, limit)
	for rows.Next() {
		var (
			f          domain.Fact
			id, tid    pgtype.UUID
			source     pgtype.UUID
			lastUsedAt pgtype.Timestamptz
			createdAt  pgtype.Timestamptz
		)
		if err := rows.Scan(&id, &tid, &f.Key, &f.Value, &f.Confidence,
			&source, &lastUsedAt, &createdAt,
		); err != nil {
			return nil, fmt.Errorf("ai_tutor.TopRanked scan: %w", err)
		}
		f.ID = uuidFrom(id)
		f.ThreadID = uuidFrom(tid)
		f.SourceEpisodeID = nullableUUID(source)
		if lastUsedAt.Valid {
			f.LastUsedAt = lastUsedAt.Time
		}
		if createdAt.Valid {
			f.CreatedAt = createdAt.Time
		}
		out = append(out, f)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("ai_tutor.TopRanked: %w", err)
	}
	return out, nil
}

func (p *Postgres) TouchLastUsed(ctx context.Context, ids []uuid.UUID, now time.Time) error {
	if len(ids) == 0 {
		return nil
	}
	pgIDs := make([]pgtype.UUID, len(ids))
	for i, id := range ids {
		pgIDs[i] = pgUUID(id)
	}
	_, err := p.pool.Exec(ctx, `
		UPDATE ai_tutor_facts SET last_used_at = $2 WHERE id = ANY($1)`,
		pgIDs, pgtype.Timestamptz{Time: now, Valid: true},
	)
	if err != nil {
		return fmt.Errorf("ai_tutor.TouchLastUsed: %w", err)
	}
	return nil
}

func (p *Postgres) Delete(ctx context.Context, threadID uuid.UUID, key string) error {
	_, err := p.pool.Exec(ctx, `
		DELETE FROM ai_tutor_facts WHERE thread_id = $1 AND fact_key = $2`,
		pgUUID(threadID), key,
	)
	if err != nil {
		return fmt.Errorf("ai_tutor.DeleteFact: %w", err)
	}
	return nil
}

// ─── ProcessedMockGuard (idempotency for OnFailedMock subscriber) ────────

// ReserveProcessedMock пытается зарегистрировать (session_id, persona_id)
// в ai_tutor_processed_mocks (миграция 00039). ON CONFLICT DO NOTHING —
// атомарная reserve-or-skip семантика. Возвращает true если row реально
// вставлена (мы первые на этой паре); false — кто-то уже обработал.
func (p *Postgres) ReserveProcessedMock(ctx context.Context, sessionID, personaID uuid.UUID) (bool, error) {
	tag, err := p.pool.Exec(ctx,
		`INSERT INTO ai_tutor_processed_mocks (session_id, persona_id)
		 VALUES ($1, $2) ON CONFLICT DO NOTHING`,
		pgUUID(sessionID), pgUUID(personaID),
	)
	if err != nil {
		return false, fmt.Errorf("ai_tutor.ReserveProcessedMock: %w", err)
	}
	return tag.RowsAffected() > 0, nil
}
