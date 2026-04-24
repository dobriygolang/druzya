// mts_detail.go — job.mts.ru/api/v2/vacancies/{slug} fetcher.
//
// Verified live 2026-04-23. Top-level shape:
//
//	{"data":{
//	  "id":..., "slug":"...",
//	  "description":"...",
//	  "tasks":[{"id":1,"title":"...","description":"..."}],
//	  "requirements":[{"id":1,"title":"...","description":"..."}],
//	  "offers":[{"id":1,"title":"...","description":"..."}],
//	  "detailText":"<p>…</p>", "info":"…"
//	}}
//
// Each task/requirement/offer is wrapped in {id,title,description}; title
// and description are typically duplicate strings — we pick title.
//
// Identity: the listing parser stores numeric id as ExternalID and slug as
// DetailsKey. This fetcher uses listing.DetailsKey to call the right URL.
// If DetailsKey is empty (shouldn't happen post-Phase-4) we fail loudly
// rather than guess.
package details

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"strings"

	"druz9/vacancies/domain"

	cacheLayer "druz9/vacancies/infra/cache"
)

const mtsDetailBaseURL = "https://job.mts.ru/api/v2/vacancies"

// MTSDetailFetcher implements cache.DetailFetcher.
type MTSDetailFetcher struct {
	baseURL string
	http    *http.Client
	log     *slog.Logger
}

// NewMTS builds the MTS detail fetcher.
func NewMTS(log *slog.Logger) *MTSDetailFetcher {
	if log == nil {
		panic("vacancies.details.NewMTS: logger is required (anti-fallback policy)")
	}
	return &MTSDetailFetcher{baseURL: mtsDetailBaseURL, http: defaultClient(), log: log}
}

// WithBaseURL is the test seam.
func (m *MTSDetailFetcher) WithBaseURL(u string) *MTSDetailFetcher { m.baseURL = u; return m }

// Source implements DetailFetcher.
func (m *MTSDetailFetcher) Source() domain.Source { return domain.SourceMTS }

// FetchDetails calls the per-vacancy slug-keyed endpoint.
func (m *MTSDetailFetcher) FetchDetails(ctx context.Context, externalID string, listing domain.Vacancy) (domain.VacancyDetails, error) {
	slug := strings.TrimSpace(listing.DetailsKey)
	if slug == "" {
		// Anti-fallback: do NOT guess at an id-based detail URL — the
		// MTS detail endpoint genuinely requires a slug. A missing
		// DetailsKey is a parser-side bug; surface it loudly so the
		// metric tick + log alert fires.
		return domain.VacancyDetails{}, fmt.Errorf("vacancies.details.mts: missing slug (DetailsKey) for external_id=%s", externalID)
	}
	u := m.baseURL + "/" + url.PathEscape(slug)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return domain.VacancyDetails{}, fmt.Errorf("vacancies.details.mts.newreq: %w", err)
	}
	req.Header.Set("User-Agent", scraperUA)
	req.Header.Set("Accept", "application/json")
	resp, err := m.http.Do(req)
	if err != nil {
		return domain.VacancyDetails{}, fmt.Errorf("vacancies.details.mts.do: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		return domain.VacancyDetails{}, fmt.Errorf("vacancies.details.mts: http %d", resp.StatusCode)
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
	if err != nil {
		return domain.VacancyDetails{}, fmt.Errorf("vacancies.details.mts.read: %w", err)
	}
	return decodeMTSDetail(body, listing)
}

type mtsDetailItem struct {
	Title       string `json:"title"`
	Description string `json:"description"`
}

type mtsDetailResp struct {
	Data struct {
		Description  string          `json:"description"`
		DetailText   string          `json:"detailText"`
		Info         string          `json:"info"`
		Tasks        []mtsDetailItem `json:"tasks"`
		Requirements []mtsDetailItem `json:"requirements"`
		Offers       []mtsDetailItem `json:"offers"`
	} `json:"data"`
}

func decodeMTSDetail(body []byte, listing domain.Vacancy) (domain.VacancyDetails, error) {
	var r mtsDetailResp
	if err := json.Unmarshal(body, &r); err != nil {
		return domain.VacancyDetails{}, fmt.Errorf("vacancies.details.mts.decode: %w", err)
	}
	out := domain.VacancyDetails{Vacancy: listing}
	// Prefer detailText (rich HTML) over plain description; fall back to
	// description, then info.
	descPick := firstNonEmpty(r.Data.DetailText, r.Data.Description, r.Data.Info)
	if descPick != "" {
		out.DescriptionHTML = SanitizeHTML(descPick)
	}
	out.Duties = pickItemTitles(r.Data.Tasks)
	out.Requirements = pickItemTitles(r.Data.Requirements)
	out.Conditions = pickItemTitles(r.Data.Offers)
	return out, nil
}

func pickItemTitles(items []mtsDetailItem) []string {
	out := make([]string, 0, len(items))
	for _, it := range items {
		t := strings.TrimSpace(it.Title)
		if t == "" {
			t = strings.TrimSpace(it.Description)
		}
		if t != "" {
			out = append(out, t)
		}
	}
	if len(out) == 0 {
		return nil
	}
	return out
}

func firstNonEmpty(xs ...string) string {
	for _, x := range xs {
		if strings.TrimSpace(x) != "" {
			return x
		}
	}
	return ""
}

var _ cacheLayer.DetailFetcher = (*MTSDetailFetcher)(nil)
