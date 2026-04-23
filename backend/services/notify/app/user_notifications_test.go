package app

import (
	"context"
	"io"
	"log/slog"
	"sync"
	"testing"
	"time"

	"druz9/notify/domain"
	sharedDomain "druz9/shared/domain"

	"github.com/google/uuid"
)

// stubUserNotifRepo — in-memory.
type stubUserNotifRepo struct {
	mu     sync.Mutex
	rows   []domain.UserNotification
	nextID int64
}

func newStubRepo() *stubUserNotifRepo { return &stubUserNotifRepo{} }

func (s *stubUserNotifRepo) Insert(_ context.Context, n domain.UserNotification) (domain.UserNotification, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.nextID++
	n.ID = s.nextID
	n.CreatedAt = time.Now()
	s.rows = append(s.rows, n)
	return n, nil
}
func (s *stubUserNotifRepo) ListByUser(_ context.Context, uid uuid.UUID, f domain.NotificationFilter) ([]domain.UserNotification, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make([]domain.UserNotification, 0)
	for _, r := range s.rows {
		if r.UserID != uid {
			continue
		}
		if f.OnlyUnread && r.ReadAt != nil {
			continue
		}
		if f.Channel != "" && r.Channel != f.Channel {
			continue
		}
		out = append(out, r)
	}
	return out, nil
}
func (s *stubUserNotifRepo) MarkRead(_ context.Context, id int64, uid uuid.UUID) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	for i, r := range s.rows {
		if r.ID == id && r.UserID == uid && r.ReadAt == nil {
			t := time.Now()
			s.rows[i].ReadAt = &t
			return nil
		}
	}
	return nil
}
func (s *stubUserNotifRepo) MarkAllRead(_ context.Context, uid uuid.UUID) (int64, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	var n int64
	t := time.Now()
	for i, r := range s.rows {
		if r.UserID == uid && r.ReadAt == nil {
			s.rows[i].ReadAt = &t
			n++
		}
	}
	return n, nil
}
func (s *stubUserNotifRepo) CountUnread(_ context.Context, uid uuid.UUID) (int, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	n := 0
	for _, r := range s.rows {
		if r.UserID == uid && r.ReadAt == nil {
			n++
		}
	}
	return n, nil
}

type stubPrefsRepo struct {
	mu sync.Mutex
	m  map[uuid.UUID]domain.NotificationPrefs
}

func newStubPrefsRepo() *stubPrefsRepo {
	return &stubPrefsRepo{m: map[uuid.UUID]domain.NotificationPrefs{}}
}

func (s *stubPrefsRepo) Get(_ context.Context, uid uuid.UUID) (domain.NotificationPrefs, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if v, ok := s.m[uid]; ok {
		return v, nil
	}
	return domain.NotificationPrefs{UserID: uid, ChannelEnabled: map[string]bool{}}, nil
}
func (s *stubPrefsRepo) Upsert(_ context.Context, p domain.NotificationPrefs) (domain.NotificationPrefs, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	p.UpdatedAt = time.Now()
	s.m[p.UserID] = p
	return p, nil
}

func TestFeedHandlers_OnArenaMatchCompleted_WriteWinAndLoss(t *testing.T) {
	repo := newStubRepo()
	prefs := newStubPrefsRepo()
	h := NewFeedHandlers(repo, prefs, slog.New(slog.NewTextHandler(io.Discard, nil)))
	winner := uuid.New()
	loser := uuid.New()
	ev := sharedDomain.MatchCompleted{
		MatchID: uuid.New(), WinnerID: winner, LoserIDs: []uuid.UUID{loser},
		EloDeltas: map[uuid.UUID]int{winner: +18, loser: -16},
	}
	if err := h.OnArenaMatchCompleted(context.Background(), ev); err != nil {
		t.Fatalf("handle: %v", err)
	}
	rows, _ := repo.ListByUser(context.Background(), winner, domain.NotificationFilter{})
	if len(rows) != 1 || rows[0].Channel != "wins" {
		t.Fatalf("winner row mismatch: %+v", rows)
	}
	rows, _ = repo.ListByUser(context.Background(), loser, domain.NotificationFilter{})
	if len(rows) != 1 || rows[0].Channel != "match" {
		t.Fatalf("loser row mismatch: %+v", rows)
	}
}

func TestFeedHandlers_RespectsSilence(t *testing.T) {
	repo := newStubRepo()
	prefs := newStubPrefsRepo()
	uid := uuid.New()
	silence := time.Now().Add(time.Hour)
	_, _ = prefs.Upsert(context.Background(), domain.NotificationPrefs{
		UserID:       uid,
		SilenceUntil: &silence,
	})
	h := NewFeedHandlers(repo, prefs, slog.New(slog.NewTextHandler(io.Discard, nil)))
	ev := sharedDomain.MatchCompleted{
		MatchID: uuid.New(), WinnerID: uid,
		EloDeltas: map[uuid.UUID]int{uid: +20},
	}
	if err := h.OnArenaMatchCompleted(context.Background(), ev); err != nil {
		t.Fatalf("handle: %v", err)
	}
	rows, _ := repo.ListByUser(context.Background(), uid, domain.NotificationFilter{})
	if len(rows) != 0 {
		t.Fatalf("silenced user should not get rows: %+v", rows)
	}
}

func TestMarkRead_AndCount(t *testing.T) {
	repo := newStubRepo()
	uid := uuid.New()
	_, _ = repo.Insert(context.Background(), domain.UserNotification{UserID: uid, Channel: "x", Title: "y"})
	_, _ = repo.Insert(context.Background(), domain.UserNotification{UserID: uid, Channel: "x", Title: "z"})

	mr := &MarkRead{Repo: repo}
	mar := &MarkAllRead{Repo: repo}
	cu := &CountUnread{Repo: repo}
	rows, _ := repo.ListByUser(context.Background(), uid, domain.NotificationFilter{})
	if len(rows) != 2 {
		t.Fatalf("expected 2 rows seeded")
	}
	if n, _ := cu.Do(context.Background(), uid); n != 2 {
		t.Fatalf("expected 2 unread, got %d", n)
	}
	if err := mr.Do(context.Background(), rows[0].ID, uid); err != nil {
		t.Fatalf("mark single: %v", err)
	}
	if n, _ := cu.Do(context.Background(), uid); n != 1 {
		t.Fatalf("expected 1 unread after mark, got %d", n)
	}
	if got, _ := mar.Do(context.Background(), uid); got != 1 {
		t.Fatalf("expected 1 marked all, got %d", got)
	}
	if n, _ := cu.Do(context.Background(), uid); n != 0 {
		t.Fatalf("expected 0 unread after mark all, got %d", n)
	}
}
