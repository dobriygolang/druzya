package app

import (
	"context"
	"errors"
	"testing"

	"druz9/vacancies/domain"
)

type stubExtractor struct{ out []string }

func (s *stubExtractor) Extract(_ context.Context, _ string) ([]string, error) {
	return s.out, nil
}

// stubCacheReader simulates the Phase-3 listing cache. Items are keyed by
// (source, externalID); ListBySource returns the source bucket for the
// MTS slug→id reverse-lookup path.
type stubCacheReader struct {
	items map[domain.Source]map[string]domain.Vacancy
}

func newStubCache(vs ...domain.Vacancy) *stubCacheReader {
	c := &stubCacheReader{items: map[domain.Source]map[string]domain.Vacancy{}}
	for _, v := range vs {
		if c.items[v.Source] == nil {
			c.items[v.Source] = map[string]domain.Vacancy{}
		}
		c.items[v.Source][v.ExternalID] = v
	}
	return c
}

func (s *stubCacheReader) Get(src domain.Source, extID string) (domain.Vacancy, error) {
	if b, ok := s.items[src]; ok {
		if v, ok := b[extID]; ok {
			return v, nil
		}
	}
	return domain.Vacancy{}, domain.ErrNotFound
}

func (s *stubCacheReader) ListBySource(src domain.Source) []domain.Vacancy {
	b, ok := s.items[src]
	if !ok {
		return nil
	}
	out := make([]domain.Vacancy, 0, len(b))
	for _, v := range b {
		out = append(out, v)
	}
	return out
}

// List + Facets are not exercised by AnalyzeURL but the shared CacheReader
// interface (see list.go) requires them. Stub them as no-ops.
func (s *stubCacheReader) List(_ domain.ListFilter) domain.Page { return domain.Page{} }
func (s *stubCacheReader) Facets() domain.Facets                { return domain.Facets{} }

func TestDetectSource(t *testing.T) {
	t.Parallel()
	cases := []struct {
		in   string
		want domain.Source
		err  bool
	}{
		{"https://yandex.ru/jobs/vacancies/x-1", domain.SourceYandex, false},
		{"https://career.ozon.ru/vacancy/x/", domain.SourceOzon, false},
		{"https://career.ozon.tech/vacancies/x", domain.SourceOzonTech, false},
		{"https://www.tbank.ru/career/it/vacancy/x/", domain.SourceTinkoff, false},
		{"https://team.vk.company/vacancy/x/", domain.SourceVK, false},
		{"https://career.rwb.ru/vacancies/x", domain.SourceWildberries, false},
		{"https://job.mts.ru/vacancies/x", domain.SourceMTS, false},
		{"https://example.com", "", true},
	}
	for _, tc := range cases {
		t.Run(tc.in, func(t *testing.T) {
			got, err := DetectSource(tc.in)
			if tc.err {
				if err == nil {
					t.Errorf("want error, got %q", got)
				}
				return
			}
			if err != nil {
				t.Errorf("err: %v", err)
			}
			if got != tc.want {
				t.Errorf("want %s got %s", tc.want, got)
			}
		})
	}
}

func TestExtractExternalID(t *testing.T) {
	t.Parallel()
	cases := []struct {
		src  domain.Source
		url  string
		want string
		err  bool
	}{
		{domain.SourceYandex, "https://yandex.ru/jobs/vacancies/multitrack-foo-15322", "15322", false},
		{domain.SourceYandex, "https://yandex.ru/jobs/vacancies/multitrack-foo-15322/", "15322", false},
		{domain.SourceYandex, "https://yandex.ru/jobs/vacancies/no-id-here", "", true},
		{domain.SourceWildberries, "https://career.rwb.ru/vacancies/30154", "30154", false},
		{domain.SourceVK, "https://team.vk.company/vacancy/45215/", "45215", false},
		{domain.SourceMTS, "https://job.mts.ru/vacancies/651331801431670850", "651331801431670850", false},
		{domain.SourceOzon, "https://career.ozon.ru/vacancy/058569d9-uuid", "058569d9-uuid", false},
		{domain.SourceOzon, "https://career.ozon.ru/vacancy/?id=abc-123", "abc-123", false},
	}
	for _, tc := range cases {
		t.Run(tc.url, func(t *testing.T) {
			got, err := extractExternalID(tc.src, tc.url)
			if tc.err {
				if err == nil {
					t.Errorf("want error, got %q", got)
				}
				return
			}
			if err != nil {
				t.Errorf("err: %v", err)
			}
			if got != tc.want {
				t.Errorf("want %q got %q", tc.want, got)
			}
		})
	}
}

func TestAnalyzeURL_HappyPath_CacheHit(t *testing.T) {
	t.Parallel()
	v := domain.Vacancy{
		Source:           domain.SourceYandex,
		ExternalID:       "999",
		Title:            "Senior Go",
		URL:              "https://yandex.ru/jobs/vacancies/senior-go-999",
		Description:      "Looking for Go + k8s",
		RawSkills:        []string{"Go", "PostgreSQL"},
		NormalizedSkills: []string{"go", "postgresql"},
	}
	cache := newStubCache(v)
	ext := &stubExtractor{out: []string{"go", "kubernetes"}}
	a := &AnalyzeURL{Cache: cache, Extractor: ext}
	res, err := a.Do(context.Background(), "https://yandex.ru/jobs/vacancies/senior-go-999", []string{"go", "redis"})
	if err != nil {
		t.Fatalf("Do: %v", err)
	}
	if res.Vacancy.ExternalID != "999" {
		t.Errorf("ext_id: %q", res.Vacancy.ExternalID)
	}
	// Extractor merged "kubernetes" into normalized skills.
	if !contains(res.Vacancy.NormalizedSkills, "kubernetes") {
		t.Errorf("kubernetes missing from normalized: %v", res.Vacancy.NormalizedSkills)
	}
	if !contains(res.Gap.Matched, "go") {
		t.Errorf("expected go in matched: %+v", res.Gap)
	}
	if !contains(res.Gap.Missing, "kubernetes") || !contains(res.Gap.Missing, "postgresql") {
		t.Errorf("expected kubernetes+postgresql missing: %+v", res.Gap)
	}
	if !contains(res.Gap.Extra, "redis") {
		t.Errorf("expected redis in extra: %+v", res.Gap)
	}
}

func TestAnalyzeURL_CacheMiss(t *testing.T) {
	t.Parallel()
	cache := newStubCache() // empty
	a := &AnalyzeURL{Cache: cache}
	_, err := a.Do(context.Background(), "https://yandex.ru/jobs/vacancies/foo-1234", nil)
	if err == nil {
		t.Fatalf("want ErrVacancyNotInCache")
	}
	if !errors.Is(err, ErrVacancyNotInCache) {
		t.Errorf("err: %v, want ErrVacancyNotInCache", err)
	}
}

func TestAnalyzeURL_MTSSlugReverseLookup(t *testing.T) {
	t.Parallel()
	// MTS stores numeric id as ExternalID; URL holds the slug, preserved
	// in DetailsKey at parse time. AnalyzeURL must reverse-resolve.
	v := domain.Vacancy{
		Source:     domain.SourceMTS,
		ExternalID: "651331801431670900",           // numeric id
		DetailsKey: "651331801431670850-some-slug", // slug from URL
		Title:      "Релизный менеджер",
	}
	cache := newStubCache(v)
	a := &AnalyzeURL{Cache: cache}
	res, err := a.Do(context.Background(), "https://job.mts.ru/vacancies/651331801431670850-some-slug", nil)
	if err != nil {
		t.Fatalf("Do: %v", err)
	}
	if res.Vacancy.ExternalID != "651331801431670900" {
		t.Errorf("ext_id: %q", res.Vacancy.ExternalID)
	}
}

func TestAnalyzeURL_UnsupportedSource(t *testing.T) {
	t.Parallel()
	a := &AnalyzeURL{Cache: newStubCache()}
	if _, err := a.Do(context.Background(), "https://example.com/job/1", nil); err == nil {
		t.Fatalf("want unsupported-host error")
	}
}

func contains(xs []string, x string) bool {
	for _, y := range xs {
		if y == x {
			return true
		}
	}
	return false
}
