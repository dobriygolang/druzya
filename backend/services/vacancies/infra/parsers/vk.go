// vk.go — careers.vk.com parser.
//
// VK careers ships a Next.js-style SSR blob like Yandex/Ozon, so we re-use
// the shared extractNextData + findJobsArray helpers. Same degrade-to-stub
// policy on schema surprise.
package parsers

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"druz9/vacancies/domain"
)

const vkBaseURL = "https://careers.vk.com/"

// VKParser scrapes careers.vk.com.
type VKParser struct {
	baseURL    string
	httpClient *http.Client
	log        *slog.Logger
}

// NewVK builds the default parser.
func NewVK(log *slog.Logger) *VKParser {
	if log == nil {
		log = slog.New(slog.NewTextHandler(noopWriter{}, nil))
	}
	return &VKParser{
		baseURL:    vkBaseURL,
		httpClient: &http.Client{Timeout: 15 * time.Second},
		log:        log,
	}
}

// WithBaseURL is a test override.
func (p *VKParser) WithBaseURL(u string) *VKParser { p.baseURL = u; return p }

// Source implements domain.Parser.
func (p *VKParser) Source() domain.Source { return domain.SourceVK }

// Fetch — SSR-blob extraction; degrade to stub on failure.
func (p *VKParser) Fetch(ctx context.Context) ([]domain.Vacancy, error) {
	body, err := fetchHTML(ctx, p.httpClient, p.baseURL)
	if err != nil {
		return nil, err
	}
	blob, ok := extractNextData(body)
	if !ok {
		p.log.Warn("vacancies.parser.vk: __NEXT_DATA__ blob not found, returning []")
		return []domain.Vacancy{}, nil
	}
	out, err := decodeVKJobs(blob)
	if err != nil {
		p.log.Warn("vacancies.parser.vk: decode failed, returning []", slog.Any("err", err))
		return []domain.Vacancy{}, nil
	}
	p.log.Info("vacancies.parser.vk: fetched", slog.Int("count", len(out)))
	return out, nil
}

func decodeVKJobs(raw string) ([]domain.Vacancy, error) {
	var blob map[string]any
	if err := json.Unmarshal([]byte(raw), &blob); err != nil {
		return nil, fmt.Errorf("vk.decode.unmarshal: %w", err)
	}
	jobs := findJobsArray(blob)
	out := make([]domain.Vacancy, 0, len(jobs))
	for _, j := range jobs {
		jm, ok := j.(map[string]any)
		if !ok {
			continue
		}
		out = append(out, vkJobToVacancy(jm))
	}
	return out, nil
}

func vkJobToVacancy(j map[string]any) domain.Vacancy {
	get := func(k string) string {
		if v, ok := j[k].(string); ok {
			return v
		}
		return ""
	}
	v := domain.Vacancy{
		Source:      domain.SourceVK,
		ExternalID:  get("id"),
		Title:       get("title"),
		Company:     "VK",
		Location:    get("city"),
		URL:         get("url"),
		Description: strings.TrimSpace(get("description") + "\n\n" + get("requirements") + "\n\n" + get("responsibilities")),
		FetchedAt:   time.Now().UTC(),
	}
	if v.ExternalID == "" {
		v.ExternalID = get("slug")
	}
	if v.URL == "" && v.ExternalID != "" {
		v.URL = fmt.Sprintf("https://careers.vk.com/jobs/%s/", v.ExternalID)
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
