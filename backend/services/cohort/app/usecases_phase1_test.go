package app

import (
	"context"
	"errors"
	"testing"
	"time"

	"druz9/cohort/domain"

	"github.com/google/uuid"
)

// fakeRepo — in-memory реализация domain.Repo для unit-тестов use-case'ов.
type fakeRepo struct {
	cohorts map[uuid.UUID]domain.Cohort
	bySlug  map[string]uuid.UUID
	members map[uuid.UUID][]domain.CohortMember
}

func newFakeRepo() *fakeRepo {
	return &fakeRepo{
		cohorts: map[uuid.UUID]domain.Cohort{},
		bySlug:  map[string]uuid.UUID{},
		members: map[uuid.UUID][]domain.CohortMember{},
	}
}

func (f *fakeRepo) Create(_ context.Context, c domain.Cohort) (uuid.UUID, error) {
	if _, dup := f.bySlug[c.Slug]; dup {
		return uuid.Nil, domain.ErrAlreadyMember
	}
	if c.ID == uuid.Nil {
		c.ID = uuid.New()
	}
	f.cohorts[c.ID] = c
	f.bySlug[c.Slug] = c.ID
	return c.ID, nil
}
func (f *fakeRepo) GetBySlug(_ context.Context, slug string) (domain.Cohort, error) {
	id, ok := f.bySlug[slug]
	if !ok {
		return domain.Cohort{}, domain.ErrNotFound
	}
	return f.cohorts[id], nil
}
func (f *fakeRepo) Get(_ context.Context, id uuid.UUID) (domain.Cohort, error) {
	c, ok := f.cohorts[id]
	if !ok {
		return domain.Cohort{}, domain.ErrNotFound
	}
	return c, nil
}
func (f *fakeRepo) AddMember(_ context.Context, m domain.CohortMember) error {
	for _, existing := range f.members[m.CohortID] {
		if existing.UserID == m.UserID {
			return domain.ErrAlreadyMember
		}
	}
	f.members[m.CohortID] = append(f.members[m.CohortID], m)
	return nil
}
func (f *fakeRepo) ListMembers(_ context.Context, cohortID uuid.UUID) ([]domain.CohortMember, error) {
	return f.members[cohortID], nil
}
func (f *fakeRepo) RemoveMember(_ context.Context, cohortID, userID uuid.UUID) error {
	out := f.members[cohortID][:0]
	for _, m := range f.members[cohortID] {
		if m.UserID != userID {
			out = append(out, m)
		}
	}
	f.members[cohortID] = out
	return nil
}
func (f *fakeRepo) CountMembers(_ context.Context, cohortID uuid.UUID) (int, error) {
	return len(f.members[cohortID]), nil
}
func (f *fakeRepo) HasMember(_ context.Context, cohortID, userID uuid.UUID) (bool, error) {
	for _, m := range f.members[cohortID] {
		if m.UserID == userID {
			return true, nil
		}
	}
	return false, nil
}
func (f *fakeRepo) Disband(_ context.Context, cohortID uuid.UUID) error {
	c := f.cohorts[cohortID]
	c.Status = domain.StatusCancelled
	f.cohorts[cohortID] = c
	return nil
}
func (f *fakeRepo) ListPublic(_ context.Context, _ domain.ListFilter) (domain.ListPage, error) {
	items := make([]domain.CohortWithCount, 0, len(f.cohorts))
	for _, c := range f.cohorts {
		if c.Visibility != domain.VisibilityPublic {
			continue
		}
		items = append(items, domain.CohortWithCount{Cohort: c, MembersCount: len(f.members[c.ID])})
	}
	return domain.ListPage{Items: items, Total: len(items), Page: 1, PageSize: 20}, nil
}
func (f *fakeRepo) IssueInvite(_ context.Context, _ domain.CohortInvite) error { return nil }
func (f *fakeRepo) ConsumeInvite(_ context.Context, _ string) (uuid.UUID, error) {
	return uuid.Nil, domain.ErrNotImplemented
}
func (f *fakeRepo) Leaderboard(_ context.Context, cohortID uuid.UUID, _ string) ([]domain.MemberStanding, error) {
	out := []domain.MemberStanding{}
	for _, m := range f.members[cohortID] {
		out = append(out, domain.MemberStanding{UserID: m.UserID, DisplayName: m.UserID.String(), OverallElo: 1000})
	}
	return out, nil
}

func TestCreateCohort_HappyPath(t *testing.T) {
	repo := newFakeRepo()
	uc := NewCreateCohort(repo, nopLogger())
	owner := uuid.New()
	id, err := uc.DoFull(context.Background(), CreateCohortInput{
		OwnerID: owner, Slug: "faang-may", Name: "FAANG May",
		StartsAt: time.Now(), EndsAt: time.Now().Add(56 * 24 * time.Hour),
	})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if id == uuid.Nil {
		t.Fatal("expected non-nil id")
	}
	c, err := repo.Get(context.Background(), id)
	if err != nil || c.Slug != "faang-may" {
		t.Fatalf("get: %v / %+v", err, c)
	}
	// Owner должен быть автоматически добавлен.
	members, _ := repo.ListMembers(context.Background(), id)
	if len(members) != 1 || members[0].UserID != owner || members[0].Role != domain.RoleOwner {
		t.Fatalf("expected owner auto-membership, got %+v", members)
	}
}

func TestCreateCohort_InvalidName(t *testing.T) {
	uc := NewCreateCohort(newFakeRepo(), nopLogger())
	_, err := uc.DoFull(context.Background(), CreateCohortInput{
		OwnerID: uuid.New(), Name: "x", StartsAt: time.Now(), EndsAt: time.Now().Add(time.Hour),
	})
	if !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("expected ErrInvalidInput, got %v", err)
	}
}

func TestJoinCohort_HappyAndDuplicate(t *testing.T) {
	repo := newFakeRepo()
	owner := uuid.New()
	id, _ := NewCreateCohort(repo, nopLogger()).DoFull(context.Background(), CreateCohortInput{
		OwnerID: owner, Name: "Cohort 9", StartsAt: time.Now(), EndsAt: time.Now().Add(time.Hour),
	})
	user := uuid.New()
	if err := NewJoinCohort(repo, nopLogger()).DoByID(context.Background(), id, user); err != nil {
		t.Fatalf("join: %v", err)
	}
	// Повтор → ErrAlreadyMember.
	if err := NewJoinCohort(repo, nopLogger()).DoByID(context.Background(), id, user); !errors.Is(err, domain.ErrAlreadyMember) {
		t.Fatalf("expected ErrAlreadyMember, got %v", err)
	}
}

func TestLeaveCohort_AutoDisbandsLastMember(t *testing.T) {
	repo := newFakeRepo()
	owner := uuid.New()
	id, _ := NewCreateCohort(repo, nopLogger()).DoFull(context.Background(), CreateCohortInput{
		OwnerID: owner, Name: "SoloRun", StartsAt: time.Now(), EndsAt: time.Now().Add(time.Hour),
	})
	res, err := NewLeaveCohort(repo, nopLogger()).Do(context.Background(), id, owner)
	if err != nil {
		t.Fatalf("leave: %v", err)
	}
	if res.Status != "disbanded" {
		t.Fatalf("expected disbanded, got %q", res.Status)
	}
	c, _ := repo.Get(context.Background(), id)
	if c.Status != domain.StatusCancelled {
		t.Fatalf("expected status cancelled, got %s", c.Status)
	}
}

func TestLeaderboard_EmptyCohortReturnsEmpty_NoFallback(t *testing.T) {
	repo := newFakeRepo()
	id, _ := repo.Create(context.Background(), domain.Cohort{Slug: "empty", Name: "Empty"})
	out, err := NewGetLeaderboard(repo, nopLogger()).Do(context.Background(), id, "")
	if err != nil {
		t.Fatalf("leaderboard: %v", err)
	}
	if len(out) != 0 {
		t.Fatalf("expected empty leaderboard, got %d rows (anti-fallback)", len(out))
	}
}

func TestListCohorts_DefaultsAndNonNil(t *testing.T) {
	repo := newFakeRepo()
	page, err := NewListCohorts(repo, nopLogger()).Do(context.Background(), domain.ListFilter{})
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if page.Page != 1 || page.PageSize != 20 {
		t.Fatalf("expected defaults page=1 size=20, got %+v", page)
	}
	if page.Items == nil {
		t.Fatal("Items must be non-nil slice (anti-fallback)")
	}
}
