// yandex.go — careers.yandex.ru/jobs parser.
//
// Yandex's careers site is Next.js — every page embeds the SSR payload as a
// JSON blob in <script id="__NEXT_DATA__">. We extract that blob, navigate
// to the jobs array, and convert each entry into a domain.Vacancy.
//
// Doing it this way (vs. a brittle DOM walk) keeps the parser stable across
// CSS reshuffles. If Yandex ever swaps the SSR strategy and the blob
// disappears we fall back to an empty fetch + a warning log.
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

	"druz9/vacancies/domain"
)

// yandexFetchURL is the listing URL the parser hits by default.
const yandexFetchURL = "https://yandex.ru/jobs/services/all"

// YandexParser scrapes careers.yandex.ru / yandex.ru/jobs.
type YandexParser struct {
	baseURL    string
	httpClient *http.Client
	log        *slog.Logger
}

// NewYandex builds the default-configured parser.
func NewYandex(log *slog.Logger) *YandexParser {
	if log == nil {
		log = slog.New(slog.NewTextHandler(noopWriter{}, nil))
	}
	return &YandexParser{
		baseURL:    yandexFetchURL,
		httpClient: &http.Client{Timeout: 15 * time.Second},
		log:        log,
	}
}

// WithBaseURL overrides the URL — used by tests to point at httptest.
func (p *YandexParser) WithBaseURL(u string) *YandexParser { p.baseURL = u; return p }

// Source implements domain.Parser.
func (p *YandexParser) Source() domain.Source { return domain.SourceYandex }

// Fetch downloads the listing HTML and decodes the embedded __NEXT_DATA__
// JSON. On any structural surprise we log a warning and return an empty
// slice — the sync loop must keep working.
func (p *YandexParser) Fetch(ctx context.Context) ([]domain.Vacancy, error) {
	body, err := fetchHTML(ctx, p.httpClient, p.baseURL)
	if err != nil {
		return nil, err
	}
	blob, ok := extractNextData(body)
	if !ok {
		p.log.Warn("vacancies.parser.yandex: __NEXT_DATA__ blob not found, returning []")
		return []domain.Vacancy{}, nil
	}
	out, err := decodeYandexJobs(blob)
	if err != nil {
		p.log.Warn("vacancies.parser.yandex: decode failed, returning []", slog.Any("err", err))
		return []domain.Vacancy{}, nil
	}
	p.log.Info("vacancies.parser.yandex: fetched", slog.Int("count", len(out)))
	return out, nil
}

// extractNextData finds the JSON content of <script id="__NEXT_DATA__"
// type="application/json"> in the HTML. Returns the raw JSON + ok flag.
func extractNextData(html string) (string, bool) {
	const marker = `id="__NEXT_DATA__"`
	idx := strings.Index(html, marker)
	if idx < 0 {
		return "", false
	}
	open := strings.Index(html[idx:], ">")
	if open < 0 {
		return "", false
	}
	start := idx + open + 1
	end := strings.Index(html[start:], "</script>")
	if end < 0 {
		return "", false
	}
	return html[start : start+end], true
}

// decodeYandexJobs walks the __NEXT_DATA__ tree looking for a "jobs" or
// "vacancies" array. Yandex restructures occasionally so we accept either.
func decodeYandexJobs(raw string) ([]domain.Vacancy, error) {
	var blob map[string]any
	if err := json.Unmarshal([]byte(raw), &blob); err != nil {
		return nil, fmt.Errorf("yandex.decode.unmarshal: %w", err)
	}
	jobs := findJobsArray(blob)
	out := make([]domain.Vacancy, 0, len(jobs))
	for _, j := range jobs {
		jm, ok := j.(map[string]any)
		if !ok {
			continue
		}
		out = append(out, yandexJobToVacancy(jm))
	}
	return out, nil
}

// findJobsArray does a best-effort BFS for an array under common keys.
func findJobsArray(blob map[string]any) []any {
	keys := []string{"jobs", "vacancies", "items", "list"}
	queue := []map[string]any{blob}
	for len(queue) > 0 {
		cur := queue[0]
		queue = queue[1:]
		for _, k := range keys {
			if v, ok := cur[k]; ok {
				if arr, ok := v.([]any); ok && len(arr) > 0 {
					if _, isObj := arr[0].(map[string]any); isObj {
						return arr
					}
				}
			}
		}
		for _, v := range cur {
			switch t := v.(type) {
			case map[string]any:
				queue = append(queue, t)
			case []any:
				for _, e := range t {
					if m, ok := e.(map[string]any); ok {
						queue = append(queue, m)
					}
				}
			}
		}
	}
	return nil
}

// yandexJobToVacancy maps a single jobs[] entry. Field names below are what
// Yandex commonly emits; missing fields are simply left empty.
func yandexJobToVacancy(j map[string]any) domain.Vacancy {
	get := func(k string) string {
		if v, ok := j[k].(string); ok {
			return v
		}
		return ""
	}
	v := domain.Vacancy{
		Source:      domain.SourceYandex,
		ExternalID:  get("id"),
		Title:       get("title"),
		Company:     "Yandex",
		Location:    get("city"),
		URL:         get("url"),
		Description: strings.TrimSpace(get("description") + "\n\n" + get("requirements") + "\n\n" + get("responsibilities")),
		FetchedAt:   time.Now().UTC(),
	}
	if v.ExternalID == "" {
		v.ExternalID = get("slug")
	}
	if v.URL == "" && v.ExternalID != "" {
		v.URL = fmt.Sprintf("https://yandex.ru/jobs/vacancies/%s", v.ExternalID)
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

// fetchHTML is a polite GET helper shared by HTML-scraping parsers. It sets
// the spec'd User-Agent and caps the body at 4 MiB to prevent OOM on a
// hostile/malformed response.
func fetchHTML(ctx context.Context, c *http.Client, urlStr string) (string, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, urlStr, nil)
	if err != nil {
		return "", fmt.Errorf("fetchHTML.newreq: %w", err)
	}
	req.Header.Set("User-Agent", "druz9/1.0 (+https://druz9.dev/contact)")
	req.Header.Set("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8")
	resp, err := c.Do(req)
	if err != nil {
		return "", fmt.Errorf("fetchHTML.do: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		return "", fmt.Errorf("fetchHTML: http %d", resp.StatusCode)
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
	if err != nil {
		return "", fmt.Errorf("fetchHTML.read: %w", err)
	}
	return string(body), nil
}
