// wildberries.go — career.wb.ru parser.
//
// Wildberries exposes its careers site at https://career.wb.ru. We attempt
// the REST endpoint /api/vacancies first because (a) it's stable JSON, (b)
// it's cheaper to parse than HTML, (c) the listing page is a Next.js SPA
// that needs JS to render the list. If the REST endpoint returns 4xx or its
// shape is unrecognisable we fall back to scraping the SSR HTML for the
// embedded __NEXT_DATA__ blob. Both paths return real data — this is NOT a
// fake-fallback (anti-fallback policy); it is two real strategies against
// the same site.
//
// If both paths return zero, we return an empty slice + WARN log. Never a
// stub row.
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

const (
	wbAPIURL  = "https://career.wb.ru/api/vacancies"
	wbHTMLURL = "https://career.wb.ru/vacancies"
	wbSiteURL = "https://career.wb.ru"
)

// WildberriesParser scrapes career.wb.ru.
type WildberriesParser struct {
	apiURL     string
	htmlURL    string
	httpClient *http.Client
	log        *slog.Logger
}

// NewWildberries constructs the default-configured parser. log is required
// (anti-fallback policy: no silent noop loggers).
func NewWildberries(log *slog.Logger) *WildberriesParser {
	if log == nil {
		panic("vacancies.parsers.NewWildberries: logger is required (anti-fallback policy: no silent noop loggers)")
	}
	return &WildberriesParser{
		apiURL:  wbAPIURL,
		htmlURL: wbHTMLURL,
		httpClient: &http.Client{
			Timeout: 10 * time.Second,
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

// WithHTMLURL overrides the HTML fallback URL (test helper).
func (p *WildberriesParser) WithHTMLURL(u string) *WildberriesParser { p.htmlURL = u; return p }

// Source implements domain.Parser.
func (p *WildberriesParser) Source() domain.Source { return domain.SourceWildberries }

// Fetch tries the REST API first, then falls back to HTML scrape if REST
// is unavailable or unrecognisable. Errors propagate when both paths fail
// so the parser-errors metric ticks and ops gets paged.
func (p *WildberriesParser) Fetch(ctx context.Context) ([]domain.Vacancy, error) {
	if p.apiURL != "" {
		out, err := p.fetchFromAPI(ctx)
		if err == nil {
			if len(out) == 0 {
				p.log.Warn("vacancies.parser.wildberries: API returned 0 vacancies, trying HTML fallback")
			} else {
				p.log.Info("vacancies.parser.wildberries: fetched via REST", slog.Int("count", len(out)))
				return out, nil
			}
		} else {
			p.log.Warn("vacancies.parser.wildberries: REST API failed, falling back to HTML",
				slog.String("err", err.Error()))
		}
	}
	out, err := p.fetchFromHTML(ctx)
	if err != nil {
		metrics.VacanciesParserErrorsTotal.WithLabelValues(string(domain.SourceWildberries)).Inc()
		return nil, fmt.Errorf("vacancies.parser.wildberries: html fallback: %w", err)
	}
	if len(out) == 0 {
		p.log.Warn("vacancies.parser.wildberries: 0 vacancies from both paths")
	} else {
		p.log.Info("vacancies.parser.wildberries: fetched via HTML fallback", slog.Int("count", len(out)))
	}
	return out, nil
}

func (p *WildberriesParser) fetchFromAPI(ctx context.Context) ([]domain.Vacancy, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, p.apiURL, nil)
	if err != nil {
		return nil, fmt.Errorf("wb.api.newreq: %w", err)
	}
	req.Header.Set("User-Agent", scraperUA)
	req.Header.Set("Accept", "application/json")
	resp, err := p.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("wb.api.do: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		return nil, fmt.Errorf("wb.api: http %d", resp.StatusCode)
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
	if err != nil {
		return nil, fmt.Errorf("wb.api.read: %w", err)
	}
	return decodeWildberriesAPI(body)
}

// decodeWildberriesAPI accepts either a top-level array of vacancies or a
// wrapping object containing the array under a common key. Both shapes are
// reasonable REST conventions; we accept either rather than guess wrong.
func decodeWildberriesAPI(body []byte) ([]domain.Vacancy, error) {
	trimmed := strings.TrimSpace(string(body))
	if trimmed == "" {
		return nil, fmt.Errorf("wb.api.decode: empty body")
	}
	if strings.HasPrefix(trimmed, "[") {
		var arr []map[string]any
		if err := json.Unmarshal(body, &arr); err != nil {
			return nil, fmt.Errorf("wb.api.decode.array: %w", err)
		}
		out := make([]domain.Vacancy, 0, len(arr))
		for _, j := range arr {
			v := wbJobToVacancy(j)
			if v.Title != "" || v.ExternalID != "" {
				out = append(out, v)
			}
		}
		return out, nil
	}
	var blob map[string]any
	if err := json.Unmarshal(body, &blob); err != nil {
		return nil, fmt.Errorf("wb.api.decode.obj: %w", err)
	}
	jobs := findJobsArray(blob)
	if jobs == nil {
		return nil, fmt.Errorf("wb.api.decode: no jobs array found in response")
	}
	out := make([]domain.Vacancy, 0, len(jobs))
	for _, j := range jobs {
		jm, ok := j.(map[string]any)
		if !ok {
			continue
		}
		v := wbJobToVacancy(jm)
		if v.Title != "" || v.ExternalID != "" {
			out = append(out, v)
		}
	}
	return out, nil
}

func (p *WildberriesParser) fetchFromHTML(ctx context.Context) ([]domain.Vacancy, error) {
	body, err := fetchOzonTechHTML(ctx, p.httpClient, p.htmlURL)
	if err != nil {
		return nil, fmt.Errorf("wb.html.fetch: %w", err)
	}
	blob, ok := extractNextData(body)
	if !ok {
		return nil, fmt.Errorf("wb.html: __NEXT_DATA__ blob not found")
	}
	var b map[string]any
	if err := json.Unmarshal([]byte(blob), &b); err != nil {
		return nil, fmt.Errorf("wb.html.unmarshal: %w", err)
	}
	jobs := findJobsArray(b)
	out := make([]domain.Vacancy, 0, len(jobs))
	for _, j := range jobs {
		jm, ok := j.(map[string]any)
		if !ok {
			continue
		}
		v := wbJobToVacancy(jm)
		if v.Title != "" || v.ExternalID != "" {
			out = append(out, v)
		}
	}
	return out, nil
}

func wbJobToVacancy(j map[string]any) domain.Vacancy {
	get := func(k string) string {
		if v, ok := j[k].(string); ok {
			return v
		}
		return ""
	}
	v := domain.Vacancy{
		Source:         domain.SourceWildberries,
		ExternalID:     firstNonEmpty(get("id"), get("slug"), get("uuid")),
		Title:          firstNonEmpty(get("title"), get("name"), get("position")),
		Company:        "Wildberries",
		Location:       firstNonEmpty(get("city"), get("location"), get("office")),
		EmploymentType: firstNonEmpty(get("employment"), get("employmentType"), get("schedule")),
		URL:            get("url"),
		Description:    strings.TrimSpace(get("description") + "\n\n" + get("requirements") + "\n\n" + get("responsibilities")),
		FetchedAt:      time.Now().UTC(),
	}
	if v.URL == "" && get("slug") != "" {
		v.URL = fmt.Sprintf("%s/vacancies/%s", wbSiteURL, get("slug"))
	} else if v.URL == "" && v.ExternalID != "" {
		v.URL = fmt.Sprintf("%s/vacancies/%s", wbSiteURL, v.ExternalID)
	}
	if !strings.HasPrefix(v.URL, "http") && v.URL != "" {
		v.URL = wbSiteURL + ensureLeadingSlash(v.URL)
	}
	if pa := firstNonEmpty(get("publishedAt"), get("published_at"), get("createdAt"), get("created_at")); pa != "" {
		layouts := []string{time.RFC3339, "2006-01-02T15:04:05-0700", "2006-01-02"}
		for _, layout := range layouts {
			if t, err := time.Parse(layout, pa); err == nil {
				v.PostedAt = &t
				break
			}
		}
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
