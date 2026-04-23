package app

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	"druz9/friends/domain"
	sharedDomain "druz9/shared/domain"

	"github.com/google/uuid"
)

// stubRepo — простая in-memory реализация для тестов use case.
type stubRepo struct {
	mu    sync.Mutex
	pairs map[string]domain.Friendship // key=req|addr
	next  int64
}

func newStubRepo() *stubRepo { return &stubRepo{pairs: map[string]domain.Friendship{}} }

func key(a, b uuid.UUID) string { return a.String() + "|" + b.String() }

func (s *stubRepo) Add(_ context.Context, req, addr uuid.UUID) (domain.Friendship, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if req == addr {
		return domain.Friendship{}, domain.ErrSelfFriendship
	}
	if f, ok := s.pairs[key(req, addr)]; ok {
		return f, domain.ErrAlreadyExists
	}
	if f, ok := s.pairs[key(addr, req)]; ok {
		return f, domain.ErrAlreadyExists
	}
	s.next++
	f := domain.Friendship{ID: s.next, RequesterID: req, AddresseeID: addr,
		Status: domain.StatusPending, CreatedAt: time.Now()}
	s.pairs[key(req, addr)] = f
	return f, nil
}
func (s *stubRepo) Accept(_ context.Context, id int64, by uuid.UUID) (domain.Friendship, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for k, f := range s.pairs {
		if f.ID == id && f.AddresseeID == by && f.Status == domain.StatusPending {
			t := time.Now()
			f.Status = domain.StatusAccepted
			f.AcceptedAt = &t
			s.pairs[k] = f
			return f, nil
		}
	}
	return domain.Friendship{}, domain.ErrNotFound
}
func (s *stubRepo) Decline(_ context.Context, id int64, by uuid.UUID) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	for k, f := range s.pairs {
		if f.ID == id && f.AddresseeID == by && f.Status == domain.StatusPending {
			delete(s.pairs, k)
			return nil
		}
	}
	return domain.ErrNotFound
}
func (s *stubRepo) Block(_ context.Context, by, target uuid.UUID) error   { return nil }
func (s *stubRepo) Unblock(_ context.Context, by, target uuid.UUID) error { return nil }
func (s *stubRepo) Remove(_ context.Context, by, friend uuid.UUID) error  { return nil }
func (s *stubRepo) ListAccepted(_ context.Context, _ uuid.UUID) ([]domain.FriendListEntry, error) {
	return nil, nil
}
func (s *stubRepo) ListIncoming(_ context.Context, _ uuid.UUID) ([]domain.FriendListEntry, error) {
	return nil, nil
}
func (s *stubRepo) ListOutgoing(_ context.Context, _ uuid.UUID) ([]domain.FriendListEntry, error) {
	return nil, nil
}
func (s *stubRepo) ListBlocked(_ context.Context, _ uuid.UUID) ([]domain.FriendListEntry, error) {
	return nil, nil
}
func (s *stubRepo) GetIDByPair(_ context.Context, _, _ uuid.UUID) (int64, error) { return 0, nil }
func (s *stubRepo) Suggestions(_ context.Context, _ uuid.UUID, _ int) ([]domain.FriendListEntry, error) {
	return nil, nil
}

// captureBus — фиксирует все опубликованные events.
type captureBus struct {
	mu sync.Mutex
	ev []sharedDomain.Event
}

func (c *captureBus) Publish(_ context.Context, e sharedDomain.Event) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.ev = append(c.ev, e)
	return nil
}

func TestAddFriend_HappyPath(t *testing.T) {
	repo := newStubRepo()
	bus := &captureBus{}
	uc := &AddFriend{Repo: repo, Bus: bus}
	a, b := uuid.New(), uuid.New()
	f, err := uc.Do(context.Background(), a, AddInput{UserID: &b})
	if err != nil {
		t.Fatalf("add: %v", err)
	}
	if f.Status != domain.StatusPending {
		t.Fatalf("status: %s", f.Status)
	}
	if len(bus.ev) != 1 {
		t.Fatalf("expected 1 event, got %d", len(bus.ev))
	}
	if bus.ev[0].Topic() != "friends.RequestReceived" {
		t.Fatalf("wrong topic: %s", bus.ev[0].Topic())
	}
}

func TestAddFriend_Self(t *testing.T) {
	uc := &AddFriend{Repo: newStubRepo(), Bus: &captureBus{}}
	a := uuid.New()
	_, err := uc.Do(context.Background(), a, AddInput{UserID: &a})
	if !errors.Is(err, domain.ErrSelfFriendship) {
		t.Fatalf("expected ErrSelfFriendship, got %v", err)
	}
}

func TestAcceptFriend_Idempotent(t *testing.T) {
	repo := newStubRepo()
	bus := &captureBus{}
	a, b := uuid.New(), uuid.New()
	f, _ := repo.Add(context.Background(), a, b)
	uc := &AcceptFriend{Repo: repo, Bus: bus}
	got, err := uc.Do(context.Background(), f.ID, b)
	if err != nil {
		t.Fatalf("accept: %v", err)
	}
	if got.Status != domain.StatusAccepted {
		t.Fatalf("status: %s", got.Status)
	}
	if len(bus.ev) != 1 || bus.ev[0].Topic() != "friends.RequestAccepted" {
		t.Fatalf("event mismatch: %+v", bus.ev)
	}
}

func TestDeclineFriend_NotFound(t *testing.T) {
	repo := newStubRepo()
	uc := &DeclineFriend{Repo: repo}
	if err := uc.Do(context.Background(), 999, uuid.New()); !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("expected ErrNotFound, got %v", err)
	}
}

// stubCodes — для проверки resolve через code.
type stubCodes struct {
	uid uuid.UUID
	err error
}

func (s stubCodes) Generate(_ context.Context, _ uuid.UUID) (domain.FriendCode, error) {
	return domain.FriendCode{UserID: s.uid, Code: "DRUZ9-ABCD-EFG", ExpiresAt: time.Now().Add(time.Hour)}, nil
}
func (s stubCodes) Resolve(_ context.Context, _ string) (uuid.UUID, error) {
	return s.uid, s.err
}

func TestAddFriend_ViaCode(t *testing.T) {
	target := uuid.New()
	repo := newStubRepo()
	uc := &AddFriend{Repo: repo, Codes: stubCodes{uid: target}, Bus: &captureBus{}}
	requester := uuid.New()
	f, err := uc.Do(context.Background(), requester, AddInput{Code: "X"})
	if err != nil {
		t.Fatalf("add via code: %v", err)
	}
	if f.RequesterID != requester || f.AddresseeID != target {
		t.Fatalf("wrong pair: %+v", f)
	}
}

func TestAddFriend_RequiresIdentifier(t *testing.T) {
	uc := &AddFriend{Repo: newStubRepo()}
	if _, err := uc.Do(context.Background(), uuid.New(), AddInput{}); err == nil {
		t.Fatal("expected error when neither user_id nor code provided")
	}
}
