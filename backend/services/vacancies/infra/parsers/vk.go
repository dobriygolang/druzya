// vk.go — team.vk.company / VK Tech careers parser.
//
// Verified live 2026-04-23 against production:
//
//	GET https://team.vk.company/career/api/v2/vacancies/?limit=200&offset=0
//	→ 200 application/json. DRF-style cursor paging:
//	  {"count":306,
//	   "next":"…?limit=10&offset=10",
//	   "previous":null,
//	   "results":[
//	     {"id":45215,
//	      "title":"Специалист по эксплуатации",
//	      "prof_area":{"id","name"},
//	      "group":{"id","name","project_logo"},
//	      "town":{"id","name"},
//	      "work_format":"офисный",
//	      "tags":[{"id","name"}],
//	      "remote":false,
//	      "specialty":{"id","name"}}]}
//
// Public detail URL: https://team.vk.company/vacancy/{id}/.
//
// Server's default `limit` is 10. We request 200 in one shot — covers the
// current 306-vacancy backlog comfortably without paging. If the catalogue
// ever grows past 200 we'll start following `next`.
//
// Anti-fallback: empty + WARN on shape drift; metric tick on transport
// failure. Earlier vk.go targeted a __NEXT_DATA__ blob on the SSR shell —
// replaced with the verified REST endpoint.
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
	vkAPIURL  = "https://team.vk.company/career/api/v2/vacancies/?limit=200&offset=0"
	vkSiteURL = "https://team.vk.company"
)

// VKParser hits the VK Tech career REST endpoint.
type VKParser struct {
	apiURL     string
	httpClient *http.Client
	log        *slog.Logger
}

// NewVK builds the default parser. log is required.
func NewVK(log *slog.Logger) *VKParser {
	if log == nil {
		panic("vacancies.parsers.NewVK: logger is required (anti-fallback policy: no silent noop loggers)")
	}
	return &VKParser{
		apiURL: vkAPIURL,
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
func (p *VKParser) WithBaseURL(u string) *VKParser { p.apiURL = u; return p }

// Source implements domain.Parser.
func (p *VKParser) Source() domain.Source { return domain.SourceVK }

// Fetch pulls the first 200 vacancies (covers the current 306 catalogue
// nearly fully without paging).
func (p *VKParser) Fetch(ctx context.Context) ([]domain.Vacancy, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, p.apiURL, nil)
	if err != nil {
		metrics.VacanciesParserErrorsTotal.WithLabelValues(string(domain.SourceVK)).Inc()
		return nil, fmt.Errorf("vacancies.parser.vk.newreq: %w", err)
	}
	req.Header.Set("User-Agent", scraperUA)
	req.Header.Set("Accept", "application/json")
	resp, err := p.httpClient.Do(req)
	if err != nil {
		metrics.VacanciesParserErrorsTotal.WithLabelValues(string(domain.SourceVK)).Inc()
		return nil, fmt.Errorf("vacancies.parser.vk.do: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		metrics.VacanciesParserErrorsTotal.WithLabelValues(string(domain.SourceVK)).Inc()
		return nil, fmt.Errorf("vacancies.parser.vk: http %d", resp.StatusCode)
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, 8<<20))
	if err != nil {
		metrics.VacanciesParserErrorsTotal.WithLabelValues(string(domain.SourceVK)).Inc()
		return nil, fmt.Errorf("vacancies.parser.vk.read: %w", err)
	}
	out, err := decodeVKVacancies(body)
	if err != nil {
		metrics.VacanciesParserErrorsTotal.WithLabelValues(string(domain.SourceVK)).Inc()
		return nil, fmt.Errorf("vacancies.parser.vk.decode: %w", err)
	}
	if len(out) == 0 {
		p.log.Warn("vacancies.parser.vk: 0 vacancies in response (shape drift?)")
	} else {
		p.log.Info("vacancies.parser.vk: fetched", slog.Int("count", len(out)))
	}
	return out, nil
}

type vkAPIResp struct {
	Count   int         `json:"count"`
	Results []vkVacancy `json:"results"`
}

type vkVacancy struct {
	ID         int64     `json:"id"`
	Title      string    `json:"title"`
	WorkFormat string    `json:"work_format"`
	Remote     bool      `json:"remote"`
	ProfArea   vkNamed   `json:"prof_area"`
	Group      vkNamed   `json:"group"`
	Town       vkNamed   `json:"town"`
	Specialty  vkNamed   `json:"specialty"`
	Tags       []vkNamed `json:"tags"`
}

type vkNamed struct {
	Name string `json:"name"`
}

func decodeVKVacancies(body []byte) ([]domain.Vacancy, error) {
	if len(strings.TrimSpace(string(body))) == 0 {
		return nil, fmt.Errorf("empty body")
	}
	var resp vkAPIResp
	if err := json.Unmarshal(body, &resp); err != nil {
		return nil, fmt.Errorf("unmarshal: %w", err)
	}
	now := time.Now().UTC()
	out := make([]domain.Vacancy, 0, len(resp.Results))
	for _, r := range resp.Results {
		if r.ID == 0 || strings.TrimSpace(r.Title) == "" {
			continue
		}
		extID := strconv.FormatInt(r.ID, 10)
		empParts := []string{}
		if r.WorkFormat != "" {
			empParts = append(empParts, r.WorkFormat)
		}
		if r.Remote {
			empParts = append(empParts, "удалённо")
		}
		descParts := []string{}
		if r.ProfArea.Name != "" {
			descParts = append(descParts, r.ProfArea.Name)
		}
		if r.Specialty.Name != "" {
			descParts = append(descParts, r.Specialty.Name)
		}
		skills := make([]string, 0, len(r.Tags))
		for _, t := range r.Tags {
			if t.Name != "" {
				skills = append(skills, t.Name)
			}
		}
		company := "VK"
		if r.Group.Name != "" {
			company = r.Group.Name
		}
		v := domain.Vacancy{
			Source:           domain.SourceVK,
			ExternalID:       extID,
			Title:            r.Title,
			Company:          company,
			Location:         r.Town.Name,
			EmploymentType:   strings.Join(empParts, ", "),
			URL:              fmt.Sprintf("%s/vacancy/%s/", vkSiteURL, extID),
			Description:      strings.Join(descParts, " · "),
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
