// Package infra — pgx adapters + Google API client for google_calendar.
package infra

import (
	"context"
	"errors"
	"fmt"
	"time"

	"druz9/google_calendar/domain"
	sharedpg "druz9/shared/pkg/pg"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
)

// CredentialsRepo — encrypted token storage. Encryptor MUST be non-nil
// (bootstrap fail-fast).
type CredentialsRepo struct {
	pool *pgxpool.Pool
	enc  *Encryptor
}

func NewCredentialsRepo(pool *pgxpool.Pool, enc *Encryptor) *CredentialsRepo {
	return &CredentialsRepo{pool: pool, enc: enc}
}

func (r *CredentialsRepo) Upsert(ctx context.Context, c domain.GoogleCredentials) error {
	accessCt, err := r.enc.Encrypt(c.AccessToken)
	if err != nil {
		return fmt.Errorf("google_calendar.CredentialsRepo.Upsert encrypt access: %w", err)
	}
	refreshCt, err := r.enc.Encrypt(c.RefreshToken)
	if err != nil {
		return fmt.Errorf("google_calendar.CredentialsRepo.Upsert encrypt refresh: %w", err)
	}
	calendarID := c.CalendarID
	if calendarID == "" {
		calendarID = "primary"
	}
	_, err = r.pool.Exec(ctx, `
		INSERT INTO user_google_credentials
		    (user_id, access_token_encrypted, refresh_token_encrypted,
		     expiry, scopes, calendar_id, connected_at, updated_at)
		VALUES ($1,$2,$3,$4,$5,$6, COALESCE(NULLIF($7,'0001-01-01 00:00:00+00'::timestamptz), now()), now())
		ON CONFLICT (user_id) DO UPDATE SET
		    access_token_encrypted  = EXCLUDED.access_token_encrypted,
		    refresh_token_encrypted = EXCLUDED.refresh_token_encrypted,
		    expiry                  = EXCLUDED.expiry,
		    scopes                  = EXCLUDED.scopes,
		    calendar_id             = EXCLUDED.calendar_id,
		    updated_at              = now()
	`,
		sharedpg.UUID(c.UserID),
		accessCt, refreshCt,
		c.Expiry, c.Scopes, calendarID,
		pgtype.Timestamptz{Time: c.ConnectedAt, Valid: !c.ConnectedAt.IsZero()},
	)
	if err != nil {
		return fmt.Errorf("google_calendar.CredentialsRepo.Upsert: %w", err)
	}
	return nil
}

func (r *CredentialsRepo) Get(ctx context.Context, userID uuid.UUID) (domain.GoogleCredentials, error) {
	var (
		uid                   pgtype.UUID
		accessCt, refreshCt   string
		expiry                time.Time
		scopes                []string
		calendarID            string
		connectedAt, updated  time.Time
	)
	err := r.pool.QueryRow(ctx, `
		SELECT user_id, access_token_encrypted, refresh_token_encrypted,
		       expiry, scopes, calendar_id, connected_at, updated_at
		  FROM user_google_credentials WHERE user_id = $1
	`, sharedpg.UUID(userID)).Scan(&uid, &accessCt, &refreshCt, &expiry, &scopes, &calendarID, &connectedAt, &updated)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.GoogleCredentials{}, domain.ErrNotFound
		}
		return domain.GoogleCredentials{}, fmt.Errorf("google_calendar.CredentialsRepo.Get: %w", err)
	}
	access, err := r.enc.Decrypt(accessCt)
	if err != nil {
		return domain.GoogleCredentials{}, fmt.Errorf("google_calendar.CredentialsRepo.Get decrypt access: %w", err)
	}
	refresh, err := r.enc.Decrypt(refreshCt)
	if err != nil {
		return domain.GoogleCredentials{}, fmt.Errorf("google_calendar.CredentialsRepo.Get decrypt refresh: %w", err)
	}
	return domain.GoogleCredentials{
		UserID:       sharedpg.UUIDFrom(uid),
		AccessToken:  access,
		RefreshToken: refresh,
		Expiry:       expiry,
		Scopes:       scopes,
		CalendarID:   calendarID,
		ConnectedAt:  connectedAt,
		UpdatedAt:    updated,
	}, nil
}

func (r *CredentialsRepo) Delete(ctx context.Context, userID uuid.UUID) error {
	_, err := r.pool.Exec(ctx, `DELETE FROM user_google_credentials WHERE user_id = $1`, sharedpg.UUID(userID))
	if err != nil {
		return fmt.Errorf("google_calendar.CredentialsRepo.Delete: %w", err)
	}
	return nil
}

func (r *CredentialsRepo) ListConnected(ctx context.Context) ([]uuid.UUID, error) {
	rows, err := r.pool.Query(ctx, `SELECT user_id FROM user_google_credentials`)
	if err != nil {
		return nil, fmt.Errorf("google_calendar.CredentialsRepo.ListConnected: %w", err)
	}
	defer rows.Close()
	var out []uuid.UUID
	for rows.Next() {
		var uid pgtype.UUID
		if err := rows.Scan(&uid); err != nil {
			return nil, fmt.Errorf("google_calendar.CredentialsRepo.ListConnected scan: %w", err)
		}
		out = append(out, sharedpg.UUIDFrom(uid))
	}
	return out, rows.Err()
}

// EventsRepo — mirror of remote events.
type EventsRepo struct {
	pool *pgxpool.Pool
}

func NewEventsRepo(pool *pgxpool.Pool) *EventsRepo { return &EventsRepo{pool: pool} }

func (r *EventsRepo) Upsert(ctx context.Context, e domain.Event) (domain.Event, error) {
	var id pgtype.UUID
	err := r.pool.QueryRow(ctx, `
		INSERT INTO events_synced
		    (id, user_id, google_event_id, google_etag, title, start_time, end_time, description, last_synced_at, deleted_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8, now(), NULL)
		ON CONFLICT (user_id, google_event_id) DO UPDATE SET
		    google_etag    = EXCLUDED.google_etag,
		    title          = EXCLUDED.title,
		    start_time     = EXCLUDED.start_time,
		    end_time       = EXCLUDED.end_time,
		    description    = EXCLUDED.description,
		    last_synced_at = now(),
		    deleted_at     = NULL
		RETURNING id
	`,
		sharedpg.UUID(e.ID), sharedpg.UUID(e.UserID), e.GoogleEventID, e.GoogleEtag,
		e.Title, e.Start, e.End, e.Description,
	).Scan(&id)
	if err != nil {
		return domain.Event{}, fmt.Errorf("google_calendar.EventsRepo.Upsert: %w", err)
	}
	out := e
	out.ID = sharedpg.UUIDFrom(id)
	return out, nil
}

func (r *EventsRepo) MarkDeleted(ctx context.Context, userID uuid.UUID, googleEventID string, when time.Time) error {
	_, err := r.pool.Exec(ctx, `
		UPDATE events_synced SET deleted_at = $3, last_synced_at = $3
		 WHERE user_id = $1 AND google_event_id = $2
	`, sharedpg.UUID(userID), googleEventID, when)
	if err != nil {
		return fmt.Errorf("google_calendar.EventsRepo.MarkDeleted: %w", err)
	}
	return nil
}

func (r *EventsRepo) List(ctx context.Context, userID uuid.UUID, from, to time.Time) ([]domain.Event, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT id, user_id, google_event_id, google_etag, title, start_time, end_time,
		       COALESCE(description,''), last_synced_at, deleted_at
		  FROM events_synced
		 WHERE user_id = $1 AND deleted_at IS NULL
		   AND start_time >= $2 AND start_time <= $3
		 ORDER BY start_time ASC
		 LIMIT 500
	`, sharedpg.UUID(userID), from, to)
	if err != nil {
		return nil, fmt.Errorf("google_calendar.EventsRepo.List: %w", err)
	}
	defer rows.Close()
	var out []domain.Event
	for rows.Next() {
		var (
			id, uid      pgtype.UUID
			gid, etag    string
			title, desc  string
			start, end   time.Time
			lastSynced   time.Time
			deletedAt    pgtype.Timestamptz
		)
		if err := rows.Scan(&id, &uid, &gid, &etag, &title, &start, &end, &desc, &lastSynced, &deletedAt); err != nil {
			return nil, fmt.Errorf("google_calendar.EventsRepo.List scan: %w", err)
		}
		ev := domain.Event{
			ID:            sharedpg.UUIDFrom(id),
			UserID:        sharedpg.UUIDFrom(uid),
			GoogleEventID: gid,
			GoogleEtag:    etag,
			Title:         title,
			Start:         start,
			End:           end,
			Description:   desc,
			LastSyncedAt:  lastSynced,
		}
		if deletedAt.Valid {
			t := deletedAt.Time
			ev.DeletedAt = &t
		}
		out = append(out, ev)
	}
	return out, rows.Err()
}

func (r *EventsRepo) LastSyncedAt(ctx context.Context, userID uuid.UUID) (time.Time, error) {
	var t time.Time
	err := r.pool.QueryRow(ctx,
		`SELECT MAX(last_synced_at) FROM events_synced WHERE user_id = $1`,
		sharedpg.UUID(userID),
	).Scan(&t)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return time.Time{}, domain.ErrNotFound
		}
		return time.Time{}, fmt.Errorf("google_calendar.EventsRepo.LastSyncedAt: %w", err)
	}
	if t.IsZero() {
		return time.Time{}, domain.ErrNotFound
	}
	return t, nil
}

var (
	_ domain.CredentialsRepo = (*CredentialsRepo)(nil)
	_ domain.EventsRepo      = (*EventsRepo)(nil)
)
