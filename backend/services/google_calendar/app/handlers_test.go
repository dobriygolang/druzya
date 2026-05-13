package app

import (
	"context"
	"errors"
	"strings"
	"sync"
	"testing"
	"time"

	"druz9/google_calendar/domain"
	gcmocks "druz9/google_calendar/domain/mocks"

	"github.com/google/uuid"
	"go.uber.org/mock/gomock"
)

// ---- store types + wire functions --------------------------------------
//
// Closure-state via DoAndReturn: каждый store отвечает за одну concrete
// stateful семантику CRUD. mocks делегируют store'ам.

type credStore struct {
	mu   sync.Mutex
	rows map[uuid.UUID]domain.GoogleCredentials
}

func newCredStore() *credStore { return &credStore{rows: map[uuid.UUID]domain.GoogleCredentials{}} }

func wireMockCredsRepo(ctrl *gomock.Controller, s *credStore) *gcmocks.MockCredentialsRepo {
	m := gcmocks.NewMockCredentialsRepo(ctrl)
	m.EXPECT().Upsert(gomock.Any(), gomock.Any()).DoAndReturn(
		func(_ context.Context, c domain.GoogleCredentials) error {
			s.mu.Lock()
			defer s.mu.Unlock()
			s.rows[c.UserID] = c
			return nil
		},
	).AnyTimes()
	m.EXPECT().Get(gomock.Any(), gomock.Any()).DoAndReturn(
		func(_ context.Context, id uuid.UUID) (domain.GoogleCredentials, error) {
			s.mu.Lock()
			defer s.mu.Unlock()
			c, ok := s.rows[id]
			if !ok {
				return domain.GoogleCredentials{}, domain.ErrNotFound
			}
			return c, nil
		},
	).AnyTimes()
	m.EXPECT().Delete(gomock.Any(), gomock.Any()).DoAndReturn(
		func(_ context.Context, id uuid.UUID) error {
			s.mu.Lock()
			defer s.mu.Unlock()
			delete(s.rows, id)
			return nil
		},
	).AnyTimes()
	m.EXPECT().ListConnected(gomock.Any()).DoAndReturn(
		func(_ context.Context) ([]uuid.UUID, error) {
			s.mu.Lock()
			defer s.mu.Unlock()
			out := make([]uuid.UUID, 0, len(s.rows))
			for k := range s.rows {
				out = append(out, k)
			}
			return out, nil
		},
	).AnyTimes()
	return m
}

type eventsStore struct {
	mu   sync.Mutex
	rows map[string]domain.Event // key = userID|googleEventID
}

func newEventsStore() *eventsStore { return &eventsStore{rows: map[string]domain.Event{}} }

func evkey(uid uuid.UUID, gid string) string { return uid.String() + "|" + gid }

func wireMockEventsRepo(ctrl *gomock.Controller, s *eventsStore) *gcmocks.MockEventsRepo {
	m := gcmocks.NewMockEventsRepo(ctrl)
	m.EXPECT().Upsert(gomock.Any(), gomock.Any()).DoAndReturn(
		func(_ context.Context, e domain.Event) (domain.Event, error) {
			s.mu.Lock()
			defer s.mu.Unlock()
			k := evkey(e.UserID, e.GoogleEventID)
			if prev, ok := s.rows[k]; ok {
				e.ID = prev.ID
			}
			s.rows[k] = e
			return e, nil
		},
	).AnyTimes()
	m.EXPECT().MarkDeleted(gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any()).DoAndReturn(
		func(_ context.Context, userID uuid.UUID, gid string, when time.Time) error {
			s.mu.Lock()
			defer s.mu.Unlock()
			k := evkey(userID, gid)
			if e, ok := s.rows[k]; ok {
				t := when
				e.DeletedAt = &t
				s.rows[k] = e
			}
			return nil
		},
	).AnyTimes()
	m.EXPECT().List(gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any()).DoAndReturn(
		func(_ context.Context, userID uuid.UUID, from, to time.Time) ([]domain.Event, error) {
			s.mu.Lock()
			defer s.mu.Unlock()
			var out []domain.Event
			for _, e := range s.rows {
				if e.UserID != userID || e.DeletedAt != nil {
					continue
				}
				if e.Start.Before(from) || e.Start.After(to) {
					continue
				}
				out = append(out, e)
			}
			return out, nil
		},
	).AnyTimes()
	m.EXPECT().LastSyncedAt(gomock.Any(), gomock.Any()).DoAndReturn(
		func(_ context.Context, userID uuid.UUID) (time.Time, error) {
			s.mu.Lock()
			defer s.mu.Unlock()
			var max time.Time
			for _, e := range s.rows {
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
		},
	).AnyTimes()
	return m
}

type apiState struct {
	mu           sync.Mutex
	exchanged    domain.GoogleCredentials
	listOut      []domain.GoogleEventDTO
	insertOut    domain.GoogleEventDTO
	patchOut     domain.GoogleEventDTO
	revokeCalled bool
	deletedID    string
}

func newAPIState() *apiState { return &apiState{} }

func wireMockGoogleAPI(ctrl *gomock.Controller, s *apiState) *gcmocks.MockGoogleAPI {
	m := gcmocks.NewMockGoogleAPI(ctrl)
	m.EXPECT().ExchangeCode(gomock.Any(), gomock.Any(), gomock.Any()).DoAndReturn(
		func(_ context.Context, code, _ string) (domain.GoogleCredentials, error) {
			if code == "" {
				return domain.GoogleCredentials{}, errors.New("empty code")
			}
			s.mu.Lock()
			defer s.mu.Unlock()
			return s.exchanged, nil
		},
	).AnyTimes()
	m.EXPECT().RefreshToken(gomock.Any(), gomock.Any()).DoAndReturn(
		func(_ context.Context, _ string) (string, time.Time, string, error) {
			return "refreshed-access", time.Now().Add(1 * time.Hour), "", nil
		},
	).AnyTimes()
	m.EXPECT().RevokeToken(gomock.Any(), gomock.Any()).DoAndReturn(
		func(_ context.Context, _ string) error {
			s.mu.Lock()
			defer s.mu.Unlock()
			s.revokeCalled = true
			return nil
		},
	).AnyTimes()
	m.EXPECT().ListEvents(gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any()).DoAndReturn(
		func(_ context.Context, _, _ string, _, _, _ time.Time) ([]domain.GoogleEventDTO, error) {
			s.mu.Lock()
			defer s.mu.Unlock()
			return s.listOut, nil
		},
	).AnyTimes()
	m.EXPECT().InsertEvent(gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any()).DoAndReturn(
		func(_ context.Context, _, _ string, _ domain.EventInput) (domain.GoogleEventDTO, error) {
			s.mu.Lock()
			defer s.mu.Unlock()
			return s.insertOut, nil
		},
	).AnyTimes()
	m.EXPECT().PatchEvent(gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any()).DoAndReturn(
		func(_ context.Context, _, _, _ string, _ domain.EventInput) (domain.GoogleEventDTO, error) {
			s.mu.Lock()
			defer s.mu.Unlock()
			return s.patchOut, nil
		},
	).AnyTimes()
	m.EXPECT().DeleteEvent(gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any()).DoAndReturn(
		func(_ context.Context, _, _, gid string) error {
			s.mu.Lock()
			defer s.mu.Unlock()
			s.deletedID = gid
			return nil
		},
	).AnyTimes()
	m.EXPECT().AuthURL(gomock.Any(), gomock.Any()).DoAndReturn(
		func(state, redirectURI string) string {
			return "https://accounts.google.com/o/oauth2/v2/auth?state=" + state + "&redirect_uri=" + redirectURI
		},
	).AnyTimes()
	return m
}

type stateStore struct {
	mu   sync.Mutex
	rows map[string]uuid.UUID
}

func newStateStore() *stateStore { return &stateStore{rows: map[string]uuid.UUID{}} }

func wireMockStateStore(ctrl *gomock.Controller, s *stateStore) *gcmocks.MockStateStore {
	m := gcmocks.NewMockStateStore(ctrl)
	m.EXPECT().Put(gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any()).DoAndReturn(
		func(_ context.Context, state string, uid uuid.UUID, _ time.Duration) error {
			s.mu.Lock()
			defer s.mu.Unlock()
			s.rows[state] = uid
			return nil
		},
	).AnyTimes()
	m.EXPECT().Consume(gomock.Any(), gomock.Any()).DoAndReturn(
		func(_ context.Context, state string) (uuid.UUID, error) {
			s.mu.Lock()
			defer s.mu.Unlock()
			uid, ok := s.rows[state]
			if !ok {
				return uuid.Nil, domain.ErrInvalidState
			}
			delete(s.rows, state)
			return uid, nil
		},
	).AnyTimes()
	return m
}

// ---- tests --------------------------------------------------------------

func newTestHandlers(t *testing.T) (*Handlers, *credStore, *eventsStore, *apiState, *stateStore) {
	t.Helper()
	ctrl := gomock.NewController(t)
	creds := newCredStore()
	events := newEventsStore()
	api := newAPIState()
	st := newStateStore()
	h := New(
		wireMockCredsRepo(ctrl, creds),
		wireMockEventsRepo(ctrl, events),
		wireMockGoogleAPI(ctrl, api),
		wireMockStateStore(ctrl, st),
		nil,
	)
	fixed := time.Date(2026, 5, 12, 12, 0, 0, 0, time.UTC)
	h.Now = func() time.Time { return fixed }
	return h, creds, events, api, st
}

func TestGetConnectionStatus_NotConnected(t *testing.T) {
	h, _, _, _, _ := newTestHandlers(t)
	info, err := h.GetConnectionStatus(context.Background(), uuid.New())
	if err != nil {
		t.Fatalf("unexpected err: %v", err)
	}
	if info.Connected {
		t.Fatalf("expected disconnected")
	}
}

func TestStartAndCompleteOAuth(t *testing.T) {
	h, creds, _, api, _ := newTestHandlers(t)
	uid := uuid.New()
	api.mu.Lock()
	api.exchanged = domain.GoogleCredentials{
		AccessToken:  "at",
		RefreshToken: "rt",
		Expiry:       time.Date(2026, 5, 12, 13, 0, 0, 0, time.UTC),
	}
	api.mu.Unlock()
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
	creds.mu.Lock()
	stored := creds.rows[uid]
	creds.mu.Unlock()
	if stored.AccessToken != "at" {
		t.Fatalf("creds not stored: %+v", stored)
	}
}

func TestCompleteOAuth_BadState(t *testing.T) {
	h, _, _, _, _ := newTestHandlers(t)
	_, _, err := h.CompleteOAuth(context.Background(), "c", "non-existent", "rurl")
	if !errors.Is(err, domain.ErrInvalidState) {
		t.Fatalf("expected ErrInvalidState, got %v", err)
	}
}

func TestPullEvents_UpsertsAndCancelsSoftDelete(t *testing.T) {
	h, creds, events, api, _ := newTestHandlers(t)
	uid := uuid.New()
	creds.mu.Lock()
	creds.rows[uid] = domain.GoogleCredentials{
		UserID: uid, AccessToken: "at", RefreshToken: "rt",
		Expiry: time.Date(2026, 5, 12, 13, 0, 0, 0, time.UTC),
		CalendarID: "primary",
	}
	creds.mu.Unlock()
	api.mu.Lock()
	api.listOut = []domain.GoogleEventDTO{
		{ID: "g1", Etag: "e1", Summary: "Standup", Start: time.Date(2026, 5, 13, 9, 0, 0, 0, time.UTC), End: time.Date(2026, 5, 13, 9, 15, 0, 0, time.UTC), Status: "confirmed"},
		{ID: "g2", Status: "cancelled"},
	}
	api.mu.Unlock()
	n, err := h.PullEvents(context.Background(), uid, time.Time{})
	if err != nil {
		t.Fatalf("pull: %v", err)
	}
	if n != 2 {
		t.Fatalf("expected 2, got %d", n)
	}
	events.mu.Lock()
	defer events.mu.Unlock()
	if _, ok := events.rows[evkey(uid, "g1")]; !ok {
		t.Fatalf("g1 not stored")
	}
}

func TestPushEvent_Insert(t *testing.T) {
	h, creds, _, api, _ := newTestHandlers(t)
	uid := uuid.New()
	creds.mu.Lock()
	creds.rows[uid] = domain.GoogleCredentials{
		UserID: uid, AccessToken: "at", RefreshToken: "rt",
		Expiry: time.Date(2026, 5, 12, 13, 0, 0, 0, time.UTC),
		CalendarID: "primary",
	}
	creds.mu.Unlock()
	api.mu.Lock()
	api.insertOut = domain.GoogleEventDTO{
		ID: "g-new", Etag: "et", Summary: "Mock interview",
		Start: time.Date(2026, 5, 12, 15, 0, 0, 0, time.UTC),
		End:   time.Date(2026, 5, 12, 16, 0, 0, 0, time.UTC),
	}
	api.mu.Unlock()
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
	h, _, _, _, _ := newTestHandlers(t)
	_, err := h.PushEvent(context.Background(), uuid.New(), domain.EventInput{Title: "x", Start: time.Now(), End: time.Now().Add(1 * time.Hour)})
	if !errors.Is(err, domain.ErrNotConnected) {
		t.Fatalf("expected ErrNotConnected, got %v", err)
	}
}

func TestEnsureFreshCreds_RefreshesExpired(t *testing.T) {
	h, creds, _, _, _ := newTestHandlers(t)
	uid := uuid.New()
	creds.mu.Lock()
	creds.rows[uid] = domain.GoogleCredentials{
		UserID: uid, AccessToken: "old", RefreshToken: "rt",
		Expiry: time.Date(2026, 5, 12, 11, 0, 0, 0, time.UTC), // older than Now()
		CalendarID: "primary",
	}
	creds.mu.Unlock()
	got, err := h.ensureFreshCreds(context.Background(), uid)
	if err != nil {
		t.Fatalf("ensure: %v", err)
	}
	if got.AccessToken != "refreshed-access" {
		t.Fatalf("token not refreshed: %+v", got)
	}
}

func TestDisconnect_Idempotent(t *testing.T) {
	h, _, _, _, _ := newTestHandlers(t)
	if err := h.Disconnect(context.Background(), uuid.New()); err != nil {
		t.Fatalf("disconnect on missing should be idempotent, got %v", err)
	}
}

func TestDisconnect_RevokesAndDeletes(t *testing.T) {
	h, creds, _, api, _ := newTestHandlers(t)
	uid := uuid.New()
	creds.mu.Lock()
	creds.rows[uid] = domain.GoogleCredentials{
		UserID: uid, AccessToken: "at", RefreshToken: "rt",
		Expiry: time.Date(2026, 5, 12, 13, 0, 0, 0, time.UTC),
	}
	creds.mu.Unlock()
	if err := h.Disconnect(context.Background(), uid); err != nil {
		t.Fatalf("disconnect: %v", err)
	}
	api.mu.Lock()
	revoked := api.revokeCalled
	api.mu.Unlock()
	if !revoked {
		t.Fatalf("revoke not called")
	}
	creds.mu.Lock()
	_, ok := creds.rows[uid]
	creds.mu.Unlock()
	if ok {
		t.Fatalf("expected row deleted")
	}
}

func TestDeleteEvent(t *testing.T) {
	h, creds, _, api, _ := newTestHandlers(t)
	uid := uuid.New()
	creds.mu.Lock()
	creds.rows[uid] = domain.GoogleCredentials{
		UserID: uid, AccessToken: "at", RefreshToken: "rt",
		Expiry: time.Date(2026, 5, 12, 13, 0, 0, 0, time.UTC), CalendarID: "primary",
	}
	creds.mu.Unlock()
	if err := h.DeleteEvent(context.Background(), uid, "g-id"); err != nil {
		t.Fatalf("delete: %v", err)
	}
	api.mu.Lock()
	defer api.mu.Unlock()
	if api.deletedID != "g-id" {
		t.Fatalf("delete not propagated to google api")
	}
}

func TestListEvents_FiltersByWindow(t *testing.T) {
	h, _, events, _, _ := newTestHandlers(t)
	uid := uuid.New()
	now := h.Now()
	events.mu.Lock()
	events.rows[evkey(uid, "g1")] = domain.Event{
		ID: uuid.New(), UserID: uid, GoogleEventID: "g1",
		Title: "in", Start: now.Add(1 * time.Hour), End: now.Add(2 * time.Hour),
	}
	events.rows[evkey(uid, "g2")] = domain.Event{
		ID: uuid.New(), UserID: uid, GoogleEventID: "g2",
		Title: "out", Start: now.Add(200 * 24 * time.Hour), End: now.Add(201 * 24 * time.Hour),
	}
	events.mu.Unlock()
	list, err := h.ListEvents(context.Background(), uid, time.Time{}, time.Time{})
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(list) != 1 || list[0].GoogleEventID != "g1" {
		t.Fatalf("bad list: %+v", list)
	}
}
