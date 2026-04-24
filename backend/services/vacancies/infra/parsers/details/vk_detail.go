// vk_detail.go — team.vk.company/vacancy/{id}/ HTML scrape.
//
// Verified live 2026-04-23: VK has no JSON detail endpoint, the page is
// server-rendered HTML. The description block lives in:
//
//	<div class="…article…" itemprop="description">
//	  <h3>Требования</h3>
//	  <ul><li>…</li></ul>
//	  <h3>Обязанности</h3>
//	  <ul><li>…</li></ul>
//	  …
//	</div>
//
// We parse with golang.org/x/net/html (NOT regex) and serialize the inner
// markup as a sanitised HTML fragment for the frontend.
package details

import (
	"context"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"strings"

	"druz9/vacancies/domain"
	cacheLayer "druz9/vacancies/infra/cache"

	"golang.org/x/net/html"
)

const vkDetailBaseURL = "https://team.vk.company/vacancy"

// VKDetailFetcher implements cache.DetailFetcher.
type VKDetailFetcher struct {
	baseURL string
	http    *http.Client
	log     *slog.Logger
}

// NewVK builds the VK HTML detail fetcher.
func NewVK(log *slog.Logger) *VKDetailFetcher {
	if log == nil {
		panic("vacancies.details.NewVK: logger is required (anti-fallback policy)")
	}
	return &VKDetailFetcher{baseURL: vkDetailBaseURL, http: defaultClient(), log: log}
}

// WithBaseURL is the test seam.
func (v *VKDetailFetcher) WithBaseURL(u string) *VKDetailFetcher { v.baseURL = u; return v }

// Source implements DetailFetcher.
func (v *VKDetailFetcher) Source() domain.Source { return domain.SourceVK }

// FetchDetails downloads and scrapes the per-vacancy HTML page.
func (v *VKDetailFetcher) FetchDetails(ctx context.Context, externalID string, listing domain.Vacancy) (domain.VacancyDetails, error) {
	u := v.baseURL + "/" + url.PathEscape(externalID) + "/"
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return domain.VacancyDetails{}, fmt.Errorf("vacancies.details.vk.newreq: %w", err)
	}
	req.Header.Set("User-Agent", scraperUA)
	req.Header.Set("Accept", "text/html,application/xhtml+xml")
	resp, err := v.http.Do(req)
	if err != nil {
		return domain.VacancyDetails{}, fmt.Errorf("vacancies.details.vk.do: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		return domain.VacancyDetails{}, fmt.Errorf("vacancies.details.vk: http %d", resp.StatusCode)
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, 8<<20))
	if err != nil {
		return domain.VacancyDetails{}, fmt.Errorf("vacancies.details.vk.read: %w", err)
	}
	return decodeVKDetail(body, listing)
}

func decodeVKDetail(body []byte, listing domain.Vacancy) (domain.VacancyDetails, error) {
	doc, err := html.Parse(strings.NewReader(string(body)))
	if err != nil {
		return domain.VacancyDetails{}, fmt.Errorf("vacancies.details.vk.parse: %w", err)
	}
	node := findDescriptionNode(doc)
	if node == nil {
		return domain.VacancyDetails{}, fmt.Errorf("vacancies.details.vk: description block not found (selector drift?)")
	}
	// Serialize inner HTML — preserve <ul>/<h3>/<p>, sanitise on the way.
	var buf strings.Builder
	for c := node.FirstChild; c != nil; c = c.NextSibling {
		_ = html.Render(&buf, c)
	}
	out := domain.VacancyDetails{Vacancy: listing}
	out.DescriptionHTML = SanitizeHTML(buf.String())
	return out, nil
}

// findDescriptionNode walks the parsed DOM looking for a <div> whose class
// attribute contains "article" AND whose itemprop attribute equals
// "description". This matches the live shape verified 2026-04-23.
func findDescriptionNode(n *html.Node) *html.Node {
	if n.Type == html.ElementNode && strings.EqualFold(n.Data, "div") {
		var cls, itemprop string
		for _, a := range n.Attr {
			switch strings.ToLower(a.Key) {
			case "class":
				cls = a.Val
			case "itemprop":
				itemprop = a.Val
			}
		}
		if itemprop == "description" && strings.Contains(cls, "article") {
			return n
		}
	}
	for c := n.FirstChild; c != nil; c = c.NextSibling {
		if r := findDescriptionNode(c); r != nil {
			return r
		}
	}
	return nil
}

var _ cacheLayer.DetailFetcher = (*VKDetailFetcher)(nil)
