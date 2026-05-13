package app

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"druz9/hone/domain"

	"github.com/google/uuid"
	"go.uber.org/mock/gomock"
)

// planRepoReturning — minimal-fake фабрика для тестов queue, которые требуют
// заданный план + behavior на Upsert/PatchItem. Возвращает уже-сконфигурированный
// MockPlanRepo через wire helper.
func planRepoReturning(t *testing.T, plan domain.Plan, err error) *planStore {
	t.Helper()
	s := newPlanStore()
	s.getForDateFn = func(_ context.Context, _ uuid.UUID, _ time.Time) (domain.Plan, error) {
		if err != nil {
			return domain.Plan{}, err
		}
		return plan, nil
	}
	return s
}

// ─── SyncAIItems ───────────────────────────────────────────────────────────

func TestSyncAIItems_CreatesFromPlan(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	q := newQueueStore()
	now := q.now
	uid := uuid.New()
	plans := planRepoReturning(t, domain.Plan{
		Items: []domain.PlanItem{
			{ID: "p1", Title: "System Design task", SkillKey: "system-design"},
			{ID: "p2", Title: "Code review PR #42", SkillKey: "code-review"},
		},
	}, nil)
	uc := &SyncAIItems{Plans: wireMockPlanRepo(ctrl, plans), Queue: wireMockQueueRepo(ctrl, q), Now: nowFn(now)}
	if err := uc.Do(context.Background(), uid); err != nil {
		t.Fatalf("SyncAIItems.Do: %v", err)
	}
	items, _ := uc.Queue.ListByDate(context.Background(), uid, now)
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
	ctrl := gomock.NewController(t)
	q := newQueueStore()
	uid := uuid.New()
	plans := planRepoReturning(t, domain.Plan{
		Items: []domain.PlanItem{{ID: "p1", Title: "Same task", SkillKey: "x"}},
	}, nil)
	uc := &SyncAIItems{Plans: wireMockPlanRepo(ctrl, plans), Queue: wireMockQueueRepo(ctrl, q), Now: nowFn(q.now)}
	for i := 0; i < 3; i++ {
		if err := uc.Do(context.Background(), uid); err != nil {
			t.Fatalf("call %d: %v", i, err)
		}
	}
	items, _ := uc.Queue.ListByDate(context.Background(), uid, q.now)
	if len(items) != 1 {
		t.Fatalf("want 1 item after 3 calls, got %d (duplication detected)", len(items))
	}
}

func TestSyncAIItems_PrunesStaleAITodosAndDedupesNormalizedTitles(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	q := newQueueStore()
	uid := uuid.New()
	today := q.now.UTC().Truncate(24 * time.Hour)
	queueMock := wireMockQueueRepo(ctrl, q)
	_, _ = queueMock.Create(context.Background(), domain.QueueItem{
		UserID: uid.String(), Title: "Cache drill!", Source: domain.QueueItemSourceAI, Status: domain.QueueItemStatusTodo, Date: today,
	})
	_, _ = queueMock.Create(context.Background(), domain.QueueItem{
		UserID: uid.String(), Title: "Cache drill.", Source: domain.QueueItemSourceAI, Status: domain.QueueItemStatusTodo, Date: today,
	})
	staleTodo, _ := queueMock.Create(context.Background(), domain.QueueItem{
		UserID: uid.String(), Title: "Old generic AI task", Source: domain.QueueItemSourceAI, Status: domain.QueueItemStatusTodo, Date: today,
	})
	doneAI, _ := queueMock.Create(context.Background(), domain.QueueItem{
		UserID: uid.String(), Title: "Completed AI task", Source: domain.QueueItemSourceAI, Status: domain.QueueItemStatusDone, Date: today,
	})
	userItem, _ := queueMock.Create(context.Background(), domain.QueueItem{
		UserID: uid.String(), Title: "Manual task", Source: domain.QueueItemSourceUser, Status: domain.QueueItemStatusTodo, Date: today,
	})
	plans := planRepoReturning(t, domain.Plan{
		Items: []domain.PlanItem{
			{ID: "p1", Title: "Cache drill", SkillKey: "cache"},
			{ID: "p2", Title: "Cache drill.", SkillKey: "cache"},
			{ID: "p3", Title: "Graph traversal warm-up", SkillKey: "graphs"},
		},
	}, nil)
	uc := &SyncAIItems{Plans: wireMockPlanRepo(ctrl, plans), Queue: queueMock, Now: nowFn(q.now)}

	if err := uc.Do(context.Background(), uid); err != nil {
		t.Fatalf("SyncAIItems.Do: %v", err)
	}
	items, _ := queueMock.ListByDate(context.Background(), uid, q.now)
	byTitle := map[string]domain.QueueItem{}
	for _, it := range items {
		byTitle[it.Title] = it
	}
	q.mu.Lock()
	_, stalePresent := q.items[staleTodo.ID]
	q.mu.Unlock()
	if stalePresent {
		t.Fatalf("stale AI todo still present")
	}
	q.mu.Lock()
	_, doneOK := q.items[doneAI.ID]
	_, userOK := q.items[userItem.ID]
	q.mu.Unlock()
	if !doneOK || !userOK {
		t.Fatalf("expected preserved items doneAI/userItem")
	}
	if _, ok := byTitle["Graph traversal warm-up"]; !ok {
		t.Fatalf("new plan item missing, items=%#v", items)
	}
	cacheCount := 0
	for _, it := range items {
		if queueTitleKey(it.Title) == "cache drill" {
			cacheCount++
		}
	}
	if cacheCount != 1 {
		t.Fatalf("cache drill duplicate count=%d, items=%#v", cacheCount, items)
	}
}

func TestSyncAIItems_NoPlan_NoError(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	q := newQueueStore()
	uid := uuid.New()
	plans := planRepoReturning(t, domain.Plan{}, domain.ErrNotFound)
	uc := &SyncAIItems{
		Plans: wireMockPlanRepo(ctrl, plans),
		Queue: wireMockQueueRepo(ctrl, q),
		Now:   nowFn(q.now),
	}
	if err := uc.Do(context.Background(), uid); err != nil {
		t.Fatalf("expected nil when plan absent, got %v", err)
	}
}

// ─── AddUserItem ───────────────────────────────────────────────────────────

func TestAddUserItem(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	q := newQueueStore()
	uid := uuid.New()
	uc := &AddUserItem{Queue: wireMockQueueRepo(ctrl, q), Now: nowFn(q.now)}
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
	ctrl := gomock.NewController(t)
	q := newQueueStore()
	uid := uuid.New()
	uc := &AddUserItem{Queue: wireMockQueueRepo(ctrl, q), Now: nowFn(q.now)}
	_, err := uc.Do(context.Background(), AddUserItemInput{UserID: uid, Title: "   "})
	if !errors.Is(err, domain.ErrInvalidInput) {
		t.Fatalf("expected ErrInvalidInput, got %v", err)
	}
}

// ─── UpdateStatus ──────────────────────────────────────────────────────────

func TestUpdateStatus_OnlyOneInProgress(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	q := newQueueStore()
	uid := uuid.New()
	queueMock := wireMockQueueRepo(ctrl, q)

	add := &AddUserItem{Queue: queueMock, Now: nowFn(q.now)}
	a, _ := add.Do(context.Background(), AddUserItemInput{UserID: uid, Title: "task A"})
	b, _ := add.Do(context.Background(), AddUserItemInput{UserID: uid, Title: "task B"})

	upd := &UpdateItemStatus{Queue: queueMock}
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

	q.mu.Lock()
	itA := q.items[a.ID]
	itB := q.items[b.ID]
	q.mu.Unlock()
	if itA.Status != domain.QueueItemStatusTodo {
		t.Errorf("A.status=%s, want todo (peer reset)", itA.Status)
	}
	if itB.Status != domain.QueueItemStatusInProgress {
		t.Errorf("B.status=%s, want in_progress", itB.Status)
	}
}

func TestUpdateStatus_Transitions(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	q := newQueueStore()
	uid := uuid.New()
	queueMock := wireMockQueueRepo(ctrl, q)
	add := &AddUserItem{Queue: queueMock, Now: nowFn(q.now)}
	it, _ := add.Do(context.Background(), AddUserItemInput{UserID: uid, Title: "x"})
	id, _ := uuid.Parse(it.ID)

	upd := &UpdateItemStatus{Queue: queueMock}
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
	ctrl := gomock.NewController(t)
	q := newQueueStore()
	uid := uuid.New()
	upd := &UpdateItemStatus{Queue: wireMockQueueRepo(ctrl, q)}
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
	ctrl := gomock.NewController(t)
	q := newQueueStore()
	uid := uuid.New()
	queueMock := wireMockQueueRepo(ctrl, q)
	add := &AddUserItem{Queue: queueMock, Now: nowFn(q.now)}
	it, _ := add.Do(context.Background(), AddUserItemInput{UserID: uid, Title: "to delete"})

	id, _ := uuid.Parse(it.ID)
	del := &DeleteItem{Queue: queueMock}
	if err := del.Do(context.Background(), DeleteItemInput{UserID: uid, ItemID: id}); err != nil {
		t.Fatalf("DeleteItem.Do: %v", err)
	}
	items, _ := queueMock.ListByDate(context.Background(), uid, q.now)
	for _, x := range items {
		if x.ID == it.ID {
			t.Fatalf("item still present after delete: %+v", x)
		}
	}
}

// ─── GetQueueStats ─────────────────────────────────────────────────────────

func TestGetQueueStats(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	q := newQueueStore()
	uid := uuid.New()

	// 2 today (1 done, 1 todo) + 1 yesterday done.
	q.mu.Lock()
	q.items["a"] = domain.QueueItem{ID: "a", UserID: uid.String(), Title: "a", Status: domain.QueueItemStatusDone, Source: domain.QueueItemSourceAI, Date: q.now.UTC().Truncate(24 * time.Hour)}
	q.items["b"] = domain.QueueItem{ID: "b", UserID: uid.String(), Title: "b", Status: domain.QueueItemStatusTodo, Source: domain.QueueItemSourceUser, Date: q.now.UTC().Truncate(24 * time.Hour)}
	q.items["c"] = domain.QueueItem{ID: "c", UserID: uid.String(), Title: "c", Status: domain.QueueItemStatusDone, Source: domain.QueueItemSourceUser, Date: q.now.AddDate(0, 0, -1).UTC().Truncate(24 * time.Hour)}
	q.mu.Unlock()

	uc := &GetQueueStats{Queue: wireMockQueueRepo(ctrl, q)}
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
