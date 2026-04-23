// mts.go — job.mts.ru careers parser.
//
// Verified live 2026-04-23 against production:
//
//	GET https://job.mts.ru/api/v2/vacancies?page=N
//	→ 200 application/json. Strapi-flavoured shape:
//	  {"data":[
//	    {"id":651331801431670900,
//	     "documentId":"legacy-…",
//	     "title":"Релизный менеджер мобильного приложения",
//	     "slug":"651331801431670850",
//	     "isActive":true,
//	     "publishedAt":"2026-04-23T00:00:00.000Z",
//	     "salaryFrom":null, "salaryTo":null,
//	     "currency":{"title":"RUB"},
//	     "region":{"title":"Москва"},
//	     "experience":{"title":"1-3 года"},
//	     "organization":{"title":"ПАО МТС-Банк"},
//	     "workFormats":[{"title":"В офисе"}],
//	     "tasks":[…], "offers":[…], "requirements":[…],
//	     "tags":[…]}],
//	   "meta":{"pagination":{"page":1,"pageSize":25,"pageCount":95,"total":2363}}}
//
// pageSize is server-capped at 25; 95 pages = 2363 vacancies. Hourly sync
// pulls page=1 only (newest 25); a periodic full-walk job is a v2 task —
// for the kanban use-case "fresh + recent" beats "exhaustive".
//
// Public detail URL: https://job.mts.ru/vacancies/{slug}.
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
	mtsAPIURL  = "https://job.mts.ru/api/v2/vacancies?page=1"
	mtsSiteURL = "https://job.mts.ru"
)

// MTSParser hits the MTS Strapi-style careers REST endpoint.
type MTSParser struct {
	apiURL     string
	httpClient *http.Client
	log        *slog.Logger
}

// NewMTS builds the default parser. log is required.
func NewMTS(log *slog.Logger) *MTSParser {
	if log == nil {
		panic("vacancies.parsers.NewMTS: logger is required (anti-fallback policy: no silent noop loggers)")
	}
	return &MTSParser{
		apiURL: mtsAPIURL,
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

// WithBaseURL is the test helper.
func (p *MTSParser) WithBaseURL(u string) *MTSParser { p.apiURL = u; return p }

// Source implements domain.Parser.
func (p *MTSParser) Source() domain.Source { return domain.SourceMTS }

// Fetch pulls the first page (newest 25 vacancies). Errors propagate to
// tick the parser-errors metric.
func (p *MTSParser) Fetch(ctx context.Context) ([]domain.Vacancy, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, p.apiURL, nil)
	if err != nil {
		metrics.VacanciesParserErrorsTotal.WithLabelValues(string(domain.SourceMTS)).Inc()
		return nil, fmt.Errorf("vacancies.parser.mts.newreq: %w", err)
	}
	req.Header.Set("User-Agent", scraperUA)
	req.Header.Set("Accept", "application/json")
	resp, err := p.httpClient.Do(req)
	if err != nil {
		metrics.VacanciesParserErrorsTotal.WithLabelValues(string(domain.SourceMTS)).Inc()
		return nil, fmt.Errorf("vacancies.parser.mts.do: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		metrics.VacanciesParserErrorsTotal.WithLabelValues(string(domain.SourceMTS)).Inc()
		return nil, fmt.Errorf("vacancies.parser.mts: http %d", resp.StatusCode)
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, 8<<20))
	if err != nil {
		metrics.VacanciesParserErrorsTotal.WithLabelValues(string(domain.SourceMTS)).Inc()
		return nil, fmt.Errorf("vacancies.parser.mts.read: %w", err)
	}
	out, err := decodeMTSVacancies(body)
	if err != nil {
		metrics.VacanciesParserErrorsTotal.WithLabelValues(string(domain.SourceMTS)).Inc()
		return nil, fmt.Errorf("vacancies.parser.mts.decode: %w", err)
	}
	if len(out) == 0 {
		p.log.Warn("vacancies.parser.mts: 0 vacancies in response (shape drift?)")
	} else {
		p.log.Info("vacancies.parser.mts: fetched", slog.Int("count", len(out)))
	}
	return out, nil
}

type mtsAPIResp struct {
	Data []mtsItem `json:"data"`
}

type mtsItem struct {
	ID           int64       `json:"id"`
	Title        string      `json:"title"`
	Slug         string      `json:"slug"`
	IsActive     bool        `json:"isActive"`
	PublishedAt  string      `json:"publishedAt"`
	SalaryFrom   *int        `json:"salaryFrom"`
	SalaryTo     *int        `json:"salaryTo"`
	Currency     mtsTitled   `json:"currency"`
	Region       mtsTitled   `json:"region"`
	Experience   mtsTitled   `json:"experience"`
	Organization mtsTitled   `json:"organization"`
	WorkFormats  []mtsTitled `json:"workFormats"`
	Tasks        []mtsTitled `json:"tasks"`
	Offers       []mtsTitled `json:"offers"`
	Requirements []mtsTitled `json:"requirements"`
	Tags         []mtsTitled `json:"tags"`
}

type mtsTitled struct {
	Title string `json:"title"`
}

func decodeMTSVacancies(body []byte) ([]domain.Vacancy, error) {
	if len(strings.TrimSpace(string(body))) == 0 {
		return nil, fmt.Errorf("empty body")
	}
	var resp mtsAPIResp
	if err := json.Unmarshal(body, &resp); err != nil {
		return nil, fmt.Errorf("unmarshal: %w", err)
	}
	now := time.Now().UTC()
	out := make([]domain.Vacancy, 0, len(resp.Data))
	for _, it := range resp.Data {
		if it.ID == 0 || strings.TrimSpace(it.Title) == "" || it.Slug == "" {
			continue
		}
		empParts := make([]string, 0, len(it.WorkFormats))
		for _, w := range it.WorkFormats {
			if w.Title != "" {
				empParts = append(empParts, w.Title)
			}
		}
		// Build description from tasks + requirements + offers (the three
		// strapi blocks the listing page itself uses).
		descParts := []string{}
		if len(it.Tasks) > 0 {
			descParts = append(descParts, "Задачи: "+joinTitled(it.Tasks))
		}
		if len(it.Requirements) > 0 {
			descParts = append(descParts, "Требования: "+joinTitled(it.Requirements))
		}
		if len(it.Offers) > 0 {
			descParts = append(descParts, "Предлагаем: "+joinTitled(it.Offers))
		}
		skills := make([]string, 0, len(it.Tags))
		for _, t := range it.Tags {
			if t.Title != "" {
				skills = append(skills, t.Title)
			}
		}
		company := "МТС"
		if it.Organization.Title != "" {
			company = it.Organization.Title
		}
		var sFrom, sTo int
		if it.SalaryFrom != nil {
			sFrom = *it.SalaryFrom
		}
		if it.SalaryTo != nil {
			sTo = *it.SalaryTo
		}
		var posted *time.Time
		if it.PublishedAt != "" {
			if t, err := time.Parse(time.RFC3339, it.PublishedAt); err == nil {
				posted = &t
			}
		}
		raw, _ := json.Marshal(it)
		out = append(out, domain.Vacancy{
			Source:           domain.SourceMTS,
			ExternalID:       strconv.FormatInt(it.ID, 10),
			Title:            it.Title,
			Company:          company,
			Location:         it.Region.Title,
			EmploymentType:   strings.Join(empParts, ", "),
			ExperienceLevel:  it.Experience.Title,
			SalaryMin:        sFrom,
			SalaryMax:        sTo,
			Currency:         it.Currency.Title,
			URL:              fmt.Sprintf("%s/vacancies/%s", mtsSiteURL, it.Slug),
			Description:      strings.Join(descParts, "\n\n"),
			RawSkills:        skills,
			NormalizedSkills: domain.NormalizeSkills(skills),
			PostedAt:         posted,
			FetchedAt:        now,
			RawJSON:          raw,
		})
	}
	return out, nil
}

func joinTitled(xs []mtsTitled) string {
	parts := make([]string, 0, len(xs))
	for _, x := range xs {
		if x.Title != "" {
			parts = append(parts, x.Title)
		}
	}
	return strings.Join(parts, "; ")
}
