// yandex.go — yandex.ru/jobs/api/publications parser.
//
// Verified live 2026-04-23 against production:
//
//	GET https://yandex.ru/jobs/api/publications?page_size=100
//	→ 200 application/json, DRF-style cursor paging, count=1364.
//	Shape:
//	  {"count":1364,
//	   "next":"…/jobs/api/publications/?cursor=…&page_size=…",
//	   "previous":null,
//	   "results":[
//	     {"id":15322,
//	      "publication_slug_url":"multitrack-…-15322",
//	      "title":"…",
//	      "short_summary":"…",
//	      "vacancy":{
//	        "cities":[{"id","name","slug"}],
//	        "skills":[{"id","name"}],
//	        "work_modes":[{"id","name","slug"}]},
//	      "public_service":{"name","description","group"}}]}
//
// Public detail URL is https://yandex.ru/jobs/vacancies/{publication_slug_url}.
//
// The previous yandex parser scraped the listing HTML for an embedded
// __NEXT_DATA__ blob — the page is now an App-Router RSC render with no
// client-side data, so the blob never existed. Replaced with the real REST
// endpoint that the SSR layer itself proxies to femida.yandex-team.ru.
//
// Anti-fallback: empty list + WARN if the wire shape drifts; metric tick on
// any error. We do NOT walk pagination by default — first page (page_size=
// 100) is enough for the kanban; fetching all 1364 every hour wastes budget.
// SyncJob calls Fetch once; pagination is a v2 task.
package parsers

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	"log/slog"

	"druz9/shared/pkg/metrics"
	"druz9/vacancies/domain"
)

const (
	yandexAPIURL  = "https://yandex.ru/jobs/api/publications?page_size=100"
	yandexSiteURL = "https://yandex.ru/jobs"
)

// YandexParser hits the public publications API.
type YandexParser struct {
	apiURL     string
	httpClient *http.Client
	log        *slog.Logger
}

// NewYandex builds the default parser. log is required.
func NewYandex(log *slog.Logger) *YandexParser {
	if log == nil {
		panic("vacancies.parsers.NewYandex: logger is required (anti-fallback policy: no silent noop loggers)")
	}
	return &YandexParser{
		apiURL: yandexAPIURL,
		httpClient: &http.Client{
			Timeout: 15 * time.Second,
			CheckRedirect: func(req *http.Request, via []*http.Request) error {
				if len(via) >= 5 {
					return fmt.Errorf("stopped after 5 redirects")
				}
				return nil
			},
		},
		log: log,
	}
}

// WithBaseURL keeps the old test-helper name; sets the API URL.
func (p *YandexParser) WithBaseURL(u string) *YandexParser { p.apiURL = u; return p }

// Source implements domain.Parser.
func (p *YandexParser) Source() domain.Source { return domain.SourceYandex }

// Fetch pulls the first page of publications (page_size=100). Errors tick
// the parser-errors metric so ops can alert; an honest empty list does not.
func (p *YandexParser) Fetch(ctx context.Context) ([]domain.Vacancy, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, p.apiURL, nil)
	if err != nil {
		metrics.VacanciesParserErrorsTotal.WithLabelValues(string(domain.SourceYandex)).Inc()
		return nil, fmt.Errorf("vacancies.parser.yandex.newreq: %w", err)
	}
	req.Header.Set("User-Agent", scraperUA)
	req.Header.Set("Accept", "application/json")
	resp, err := p.httpClient.Do(req)
	if err != nil {
		metrics.VacanciesParserErrorsTotal.WithLabelValues(string(domain.SourceYandex)).Inc()
		return nil, fmt.Errorf("vacancies.parser.yandex.do: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		metrics.VacanciesParserErrorsTotal.WithLabelValues(string(domain.SourceYandex)).Inc()
		return nil, fmt.Errorf("vacancies.parser.yandex: http %d", resp.StatusCode)
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, 8<<20))
	if err != nil {
		metrics.VacanciesParserErrorsTotal.WithLabelValues(string(domain.SourceYandex)).Inc()
		return nil, fmt.Errorf("vacancies.parser.yandex.read: %w", err)
	}
	out, err := decodeYandexPublications(body)
	if err != nil {
		metrics.VacanciesParserErrorsTotal.WithLabelValues(string(domain.SourceYandex)).Inc()
		return nil, fmt.Errorf("vacancies.parser.yandex.decode: %w", err)
	}
	if len(out) == 0 {
		p.log.Warn("vacancies.parser.yandex: 0 publications in response (shape drift?)")
	} else {
		p.log.Info("vacancies.parser.yandex: fetched", slog.Int("count", len(out)))
	}
	return out, nil
}

type yandexAPIResp struct {
	Count   int                 `json:"count"`
	Results []yandexPublication `json:"results"`
}

type yandexPublication struct {
	ID                 int64               `json:"id"`
	PublicationSlugURL string              `json:"publication_slug_url"`
	Title              string              `json:"title"`
	ShortSummary       string              `json:"short_summary"`
	Vacancy            yandexVacancyDetail `json:"vacancy"`
	PublicService      struct {
		Name string `json:"name"`
	} `json:"public_service"`
}

type yandexVacancyDetail struct {
	Cities    []yandexNamed `json:"cities"`
	Skills    []yandexNamed `json:"skills"`
	WorkModes []yandexNamed `json:"work_modes"`
}

type yandexNamed struct {
	Name string `json:"name"`
}

func decodeYandexPublications(body []byte) ([]domain.Vacancy, error) {
	if len(strings.TrimSpace(string(body))) == 0 {
		return nil, fmt.Errorf("empty body")
	}
	var resp yandexAPIResp
	if err := json.Unmarshal(body, &resp); err != nil {
		return nil, fmt.Errorf("unmarshal: %w", err)
	}
	now := time.Now().UTC()
	out := make([]domain.Vacancy, 0, len(resp.Results))
	for _, r := range resp.Results {
		if r.PublicationSlugURL == "" || strings.TrimSpace(r.Title) == "" {
			continue
		}
		cities := make([]string, 0, len(r.Vacancy.Cities))
		for _, c := range r.Vacancy.Cities {
			if c.Name != "" {
				cities = append(cities, c.Name)
			}
		}
		modes := make([]string, 0, len(r.Vacancy.WorkModes))
		for _, m := range r.Vacancy.WorkModes {
			if m.Name != "" {
				modes = append(modes, m.Name)
			}
		}
		skills := make([]string, 0, len(r.Vacancy.Skills))
		for _, s := range r.Vacancy.Skills {
			if s.Name != "" {
				skills = append(skills, s.Name)
			}
		}
		v := domain.Vacancy{
			Source:           domain.SourceYandex,
			ExternalID:       strconv.FormatInt(r.ID, 10),
			Title:            r.Title,
			Company:          "Yandex",
			Location:         strings.Join(cities, ", "),
			EmploymentType:   strings.Join(modes, ", "),
			URL:              fmt.Sprintf("%s/vacancies/%s", yandexSiteURL, r.PublicationSlugURL),
			Description:      strings.TrimSpace(r.ShortSummary),
			RawSkills:        skills,
			NormalizedSkills: domain.NormalizeSkills(skills),
			FetchedAt:        now,
		}
		if raw, err := json.Marshal(r); err == nil {
			v.RawJSON = raw
		}
		out = append(out, v)
	}
	return out, nil
}
