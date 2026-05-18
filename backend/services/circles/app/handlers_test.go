package app

import (
	"context"
	"errors"
	"testing"
	"time"

	"druz9/circles/domain"

	"github.com/google/uuid"
)

// inMemoryCircleRepo — фейк хранилища circles в памяти. Только то, что
// нужно happy-path тестам — без транзакций и оптимизаций. Тесты sequential,
// concurrent-safety не требуется.
type inMemoryCircleRepo struct {
	rows map[uuid.UUID]domain.Circle
}

func newInMemCircleRepo() *inMemoryCircleRepo {
	return &inMemoryCircleRepo{rows: map[uuid.UUID]domain.Circle{}}
}

func (r *inMemoryCircleRepo) Create(_ context.Context, c domain.Circle) (domain.Circle, error) {
	r.rows[c.ID] = c
	return c, nil
}
func (r *inMemoryCircleRepo) Get(_ context.Context, id uuid.UUID) (domain.Circle, error) {
	c, ok := r.rows[id]
	if !ok {
		return domain.Circle{}, domain.ErrNotFound
	}
	return c, nil
}
func (r *inMemoryCircleRepo) ListByMember(_ context.Context, _ uuid.UUID) ([]domain.Circle, error) {
	out := make([]domain.Circle, 0, len(r.rows))
	for _, c := range r.rows {
		out = append(out, c)
	}
	return out, nil
}
func (r *inMemoryCircleRepo) ListDiscover(_ context.Context, _ uuid.UUID, _ int) ([]domain.CircleWithCount, error) {
	return nil, nil
}
func (r *inMemoryCircleRepo) Delete(_ context.Context, id uuid.UUID) error {
	delete(r.rows, id)
	return nil
}
func (r *inMemoryCircleRepo) CountMembers(_ context.Context, _ uuid.UUID) (int, error) {
	return 0, nil
}

type memberKey struct{ Circle, User uuid.UUID }

type inMemoryMemberRepo struct {
	rows map[memberKey]domain.Member
}

func newInMemMemberRepo() *inMemoryMemberRepo {
	return &inMemoryMemberRepo{rows: map[memberKey]domain.Member{}}
}

func (r *inMemoryMemberRepo) Add(_ context.Context, m domain.Member) (domain.Member, error) {
	k := memberKey{m.CircleID, m.UserID}
	if existing, ok := r.rows[k]; ok {
		// Idempotent — повторный join возвращает существующего члена.
		return existing, nil
	}
	r.rows[k] = m
	return m, nil
}
func (r *inMemoryMemberRepo) Remove(_ context.Context, circleID, userID uuid.UUID) error {
	delete(r.rows, memberKey{circleID, userID})
	return nil
}
func (r *inMemoryMemberRepo) GetRole(_ context.Context, circleID, userID uuid.UUID) (domain.Role, error) {
	m, ok := r.rows[memberKey{circleID, userID}]
	if !ok {
		return "", domain.ErrNotFound
	}
	return m.Role, nil
}
func (r *inMemoryMemberRepo) List(_ context.Context, circleID uuid.UUID) ([]domain.MemberWithUsername, error) {
	out := make([]domain.MemberWithUsername, 0)
	for k, m := range r.rows {
		if k.Circle == circleID {
			out = append(out, domain.MemberWithUsername{Member: m})
		}
	}
	return out, nil
}

func newHandlers() (*Handlers, *inMemoryCircleRepo, *inMemoryMemberRepo) {
	cr := newInMemCircleRepo()
	mr := newInMemMemberRepo()
	h := NewHandlers(cr, mr)
	h.Now = func() time.Time { return time.Date(2026, 5, 18, 12, 0, 0, 0, time.UTC) }
	return h, cr, mr
}

func TestCreateCircle_OwnerJoinsAsAdmin(t *testing.T) {
	t.Parallel()
	h, _, mr := newHandlers()
	owner := uuid.New()
	res, err := h.CreateCircle(context.Background(), owner, "Go senior pod", "")
	if err != nil {
		t.Fatalf("CreateCircle: %v", err)
	}
	if res.MemberCount != 1 {
		t.Fatalf("MemberCount = %d, want 1", res.MemberCount)
	}
	role, err := mr.GetRole(context.Background(), res.Circle.ID, owner)
	if err != nil {
		t.Fatalf("GetRole owner: %v", err)
	}
	if role != domain.RoleAdmin {
		t.Fatalf("owner role = %q, want admin", role)
	}
}

func TestJoinCircle_IdempotentOnRepeat(t *testing.T) {
	t.Parallel()
	h, cr, mr := newHandlers()
	ctx := context.Background()
	owner := uuid.New()
	user := uuid.New()
	c, err := cr.Create(ctx, domain.Circle{
		ID: uuid.New(), Name: "x", OwnerID: owner, CreatedAt: time.Now(), UpdatedAt: time.Now(),
	})
	if err != nil {
		t.Fatalf("seed: %v", err)
	}
	if err := h.JoinCircle(ctx, c.ID, user); err != nil {
		t.Fatalf("Join #1: %v", err)
	}
	if err := h.JoinCircle(ctx, c.ID, user); err != nil {
		t.Fatalf("Join #2: %v", err)
	}
	if len(mr.rows) != 1 {
		t.Fatalf("members rows = %d, want 1 (idempotent)", len(mr.rows))
	}
}

func TestLeaveCircle_OwnerForbidden(t *testing.T) {
	t.Parallel()
	h, cr, _ := newHandlers()
	ctx := context.Background()
	owner := uuid.New()
	c, _ := cr.Create(ctx, domain.Circle{
		ID: uuid.New(), Name: "x", OwnerID: owner, CreatedAt: time.Now(), UpdatedAt: time.Now(),
	})
	err := h.LeaveCircle(ctx, c.ID, owner)
	if !errors.Is(err, domain.ErrForbidden) {
		t.Fatalf("owner Leave: want ErrForbidden, got %v", err)
	}
}
