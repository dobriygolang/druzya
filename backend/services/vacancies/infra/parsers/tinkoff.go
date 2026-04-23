// tinkoff.go — jobs.tinkoff.ru / T-Bank careers parser.
//
// T-Bank's careers page is built on a public-ish JSON endpoint:
//
//	GET https://api.tinkoff.ru/career/v1/vacancies?page=0&size=50
//
// (the exact path drifts; we keep the override hook so an operator can pin
// it via env if the prod URL changes).
//
// On any non-2xx, malformed JSON, or schema surprise we degrade to an empty
// fetch + warning, like every other parser.
package parsers

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"druz9/shared/pkg/metrics"
	"druz9/vacancies/domain"
)

const tinkoffBaseURL = "https://www.tbank.ru/career/api/vacancy/list/"

// TinkoffParser scrapes T-Bank careers.
type TinkoffParser struct {
	baseURL    string
	httpClient *http.Client
	log        *slog.Logger
}

// NewTinkoff builds the default-configured parser. log is required
// (anti-fallback policy).
func NewTinkoff(log *slog.Logger) *TinkoffParser {
	if log == nil {
		panic("vacancies.parsers.NewTinkoff: logger is required (anti-fallback policy: no silent noop loggers)")
	}
	return &TinkoffParser{
		baseURL:    tinkoffBaseURL,
		httpClient: &http.Client{Timeout: 15 * time.Second},
		log:        log,
	}
}

// WithBaseURL is a test hook.
func (p *TinkoffParser) WithBaseURL(u string) *TinkoffParser { p.baseURL = u; return p }

// Source implements domain.Parser.
func (p *TinkoffParser) Source() domain.Source { return domain.SourceTinkoff }

// tinkoffPayload is the lowest-common-denominator response shape we accept.
type tinkoffPayload struct {
	Items []map[string]any `json:"items"`
	// Some versions of the endpoint embed the items under "payload.vacancies".
	Payload struct {
		Vacancies []map[string]any `json:"vacancies"`
	} `json:"payload"`
}

// Fetch GETs the listing JSON and converts items. Anti-fallback: non-2xx
// and decode errors propagate; SyncJob.runOneParser absorbs them at the
// loop level + the parser_errors metric makes them alert-able.
func (p *TinkoffParser) Fetch(ctx context.Context) ([]domain.Vacancy, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, p.baseURL, nil)
	if err != nil {
		metrics.VacanciesParserErrorsTotal.WithLabelValues(string(domain.SourceTinkoff)).Inc()
		return nil, fmt.Errorf("vacancies.parser.tinkoff.newreq: %w", err)
	}
	req.Header.Set("User-Agent", "druz9/1.0 (+https://druz9.dev/contact)")
	req.Header.Set("Accept", "application/json")
	resp, err := p.httpClient.Do(req)
	if err != nil {
		metrics.VacanciesParserErrorsTotal.WithLabelValues(string(domain.SourceTinkoff)).Inc()
		return nil, fmt.Errorf("vacancies.parser.tinkoff.do: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		metrics.VacanciesParserErrorsTotal.WithLabelValues(string(domain.SourceTinkoff)).Inc()
		return nil, fmt.Errorf("vacancies.parser.tinkoff: non-2xx status=%d", resp.StatusCode)
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
	if err != nil {
		metrics.VacanciesParserErrorsTotal.WithLabelValues(string(domain.SourceTinkoff)).Inc()
		return nil, fmt.Errorf("vacancies.parser.tinkoff.read: %w", err)
	}
	var p1 tinkoffPayload
	if err := json.Unmarshal(body, &p1); err != nil {
		metrics.VacanciesParserErrorsTotal.WithLabelValues(string(domain.SourceTinkoff)).Inc()
		return nil, fmt.Errorf("vacancies.parser.tinkoff.decode: %w", err)
	}
	items := p1.Items
	if len(items) == 0 {
		items = p1.Payload.Vacancies
	}
	out := make([]domain.Vacancy, 0, len(items))
	for _, it := range items {
		out = append(out, tinkoffJobToVacancy(it))
	}
	p.log.Info("vacancies.parser.tinkoff: fetched", slog.Int("count", len(out)))
	return out, nil
}

func tinkoffJobToVacancy(j map[string]any) domain.Vacancy {
	get := func(k string) string {
		if v, ok := j[k].(string); ok {
			return v
		}
		return ""
	}
	v := domain.Vacancy{
		Source:      domain.SourceTinkoff,
		ExternalID:  get("id"),
		Title:       get("title"),
		Company:     "T-Bank",
		Location:    get("city"),
		URL:         get("url"),
		Description: strings.TrimSpace(get("description") + "\n\n" + get("requirements")),
		FetchedAt:   time.Now().UTC(),
	}
	if v.ExternalID == "" {
		v.ExternalID = get("slug")
	}
	if v.URL == "" && v.ExternalID != "" {
		v.URL = fmt.Sprintf("https://www.tbank.ru/career/it/vacancy/%s/", v.ExternalID)
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
