package app

import (
	"context"
	"sync"
	"time"

	"druz9/intelligence/domain"
	mocks "druz9/intelligence/domain/mocks"

	"github.com/google/uuid"
	"go.uber.org/mock/gomock"
)

// Wave 13 — shared test helpers для всех intelligence/app tests.
//
// Каждый store-тип отвечает за in-memory state-машину одного интерфейса.
// wireMock* helper подключает store к mockgen-generated mock через
// DoAndReturn-closures, эмулируя поведение реального адаптера.
//
// Тесты обращаются к полям store напрямую через mutex для assertion'ов.

// ─── DailyBriefRepo: store + wire ─────────────────────────────────────────

type dailyBriefStore struct {
	mu    sync.Mutex
	saved domain.DailyBrief
}

func wireMockDailyBriefRepo(ctrl *gomock.Controller, s *dailyBriefStore) *mocks.MockDailyBriefRepo {
	m := mocks.NewMockDailyBriefRepo(ctrl)
	m.EXPECT().GetForDate(gomock.Any(), gomock.Any(), gomock.Any()).Return(domain.DailyBrief{}, domain.ErrNotFound).AnyTimes()
	m.EXPECT().Upsert(gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any()).DoAndReturn(
		func(_ context.Context, _ uuid.UUID, _ time.Time, b domain.DailyBrief) error {
			s.mu.Lock()
			defer s.mu.Unlock()
			s.saved = b
			return nil
		},
	).AnyTimes()
	m.EXPECT().LastForcedAt(gomock.Any(), gomock.Any()).Return(time.Time{}, nil).AnyTimes()
	m.EXPECT().RecentForUser(gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any()).Return(nil, nil).AnyTimes()
	return m
}

// ─── EpisodeRepo: store + wire ────────────────────────────────────────────

type episodeStore struct {
	mu            sync.Mutex
	appendErr     error
	appended      []domain.Episode
	getUserID     uuid.UUID
	getBriefID    uuid.UUID
	getRecs       []domain.Recommendation
	latestByKinds []domain.Episode
}

func wireMockEpisodeRepo(ctrl *gomock.Controller, s *episodeStore) *mocks.MockEpisodeRepo {
	m := mocks.NewMockEpisodeRepo(ctrl)
	m.EXPECT().Append(gomock.Any(), gomock.Any()).DoAndReturn(
		func(_ context.Context, e domain.Episode) error {
			s.mu.Lock()
			defer s.mu.Unlock()
			s.appended = append(s.appended, e)
			return s.appendErr
		},
	).AnyTimes()
	m.EXPECT().LatestByKind(gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any()).Return(nil, nil).AnyTimes()
	m.EXPECT().LatestByKinds(gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any()).DoAndReturn(
		func(_ context.Context, _ uuid.UUID, _ []domain.EpisodeKind, _ int) ([]domain.Episode, error) {
			s.mu.Lock()
			defer s.mu.Unlock()
			return s.latestByKinds, nil
		},
	).AnyTimes()
	m.EXPECT().LatestPerKind(gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any()).Return(nil, nil).AnyTimes()
	m.EXPECT().SearchSimilar(gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any()).Return(nil, nil).AnyTimes()
	m.EXPECT().PendingEmbeddings(gomock.Any(), gomock.Any()).Return(nil, nil).AnyTimes()
	m.EXPECT().SetEmbedding(gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any()).Return(nil).AnyTimes()
	m.EXPECT().Stats30d(gomock.Any(), gomock.Any()).Return(domain.MemoryStats{}, nil).AnyTimes()
	m.EXPECT().GetBriefRecommendations(gomock.Any(), gomock.Any(), gomock.Any()).DoAndReturn(
		func(_ context.Context, userID, briefID uuid.UUID) ([]domain.Recommendation, error) {
			s.mu.Lock()
			defer s.mu.Unlock()
			s.getUserID = userID
			s.getBriefID = briefID
			if s.getRecs != nil {
				return s.getRecs, nil
			}
			return nil, domain.ErrEpisodeNotFound
		},
	).AnyTimes()
	m.EXPECT().DeleteOlderThan(gomock.Any(), gomock.Any()).Return(int64(0), nil).AnyTimes()
	m.EXPECT().MarkStaleForReembed(gomock.Any(), gomock.Any()).Return(int64(0), nil).AnyTimes()
	m.EXPECT().CountByKindInRange(gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any()).Return(nil, nil).AnyTimes()
	m.EXPECT().HasWeeklySummary(gomock.Any(), gomock.Any(), gomock.Any()).Return(false, nil).AnyTimes()
	return m
}

// ─── FocusReader, PlanReader, NotesReader: zero-state wires ─────────────

func wireMockFocusReader(ctrl *gomock.Controller) *mocks.MockFocusReader {
	m := mocks.NewMockFocusReader(ctrl)
	m.EXPECT().LastNDays(gomock.Any(), gomock.Any(), gomock.Any()).Return(nil, nil).AnyTimes()
	return m
}

func wireMockPlanReader(ctrl *gomock.Controller) *mocks.MockPlanReader {
	m := mocks.NewMockPlanReader(ctrl)
	m.EXPECT().SkippedItems(gomock.Any(), gomock.Any(), gomock.Any()).Return(nil, nil).AnyTimes()
	m.EXPECT().CompletedItems(gomock.Any(), gomock.Any(), gomock.Any()).Return(nil, nil).AnyTimes()
	return m
}

func wireMockNotesReader(ctrl *gomock.Controller) *mocks.MockNotesReader {
	m := mocks.NewMockNotesReader(ctrl)
	m.EXPECT().RecentReflections(gomock.Any(), gomock.Any(), gomock.Any()).Return(nil, nil).AnyTimes()
	m.EXPECT().RecentNotes(gomock.Any(), gomock.Any(), gomock.Any()).Return(nil, nil).AnyTimes()
	m.EXPECT().EmbeddedCorpus(gomock.Any(), gomock.Any()).Return(nil, nil).AnyTimes()
	return m
}

// ─── BriefSynthesizer interface lives in app package ───────────────────
//
// BriefSynthesizer — local interface, нужен go:generate в brief.go или подобном.
// Здесь — inline-wrapper, так как используется только в одном файле.

// stubBriefSynthesizer — фиксированный happy-path output для тестов.
type stubBriefSynthesizer struct{}

func (stubBriefSynthesizer) Synthesise(context.Context, domain.BriefPromptInput) (domain.DailyBrief, error) {
	return domain.DailyBrief{
		Headline:  "Cache gap is actionable.",
		Narrative: "The repeated signal is cache-design.",
		Recommendations: []domain.Recommendation{{
			Kind:      domain.RecommendationTinyTask,
			Title:     "Write 3 cache tradeoffs.",
			Rationale: "cache-design is repeated.",
		}},
	}, nil
}

// ─── ResourceEngagementReader: store + wire ─────────────────────────────

type resEngStore struct {
	mu   sync.Mutex
	resp domain.ResourceEngagement
	err  error
}

func wireMockResourceEngagementReader(ctrl *gomock.Controller, s *resEngStore) *mocks.MockResourceEngagementReader {
	m := mocks.NewMockResourceEngagementReader(ctrl)
	m.EXPECT().EngagementWindow(gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any()).DoAndReturn(
		func(_ context.Context, _ uuid.UUID, _ int, _ int) (domain.ResourceEngagement, error) {
			s.mu.Lock()
			defer s.mu.Unlock()
			if s.err != nil {
				return domain.ResourceEngagement{}, s.err
			}
			return s.resp, nil
		},
	).AnyTimes()
	return m
}

// ─── MockReader: zero-state wire ────────────────────────────────────────

func wireMockMockReader(ctrl *gomock.Controller) *mocks.MockMockReader {
	m := mocks.NewMockMockReader(ctrl)
	m.EXPECT().LastNFinished(gomock.Any(), gomock.Any(), gomock.Any()).Return(nil, nil).AnyTimes()
	m.EXPECT().RecentAbandonedCount(gomock.Any(), gomock.Any(), gomock.Any()).Return(0, nil).AnyTimes()
	return m
}

// ─── AtlasReader (in-app interface): captured calls + wire ──────────────

type atlasReaderTap struct {
	mu          sync.Mutex
	refs        []AtlasResourceRef
	err         error
	gotGoalText string
	gotActivity []ActivityKind
	gotLimit    int
	callCount   int
}

func wireMockAtlasReader(ctrl *gomock.Controller, tap *atlasReaderTap) *MockAtlasReader {
	m := NewMockAtlasReader(ctrl)
	m.EXPECT().TopRelevantNodes(gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any()).DoAndReturn(
		func(_ context.Context, _ uuid.UUID, goalText string, recentActivity []ActivityKind, limit int) ([]AtlasResourceRef, error) {
			tap.mu.Lock()
			defer tap.mu.Unlock()
			tap.callCount++
			tap.gotGoalText = goalText
			tap.gotActivity = recentActivity
			tap.gotLimit = limit
			if tap.err != nil {
				return nil, tap.err
			}
			return tap.refs, nil
		},
	).AnyTimes()
	return m
}
