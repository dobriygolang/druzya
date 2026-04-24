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
	Status string // "", "active", "graduated", "cancelled"
	Search string // подстрока в name (case-insensitive)
	// Sort: "", "newest" — by created_at DESC (default);
	//       "active"     — active status first, then newest;
	//       "fullness"   — members_count DESC (most-filled first);
	//       "ending"     — nearest ends_at first (active only).
	Sort     string
	Page     int // 1-indexed
	PageSize int // 1..50
}

// ListPage — страница публичных когорт.
type ListPage struct {
	Items    []CohortWithCount
	Total    int
	Page     int
	PageSize int
}

// CohortWithCount расширяет Cohort количеством членов — чтобы фронт списка
// не делал N+1 на каждый ряд. TopMembers — first N users (by joined_at ASC)
// used by the catalogue card avatar strip; the query resolves them in a
// single round-trip via LATERAL join.
type CohortWithCount struct {
	Cohort
	MembersCount int
	TopMembers   []CohortMember
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
	GetMemberRole(ctx context.Context, cohortID, userID uuid.UUID) (Role, error)
	UpdateMemberRole(ctx context.Context, cohortID, userID uuid.UUID, role Role) error
	// TransferOwner flips the cohorts.owner_id column. Use cases call
	// UpdateMemberRole to re-stamp the membership rows separately.
	TransferOwner(ctx context.Context, cohortID, newOwnerID uuid.UUID) (Cohort, error)
	Disband(ctx context.Context, cohortID uuid.UUID) error
	// UpdateMeta rewrites the editable cohort fields (name, ends_at,
	// visibility). Owner-only at the use case layer.
	UpdateMeta(ctx context.Context, cohortID uuid.UUID, patch CohortPatch) (Cohort, error)

	ListPublic(ctx context.Context, f ListFilter) (ListPage, error)

	IssueInvite(ctx context.Context, inv CohortInvite) error
	ConsumeInvite(ctx context.Context, token string) (uuid.UUID, error)

	Leaderboard(ctx context.Context, cohortID uuid.UUID, weekISO string) ([]MemberStanding, error)

	// StreakHeatmap returns one row per member with `days` bools covering
	// the last `days` calendar days (UTC). True = passed Daily that day.
	// Used by the «Streak» tab on /c/{slug}.
	StreakHeatmap(ctx context.Context, cohortID uuid.UUID, days int) ([]StreakHeatmapRow, error)
}
