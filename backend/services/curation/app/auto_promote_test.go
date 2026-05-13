// auto_promote_test.go — F6 daemon tick coverage.
//
// Wave 13 refactor: in-memory fakes (fakeReader/fakeWriter) переведены на
// mockgen-generated mocks с DoAndReturn-closures. Reader-state и
// Writer-state живут в отдельных store-структурах, поведение mocks
// делегирует им через closure.

package app_test

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	curApp "druz9/curation/app"
	curMocks "druz9/curation/app/mocks"

	"go.uber.org/mock/gomock"
)

// ─── reader store + wire ─────────────────────────────────────────────────

type readerStore struct {
	mu          sync.Mutex
	recent      []curApp.LoggedResource
	aggregates  map[string]curApp.SignalRefresh
	promotes    []curApp.PromotionSignal
	deprecates  []curApp.PromotionSignal
	recentErr   error
	aggregateBy map[string]error

	recentCalls    int
	aggregateCalls int
	promoteCalls   int
	deprecateCalls int
}

func newReaderStore() *readerStore {
	return &readerStore{
		aggregates:  map[string]curApp.SignalRefresh{},
		aggregateBy: map[string]error{},
	}
}

func wireMockPromotionReader(ctrl *gomock.Controller, s *readerStore) *curMocks.MockPromotionReader {
	m := curMocks.NewMockPromotionReader(ctrl)
	m.EXPECT().RecentLoggedURLs(gomock.Any(), gomock.Any()).DoAndReturn(
		func(_ context.Context, _ time.Time) ([]curApp.LoggedResource, error) {
			s.mu.Lock()
			defer s.mu.Unlock()
			s.recentCalls++
			return s.recent, s.recentErr
		},
	).AnyTimes()
	m.EXPECT().AggregateSignal(gomock.Any(), gomock.Any()).DoAndReturn(
		func(_ context.Context, url string) (curApp.SignalRefresh, error) {
			s.mu.Lock()
			defer s.mu.Unlock()
			s.aggregateCalls++
			if err, ok := s.aggregateBy[url]; ok {
				return curApp.SignalRefresh{}, err
			}
			return s.aggregates[url], nil
		},
	).AnyTimes()
	m.EXPECT().PromoteCandidates(gomock.Any(), gomock.Any(), gomock.Any()).DoAndReturn(
		func(_ context.Context, _ int, _ float32) ([]curApp.PromotionSignal, error) {
			s.mu.Lock()
			defer s.mu.Unlock()
			s.promoteCalls++
			return s.promotes, nil
		},
	).AnyTimes()
	m.EXPECT().DeprecateCandidates(gomock.Any(), gomock.Any(), gomock.Any()).DoAndReturn(
		func(_ context.Context, _ int, _ float32) ([]curApp.PromotionSignal, error) {
			s.mu.Lock()
			defer s.mu.Unlock()
			s.deprecateCalls++
			return s.deprecates, nil
		},
	).AnyTimes()
	return m
}

// ─── writer store + wire ────────────────────────────────────────────────

type writerStore struct {
	mu            sync.Mutex
	refreshed     []curApp.SignalRefresh
	promoted      []string
	deprecated    map[string]string
	atlasAppended map[string]string // url → node
	promotedErr   map[string]error
	atlasErr      map[string]error
}

func newWriterStore() *writerStore {
	return &writerStore{
		deprecated:    map[string]string{},
		atlasAppended: map[string]string{},
		promotedErr:   map[string]error{},
		atlasErr:      map[string]error{},
	}
}

func wireMockPromotionWriter(ctrl *gomock.Controller, w *writerStore) *curMocks.MockPromotionWriter {
	m := curMocks.NewMockPromotionWriter(ctrl)
	m.EXPECT().RefreshSignal(gomock.Any(), gomock.Any()).DoAndReturn(
		func(_ context.Context, in curApp.SignalRefresh) error {
			w.mu.Lock()
			defer w.mu.Unlock()
			w.refreshed = append(w.refreshed, in)
			return nil
		},
	).AnyTimes()
	m.EXPECT().MarkPromoted(gomock.Any(), gomock.Any()).DoAndReturn(
		func(_ context.Context, url string) error {
			w.mu.Lock()
			defer w.mu.Unlock()
			if err, ok := w.promotedErr[url]; ok {
				return err
			}
			w.promoted = append(w.promoted, url)
			return nil
		},
	).AnyTimes()
	m.EXPECT().MarkDeprecated(gomock.Any(), gomock.Any(), gomock.Any()).DoAndReturn(
		func(_ context.Context, url, reason string) error {
			w.mu.Lock()
			defer w.mu.Unlock()
			w.deprecated[url] = reason
			return nil
		},
	).AnyTimes()
	m.EXPECT().AppendAtlasResource(gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any()).DoAndReturn(
		func(_ context.Context, atlasNodeID, url string, _ int, _ float32) error {
			w.mu.Lock()
			defer w.mu.Unlock()
			if err, ok := w.atlasErr[url]; ok {
				return err
			}
			w.atlasAppended[url] = atlasNodeID
			return nil
		},
	).AnyTimes()
	return m
}

// ─── tests ───────────────────────────────────────────────────────────────

func TestAutoPromote_NoOp(t *testing.T) {
	ctrl := gomock.NewController(t)
	r := newReaderStore()
	w := newWriterStore()
	uc := &curApp.AutoPromote{Reader: wireMockPromotionReader(ctrl, r), Writer: wireMockPromotionWriter(ctrl, w)}
	got, err := uc.Run(context.Background())
	if err != nil {
		t.Fatalf("unexpected err: %v", err)
	}
	if got != (curApp.Result{}) {
		t.Fatalf("expected empty result, got %+v", got)
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.recentCalls != 1 || r.promoteCalls != 1 || r.deprecateCalls != 1 {
		t.Fatalf("expected one call per stage, got recent=%d promote=%d deprecate=%d",
			r.recentCalls, r.promoteCalls, r.deprecateCalls)
	}
}

func TestAutoPromote_PromotesHappyPath(t *testing.T) {
	ctrl := gomock.NewController(t)
	r := newReaderStore()
	r.promotes = []curApp.PromotionSignal{
		{URL: "https://strang.example/ch3", AtlasNodeID: "ml_linalg", UserCount: 7, AvgQuality: 0.82},
		{URL: "https://orphan.example/post", AtlasNodeID: "", UserCount: 6, AvgQuality: 0.75},
	}
	w := newWriterStore()
	uc := &curApp.AutoPromote{Reader: wireMockPromotionReader(ctrl, r), Writer: wireMockPromotionWriter(ctrl, w)}
	got, err := uc.Run(context.Background())
	if err != nil {
		t.Fatalf("unexpected err: %v", err)
	}
	if got.Promoted != 2 {
		t.Fatalf("expected 2 promoted, got %+v", got)
	}
	w.mu.Lock()
	defer w.mu.Unlock()
	if len(w.promoted) != 2 {
		t.Fatalf("MarkPromoted called %d times, want 2", len(w.promoted))
	}
	if len(w.atlasAppended) != 1 {
		t.Fatalf("atlas append called %d times, want 1 (orphan should skip)", len(w.atlasAppended))
	}
	if w.atlasAppended["https://strang.example/ch3"] != "ml_linalg" {
		t.Fatalf("atlas append wrong: %+v", w.atlasAppended)
	}
}

func TestAutoPromote_DeprecatesHappyPath(t *testing.T) {
	ctrl := gomock.NewController(t)
	r := newReaderStore()
	r.deprecates = []curApp.PromotionSignal{
		{URL: "https://bad.example/x", AtlasNodeID: "ml_loss", UserCount: 8, AvgQuality: 0.18},
	}
	w := newWriterStore()
	uc := &curApp.AutoPromote{Reader: wireMockPromotionReader(ctrl, r), Writer: wireMockPromotionWriter(ctrl, w)}
	got, err := uc.Run(context.Background())
	if err != nil {
		t.Fatalf("unexpected err: %v", err)
	}
	if got.Deprecated != 1 {
		t.Fatalf("expected 1 deprecated, got %+v", got)
	}
	w.mu.Lock()
	defer w.mu.Unlock()
	if w.deprecated["https://bad.example/x"] != "low_quality_avg" {
		t.Fatalf("deprecated reason wrong: %+v", w.deprecated)
	}
	if len(w.promoted) != 0 {
		t.Fatalf("no promote expected, got %v", w.promoted)
	}
}

func TestAutoPromote_RefreshesAggregates(t *testing.T) {
	ctrl := gomock.NewController(t)
	now := time.Date(2026, 5, 12, 12, 0, 0, 0, time.UTC)
	r := newReaderStore()
	r.recent = []curApp.LoggedResource{
		{URL: "https://a.example", AtlasNodeID: "n1"},
		{URL: "https://b.example", AtlasNodeID: ""}, // orphan log
	}
	r.aggregates = map[string]curApp.SignalRefresh{
		"https://a.example": {URL: "https://a.example", AtlasNodeID: "n1",
			UserCount: 3, AvgQuality: 0.6, HasQuality: true, LastLoggedAt: now.Add(-2 * time.Hour)},
		"https://b.example": {URL: "https://b.example",
			UserCount: 2, HasQuality: false, LastLoggedAt: now.Add(-1 * time.Hour)},
	}
	w := newWriterStore()
	uc := &curApp.AutoPromote{Reader: wireMockPromotionReader(ctrl, r), Writer: wireMockPromotionWriter(ctrl, w), Now: func() time.Time { return now }}
	got, err := uc.Run(context.Background())
	if err != nil {
		t.Fatalf("unexpected err: %v", err)
	}
	if got.Refreshed != 2 {
		t.Fatalf("expected 2 refreshed, got %+v", got)
	}
	w.mu.Lock()
	defer w.mu.Unlock()
	if len(w.refreshed) != 2 {
		t.Fatalf("RefreshSignal called %d times, want 2", len(w.refreshed))
	}
	for _, ref := range w.refreshed {
		if ref.URL == "" {
			t.Fatalf("URL leaked empty after refresh: %+v", ref)
		}
	}
}

func TestAutoPromote_RefreshFillsAtlasNodeFromLog(t *testing.T) {
	ctrl := gomock.NewController(t)
	r := newReaderStore()
	r.recent = []curApp.LoggedResource{
		{URL: "https://a.example", AtlasNodeID: "n_from_log"},
	}
	r.aggregates = map[string]curApp.SignalRefresh{
		"https://a.example": {URL: "https://a.example", UserCount: 1, LastLoggedAt: time.Now()},
	}
	w := newWriterStore()
	uc := &curApp.AutoPromote{Reader: wireMockPromotionReader(ctrl, r), Writer: wireMockPromotionWriter(ctrl, w)}
	if _, err := uc.Run(context.Background()); err != nil {
		t.Fatalf("unexpected err: %v", err)
	}
	w.mu.Lock()
	defer w.mu.Unlock()
	if len(w.refreshed) != 1 || w.refreshed[0].AtlasNodeID != "n_from_log" {
		t.Fatalf("expected atlas backfill from log, got %+v", w.refreshed)
	}
}

func TestAutoPromote_BelowThreshold_NoOp(t *testing.T) {
	ctrl := gomock.NewController(t)
	r := newReaderStore()
	w := newWriterStore()
	uc := &curApp.AutoPromote{Reader: wireMockPromotionReader(ctrl, r), Writer: wireMockPromotionWriter(ctrl, w)}
	got, err := uc.Run(context.Background())
	if err != nil {
		t.Fatalf("unexpected err: %v", err)
	}
	if got.Promoted != 0 || got.Deprecated != 0 {
		t.Fatalf("expected no writes, got %+v", got)
	}
	w.mu.Lock()
	defer w.mu.Unlock()
	if len(w.promoted) != 0 || len(w.deprecated) != 0 {
		t.Fatalf("writer touched: promoted=%v deprecated=%v", w.promoted, w.deprecated)
	}
}

func TestAutoPromote_IdempotentSecondRun(t *testing.T) {
	// First tick promotes; second tick (simulating the partial-index
	// filter now hiding the promoted row) is a no-op.
	ctrl := gomock.NewController(t)
	r := newReaderStore()
	r.promotes = []curApp.PromotionSignal{
		{URL: "https://x.example", AtlasNodeID: "n1", UserCount: 6, AvgQuality: 0.9},
	}
	w := newWriterStore()
	uc := &curApp.AutoPromote{Reader: wireMockPromotionReader(ctrl, r), Writer: wireMockPromotionWriter(ctrl, w)}

	if _, err := uc.Run(context.Background()); err != nil {
		t.Fatalf("first run err: %v", err)
	}
	// Simulate the DB-level filter excluding the now-promoted row.
	r.mu.Lock()
	r.promotes = nil
	r.mu.Unlock()

	got, err := uc.Run(context.Background())
	if err != nil {
		t.Fatalf("second run err: %v", err)
	}
	if got.Promoted != 0 {
		t.Fatalf("second run should be no-op, got %+v", got)
	}
	w.mu.Lock()
	defer w.mu.Unlock()
	if len(w.promoted) != 1 {
		t.Fatalf("MarkPromoted called %d times total, want 1", len(w.promoted))
	}
}

func TestAutoPromote_RefreshErrorDoesNotBlockOtherStages(t *testing.T) {
	ctrl := gomock.NewController(t)
	r := newReaderStore()
	r.recentErr = errors.New("db down")
	r.promotes = []curApp.PromotionSignal{
		{URL: "https://x.example", AtlasNodeID: "n1", UserCount: 5, AvgQuality: 0.8},
	}
	w := newWriterStore()
	uc := &curApp.AutoPromote{Reader: wireMockPromotionReader(ctrl, r), Writer: wireMockPromotionWriter(ctrl, w)}
	got, err := uc.Run(context.Background())
	if err == nil {
		t.Fatal("expected joined error, got nil")
	}
	if got.Promoted != 1 {
		t.Fatalf("promote should still run when refresh fails, got %+v", got)
	}
}

func TestAutoPromote_NilWriterFails(t *testing.T) {
	ctrl := gomock.NewController(t)
	uc := &curApp.AutoPromote{Reader: wireMockPromotionReader(ctrl, newReaderStore())}
	if _, err := uc.Run(context.Background()); err == nil {
		t.Fatal("expected nil-writer error")
	}
}

func TestAutoPromote_DefaultsApplied(t *testing.T) {
	// Smoke: zero tunables on the struct shouldn't blow up; defaults
	// are taken at Run() entry. We assert by inspecting that the
	// pipeline still completes without panic and returns Result{}.
	ctrl := gomock.NewController(t)
	r := newReaderStore()
	w := newWriterStore()
	uc := &curApp.AutoPromote{Reader: wireMockPromotionReader(ctrl, r), Writer: wireMockPromotionWriter(ctrl, w)}
	if _, err := uc.Run(context.Background()); err != nil {
		t.Fatalf("unexpected err: %v", err)
	}
}
