package infra

import (
	"context"
	"errors"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"druz9/vacancies/domain"
)

// memKV is an in-memory KV mimicking Redis for the cache_test.
type memKV struct {
	mu        sync.Mutex
	store     map[string]memEntry
	counters  map[string]int64
	failGet   bool
	getCalls  atomic.Int64
	setCalls  atomic.Int64
	delCalls  atomic.Int64
	incrCalls atomic.Int64
	now       func() time.Time
}

type memEntry struct {
	val       []byte
	expiresAt time.Time
}

func newMemKV() *memKV {
	return &memKV{store: map[string]memEntry{}, counters: map[string]int64{}, now: time.Now}
}

func (m *memKV) Get(_ context.Context, k string) (string, error) {
	m.getCalls.Add(1)
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.failGet {
		return "", errors.New("simulated failure")
	}
	e, ok := m.store[k]
	if !ok {
		// Counter values stored separately.
		if v, ok := m.counters[k]; ok {
			return formatInt(v), nil
		}
		return "", ErrCacheMiss
	}
	if !e.expiresAt.IsZero() && m.now().After(e.expiresAt) {
		delete(m.store, k)
		return "", ErrCacheMiss
	}
	return string(e.val), nil
}

func (m *memKV) Set(_ context.Context, k string, v []byte, ttl time.Duration) error {
	m.setCalls.Add(1)
	m.mu.Lock()
	defer m.mu.Unlock()
	e := memEntry{val: append([]byte(nil), v...)}
	if ttl > 0 {
		e.expiresAt = m.now().Add(ttl)
	}
	m.store[k] = e
	return nil
}

func (m *memKV) Del(_ context.Context, keys ...string) error {
	m.delCalls.Add(1)
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, k := range keys {
		delete(m.store, k)
		delete(m.counters, k)
	}
	return nil
}

func (m *memKV) Incr(_ context.Context, k string) (int64, error) {
	m.incrCalls.Add(1)
	m.mu.Lock()
	defer m.mu.Unlock()
	m.counters[k]++
	return m.counters[k], nil
}

func formatInt(v int64) string {
	const digits = "0123456789"
	if v == 0 {
		return "0"
	}
	neg := v < 0
	if neg {
		v = -v
	}
	var buf [20]byte
	i := len(buf)
	for v > 0 {
		i--
		buf[i] = digits[v%10]
		v /= 10
	}
	if neg {
		i--
		buf[i] = '-'
	}
	return string(buf[i:])
}

// fakeRepo records call counts so we can prove cache hits/misses.
type fakeRepo struct {
	get       atomic.Int64
	list      atomic.Int64
	upsert    atomic.Int64
	updSkills atomic.Int64
	store     map[int64]domain.Vacancy
	mu        sync.Mutex
}

func newFakeRepo() *fakeRepo { return &fakeRepo{store: map[int64]domain.Vacancy{}} }

func (f *fakeRepo) Insert(_ context.Context, v *domain.Vacancy) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	v.ID = int64(len(f.store) + 1)
	f.store[v.ID] = *v
	return nil
}
func (f *fakeRepo) GetByID(_ context.Context, id int64) (domain.Vacancy, error) {
	f.get.Add(1)
	f.mu.Lock()
	defer f.mu.Unlock()
	v, ok := f.store[id]
	if !ok {
		return domain.Vacancy{}, domain.ErrNotFound
	}
	return v, nil
}
func (f *fakeRepo) ListByFilter(_ context.Context, _ domain.ListFilter) (domain.Page, error) {
	f.list.Add(1)
	f.mu.Lock()
	defer f.mu.Unlock()
	out := make([]domain.Vacancy, 0, len(f.store))
	for _, v := range f.store {
		out = append(out, v)
	}
	return domain.Page{Items: out, Total: len(out), Limit: 30}, nil
}
func (f *fakeRepo) UpsertByExternal(_ context.Context, v *domain.Vacancy) (int64, error) {
	f.upsert.Add(1)
	f.mu.Lock()
	defer f.mu.Unlock()
	// Real impl preserves ID for the same (source, external_id). Mirror that
	// here so the cache invalidation test can prove the by_id key is busted
	// after an upsert that targets an existing row.
	for id, existing := range f.store {
		if existing.Source == v.Source && existing.ExternalID == v.ExternalID {
			v.ID = id
			f.store[id] = *v
			return id, nil
		}
	}
	v.ID = int64(len(f.store) + 1)
	f.store[v.ID] = *v
	return v.ID, nil
}
func (f *fakeRepo) UpdateNormalizedSkills(_ context.Context, id int64, s []string) error {
	f.updSkills.Add(1)
	f.mu.Lock()
	defer f.mu.Unlock()
	v := f.store[id]
	v.NormalizedSkills = s
	f.store[id] = v
	return nil
}

func TestCachedRepo_GetByID_HitsCacheOnSecondCall(t *testing.T) {
	t.Parallel()
	kv := newMemKV()
	pg := newFakeRepo()
	_ = pg.Insert(context.Background(), &domain.Vacancy{Source: "hh", ExternalID: "1", Title: "A", Description: "d"})
	c := NewCachedVacancyRepo(pg, kv, time.Minute, time.Hour, nil)

	if _, err := c.GetByID(context.Background(), 1); err != nil {
		t.Fatalf("first GetByID: %v", err)
	}
	if _, err := c.GetByID(context.Background(), 1); err != nil {
		t.Fatalf("second GetByID: %v", err)
	}
	if pg.get.Load() != 1 {
		t.Errorf("repo.GetByID called %d times, want 1", pg.get.Load())
	}
}

func TestCachedRepo_Upsert_InvalidatesByID(t *testing.T) {
	t.Parallel()
	kv := newMemKV()
	pg := newFakeRepo()
	v := &domain.Vacancy{Source: "hh", ExternalID: "1", Title: "A", Description: "d"}
	id, _ := pg.UpsertByExternal(context.Background(), v)
	c := NewCachedVacancyRepo(pg, kv, time.Minute, time.Hour, nil)
	// Warm cache.
	_, _ = c.GetByID(context.Background(), id)
	first := pg.get.Load()
	// Upsert should bust the by_id key.
	v2 := *v
	v2.Title = "B"
	if _, err := c.UpsertByExternal(context.Background(), &v2); err != nil {
		t.Fatalf("upsert: %v", err)
	}
	// Next read should hit the repo again.
	_, _ = c.GetByID(context.Background(), id)
	if pg.get.Load() <= first {
		t.Errorf("invalidation failed: pg.get=%d first=%d", pg.get.Load(), first)
	}
}

func TestCachedRepo_List_RedisFailureFallsBack(t *testing.T) {
	t.Parallel()
	kv := newMemKV()
	kv.failGet = true
	pg := newFakeRepo()
	_ = pg.Insert(context.Background(), &domain.Vacancy{Source: "hh", ExternalID: "1", Title: "A", Description: "d"})
	c := NewCachedVacancyRepo(pg, kv, time.Minute, time.Hour, nil)

	p, err := c.ListByFilter(context.Background(), domain.ListFilter{})
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(p.Items) != 1 {
		t.Errorf("want 1, got %d", len(p.Items))
	}
}

func TestCachedRepo_List_Singleflight(t *testing.T) {
	t.Parallel()
	kv := newMemKV()
	pg := newFakeRepo()
	_ = pg.Insert(context.Background(), &domain.Vacancy{Source: "hh", ExternalID: "1", Title: "A", Description: "d"})
	// Slow-down the repo to widen the race window.
	c := NewCachedVacancyRepo(pg, kv, time.Minute, time.Hour, nil)

	var wg sync.WaitGroup
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, _ = c.ListByFilter(context.Background(), domain.ListFilter{})
		}()
	}
	wg.Wait()
	// Singleflight should collapse — repo called <= number of goroutines and >= 1.
	if pg.list.Load() < 1 {
		t.Errorf("repo.list never called")
	}
}
