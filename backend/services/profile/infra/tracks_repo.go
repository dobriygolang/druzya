package infra

import (
	"context"
	"fmt"

	"druz9/profile/domain"
	sharedpg "druz9/shared/pkg/pg"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// ListUserTracks reads `user_persona_tracks` ordered so the primary track is
// first. Hand-rolled pgx (not sqlc) because the track_kind enum cast
// is awkward to plumb through generated code, and the surface here is
// tiny (two methods, no joins).
func (p *Postgres) ListUserTracks(ctx context.Context, userID uuid.UUID) ([]domain.UserTrack, error) {
	const q = `
		SELECT track::text, COALESCE(seniority, ''), primary_track, started_at, last_active_at
		FROM user_persona_tracks
		WHERE user_id = $1
		ORDER BY primary_track DESC, started_at ASC
	`
	rows, err := p.pool.Query(ctx, q, sharedpg.UUID(userID))
	if err != nil {
		return nil, fmt.Errorf("profile.Postgres.ListUserTracks: %w", err)
	}
	defer rows.Close()

	out := make([]domain.UserTrack, 0)
	for rows.Next() {
		var t domain.UserTrack
		var trackText, seniorityText string
		if err := rows.Scan(&trackText, &seniorityText, &t.Primary, &t.StartedAt, &t.LastActiveAt); err != nil {
			return nil, fmt.Errorf("profile.Postgres.ListUserTracks: scan: %w", err)
		}
		t.UserID = userID
		t.Track = domain.Track(trackText)
		t.Seniority = domain.Seniority(seniorityText)
		out = append(out, t)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("profile.Postgres.ListUserTracks: iterate: %w", err)
	}
	return out, nil
}

// SetUserTracks replaces the user's track list atomically. Caller must
// have validated the slice via domain.ValidateTrackList — this method
// only enforces transactional integrity (delete + insert) and preserves
// started_at for tracks that survive the replacement.
func (p *Postgres) SetUserTracks(
	ctx context.Context,
	userID uuid.UUID,
	items []domain.UserTrack,
) ([]domain.UserTrack, error) {
	tx, err := p.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return nil, fmt.Errorf("profile.Postgres.SetUserTracks: begin: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	// Snapshot existing started_at so we can preserve cohort markers
	// for tracks that survive the replacement. Otherwise the cohort
	// analysis lies — a user who toggled a track off-then-on would look
	// like a fresh joiner.
	existing := map[domain.Track]struct{ started_at, last_active_at any }{}
	rows, err := tx.Query(ctx,
		`SELECT track::text, started_at, last_active_at FROM user_persona_tracks WHERE user_id = $1`,
		sharedpg.UUID(userID),
	)
	if err != nil {
		return nil, fmt.Errorf("profile.Postgres.SetUserTracks: snapshot query: %w", err)
	}
	for rows.Next() {
		var k string
		var sa, la any
		if scanErr := rows.Scan(&k, &sa, &la); scanErr != nil {
			rows.Close()
			return nil, fmt.Errorf("profile.Postgres.SetUserTracks: snapshot scan: %w", scanErr)
		}
		existing[domain.Track(k)] = struct{ started_at, last_active_at any }{sa, la}
	}
	rows.Close()

	if _, delErr := tx.Exec(ctx, `DELETE FROM user_persona_tracks WHERE user_id = $1`, sharedpg.UUID(userID)); delErr != nil {
		return nil, fmt.Errorf("profile.Postgres.SetUserTracks: delete: %w", delErr)
	}

	// Bulk insert via VALUES. Items are small (≤6) so a per-row Exec is
	// fine and keeps the SQL trivial.
	for _, it := range items {
		var seniority any
		if it.Seniority != "" {
			seniority = string(it.Seniority)
		}
		if prev, ok := existing[it.Track]; ok {
			// Preserve started_at; bump last_active_at to now() since the
			// user explicitly re-confirmed this track via SetUserTracks.
			_, err = tx.Exec(ctx, `
				INSERT INTO user_persona_tracks (user_id, track, seniority, primary_track, started_at, last_active_at)
				VALUES ($1, $2::track_kind, $3, $4, $5, NOW())
			`, sharedpg.UUID(userID), string(it.Track), seniority, it.Primary, prev.started_at)
		} else {
			_, err = tx.Exec(ctx, `
				INSERT INTO user_persona_tracks (user_id, track, seniority, primary_track)
				VALUES ($1, $2::track_kind, $3, $4)
			`, sharedpg.UUID(userID), string(it.Track), seniority, it.Primary)
		}
		if err != nil {
			return nil, fmt.Errorf("profile.Postgres.SetUserTracks: insert %q: %w", it.Track, err)
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("profile.Postgres.SetUserTracks: commit: %w", err)
	}

	// Re-read to get authoritative timestamps for the response.
	return p.ListUserTracks(ctx, userID)
}
