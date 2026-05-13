package app

import (
	"context"
	"io"
	"log/slog"
	"sync"
	"time"

	"druz9/hone/domain"
	honeMocks "druz9/hone/domain/mocks"

	"github.com/google/uuid"
	"go.uber.org/mock/gomock"
)

// discardLogger — silent logger shared by all hone/app tests.
func discardLogger() *slog.Logger { return slog.New(slog.NewTextHandler(io.Discard, nil)) }

// fixedNow — deterministic timestamp shared by plan / queue / note tests.
func fixedNow() time.Time { return time.Date(2026, 4, 24, 10, 0, 0, 0, time.UTC) }

// nowFn — adapter превращает time.Time в `func() time.Time`.
func nowFn(t time.Time) func() time.Time { return func() time.Time { return t } }

// containsString — small helper used by plan_test.
func containsString(xs []string, want string) bool {
	for _, x := range xs {
		if x == want {
			return true
		}
	}
	return false
}

// ─── PlanRepo: state + wire ───────────────────────────────────────────────
//
// planStore — закрытая state-машина: GetForDate возвращает заданный plan
// + err; Upsert/PatchItem пишут в slot и возвращают саму запись. Тесты
// читают upserted напрямую через мутекс.

type planStore struct {
	mu             sync.Mutex
	getForDateFn   func(context.Context, uuid.UUID, time.Time) (domain.Plan, error)
	upsertFn       func(context.Context, domain.Plan) (domain.Plan, error)
	patchFn        func(context.Context, uuid.UUID, time.Time, string, bool, bool) (domain.Plan, error)
	upserted       domain.Plan
	upsertedExists bool
}

func newPlanStore() *planStore { return &planStore{} }

func (s *planStore) lastUpsert() domain.Plan {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.upserted
}

func wireMockPlanRepo(ctrl *gomock.Controller, s *planStore) *honeMocks.MockPlanRepo {
	m := honeMocks.NewMockPlanRepo(ctrl)
	m.EXPECT().GetForDate(gomock.Any(), gomock.Any(), gomock.Any()).DoAndReturn(
		func(ctx context.Context, u uuid.UUID, d time.Time) (domain.Plan, error) {
			s.mu.Lock()
			fn := s.getForDateFn
			s.mu.Unlock()
			if fn != nil {
				return fn(ctx, u, d)
			}
			return domain.Plan{}, domain.ErrNotFound
		},
	).AnyTimes()
	m.EXPECT().Upsert(gomock.Any(), gomock.Any()).DoAndReturn(
		func(ctx context.Context, p domain.Plan) (domain.Plan, error) {
			s.mu.Lock()
			fn := s.upsertFn
			s.upserted = p
			s.upsertedExists = true
			s.mu.Unlock()
			if fn != nil {
				return fn(ctx, p)
			}
			return p, nil
		},
	).AnyTimes()
	m.EXPECT().PatchItem(gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any()).DoAndReturn(
		func(ctx context.Context, u uuid.UUID, d time.Time, id string, dis, comp bool) (domain.Plan, error) {
			s.mu.Lock()
			fn := s.patchFn
			s.mu.Unlock()
			if fn != nil {
				return fn(ctx, u, d, id, dis, comp)
			}
			return domain.Plan{}, nil
		},
	).AnyTimes()
	return m
}

// ─── SkillAtlasReader: state + wire ───────────────────────────────────────

type skillsStore struct {
	mu    sync.Mutex
	nodes []domain.WeakNode
}

func wireMockSkillAtlasReader(ctrl *gomock.Controller, s *skillsStore) *honeMocks.MockSkillAtlasReader {
	m := honeMocks.NewMockSkillAtlasReader(ctrl)
	m.EXPECT().WeakestNodes(gomock.Any(), gomock.Any(), gomock.Any()).DoAndReturn(
		func(_ context.Context, _ uuid.UUID, _ int) ([]domain.WeakNode, error) {
			s.mu.Lock()
			defer s.mu.Unlock()
			return s.nodes, nil
		},
	).AnyTimes()
	return m
}

// ─── PlanSynthesizer: state + wire ────────────────────────────────────────

type synthState struct {
	mu          sync.Mutex
	items       []domain.PlanItem
	err         error
	calls       int
	todaySeen   domain.TodayContext
	weakSeen    []domain.WeakNode
	chronicSeen []domain.ChronicSkill
}

func wireMockPlanSynthesizer(ctrl *gomock.Controller, s *synthState) *honeMocks.MockPlanSynthesizer {
	m := honeMocks.NewMockPlanSynthesizer(ctrl)
	m.EXPECT().Synthesise(gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any()).DoAndReturn(
		func(_ context.Context, _ uuid.UUID, weak []domain.WeakNode, chronic []domain.ChronicSkill, today domain.TodayContext, _ time.Time) ([]domain.PlanItem, error) {
			s.mu.Lock()
			defer s.mu.Unlock()
			s.calls++
			s.weakSeen = weak
			s.chronicSeen = chronic
			s.todaySeen = today
			return s.items, s.err
		},
	).AnyTimes()
	return m
}

// ─── NoteRepo: state + wire ──────────────────────────────────────────────
//
// noteStore — для note и plan тестов: list/get callbacks. Минимальный
// set чтобы тесты могли инжектить именно те ответы которые им нужны.

type noteStore struct {
	mu     sync.Mutex
	listFn func(context.Context, uuid.UUID, int, string, *uuid.UUID) ([]domain.NoteSummary, string, error)
	getFn  func(context.Context, uuid.UUID, uuid.UUID) (domain.Note, error)
	create func(context.Context, domain.Note) (domain.Note, error)
	update func(context.Context, domain.Note) (domain.Note, error)
}

func newNoteStore() *noteStore { return &noteStore{} }

func wireMockNoteRepo(ctrl *gomock.Controller, s *noteStore) *honeMocks.MockNoteRepo {
	m := honeMocks.NewMockNoteRepo(ctrl)
	m.EXPECT().Create(gomock.Any(), gomock.Any()).DoAndReturn(
		func(ctx context.Context, n domain.Note) (domain.Note, error) {
			s.mu.Lock()
			fn := s.create
			s.mu.Unlock()
			if fn != nil {
				return fn(ctx, n)
			}
			return n, nil
		},
	).AnyTimes()
	m.EXPECT().Update(gomock.Any(), gomock.Any()).DoAndReturn(
		func(ctx context.Context, n domain.Note) (domain.Note, error) {
			s.mu.Lock()
			fn := s.update
			s.mu.Unlock()
			if fn != nil {
				return fn(ctx, n)
			}
			return n, nil
		},
	).AnyTimes()
	m.EXPECT().Get(gomock.Any(), gomock.Any(), gomock.Any()).DoAndReturn(
		func(ctx context.Context, uid, nid uuid.UUID) (domain.Note, error) {
			s.mu.Lock()
			fn := s.getFn
			s.mu.Unlock()
			if fn != nil {
				return fn(ctx, uid, nid)
			}
			return domain.Note{}, domain.ErrNotFound
		},
	).AnyTimes()
	m.EXPECT().List(gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any()).DoAndReturn(
		func(ctx context.Context, uid uuid.UUID, limit int, cursor string, folderID *uuid.UUID) ([]domain.NoteSummary, string, error) {
			s.mu.Lock()
			fn := s.listFn
			s.mu.Unlock()
			if fn != nil {
				return fn(ctx, uid, limit, cursor, folderID)
			}
			return nil, "", nil
		},
	).AnyTimes()
	m.EXPECT().Move(gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any()).Return(domain.Note{}, domain.ErrNotFound).AnyTimes()
	m.EXPECT().Delete(gomock.Any(), gomock.Any(), gomock.Any()).Return(nil).AnyTimes()
	m.EXPECT().SetEmbedding(gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any()).Return(nil).AnyTimes()
	m.EXPECT().WithEmbeddingsForUser(gomock.Any(), gomock.Any(), gomock.Any()).Return(nil, nil).AnyTimes()
	m.EXPECT().ExistsByTitleForUser(gomock.Any(), gomock.Any(), gomock.Any()).Return(false, nil).AnyTimes()
	m.EXPECT().MarkStaleForReembed(gomock.Any(), gomock.Any()).Return(int64(0), nil).AnyTimes()
	m.EXPECT().SearchSimilarNotes(gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any()).Return(nil, nil).AnyTimes()
	return m
}

// ─── QueueRepo: in-memory state ──────────────────────────────────────────
//
// Queue — самый stateful. Бизнес-правило: при UpdateStatus(in_progress)
// все остальные in_progress этого пользователя за сегодня сбрасываются
// в todo. ListByDate и аггрегаты должны видеть итоговое состояние.

type queueStore struct {
	mu    sync.Mutex
	items map[string]domain.QueueItem
	now   time.Time
}

func newQueueStore() *queueStore {
	return &queueStore{
		items: map[string]domain.QueueItem{},
		now:   time.Date(2026, 4, 25, 12, 0, 0, 0, time.UTC),
	}
}

func wireMockQueueRepo(ctrl *gomock.Controller, q *queueStore) *honeMocks.MockQueueRepo {
	m := honeMocks.NewMockQueueRepo(ctrl)
	m.EXPECT().ListByDate(gomock.Any(), gomock.Any(), gomock.Any()).DoAndReturn(
		func(_ context.Context, userID uuid.UUID, date time.Time) ([]domain.QueueItem, error) {
			q.mu.Lock()
			defer q.mu.Unlock()
			out := []domain.QueueItem{}
			want := date.Truncate(24 * time.Hour)
			for _, it := range q.items {
				if it.UserID != userID.String() {
					continue
				}
				if !it.Date.Truncate(24 * time.Hour).Equal(want) {
					continue
				}
				out = append(out, it)
			}
			return out, nil
		},
	).AnyTimes()
	m.EXPECT().Create(gomock.Any(), gomock.Any()).DoAndReturn(
		func(_ context.Context, item domain.QueueItem) (domain.QueueItem, error) {
			q.mu.Lock()
			defer q.mu.Unlock()
			id := uuid.New().String()
			item.ID = id
			if item.CreatedAt.IsZero() {
				item.CreatedAt = q.now
			}
			item.UpdatedAt = item.CreatedAt
			q.items[id] = item
			return item, nil
		},
	).AnyTimes()
	m.EXPECT().UpdateStatus(gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any()).DoAndReturn(
		func(_ context.Context, id, userID uuid.UUID, status domain.QueueItemStatus) (domain.QueueItem, error) {
			q.mu.Lock()
			defer q.mu.Unlock()
			target, ok := q.items[id.String()]
			if !ok || target.UserID != userID.String() {
				return domain.QueueItem{}, domain.ErrNotFound
			}
			if status == domain.QueueItemStatusInProgress {
				today := q.now.UTC().Truncate(24 * time.Hour)
				for k, it := range q.items {
					if it.UserID != userID.String() {
						continue
					}
					if !it.Date.Truncate(24 * time.Hour).Equal(today) {
						continue
					}
					if it.Status == domain.QueueItemStatusInProgress && k != id.String() {
						it.Status = domain.QueueItemStatusTodo
						it.UpdatedAt = q.now
						q.items[k] = it
					}
				}
			}
			target.Status = status
			target.UpdatedAt = q.now
			q.items[id.String()] = target
			return target, nil
		},
	).AnyTimes()
	m.EXPECT().Delete(gomock.Any(), gomock.Any(), gomock.Any()).DoAndReturn(
		func(_ context.Context, id, userID uuid.UUID) error {
			q.mu.Lock()
			defer q.mu.Unlock()
			it, ok := q.items[id.String()]
			if !ok || it.UserID != userID.String() {
				return domain.ErrNotFound
			}
			delete(q.items, id.String())
			return nil
		},
	).AnyTimes()
	m.EXPECT().ExistsByTitleToday(gomock.Any(), gomock.Any(), gomock.Any()).DoAndReturn(
		func(_ context.Context, userID uuid.UUID, title string) (bool, error) {
			q.mu.Lock()
			defer q.mu.Unlock()
			today := q.now.UTC().Truncate(24 * time.Hour)
			for _, it := range q.items {
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
		},
	).AnyTimes()
	m.EXPECT().CountTodayByStatus(gomock.Any(), gomock.Any()).DoAndReturn(
		func(_ context.Context, userID uuid.UUID) (int, int, error) {
			q.mu.Lock()
			defer q.mu.Unlock()
			var total, done int
			today := q.now.UTC().Truncate(24 * time.Hour)
			for _, it := range q.items {
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
		},
	).AnyTimes()
	m.EXPECT().GetAIShareLast7Days(gomock.Any(), gomock.Any()).DoAndReturn(
		func(_ context.Context, userID uuid.UUID) (float32, float32, error) {
			q.mu.Lock()
			defer q.mu.Unlock()
			cutoff := q.now.AddDate(0, 0, -7)
			var ai, user int
			for _, it := range q.items {
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
		},
	).AnyTimes()
	return m
}
