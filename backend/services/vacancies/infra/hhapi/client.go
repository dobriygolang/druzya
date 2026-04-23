// Package hhapi is a minimal client for the public hh.ru vacancy search API.
//
// Endpoint: https://api.hh.ru/vacancies?text=...&area=113&per_page=100
//   - area=113 = Россия. Override via WithArea for region-specific runs.
//   - per_page max 100.
//   - No auth required for public listings; respect 30k req/day soft limit
//     and User-Agent politeness rule (the docs explicitly require it).
//
// We deliberately keep this client lean — only the fields we actually persist
// are decoded; everything else stays in raw_json for later re-mining.
//
// Lives in its own sub-package so the per-source parsers under
// vacancies/infra/parsers can import it without creating a circular
// dependency on vacancies/infra (which itself imports parsers via the
// registry in the wiring layer).
package hhapi

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

// BaseURL is the production endpoint. Override via WithBaseURL in tests.
const BaseURL = "https://api.hh.ru"

// UserAgent is the polite identifier the spec requires.
const UserAgent = "druz9/1.0 (+https://druz9.dev/contact)"

// Client wraps net/http for hh.ru's REST.
type Client struct {
	baseURL    string
	httpClient *http.Client
	userAgent  string
	area       int
	perPage    int
	textQuery  string
}

// New returns a default-configured client. 15s timeout per spec.
func New() *Client {
	return &Client{
		baseURL:    BaseURL,
		httpClient: &http.Client{Timeout: 15 * time.Second},
		userAgent:  UserAgent,
		area:       113,
		perPage:    100,
		textQuery:  "developer",
	}
}

// WithBaseURL overrides the API base — used by httptest tests.
func (c *Client) WithBaseURL(u string) *Client { c.baseURL = u; return c }

// WithUserAgent overrides the UA header.
func (c *Client) WithUserAgent(ua string) *Client { c.userAgent = ua; return c }

// WithArea sets the region. 113 is Russia.
func (c *Client) WithArea(a int) *Client { c.area = a; return c }

// WithText sets the search query.
func (c *Client) WithText(t string) *Client { c.textQuery = t; return c }

// SearchPage is the trimmed list response shape.
type SearchPage struct {
	Items   []VacancyShort `json:"items"`
	Page    int            `json:"page"`
	Pages   int            `json:"pages"`
	PerPage int            `json:"per_page"`
	Found   int            `json:"found"`
}

// VacancyShort is the search-result shape.
type VacancyShort struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	URL         string `json:"alternate_url"`
	PublishedAt string `json:"published_at"`
	Snippet     struct {
		Requirement    string `json:"requirement"`
		Responsibility string `json:"responsibility"`
	} `json:"snippet"`
	Salary *struct {
		From     int    `json:"from"`
		To       int    `json:"to"`
		Currency string `json:"currency"`
	} `json:"salary"`
	Area struct {
		Name string `json:"name"`
	} `json:"area"`
	Employer struct {
		Name string `json:"name"`
	} `json:"employer"`
	Schedule *struct {
		Name string `json:"name"`
	} `json:"schedule"`
	Experience *struct {
		Name string `json:"name"`
	} `json:"experience"`
	KeySkills []struct {
		Name string `json:"name"`
	} `json:"key_skills"`
}

// VacancyFull is what /vacancies/{id} returns. We embed VacancyShort to share
// the fields and add Description.
type VacancyFull struct {
	VacancyShort
	Description string `json:"description"`
}

// Short returns the embedded short representation — handy for sharing the
// converter in the parser.
func (v VacancyFull) Short() VacancyShort { return v.VacancyShort }

// SearchPageAt fetches one page of /vacancies. Returns the items + total
// page count.
func (c *Client) SearchPage(ctx context.Context, page int) ([]VacancyShort, int, error) {
	q := url.Values{}
	if c.textQuery != "" {
		q.Set("text", c.textQuery)
	}
	q.Set("area", strconv.Itoa(c.area))
	q.Set("per_page", strconv.Itoa(c.perPage))
	q.Set("page", strconv.Itoa(page))
	u := fmt.Sprintf("%s/vacancies?%s", strings.TrimRight(c.baseURL, "/"), q.Encode())
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return nil, 0, fmt.Errorf("hhapi.SearchPage.newreq: %w", err)
	}
	req.Header.Set("User-Agent", c.userAgent)
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, 0, fmt.Errorf("hhapi.SearchPage.do: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		raw, _ := io.ReadAll(io.LimitReader(resp.Body, 1024))
		return nil, 0, fmt.Errorf("hhapi.SearchPage: http %d: %s", resp.StatusCode, string(raw))
	}
	var p SearchPage
	if err := json.NewDecoder(resp.Body).Decode(&p); err != nil {
		return nil, 0, fmt.Errorf("hhapi.SearchPage.decode: %w", err)
	}
	return p.Items, p.Pages, nil
}

// GetVacancy fetches /vacancies/{id} and returns the parsed value plus the
// raw bytes (kept for vacancies.raw_json).
func (c *Client) GetVacancy(ctx context.Context, id string) (VacancyFull, []byte, error) {
	u := fmt.Sprintf("%s/vacancies/%s", strings.TrimRight(c.baseURL, "/"), url.PathEscape(id))
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return VacancyFull{}, nil, fmt.Errorf("hhapi.GetVacancy.newreq: %w", err)
	}
	req.Header.Set("User-Agent", c.userAgent)
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return VacancyFull{}, nil, fmt.Errorf("hhapi.GetVacancy.do: %w", err)
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if resp.StatusCode >= 400 {
		return VacancyFull{}, nil, fmt.Errorf("hhapi.GetVacancy: http %d: %s", resp.StatusCode, truncate(string(raw), 256))
	}
	var v VacancyFull
	if err := json.Unmarshal(raw, &v); err != nil {
		return VacancyFull{}, raw, fmt.Errorf("hhapi.GetVacancy.decode: %w", err)
	}
	return v, raw, nil
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + "…"
}
