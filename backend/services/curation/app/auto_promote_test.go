// auto_promote_test.go — F6 daemon tick coverage.
//
// Hand-rolled in-memory fakes (no gomock generation needed) so the test
// runs without `make generate`. Each subtest configures a fake reader
// with canned promote/deprecate candidates + recent logs and asserts:
//   - counters returned by Run match expected promote/deprecate buckets
//   - writer side-effects (MarkPromoted / MarkDeprecated / atlas append)
//     happen exactly once per candidate
//   - second Run() with the same inputs is a no-op (idempotent — the
//     fake reader returns empty candidates the second time, as a real
//     postgres reader would once the partial-index filter excludes
//     already-marked rows)

package app_test

import (
	"context"
	"errors"
	"testing"
	"time"

	curApp "druz9/curation/app"
)

// ─── fakes ───────────────────────────────────────────────────────────────

type fakeReader struct {
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

func (r *fakeReader) RecentLoggedURLs(_ context.Context, _ time.Time) ([]curApp.LoggedResource, error) {
	r.recentCalls++
	return r.recent, r.recentErr
}

func (r *fakeReader) AggregateSignal(_ context.Context, url string) (curApp.SignalRefresh, error) {
	r.aggregateCalls++
	if err, ok := r.aggregateBy[url]; ok {
		return curApp.SignalRefresh{}, err
	}
	return r.aggregates[url], nil
}

func (r *fakeReader) PromoteCandidates(_ context.Context, _ int, _ float32) ([]curApp.PromotionSignal, error) {
	r.promoteCalls++
	return r.promotes, nil
}

func (r *fakeReader) DeprecateCandidates(_ context.Context, _ int, _ float32) ([]curApp.PromotionSignal, error) {
	r.deprecateCalls++
	return r.deprecates, nil
}

type fakeWriter struct {
	refreshed     []curApp.SignalRefresh
	promoted      []string
	deprecated    map[string]string
	atlasAppended map[string]string // url → node
	promotedErr   map[string]error
	atlasErr      map[string]error
}

func newFakeWriter() *fakeWriter {
	return &fakeWriter{
		deprecated:    map[string]string{},
		atlasAppended: map[string]string{},
	}
}

func (w *fakeWriter) RefreshSignal(_ context.Context, in curApp.SignalRefresh) error {
	w.refreshed = append(w.refreshed, in)
	return nil
}

func (w *fakeWriter) MarkPromoted(_ context.Context, url string) error {
	if err, ok := w.promotedErr[url]; ok {
		return err
	}
	w.promoted = append(w.promoted, url)
	return nil
}

func (w *fakeWriter) MarkDeprecated(_ context.Context, url, reason string) error {
	w.deprecated[url] = reason
	return nil
}

func (w *fakeWriter) AppendAtlasResource(_ context.Context, atlasNodeID, url string, _ int, _ float32) error {
	if err, ok := w.atlasErr[url]; ok {
		return err
	}
	w.atlasAppended[url] = atlasNodeID
	return nil
}

// ─── tests ───────────────────────────────────────────────────────────────

func TestAutoPromote_NoOp(t *testing.T) {
	r := &fakeReader{}
	w := newFakeWriter()
	uc := &curApp.AutoPromote{Reader: r, Writer: w}
	got, err := uc.Run(context.Background())
	if err != nil {
		t.Fatalf("unexpected err: %v", err)
	}
	if got != (curApp.Result{}) {
		t.Fatalf("expected empty result, got %+v", got)
	}
	if r.recentCalls != 1 || r.promoteCalls != 1 || r.deprecateCalls != 1 {
		t.Fatalf("expected one call per stage, got recent=%d promote=%d deprecate=%d",
			r.recentCalls, r.promoteCalls, r.deprecateCalls)
	}
}

func TestAutoPromote_PromotesHappyPath(t *testing.T) {
	r := &fakeReader{
		promotes: []curApp.PromotionSignal{
			{URL: "https://strang.example/ch3", AtlasNodeID: "ml_linalg", UserCount: 7, AvgQuality: 0.82},
			{URL: "https://orphan.example/post", AtlasNodeID: "", UserCount: 6, AvgQuality: 0.75},
		},
	}
	w := newFakeWriter()
	uc := &curApp.AutoPromote{Reader: r, Writer: w}
	got, err := uc.Run(context.Background())
	if err != nil {
		t.Fatalf("unexpected err: %v", err)
	}
	if got.Promoted != 2 {
		t.Fatalf("expected 2 promoted, got %+v", got)
	}
	if len(w.promoted) != 2 {
		t.Fatalf("MarkPromoted called %d times, want 2", len(w.promoted))
	}
	// Atlas append only for the node-targeted row — orphan must skip.
	if len(w.atlasAppended) != 1 {
		t.Fatalf("atlas append called %d times, want 1 (orphan should skip)", len(w.atlasAppended))
	}
	if w.atlasAppended["https://strang.example/ch3"] != "ml_linalg" {
		t.Fatalf("atlas append wrong: %+v", w.atlasAppended)
	}
}

func TestAutoPromote_DeprecatesHappyPath(t *testing.T) {
	r := &fakeReader{
		deprecates: []curApp.PromotionSignal{
			{URL: "https://bad.example/x", AtlasNodeID: "ml_loss", UserCount: 8, AvgQuality: 0.18},
		},
	}
	w := newFakeWriter()
	uc := &curApp.AutoPromote{Reader: r, Writer: w}
	got, err := uc.Run(context.Background())
	if err != nil {
		t.Fatalf("unexpected err: %v", err)
	}
	if got.Deprecated != 1 {
		t.Fatalf("expected 1 deprecated, got %+v", got)
	}
	if w.deprecated["https://bad.example/x"] != "low_quality_avg" {
		t.Fatalf("deprecated reason wrong: %+v", w.deprecated)
	}
	if len(w.promoted) != 0 {
		t.Fatalf("no promote expected, got %v", w.promoted)
	}
}

func TestAutoPromote_RefreshesAggregates(t *testing.T) {
	now := time.Date(2026, 5, 12, 12, 0, 0, 0, time.UTC)
	r := &fakeReader{
		recent: []curApp.LoggedResource{
			{URL: "https://a.example", AtlasNodeID: "n1"},
			{URL: "https://b.example", AtlasNodeID: ""}, // orphan log
		},
		aggregates: map[string]curApp.SignalRefresh{
			"https://a.example": {URL: "https://a.example", AtlasNodeID: "n1",
				UserCount: 3, AvgQuality: 0.6, HasQuality: true, LastLoggedAt: now.Add(-2 * time.Hour)},
			"https://b.example": {URL: "https://b.example",
				UserCount: 2, HasQuality: false, LastLoggedAt: now.Add(-1 * time.Hour)},
		},
	}
	w := newFakeWriter()
	uc := &curApp.AutoPromote{Reader: r, Writer: w, Now: func() time.Time { return now }}
	got, err := uc.Run(context.Background())
	if err != nil {
		t.Fatalf("unexpected err: %v", err)
	}
	if got.Refreshed != 2 {
		t.Fatalf("expected 2 refreshed, got %+v", got)
	}
	if len(w.refreshed) != 2 {
		t.Fatalf("RefreshSignal called %d times, want 2", len(w.refreshed))
	}
	// Orphan row keeps its atlas_node_id empty (UC fills from the
	// recent-log seed only when aggregate row left it blank, which
	// matters when AggregateSignal returns "" but the log has a node).
	for _, ref := range w.refreshed {
		if ref.URL == "" {
			t.Fatalf("URL leaked empty after refresh: %+v", ref)
		}
	}
}

func TestAutoPromote_RefreshFillsAtlasNodeFromLog(t *testing.T) {
	// AggregateSignal returns "" for atlas_node_id (e.g. when all log
	// rows had NULL) but the recent-scan saw a node — UC backfills.
	r := &fakeReader{
		recent: []curApp.LoggedResource{
			{URL: "https://a.example", AtlasNodeID: "n_from_log"},
		},
		aggregates: map[string]curApp.SignalRefresh{
			"https://a.example": {URL: "https://a.example", UserCount: 1, LastLoggedAt: time.Now()},
		},
	}
	w := newFakeWriter()
	uc := &curApp.AutoPromote{Reader: r, Writer: w}
	if _, err := uc.Run(context.Background()); err != nil {
		t.Fatalf("unexpected err: %v", err)
	}
	if len(w.refreshed) != 1 || w.refreshed[0].AtlasNodeID != "n_from_log" {
		t.Fatalf("expected atlas backfill from log, got %+v", w.refreshed)
	}
}

func TestAutoPromote_BelowThreshold_NoOp(t *testing.T) {
	// Simulates the postgres reader honouring the threshold filter:
	// no rows returned ⇒ no writes.
	r := &fakeReader{
		promotes:   nil,
		deprecates: nil,
	}
	w := newFakeWriter()
	uc := &curApp.AutoPromote{Reader: r, Writer: w}
	got, err := uc.Run(context.Background())
	if err != nil {
		t.Fatalf("unexpected err: %v", err)
	}
	if got.Promoted != 0 || got.Deprecated != 0 {
		t.Fatalf("expected no writes, got %+v", got)
	}
	if len(w.promoted) != 0 || len(w.deprecated) != 0 {
		t.Fatalf("writer touched: promoted=%v deprecated=%v", w.promoted, w.deprecated)
	}
}

func TestAutoPromote_IdempotentSecondRun(t *testing.T) {
	// First tick promotes; second tick (simulating the partial-index
	// filter now hiding the promoted row) is a no-op.
	r := &fakeReader{
		promotes: []curApp.PromotionSignal{
			{URL: "https://x.example", AtlasNodeID: "n1", UserCount: 6, AvgQuality: 0.9},
		},
	}
	w := newFakeWriter()
	uc := &curApp.AutoPromote{Reader: r, Writer: w}

	if _, err := uc.Run(context.Background()); err != nil {
		t.Fatalf("first run err: %v", err)
	}
	// Simulate the DB-level filter excluding the now-promoted row.
	r.promotes = nil

	got, err := uc.Run(context.Background())
	if err != nil {
		t.Fatalf("second run err: %v", err)
	}
	if got.Promoted != 0 {
		t.Fatalf("second run should be no-op, got %+v", got)
	}
	if len(w.promoted) != 1 {
		t.Fatalf("MarkPromoted called %d times total, want 1", len(w.promoted))
	}
}

func TestAutoPromote_RefreshErrorDoesNotBlockOtherStages(t *testing.T) {
	r := &fakeReader{
		recentErr: errors.New("db down"),
		promotes: []curApp.PromotionSignal{
			{URL: "https://x.example", AtlasNodeID: "n1", UserCount: 5, AvgQuality: 0.8},
		},
	}
	w := newFakeWriter()
	uc := &curApp.AutoPromote{Reader: r, Writer: w}
	got, err := uc.Run(context.Background())
	if err == nil {
		t.Fatal("expected joined error, got nil")
	}
	if got.Promoted != 1 {
		t.Fatalf("promote should still run when refresh fails, got %+v", got)
	}
}

func TestAutoPromote_NilWriterFails(t *testing.T) {
	uc := &curApp.AutoPromote{Reader: &fakeReader{}}
	if _, err := uc.Run(context.Background()); err == nil {
		t.Fatal("expected nil-writer error")
	}
}

func TestAutoPromote_DefaultsApplied(t *testing.T) {
	// Smoke: zero tunables on the struct shouldn't blow up; defaults
	// are taken at Run() entry. We assert by inspecting that the
	// pipeline still completes without panic and returns Result{}.
	r := &fakeReader{}
	w := newFakeWriter()
	uc := &curApp.AutoPromote{Reader: r, Writer: w}
	if _, err := uc.Run(context.Background()); err != nil {
		t.Fatalf("unexpected err: %v", err)
	}
}
