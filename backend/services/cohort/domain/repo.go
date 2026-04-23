package domain

import (
	"context"
	"errors"

	"github.com/google/uuid"
)

// ErrNotFound — каноническая sentinel-ошибка для отсутствующих сущностей.
var ErrNotFound = errors.New("cohort: not found")

// ErrAlreadyMember — попытка вступить в когорту, в которой пользователь уже состоит.
var ErrAlreadyMember = errors.New("cohort: already a member")

// ErrCohortFull — когорта достигла лимита участников (Phase 1: софт-лимит 50).
var ErrCohortFull = errors.New("cohort: full")

// ListFilter — параметры пагинации/фильтрации для ListPublic.
type ListFilter struct {
	Status   string // "", "active", "graduated", "cancelled"
	Search   string // подстрока в name (case-insensitive)
	Page     int    // 1-indexed
	PageSize int    // 1..50
}

// ListPage — страница публичных когорт.
type ListPage struct {
	Items    []CohortWithCount
	Total    int
	Page     int
	PageSize int
}

// CohortWithCount расширяет Cohort количеством членов — чтобы фронт списка
// не делал N+1 на каждый ряд.
type CohortWithCount struct {
	Cohort
	MembersCount int
}

// Repo is the persistence port for cohorts.
type Repo interface {
	Create(ctx context.Context, c Cohort) (uuid.UUID, error)
	GetBySlug(ctx context.Context, slug string) (Cohort, error)
	Get(ctx context.Context, id uuid.UUID) (Cohort, error)

	AddMember(ctx context.Context, m CohortMember) error
	ListMembers(ctx context.Context, cohortID uuid.UUID) ([]CohortMember, error)
	RemoveMember(ctx context.Context, cohortID, userID uuid.UUID) error
	CountMembers(ctx context.Context, cohortID uuid.UUID) (int, error)
	HasMember(ctx context.Context, cohortID, userID uuid.UUID) (bool, error)
	Disband(ctx context.Context, cohortID uuid.UUID) error

	ListPublic(ctx context.Context, f ListFilter) (ListPage, error)

	IssueInvite(ctx context.Context, inv CohortInvite) error
	ConsumeInvite(ctx context.Context, token string) (uuid.UUID, error)

	Leaderboard(ctx context.Context, cohortID uuid.UUID, weekISO string) ([]MemberStanding, error)
}
