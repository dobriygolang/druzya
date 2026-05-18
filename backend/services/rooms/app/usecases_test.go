package app

import (
	"context"
	"errors"
	"testing"
	"time"

	"druz9/rooms/domain"

	"github.com/google/uuid"
)

// fakeRepo — in-memory test double для domain.Repo.
type fakeRepo struct {
	rooms []domain.Room
}

func (r *fakeRepo) Create(_ context.Context, room domain.Room) (domain.Room, error) {
	if room.ID == uuid.Nil {
		room.ID = uuid.New()
	}
	if room.CreatedAt.IsZero() {
		room.CreatedAt = time.Now().UTC()
	}
	r.rooms = append(r.rooms, room)
	return room, nil
}

func (r *fakeRepo) Get(_ context.Context, kind domain.Kind, id uuid.UUID) (domain.Room, error) {
	for _, room := range r.rooms {
		if room.ID == id && room.Kind == kind {
			return room, nil
		}
	}
	return domain.Room{}, domain.ErrNotFound
}

func (r *fakeRepo) ListMy(_ context.Context, ownerID uuid.UUID, _ domain.Status) ([]domain.Room, error) {
	out := []domain.Room{}
	for _, room := range r.rooms {
		if room.OwnerID == ownerID {
			out = append(out, room)
		}
	}
	return out, nil
}

func (r *fakeRepo) ExtendExpiry(_ context.Context, kind domain.Kind, id uuid.UUID, exp time.Time) error {
	for i := range r.rooms {
		if r.rooms[i].ID == id && r.rooms[i].Kind == kind {
			r.rooms[i].ExpiresAt = exp
			return nil
		}
	}
	return domain.ErrNotFound
}

func (r *fakeRepo) Archive(_ context.Context, kind domain.Kind, id uuid.UUID, at time.Time) error {
	for i := range r.rooms {
		if r.rooms[i].ID == id && r.rooms[i].Kind == kind {
			r.rooms[i].ArchivedAt = &at
			return nil
		}
	}
	return domain.ErrNotFound
}

func (r *fakeRepo) Restore(_ context.Context, kind domain.Kind, id uuid.UUID) error {
	for i := range r.rooms {
		if r.rooms[i].ID == id && r.rooms[i].Kind == kind {
			r.rooms[i].ArchivedAt = nil
			return nil
		}
	}
	return domain.ErrNotFound
}

func (r *fakeRepo) ListExpiredCandidates(_ context.Context, before time.Time, _ int) ([]domain.Room, error) {
	out := []domain.Room{}
	for _, room := range r.rooms {
		if room.ArchivedAt == nil && room.ExpiresAt.Before(before) {
			out = append(out, room)
		}
	}
	return out, nil
}

// fakeQuota — quota repo test double.
type fakeQuota struct {
	count int
	tier  string
}

func (q *fakeQuota) Get(_ context.Context, _ uuid.UUID) (domain.Quota, error) {
	return domain.Quota{ActiveCount: q.count, Tier: q.tier}, nil
}
func (q *fakeQuota) Increment(_ context.Context, _ uuid.UUID, _ string) error { q.count++; return nil }
func (q *fakeQuota) Decrement(_ context.Context, _ uuid.UUID) error           { q.count--; return nil }
func (q *fakeQuota) Recompute(_ context.Context, _ uuid.UUID, _ int) error    { return nil }

// fakeAbuse — banned-user check.
type fakeAbuse struct{ blocked bool }

func (a *fakeAbuse) IsUserBlocked(_ context.Context, _ uuid.UUID) (bool, error) {
	return a.blocked, nil
}

func TestCreateRoom_RejectsInvalidKind(t *testing.T) {
	uc := CreateRoom{Repo: &fakeRepo{}, Quota: &fakeQuota{tier: "free"}}
	_, err := uc.Do(context.Background(), CreateRoomInput{
		UserID: uuid.New(), Kind: "invalid",
	})
	if !errors.Is(err, domain.ErrInvalidKind) {
		t.Fatalf("expected ErrInvalidKind, got %v", err)
	}
}

func TestCreateRoom_FreeQuotaBlocksAfterLimit(t *testing.T) {
	uc := CreateRoom{
		Repo:  &fakeRepo{},
		Quota: &fakeQuota{count: domain.FreeMaxActive, tier: "free"},
	}
	_, err := uc.Do(context.Background(), CreateRoomInput{
		UserID: uuid.New(), Kind: domain.KindCode,
	})
	if !errors.Is(err, domain.ErrQuotaExceeded) {
		t.Fatalf("expected ErrQuotaExceeded, got %v", err)
	}
}

func TestCreateRoom_BlockedUserRejected(t *testing.T) {
	uc := CreateRoom{
		Repo:  &fakeRepo{},
		Quota: &fakeQuota{tier: "free"},
		Abuse: &fakeAbuse{blocked: true},
	}
	_, err := uc.Do(context.Background(), CreateRoomInput{
		UserID: uuid.New(), Kind: domain.KindCode,
	})
	if !errors.Is(err, domain.ErrUserBlocked) {
		t.Fatalf("expected ErrUserBlocked, got %v", err)
	}
}

func TestCreateRoom_BypassQuotaSkipsCounter(t *testing.T) {
	q := &fakeQuota{count: domain.FreeMaxActive, tier: "free"}
	uc := CreateRoom{Repo: &fakeRepo{}, Quota: q, PublicBaseURL: "https://druz9.online"}
	out, err := uc.Do(context.Background(), CreateRoomInput{
		UserID: uuid.New(), Kind: domain.KindWhiteboard, BypassQuota: true,
	})
	if err != nil {
		t.Fatalf("unexpected: %v", err)
	}
	if out.Room.FreeTier {
		t.Error("BypassQuota should clear free_tier flag")
	}
	if q.count != domain.FreeMaxActive {
		t.Errorf("quota counter mutated: %d", q.count)
	}
}

func TestCreateRoom_ShareURLCorrectShape(t *testing.T) {
	uc := CreateRoom{
		Repo:          &fakeRepo{},
		Quota:         &fakeQuota{tier: "free"},
		PublicBaseURL: "https://druz9.online",
	}
	out, err := uc.Do(context.Background(), CreateRoomInput{
		UserID: uuid.New(), Kind: domain.KindCode,
	})
	if err != nil {
		t.Fatal(err)
	}
	if want := "https://druz9.online/editor/room/" + out.Room.ID.String(); out.ShareURL != want {
		t.Errorf("share URL mismatch: %s vs %s", out.ShareURL, want)
	}
}

func TestExtendRoom_RequiresPro(t *testing.T) {
	repo := &fakeRepo{}
	id := uuid.New()
	owner := uuid.New()
	repo.rooms = append(repo.rooms, domain.Room{ID: id, OwnerID: owner, Kind: domain.KindCode, ExpiresAt: time.Now().Add(time.Hour)})
	uc := ExtendRoom{Repo: repo, Quota: &fakeQuota{tier: "free"}}
	err := uc.Do(context.Background(), owner, domain.KindCode, id, 24)
	if !errors.Is(err, domain.ErrProRequired) {
		t.Fatalf("expected ErrProRequired, got %v", err)
	}
}

func TestDeleteRoom_DecrementsFreeQuota(t *testing.T) {
	id := uuid.New()
	owner := uuid.New()
	repo := &fakeRepo{rooms: []domain.Room{{ID: id, OwnerID: owner, Kind: domain.KindCode, FreeTier: true, ExpiresAt: time.Now().Add(time.Hour)}}}
	q := &fakeQuota{count: 2, tier: "free"}
	uc := DeleteRoom{Repo: repo, Quota: q}
	if err := uc.Do(context.Background(), owner, domain.KindCode, id); err != nil {
		t.Fatal(err)
	}
	if q.count != 1 {
		t.Errorf("expected count=1, got %d", q.count)
	}
}

func TestDeleteRoom_NotOwner(t *testing.T) {
	id := uuid.New()
	repo := &fakeRepo{rooms: []domain.Room{{ID: id, OwnerID: uuid.New(), Kind: domain.KindCode, ExpiresAt: time.Now().Add(time.Hour)}}}
	uc := DeleteRoom{Repo: repo, Quota: &fakeQuota{}}
	err := uc.Do(context.Background(), uuid.New(), domain.KindCode, id)
	if !errors.Is(err, domain.ErrNotOwner) {
		t.Fatalf("expected ErrNotOwner, got %v", err)
	}
}

func TestRestoreRoom_OutsideWindow(t *testing.T) {
	id := uuid.New()
	owner := uuid.New()
	tooOld := time.Now().Add(-31 * 24 * time.Hour)
	repo := &fakeRepo{rooms: []domain.Room{{
		ID: id, OwnerID: owner, Kind: domain.KindCode, FreeTier: true,
		ExpiresAt: time.Now().Add(time.Hour), ArchivedAt: &tooOld,
	}}}
	uc := RestoreRoom{Repo: repo, Quota: &fakeQuota{tier: "free"}}
	err := uc.Do(context.Background(), owner, domain.KindCode, id)
	if err == nil || !contains(err.Error(), "restore window") {
		t.Fatalf("expected restore-window error, got %v", err)
	}
}

func TestSweepExpired_ArchivesAndDecrements(t *testing.T) {
	owner := uuid.New()
	expired := domain.Room{
		ID: uuid.New(), OwnerID: owner, Kind: domain.KindCode, FreeTier: true,
		ExpiresAt: time.Now().Add(-time.Hour),
	}
	repo := &fakeRepo{rooms: []domain.Room{expired}}
	q := &fakeQuota{count: 1, tier: "free"}
	uc := SweepExpired{Repo: repo, Quota: q}
	n, err := uc.Run(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if n != 1 {
		t.Errorf("expected 1 archived, got %d", n)
	}
	if q.count != 0 {
		t.Errorf("quota not decremented: %d", q.count)
	}
}

func contains(s, sub string) bool {
	for i := 0; i+len(sub) <= len(s); i++ {
		if s[i:i+len(sub)] == sub {
			return true
		}
	}
	return false
}
