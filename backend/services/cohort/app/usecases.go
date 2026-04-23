// Package app holds use cases for the cohort bounded context.
//
// Phase 1 MVP: real Postgres-backed flows for create / get / list / join /
// leave / leaderboard. Token-based invite remains stubbed (returns
// ErrNotImplemented) — Phase 2.
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

	"druz9/cohort/domain"

	"github.com/google/uuid"
)

// CreateCohortInput — параметры создания.
type CreateCohortInput struct {
	OwnerID    uuid.UUID
	Slug       string
	Name       string
	StartsAt   time.Time
	EndsAt     time.Time
	Visibility domain.Visibility
}

// CreateCohort use case.
type CreateCohort struct {
	Repo domain.Repo
	Log  *slog.Logger
}

// NewCreateCohort constructs the use case. Panics on nil logger.
func NewCreateCohort(r domain.Repo, log *slog.Logger) *CreateCohort {
	if log == nil {
		panic("cohort/app: nil logger passed to NewCreateCohort")
	}
	return &CreateCohort{Repo: r, Log: log}
}

// Do — обратная-совместимая обёртка вокруг DoFull (signature тестов).
func (uc *CreateCohort) Do(ctx context.Context, ownerID uuid.UUID, name string, endsAt time.Time) (uuid.UUID, error) {
	if uc.Repo == nil {
		return uuid.Nil, domain.ErrNotImplemented
	}
	return uc.DoFull(ctx, CreateCohortInput{
		OwnerID:    ownerID,
		Slug:       slugify(name),
		Name:       name,
		StartsAt:   time.Now().UTC(),
		EndsAt:     endsAt,
		Visibility: domain.VisibilityPublic,
	})
}

// DoFull — полная форма с явными параметрами.
func (uc *CreateCohort) DoFull(ctx context.Context, in CreateCohortInput) (uuid.UUID, error) {
	if uc.Repo == nil {
		return uuid.Nil, domain.ErrNotImplemented
	}
	in.Slug = strings.TrimSpace(in.Slug)
	in.Name = strings.TrimSpace(in.Name)
	if in.Slug == "" {
		in.Slug = slugify(in.Name)
	}
	if l := len([]rune(in.Name)); l < 3 || l > 64 {
		return uuid.Nil, fmt.Errorf("cohort.Create: name must be 3..64 chars: %w", errInvalidInput)
	}
	if !in.EndsAt.After(in.StartsAt) {
		return uuid.Nil, fmt.Errorf("cohort.Create: ends_at must be after starts_at: %w", errInvalidInput)
	}
	if in.Visibility == "" {
		in.Visibility = domain.VisibilityPublic
	}
	c := domain.Cohort{
		ID:         uuid.New(),
		Slug:       in.Slug,
		Name:       in.Name,
		OwnerID:    in.OwnerID,
		StartsAt:   in.StartsAt,
		EndsAt:     in.EndsAt,
		Status:     domain.StatusActive,
		Visibility: in.Visibility,
	}
	id, err := uc.Repo.Create(ctx, c)
	if err != nil {
		return uuid.Nil, fmt.Errorf("cohort.Create: %w", err)
	}
	// Owner автоматически становится участником с ролью owner.
	if err := uc.Repo.AddMember(ctx, domain.CohortMember{
		CohortID: id,
		UserID:   in.OwnerID,
		Role:     domain.RoleOwner,
		JoinedAt: time.Now().UTC(),
	}); err != nil {
		return uuid.Nil, fmt.Errorf("cohort.Create: addMember(owner): %w", err)
	}
	return id, nil
}

// ErrInvalidInput — sentinel для портов (различение 400 vs 500).
// Use errors.Is для проверки.
var ErrInvalidInput = errors.New("invalid input")

// errInvalidInput — internal alias чтобы не ломать существующие call sites.
var errInvalidInput = ErrInvalidInput

// GetCohort — read-by-slug use case.
type GetCohort struct {
	Repo domain.Repo
	Log  *slog.Logger
}

// NewGetCohort constructor.
func NewGetCohort(r domain.Repo, log *slog.Logger) *GetCohort {
	if log == nil {
		panic("cohort/app: nil logger passed to NewGetCohort")
	}
	return &GetCohort{Repo: r, Log: log}
}

// CohortView — детальная карточка для /c/{slug}.
type CohortView struct {
	Cohort  domain.Cohort
	Members []domain.CohortMember
}

// Do возвращает (Cohort, members[]).
func (uc *GetCohort) Do(ctx context.Context, slug string) (CohortView, error) {
	if uc.Repo == nil {
		return CohortView{}, domain.ErrNotImplemented
	}
	c, err := uc.Repo.GetBySlug(ctx, slug)
	if err != nil {
		return CohortView{}, fmt.Errorf("cohort.Get: %w", err)
	}
	members, err := uc.Repo.ListMembers(ctx, c.ID)
	if err != nil {
		return CohortView{}, fmt.Errorf("cohort.Get: members: %w", err)
	}
	return CohortView{Cohort: c, Members: members}, nil
}

// ListCohorts — публичный список с фильтрами.
type ListCohorts struct {
	Repo domain.Repo
	Log  *slog.Logger
}

// NewListCohorts constructor.
func NewListCohorts(r domain.Repo, log *slog.Logger) *ListCohorts {
	if log == nil {
		panic("cohort/app: nil logger passed to NewListCohorts")
	}
	return &ListCohorts{Repo: r, Log: log}
}

// Do возвращает страницу публичных когорт.
func (uc *ListCohorts) Do(ctx context.Context, f domain.ListFilter) (domain.ListPage, error) {
	if uc.Repo == nil {
		return domain.ListPage{}, domain.ErrNotImplemented
	}
	if f.Page < 1 {
		f.Page = 1
	}
	if f.PageSize < 1 || f.PageSize > 50 {
		f.PageSize = 20
	}
	page, err := uc.Repo.ListPublic(ctx, f)
	if err != nil {
		return domain.ListPage{}, fmt.Errorf("cohort.List: %w", err)
	}
	if page.Items == nil {
		page.Items = []domain.CohortWithCount{}
	}
	return page, nil
}

// JoinCohort — присоединение к когорте по cohort_id (Phase 1: без токенов).
type JoinCohort struct {
	Repo domain.Repo
	Log  *slog.Logger
}

// NewJoinCohort constructor.
func NewJoinCohort(r domain.Repo, log *slog.Logger) *JoinCohort {
	if log == nil {
		panic("cohort/app: nil logger passed to NewJoinCohort")
	}
	return &JoinCohort{Repo: r, Log: log}
}

// Do — обратная-совместимая обёртка для тестов: signature (ctx, _id, _token).
// Phase 1 MVP не использует токены, поэтому второй аргумент игнорируется,
// если Repo == nil — возвращает ErrNotImplemented.
func (uc *JoinCohort) Do(ctx context.Context, userID uuid.UUID, _ string) (uuid.UUID, error) {
	if uc.Repo == nil {
		return uuid.Nil, domain.ErrNotImplemented
	}
	_ = ctx
	_ = userID
	return uuid.Nil, fmt.Errorf("cohort.Join: token-based invite is Phase 2: %w", domain.ErrNotImplemented)
}

// DoByID — основной flow Phase 1: вступить в когорту по её id.
func (uc *JoinCohort) DoByID(ctx context.Context, cohortID, userID uuid.UUID) error {
	if uc.Repo == nil {
		return domain.ErrNotImplemented
	}
	c, err := uc.Repo.Get(ctx, cohortID)
	if err != nil {
		return fmt.Errorf("cohort.Join: load: %w", err)
	}
	if c.Status != domain.StatusActive {
		return fmt.Errorf("cohort.Join: cohort is %s: %w", c.Status, errInvalidInput)
	}
	already, err := uc.Repo.HasMember(ctx, cohortID, userID)
	if err != nil {
		return fmt.Errorf("cohort.Join: check member: %w", err)
	}
	if already {
		return domain.ErrAlreadyMember
	}
	count, err := uc.Repo.CountMembers(ctx, cohortID)
	if err != nil {
		return fmt.Errorf("cohort.Join: count: %w", err)
	}
	if count >= domain.MaxMembersPhase1 {
		return domain.ErrCohortFull
	}
	if err := uc.Repo.AddMember(ctx, domain.CohortMember{
		CohortID: cohortID,
		UserID:   userID,
		Role:     domain.RoleMember,
		JoinedAt: time.Now().UTC(),
	}); err != nil {
		return fmt.Errorf("cohort.Join: insert: %w", err)
	}
	return nil
}

// LeaveCohort — выход из когорты, авто-распуск при последнем участнике.
type LeaveCohort struct {
	Repo domain.Repo
	Log  *slog.Logger
}

// NewLeaveCohort constructor.
func NewLeaveCohort(r domain.Repo, log *slog.Logger) *LeaveCohort {
	if log == nil {
		panic("cohort/app: nil logger passed to NewLeaveCohort")
	}
	return &LeaveCohort{Repo: r, Log: log}
}

// LeaveResult — что произошло после Leave.
type LeaveResult struct {
	Status string // "left" | "disbanded"
}

// Do удаляет membership; если это был последний — распускает когорту.
func (uc *LeaveCohort) Do(ctx context.Context, cohortID, userID uuid.UUID) (LeaveResult, error) {
	if uc.Repo == nil {
		return LeaveResult{}, domain.ErrNotImplemented
	}
	has, err := uc.Repo.HasMember(ctx, cohortID, userID)
	if err != nil {
		return LeaveResult{}, fmt.Errorf("cohort.Leave: check: %w", err)
	}
	if !has {
		return LeaveResult{}, domain.ErrNotFound
	}
	if rerr := uc.Repo.RemoveMember(ctx, cohortID, userID); rerr != nil {
		return LeaveResult{}, fmt.Errorf("cohort.Leave: remove: %w", rerr)
	}
	count, err := uc.Repo.CountMembers(ctx, cohortID)
	if err != nil {
		return LeaveResult{}, fmt.Errorf("cohort.Leave: count: %w", err)
	}
	if count == 0 {
		if err := uc.Repo.Disband(ctx, cohortID); err != nil {
			return LeaveResult{}, fmt.Errorf("cohort.Leave: disband: %w", err)
		}
		return LeaveResult{Status: "disbanded"}, nil
	}
	return LeaveResult{Status: "left"}, nil
}

// GetLeaderboard use case.
type GetLeaderboard struct {
	Repo domain.Repo
	Log  *slog.Logger
}

// NewGetLeaderboard constructor.
func NewGetLeaderboard(r domain.Repo, log *slog.Logger) *GetLeaderboard {
	if log == nil {
		panic("cohort/app: nil logger passed to NewGetLeaderboard")
	}
	return &GetLeaderboard{Repo: r, Log: log}
}

// Do — leaderboard по cohort_id.
//
// Anti-fallback: для пустой когорты возвращаем []; никаких платформенных средних.
func (uc *GetLeaderboard) Do(ctx context.Context, cohortID uuid.UUID, weekISO string) ([]domain.MemberStanding, error) {
	if uc.Repo == nil {
		return nil, domain.ErrNotImplemented
	}
	out, err := uc.Repo.Leaderboard(ctx, cohortID, weekISO)
	if err != nil {
		return nil, fmt.Errorf("cohort.Leaderboard: %w", err)
	}
	if out == nil {
		out = []domain.MemberStanding{}
	}
	return out, nil
}

// IssueInvite — Phase 2 (оставлен как stub, тест ожидает ErrNotImplemented).
type IssueInvite struct {
	Repo domain.Repo
	Log  *slog.Logger
}

// NewIssueInvite constructor.
func NewIssueInvite(r domain.Repo, log *slog.Logger) *IssueInvite {
	if log == nil {
		panic("cohort/app: nil logger passed to NewIssueInvite")
	}
	return &IssueInvite{Repo: r, Log: log}
}

// Do — STRATEGIC SCAFFOLD: token-based invite — Phase 2.
func (uc *IssueInvite) Do(_ context.Context, _ uuid.UUID, _ uuid.UUID, _ int, _ time.Duration) (string, error) {
	return "", domain.ErrNotImplemented
}

// slugify — простая транслитерация: lower, пробелы → "-", оставляем
// латиницу/цифры/дефис. Cyrillic/прочие unicode сжимаются в "-".
func slugify(name string) string {
	name = strings.ToLower(strings.TrimSpace(name))
	var b strings.Builder
	prevDash := false
	for _, r := range name {
		switch {
		case r >= 'a' && r <= 'z', r >= '0' && r <= '9':
			b.WriteRune(r)
			prevDash = false
		default:
			if !prevDash && b.Len() > 0 {
				b.WriteRune('-')
				prevDash = true
			}
		}
	}
	out := strings.TrimRight(b.String(), "-")
	if out == "" {
		// fallback: random suffix чтобы не создавать пустой slug.
		var buf [4]byte
		_, _ = rand.Read(buf[:])
		out = "c-" + hex.EncodeToString(buf[:])
	}
	return out
}
