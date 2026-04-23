// hh.go — wraps the HH.ru REST client into a domain.Parser.
//
// HH is the only source we have a proper public JSON API for, so this is the
// "happy path" implementation. The other parsers degrade to HTML scraping or
// stubs depending on what each careers site exposes.
package parsers

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/url"
	"strings"
	"time"

	"druz9/vacancies/domain"
	"druz9/vacancies/infra/hhapi"
)

// HHParser implements domain.Parser + domain.SingleFetcher for hh.ru.
type HHParser struct {
	client *hhapi.Client
	log    *slog.Logger
	// maxPages caps how many search pages we crawl per Fetch. 1 page = 100
	// vacancies. Default 3 is gentle on the 30k/day budget; can be bumped
	// once we have more sources to share the budget across.
	maxPages int
}

// NewHH constructs the default HH parser. log is required (anti-fallback policy).
func NewHH(log *slog.Logger) *HHParser {
	if log == nil {
		panic("vacancies.parsers.NewHH: logger is required (anti-fallback policy: no silent noop loggers)")
	}
	return &HHParser{client: hhapi.New(), log: log, maxPages: 3}
}

// WithBaseURL is a test helper.
func (p *HHParser) WithBaseURL(u string) *HHParser {
	p.client = p.client.WithBaseURL(u)
	return p
}

// WithMaxPages overrides the per-fetch crawl depth.
func (p *HHParser) WithMaxPages(n int) *HHParser {
	if n > 0 {
		p.maxPages = n
	}
	return p
}

// Source implements domain.Parser.
func (p *HHParser) Source() domain.Source { return domain.SourceHH }

// Fetch crawls up to maxPages of search results and resolves each into a
// full domain.Vacancy. We deliberately do NOT call /vacancies/{id} for every
// hit — that'd burn the 30k/day budget. The snippet + key_skills returned by
// search are usually enough; the LLM extractor compensates downstream.
func (p *HHParser) Fetch(ctx context.Context) ([]domain.Vacancy, error) {
	out := []domain.Vacancy{}
	for page := 0; page < p.maxPages; page++ {
		items, totalPages, err := p.client.SearchPage(ctx, page)
		if err != nil {
			return out, fmt.Errorf("vacancies.parser.hh.Fetch.page=%d: %w", page, err)
		}
		for _, it := range items {
			out = append(out, hhItemToDomain(it))
		}
		if page+1 >= totalPages {
			break
		}
	}
	p.log.Info("vacancies.parser.hh: fetched", slog.Int("count", len(out)))
	return out, nil
}

// FetchOne implements domain.SingleFetcher — used by the /analyze endpoint
// when the user pastes a hh.ru/vacancy/<id> link.
func (p *HHParser) FetchOne(ctx context.Context, rawURL string) (domain.Vacancy, error) {
	id, err := extractHHIDFromURL(rawURL)
	if err != nil {
		return domain.Vacancy{}, err
	}
	full, raw, err := p.client.GetVacancy(ctx, id)
	if err != nil {
		return domain.Vacancy{}, fmt.Errorf("vacancies.parser.hh.FetchOne: %w", err)
	}
	v := hhItemToDomain(full.Short())
	v.Description = stripHTML(full.Description)
	v.RawJSON = raw
	return v, nil
}

// extractHHIDFromURL accepts both /vacancy/12345 and /vacancy/12345?... forms
// across hh.ru / hh.kz / etc.
func extractHHIDFromURL(raw string) (string, error) {
	u, err := url.Parse(raw)
	if err != nil {
		return "", fmt.Errorf("vacancies.parser.hh.extractID: %w", err)
	}
	parts := strings.Split(strings.Trim(u.Path, "/"), "/")
	for i, seg := range parts {
		if seg == "vacancy" && i+1 < len(parts) {
			return strings.TrimSpace(parts[i+1]), nil
		}
	}
	return "", fmt.Errorf("vacancies.parser.hh.extractID: no /vacancy/<id> in %q", raw)
}

// hhItemToDomain converts the search-result shape into a domain.Vacancy.
// Description is the snippet (requirement + responsibility); FetchOne
// overrides with the full HTML-stripped text.
func hhItemToDomain(it hhapi.VacancyShort) domain.Vacancy {
	v := domain.Vacancy{
		Source:     domain.SourceHH,
		ExternalID: it.ID,
		URL:        it.URL,
		Title:      it.Name,
		Company:    it.Employer.Name,
		Location:   it.Area.Name,
	}
	desc := strings.TrimSpace(it.Snippet.Requirement) + "\n\n" + strings.TrimSpace(it.Snippet.Responsibility)
	v.Description = strings.TrimSpace(desc)
	if it.Salary != nil {
		v.SalaryMin = it.Salary.From
		v.SalaryMax = it.Salary.To
		v.Currency = it.Salary.Currency
	}
	if it.Schedule != nil {
		v.EmploymentType = it.Schedule.Name
	}
	if it.Experience != nil {
		v.ExperienceLevel = it.Experience.Name
	}
	for _, k := range it.KeySkills {
		v.RawSkills = append(v.RawSkills, k.Name)
	}
	v.NormalizedSkills = domain.NormalizeSkills(v.RawSkills)
	if it.PublishedAt != "" {
		// HH returns timestamps with a numeric tz offset that lacks the colon
		// (`+0300`), which time.RFC3339 does not accept. Try the canonical
		// layout first, then fall back to the HH-flavoured one.
		layouts := []string{time.RFC3339, "2006-01-02T15:04:05-0700"}
		for _, layout := range layouts {
			if t, err := time.Parse(layout, it.PublishedAt); err == nil {
				v.PostedAt = &t
				break
			}
		}
	}
	v.FetchedAt = time.Now().UTC()
	if v.RawJSON == nil {
		// Re-marshal the search shape so we still have something archived.
		if b, err := json.Marshal(it); err == nil {
			v.RawJSON = b
		}
	}
	return v
}

// stripHTML is a stupidly simple tag stripper for the HH description body.
// Good enough for the LLM downstream — the model handles residual whitespace.
func stripHTML(s string) string {
	var b strings.Builder
	in := false
	for _, r := range s {
		switch r {
		case '<':
			in = true
		case '>':
			in = false
			b.WriteByte(' ')
		default:
			if !in {
				b.WriteRune(r)
			}
		}
	}
	return strings.Join(strings.Fields(b.String()), " ")
}
