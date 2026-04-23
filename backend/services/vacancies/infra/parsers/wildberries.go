// wildberries.go — career.rwb.ru parser (Wildberries / РВБ).
//
// First Phase 1 cut tried `https://career.wb.ru/api/vacancies` based on a
// guess. That guess was wrong: the public endpoint is on the renamed host
// (career.wb.ru → career.rwb.ru cross-host 307) and the path is
// `/crm-api/api/v1/pub/vacancies`. The earlier "REST or HTML fallback"
// strategy was a defensive shim for a shape we never actually verified.
//
// Verified 2026-04-23 against production:
//
//	GET https://career.rwb.ru/crm-api/api/v1/pub/vacancies
//	→ 200 application/json, 538 vacancies in one shot, no pagination params
//	   required.
//	Shape:
//	  {"status":200,
//	   "data":{
//	     "items":[
//	       {"id":30154,
//	        "name":"Lead System Analyst DWH …",
//	        "direction_title":"Аналитика",
//	        "direction_role_title":"System Analyst",
//	        "experience_type_title":"От 5 лет",
//	        "city_title":"Москва",
//	        "employment_types":[{"title":"Гибрид"}, {"title":"Удаленно"}]},
//	       …],
//	     "range":{…}}}
//
// We hit the verified host directly (skip the cross-host redirect dance —
// no upside, just a request budget tax). Public detail page is
// `https://career.rwb.ru/vacancies/{id}` which 200s.
//
// Anti-fallback: empty list + WARN log if the wire shape ever drifts; never
// stub data. The parser-errors metric is the ops signal.
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
	wbAPIURL  = "https://career.rwb.ru/crm-api/api/v1/pub/vacancies"
	wbSiteURL = "https://career.rwb.ru"
)

// WildberriesParser scrapes the WB / РВБ careers REST endpoint.
type WildberriesParser struct {
	apiURL     string
	httpClient *http.Client
	log        *slog.Logger
}

// NewWildberries builds the default parser. log is required.
func NewWildberries(log *slog.Logger) *WildberriesParser {
	if log == nil {
		panic("vacancies.parsers.NewWildberries: logger is required (anti-fallback policy: no silent noop loggers)")
	}
	return &WildberriesParser{
		apiURL: wbAPIURL,
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

// WithAPIURL overrides the REST endpoint (test helper).
func (p *WildberriesParser) WithAPIURL(u string) *WildberriesParser { p.apiURL = u; return p }

// Source implements domain.Parser.
func (p *WildberriesParser) Source() domain.Source { return domain.SourceWildberries }

// Fetch pulls the public vacancy list and maps it to domain.Vacancy.
// Returns an error if the request itself fails so the parser-errors metric
// ticks; an empty result with no error is a legitimate "WB has nothing
// today" outcome (won't happen in practice, they hold ~500 open roles).
func (p *WildberriesParser) Fetch(ctx context.Context) ([]domain.Vacancy, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, p.apiURL, nil)
	if err != nil {
		metrics.VacanciesParserErrorsTotal.WithLabelValues(string(domain.SourceWildberries)).Inc()
		return nil, fmt.Errorf("vacancies.parser.wildberries.newreq: %w", err)
	}
	req.Header.Set("User-Agent", scraperUA)
	req.Header.Set("Accept", "application/json")
	resp, err := p.httpClient.Do(req)
	if err != nil {
		metrics.VacanciesParserErrorsTotal.WithLabelValues(string(domain.SourceWildberries)).Inc()
		return nil, fmt.Errorf("vacancies.parser.wildberries.do: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		metrics.VacanciesParserErrorsTotal.WithLabelValues(string(domain.SourceWildberries)).Inc()
		return nil, fmt.Errorf("vacancies.parser.wildberries: http %d", resp.StatusCode)
	}
	// 4 MB cap covers ~10× current payload (~190 KB for 538 items).
	body, err := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
	if err != nil {
		metrics.VacanciesParserErrorsTotal.WithLabelValues(string(domain.SourceWildberries)).Inc()
		return nil, fmt.Errorf("vacancies.parser.wildberries.read: %w", err)
	}
	out, err := decodeWildberriesAPI(body)
	if err != nil {
		metrics.VacanciesParserErrorsTotal.WithLabelValues(string(domain.SourceWildberries)).Inc()
		return nil, fmt.Errorf("vacancies.parser.wildberries.decode: %w", err)
	}
	if len(out) == 0 {
		p.log.Warn("vacancies.parser.wildberries: 0 vacancies in response (shape drift?)")
	} else {
		p.log.Info("vacancies.parser.wildberries: fetched", slog.Int("count", len(out)))
	}
	return out, nil
}

// wbAPIResponse mirrors the verified wire shape. Only the fields we read
// are declared; extras are ignored by encoding/json.
type wbAPIResponse struct {
	Status int `json:"status"`
	Data   struct {
		Items []wbAPIItem `json:"items"`
	} `json:"data"`
}

type wbAPIItem struct {
	ID                 int64           `json:"id"`
	Name               string          `json:"name"`
	DirectionTitle     string          `json:"direction_title"`
	DirectionRoleTitle string          `json:"direction_role_title"`
	ExperienceTitle    string          `json:"experience_type_title"`
	CityTitle          string          `json:"city_title"`
	EmploymentTypes    []wbAPIEmpType  `json:"employment_types"`
	Raw                json.RawMessage `json:"-"`
}

type wbAPIEmpType struct {
	Title string `json:"title"`
}

func decodeWildberriesAPI(body []byte) ([]domain.Vacancy, error) {
	if len(strings.TrimSpace(string(body))) == 0 {
		return nil, fmt.Errorf("empty body")
	}
	var resp wbAPIResponse
	if err := json.Unmarshal(body, &resp); err != nil {
		return nil, fmt.Errorf("unmarshal: %w", err)
	}
	now := time.Now().UTC()
	out := make([]domain.Vacancy, 0, len(resp.Data.Items))
	for _, it := range resp.Data.Items {
		if it.ID == 0 || strings.TrimSpace(it.Name) == "" {
			continue
		}
		extID := strconv.FormatInt(it.ID, 10)
		empParts := make([]string, 0, len(it.EmploymentTypes))
		for _, e := range it.EmploymentTypes {
			if e.Title != "" {
				empParts = append(empParts, e.Title)
			}
		}
		v := domain.Vacancy{
			Source:          domain.SourceWildberries,
			ExternalID:      extID,
			Title:           it.Name,
			Company:         "Wildberries",
			Location:        it.CityTitle,
			EmploymentType:  strings.Join(empParts, ", "),
			ExperienceLevel: it.ExperienceTitle,
			URL:             fmt.Sprintf("%s/vacancies/%s", wbSiteURL, extID),
			// Listing endpoint omits description; the kanban/detail flow can
			// resolve it later via /crm-api/api/v1/pub/vacancies/{id}. We
			// stash a short hint so the list view isn't blank.
			Description:      strings.TrimSpace(it.DirectionTitle + " · " + it.DirectionRoleTitle),
			RawSkills:        nil,
			NormalizedSkills: nil,
			FetchedAt:        now,
		}
		// Preserve the verbatim per-item JSON for forensics + future re-parse.
		if raw, err := json.Marshal(it); err == nil {
			v.RawJSON = raw
		}
		out = append(out, v)
	}
	return out, nil
}
