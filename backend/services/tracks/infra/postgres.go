// Package infra — pgx adapter for the tracks bounded context.
package infra

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	sharedpg "druz9/shared/pkg/pg"
	"druz9/tracks/domain"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Postgres implements both CatalogRepo and MembershipRepo over the
// 00007_tracks.sql schema. Two ports, one struct: the cross-port
// queries (e.g. ListByUser joins on tracks) stay in one file.
type Postgres struct{ pool *pgxpool.Pool }

// NewPostgres wires the adapter.
func NewPostgres(pool *pgxpool.Pool) *Postgres {
	if pool == nil {
		panic("tracks/infra.NewPostgres: nil pool")
	}
	return &Postgres{pool: pool}
}

const trackCols = `id, slug, name, tagline, description_md,
    cover_image_url, accent_color, curator_id,
    estimated_weeks, difficulty, is_curated, is_active,
    tags, company_focus, created_at, updated_at`

const stepCols = `track_id, step_index, title, description_md,
    skill_keys, required_kind::text, required_count,
    recommended_reading, estimated_minutes,
    checkpoint_skill_keys, reflection_required,
    COALESCE(graduation_mock_section, '')`

// ── CatalogRepo ──────────────────────────────────────────────────────────

// ListActive returns active tracks ordered by name. Curated set is
// small enough to skip pagination today.
func (r *Postgres) ListActive(ctx context.Context) ([]domain.Track, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT `+trackCols+` FROM tracks WHERE is_active = TRUE ORDER BY name ASC`)
	if err != nil {
		return nil, fmt.Errorf("tracks.Postgres.ListActive: %w", err)
	}
	defer rows.Close()
	out := make([]domain.Track, 0, 8)
	for rows.Next() {
		t, err := scanTrack(rows)
		if err != nil {
			return nil, fmt.Errorf("tracks.Postgres.ListActive: scan: %w", err)
		}
		out = append(out, t)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("tracks.Postgres.ListActive: rows: %w", err)
	}
	return out, nil
}

// GetBySlug — track row + ordered steps.
func (r *Postgres) GetBySlug(ctx context.Context, slug string) (domain.TrackWithSteps, error) {
	row := r.pool.QueryRow(ctx,
		`SELECT `+trackCols+` FROM tracks WHERE slug = $1 AND is_active = TRUE`, slug)
	t, err := scanTrack(row)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.TrackWithSteps{}, domain.ErrNotFound
		}
		return domain.TrackWithSteps{}, fmt.Errorf("tracks.Postgres.GetBySlug: %w", err)
	}
	steps, err := r.fetchSteps(ctx, t.ID)
	if err != nil {
		return domain.TrackWithSteps{}, err
	}
	return domain.TrackWithSteps{Track: t, Steps: steps}, nil
}

// GetByID — same fetch, keyed by uuid.
func (r *Postgres) GetByID(ctx context.Context, id uuid.UUID) (domain.TrackWithSteps, error) {
	row := r.pool.QueryRow(ctx,
		`SELECT `+trackCols+` FROM tracks WHERE id = $1`, sharedpg.UUID(id))
	t, err := scanTrack(row)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.TrackWithSteps{}, domain.ErrNotFound
		}
		return domain.TrackWithSteps{}, fmt.Errorf("tracks.Postgres.GetByID: %w", err)
	}
	steps, err := r.fetchSteps(ctx, t.ID)
	if err != nil {
		return domain.TrackWithSteps{}, err
	}
	return domain.TrackWithSteps{Track: t, Steps: steps}, nil
}

func (r *Postgres) fetchSteps(ctx context.Context, trackID uuid.UUID) ([]domain.Step, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT `+stepCols+` FROM track_steps WHERE track_id = $1 ORDER BY step_index ASC`,
		sharedpg.UUID(trackID))
	if err != nil {
		return nil, fmt.Errorf("tracks.Postgres.fetchSteps: %w", err)
	}
	defer rows.Close()
	out := make([]domain.Step, 0, 8)
	for rows.Next() {
		s, err := scanStep(rows)
		if err != nil {
			return nil, fmt.Errorf("tracks.Postgres.fetchSteps: scan: %w", err)
		}
		out = append(out, s)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("tracks.Postgres.fetchSteps: rows: %w", err)
	}
	return out, nil
}

// ── MembershipRepo ───────────────────────────────────────────────────────

// ListByUser returns every enrolment with its parent track row + the
// total number of steps in that track (cheap subquery, avoids a
// second round trip per row).
func (r *Postgres) ListByUser(ctx context.Context, userID uuid.UUID) ([]domain.UserTrackProgress, error) {
	rows, err := r.pool.Query(ctx, `
        SELECT
            ut.user_id, ut.track_id, ut.joined_at, ut.current_step,
            COALESCE(ut.progress, '{}'::jsonb) AS progress,
            ut.paused_at, ut.completed_at,
            `+commaPrefix(trackCols, "t.")+`,
            COALESCE((SELECT COUNT(*) FROM track_steps ts WHERE ts.track_id = t.id), 0) AS steps_total
          FROM user_tracks ut
          JOIN tracks t ON t.id = ut.track_id
         WHERE ut.user_id = $1
         ORDER BY ut.completed_at IS NOT NULL ASC,
                  ut.paused_at    IS NOT NULL ASC,
                  ut.joined_at DESC`,
		sharedpg.UUID(userID),
	)
	if err != nil {
		return nil, fmt.Errorf("tracks.Postgres.ListByUser: %w", err)
	}
	defer rows.Close()
	out := make([]domain.UserTrackProgress, 0, 4)
	for rows.Next() {
		v, err := scanUserTrackProgress(rows)
		if err != nil {
			return nil, fmt.Errorf("tracks.Postgres.ListByUser: scan: %w", err)
		}
		out = append(out, v)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("tracks.Postgres.ListByUser: rows: %w", err)
	}
	return out, nil
}

// Get returns a single enrolment row.
func (r *Postgres) Get(ctx context.Context, userID, trackID uuid.UUID) (domain.UserTrack, error) {
	row := r.pool.QueryRow(ctx, `
        SELECT user_id, track_id, joined_at, current_step,
               COALESCE(progress, '{}'::jsonb) AS progress,
               paused_at, completed_at
          FROM user_tracks
         WHERE user_id = $1 AND track_id = $2`,
		sharedpg.UUID(userID), sharedpg.UUID(trackID),
	)
	out, err := scanUserTrack(row)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.UserTrack{}, domain.ErrNotFound
		}
		return domain.UserTrack{}, fmt.Errorf("tracks.Postgres.Get: %w", err)
	}
	return out, nil
}

// Join inserts a fresh enrolment. ON CONFLICT bubbles back as
// ErrAlreadyJoined so the use case can decide between "open existing"
// and "loud error".
func (r *Postgres) Join(ctx context.Context, in domain.UserTrack) (domain.UserTrack, error) {
	progress := in.Progress
	if progress == nil {
		progress = map[string]any{}
	}
	progressJSON, err := json.Marshal(progress)
	if err != nil {
		return domain.UserTrack{}, fmt.Errorf("tracks.Postgres.Join: marshal progress: %w", err)
	}
	row := r.pool.QueryRow(ctx, `
        INSERT INTO user_tracks (user_id, track_id, current_step, progress)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (user_id, track_id) DO NOTHING
        RETURNING user_id, track_id, joined_at, current_step,
                  COALESCE(progress, '{}'::jsonb) AS progress,
                  paused_at, completed_at`,
		sharedpg.UUID(in.UserID), sharedpg.UUID(in.TrackID), in.CurrentStep, progressJSON,
	)
	out, err := scanUserTrack(row)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.UserTrack{}, domain.ErrAlreadyJoined
		}
		return domain.UserTrack{}, fmt.Errorf("tracks.Postgres.Join: %w", err)
	}
	return out, nil
}

// SetCurrentStep advances the pointer. When `next == totalSteps` we
// stamp completed_at; the caller passes the count so this method
// stays repo-agnostic to step shape.
func (r *Postgres) SetCurrentStep(ctx context.Context, userID, trackID uuid.UUID, next int, totalSteps int) (domain.UserTrack, error) {
	if next < 0 {
		return domain.UserTrack{}, fmt.Errorf("tracks.Postgres.SetCurrentStep: %w: negative next", domain.ErrInvalidInput)
	}
	completed := next >= totalSteps && totalSteps > 0
	row := r.pool.QueryRow(ctx, `
        UPDATE user_tracks
           SET current_step = $3,
               completed_at = CASE
                   WHEN $4 THEN COALESCE(completed_at, now())
                   ELSE completed_at
               END
         WHERE user_id = $1 AND track_id = $2
        RETURNING user_id, track_id, joined_at, current_step,
                  COALESCE(progress, '{}'::jsonb) AS progress,
                  paused_at, completed_at`,
		sharedpg.UUID(userID), sharedpg.UUID(trackID), next, completed,
	)
	out, err := scanUserTrack(row)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.UserTrack{}, domain.ErrNotFound
		}
		return domain.UserTrack{}, fmt.Errorf("tracks.Postgres.SetCurrentStep: %w", err)
	}
	return out, nil
}

// SetPaused toggles paused_at.
func (r *Postgres) SetPaused(ctx context.Context, userID, trackID uuid.UUID, paused bool) (domain.UserTrack, error) {
	row := r.pool.QueryRow(ctx, `
        UPDATE user_tracks
           SET paused_at = CASE WHEN $3 THEN now() ELSE NULL END
         WHERE user_id = $1 AND track_id = $2
        RETURNING user_id, track_id, joined_at, current_step,
                  COALESCE(progress, '{}'::jsonb) AS progress,
                  paused_at, completed_at`,
		sharedpg.UUID(userID), sharedpg.UUID(trackID), paused,
	)
	out, err := scanUserTrack(row)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.UserTrack{}, domain.ErrNotFound
		}
		return domain.UserTrack{}, fmt.Errorf("tracks.Postgres.SetPaused: %w", err)
	}
	return out, nil
}

// Leave removes the enrolment row entirely.
func (r *Postgres) Leave(ctx context.Context, userID, trackID uuid.UUID) error {
	cmd, err := r.pool.Exec(ctx,
		`DELETE FROM user_tracks WHERE user_id = $1 AND track_id = $2`,
		sharedpg.UUID(userID), sharedpg.UUID(trackID))
	if err != nil {
		return fmt.Errorf("tracks.Postgres.Leave: %w", err)
	}
	if cmd.RowsAffected() == 0 {
		return domain.ErrNotFound
	}
	return nil
}

// ── helpers ──────────────────────────────────────────────────────────────

// commaPrefix renames each unqualified column in a comma-separated list
// to "<prefix>.col". Used to disambiguate the trackCols list in the
// JOIN inside ListByUser without re-typing the whole string.
func commaPrefix(cols, prefix string) string {
	// crude but readable: walk char-by-char tracking the column boundary
	// (commas + whitespace).
	out := make([]byte, 0, len(cols)+len(prefix)*16)
	emit := func(s string) {
		for i := 0; i < len(s); i++ {
			out = append(out, s[i])
		}
	}
	emit(prefix)
	for i := 0; i < len(cols); i++ {
		c := cols[i]
		out = append(out, c)
		if c == ',' {
			// Skip following whitespace then prepend prefix to next token.
			j := i + 1
			for j < len(cols) && (cols[j] == ' ' || cols[j] == '\n' || cols[j] == '\t') {
				out = append(out, cols[j])
				j++
			}
			emit(prefix)
			i = j - 1
		}
	}
	return string(out)
}

func scanTrack(row pgx.Row) (domain.Track, error) {
	var (
		id, curatorID            pgtype.UUID
		slug, name, tagline      string
		descMD, coverURL, accent string
		estimatedWeeks           int16
		difficulty               string
		isCurated, isActive      bool
		tags, companyFocus       []string
		createdAt, updatedAt     time.Time
	)
	if err := row.Scan(
		&id, &slug, &name, &tagline, &descMD,
		&coverURL, &accent, &curatorID,
		&estimatedWeeks, &difficulty, &isCurated, &isActive,
		&tags, &companyFocus, &createdAt, &updatedAt,
	); err != nil {
		return domain.Track{}, fmt.Errorf("tracks.pg.scanTrack: %w", err)
	}
	t := domain.Track{
		ID:             sharedpg.UUIDFrom(id),
		Slug:           slug,
		Name:           name,
		Tagline:        tagline,
		DescriptionMD:  descMD,
		CoverImageURL:  coverURL,
		AccentColor:    accent,
		EstimatedWeeks: int(estimatedWeeks),
		Difficulty:     domain.Difficulty(difficulty),
		IsCurated:      isCurated,
		IsActive:       isActive,
		Tags:           tags,
		CompanyFocus:   companyFocus,
		CreatedAt:      createdAt,
		UpdatedAt:      updatedAt,
	}
	if curatorID.Valid {
		v := sharedpg.UUIDFrom(curatorID)
		t.CuratorID = &v
	}
	return t, nil
}

func scanStep(row pgx.Row) (domain.Step, error) {
	var (
		trackID                pgtype.UUID
		stepIndex              int16
		title, descMD, kindStr string
		skillKeys              []string
		requiredCount          int32
		recReading             []string
		estMin                 int32
		checkpointKeys         []string
		reflectionRequired     bool
		graduationMockSection  string
	)
	if err := row.Scan(
		&trackID, &stepIndex, &title, &descMD,
		&skillKeys, &kindStr, &requiredCount,
		&recReading, &estMin,
		&checkpointKeys, &reflectionRequired, &graduationMockSection,
	); err != nil {
		return domain.Step{}, fmt.Errorf("tracks.pg.scanStep: %w", err)
	}
	return domain.Step{
		TrackID:               sharedpg.UUIDFrom(trackID),
		StepIndex:             int(stepIndex),
		Title:                 title,
		DescriptionMD:         descMD,
		SkillKeys:             skillKeys,
		RequiredKind:          domain.StepKind(kindStr),
		RequiredCount:         int(requiredCount),
		RecommendedReading:    recReading,
		EstimatedMinutes:      int(estMin),
		CheckpointSkillKeys:   checkpointKeys,
		ReflectionRequired:    reflectionRequired,
		GraduationMockSection: graduationMockSection,
	}, nil
}

func scanUserTrack(row pgx.Row) (domain.UserTrack, error) {
	var (
		userID, trackID       pgtype.UUID
		joinedAt              time.Time
		currentStep           int16
		progressJSON          []byte
		pausedAt, completedAt pgtype.Timestamptz
	)
	if err := row.Scan(
		&userID, &trackID, &joinedAt, &currentStep,
		&progressJSON, &pausedAt, &completedAt,
	); err != nil {
		return domain.UserTrack{}, fmt.Errorf("tracks.pg.scanUserTrack: %w", err)
	}
	out := domain.UserTrack{
		UserID:      sharedpg.UUIDFrom(userID),
		TrackID:     sharedpg.UUIDFrom(trackID),
		JoinedAt:    joinedAt,
		CurrentStep: int(currentStep),
		Progress:    map[string]any{},
	}
	if len(progressJSON) > 0 {
		_ = json.Unmarshal(progressJSON, &out.Progress)
	}
	if pausedAt.Valid {
		t := pausedAt.Time
		out.PausedAt = &t
	}
	if completedAt.Valid {
		t := completedAt.Time
		out.CompletedAt = &t
	}
	return out, nil
}

func scanUserTrackProgress(row pgx.Row) (domain.UserTrackProgress, error) {
	var (
		userID, trackID       pgtype.UUID
		joinedAt              time.Time
		currentStep           int16
		progressJSON          []byte
		pausedAt, completedAt pgtype.Timestamptz
		// Track row.
		tID, curatorID              pgtype.UUID
		tSlug, tName, tTagline      string
		tDescMD, tCoverURL, tAccent string
		estimatedWeeks              int16
		difficulty                  string
		isCurated, isActive         bool
		tags, companyFocus          []string
		tCreatedAt, tUpdatedAt      time.Time
		stepsTotal                  int64
	)
	if err := row.Scan(
		&userID, &trackID, &joinedAt, &currentStep,
		&progressJSON, &pausedAt, &completedAt,
		&tID, &tSlug, &tName, &tTagline, &tDescMD,
		&tCoverURL, &tAccent, &curatorID,
		&estimatedWeeks, &difficulty, &isCurated, &isActive,
		&tags, &companyFocus, &tCreatedAt, &tUpdatedAt,
		&stepsTotal,
	); err != nil {
		return domain.UserTrackProgress{}, fmt.Errorf("tracks.pg.scanUserTrackProgress: %w", err)
	}
	ut := domain.UserTrack{
		UserID:      sharedpg.UUIDFrom(userID),
		TrackID:     sharedpg.UUIDFrom(trackID),
		JoinedAt:    joinedAt,
		CurrentStep: int(currentStep),
		Progress:    map[string]any{},
	}
	if len(progressJSON) > 0 {
		_ = json.Unmarshal(progressJSON, &ut.Progress)
	}
	if pausedAt.Valid {
		t := pausedAt.Time
		ut.PausedAt = &t
	}
	if completedAt.Valid {
		t := completedAt.Time
		ut.CompletedAt = &t
	}
	t := domain.Track{
		ID:             sharedpg.UUIDFrom(tID),
		Slug:           tSlug,
		Name:           tName,
		Tagline:        tTagline,
		DescriptionMD:  tDescMD,
		CoverImageURL:  tCoverURL,
		AccentColor:    tAccent,
		EstimatedWeeks: int(estimatedWeeks),
		Difficulty:     domain.Difficulty(difficulty),
		IsCurated:      isCurated,
		IsActive:       isActive,
		Tags:           tags,
		CompanyFocus:   companyFocus,
		CreatedAt:      tCreatedAt,
		UpdatedAt:      tUpdatedAt,
	}
	if curatorID.Valid {
		v := sharedpg.UUIDFrom(curatorID)
		t.CuratorID = &v
	}
	return domain.UserTrackProgress{
		UserTrack:  ut,
		Track:      t,
		StepsTotal: int(stepsTotal),
	}, nil
}

// Compile-time guards.
var (
	_ domain.CatalogRepo    = (*Postgres)(nil)
	_ domain.MembershipRepo = (*Postgres)(nil)
	_ domain.CheckpointRepo = (*Postgres)(nil)
)

// ── CheckpointRepo (Phase 2 step UX flow, миграция 00056) ────────────────

const checkpointCols = `id, user_id, track_id, step_index, score, attempts, passed_at, created_at`

// Insert записывает результат attempt'а. Caller передаёт CheckpointAttempt
// без ID/CreatedAt; репо генерирует gen_random_uuid + now().
func (r *Postgres) Insert(ctx context.Context, in domain.CheckpointAttempt) (domain.CheckpointAttempt, error) {
	row := r.pool.QueryRow(ctx,
		`INSERT INTO step_checkpoint_attempts (user_id, track_id, step_index, score, attempts, passed_at)
		 VALUES ($1, $2, $3, $4, $5, $6)
		 RETURNING `+checkpointCols,
		sharedpg.UUID(in.UserID), sharedpg.UUID(in.TrackID), int16(in.StepIndex),
		in.Score, in.Attempts, in.PassedAt,
	)
	out, err := scanCheckpoint(row)
	if err != nil {
		return domain.CheckpointAttempt{}, fmt.Errorf("tracks.Postgres.Insert checkpoint: %w", err)
	}
	return out, nil
}

func (r *Postgres) LatestForStep(ctx context.Context, userID, trackID uuid.UUID, stepIndex int) (domain.CheckpointAttempt, error) {
	row := r.pool.QueryRow(ctx,
		`SELECT `+checkpointCols+`
		   FROM step_checkpoint_attempts
		  WHERE user_id = $1 AND track_id = $2 AND step_index = $3
		  ORDER BY created_at DESC LIMIT 1`,
		sharedpg.UUID(userID), sharedpg.UUID(trackID), int16(stepIndex),
	)
	out, err := scanCheckpoint(row)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.CheckpointAttempt{}, domain.ErrNotFound
		}
		return domain.CheckpointAttempt{}, fmt.Errorf("tracks.Postgres.LatestForStep: %w", err)
	}
	return out, nil
}

func (r *Postgres) HasPassed(ctx context.Context, userID, trackID uuid.UUID, stepIndex int) (bool, error) {
	var exists bool
	err := r.pool.QueryRow(ctx,
		`SELECT EXISTS(
		    SELECT 1 FROM step_checkpoint_attempts
		     WHERE user_id = $1 AND track_id = $2 AND step_index = $3
		       AND passed_at IS NOT NULL)`,
		sharedpg.UUID(userID), sharedpg.UUID(trackID), int16(stepIndex),
	).Scan(&exists)
	if err != nil {
		return false, fmt.Errorf("tracks.Postgres.HasPassed: %w", err)
	}
	return exists, nil
}

func scanCheckpoint(row pgx.Row) (domain.CheckpointAttempt, error) {
	var (
		id, userID, trackID pgtype.UUID
		stepIndex           int16
		score               int32
		attempts            []byte
		passedAt            *time.Time
		createdAt           time.Time
	)
	if err := row.Scan(&id, &userID, &trackID, &stepIndex, &score, &attempts, &passedAt, &createdAt); err != nil {
		return domain.CheckpointAttempt{}, fmt.Errorf("scan checkpoint: %w", err)
	}
	return domain.CheckpointAttempt{
		ID:        sharedpg.UUIDFrom(id),
		UserID:    sharedpg.UUIDFrom(userID),
		TrackID:   sharedpg.UUIDFrom(trackID),
		StepIndex: int(stepIndex),
		Score:     int(score),
		Attempts:  attempts,
		PassedAt:  passedAt,
		CreatedAt: createdAt,
	}, nil
}
