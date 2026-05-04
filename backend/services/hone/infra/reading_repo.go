package infra

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"druz9/hone/domain"
	sharedpg "druz9/shared/pkg/pg"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ReadingRepoPG — Postgres impl of domain.ReadingRepo (Wave 4 of
// docs/feature/english.md). Sibling of PublishRepoPG / YjsRepoPG —
// same per-feature struct pattern.
type ReadingRepoPG struct {
	pool *pgxpool.Pool
}

// NewReadingRepo wraps a pgx pool.
func NewReadingRepo(pool *pgxpool.Pool) *ReadingRepoPG {
	return &ReadingRepoPG{pool: pool}
}

// Hand-rolled pgx — same convention as the
// other Hone sub-contexts (note_repo_quota.go, task_repo.go etc.):
// the SQL is hot-path-readable and small enough that a sqlc shim
// would dwarf the schema.
//
// SRS box-→-interval table. The values are deliberately conservative
// for early users — we'd rather overshow a card than lose retention
// to a too-aggressive schedule. Tunable later via dynamic_config.
//
// box 0 → 4h        (just-added, see again same day)
// box 1 → 1d        (next day)
// box 2 → 3d
// box 3 → 7d
// box 4 → 16d
// box 5 → graduated (LearnedAt set; not surfaced)
var srsIntervals = [6]time.Duration{
	4 * time.Hour,
	24 * time.Hour,
	3 * 24 * time.Hour,
	7 * 24 * time.Hour,
	16 * 24 * time.Hour,
	0, // graduated — caller stamps LearnedAt
}

// ── Materials ────────────────────────────────────────────────────

func (p *ReadingRepoPG) CreateMaterial(ctx context.Context, m domain.ReadingMaterial) (domain.ReadingMaterial, error) {
	if !m.SourceKind.IsValid() {
		return domain.ReadingMaterial{}, fmt.Errorf("hone.CreateMaterial: invalid source_kind %q", m.SourceKind)
	}
	totalChars := len([]rune(m.BodyMD))
	const q = `
		INSERT INTO hone_reading_materials (user_id, source_kind, source_url, title, body_md, total_chars, book_chapter, book_total_chapters)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
		RETURNING id, created_at, updated_at`
	var id pgtype.UUID
	var createdAt, updatedAt pgtype.Timestamptz
	var bookCh, bookTotal pgtype.Int4
	if m.BookChapter != nil {
		bookCh = pgtype.Int4{Int32: int32(*m.BookChapter), Valid: true}
	}
	if m.BookTotalChapters != nil {
		bookTotal = pgtype.Int4{Int32: int32(*m.BookTotalChapters), Valid: true}
	}
	err := p.pool.QueryRow(ctx, q,
		sharedpg.UUID(m.UserID), string(m.SourceKind), m.SourceURL, m.Title, m.BodyMD, totalChars,
		bookCh, bookTotal,
	).Scan(&id, &createdAt, &updatedAt)
	if err != nil {
		return domain.ReadingMaterial{}, fmt.Errorf("hone.CreateMaterial: %w", err)
	}
	m.ID = sharedpg.UUIDFrom(id)
	m.TotalChars = totalChars
	if createdAt.Valid {
		m.CreatedAt = createdAt.Time
	}
	if updatedAt.Valid {
		m.UpdatedAt = updatedAt.Time
	}
	return m, nil
}

func (p *ReadingRepoPG) GetMaterial(ctx context.Context, userID, materialID uuid.UUID) (domain.ReadingMaterial, error) {
	const q = `
		SELECT id, user_id, source_kind, source_url, title, body_md, total_chars,
		       book_chapter, book_total_chapters,
		       archived_at, created_at, updated_at
		FROM hone_reading_materials
		WHERE id = $1 AND user_id = $2`
	row := p.pool.QueryRow(ctx, q, sharedpg.UUID(materialID), sharedpg.UUID(userID))
	out, err := scanReadingMaterial(row)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.ReadingMaterial{}, fmt.Errorf("hone.GetMaterial: %w", domain.ErrNotFound)
		}
		return domain.ReadingMaterial{}, fmt.Errorf("hone.GetMaterial: %w", err)
	}
	return out, nil
}

func (p *ReadingRepoPG) ListMaterials(ctx context.Context, userID uuid.UUID, limit int) ([]domain.ReadingMaterial, error) {
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	const q = `
		SELECT id, user_id, source_kind, source_url, title, body_md, total_chars,
		       book_chapter, book_total_chapters,
		       archived_at, created_at, updated_at
		FROM hone_reading_materials
		WHERE user_id = $1 AND archived_at IS NULL
		ORDER BY created_at DESC
		LIMIT $2`
	rows, err := p.pool.Query(ctx, q, sharedpg.UUID(userID), limit)
	if err != nil {
		return nil, fmt.Errorf("hone.ListMaterials: %w", err)
	}
	defer rows.Close()
	out := make([]domain.ReadingMaterial, 0, 16)
	for rows.Next() {
		m, err := scanReadingMaterial(rows)
		if err != nil {
			return nil, fmt.Errorf("hone.ListMaterials: scan: %w", err)
		}
		out = append(out, m)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("hone.ListMaterials: iterate: %w", err)
	}
	return out, nil
}

func (p *ReadingRepoPG) UpdateBookProgress(
	ctx context.Context, userID, materialID uuid.UUID, chapter, total *int,
) (domain.ReadingMaterial, error) {
	var bookCh, bookTotal pgtype.Int4
	if chapter != nil {
		bookCh = pgtype.Int4{Int32: int32(*chapter), Valid: true}
	}
	if total != nil {
		bookTotal = pgtype.Int4{Int32: int32(*total), Valid: true}
	}
	const q = `
		UPDATE hone_reading_materials
		SET book_chapter = $3, book_total_chapters = $4, updated_at = now()
		WHERE id = $1 AND user_id = $2 AND archived_at IS NULL
		RETURNING id, user_id, source_kind, source_url, title, body_md, total_chars,
		          book_chapter, book_total_chapters, archived_at, created_at, updated_at`
	row := p.pool.QueryRow(ctx, q,
		sharedpg.UUID(materialID), sharedpg.UUID(userID), bookCh, bookTotal,
	)
	out, err := scanReadingMaterial(row)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.ReadingMaterial{}, fmt.Errorf("hone.UpdateBookProgress: %w", domain.ErrNotFound)
		}
		return domain.ReadingMaterial{}, fmt.Errorf("hone.UpdateBookProgress: %w", err)
	}
	return out, nil
}

func (p *ReadingRepoPG) ArchiveMaterial(ctx context.Context, userID, materialID uuid.UUID, now time.Time) error {
	tag, err := p.pool.Exec(ctx, `
		UPDATE hone_reading_materials
		SET archived_at = $1, updated_at = $1
		WHERE id = $2 AND user_id = $3 AND archived_at IS NULL`,
		pgtype.Timestamptz{Time: now, Valid: true}, sharedpg.UUID(materialID), sharedpg.UUID(userID),
	)
	if err != nil {
		return fmt.Errorf("hone.ArchiveMaterial: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("hone.ArchiveMaterial: %w", domain.ErrNotFound)
	}
	return nil
}

// ── Sessions ─────────────────────────────────────────────────────

func (p *ReadingRepoPG) StartSession(ctx context.Context, userID, materialID uuid.UUID) (domain.ReadingSession, error) {
	tx, err := p.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return domain.ReadingSession{}, fmt.Errorf("hone.StartSession: begin: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	// Capture chars_total at start so a later body edit doesn't
	// distort the «X% read» card. Verifies ownership in one go.
	var totalChars int
	if err := tx.QueryRow(ctx, `
		SELECT total_chars FROM hone_reading_materials
		WHERE id = $1 AND user_id = $2 AND archived_at IS NULL`,
		sharedpg.UUID(materialID), sharedpg.UUID(userID),
	).Scan(&totalChars); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.ReadingSession{}, fmt.Errorf("hone.StartSession: %w", domain.ErrNotFound)
		}
		return domain.ReadingSession{}, fmt.Errorf("hone.StartSession: material lookup: %w", err)
	}

	var (
		id        pgtype.UUID
		startedAt pgtype.Timestamptz
	)
	if err := tx.QueryRow(ctx, `
		INSERT INTO hone_reading_sessions (user_id, material_id, chars_total)
		VALUES ($1, $2, $3)
		RETURNING id, started_at`,
		sharedpg.UUID(userID), sharedpg.UUID(materialID), totalChars,
	).Scan(&id, &startedAt); err != nil {
		return domain.ReadingSession{}, fmt.Errorf("hone.StartSession: insert: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return domain.ReadingSession{}, fmt.Errorf("hone.StartSession: commit: %w", err)
	}
	out := domain.ReadingSession{
		ID:         sharedpg.UUIDFrom(id),
		UserID:     userID,
		MaterialID: materialID,
		CharsTotal: totalChars,
	}
	if startedAt.Valid {
		out.StartedAt = startedAt.Time
	}
	return out, nil
}

func (p *ReadingRepoPG) EndSession(ctx context.Context, userID, sessionID uuid.UUID, charsRead int, summaryMD string, now time.Time) error {
	if charsRead < 0 {
		charsRead = 0
	}
	tag, err := p.pool.Exec(ctx, `
		UPDATE hone_reading_sessions
		SET chars_read = $1, summary_md = $2, ended_at = $3
		WHERE id = $4 AND user_id = $5 AND ended_at IS NULL`,
		charsRead, summaryMD, pgtype.Timestamptz{Time: now, Valid: true},
		sharedpg.UUID(sessionID), sharedpg.UUID(userID),
	)
	if err != nil {
		return fmt.Errorf("hone.EndSession: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("hone.EndSession: %w", domain.ErrNotFound)
	}
	return nil
}

// GetSession scans a single hone_reading_sessions row scoped to the user.
// Used by the post-end grading path so the use case can return the row
// with ai_summary_score stamped, without re-running the EndSession write.
func (p *ReadingRepoPG) GetSession(ctx context.Context, userID, sessionID uuid.UUID) (domain.ReadingSession, error) {
	var (
		id, mid          pgtype.UUID
		charsRead, total int
		startedAt        pgtype.Timestamptz
		endedAt          pgtype.Timestamptz
		score            pgtype.Int4
		summaryMD        string
	)
	if err := p.pool.QueryRow(ctx, `
		SELECT id, material_id, chars_read, chars_total, started_at, ended_at, ai_summary_score, summary_md
		FROM hone_reading_sessions
		WHERE id = $1 AND user_id = $2`,
		sharedpg.UUID(sessionID), sharedpg.UUID(userID),
	).Scan(&id, &mid, &charsRead, &total, &startedAt, &endedAt, &score, &summaryMD); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.ReadingSession{}, fmt.Errorf("hone.GetSession: %w", domain.ErrNotFound)
		}
		return domain.ReadingSession{}, fmt.Errorf("hone.GetSession: %w", err)
	}
	out := domain.ReadingSession{
		ID:         sharedpg.UUIDFrom(id),
		UserID:     userID,
		MaterialID: sharedpg.UUIDFrom(mid),
		CharsRead:  charsRead,
		CharsTotal: total,
		SummaryMD:  summaryMD,
	}
	if startedAt.Valid {
		out.StartedAt = startedAt.Time
	}
	if endedAt.Valid {
		t := endedAt.Time
		out.EndedAt = &t
	}
	if score.Valid {
		v := int(score.Int32)
		out.AISummaryScore = &v
	}
	return out, nil
}

// SetAISummaryScore writes ai_summary_score for a session. Score is
// clamped to 0..100 here as a defence-in-depth check — the LLM grader
// is supposed to guarantee the range, but a buggy adapter shouldn't
// crash the CHECK constraint and leak a 5xx to the user.
func (p *ReadingRepoPG) SetAISummaryScore(ctx context.Context, userID, sessionID uuid.UUID, score int) error {
	if score < 0 {
		score = 0
	}
	if score > 100 {
		score = 100
	}
	tag, err := p.pool.Exec(ctx, `
		UPDATE hone_reading_sessions
		SET ai_summary_score = $1
		WHERE id = $2 AND user_id = $3`,
		score, sharedpg.UUID(sessionID), sharedpg.UUID(userID),
	)
	if err != nil {
		return fmt.Errorf("hone.SetAISummaryScore: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("hone.SetAISummaryScore: %w", domain.ErrNotFound)
	}
	return nil
}

// ── Vocab queue ─────────────────────────────────────────────────

func (p *ReadingRepoPG) ListVocabDue(ctx context.Context, userID uuid.UUID, now time.Time, limit int) ([]domain.VocabEntry, error) {
	if limit <= 0 || limit > 100 {
		limit = 20
	}
	rows, err := p.pool.Query(ctx, `
		SELECT user_id, word, translation, context_md, source_material,
		       box, next_review_at, reviewed_count, learned_at, created_at
		FROM hone_vocab_queue
		WHERE user_id = $1 AND learned_at IS NULL AND next_review_at <= $2
		ORDER BY next_review_at ASC
		LIMIT $3`,
		sharedpg.UUID(userID), pgtype.Timestamptz{Time: now, Valid: true}, limit,
	)
	if err != nil {
		return nil, fmt.Errorf("hone.ListVocabDue: %w", err)
	}
	defer rows.Close()
	out := make([]domain.VocabEntry, 0, 16)
	for rows.Next() {
		v, err := scanVocab(rows)
		if err != nil {
			return nil, fmt.Errorf("hone.ListVocabDue: scan: %w", err)
		}
		out = append(out, v)
	}
	return out, nil
}

// ListVocabBySourceMaterial — Wave 4.2 reverse cross-link. Returns every
// vocab entry whose source_material points to materialID, scoped by user.
// Used by the Hone reader sidebar to surface «words I saved from this
// material» without forcing the renderer to fetch + filter the whole
// vocab queue. Indexed lookup by source_material would be preferable for
// large queues; current schema doesn't have that idx but at typical user
// scale (a few hundred vocab rows max) sequential scan is fine.
func (p *ReadingRepoPG) ListVocabBySourceMaterial(ctx context.Context, userID, materialID uuid.UUID, limit int) ([]domain.VocabEntry, error) {
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	rows, err := p.pool.Query(ctx, `
		SELECT user_id, word, translation, context_md, source_material,
		       box, next_review_at, reviewed_count, learned_at, created_at
		FROM hone_vocab_queue
		WHERE user_id = $1 AND source_material = $2
		ORDER BY created_at DESC
		LIMIT $3`,
		sharedpg.UUID(userID), sharedpg.UUID(materialID), limit,
	)
	if err != nil {
		return nil, fmt.Errorf("hone.ListVocabBySourceMaterial: %w", err)
	}
	defer rows.Close()
	out := make([]domain.VocabEntry, 0, 16)
	for rows.Next() {
		v, err := scanVocab(rows)
		if err != nil {
			return nil, fmt.Errorf("hone.ListVocabBySourceMaterial: scan: %w", err)
		}
		out = append(out, v)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("hone.ListVocabBySourceMaterial: %w", err)
	}
	return out, nil
}

func (p *ReadingRepoPG) UpsertVocab(ctx context.Context, e domain.VocabEntry) (domain.VocabEntry, error) {
	if strings.TrimSpace(e.Word) == "" {
		return domain.VocabEntry{}, fmt.Errorf("hone.UpsertVocab: word required")
	}
	const q = `
		INSERT INTO hone_vocab_queue (user_id, word, translation, context_md, source_material)
		VALUES ($1, $2, $3, $4, $5)
		ON CONFLICT (user_id, word) DO UPDATE SET
		    translation = EXCLUDED.translation,
		    context_md  = EXCLUDED.context_md
		RETURNING user_id, word, translation, context_md, source_material,
		          box, next_review_at, reviewed_count, learned_at, created_at`
	var sourceArg any
	if e.SourceMaterial != nil {
		sourceArg = sharedpg.UUID(*e.SourceMaterial)
	}
	row := p.pool.QueryRow(ctx, q,
		sharedpg.UUID(e.UserID), e.Word, e.Translation, e.ContextMD, sourceArg,
	)
	out, err := scanVocab(row)
	if err != nil {
		return domain.VocabEntry{}, fmt.Errorf("hone.UpsertVocab: %w", err)
	}
	return out, nil
}

func (p *ReadingRepoPG) AdvanceVocab(ctx context.Context, userID uuid.UUID, word string, correct bool, now time.Time) (domain.VocabEntry, error) {
	tx, err := p.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return domain.VocabEntry{}, fmt.Errorf("hone.AdvanceVocab: begin: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	var current domain.VocabEntry
	row := tx.QueryRow(ctx, `
		SELECT user_id, word, translation, context_md, source_material,
		       box, next_review_at, reviewed_count, learned_at, created_at
		FROM hone_vocab_queue
		WHERE user_id = $1 AND word = $2
		FOR UPDATE`,
		sharedpg.UUID(userID), word,
	)
	current, err = scanVocab(row)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.VocabEntry{}, fmt.Errorf("hone.AdvanceVocab: %w", domain.ErrNotFound)
		}
		return domain.VocabEntry{}, fmt.Errorf("hone.AdvanceVocab: lookup: %w", err)
	}

	newBox := current.Box
	if correct {
		if newBox < 5 {
			newBox++
		}
	} else {
		newBox = 0 // demote to start of queue
	}
	var (
		nextReview pgtype.Timestamptz
		learnedAt  pgtype.Timestamptz
	)
	if newBox >= 5 {
		learnedAt = pgtype.Timestamptz{Time: now, Valid: true}
		// next_review_at irrelevant for graduated cards; clamp far
		// future so they sort to the end if some query forgets the
		// learned_at filter.
		nextReview = pgtype.Timestamptz{Time: now.Add(365 * 24 * time.Hour), Valid: true}
	} else {
		nextReview = pgtype.Timestamptz{Time: now.Add(srsIntervals[newBox]), Valid: true}
	}

	if _, err := tx.Exec(ctx, `
		UPDATE hone_vocab_queue
		SET box = $1,
		    next_review_at = $2,
		    learned_at = $3,
		    reviewed_count = reviewed_count + 1
		WHERE user_id = $4 AND word = $5`,
		newBox, nextReview, learnedAt,
		sharedpg.UUID(userID), word,
	); err != nil {
		return domain.VocabEntry{}, fmt.Errorf("hone.AdvanceVocab: update: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return domain.VocabEntry{}, fmt.Errorf("hone.AdvanceVocab: commit: %w", err)
	}

	current.Box = newBox
	current.NextReviewAt = nextReview.Time
	current.ReviewedCount++
	if learnedAt.Valid {
		t := learnedAt.Time
		current.LearnedAt = &t
	}
	return current, nil
}

// ── helpers ────────────────────────────────────────────────────

type readingScanner interface {
	Scan(dest ...any) error
}

func scanReadingMaterial(s readingScanner) (domain.ReadingMaterial, error) {
	var (
		id, userID pgtype.UUID
		archivedAt pgtype.Timestamptz
		createdAt  pgtype.Timestamptz
		updatedAt  pgtype.Timestamptz
		sourceKind string
		bookCh     pgtype.Int4
		bookTotal  pgtype.Int4
		out        domain.ReadingMaterial
	)
	if err := s.Scan(&id, &userID, &sourceKind, &out.SourceURL, &out.Title, &out.BodyMD,
		&out.TotalChars, &bookCh, &bookTotal, &archivedAt, &createdAt, &updatedAt); err != nil {
		return domain.ReadingMaterial{}, fmt.Errorf("hone.reading_repo.scanMaterial: %w", err)
	}
	out.ID = sharedpg.UUIDFrom(id)
	out.UserID = sharedpg.UUIDFrom(userID)
	out.SourceKind = domain.ReadingSourceKind(sourceKind)
	if bookCh.Valid {
		v := int(bookCh.Int32)
		out.BookChapter = &v
	}
	if bookTotal.Valid {
		v := int(bookTotal.Int32)
		out.BookTotalChapters = &v
	}
	if archivedAt.Valid {
		t := archivedAt.Time
		out.ArchivedAt = &t
	}
	if createdAt.Valid {
		out.CreatedAt = createdAt.Time
	}
	if updatedAt.Valid {
		out.UpdatedAt = updatedAt.Time
	}
	return out, nil
}

func scanVocab(s readingScanner) (domain.VocabEntry, error) {
	var (
		userID         pgtype.UUID
		sourceMaterial pgtype.UUID
		nextReview     pgtype.Timestamptz
		learnedAt      pgtype.Timestamptz
		createdAt      pgtype.Timestamptz
		out            domain.VocabEntry
	)
	if err := s.Scan(&userID, &out.Word, &out.Translation, &out.ContextMD,
		&sourceMaterial, &out.Box, &nextReview, &out.ReviewedCount,
		&learnedAt, &createdAt); err != nil {
		return domain.VocabEntry{}, fmt.Errorf("hone.reading_repo.scanVocab: %w", err)
	}
	out.UserID = sharedpg.UUIDFrom(userID)
	if sourceMaterial.Valid {
		id := sharedpg.UUIDFrom(sourceMaterial)
		out.SourceMaterial = &id
	}
	if nextReview.Valid {
		out.NextReviewAt = nextReview.Time
	}
	if learnedAt.Valid {
		t := learnedAt.Time
		out.LearnedAt = &t
	}
	if createdAt.Valid {
		out.CreatedAt = createdAt.Time
	}
	return out, nil
}
