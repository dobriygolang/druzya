// wb_detail.go — career.rwb.ru/crm-api/api/v1/pub/vacancies/{id} fetcher.
//
// Verified live 2026-04-23. Shape:
//
//	{"data":{
//	  "id":12345,
//	  "description":"…",
//	  "requirements_arr":["…","…"],
//	  "duties_arr":["…"],
//	  "conditions_arr":["…"]
//	}}
//
// description is plain text; the *_arr fields are arrays of strings (each
// entry is one bullet, no HTML).
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

const wbDetailBaseURL = "https://career.rwb.ru/crm-api/api/v1/pub/vacancies"

// WBDetailFetcher implements cache.DetailFetcher.
type WBDetailFetcher struct {
	baseURL string
	http    *http.Client
	log     *slog.Logger
}

// NewWB builds the WB detail fetcher.
func NewWB(log *slog.Logger) *WBDetailFetcher {
	if log == nil {
		panic("vacancies.details.NewWB: logger is required (anti-fallback policy)")
	}
	return &WBDetailFetcher{baseURL: wbDetailBaseURL, http: defaultClient(), log: log}
}

// WithBaseURL is the test seam.
func (w *WBDetailFetcher) WithBaseURL(u string) *WBDetailFetcher { w.baseURL = u; return w }

// Source implements DetailFetcher.
func (w *WBDetailFetcher) Source() domain.Source { return domain.SourceWildberries }

// FetchDetails calls the per-vacancy endpoint.
func (w *WBDetailFetcher) FetchDetails(ctx context.Context, externalID string, listing domain.Vacancy) (domain.VacancyDetails, error) {
	u := w.baseURL + "/" + url.PathEscape(externalID)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return domain.VacancyDetails{}, fmt.Errorf("vacancies.details.wb.newreq: %w", err)
	}
	req.Header.Set("User-Agent", scraperUA)
	req.Header.Set("Accept", "application/json")
	resp, err := w.http.Do(req)
	if err != nil {
		return domain.VacancyDetails{}, fmt.Errorf("vacancies.details.wb.do: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		return domain.VacancyDetails{}, fmt.Errorf("vacancies.details.wb: http %d", resp.StatusCode)
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
	if err != nil {
		return domain.VacancyDetails{}, fmt.Errorf("vacancies.details.wb.read: %w", err)
	}
	return decodeWBDetail(body, listing)
}

type wbDetailResp struct {
	Data struct {
		Description     string   `json:"description"`
		RequirementsArr []string `json:"requirements_arr"`
		DutiesArr       []string `json:"duties_arr"`
		ConditionsArr   []string `json:"conditions_arr"`
	} `json:"data"`
}

func decodeWBDetail(body []byte, listing domain.Vacancy) (domain.VacancyDetails, error) {
	var r wbDetailResp
	if err := json.Unmarshal(body, &r); err != nil {
		return domain.VacancyDetails{}, fmt.Errorf("vacancies.details.wb.decode: %w", err)
	}
	out := domain.VacancyDetails{Vacancy: listing}
	if d := strings.TrimSpace(r.Data.Description); d != "" {
		out.DescriptionHTML = SanitizeHTML(d)
	}
	out.Requirements = trimNonEmpty(r.Data.RequirementsArr)
	out.Duties = trimNonEmpty(r.Data.DutiesArr)
	out.Conditions = trimNonEmpty(r.Data.ConditionsArr)
	return out, nil
}

func trimNonEmpty(in []string) []string {
	out := make([]string, 0, len(in))
	for _, s := range in {
		s = strings.TrimSpace(s)
		if s != "" {
			out = append(out, s)
		}
	}
	if len(out) == 0 {
		return nil
	}
	return out
}

var _ cacheLayer.DetailFetcher = (*WBDetailFetcher)(nil)
