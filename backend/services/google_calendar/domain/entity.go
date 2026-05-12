// Package domain — Google Calendar two-way sync bounded context.
//
// Stream E MVP: OAuth2 connect, periodic pull, ad-hoc push. Tokens stored
// encrypted (AES-256-GCM, env GOOGLE_TOKEN_ENCRYPTION_KEY); events mirrored
// in events_synced for fast local reads + offline tolerance.
package domain

import (
	"errors"
	"time"

	"github.com/google/uuid"
)

// GoogleCredentials — per-user OAuth tokens for Google Calendar.
// Stored encrypted at the infra layer; plaintext lives only in-process.
type GoogleCredentials struct {
	UserID       uuid.UUID
	AccessToken  string
	RefreshToken string
	Expiry       time.Time
	Scopes       []string
	CalendarID   string
	ConnectedAt  time.Time
	UpdatedAt    time.Time
}

// Expired reports whether the access token needs refresh.
// We add a 60s buffer so a refresh starts before the API rejects us.
func (c GoogleCredentials) Expired(now time.Time) bool {
	return now.Add(60 * time.Second).After(c.Expiry)
}

// Event — Google Calendar event mirrored locally. google_event_id + etag
// drive idempotent upserts; deleted_at marks soft-delete during pull.
type Event struct {
	ID            uuid.UUID
	UserID        uuid.UUID
	GoogleEventID string
	GoogleEtag    string
	Title         string
	Start         time.Time
	End           time.Time
	Description   string
	LastSyncedAt  time.Time
	DeletedAt     *time.Time
}

// EventInput — write-shape for PushEvent (CreateOrUpdate semantics).
// ID is local (auto-generated); GoogleEventID is empty for new events,
// populated for updates / etag-validated mutations.
type EventInput struct {
	GoogleEventID string
	Title         string
	Start         time.Time
	End           time.Time
	Description   string
}

// Domain errors.
var (
	ErrNotFound       = errors.New("google_calendar: not found")
	ErrNotConnected   = errors.New("google_calendar: user not connected")
	ErrInvalidState   = errors.New("google_calendar: invalid oauth state")
	ErrUpstream       = errors.New("google_calendar: upstream error")
	ErrTokenRefresh   = errors.New("google_calendar: token refresh failed")
	ErrInvalidPayload = errors.New("google_calendar: invalid payload")
)
