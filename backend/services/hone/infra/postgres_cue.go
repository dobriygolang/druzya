// CueSessions repository.
//
// A Cue session is a hone_notes row with kind='cue', a non-NULL file_path /
// started_at / imported_at, and the raw analysis JSON in raw_analysis_json.
// The unique index idx_hone_notes_user_file_path (partial WHERE file_path IS
// NOT NULL) keeps Import idempotent.
package infra

import (
	"context"
	"errors"
	"fmt"
	"time"

	"druz9/hone/domain"
	sharedpg "druz9/shared/pkg/pg"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
)

type CueSessions struct {
	pool *pgxpool.Pool
}

func NewCueSessions(pool *pgxpool.Pool) *CueSessions { return &CueSessions{pool: pool} }

// Import создаёт новую сессию или обновляет существующую по file_path.
// initialBodyMD используется только при первом импорте (на ON CONFLICT
// поле body_md остаётся прежним — юзерские правки не теряются).
func (c *CueSessions) Import(ctx context.Context, s domain.CueSession, initialBodyMD string) (domain.CueSession, error) {
	var (
		id         pgtype.UUID
		bodyMD     string
		startedAt  pgtype.Timestamptz
		importedAt pgtype.Timestamptz
		updatedAt  time.Time
	)
	var startedArg pgtype.Timestamptz
	if s.StartedAt != nil {
		startedArg = pgtype.Timestamptz{Time: *s.StartedAt, Valid: true}
	}
	err := c.pool.QueryRow(ctx,
		`INSERT INTO hone_notes
		   (user_id, kind, file_path, title, body_md, raw_analysis_json,
		    started_at, imported_at)
		 VALUES ($1, 'cue', $2, $3, $4, $5::jsonb, $6, now())
		 ON CONFLICT (user_id, file_path) WHERE file_path IS NOT NULL DO UPDATE
		   SET title             = EXCLUDED.title,
		       raw_analysis_json = EXCLUDED.raw_analysis_json,
		       started_at        = EXCLUDED.started_at,
		       updated_at        = now()
		 RETURNING id, body_md, started_at, imported_at, updated_at`,
		sharedpg.UUID(s.UserID),
		s.FilePath,
		s.Title,
		initialBodyMD,
		s.RawAnalysisJSON,
		startedArg,
	).Scan(&id, &bodyMD, &startedAt, &importedAt, &updatedAt)
	if err != nil {
		return domain.CueSession{}, fmt.Errorf("hone.CueSessions.Import: %w", err)
	}
	out := domain.CueSession{
		ID:              sharedpg.UUIDFrom(id),
		UserID:          s.UserID,
		FilePath:        s.FilePath,
		Title:           s.Title,
		BodyMD:          bodyMD,
		RawAnalysisJSON: s.RawAnalysisJSON,
		UpdatedAt:       updatedAt,
	}
	if startedAt.Valid {
		t := startedAt.Time
		out.StartedAt = &t
	}
	if importedAt.Valid {
		out.ImportedAt = importedAt.Time
	}
	return out, nil
}

// List returns kind='cue' rows sorted by imported_at DESC.
func (c *CueSessions) List(ctx context.Context, userID uuid.UUID) ([]domain.CueSession, error) {
	rows, err := c.pool.Query(ctx,
		`SELECT id, file_path, title, body_md, COALESCE(raw_analysis_json::text, ''),
		        started_at, imported_at, updated_at
		   FROM hone_notes
		  WHERE user_id=$1 AND kind='cue'
		  ORDER BY imported_at DESC NULLS LAST`,
		sharedpg.UUID(userID),
	)
	if err != nil {
		return nil, fmt.Errorf("hone.CueSessions.List: %w", err)
	}
	defer rows.Close()
	out := make([]domain.CueSession, 0, 16)
	for rows.Next() {
		var (
			id         pgtype.UUID
			filePath   pgtype.Text
			title      string
			bodyMD     string
			raw        string
			startedAt  pgtype.Timestamptz
			importedAt pgtype.Timestamptz
			updatedAt  time.Time
		)
		if err := rows.Scan(&id, &filePath, &title, &bodyMD, &raw, &startedAt, &importedAt, &updatedAt); err != nil {
			return nil, fmt.Errorf("hone.CueSessions.List: scan: %w", err)
		}
		s := domain.CueSession{
			ID:              sharedpg.UUIDFrom(id),
			UserID:          userID,
			FilePath:        filePath.String,
			Title:           title,
			BodyMD:          bodyMD,
			RawAnalysisJSON: raw,
			UpdatedAt:       updatedAt,
		}
		if startedAt.Valid {
			t := startedAt.Time
			s.StartedAt = &t
		}
		if importedAt.Valid {
			s.ImportedAt = importedAt.Time
		}
		out = append(out, s)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("hone.CueSessions.List: rows: %w", err)
	}
	return out, nil
}

func (c *CueSessions) Get(ctx context.Context, userID, id uuid.UUID) (domain.CueSession, error) {
	var (
		filePath   pgtype.Text
		title      string
		bodyMD     string
		raw        string
		startedAt  pgtype.Timestamptz
		importedAt pgtype.Timestamptz
		updatedAt  time.Time
	)
	err := c.pool.QueryRow(ctx,
		`SELECT file_path, title, body_md, COALESCE(raw_analysis_json::text, ''),
		        started_at, imported_at, updated_at
		   FROM hone_notes
		  WHERE id=$1 AND user_id=$2 AND kind='cue'`,
		sharedpg.UUID(id), sharedpg.UUID(userID),
	).Scan(&filePath, &title, &bodyMD, &raw, &startedAt, &importedAt, &updatedAt)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.CueSession{}, domain.ErrNotFound
		}
		return domain.CueSession{}, fmt.Errorf("hone.CueSessions.Get: %w", err)
	}
	out := domain.CueSession{
		ID:              id,
		UserID:          userID,
		FilePath:        filePath.String,
		Title:           title,
		BodyMD:          bodyMD,
		RawAnalysisJSON: raw,
		UpdatedAt:       updatedAt,
	}
	if startedAt.Valid {
		t := startedAt.Time
		out.StartedAt = &t
	}
	if importedAt.Valid {
		out.ImportedAt = importedAt.Time
	}
	return out, nil
}

func (c *CueSessions) UpdateBody(ctx context.Context, userID, id uuid.UUID, bodyMD string) (domain.CueSession, error) {
	var updatedAt time.Time
	err := c.pool.QueryRow(ctx,
		`UPDATE hone_notes
		    SET body_md=$3, updated_at=now()
		  WHERE id=$1 AND user_id=$2 AND kind='cue'
		  RETURNING updated_at`,
		sharedpg.UUID(id), sharedpg.UUID(userID), bodyMD,
	).Scan(&updatedAt)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.CueSession{}, domain.ErrNotFound
		}
		return domain.CueSession{}, fmt.Errorf("hone.CueSessions.UpdateBody: %w", err)
	}
	return c.Get(ctx, userID, id)
}

func (c *CueSessions) Delete(ctx context.Context, userID, id uuid.UUID) error {
	cmd, err := c.pool.Exec(ctx,
		`DELETE FROM hone_notes WHERE id=$1 AND user_id=$2 AND kind='cue'`,
		sharedpg.UUID(id), sharedpg.UUID(userID),
	)
	if err != nil {
		return fmt.Errorf("hone.CueSessions.Delete: %w", err)
	}
	if cmd.RowsAffected() == 0 {
		return domain.ErrNotFound
	}
	return nil
}
