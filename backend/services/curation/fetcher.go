// Package curation — Phase 3.5 best-effort URL→text fetcher.
//
// Использует разные стратегии в зависимости от URL:
//   - HTML: go-readability (content extraction)
//   - PDF: ledongthuc/pdf (first 5 pages)
//   - YouTube: timedtext API (no auth) для transcript
//   - GitHub blob/raw: README.md raw URL
//   - Fallback: <title> + meta-description + first 500 chars
//
// Total timeout 5s — exceeds → graceful empty (caller fallback'нет на
// user free-text input). Никогда не возвращает error — UI должен работать
// при сетевых сбоях fetcher'а; вместо error возвращаем пустой Result с
// reason'ом.
package curation

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"

	readability "github.com/go-shiori/go-readability"
	"github.com/ledongthuc/pdf"
)

// FetchResult — output fetcher'а.
type FetchResult struct {
	URL         string
	Title       string
	Author      string
	ExtractedAt time.Time
	// Body — plain text (whitespace-collapsed). LLM TaskExtractResourceContent
	// получит эту строку как input. Empty при fail.
	Body string
	// Strategy — какая стратегия сработала. "fallback" если ни одна.
	Strategy string
	// Error — non-fatal, для логов. nil если ok.
	Error error
}

// Fetcher — единая точка входа.
type Fetcher struct {
	HTTPClient *http.Client
	// MaxBytes — потолок размера body (10 MB по умолчанию).
	MaxBytes int64
}

// NewFetcher — конструктор с дефолтами.
func NewFetcher() *Fetcher {
	return &Fetcher{
		HTTPClient: &http.Client{
			Timeout: 5 * time.Second,
		},
		MaxBytes: 10 * 1024 * 1024,
	}
}

// Fetch выбирает стратегию по URL и возвращает FetchResult. Никогда не
// возвращает error из самой Fetch — все ошибки в Result.Error.
func (f *Fetcher) Fetch(ctx context.Context, rawURL string) FetchResult {
	res := FetchResult{URL: rawURL, ExtractedAt: time.Now().UTC()}
	u, err := url.Parse(rawURL)
	if err != nil || !u.IsAbs() || (u.Scheme != "http" && u.Scheme != "https") {
		res.Error = fmt.Errorf("invalid url: %v", err)
		res.Strategy = "invalid"
		return res
	}

	// Total budget — 5s.
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()

	host := strings.ToLower(u.Host)
	switch {
	case isYouTube(host):
		return f.fetchYouTube(ctx, u, res)
	case isGitHubBlob(host, u.Path):
		return f.fetchGitHubReadme(ctx, u, res)
	case strings.HasSuffix(strings.ToLower(u.Path), ".pdf"):
		return f.fetchPDF(ctx, rawURL, res)
	default:
		return f.fetchHTML(ctx, rawURL, res)
	}
}

func isYouTube(host string) bool {
	return host == "youtube.com" || host == "www.youtube.com" || host == "youtu.be" || host == "m.youtube.com"
}

func isGitHubBlob(host, path string) bool {
	return host == "github.com" && strings.Contains(path, "/blob/")
}

func (f *Fetcher) fetchHTML(ctx context.Context, rawURL string, res FetchResult) FetchResult {
	res.Strategy = "html"
	body, err := f.get(ctx, rawURL)
	if err != nil {
		res.Error = err
		return res
	}
	// readability требует io.Reader + parsedURL.
	parsed, _ := url.Parse(rawURL)
	article, err := readability.FromReader(bytes.NewReader(body), parsed)
	if err == nil && strings.TrimSpace(article.TextContent) != "" {
		res.Title = article.Title
		res.Author = article.Byline
		res.Body = collapseWhitespace(article.TextContent)
		return res
	}
	// Fallback: <title> + meta-description + first 500 chars body text.
	res.Strategy = "fallback"
	res.Title = extractTitle(body)
	desc := extractMetaDescription(body)
	plain := stripHTML(body)
	if len(plain) > 500 {
		plain = plain[:500]
	}
	res.Body = strings.TrimSpace(desc + "\n\n" + plain)
	if res.Body == "" {
		res.Error = fmt.Errorf("html fallback: empty body")
	}
	return res
}

func (f *Fetcher) fetchPDF(ctx context.Context, rawURL string, res FetchResult) FetchResult {
	res.Strategy = "pdf"
	body, err := f.get(ctx, rawURL)
	if err != nil {
		res.Error = err
		return res
	}
	r, err := pdf.NewReader(bytes.NewReader(body), int64(len(body)))
	if err != nil {
		res.Error = fmt.Errorf("pdf: %w", err)
		return res
	}
	pageMax := r.NumPage()
	if pageMax > 5 {
		pageMax = 5
	}
	var sb strings.Builder
	for i := 1; i <= pageMax; i++ {
		p := r.Page(i)
		if p.V.IsNull() {
			continue
		}
		txt, err := p.GetPlainText(nil)
		if err == nil {
			sb.WriteString(txt)
			sb.WriteString("\n")
		}
	}
	res.Body = collapseWhitespace(sb.String())
	if res.Body == "" {
		res.Error = fmt.Errorf("pdf: empty after extract")
	}
	return res
}

func (f *Fetcher) fetchYouTube(ctx context.Context, u *url.URL, res FetchResult) FetchResult {
	res.Strategy = "youtube"
	videoID := extractYouTubeID(u)
	if videoID == "" {
		res.Error = fmt.Errorf("youtube: video id not parsed")
		return res
	}
	// timedtext API — публичный, без auth. Возвращает XML с captions.
	tt := "https://video.google.com/timedtext?v=" + videoID + "&lang=en"
	body, err := f.get(ctx, tt)
	if err != nil || len(body) == 0 {
		// Try ru fallback.
		tt = "https://video.google.com/timedtext?v=" + videoID + "&lang=ru"
		body, err = f.get(ctx, tt)
		if err != nil || len(body) == 0 {
			res.Error = fmt.Errorf("youtube: no captions available")
			return res
		}
	}
	res.Body = collapseWhitespace(stripXML(body))
	res.Title = "youtube · " + videoID // лучшее у нас на free-tier — без oEmbed
	if res.Body == "" {
		res.Error = fmt.Errorf("youtube: empty captions")
	}
	return res
}

func (f *Fetcher) fetchGitHubReadme(ctx context.Context, u *url.URL, res FetchResult) FetchResult {
	res.Strategy = "github-readme"
	// /<owner>/<repo>/blob/<branch>/<path> → /<owner>/<repo>/<branch>/README.md
	parts := strings.Split(strings.TrimPrefix(u.Path, "/"), "/")
	if len(parts) < 4 {
		res.Error = fmt.Errorf("github: malformed blob path")
		return res
	}
	owner, repo, branch := parts[0], parts[1], parts[3]
	raw := "https://raw.githubusercontent.com/" + owner + "/" + repo + "/" + branch + "/README.md"
	body, err := f.get(ctx, raw)
	if err != nil {
		res.Error = err
		return res
	}
	res.Title = owner + "/" + repo
	res.Body = collapseWhitespace(string(body))
	if res.Body == "" {
		res.Error = fmt.Errorf("github: empty README")
	}
	return res
}

func (f *Fetcher) get(ctx context.Context, rawURL string) ([]byte, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, rawURL, nil)
	if err != nil {
		return nil, fmt.Errorf("curation.fetcher.get build req: %w", err)
	}
	req.Header.Set("User-Agent", "druz9-curation-fetcher/1.0")
	resp, err := f.HTTPClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("curation.fetcher.get http: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("curation.fetcher.get: status %d", resp.StatusCode)
	}
	limit := f.MaxBytes
	if limit <= 0 {
		limit = 10 * 1024 * 1024
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, limit))
	if err != nil {
		return nil, fmt.Errorf("curation.fetcher.get read: %w", err)
	}
	return body, nil
}

// ─── helpers ──────────────────────────────────────────────────────────────

var (
	whitespaceRe   = regexp.MustCompile(`\s+`)
	htmlTagRe      = regexp.MustCompile(`<[^>]+>`)
	titleRe        = regexp.MustCompile(`(?is)<title[^>]*>(.*?)</title>`)
	metaDescRe     = regexp.MustCompile(`(?is)<meta\s+[^>]*name=["']description["']\s+content=["']([^"']+)["']`)
	xmlTagRe       = regexp.MustCompile(`<[^>]+>`)
	youtubeWatchRe = regexp.MustCompile(`v=([\w-]{11})`)
	youtubeShortRe = regexp.MustCompile(`youtu\.be/([\w-]{11})`)
)

func collapseWhitespace(s string) string {
	return strings.TrimSpace(whitespaceRe.ReplaceAllString(s, " "))
}

func stripHTML(b []byte) string {
	return collapseWhitespace(htmlTagRe.ReplaceAllString(string(b), " "))
}

func stripXML(b []byte) string {
	return collapseWhitespace(xmlTagRe.ReplaceAllString(string(b), " "))
}

func extractTitle(b []byte) string {
	m := titleRe.FindSubmatch(b)
	if len(m) < 2 {
		return ""
	}
	return collapseWhitespace(string(m[1]))
}

func extractMetaDescription(b []byte) string {
	m := metaDescRe.FindSubmatch(b)
	if len(m) < 2 {
		return ""
	}
	return collapseWhitespace(string(m[1]))
}

func extractYouTubeID(u *url.URL) string {
	if u.Host == "youtu.be" {
		return strings.TrimPrefix(u.Path, "/")
	}
	if v := u.Query().Get("v"); v != "" {
		return v
	}
	if m := youtubeWatchRe.FindStringSubmatch(u.RawQuery); len(m) > 1 {
		return m[1]
	}
	if m := youtubeShortRe.FindStringSubmatch(u.String()); len(m) > 1 {
		return m[1]
	}
	return ""
}

// DomainOf — host из URL, lowercased. Используется domain_reputation.
func DomainOf(rawURL string) string {
	u, err := url.Parse(rawURL)
	if err != nil || u == nil {
		return ""
	}
	return strings.ToLower(u.Host)
}
