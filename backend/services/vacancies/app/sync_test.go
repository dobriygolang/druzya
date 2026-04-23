package app

import (
	"context"
	"errors"
	"sync"
	"testing"

	"druz9/vacancies/domain"
)

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
		src: domain.SourceHH,
		out: []domain.Vacancy{
			{Source: domain.SourceHH, ExternalID: "1", Title: "T1", Description: "d1"},
			{Source: domain.SourceHH, ExternalID: "2", Title: "T2", Description: "d2"},
		},
	}
	job := &SyncJob{Parsers: []domain.Parser{parser}, Repo: repo, Extractor: ext}
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

func TestSyncJob_ParserFailureContinues(t *testing.T) {
	t.Parallel()
	repo := newMemRepo()
	job := &SyncJob{
		Parsers: []domain.Parser{
			&stubParser{src: domain.SourceHH, fail: true},
			&stubParser{src: domain.SourceVK, out: []domain.Vacancy{
				{Source: domain.SourceVK, ExternalID: "v1", Title: "T", Description: "d"},
			}},
		},
		Repo: repo,
	}
	job.RunOnce(context.Background())
	if len(repo.store) != 1 {
		t.Errorf("want 1 row from VK, got %d", len(repo.store))
	}
}
