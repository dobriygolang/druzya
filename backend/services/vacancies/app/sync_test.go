package app

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"sync"
	"testing"
	"time"

	"druz9/vacancies/domain"
)

// testLog returns a no-op logger acceptable to constructors that demand a
// non-nil *slog.Logger (anti-fallback policy: production constructors panic
// on nil; tests use io.Discard explicitly to make their silence intentional).
func testLog() *slog.Logger {
	return slog.New(slog.NewTextHandler(io.Discard, nil))
}

// stubParser fixed-returns a slice for one source.
type stubParser struct {
	src  domain.Source
	out  []domain.Vacancy
	fail bool
}

func (s *stubParser) Source() domain.Source { return s.src }
func (s *stubParser) Fetch(_ context.Context) ([]domain.Vacancy, error) {
	if s.fail {
		return nil, errors.New("boom")
	}
	return s.out, nil
}

// memRepo is a minimal in-memory VacancyRepo.
type memRepo struct {
	mu      sync.Mutex
	store   map[string]*domain.Vacancy // key = source|external_id
	upserts int
	updates int
}

func newMemRepo() *memRepo { return &memRepo{store: map[string]*domain.Vacancy{}} }
func keyOf(v domain.Vacancy) string {
	return string(v.Source) + "|" + v.ExternalID
}
func (r *memRepo) Insert(_ context.Context, v *domain.Vacancy) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	v.ID = int64(len(r.store) + 1)
	cp := *v
	r.store[keyOf(*v)] = &cp
	return nil
}
func (r *memRepo) GetByID(_ context.Context, id int64) (domain.Vacancy, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	for _, v := range r.store {
		if v.ID == id {
			return *v, nil
		}
	}
	return domain.Vacancy{}, domain.ErrNotFound
}
func (r *memRepo) ListByFilter(_ context.Context, _ domain.ListFilter) (domain.Page, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	out := make([]domain.Vacancy, 0, len(r.store))
	for _, v := range r.store {
		out = append(out, *v)
	}
	return domain.Page{Items: out, Total: len(out)}, nil
}
func (r *memRepo) UpsertByExternal(_ context.Context, v *domain.Vacancy) (int64, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.upserts++
	if existing, ok := r.store[keyOf(*v)]; ok {
		v.ID = existing.ID
		cp := *v
		r.store[keyOf(*v)] = &cp
		return existing.ID, nil
	}
	v.ID = int64(len(r.store) + 1)
	cp := *v
	r.store[keyOf(*v)] = &cp
	return v.ID, nil
}
func (r *memRepo) UpdateNormalizedSkills(_ context.Context, id int64, s []string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.updates++
	for _, v := range r.store {
		if v.ID == id {
			v.NormalizedSkills = s
			return nil
		}
	}
	return domain.ErrNotFound
}

type stubExtractor struct {
	calls int
	out   []string
}

func (s *stubExtractor) Extract(_ context.Context, _ string) ([]string, error) {
	s.calls++
	return s.out, nil
}

func TestSyncJob_Upsert_Idempotent(t *testing.T) {
	t.Parallel()
	repo := newMemRepo()
	ext := &stubExtractor{out: []string{"go"}}
	parser := &stubParser{
		src: domain.SourceYandex,
		out: []domain.Vacancy{
			{Source: domain.SourceYandex, ExternalID: "1", Title: "T1", Description: "d1"},
			{Source: domain.SourceYandex, ExternalID: "2", Title: "T2", Description: "d2"},
		},
	}
	job := &SyncJob{Parsers: []domain.Parser{parser}, Repo: repo, Extractor: ext, Log: testLog()}
	job.RunOnce(context.Background())
	if repo.upserts != 2 {
		t.Errorf("upserts = %d, want 2", repo.upserts)
	}
	// Run again — same external_ids → still 2 rows total.
	job.RunOnce(context.Background())
	if len(repo.store) != 2 {
		t.Errorf("store size = %d, want 2", len(repo.store))
	}
	if ext.calls < 2 {
		t.Errorf("extractor not called enough: %d", ext.calls)
	}
}

// TestSyncJob_BrokenExtractor_StillUpserts reproduces production bug #15:
// when the LLM extractor errors on every call, the catalogue MUST still be
// populated. Previously the inline extractor on the upsert hot loop ate the
// per-source budget and left the DB empty.
func TestSyncJob_BrokenExtractor_StillUpserts(t *testing.T) {
	t.Parallel()
	repo := newMemRepo()
	parser := &stubParser{
		src: domain.SourceYandex,
		out: []domain.Vacancy{
			{Source: domain.SourceYandex, ExternalID: "10", Title: "Go Dev", Description: "go postgres"},
			{Source: domain.SourceYandex, ExternalID: "11", Title: "Backend", Description: "python"},
			{Source: domain.SourceYandex, ExternalID: "12", Title: "DevOps", Description: "k8s"},
		},
	}
	ext := &errExtractor{}
	job := &SyncJob{
		Parsers:          []domain.Parser{parser},
		Repo:             repo,
		Extractor:        ext,
		Log:              testLog(),
		PerSourceTimeout: time.Second,
		ExtractTimeout:   time.Second,
	}
	job.RunOnce(context.Background())
	if len(repo.store) != 3 {
		t.Fatalf("store size = %d, want 3 (upserts must complete even when extractor fails)", len(repo.store))
	}
}

// errExtractor always errors — used to prove the upsert path is independent
// of extractor health.
type errExtractor struct{}

func (errExtractor) Extract(_ context.Context, _ string) ([]string, error) {
	return nil, errors.New("openrouter offline")
}

// TestSyncJob_ListByFilter_NoFilters_ReturnsUpserts is the end-to-end
// guarantee for production bug #15: after RunOnce completes, an unfiltered
// ListByFilter call must surface the synced rows.
func TestSyncJob_ListByFilter_NoFilters_ReturnsUpserts(t *testing.T) {
	t.Parallel()
	repo := newMemRepo()
	parser := &stubParser{
		src: domain.SourceYandex,
		out: []domain.Vacancy{
			{Source: domain.SourceYandex, ExternalID: "a", Title: "A", Description: "d"},
			{Source: domain.SourceYandex, ExternalID: "b", Title: "B", Description: "d"},
		},
	}
	job := &SyncJob{Parsers: []domain.Parser{parser}, Repo: repo, Log: testLog()}
	job.RunOnce(context.Background())

	list := &ListVacancies{Repo: repo}
	page, err := list.Do(context.Background(), domain.ListFilter{})
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if page.Total != 2 || len(page.Items) != 2 {
		t.Errorf("page = %+v, want total=2 items=2", page)
	}
}

func TestSyncJob_ParserFailureContinues(t *testing.T) {
	t.Parallel()
	repo := newMemRepo()
	job := &SyncJob{
		Parsers: []domain.Parser{
			&stubParser{src: domain.SourceYandex, fail: true},
			&stubParser{src: domain.SourceVK, out: []domain.Vacancy{
				{Source: domain.SourceVK, ExternalID: "v1", Title: "T", Description: "d"},
			}},
		},
		Repo: repo,
		Log:  testLog(),
	}
	job.RunOnce(context.Background())
	if len(repo.store) != 1 {
		t.Errorf("want 1 row from VK, got %d", len(repo.store))
	}
}
