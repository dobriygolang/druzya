// ozon.go — career.ozon.ru parser.
//
// Verified live 2026-04-23 (response sample shared by user):
//
//	GET https://job-ozon-api.t.o3.ru/v2/vacancy
//	Headers required: Origin: https://career.ozon.ru
//	→ 200 application/json. Shape:
//	  {"items":[
//	    {"hhId":130283769,
//	     "internalUuid":"058569d9-…",
//	     "department":"Ozon Офис и Коммерция",
//	     "employment":"Полная",
//	     "experience":"От 3 до 6 лет",
//	     "workFormat":["Гибрид"],
//	     "title":"Data Engineer",
//	     "city":"Москва",
//	     "professionalRoles":[{"ID":"156","title":"BI-аналитик…"}],
//	     "vacancyType":"external_vacancy"}]}
//
// The host `*.t.o3.ru` is geo/JA3-protected (TLS handshake from non-RU
// edges fails), so the parser is verified by sample shape rather than live
// curl from the dev sandbox; production reaches it fine.
//
// Public detail URL: https://career.ozon.ru/vacancy/{internalUuid}.
//
// Earlier ozon.go targeted job.ozon.ru as a Next.js __NEXT_DATA__ scrape;
// that hits an SSR shell with no embedded list (data is loaded client-side
// from this same API). Replaced with the verified REST endpoint.
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
	ozonAPIURL  = "https://job-ozon-api.t.o3.ru/v2/vacancy"
	ozonSiteURL = "https://career.ozon.ru"
	// ozonOrigin is required by the API's CORS / origin allowlist —
	// without it the edge returns 403.
	ozonOrigin = "https://career.ozon.ru"
)

// OzonParser hits the Ozon careers REST endpoint.
type OzonParser struct {
	apiURL     string
	httpClient *http.Client
	log        *slog.Logger
}

// NewOzon builds the default parser. log is required.
func NewOzon(log *slog.Logger) *OzonParser {
	if log == nil {
		panic("vacancies.parsers.NewOzon: logger is required (anti-fallback policy: no silent noop loggers)")
	}
	return &OzonParser{
		apiURL: ozonAPIURL,
		httpClient: &http.Client{
			Timeout: 20 * time.Second,
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
func (p *OzonParser) WithBaseURL(u string) *OzonParser { p.apiURL = u; return p }

// Source implements domain.Parser.
func (p *OzonParser) Source() domain.Source { return domain.SourceOzon }

// Fetch pulls the entire vacancy catalogue in one shot — the API returns
// the full list (no pagination params observed; if `range` ever appears we
// extend).
func (p *OzonParser) Fetch(ctx context.Context) ([]domain.Vacancy, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, p.apiURL, nil)
	if err != nil {
		metrics.VacanciesParserErrorsTotal.WithLabelValues(string(domain.SourceOzon)).Inc()
		return nil, fmt.Errorf("vacancies.parser.ozon.newreq: %w", err)
	}
	req.Header.Set("User-Agent", scraperUA)
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Origin", ozonOrigin)
	req.Header.Set("Referer", ozonOrigin+"/")
	resp, err := p.httpClient.Do(req)
	if err != nil {
		metrics.VacanciesParserErrorsTotal.WithLabelValues(string(domain.SourceOzon)).Inc()
		return nil, fmt.Errorf("vacancies.parser.ozon.do: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		metrics.VacanciesParserErrorsTotal.WithLabelValues(string(domain.SourceOzon)).Inc()
		return nil, fmt.Errorf("vacancies.parser.ozon: http %d", resp.StatusCode)
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, 16<<20))
	if err != nil {
		metrics.VacanciesParserErrorsTotal.WithLabelValues(string(domain.SourceOzon)).Inc()
		return nil, fmt.Errorf("vacancies.parser.ozon.read: %w", err)
	}
	out, err := decodeOzonVacancies(body)
	if err != nil {
		metrics.VacanciesParserErrorsTotal.WithLabelValues(string(domain.SourceOzon)).Inc()
		return nil, fmt.Errorf("vacancies.parser.ozon.decode: %w", err)
	}
	if len(out) == 0 {
		p.log.Warn("vacancies.parser.ozon: 0 vacancies in response (shape drift?)")
	} else {
		p.log.Info("vacancies.parser.ozon: fetched", slog.Int("count", len(out)))
	}
	return out, nil
}

type ozonAPIResp struct {
	Items []ozonItem `json:"items"`
}

type ozonItem struct {
	HHID              int64      `json:"hhId"`
	InternalUUID      string     `json:"internalUuid"`
	Department        string     `json:"department"`
	Employment        string     `json:"employment"`
	Experience        string     `json:"experience"`
	WorkFormat        []string   `json:"workFormat"`
	Title             string     `json:"title"`
	City              string     `json:"city"`
	ProfessionalRoles []ozonRole `json:"professionalRoles"`
	VacancyType       string     `json:"vacancyType"`
}

type ozonRole struct {
	ID    string `json:"ID"`
	Title string `json:"title"`
}

func decodeOzonVacancies(body []byte) ([]domain.Vacancy, error) {
	if len(strings.TrimSpace(string(body))) == 0 {
		return nil, fmt.Errorf("empty body")
	}
	var resp ozonAPIResp
	if err := json.Unmarshal(body, &resp); err != nil {
		return nil, fmt.Errorf("unmarshal: %w", err)
	}
	now := time.Now().UTC()
	out := make([]domain.Vacancy, 0, len(resp.Items))
	for _, it := range resp.Items {
		if it.InternalUUID == "" || strings.TrimSpace(it.Title) == "" {
			continue
		}
		// Prefer the stable internal UUID as ExternalID — hhId can be 0
		// for purely-internal postings.
		extID := it.InternalUUID
		empParts := []string{}
		if it.Employment != "" {
			empParts = append(empParts, it.Employment)
		}
		empParts = append(empParts, it.WorkFormat...)
		descParts := []string{}
		if it.Department != "" {
			descParts = append(descParts, it.Department)
		}
		for _, r := range it.ProfessionalRoles {
			if r.Title != "" {
				descParts = append(descParts, r.Title)
			}
		}
		raw, _ := json.Marshal(it)
		v := domain.Vacancy{
			Source:          domain.SourceOzon,
			ExternalID:      extID,
			Title:           it.Title,
			Company:         "Ozon",
			Location:        it.City,
			EmploymentType:  strings.Join(empParts, ", "),
			ExperienceLevel: it.Experience,
			URL:             fmt.Sprintf("%s/vacancy/%s", ozonSiteURL, extID),
			Description:     strings.Join(descParts, " · "),
			FetchedAt:       now,
			RawJSON:         raw,
		}
		// Stash hhId in description if present — useful breadcrumb for
		// kanban operators cross-referencing the legacy HH posting.
		if it.HHID != 0 {
			v.Description = strings.TrimSpace(v.Description + " · hh#" + strconv.FormatInt(it.HHID, 10))
		}
		out = append(out, v)
	}
	return out, nil
}
