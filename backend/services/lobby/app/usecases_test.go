package app

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"strings"
	"sync"
	"testing"
	"time"

	"druz9/lobby/domain"

	"github.com/google/uuid"
)

func nopLogger() *slog.Logger { return slog.New(slog.NewTextHandler(io.Discard, nil)) }

// memRepo — in-memory implementation of domain.Repo for unit tests.
// Не потокобезопасен против conflicting goroutines, но защищён mu для
// случайного racing внутри одного теста.
type memRepo struct {
	mu      sync.Mutex
	lobbies map[uuid.UUID]domain.Lobby
	byCode  map[string]uuid.UUID
	members map[uuid.UUID][]domain.Member
	nextLet rune
}

func newMemRepo() *memRepo {
	return &memRepo{
		lobbies: map[uuid.UUID]domain.Lobby{},
		byCode:  map[string]uuid.UUID{},
		members: map[uuid.UUID][]domain.Member{},
		nextLet: 'A',
	}
}

func (r *memRepo) Create(_ context.Context, l domain.Lobby) (domain.Lobby, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if l.Code == "" {
		l.Code = strings.Repeat(string(r.nextLet), domain.CodeLength)
		r.nextLet++
	}
	if _, exists := r.byCode[l.Code]; exists {
		return domain.Lobby{}, errors.New("code collision")
	}
	r.lobbies[l.ID] = l
	r.byCode[l.Code] = l.ID
	r.members[l.ID] = []domain.Member{{
		LobbyID: l.ID, UserID: l.OwnerID, Role: domain.RoleOwner, Team: 1, JoinedAt: time.Now().UTC(),
	}}
	return l, nil
}

func (r *memRepo) Get(_ context.Context, id uuid.UUID) (domain.Lobby, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	l, ok := r.lobbies[id]
	if !ok {
		return domain.Lobby{}, domain.ErrNotFound
	}
	return l, nil
}

func (r *memRepo) GetByCode(_ context.Context, code string) (domain.Lobby, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	id, ok := r.byCode[strings.ToUpper(code)]
	if !ok {
		return domain.Lobby{}, domain.ErrNotFound
	}
	return r.lobbies[id], nil
}

func (r *memRepo) ListPublic(_ context.Context, f domain.ListFilter) ([]domain.Lobby, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	out := make([]domain.Lobby, 0)
	for _, l := range r.lobbies {
		if l.Visibility != f.Visibility || l.Status != domain.StatusOpen {
			continue
		}
		if f.Mode != "" && l.Mode != f.Mode {
			continue
		}
		if f.Section != "" && l.Section != f.Section {
			continue
		}
		out = append(out, l)
	}
	return out, nil
}

func (r *memRepo) AddMember(_ context.Context, m domain.Member) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	for _, ex := range r.members[m.LobbyID] {
		if ex.UserID == m.UserID {
			return domain.ErrAlreadyMember
		}
	}
	r.members[m.LobbyID] = append(r.members[m.LobbyID], m)
	return nil
}

func (r *memRepo) RemoveMember(_ context.Context, lobbyID, userID uuid.UUID) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	keep := r.members[lobbyID][:0]
	for _, m := range r.members[lobbyID] {
		if m.UserID != userID {
			keep = append(keep, m)
		}
	}
	r.members[lobbyID] = keep
	return nil
}

func (r *memRepo) ListMembers(_ context.Context, lobbyID uuid.UUID) ([]domain.Member, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	out := make([]domain.Member, len(r.members[lobbyID]))
	copy(out, r.members[lobbyID])
	return out, nil
}

func (r *memRepo) CountMembers(_ context.Context, lobbyID uuid.UUID) (int, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	return len(r.members[lobbyID]), nil
}

func (r *memRepo) HasMember(_ context.Context, lobbyID, userID uuid.UUID) (bool, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	for _, m := range r.members[lobbyID] {
		if m.UserID == userID {
			return true, nil
		}
	}
	return false, nil
}

func (r *memRepo) SetStatus(_ context.Context, lobbyID uuid.UUID, status domain.Status) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	l, ok := r.lobbies[lobbyID]
	if !ok {
		return domain.ErrNotFound
	}
	l.Status = status
	r.lobbies[lobbyID] = l
	return nil
}

func (r *memRepo) SetMatchID(_ context.Context, lobbyID uuid.UUID, matchID uuid.UUID) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	l, ok := r.lobbies[lobbyID]
	if !ok {
		return domain.ErrNotFound
	}
	l.MatchID = &matchID
	r.lobbies[lobbyID] = l
	return nil
}

// fakeMatchCreator — тестовый MatchCreator. Возвращает заранее заданный id или ошибку.
type fakeMatchCreator struct {
	matchID uuid.UUID
	err     error
}

func (f *fakeMatchCreator) CreateMatch(_ context.Context, _ domain.Mode, _, _ string, _ []uuid.UUID) (uuid.UUID, error) {
	if f.err != nil {
		return uuid.Nil, f.err
	}
	return f.matchID, nil
}

// ── Test cases ─────────────────────────────────────────────────────────────

func TestCreateLobby_InvalidMode(t *testing.T) {
	uc := NewCreateLobby(newMemRepo(), nopLogger())
	_, err := uc.Do(context.Background(), CreateLobbyInput{
		OwnerID:    uuid.New(),
		Mode:       domain.Mode("3v3"),
		Section:    "algorithms",
		Difficulty: "medium",
	})
	if !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("expected ErrInvalidInput, got %v", err)
	}
}

func TestCreateLobby_Happy(t *testing.T) {
	repo := newMemRepo()
	uc := NewCreateLobby(repo, nopLogger())
	l, err := uc.Do(context.Background(), CreateLobbyInput{
		OwnerID:    uuid.New(),
		Mode:       domain.Mode1v1,
		Section:    "algorithms",
		Difficulty: "easy",
	})
	if err != nil {
		t.Fatalf("unexpected err: %v", err)
	}
	if l.Status != domain.StatusOpen {
		t.Fatalf("status = %s, want open", l.Status)
	}
	if l.MaxMembers != 2 {
		t.Fatalf("default max_members = %d, want 2", l.MaxMembers)
	}
}

func TestJoinLobby_FullReturns409Sentinel(t *testing.T) {
	repo := newMemRepo()
	create := NewCreateLobby(repo, nopLogger())
	join := NewJoinLobby(repo, nopLogger())
	owner := uuid.New()
	l, err := create.Do(context.Background(), CreateLobbyInput{
		OwnerID:    owner,
		Mode:       domain.Mode1v1,
		Section:    "algorithms",
		Difficulty: "medium",
		MaxMembers: 2,
	})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	// First join — fills the lobby (owner + 1 = 2 = max).
	if _, err := join.DoByID(context.Background(), l.ID, uuid.New()); err != nil {
		t.Fatalf("first join: %v", err)
	}
	// Second join — should fail with ErrFull.
	_, err = join.DoByID(context.Background(), l.ID, uuid.New())
	if !errors.Is(err, domain.ErrFull) {
		t.Fatalf("expected ErrFull, got %v", err)
	}
}

func TestJoinByCode_LookupHappy(t *testing.T) {
	repo := newMemRepo()
	create := NewCreateLobby(repo, nopLogger())
	get := NewGetLobby(repo, nopLogger())
	join := NewJoinLobby(repo, nopLogger())
	owner := uuid.New()
	l, err := create.Do(context.Background(), CreateLobbyInput{
		OwnerID:    owner,
		Mode:       domain.Mode2v2,
		Section:    "go",
		Difficulty: "hard",
	})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	view, err := get.DoByCode(context.Background(), strings.ToLower(l.Code))
	if err != nil {
		t.Fatalf("DoByCode lower: %v", err)
	}
	if view.Lobby.ID != l.ID {
		t.Fatalf("by-code returned wrong id")
	}
	if _, err := join.DoByCode(context.Background(), l.Code, uuid.New()); err != nil {
		t.Fatalf("JoinByCode: %v", err)
	}
}

func TestStartLobby_Happy(t *testing.T) {
	repo := newMemRepo()
	matchID := uuid.New()
	mc := &fakeMatchCreator{matchID: matchID}
	create := NewCreateLobby(repo, nopLogger())
	join := NewJoinLobby(repo, nopLogger())
	start := NewStartLobby(repo, mc, nopLogger())
	owner := uuid.New()
	l, err := create.Do(context.Background(), CreateLobbyInput{
		OwnerID:    owner,
		Mode:       domain.Mode1v1,
		Section:    "algorithms",
		Difficulty: "medium",
	})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if _, err := join.DoByID(context.Background(), l.ID, uuid.New()); err != nil {
		t.Fatalf("join: %v", err)
	}
	out, err := start.Do(context.Background(), l.ID, owner)
	if err != nil {
		t.Fatalf("start: %v", err)
	}
	if out.Status != domain.StatusLive {
		t.Fatalf("status = %s, want live", out.Status)
	}
	if out.MatchID == nil || *out.MatchID != matchID {
		t.Fatalf("match_id mismatch: %v vs %v", out.MatchID, matchID)
	}
}

func TestStartLobby_NonOwnerForbidden(t *testing.T) {
	repo := newMemRepo()
	mc := &fakeMatchCreator{matchID: uuid.New()}
	create := NewCreateLobby(repo, nopLogger())
	join := NewJoinLobby(repo, nopLogger())
	start := NewStartLobby(repo, mc, nopLogger())
	owner := uuid.New()
	intruder := uuid.New()
	l, err := create.Do(context.Background(), CreateLobbyInput{
		OwnerID:    owner,
		Mode:       domain.Mode1v1,
		Section:    "algorithms",
		Difficulty: "medium",
	})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if _, err := join.DoByID(context.Background(), l.ID, intruder); err != nil {
		t.Fatalf("join: %v", err)
	}
	_, err = start.Do(context.Background(), l.ID, intruder)
	if !errors.Is(err, domain.ErrForbidden) {
		t.Fatalf("expected ErrForbidden, got %v", err)
	}
}

func TestLeaveLobby_OwnerCancelsLobby(t *testing.T) {
	repo := newMemRepo()
	create := NewCreateLobby(repo, nopLogger())
	leave := NewLeaveLobby(repo, nopLogger())
	owner := uuid.New()
	l, err := create.Do(context.Background(), CreateLobbyInput{
		OwnerID:    owner,
		Mode:       domain.Mode1v1,
		Section:    "algorithms",
		Difficulty: "medium",
	})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	res, err := leave.Do(context.Background(), l.ID, owner)
	if err != nil {
		t.Fatalf("leave: %v", err)
	}
	if res.Status != "cancelled" {
		t.Fatalf("status = %s, want cancelled", res.Status)
	}
	got, _ := repo.Get(context.Background(), l.ID)
	if got.Status != domain.StatusCancelled {
		t.Fatalf("repo status = %s, want cancelled", got.Status)
	}
}

func TestNilLogger_Panics(t *testing.T) {
	cases := map[string]func(){
		"CreateLobby":       func() { NewCreateLobby(nil, nil) },
		"ListPublicLobbies": func() { NewListPublicLobbies(nil, nil) },
		"GetLobby":          func() { NewGetLobby(nil, nil) },
		"JoinLobby":         func() { NewJoinLobby(nil, nil) },
		"LeaveLobby":        func() { NewLeaveLobby(nil, nil) },
		"StartLobby":        func() { NewStartLobby(nil, nil, nil) },
		"CancelLobby":       func() { NewCancelLobby(nil, nil) },
	}
	for name, f := range cases {
		t.Run(name, func(t *testing.T) {
			defer func() {
				if r := recover(); r == nil {
					t.Fatalf("%s: expected panic on nil logger", name)
				}
			}()
			f()
		})
	}
}
