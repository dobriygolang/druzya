package app

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"druz9/google_calendar/domain"

	"github.com/google/uuid"
)

// ---- in-memory fakes ---------------------------------------------------

type fakeCreds struct {
	rows map[uuid.UUID]domain.GoogleCredentials
}

func newFakeCreds() *fakeCreds { return &fakeCreds{rows: map[uuid.UUID]domain.GoogleCredentials{}} }

func (f *fakeCreds) Upsert(_ context.Context, c domain.GoogleCredentials) error {
	f.rows[c.UserID] = c
	return nil
}

func (f *fakeCreds) Get(_ context.Context, id uuid.UUID) (domain.GoogleCredentials, error) {
	c, ok := f.rows[id]
	if !ok {
		return domain.GoogleCredentials{}, domain.ErrNotFound
	}
	return c, nil
}

func (f *fakeCreds) Delete(_ context.Context, id uuid.UUID) error {
	delete(f.rows, id)
	return nil
}

func (f *fakeCreds) ListConnected(_ context.Context) ([]uuid.UUID, error) {
	out := make([]uuid.UUID, 0, len(f.rows))
	for k := range f.rows {
		out = append(out, k)
	}
	return out, nil
}

type fakeEvents struct {
	rows map[string]domain.Event // key = userID|googleEventID
}

func newFakeEvents() *fakeEvents { return &fakeEvents{rows: map[string]domain.Event{}} }

func evkey(uid uuid.UUID, gid string) string { return uid.String() + "|" + gid }

func (f *fakeEvents) Upsert(_ context.Context, e domain.Event) (domain.Event, error) {
	k := evkey(e.UserID, e.GoogleEventID)
	if prev, ok := f.rows[k]; ok {
		e.ID = prev.ID
	}
	f.rows[k] = e
	return e, nil
}

func (f *fakeEvents) MarkDeleted(_ context.Context, userID uuid.UUID, gid string, when time.Time) error {
	k := evkey(userID, gid)
	if e, ok := f.rows[k]; ok {
		t := when
		e.DeletedAt = &t
		f.rows[k] = e
	}
	return nil
}

func (f *fakeEvents) List(_ context.Context, userID uuid.UUID, from, to time.Time) ([]domain.Event, error) {
	var out []domain.Event
	for _, e := range f.rows {
		if e.UserID != userID || e.DeletedAt != nil {
			continue
		}
		if e.Start.Before(from) || e.Start.After(to) {
			continue
		}
		out = append(out, e)
	}
	return out, nil
}

func (f *fakeEvents) LastSyncedAt(_ context.Context, userID uuid.UUID) (time.Time, error) {
	var max time.Time
	for _, e := range f.rows {
		if e.UserID != userID {
			continue
		}
		if e.LastSyncedAt.After(max) {
			max = e.LastSyncedAt
		}
	}
	if max.IsZero() {
		return time.Time{}, domain.ErrNotFound
	}
	return max, nil
}

type fakeAPI struct {
	exchanged    domain.GoogleCredentials
	listOut      []domain.GoogleEventDTO
	insertOut    domain.GoogleEventDTO
	patchOut     domain.GoogleEventDTO
	revokeCalled bool
	deletedID    string
}

func (f *fakeAPI) ExchangeCode(_ context.Context, code, _ string) (domain.GoogleCredentials, error) {
	if code == "" {
		return domain.GoogleCredentials{}, errors.New("empty code")
	}
	return f.exchanged, nil
}

func (f *fakeAPI) RefreshToken(_ context.Context, _ string) (string, time.Time, string, error) {
	return "refreshed-access", time.Now().Add(1 * time.Hour), "", nil
}

func (f *fakeAPI) RevokeToken(_ context.Context, _ string) error {
	f.revokeCalled = true
	return nil
}

func (f *fakeAPI) ListEvents(_ context.Context, _, _ string, _, _, _ time.Time) ([]domain.GoogleEventDTO, error) {
	return f.listOut, nil
}

func (f *fakeAPI) InsertEvent(_ context.Context, _, _ string, _ domain.EventInput) (domain.GoogleEventDTO, error) {
	return f.insertOut, nil
}

func (f *fakeAPI) PatchEvent(_ context.Context, _, _, _ string, _ domain.EventInput) (domain.GoogleEventDTO, error) {
	return f.patchOut, nil
}

func (f *fakeAPI) DeleteEvent(_ context.Context, _, _, gid string) error {
	f.deletedID = gid
	return nil
}

func (f *fakeAPI) AuthURL(state, redirectURI string) string {
	return "https://accounts.google.com/o/oauth2/v2/auth?state=" + state + "&redirect_uri=" + redirectURI
}

type fakeState struct {
	rows map[string]uuid.UUID
}

func newFakeState() *fakeState { return &fakeState{rows: map[string]uuid.UUID{}} }

func (f *fakeState) Put(_ context.Context, state string, uid uuid.UUID, _ time.Duration) error {
	f.rows[state] = uid
	return nil
}

func (f *fakeState) Consume(_ context.Context, state string) (uuid.UUID, error) {
	uid, ok := f.rows[state]
	if !ok {
		return uuid.Nil, domain.ErrInvalidState
	}
	delete(f.rows, state)
	return uid, nil
}

// ---- tests --------------------------------------------------------------

func newTestHandlers() (*Handlers, *fakeCreds, *fakeEvents, *fakeAPI, *fakeState) {
	creds := newFakeCreds()
	events := newFakeEvents()
	api := &fakeAPI{}
	st := newFakeState()
	h := New(creds, events, api, st, nil)
	fixed := time.Date(2026, 5, 12, 12, 0, 0, 0, time.UTC)
	h.Now = func() time.Time { return fixed }
	return h, creds, events, api, st
}

func TestGetConnectionStatus_NotConnected(t *testing.T) {
	h, _, _, _, _ := newTestHandlers()
	info, err := h.GetConnectionStatus(context.Background(), uuid.New())
	if err != nil {
		t.Fatalf("unexpected err: %v", err)
	}
	if info.Connected {
		t.Fatalf("expected disconnected")
	}
}

func TestStartAndCompleteOAuth(t *testing.T) {
	h, creds, _, api, _ := newTestHandlers()
	uid := uuid.New()
	api.exchanged = domain.GoogleCredentials{
		AccessToken:  "at",
		RefreshToken: "rt",
		Expiry:       time.Date(2026, 5, 12, 13, 0, 0, 0, time.UTC),
	}
	authURL, state, err := h.StartOAuth(context.Background(), uid, "https://example.com/cb")
	if err != nil {
		t.Fatalf("start: %v", err)
	}
	if !strings.Contains(authURL, "state=") || state == "" {
		t.Fatalf("bad authURL/state: %s %s", authURL, state)
	}
	gotUID, info, err := h.CompleteOAuth(context.Background(), "code123", state, "https://example.com/cb")
	if err != nil {
		t.Fatalf("complete: %v", err)
	}
	if gotUID != uid {
		t.Fatalf("uid mismatch")
	}
	if !info.Connected || info.CalendarID != "primary" {
		t.Fatalf("bad info: %+v", info)
	}
	stored, _ := creds.Get(context.Background(), uid)
	if stored.AccessToken != "at" {
		t.Fatalf("creds not stored: %+v", stored)
	}
}

func TestCompleteOAuth_BadState(t *testing.T) {
	h, _, _, _, _ := newTestHandlers()
	_, _, err := h.CompleteOAuth(context.Background(), "c", "non-existent", "rurl")
	if !errors.Is(err, domain.ErrInvalidState) {
		t.Fatalf("expected ErrInvalidState, got %v", err)
	}
}

func TestPullEvents_UpsertsAndCancelsSoftDelete(t *testing.T) {
	h, creds, events, api, _ := newTestHandlers()
	uid := uuid.New()
	_ = creds.Upsert(context.Background(), domain.GoogleCredentials{
		UserID: uid, AccessToken: "at", RefreshToken: "rt",
		Expiry: time.Date(2026, 5, 12, 13, 0, 0, 0, time.UTC),
		CalendarID: "primary",
	})
	api.listOut = []domain.GoogleEventDTO{
		{ID: "g1", Etag: "e1", Summary: "Standup", Start: time.Date(2026, 5, 13, 9, 0, 0, 0, time.UTC), End: time.Date(2026, 5, 13, 9, 15, 0, 0, time.UTC), Status: "confirmed"},
		{ID: "g2", Status: "cancelled"},
	}
	n, err := h.PullEvents(context.Background(), uid, time.Time{})
	if err != nil {
		t.Fatalf("pull: %v", err)
	}
	if n != 2 {
		t.Fatalf("expected 2, got %d", n)
	}
	if _, ok := events.rows[evkey(uid, "g1")]; !ok {
		t.Fatalf("g1 not stored")
	}
}

func TestPushEvent_Insert(t *testing.T) {
	h, creds, _, api, _ := newTestHandlers()
	uid := uuid.New()
	_ = creds.Upsert(context.Background(), domain.GoogleCredentials{
		UserID: uid, AccessToken: "at", RefreshToken: "rt",
		Expiry: time.Date(2026, 5, 12, 13, 0, 0, 0, time.UTC),
		CalendarID: "primary",
	})
	api.insertOut = domain.GoogleEventDTO{
		ID: "g-new", Etag: "et", Summary: "Mock interview",
		Start: time.Date(2026, 5, 12, 15, 0, 0, 0, time.UTC),
		End:   time.Date(2026, 5, 12, 16, 0, 0, 0, time.UTC),
	}
	ev, err := h.PushEvent(context.Background(), uid, domain.EventInput{
		Title: "Mock interview",
		Start: time.Date(2026, 5, 12, 15, 0, 0, 0, time.UTC),
		End:   time.Date(2026, 5, 12, 16, 0, 0, 0, time.UTC),
	})
	if err != nil {
		t.Fatalf("push: %v", err)
	}
	if ev.GoogleEventID != "g-new" {
		t.Fatalf("event id mismatch: %+v", ev)
	}
}

func TestPushEvent_RequiresConnection(t *testing.T) {
	h, _, _, _, _ := newTestHandlers()
	_, err := h.PushEvent(context.Background(), uuid.New(), domain.EventInput{Title: "x", Start: time.Now(), End: time.Now().Add(1 * time.Hour)})
	if !errors.Is(err, domain.ErrNotConnected) {
		t.Fatalf("expected ErrNotConnected, got %v", err)
	}
}

func TestEnsureFreshCreds_RefreshesExpired(t *testing.T) {
	h, creds, _, _, _ := newTestHandlers()
	uid := uuid.New()
	_ = creds.Upsert(context.Background(), domain.GoogleCredentials{
		UserID: uid, AccessToken: "old", RefreshToken: "rt",
		Expiry: time.Date(2026, 5, 12, 11, 0, 0, 0, time.UTC), // older than Now()
		CalendarID: "primary",
	})
	got, err := h.ensureFreshCreds(context.Background(), uid)
	if err != nil {
		t.Fatalf("ensure: %v", err)
	}
	if got.AccessToken != "refreshed-access" {
		t.Fatalf("token not refreshed: %+v", got)
	}
}

func TestDisconnect_Idempotent(t *testing.T) {
	h, _, _, _, _ := newTestHandlers()
	if err := h.Disconnect(context.Background(), uuid.New()); err != nil {
		t.Fatalf("disconnect on missing should be idempotent, got %v", err)
	}
}

func TestDisconnect_RevokesAndDeletes(t *testing.T) {
	h, creds, _, api, _ := newTestHandlers()
	uid := uuid.New()
	_ = creds.Upsert(context.Background(), domain.GoogleCredentials{
		UserID: uid, AccessToken: "at", RefreshToken: "rt",
		Expiry: time.Date(2026, 5, 12, 13, 0, 0, 0, time.UTC),
	})
	if err := h.Disconnect(context.Background(), uid); err != nil {
		t.Fatalf("disconnect: %v", err)
	}
	if !api.revokeCalled {
		t.Fatalf("revoke not called")
	}
	if _, err := creds.Get(context.Background(), uid); !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("expected row deleted")
	}
}

func TestDeleteEvent(t *testing.T) {
	h, creds, _, api, _ := newTestHandlers()
	uid := uuid.New()
	_ = creds.Upsert(context.Background(), domain.GoogleCredentials{
		UserID: uid, AccessToken: "at", RefreshToken: "rt",
		Expiry: time.Date(2026, 5, 12, 13, 0, 0, 0, time.UTC), CalendarID: "primary",
	})
	if err := h.DeleteEvent(context.Background(), uid, "g-id"); err != nil {
		t.Fatalf("delete: %v", err)
	}
	if api.deletedID != "g-id" {
		t.Fatalf("delete not propagated to google api")
	}
}

func TestListEvents_FiltersByWindow(t *testing.T) {
	h, _, events, _, _ := newTestHandlers()
	uid := uuid.New()
	now := h.Now()
	_, _ = events.Upsert(context.Background(), domain.Event{
		ID: uuid.New(), UserID: uid, GoogleEventID: "g1",
		Title: "in", Start: now.Add(1 * time.Hour), End: now.Add(2 * time.Hour),
	})
	_, _ = events.Upsert(context.Background(), domain.Event{
		ID: uuid.New(), UserID: uid, GoogleEventID: "g2",
		Title: "out", Start: now.Add(200 * 24 * time.Hour), End: now.Add(201 * 24 * time.Hour),
	})
	list, err := h.ListEvents(context.Background(), uid, time.Time{}, time.Time{})
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(list) != 1 || list[0].GoogleEventID != "g1" {
		t.Fatalf("bad list: %+v", list)
	}
}
