// Package app holds use cases for the Custom-Lobby bounded context (WAVE-11).
//
// Each use case takes a domain.Repo and a *slog.Logger; nil-loggers panic at
// construction time so we surface mis-wires loudly. Errors are wrapped with
// %w so callers can errors.Is on the sentinels in domain.
//
// Anti-fallback: this layer never invents data. If the underlying repo returns
// ErrNotFound, we propagate it; if code generation exhausts retries we surface
// ErrCodeExhausted instead of silently re-keying. StartLobby refuses to
// proceed if MatchCreator is nil — better to 500 than to flip a lobby into
// 'live' without a real arena_match behind it.
package app

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"druz9/lobby/domain"

	"github.com/google/uuid"
)

// ErrInvalidInput — sentinel for ports (400 vs 500). Use errors.Is.
var ErrInvalidInput = errors.New("lobby: invalid input")

// ── CreateLobby ────────────────────────────────────────────────────────────

// CreateLobbyInput — параметры создания лобби.
type CreateLobbyInput struct {
	OwnerID      uuid.UUID
	Mode         domain.Mode
	Section      string
	Difficulty   string
	Visibility   domain.Visibility
	MaxMembers   int
	AIAllowed    bool
	TimeLimitMin int
}

// CreateLobby use case.
type CreateLobby struct {
	Repo domain.Repo
	Log  *slog.Logger
}

// NewCreateLobby — конструктор. Panics if log == nil.
func NewCreateLobby(r domain.Repo, log *slog.Logger) *CreateLobby {
	if log == nil {
		panic("lobby/app: nil logger passed to NewCreateLobby")
	}
	return &CreateLobby{Repo: r, Log: log}
}

// Do создаёт лобби, генерируя код в infra-слое.
func (uc *CreateLobby) Do(ctx context.Context, in CreateLobbyInput) (domain.Lobby, error) {
	if uc.Repo == nil {
		return domain.Lobby{}, fmt.Errorf("lobby.Create: repo not wired: %w", ErrInvalidInput)
	}
	if !in.Mode.IsValid() {
		return domain.Lobby{}, fmt.Errorf("lobby.Create: invalid mode %q: %w", in.Mode, ErrInvalidInput)
	}
	if in.Visibility == "" {
		in.Visibility = domain.VisibilityPublic
	}
	if !in.Visibility.IsValid() {
		return domain.Lobby{}, fmt.Errorf("lobby.Create: invalid visibility %q: %w", in.Visibility, ErrInvalidInput)
	}
	maxSlots := domain.MaxSlotsForMode(in.Mode)
	if in.MaxMembers <= 0 {
		in.MaxMembers = maxSlots
	}
	if in.MaxMembers < 2 || in.MaxMembers > maxSlots {
		return domain.Lobby{}, fmt.Errorf(
			"lobby.Create: max_members=%d out of [2..%d] for mode %s: %w",
			in.MaxMembers, maxSlots, in.Mode, ErrInvalidInput,
		)
	}
	if strings.TrimSpace(in.Section) == "" {
		return domain.Lobby{}, fmt.Errorf("lobby.Create: section required: %w", ErrInvalidInput)
	}
	if strings.TrimSpace(in.Difficulty) == "" {
		return domain.Lobby{}, fmt.Errorf("lobby.Create: difficulty required: %w", ErrInvalidInput)
	}
	if in.TimeLimitMin <= 0 {
		in.TimeLimitMin = 30
	}
	if in.TimeLimitMin < 5 || in.TimeLimitMin > 180 {
		return domain.Lobby{}, fmt.Errorf("lobby.Create: time_limit_min=%d out of [5..180]: %w", in.TimeLimitMin, ErrInvalidInput)
	}

	now := time.Now().UTC()
	l := domain.Lobby{
		ID:           uuid.New(),
		OwnerID:      in.OwnerID,
		Mode:         in.Mode,
		Section:      in.Section,
		Difficulty:   in.Difficulty,
		Visibility:   in.Visibility,
		MaxMembers:   in.MaxMembers,
		AIAllowed:    in.AIAllowed,
		TimeLimitMin: in.TimeLimitMin,
		Status:       domain.StatusOpen,
		CreatedAt:    now,
		UpdatedAt:    now,
	}
	out, err := uc.Repo.Create(ctx, l)
	if err != nil {
		return domain.Lobby{}, fmt.Errorf("lobby.Create: %w", err)
	}
	return out, nil
}

// ── ListPublicLobbies ──────────────────────────────────────────────────────

// ListPublicLobbies use case.
type ListPublicLobbies struct {
	Repo domain.Repo
	Log  *slog.Logger
}

// NewListPublicLobbies — конструктор.
func NewListPublicLobbies(r domain.Repo, log *slog.Logger) *ListPublicLobbies {
	if log == nil {
		panic("lobby/app: nil logger passed to NewListPublicLobbies")
	}
	return &ListPublicLobbies{Repo: r, Log: log}
}

// Do — публичный список (visibility=public, status=open).
func (uc *ListPublicLobbies) Do(ctx context.Context, f domain.ListFilter) ([]domain.Lobby, error) {
	if uc.Repo == nil {
		return nil, fmt.Errorf("lobby.List: repo not wired: %w", ErrInvalidInput)
	}
	if f.Visibility == "" {
		f.Visibility = domain.VisibilityPublic
	}
	if f.Limit <= 0 || f.Limit > 50 {
		f.Limit = 20
	}
	out, err := uc.Repo.ListPublic(ctx, f)
	if err != nil {
		return nil, fmt.Errorf("lobby.List: %w", err)
	}
	if out == nil {
		out = []domain.Lobby{}
	}
	return out, nil
}

// ── GetLobby ───────────────────────────────────────────────────────────────

// GetLobby use case.
type GetLobby struct {
	Repo domain.Repo
	Log  *slog.Logger
}

// NewGetLobby — конструктор.
func NewGetLobby(r domain.Repo, log *slog.Logger) *GetLobby {
	if log == nil {
		panic("lobby/app: nil logger passed to NewGetLobby")
	}
	return &GetLobby{Repo: r, Log: log}
}

// Do возвращает лобби + список участников.
func (uc *GetLobby) Do(ctx context.Context, id uuid.UUID) (domain.LobbyView, error) {
	if uc.Repo == nil {
		return domain.LobbyView{}, fmt.Errorf("lobby.Get: repo not wired: %w", ErrInvalidInput)
	}
	l, err := uc.Repo.Get(ctx, id)
	if err != nil {
		return domain.LobbyView{}, fmt.Errorf("lobby.Get: %w", err)
	}
	members, err := uc.Repo.ListMembers(ctx, id)
	if err != nil {
		return domain.LobbyView{}, fmt.Errorf("lobby.Get: members: %w", err)
	}
	return domain.LobbyView{Lobby: l, Members: members}, nil
}

// DoByCode — лукап по code (case-insensitive).
func (uc *GetLobby) DoByCode(ctx context.Context, code string) (domain.LobbyView, error) {
	if uc.Repo == nil {
		return domain.LobbyView{}, fmt.Errorf("lobby.GetByCode: repo not wired: %w", ErrInvalidInput)
	}
	code = strings.ToUpper(strings.TrimSpace(code))
	if len(code) != domain.CodeLength {
		return domain.LobbyView{}, fmt.Errorf("lobby.GetByCode: code must be %d letters: %w", domain.CodeLength, ErrInvalidInput)
	}
	l, err := uc.Repo.GetByCode(ctx, code)
	if err != nil {
		return domain.LobbyView{}, fmt.Errorf("lobby.GetByCode: %w", err)
	}
	members, err := uc.Repo.ListMembers(ctx, l.ID)
	if err != nil {
		return domain.LobbyView{}, fmt.Errorf("lobby.GetByCode: members: %w", err)
	}
	return domain.LobbyView{Lobby: l, Members: members}, nil
}

// ── JoinLobby ──────────────────────────────────────────────────────────────

// JoinLobby use case.
type JoinLobby struct {
	Repo domain.Repo
	Log  *slog.Logger
}

// NewJoinLobby — конструктор.
func NewJoinLobby(r domain.Repo, log *slog.Logger) *JoinLobby {
	if log == nil {
		panic("lobby/app: nil logger passed to NewJoinLobby")
	}
	return &JoinLobby{Repo: r, Log: log}
}

// DoByID — основной flow: вступить в лобби по id.
func (uc *JoinLobby) DoByID(ctx context.Context, lobbyID, userID uuid.UUID) (domain.Lobby, error) {
	if uc.Repo == nil {
		return domain.Lobby{}, fmt.Errorf("lobby.Join: repo not wired: %w", ErrInvalidInput)
	}
	l, err := uc.Repo.Get(ctx, lobbyID)
	if err != nil {
		return domain.Lobby{}, fmt.Errorf("lobby.Join: load: %w", err)
	}
	if l.Status != domain.StatusOpen {
		return domain.Lobby{}, domain.ErrClosed
	}
	already, err := uc.Repo.HasMember(ctx, lobbyID, userID)
	if err != nil {
		return domain.Lobby{}, fmt.Errorf("lobby.Join: check: %w", err)
	}
	if already {
		return l, domain.ErrAlreadyMember
	}
	count, err := uc.Repo.CountMembers(ctx, lobbyID)
	if err != nil {
		return domain.Lobby{}, fmt.Errorf("lobby.Join: count: %w", err)
	}
	if count >= l.MaxMembers {
		return domain.Lobby{}, domain.ErrFull
	}
	team := 1
	if l.Mode == domain.Mode2v2 && count >= 2 {
		team = 2
	}
	if err := uc.Repo.AddMember(ctx, domain.Member{
		LobbyID:  lobbyID,
		UserID:   userID,
		Role:     domain.RoleMember,
		Team:     team,
		JoinedAt: time.Now().UTC(),
	}); err != nil {
		return domain.Lobby{}, fmt.Errorf("lobby.Join: add: %w", err)
	}
	return l, nil
}

// DoByCode — вступить по 4-буквенному коду.
func (uc *JoinLobby) DoByCode(ctx context.Context, code string, userID uuid.UUID) (domain.Lobby, error) {
	if uc.Repo == nil {
		return domain.Lobby{}, fmt.Errorf("lobby.JoinByCode: repo not wired: %w", ErrInvalidInput)
	}
	code = strings.ToUpper(strings.TrimSpace(code))
	if len(code) != domain.CodeLength {
		return domain.Lobby{}, fmt.Errorf("lobby.JoinByCode: invalid code: %w", ErrInvalidInput)
	}
	l, err := uc.Repo.GetByCode(ctx, code)
	if err != nil {
		return domain.Lobby{}, fmt.Errorf("lobby.JoinByCode: %w", err)
	}
	return uc.DoByID(ctx, l.ID, userID)
}

// ── LeaveLobby ─────────────────────────────────────────────────────────────

// LeaveLobby use case. Owner-leaves cancels the lobby.
type LeaveLobby struct {
	Repo domain.Repo
	Log  *slog.Logger
}

// NewLeaveLobby — конструктор.
func NewLeaveLobby(r domain.Repo, log *slog.Logger) *LeaveLobby {
	if log == nil {
		panic("lobby/app: nil logger passed to NewLeaveLobby")
	}
	return &LeaveLobby{Repo: r, Log: log}
}

// LeaveResult — что произошло.
type LeaveResult struct {
	Status string // "left" | "cancelled"
}

// Do удаляет membership; если это владелец — переводит лобби в cancelled.
func (uc *LeaveLobby) Do(ctx context.Context, lobbyID, userID uuid.UUID) (LeaveResult, error) {
	if uc.Repo == nil {
		return LeaveResult{}, fmt.Errorf("lobby.Leave: repo not wired: %w", ErrInvalidInput)
	}
	l, err := uc.Repo.Get(ctx, lobbyID)
	if err != nil {
		return LeaveResult{}, fmt.Errorf("lobby.Leave: load: %w", err)
	}
	has, err := uc.Repo.HasMember(ctx, lobbyID, userID)
	if err != nil {
		return LeaveResult{}, fmt.Errorf("lobby.Leave: check: %w", err)
	}
	if !has {
		return LeaveResult{}, domain.ErrNotFound
	}
	if l.OwnerID == userID {
		// Owner leaving == cancel: dropping all members + flipping status.
		if err := uc.Repo.SetStatus(ctx, lobbyID, domain.StatusCancelled); err != nil {
			return LeaveResult{}, fmt.Errorf("lobby.Leave: cancel: %w", err)
		}
		return LeaveResult{Status: "cancelled"}, nil
	}
	if err := uc.Repo.RemoveMember(ctx, lobbyID, userID); err != nil {
		return LeaveResult{}, fmt.Errorf("lobby.Leave: remove: %w", err)
	}
	return LeaveResult{Status: "left"}, nil
}

// ── StartLobby ─────────────────────────────────────────────────────────────

// StartLobby use case — owner-only. Creates an arena_match via MatchCreator
// and flips the lobby to status='live' with match_id set.
type StartLobby struct {
	Repo    domain.Repo
	Matches domain.MatchCreator
	Log     *slog.Logger
}

// NewStartLobby — конструктор. Panics on nil log; nil MatchCreator is allowed
// at construction (e.g. tests) but Do will reject the call.
func NewStartLobby(r domain.Repo, m domain.MatchCreator, log *slog.Logger) *StartLobby {
	if log == nil {
		panic("lobby/app: nil logger passed to NewStartLobby")
	}
	return &StartLobby{Repo: r, Matches: m, Log: log}
}

// Do запускает лобби. Возвращает обновлённое лобби с match_id.
func (uc *StartLobby) Do(ctx context.Context, lobbyID, userID uuid.UUID) (domain.Lobby, error) {
	if uc.Repo == nil {
		return domain.Lobby{}, fmt.Errorf("lobby.Start: repo not wired: %w", ErrInvalidInput)
	}
	if uc.Matches == nil {
		return domain.Lobby{}, fmt.Errorf("lobby.Start: match creator not wired: %w", ErrInvalidInput)
	}
	l, err := uc.Repo.Get(ctx, lobbyID)
	if err != nil {
		return domain.Lobby{}, fmt.Errorf("lobby.Start: load: %w", err)
	}
	if l.OwnerID != userID {
		return domain.Lobby{}, domain.ErrForbidden
	}
	if l.Status != domain.StatusOpen {
		return domain.Lobby{}, domain.ErrClosed
	}
	members, err := uc.Repo.ListMembers(ctx, lobbyID)
	if err != nil {
		return domain.Lobby{}, fmt.Errorf("lobby.Start: members: %w", err)
	}
	if len(members) < 2 {
		return domain.Lobby{}, fmt.Errorf("lobby.Start: need at least 2 members, got %d: %w", len(members), ErrInvalidInput)
	}
	ids := make([]uuid.UUID, 0, len(members))
	for _, m := range members {
		ids = append(ids, m.UserID)
	}
	matchID, err := uc.Matches.CreateMatch(ctx, l.Mode, l.Section, l.Difficulty, ids)
	if err != nil {
		return domain.Lobby{}, fmt.Errorf("lobby.Start: arena.CreateMatch: %w", err)
	}
	if err := uc.Repo.SetMatchID(ctx, lobbyID, matchID); err != nil {
		return domain.Lobby{}, fmt.Errorf("lobby.Start: set match: %w", err)
	}
	if err := uc.Repo.SetStatus(ctx, lobbyID, domain.StatusLive); err != nil {
		return domain.Lobby{}, fmt.Errorf("lobby.Start: set status: %w", err)
	}
	l.MatchID = &matchID
	l.Status = domain.StatusLive
	return l, nil
}

// ── CancelLobby ────────────────────────────────────────────────────────────

// CancelLobby — owner-only manual cancel.
type CancelLobby struct {
	Repo domain.Repo
	Log  *slog.Logger
}

// NewCancelLobby — конструктор.
func NewCancelLobby(r domain.Repo, log *slog.Logger) *CancelLobby {
	if log == nil {
		panic("lobby/app: nil logger passed to NewCancelLobby")
	}
	return &CancelLobby{Repo: r, Log: log}
}

// Do отменяет лобби. Только владелец.
func (uc *CancelLobby) Do(ctx context.Context, lobbyID, userID uuid.UUID) error {
	if uc.Repo == nil {
		return fmt.Errorf("lobby.Cancel: repo not wired: %w", ErrInvalidInput)
	}
	l, err := uc.Repo.Get(ctx, lobbyID)
	if err != nil {
		return fmt.Errorf("lobby.Cancel: load: %w", err)
	}
	if l.OwnerID != userID {
		return domain.ErrForbidden
	}
	if l.Status != domain.StatusOpen {
		return domain.ErrClosed
	}
	if err := uc.Repo.SetStatus(ctx, lobbyID, domain.StatusCancelled); err != nil {
		return fmt.Errorf("lobby.Cancel: %w", err)
	}
	return nil
}
