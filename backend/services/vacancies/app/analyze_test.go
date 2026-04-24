package app

import (
	"context"
	"testing"

	"druz9/vacancies/domain"
)

// stubSingleFetcher implements domain.Parser + domain.SingleFetcher.
type stubSingleFetcher struct {
	src domain.Source
	out domain.Vacancy
}

func (s *stubSingleFetcher) Source() domain.Source                             { return s.src }
func (s *stubSingleFetcher) Fetch(_ context.Context) ([]domain.Vacancy, error) { return nil, nil }
func (s *stubSingleFetcher) FetchOne(_ context.Context, _ string) (domain.Vacancy, error) {
	return s.out, nil
}

type stubExtractor struct{ out []string }

func (s *stubExtractor) Extract(_ context.Context, _ string) ([]string, error) {
	return s.out, nil
}

type stubCacheUpserter struct {
	upserts int
	last    domain.Vacancy
}

func (s *stubCacheUpserter) Upsert(v domain.Vacancy) {
	s.upserts++
	s.last = v
}

func TestDetectSource(t *testing.T) {
	t.Parallel()
	cases := []struct {
		in   string
		want domain.Source
		err  bool
	}{
		{"https://yandex.ru/jobs/vacancies/x", domain.SourceYandex, false},
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

func TestAnalyzeURL_HappyPath(t *testing.T) {
	t.Parallel()
	cache := &stubCacheUpserter{}
	ext := &stubExtractor{out: []string{"go", "kubernetes"}}
	parser := &stubSingleFetcher{
		src: domain.SourceYandex,
		out: domain.Vacancy{
			Source:      domain.SourceYandex,
			ExternalID:  "999",
			Title:       "Senior Go",
			URL:         "https://yandex.ru/jobs/vacancies/999",
			Description: "Looking for Go + k8s",
			RawSkills:   []string{"Go", "PostgreSQL"},
		},
	}
	a := &AnalyzeURL{Parsers: []domain.Parser{parser}, Cache: cache, Extractor: ext}
	res, err := a.Do(context.Background(), "https://yandex.ru/jobs/vacancies/999", []string{"go", "redis"})
	if err != nil {
		t.Fatalf("Do: %v", err)
	}
	if cache.upserts != 1 {
		t.Errorf("cache.Upsert calls = %d, want 1", cache.upserts)
	}
	if !contains(res.Vacancy.NormalizedSkills, "go") || !contains(res.Vacancy.NormalizedSkills, "kubernetes") || !contains(res.Vacancy.NormalizedSkills, "postgresql") {
		t.Errorf("normalized skills: %v", res.Vacancy.NormalizedSkills)
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

func contains(xs []string, x string) bool {
	for _, y := range xs {
		if y == x {
			return true
		}
	}
	return false
}
