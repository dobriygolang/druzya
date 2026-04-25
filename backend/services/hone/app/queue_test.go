package app

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"druz9/hone/domain"

	"github.com/google/uuid"
)

// ─── fake QueueRepo ────────────────────────────────────────────────────────
//
// Stateful in-memory fake: items живут в map keyed by id. Симулирует
// бизнес-правило одного in_progress в UpdateStatus — нужно для теста
// TestUpdateStatus_OnlyOneInProgress (он зависит от поведения repo).

type fakeQueueRepo struct {
	items map[string]domain.QueueItem
	now   time.Time
}

func newFakeQueueRepo() *fakeQueueRepo {
	return &fakeQueueRepo{
		items: map[string]domain.QueueItem{},
		now:   time.Date(2026, 4, 25, 12, 0, 0, 0, time.UTC),
	}
}

func (f *fakeQueueRepo) ListByDate(_ context.Context, userID uuid.UUID, date time.Time) ([]domain.QueueItem, error) {
	out := []domain.QueueItem{}
	want := date.Truncate(24 * time.Hour)
	for _, it := range f.items {
		if it.UserID != userID.String() {
			continue
		}
		if !it.Date.Truncate(24 * time.Hour).Equal(want) {
			continue
		}
		out = append(out, it)
	}
	return out, nil
}

func (f *fakeQueueRepo) Create(_ context.Context, item domain.QueueItem) (domain.QueueItem, error) {
	id := uuid.New().String()
	item.ID = id
	if item.CreatedAt.IsZero() {
		item.CreatedAt = f.now
	}
	item.UpdatedAt = item.CreatedAt
	f.items[id] = item
	return item, nil
}

func (f *fakeQueueRepo) UpdateStatus(_ context.Context, id, userID uuid.UUID, status domain.QueueItemStatus) (domain.QueueItem, error) {
	target, ok := f.items[id.String()]
	if !ok || target.UserID != userID.String() {
		return domain.QueueItem{}, domain.ErrNotFound
	}
	if status == domain.QueueItemStatusInProgress {
		// Reset peers — same user, today.
		today := f.now.UTC().Truncate(24 * time.Hour)
		for k, it := range f.items {
			if it.UserID != userID.String() {
				continue
			}
			if !it.Date.Truncate(24 * time.Hour).Equal(today) {
				continue
			}
			if it.Status == domain.QueueItemStatusInProgress && k != id.String() {
				it.Status = domain.QueueItemStatusTodo
				it.UpdatedAt = f.now
				f.items[k] = it
			}
		}
	}
	target.Status = status
	target.UpdatedAt = f.now
	f.items[id.String()] = target
	return target, nil
}

func (f *fakeQueueRepo) Delete(_ context.Context, id, userID uuid.UUID) error {
	it, ok := f.items[id.String()]
	if !ok || it.UserID != userID.String() {
		return domain.ErrNotFound
	}
	delete(f.items, id.String())
	return nil
}

func (f *fakeQueueRepo) ExistsByTitleToday(_ context.Context, userID uuid.UUID, title string) (bool, error) {
	today := f.now.UTC().Truncate(24 * time.Hour)
	for _, it := range f.items {
		if it.UserID != userID.String() {
			continue
		}
		if !it.Date.Truncate(24 * time.Hour).Equal(today) {
			continue
		}
		if it.Title == title {
			return true, nil
		}
	}
	return false, nil
}

func (f *fakeQueueRepo) CountTodayByStatus(_ context.Context, userID uuid.UUID) (total, done int, err error) {
	today := f.now.UTC().Truncate(24 * time.Hour)
	for _, it := range f.items {
		if it.UserID != userID.String() {
			continue
		}
		if !it.Date.Truncate(24 * time.Hour).Equal(today) {
			continue
		}
		total++
		if it.Status == domain.QueueItemStatusDone {
			done++
		}
	}
	return total, done, nil
}

func (f *fakeQueueRepo) GetAIShareLast7Days(_ context.Context, userID uuid.UUID) (float32, float32, error) {
	cutoff := f.now.AddDate(0, 0, -7)
	var ai, user int
	for _, it := range f.items {
		if it.UserID != userID.String() {
			continue
		}
		if it.Status != domain.QueueItemStatusDone {
			continue
		}
		if it.Date.Before(cutoff) {
			continue
		}
		if it.Source == domain.QueueItemSourceAI {
			ai++
		} else {
			user++
		}
	}
	total := ai + user
	if total == 0 {
		return 0, 0, nil
	}
	return float32(ai) / float32(total), float32(user) / float32(total), nil
}

// fakePlanRepo переиспользуется из plan_test.go (тот же package). Helper-
// конструктор ниже строит минимальный fake с фиксированным GetForDate.

func planRepoReturning(plan domain.Plan, err error) fakePlanRepo {
	return fakePlanRepo{
		getForDate: func(_ context.Context, _ uuid.UUID, _ time.Time) (domain.Plan, error) {
			if err != nil {
				return domain.Plan{}, err
			}
			return plan, nil
		},
		upsert: func(_ context.Context, p domain.Plan) (domain.Plan, error) { return p, nil },
		patchItem: func(_ context.Context, _ uuid.UUID, _ time.Time, _ string, _, _ bool) (domain.Plan, error) {
			return domain.Plan{}, nil
		},
	}
}

// ─── helpers ───────────────────────────────────────────────────────────────

func nowFn(t time.Time) func() time.Time { return func() time.Time { return t } }

// ─── SyncAIItems ───────────────────────────────────────────────────────────

func TestSyncAIItems_CreatesFromPlan(t *testing.T) {
	t.Parallel()
	q := newFakeQueueRepo()
	now := q.now
	uid := uuid.New()
	plans := planRepoReturning(domain.Plan{
		Items: []domain.PlanItem{
			{ID: "p1", Title: "System Design task", SkillKey: "system-design"},
			{ID: "p2", Title: "Code review PR #42", SkillKey: "code-review"},
		},
	}, nil)
	uc := &SyncAIItems{Plans: plans, Queue: q, Now: nowFn(now)}
	if err := uc.Do(context.Background(), uid); err != nil {
		t.Fatalf("SyncAIItems.Do: %v", err)
	}
	items, _ := q.ListByDate(context.Background(), uid, now)
	if len(items) != 2 {
		t.Fatalf("want 2 AI items, got %d", len(items))
	}
	titles := map[string]string{}
	for _, it := range items {
		if it.Source != domain.QueueItemSourceAI {
			t.Errorf("expected source=ai, got %s", it.Source)
		}
		if it.Status != domain.QueueItemStatusTodo {
			t.Errorf("expected status=todo, got %s", it.Status)
		}
		titles[it.Title] = it.SkillKey
	}
	if titles["System Design task"] != "system-design" {
		t.Errorf("skill_key for 'System Design task' = %q, want 'system-design'", titles["System Design task"])
	}
	if titles["Code review PR #42"] != "code-review" {
		t.Errorf("skill_key for 'Code review' = %q", titles["Code review PR #42"])
	}
}

func TestSyncAIItems_Idempotent(t *testing.T) {
	t.Parallel()
	q := newFakeQueueRepo()
	uid := uuid.New()
	plans := planRepoReturning(domain.Plan{
		Items: []domain.PlanItem{{ID: "p1", Title: "Same task", SkillKey: "x"}},
	}, nil)
	uc := &SyncAIItems{Plans: plans, Queue: q, Now: nowFn(q.now)}
	for i := 0; i < 3; i++ {
		if err := uc.Do(context.Background(), uid); err != nil {
			t.Fatalf("call %d: %v", i, err)
		}
	}
	items, _ := q.ListByDate(context.Background(), uid, q.now)
	if len(items) != 1 {
		t.Fatalf("want 1 item after 3 calls, got %d (duplication detected)", len(items))
	}
}

func TestSyncAIItems_NoPlan_NoError(t *testing.T) {
	t.Parallel()
	q := newFakeQueueRepo()
	uid := uuid.New()
	uc := &SyncAIItems{
		Plans: planRepoReturning(domain.Plan{}, domain.ErrNotFound),
		Queue: q,
		Now:   nowFn(q.now),
	}
	if err := uc.Do(context.Background(), uid); err != nil {
		t.Fatalf("expected nil when plan absent, got %v", err)
	}
}

// ─── AddUserItem ───────────────────────────────────────────────────────────

func TestAddUserItem(t *testing.T) {
	t.Parallel()
	q := newFakeQueueRepo()
	uid := uuid.New()
	uc := &AddUserItem{Queue: q, Now: nowFn(q.now)}
	out, err := uc.Do(context.Background(), AddUserItemInput{UserID: uid, Title: "  buy milk  "})
	if err != nil {
		t.Fatalf("AddUserItem.Do: %v", err)
	}
	if out.Title != "buy milk" {
		t.Errorf("title not trimmed: %q", out.Title)
	}
	if out.Source != domain.QueueItemSourceUser {
		t.Errorf("source=%s, want user", out.Source)
	}
	if out.Status != domain.QueueItemStatusTodo {
		t.Errorf("status=%s, want todo", out.Status)
	}
}

func TestAddUserItem_EmptyTitle(t *testing.T) {
	t.Parallel()
	q := newFakeQueueRepo()
	uid := uuid.New()
	uc := &AddUserItem{Queue: q, Now: nowFn(q.now)}
	_, err := uc.Do(context.Background(), AddUserItemInput{UserID: uid, Title: "   "})
	if !errors.Is(err, domain.ErrInvalidInput) {
		t.Fatalf("expected ErrInvalidInput, got %v", err)
	}
}

// ─── UpdateStatus ──────────────────────────────────────────────────────────

func TestUpdateStatus_OnlyOneInProgress(t *testing.T) {
	t.Parallel()
	q := newFakeQueueRepo()
	uid := uuid.New()

	add := &AddUserItem{Queue: q, Now: nowFn(q.now)}
	a, _ := add.Do(context.Background(), AddUserItemInput{UserID: uid, Title: "task A"})
	b, _ := add.Do(context.Background(), AddUserItemInput{UserID: uid, Title: "task B"})

	upd := &UpdateItemStatus{Queue: q}
	idA, _ := uuid.Parse(a.ID)
	idB, _ := uuid.Parse(b.ID)

	if _, err := upd.Do(context.Background(), UpdateItemStatusInput{
		UserID: uid, ItemID: idA, Status: domain.QueueItemStatusInProgress,
	}); err != nil {
		t.Fatalf("set A in_progress: %v", err)
	}
	if _, err := upd.Do(context.Background(), UpdateItemStatusInput{
		UserID: uid, ItemID: idB, Status: domain.QueueItemStatusInProgress,
	}); err != nil {
		t.Fatalf("set B in_progress: %v", err)
	}

	// A должна автоматически сброситься в todo, потому что B только что
	// перешла в in_progress (бизнес-правило одного in_progress).
	itA := q.items[a.ID]
	itB := q.items[b.ID]
	if itA.Status != domain.QueueItemStatusTodo {
		t.Errorf("A.status=%s, want todo (peer reset)", itA.Status)
	}
	if itB.Status != domain.QueueItemStatusInProgress {
		t.Errorf("B.status=%s, want in_progress", itB.Status)
	}
}

func TestUpdateStatus_Transitions(t *testing.T) {
	t.Parallel()
	q := newFakeQueueRepo()
	uid := uuid.New()
	add := &AddUserItem{Queue: q, Now: nowFn(q.now)}
	it, _ := add.Do(context.Background(), AddUserItemInput{UserID: uid, Title: "x"})
	id, _ := uuid.Parse(it.ID)

	upd := &UpdateItemStatus{Queue: q}
	for _, s := range []domain.QueueItemStatus{
		domain.QueueItemStatusInProgress,
		domain.QueueItemStatusDone,
		domain.QueueItemStatusTodo,
	} {
		out, err := upd.Do(context.Background(), UpdateItemStatusInput{
			UserID: uid, ItemID: id, Status: s,
		})
		if err != nil {
			t.Fatalf("transition to %s: %v", s, err)
		}
		if out.Status != s {
			t.Errorf("returned status=%s, want %s", out.Status, s)
		}
	}
}

func TestUpdateStatus_InvalidStatus(t *testing.T) {
	t.Parallel()
	q := newFakeQueueRepo()
	uid := uuid.New()
	upd := &UpdateItemStatus{Queue: q}
	_, err := upd.Do(context.Background(), UpdateItemStatusInput{
		UserID: uid, ItemID: uuid.New(), Status: domain.QueueItemStatus("bogus"),
	})
	if !errors.Is(err, domain.ErrInvalidInput) {
		t.Fatalf("expected ErrInvalidInput, got %v", err)
	}
}

// ─── DeleteItem ────────────────────────────────────────────────────────────

func TestDeleteItem(t *testing.T) {
	t.Parallel()
	q := newFakeQueueRepo()
	uid := uuid.New()
	add := &AddUserItem{Queue: q, Now: nowFn(q.now)}
	it, _ := add.Do(context.Background(), AddUserItemInput{UserID: uid, Title: "to delete"})

	id, _ := uuid.Parse(it.ID)
	del := &DeleteItem{Queue: q}
	if err := del.Do(context.Background(), DeleteItemInput{UserID: uid, ItemID: id}); err != nil {
		t.Fatalf("DeleteItem.Do: %v", err)
	}
	items, _ := q.ListByDate(context.Background(), uid, q.now)
	for _, x := range items {
		if x.ID == it.ID {
			t.Fatalf("item still present after delete: %+v", x)
		}
	}
}

// ─── GetQueueStats ─────────────────────────────────────────────────────────

func TestGetQueueStats(t *testing.T) {
	t.Parallel()
	q := newFakeQueueRepo()
	uid := uuid.New()

	// 2 today (1 done, 1 todo) + 1 yesterday done.
	q.items["a"] = domain.QueueItem{ID: "a", UserID: uid.String(), Title: "a", Status: domain.QueueItemStatusDone, Source: domain.QueueItemSourceAI, Date: q.now.UTC().Truncate(24 * time.Hour)}
	q.items["b"] = domain.QueueItem{ID: "b", UserID: uid.String(), Title: "b", Status: domain.QueueItemStatusTodo, Source: domain.QueueItemSourceUser, Date: q.now.UTC().Truncate(24 * time.Hour)}
	q.items["c"] = domain.QueueItem{ID: "c", UserID: uid.String(), Title: "c", Status: domain.QueueItemStatusDone, Source: domain.QueueItemSourceUser, Date: q.now.AddDate(0, 0, -1).UTC().Truncate(24 * time.Hour)}

	uc := &GetQueueStats{Queue: q}
	stats, err := uc.Do(context.Background(), uid)
	if err != nil {
		t.Fatalf("GetQueueStats.Do: %v", err)
	}
	if stats.TodayTotal != 2 {
		t.Errorf("TodayTotal=%d want 2", stats.TodayTotal)
	}
	if stats.TodayDone != 1 {
		t.Errorf("TodayDone=%d want 1", stats.TodayDone)
	}
	// 1 ai done + 1 user done за 7 дней → 0.5 / 0.5.
	if stats.AIShare != 0.5 || stats.UserShare != 0.5 {
		t.Errorf("AI/User share = %v / %v, want 0.5/0.5", stats.AIShare, stats.UserShare)
	}
}

// Sanity: prevent unused-import warning if strings module ever deemed unused.
var _ = strings.TrimSpace
