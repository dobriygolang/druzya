package cache

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

func testLog() *slog.Logger { return slog.New(slog.NewTextHandler(io.Discard, nil)) }

// stubParser fixed-returns a slice (or error) for one source.
type stubParser struct {
	src  domain.Source
	out  []domain.Vacancy
	fail error
}

func (s *stubParser) Source() domain.Source { return s.src }
func (s *stubParser) Fetch(_ context.Context) ([]domain.Vacancy, error) {
	if s.fail != nil {
		return nil, s.fail
	}
	return s.out, nil
}

func mkVacancies() []Parser {
	now := time.Now().UTC()
	return []Parser{
		&stubParser{
			src: domain.SourceYandex,
			out: []domain.Vacancy{
				{Source: domain.SourceYandex, ExternalID: "y1", Title: "Backend Go Developer", Company: "Yandex", Location: "Москва", FetchedAt: now, NormalizedSkills: []string{"go", "postgresql"}},
				{Source: domain.SourceYandex, ExternalID: "y2", Title: "Frontend React Developer", Company: "Yandex", Location: "Санкт-Петербург", FetchedAt: now, NormalizedSkills: []string{"react", "typescript"}},
			},
		},
		&stubParser{
			src: domain.SourceVK,
			out: []domain.Vacancy{
				{Source: domain.SourceVK, ExternalID: "v1", Title: "Android Developer", Company: "VK", Location: "Москва", FetchedAt: now, NormalizedSkills: []string{"kotlin"}},
			},
		},
	}
}

func TestCache_RefreshList_FilterPaginationFacets(t *testing.T) {
	t.Parallel()
	c := New(mkVacancies(), testLog(), Options{Interval: time.Hour, PerSourceTimeout: time.Second})
	c.RefreshOnce(context.Background())

	// Unfiltered list: 3 items, paginated by limit=2.
	page := c.List(domain.ListFilter{Limit: 2})
	if page.Total != 3 {
		t.Errorf("total=%d want 3", page.Total)
	}
	if len(page.Items) != 2 {
		t.Errorf("items=%d want 2", len(page.Items))
	}
	page2 := c.List(domain.ListFilter{Limit: 2, Offset: 2})
	if len(page2.Items) != 1 {
		t.Errorf("page2 items=%d want 1", len(page2.Items))
	}

	// Source filter
	yPage := c.List(domain.ListFilter{Sources: []domain.Source{domain.SourceYandex}, Limit: 100})
	if yPage.Total != 2 {
		t.Errorf("yandex total=%d want 2", yPage.Total)
	}

	// Category filter (derived: backend/frontend/mobile from titles)
	mobile := c.List(domain.ListFilter{Categories: []domain.Category{domain.CategoryMobile}, Limit: 100})
	if mobile.Total != 1 {
		t.Errorf("mobile total=%d want 1", mobile.Total)
	}

	// Company filter
	yc := c.List(domain.ListFilter{Companies: []string{"Yandex"}, Limit: 100})
	if yc.Total != 2 {
		t.Errorf("Yandex company total=%d want 2", yc.Total)
	}

	// Location substring filter (case-insensitive)
	loc := c.List(domain.ListFilter{Location: "москв", Limit: 100})
	if loc.Total != 2 {
		t.Errorf("location 'москв' total=%d want 2 (Yandex y1 + VK v1)", loc.Total)
	}

	// Facets sanity
	f := c.Facets()
	if len(f.Companies) != 2 {
		t.Errorf("facets companies=%d want 2", len(f.Companies))
	}
	if len(f.Sources) != 2 {
		t.Errorf("facets sources=%d want 2", len(f.Sources))
	}
	// Categories are always padded to AllCategories length.
	if len(f.Categories) != len(domain.AllCategories) {
		t.Errorf("facets categories=%d want %d", len(f.Categories), len(domain.AllCategories))
	}
	// Spot-check the mobile bucket got 1 hit.
	for _, e := range f.Categories {
		if e.Name == string(domain.CategoryMobile) && e.Count != 1 {
			t.Errorf("mobile facet count=%d want 1", e.Count)
		}
	}
}

func TestCache_GetByCompositeKey(t *testing.T) {
	t.Parallel()
	c := New(mkVacancies(), testLog(), Options{Interval: time.Hour, PerSourceTimeout: time.Second})
	c.RefreshOnce(context.Background())

	v, err := c.Get(domain.SourceVK, "v1")
	if err != nil {
		t.Fatalf("Get: %v", err)
	}
	if v.Title != "Android Developer" {
		t.Errorf("title=%q want Android Developer", v.Title)
	}

	if _, err := c.Get(domain.SourceVK, "missing"); !errors.Is(err, domain.ErrNotFound) {
		t.Errorf("want ErrNotFound, got %v", err)
	}
}

// TestCache_PerSourceFailureKeepsPriorBucket — anti-fallback contract: a
// parser returning an error must NOT zero its prior bucket.
func TestCache_PerSourceFailureKeepsPriorBucket(t *testing.T) {
	t.Parallel()
	now := time.Now().UTC()
	good := &stubParser{
		src: domain.SourceYandex,
		out: []domain.Vacancy{
			{Source: domain.SourceYandex, ExternalID: "y1", Title: "Go Dev", FetchedAt: now},
		},
	}
	c := New([]Parser{good}, testLog(), Options{Interval: time.Hour, PerSourceTimeout: time.Second})
	c.RefreshOnce(context.Background())
	if c.Counts()[domain.SourceYandex] != 1 {
		t.Fatalf("first refresh: counts=%v want 1", c.Counts())
	}

	// Now fail the parser and refresh again — bucket should persist.
	good.fail = errors.New("portal down")
	c.RefreshOnce(context.Background())
	if c.Counts()[domain.SourceYandex] != 1 {
		t.Errorf("after failure: counts=%v want bucket retained at 1", c.Counts())
	}
	if _, err := c.Get(domain.SourceYandex, "y1"); err != nil {
		t.Errorf("Get after failure: %v", err)
	}
}

// TestCache_ConcurrentRefreshAndList exercises the RWMutex under -race.
func TestCache_ConcurrentRefreshAndList(t *testing.T) {
	t.Parallel()
	c := New(mkVacancies(), testLog(), Options{Interval: time.Hour, PerSourceTimeout: time.Second})
	c.RefreshOnce(context.Background())

	var wg sync.WaitGroup
	stop := make(chan struct{})
	for i := 0; i < 4; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for {
				select {
				case <-stop:
					return
				default:
					_ = c.List(domain.ListFilter{Limit: 30})
					_ = c.Facets()
				}
			}
		}()
	}
	for i := 0; i < 8; i++ {
		c.RefreshOnce(context.Background())
	}
	close(stop)
	wg.Wait()
}

func TestCategorize_TitleScan(t *testing.T) {
	t.Parallel()
	cases := []struct {
		title string
		want  domain.Category
	}{
		{"Senior Backend Go Developer", domain.CategoryBackend},
		{"Frontend Engineer (React)", domain.CategoryFrontend},
		{"Android Developer", domain.CategoryMobile},
		{"Data Scientist", domain.CategoryData},
		{"DevOps Engineer", domain.CategoryDevOps},
		{"QA Engineer", domain.CategoryQA},
		{"Product Manager", domain.CategoryProduct},
		{"Помощник по хозяйству", domain.CategoryOther},
	}
	for _, tc := range cases {
		got := Categorize(domain.Vacancy{Title: tc.title})
		if got != tc.want {
			t.Errorf("title %q: got %s, want %s", tc.title, got, tc.want)
		}
	}
}
