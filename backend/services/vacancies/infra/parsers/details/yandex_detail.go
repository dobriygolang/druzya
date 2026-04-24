// yandex_detail.go — yandex.ru/jobs/api/publications/{id} detail fetcher.
//
// Verified live 2026-04-23. Shape (top-level, no envelope):
//
//	{
//	  "id": 15322,
//	  "description": "<p>…</p>",
//	  "key_qualifications": "<ul><li>…</li></ul>",
//	  "additional_requirements": "<p>…</p>",
//	  "duties": "<ul><li>…</li></ul>",
//	  "conditions": "<ul><li>…</li></ul>",
//	  "our_team": "<p>…</p>",
//	  "tech_stack": "<ul><li>Go</li><li>K8s</li></ul>",
//	  ...
//	}
//
// All seven rich fields are HTML strings (or empty). Listing identity
// (publication numeric id) is what we already store as ExternalID.
package details

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/url"

	"druz9/vacancies/domain"

	cacheLayer "druz9/vacancies/infra/cache"
)

const yandexDetailBaseURL = "https://yandex.ru/jobs/api/publications"

// YandexDetailFetcher implements cache.DetailFetcher.
type YandexDetailFetcher struct {
	baseURL string
	http    *http.Client
	log     *slog.Logger
}

// NewYandex builds the default Yandex detail fetcher.
func NewYandex(log *slog.Logger) *YandexDetailFetcher {
	if log == nil {
		panic("vacancies.details.NewYandex: logger is required (anti-fallback policy)")
	}
	return &YandexDetailFetcher{baseURL: yandexDetailBaseURL, http: defaultClient(), log: log}
}

// WithBaseURL is the test seam.
func (y *YandexDetailFetcher) WithBaseURL(u string) *YandexDetailFetcher { y.baseURL = u; return y }

// Source implements DetailFetcher.
func (y *YandexDetailFetcher) Source() domain.Source { return domain.SourceYandex }

// FetchDetails calls the publications-by-id endpoint.
func (y *YandexDetailFetcher) FetchDetails(ctx context.Context, externalID string, listing domain.Vacancy) (domain.VacancyDetails, error) {
	u := y.baseURL + "/" + url.PathEscape(externalID)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return domain.VacancyDetails{}, fmt.Errorf("vacancies.details.yandex.newreq: %w", err)
	}
	req.Header.Set("User-Agent", scraperUA)
	req.Header.Set("Accept", "application/json")
	resp, err := y.http.Do(req)
	if err != nil {
		return domain.VacancyDetails{}, fmt.Errorf("vacancies.details.yandex.do: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		return domain.VacancyDetails{}, fmt.Errorf("vacancies.details.yandex: http %d", resp.StatusCode)
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
	if err != nil {
		return domain.VacancyDetails{}, fmt.Errorf("vacancies.details.yandex.read: %w", err)
	}
	return decodeYandexDetail(body, listing)
}

type yandexDetailResp struct {
	Description            string `json:"description"`
	KeyQualifications      string `json:"key_qualifications"`
	AdditionalRequirements string `json:"additional_requirements"`
	Duties                 string `json:"duties"`
	Conditions             string `json:"conditions"`
	OurTeam                string `json:"our_team"`
	TechStack              string `json:"tech_stack"`
}

func decodeYandexDetail(body []byte, listing domain.Vacancy) (domain.VacancyDetails, error) {
	var r yandexDetailResp
	if err := json.Unmarshal(body, &r); err != nil {
		return domain.VacancyDetails{}, fmt.Errorf("vacancies.details.yandex.decode: %w", err)
	}
	out := domain.VacancyDetails{Vacancy: listing}
	out.DescriptionHTML = SanitizeHTML(r.Description)
	out.Duties = PlainTextLines(r.Duties)
	out.Requirements = mergeLines(PlainTextLines(r.KeyQualifications), PlainTextLines(r.AdditionalRequirements))
	out.Conditions = PlainTextLines(r.Conditions)
	if s := SanitizeHTML(r.OurTeam); s != "" {
		out.OurTeam = s
	}
	out.TechStack = PlainTextLines(r.TechStack)
	return out, nil
}

func mergeLines(xs ...[]string) []string {
	out := []string{}
	for _, x := range xs {
		out = append(out, x...)
	}
	return out
}

// compile-time check
var _ cacheLayer.DetailFetcher = (*YandexDetailFetcher)(nil)
