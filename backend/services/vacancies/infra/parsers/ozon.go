// ozon.go — careers.ozon.ru / jobs.ozon.ru parser.
//
// Ozon's careers page (https://job.ozon.ru/) is also Next.js-style; we look
// for the same __NEXT_DATA__ blob first, then fall back to a stub if absent.
// The structural mining helpers (extractNextData, findJobsArray) are shared
// with the yandex parser via this package.
package parsers

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"druz9/shared/pkg/metrics"
	"druz9/vacancies/domain"
)

const ozonBaseURL = "https://job.ozon.ru/"

// OzonParser scrapes job.ozon.ru.
type OzonParser struct {
	baseURL    string
	httpClient *http.Client
	log        *slog.Logger
}

// NewOzon constructs the default-configured parser. log is required
// (anti-fallback policy).
func NewOzon(log *slog.Logger) *OzonParser {
	if log == nil {
		panic("vacancies.parsers.NewOzon: logger is required (anti-fallback policy: no silent noop loggers)")
	}
	return &OzonParser{
		baseURL:    ozonBaseURL,
		httpClient: &http.Client{Timeout: 15 * time.Second},
		log:        log,
	}
}

// WithBaseURL is a test override.
func (p *OzonParser) WithBaseURL(u string) *OzonParser { p.baseURL = u; return p }

// Source implements domain.Parser.
func (p *OzonParser) Source() domain.Source { return domain.SourceOzon }

// Fetch behaves like the Yandex parser — same blob shape conventions.
// Anti-fallback: schema surprises propagate as real errors and increment
// vacancies_parser_errors_total{source=ozon}.
func (p *OzonParser) Fetch(ctx context.Context) ([]domain.Vacancy, error) {
	body, err := fetchHTML(ctx, p.httpClient, p.baseURL)
	if err != nil {
		metrics.VacanciesParserErrorsTotal.WithLabelValues(string(domain.SourceOzon)).Inc()
		return nil, fmt.Errorf("vacancies.parser.ozon: fetch: %w", err)
	}
	blob, ok := extractNextData(body)
	if !ok {
		metrics.VacanciesParserErrorsTotal.WithLabelValues(string(domain.SourceOzon)).Inc()
		return nil, fmt.Errorf("vacancies.parser.ozon: __NEXT_DATA__ blob not found")
	}
	out, err := decodeOzonJobs(blob)
	if err != nil {
		metrics.VacanciesParserErrorsTotal.WithLabelValues(string(domain.SourceOzon)).Inc()
		return nil, fmt.Errorf("vacancies.parser.ozon: decode: %w", err)
	}
	p.log.Info("vacancies.parser.ozon: fetched", slog.Int("count", len(out)))
	return out, nil
}

func decodeOzonJobs(raw string) ([]domain.Vacancy, error) {
	var blob map[string]any
	if err := json.Unmarshal([]byte(raw), &blob); err != nil {
		return nil, fmt.Errorf("ozon.decode.unmarshal: %w", err)
	}
	jobs := findJobsArray(blob)
	out := make([]domain.Vacancy, 0, len(jobs))
	for _, j := range jobs {
		jm, ok := j.(map[string]any)
		if !ok {
			continue
		}
		out = append(out, ozonJobToVacancy(jm))
	}
	return out, nil
}

func ozonJobToVacancy(j map[string]any) domain.Vacancy {
	get := func(k string) string {
		if v, ok := j[k].(string); ok {
			return v
		}
		return ""
	}
	v := domain.Vacancy{
		Source:      domain.SourceOzon,
		ExternalID:  get("id"),
		Title:       get("title"),
		Company:     "Ozon",
		Location:    get("city"),
		URL:         get("url"),
		Description: strings.TrimSpace(get("description") + "\n\n" + get("requirements") + "\n\n" + get("responsibilities")),
		FetchedAt:   time.Now().UTC(),
	}
	if v.ExternalID == "" {
		v.ExternalID = get("slug")
	}
	if v.URL == "" && v.ExternalID != "" {
		v.URL = fmt.Sprintf("https://job.ozon.ru/vacancy/%s/", v.ExternalID)
	}
	if skills, ok := j["skills"].([]any); ok {
		for _, s := range skills {
			if str, ok := s.(string); ok {
				v.RawSkills = append(v.RawSkills, str)
			}
		}
	}
	v.NormalizedSkills = domain.NormalizeSkills(v.RawSkills)
	if raw, err := json.Marshal(j); err == nil {
		v.RawJSON = raw
	}
	return v
}
