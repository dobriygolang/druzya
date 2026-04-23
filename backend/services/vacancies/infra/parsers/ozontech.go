// ozontech.go — career.ozon.tech parser.
//
// Ozon Tech (the IT subsidiary, distinct from job.ozon.ru retail) ships its
// careers site as a Next.js app. Every server-rendered page embeds the SSR
// payload as JSON inside <script id="__NEXT_DATA__" type="application/json">,
// so we GET the listing HTML, extract that blob, and walk it for the jobs
// array. The structural mining helpers (extractNextData, findJobsArray) are
// shared with the yandex/ozon parsers.
//
// Anti-fallback policy: if the blob is missing or its shape changed, we
// return an empty slice plus a single WARN log — never a stub or fake row.
// The frontend filter sidebar must reflect reality, and ops needs to be
// able to tell "Ozon Tech genuinely had nothing" from "our parser is broken"
// (the warn log + parser-errors metric tick is the signal).
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
	ozonTechBaseURL = "https://career.ozon.tech/vacancies"
	ozonTechSiteURL = "https://career.ozon.tech"
	// scraperUA is the polite UA we send to all post-HH scrapers. Identifies
	// the bot, links to the canonical site so admins can contact us before
	// reaching for the rate-limit hammer.
	scraperUA = "Mozilla/5.0 (compatible; druz9-vacancies/1.0; +https://druz9.online)"
)

// OzonTechParser scrapes career.ozon.tech.
type OzonTechParser struct {
	baseURL    string
	httpClient *http.Client
	log        *slog.Logger
}

// NewOzonTech constructs the default-configured parser. log is required
// (anti-fallback policy: no silent noop loggers).
func NewOzonTech(log *slog.Logger) *OzonTechParser {
	if log == nil {
		panic("vacancies.parsers.NewOzonTech: logger is required (anti-fallback policy: no silent noop loggers)")
	}
	return &OzonTechParser{
		baseURL: ozonTechBaseURL,
		httpClient: &http.Client{
			Timeout: 10 * time.Second,
			// Cap redirect chains; career sites occasionally bounce through a
			// CDN and we don't want an infinite loop eating the budget.
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

// WithBaseURL is a test override.
func (p *OzonTechParser) WithBaseURL(u string) *OzonTechParser { p.baseURL = u; return p }

// Source implements domain.Parser.
func (p *OzonTechParser) Source() domain.Source { return domain.SourceOzonTech }

// Fetch downloads the listing HTML and decodes the embedded __NEXT_DATA__
// JSON. Schema surprises propagate as real errors and tick
// vacancies_parser_errors_total{source=ozontech}.
func (p *OzonTechParser) Fetch(ctx context.Context) ([]domain.Vacancy, error) {
	body, err := fetchOzonTechHTML(ctx, p.httpClient, p.baseURL)
	if err != nil {
		metrics.VacanciesParserErrorsTotal.WithLabelValues(string(domain.SourceOzonTech)).Inc()
		return nil, fmt.Errorf("vacancies.parser.ozontech: fetch: %w", err)
	}
	blob, ok := extractNextData(body)
	if !ok {
		metrics.VacanciesParserErrorsTotal.WithLabelValues(string(domain.SourceOzonTech)).Inc()
		p.log.Warn("vacancies.parser.ozontech: __NEXT_DATA__ blob not found — site shape changed?")
		return []domain.Vacancy{}, fmt.Errorf("vacancies.parser.ozontech: __NEXT_DATA__ blob not found")
	}
	out, err := decodeOzonTechJobs(blob)
	if err != nil {
		metrics.VacanciesParserErrorsTotal.WithLabelValues(string(domain.SourceOzonTech)).Inc()
		return nil, fmt.Errorf("vacancies.parser.ozontech: decode: %w", err)
	}
	if len(out) == 0 {
		// Honest empty state — never invent fake rows. The catalogue can show
		// "Ozon Tech: 0 vacancies" for real if the page truly is empty.
		p.log.Warn("vacancies.parser.ozontech: 0 vacancies decoded from blob")
	} else {
		p.log.Info("vacancies.parser.ozontech: fetched", slog.Int("count", len(out)))
	}
	return out, nil
}

func decodeOzonTechJobs(raw string) ([]domain.Vacancy, error) {
	var blob map[string]any
	if err := json.Unmarshal([]byte(raw), &blob); err != nil {
		return nil, fmt.Errorf("ozontech.decode.unmarshal: %w", err)
	}
	jobs := findJobsArray(blob)
	out := make([]domain.Vacancy, 0, len(jobs))
	for _, j := range jobs {
		jm, ok := j.(map[string]any)
		if !ok {
			continue
		}
		v := ozonTechJobToVacancy(jm)
		if v.Title == "" && v.ExternalID == "" {
			// Skip junk entries — the BFS occasionally lands on a
			// non-vacancy array shaped like one.
			continue
		}
		out = append(out, v)
	}
	return out, nil
}

func ozonTechJobToVacancy(j map[string]any) domain.Vacancy {
	get := func(k string) string {
		if v, ok := j[k].(string); ok {
			return v
		}
		return ""
	}
	v := domain.Vacancy{
		Source:         domain.SourceOzonTech,
		ExternalID:     firstNonEmpty(get("id"), get("slug"), get("uuid")),
		Title:          firstNonEmpty(get("title"), get("name"), get("position")),
		Company:        "Ozon Tech",
		Location:       firstNonEmpty(get("city"), get("location"), get("office")),
		EmploymentType: firstNonEmpty(get("employment"), get("employmentType"), get("schedule")),
		URL:            get("url"),
		Description:    strings.TrimSpace(get("description") + "\n\n" + get("requirements") + "\n\n" + get("responsibilities")),
		FetchedAt:      time.Now().UTC(),
	}
	if v.URL == "" && get("slug") != "" {
		v.URL = fmt.Sprintf("%s/vacancies/%s", ozonTechSiteURL, get("slug"))
	} else if v.URL == "" && v.ExternalID != "" {
		v.URL = fmt.Sprintf("%s/vacancies/%s", ozonTechSiteURL, v.ExternalID)
	}
	if !strings.HasPrefix(v.URL, "http") && v.URL != "" {
		v.URL = ozonTechSiteURL + ensureLeadingSlash(v.URL)
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

// fetchOzonTechHTML is a polite GET helper specifically for the post-HH
// scrapers — sets the spec'd UA and caps the body at 4 MiB.
func fetchOzonTechHTML(ctx context.Context, c *http.Client, urlStr string) (string, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, urlStr, nil)
	if err != nil {
		return "", fmt.Errorf("fetchOzonTechHTML.newreq: %w", err)
	}
	req.Header.Set("User-Agent", scraperUA)
	req.Header.Set("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8")
	resp, err := c.Do(req)
	if err != nil {
		return "", fmt.Errorf("fetchOzonTechHTML.do: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		return "", fmt.Errorf("fetchOzonTechHTML: http %d", resp.StatusCode)
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
	if err != nil {
		return "", fmt.Errorf("fetchOzonTechHTML.read: %w", err)
	}
	return string(body), nil
}

func firstNonEmpty(xs ...string) string {
	for _, x := range xs {
		if x != "" {
			return x
		}
	}
	return ""
}

func ensureLeadingSlash(s string) string {
	if strings.HasPrefix(s, "/") {
		return s
	}
	return "/" + s
}
