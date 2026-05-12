package domain

import (
	"context"
	"time"

	"github.com/google/uuid"
)

// CredentialsRepo persists per-user OAuth tokens. Access/refresh tokens
// arrive plaintext from the app layer; the infra adapter is responsible
// for encrypt-at-rest (AES-256-GCM).
type CredentialsRepo interface {
	Upsert(ctx context.Context, c GoogleCredentials) error
	Get(ctx context.Context, userID uuid.UUID) (GoogleCredentials, error)
	Delete(ctx context.Context, userID uuid.UUID) error
	// ListConnected returns user IDs that currently have a credentials row.
	// Used by the periodic pull cron to fan out PullEvents.
	ListConnected(ctx context.Context) ([]uuid.UUID, error)
}

// EventsRepo persists mirrored events.
type EventsRepo interface {
	// Upsert inserts or updates an event keyed by (user_id, google_event_id).
	Upsert(ctx context.Context, e Event) (Event, error)
	// MarkDeleted soft-deletes a mirror row (Google cancelled the event).
	MarkDeleted(ctx context.Context, userID uuid.UUID, googleEventID string, when time.Time) error
	// List returns active (deleted_at IS NULL) events in [from, to].
	List(ctx context.Context, userID uuid.UUID, from, to time.Time) ([]Event, error)
	// LastSyncedAt returns the newest last_synced_at across user's rows.
	LastSyncedAt(ctx context.Context, userID uuid.UUID) (time.Time, error)
}

// GoogleAPI — narrow port for the actual Google Calendar HTTP API.
// Infra-implementation talks to https://www.googleapis.com/calendar/v3.
type GoogleAPI interface {
	// ExchangeCode swaps an authorization_code for tokens.
	ExchangeCode(ctx context.Context, code, redirectURI string) (GoogleCredentials, error)
	// RefreshToken refreshes an access token. Refresh tokens may rotate
	// (Google sometimes returns a new one) — adapter returns the latest.
	RefreshToken(ctx context.Context, refreshToken string) (newAccess string, expiry time.Time, newRefresh string, err error)
	// RevokeToken best-effort revokes credentials at Google.
	RevokeToken(ctx context.Context, accessToken string) error
	// ListEvents pulls Google events in [timeMin, timeMax]. updatedMin
	// filters to incremental sync; pass zero time for first run.
	ListEvents(ctx context.Context, accessToken, calendarID string, timeMin, timeMax, updatedMin time.Time) ([]GoogleEventDTO, error)
	// InsertEvent posts a new event; returns the assigned ID + etag.
	InsertEvent(ctx context.Context, accessToken, calendarID string, in EventInput) (GoogleEventDTO, error)
	// PatchEvent updates an existing event by ID.
	PatchEvent(ctx context.Context, accessToken, calendarID, googleEventID string, in EventInput) (GoogleEventDTO, error)
	// DeleteEvent deletes one event by ID.
	DeleteEvent(ctx context.Context, accessToken, calendarID, googleEventID string) error
	// AuthURL builds the consent screen URL with state nonce.
	AuthURL(state, redirectURI string) string
}

// GoogleEventDTO — wire shape from the Google API mapped into a flat struct.
type GoogleEventDTO struct {
	ID          string
	Etag        string
	Summary     string
	Description string
	Start       time.Time
	End         time.Time
	Status      string // "confirmed" | "cancelled" | "tentative"
	UpdatedAt   time.Time
}

// StateStore persists short-lived OAuth state nonces (CSRF gate). The infra
// implementation uses Redis with a 10-minute TTL.
type StateStore interface {
	Put(ctx context.Context, state string, userID uuid.UUID, ttl time.Duration) error
	// Consume returns userID and deletes the state in one atomic step.
	// Returns ErrInvalidState when the state is missing / already consumed.
	Consume(ctx context.Context, state string) (uuid.UUID, error)
}
