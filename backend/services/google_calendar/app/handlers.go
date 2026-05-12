// Package app — use cases for google_calendar bounded context.
// Thin orchestrators over domain repos + the Google API port.
package app

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"druz9/google_calendar/domain"

	"github.com/google/uuid"
)

// Scopes are baked in — we ask for events r/w on primary calendar.
var defaultScopes = []string{
	"https://www.googleapis.com/auth/calendar.events",
}

// Handlers — the bounded context's surface. One struct, no inheritance.
type Handlers struct {
	Creds    domain.CredentialsRepo
	Events   domain.EventsRepo
	Google   domain.GoogleAPI
	StateSt  domain.StateStore
	Now      func() time.Time
	Log      *slog.Logger
	StateTTL time.Duration
}

// New wires Handlers with sane defaults.
func New(creds domain.CredentialsRepo, events domain.EventsRepo, gapi domain.GoogleAPI, st domain.StateStore, log *slog.Logger) *Handlers {
	return &Handlers{
		Creds:    creds,
		Events:   events,
		Google:   gapi,
		StateSt:  st,
		Now:      time.Now,
		Log:      log,
		StateTTL: 10 * time.Minute,
	}
}

// ConnectionInfo — projection used by GetConnectionStatus.
type ConnectionInfo struct {
	Connected  bool
	CalendarID string
	LastSynced time.Time
}

// GetConnectionStatus — does the caller have stored credentials?
func (h *Handlers) GetConnectionStatus(ctx context.Context, userID uuid.UUID) (ConnectionInfo, error) {
	c, err := h.Creds.Get(ctx, userID)
	if err != nil {
		if errors.Is(err, domain.ErrNotFound) {
			return ConnectionInfo{Connected: false}, nil
		}
		return ConnectionInfo{}, fmt.Errorf("creds.Get: %w", err)
	}
	last, err := h.Events.LastSyncedAt(ctx, userID)
	if err != nil && !errors.Is(err, domain.ErrNotFound) {
		// Non-fatal — never seen sync just means there are no rows yet.
		if h.Log != nil {
			h.Log.WarnContext(ctx, "google_calendar.LastSyncedAt failed", slog.Any("err", err))
		}
	}
	return ConnectionInfo{Connected: true, CalendarID: c.CalendarID, LastSynced: last}, nil
}

// StartOAuth — issues a state nonce + builds the Google consent URL.
// State persists 10 min in StateStore keyed to userID, so CompleteOAuth
// can recover whose tokens to write without trusting the SPA.
func (h *Handlers) StartOAuth(ctx context.Context, userID uuid.UUID, redirectURI string) (authURL, state string, err error) {
	if strings.TrimSpace(redirectURI) == "" {
		return "", "", fmt.Errorf("redirect_uri: %w", domain.ErrInvalidPayload)
	}
	state, err = randomState()
	if err != nil {
		return "", "", fmt.Errorf("randomState: %w", err)
	}
	if err := h.StateSt.Put(ctx, state, userID, h.StateTTL); err != nil {
		return "", "", fmt.Errorf("state.Put: %w", err)
	}
	return h.Google.AuthURL(state, redirectURI), state, nil
}

// CompleteOAuth — code-exchange after Google redirect. Validates state,
// persists tokens, returns connection status.
func (h *Handlers) CompleteOAuth(ctx context.Context, code, state, redirectURI string) (uuid.UUID, ConnectionInfo, error) {
	if strings.TrimSpace(code) == "" || strings.TrimSpace(state) == "" {
		return uuid.Nil, ConnectionInfo{}, fmt.Errorf("missing fields: %w", domain.ErrInvalidPayload)
	}
	userID, err := h.StateSt.Consume(ctx, state)
	if err != nil {
		return uuid.Nil, ConnectionInfo{}, err
	}
	creds, err := h.Google.ExchangeCode(ctx, code, redirectURI)
	if err != nil {
		return uuid.Nil, ConnectionInfo{}, fmt.Errorf("exchange: %w", err)
	}
	creds.UserID = userID
	creds.ConnectedAt = h.Now().UTC()
	creds.UpdatedAt = creds.ConnectedAt
	if creds.CalendarID == "" {
		creds.CalendarID = "primary"
	}
	if len(creds.Scopes) == 0 {
		creds.Scopes = defaultScopes
	}
	if err := h.Creds.Upsert(ctx, creds); err != nil {
		return uuid.Nil, ConnectionInfo{}, fmt.Errorf("creds.Upsert: %w", err)
	}
	return userID, ConnectionInfo{Connected: true, CalendarID: creds.CalendarID, LastSynced: time.Time{}}, nil
}

// Disconnect — revoke at Google + drop the row. Best-effort revoke (если
// Google уже отозвал ключ, мы всё равно чистим локальный state).
func (h *Handlers) Disconnect(ctx context.Context, userID uuid.UUID) error {
	creds, err := h.Creds.Get(ctx, userID)
	if err != nil {
		if errors.Is(err, domain.ErrNotFound) {
			return nil // idempotent
		}
		return fmt.Errorf("creds.Get: %w", err)
	}
	if err := h.Google.RevokeToken(ctx, creds.AccessToken); err != nil {
		// Warn-only: Google sometimes returns 400 for already-revoked tokens.
		if h.Log != nil {
			h.Log.WarnContext(ctx, "google_calendar.Revoke failed", slog.Any("err", err))
		}
	}
	if err := h.Creds.Delete(ctx, userID); err != nil {
		return fmt.Errorf("creds.Delete: %w", err)
	}
	return nil
}

// PullEvents — mirror Google → events_synced for the caller. Returns count.
// since == zero-time pulls the wide window (-7d..+90d); otherwise incremental
// updatedMin is used.
func (h *Handlers) PullEvents(ctx context.Context, userID uuid.UUID, since time.Time) (int, error) {
	creds, err := h.ensureFreshCreds(ctx, userID)
	if err != nil {
		return 0, err
	}
	now := h.Now().UTC()
	timeMin := now.AddDate(0, 0, -7)
	timeMax := now.AddDate(0, 3, 0)
	updatedMin := since
	dtos, err := h.Google.ListEvents(ctx, creds.AccessToken, creds.CalendarID, timeMin, timeMax, updatedMin)
	if err != nil {
		return 0, fmt.Errorf("google.ListEvents: %w", err)
	}
	count := 0
	for _, d := range dtos {
		if d.Status == "cancelled" {
			if err := h.Events.MarkDeleted(ctx, userID, d.ID, now); err != nil {
				if h.Log != nil {
					h.Log.WarnContext(ctx, "google_calendar: mark deleted failed", slog.String("google_event_id", d.ID), slog.Any("err", err))
				}
				continue
			}
			count++
			continue
		}
		ev := domain.Event{
			ID:            uuid.New(),
			UserID:        userID,
			GoogleEventID: d.ID,
			GoogleEtag:    d.Etag,
			Title:         d.Summary,
			Start:         d.Start,
			End:           d.End,
			Description:   d.Description,
			LastSyncedAt:  now,
		}
		if _, err := h.Events.Upsert(ctx, ev); err != nil {
			if h.Log != nil {
				h.Log.WarnContext(ctx, "google_calendar: events.Upsert failed", slog.String("google_event_id", d.ID), slog.Any("err", err))
			}
			continue
		}
		count++
	}
	return count, nil
}

// PushEvent — create or update a Google event. When in.GoogleEventID is
// empty we POST insert; otherwise we PATCH the existing id.
func (h *Handlers) PushEvent(ctx context.Context, userID uuid.UUID, in domain.EventInput) (domain.Event, error) {
	if strings.TrimSpace(in.Title) == "" {
		return domain.Event{}, fmt.Errorf("title required: %w", domain.ErrInvalidPayload)
	}
	if in.End.Before(in.Start) {
		return domain.Event{}, fmt.Errorf("end before start: %w", domain.ErrInvalidPayload)
	}
	creds, err := h.ensureFreshCreds(ctx, userID)
	if err != nil {
		return domain.Event{}, err
	}
	var dto domain.GoogleEventDTO
	if in.GoogleEventID == "" {
		dto, err = h.Google.InsertEvent(ctx, creds.AccessToken, creds.CalendarID, in)
	} else {
		dto, err = h.Google.PatchEvent(ctx, creds.AccessToken, creds.CalendarID, in.GoogleEventID, in)
	}
	if err != nil {
		return domain.Event{}, fmt.Errorf("google.Insert/Patch: %w", err)
	}
	ev := domain.Event{
		ID:            uuid.New(),
		UserID:        userID,
		GoogleEventID: dto.ID,
		GoogleEtag:    dto.Etag,
		Title:         dto.Summary,
		Start:         dto.Start,
		End:           dto.End,
		Description:   dto.Description,
		LastSyncedAt:  h.Now().UTC(),
	}
	out, err := h.Events.Upsert(ctx, ev)
	if err != nil {
		return domain.Event{}, fmt.Errorf("events.Upsert: %w", err)
	}
	return out, nil
}

// DeleteEvent — remove event at Google + soft-delete locally.
func (h *Handlers) DeleteEvent(ctx context.Context, userID uuid.UUID, googleEventID string) error {
	if strings.TrimSpace(googleEventID) == "" {
		return fmt.Errorf("google_event_id required: %w", domain.ErrInvalidPayload)
	}
	creds, err := h.ensureFreshCreds(ctx, userID)
	if err != nil {
		return err
	}
	if err := h.Google.DeleteEvent(ctx, creds.AccessToken, creds.CalendarID, googleEventID); err != nil {
		return fmt.Errorf("google.DeleteEvent: %w", err)
	}
	if err := h.Events.MarkDeleted(ctx, userID, googleEventID, h.Now().UTC()); err != nil {
		return fmt.Errorf("events.MarkDeleted: %w", err)
	}
	return nil
}

// SyncResult — output of a single sync round (pull + push placeholder).
type SyncResult struct {
	Pulled int
	Pushed int
}

// SyncEvents — convenience: pull-only for MVP. Push is per-event via the
// PushEvent call from Hone Calendar surface; future post-MVP может добавить
// outbox для bulk-push.
func (h *Handlers) SyncEvents(ctx context.Context, userID uuid.UUID) (SyncResult, error) {
	last, err := h.Events.LastSyncedAt(ctx, userID)
	if err != nil && !errors.Is(err, domain.ErrNotFound) {
		return SyncResult{}, fmt.Errorf("LastSyncedAt: %w", err)
	}
	pulled, err := h.PullEvents(ctx, userID, last)
	if err != nil {
		return SyncResult{}, err
	}
	return SyncResult{Pulled: pulled, Pushed: 0}, nil
}

// ListEvents — read-side projection: events in [from, to] from local mirror.
// Window-clamped server-side to keep payloads bounded.
func (h *Handlers) ListEvents(ctx context.Context, userID uuid.UUID, from, to time.Time) ([]domain.Event, error) {
	if from.IsZero() {
		from = h.Now().UTC().AddDate(0, 0, -7)
	}
	if to.IsZero() {
		to = h.Now().UTC().AddDate(0, 3, 0)
	}
	if to.Before(from) {
		return nil, fmt.Errorf("to before from: %w", domain.ErrInvalidPayload)
	}
	out, err := h.Events.List(ctx, userID, from, to)
	if err != nil {
		return nil, fmt.Errorf("events.List: %w", err)
	}
	return out, nil
}

// ensureFreshCreds loads credentials and triggers refresh-rotation when
// the access token is near expiry. Rotated tokens are persisted before
// returning so concurrent callers don't all refresh at once.
func (h *Handlers) ensureFreshCreds(ctx context.Context, userID uuid.UUID) (domain.GoogleCredentials, error) {
	creds, err := h.Creds.Get(ctx, userID)
	if err != nil {
		if errors.Is(err, domain.ErrNotFound) {
			return domain.GoogleCredentials{}, domain.ErrNotConnected
		}
		return domain.GoogleCredentials{}, fmt.Errorf("creds.Get: %w", err)
	}
	if !creds.Expired(h.Now()) {
		return creds, nil
	}
	newAccess, newExpiry, newRefresh, err := h.Google.RefreshToken(ctx, creds.RefreshToken)
	if err != nil {
		return domain.GoogleCredentials{}, fmt.Errorf("%w: %v", domain.ErrTokenRefresh, err)
	}
	creds.AccessToken = newAccess
	creds.Expiry = newExpiry
	if newRefresh != "" {
		creds.RefreshToken = newRefresh
	}
	creds.UpdatedAt = h.Now().UTC()
	if err := h.Creds.Upsert(ctx, creds); err != nil {
		return domain.GoogleCredentials{}, fmt.Errorf("creds.Upsert(refresh): %w", err)
	}
	return creds, nil
}

func randomState() (string, error) {
	b := make([]byte, 24)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}
