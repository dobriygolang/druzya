package infra

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"druz9/documents/domain"

	readability "github.com/go-shiori/go-readability"
)

// URLFetcher turns a public URL into ingest-ready plaintext.
//
// The pipeline is deliberately tight:
//   1. HTTP GET with bounded timeout + redirect budget.
//   2. Reject non-HTML responses (we don't follow a bare PDF URL yet —
//      users pasting a PDF link should download + upload manually).
//   3. Pipe the body through go-readability so main content wins over
//      navbars/footers/comments. Plaintext output feeds straight into
//      the existing Upload pipeline as mime=text/plain.
//
// Not in scope (deferred):
//   - fetching pages behind auth cookies;
//   - JS-rendered pages (SPA) — we see pre-render HTML only. For
//     interview prep this covers 90%+ of real JD sources (LinkedIn
//     public, HH.ru, Habr Career, Greenhouse boards).
type URLFetcher struct {
	client *http.Client
	// MaxBytes caps the raw HTML size we pull down. Readability is
	// O(n) on DOM size; 5MB of HTML is ~50k DOM nodes which is the
	// practical upper end for a real-world page. Anything larger is
	// almost certainly an anti-scrape wall or a file the user meant
	// to download.
	MaxBytes int64
	// UserAgent identifies the fetcher to origin servers. Required
	// by some (CloudFront, Akamai) to avoid 403 on bare /bot/ UAs.
	UserAgent string
}

// NewURLFetcher returns a fetcher tuned for document ingestion:
//   - 15s total budget (connect + read);
//   - up to 5 redirects;
//   - 5MB body cap;
//   - identifying UA.
func NewURLFetcher() *URLFetcher {
	return &URLFetcher{
		client: &http.Client{
			Timeout: 15 * time.Second,
			CheckRedirect: func(req *http.Request, via []*http.Request) error {
				if len(via) >= 5 {
					return errors.New("too many redirects (>5)")
				}
				return nil
			},
		},
		MaxBytes:  5 * 1024 * 1024,
		UserAgent: "Druz9Bot/1.0 (+https://druz9.online; document-ingestion)",
	}
}

// FetchResult carries everything the Upload use-case needs to materialize
// a Document row: a filename (derived from page <title>), the plaintext
// content, and the canonical source URL (after redirects).
type FetchResult struct {
	Filename  string
	Content   []byte
	SourceURL string
}

// Fetch retrieves the URL and extracts main content. Wraps all error
// surfaces as one of:
//   - domain.ErrUnsupportedMIME — non-HTML response (image/pdf/…);
//   - domain.ErrTooLarge        — body exceeded MaxBytes;
//   - domain.ErrEmptyContent    — readability returned nothing usable;
//   - other errors — transport / parse failures, surfaced as-is.
func (f *URLFetcher) Fetch(ctx context.Context, rawURL string) (FetchResult, error) {
	parsed, err := url.Parse(rawURL)
	if err != nil {
		return FetchResult{}, fmt.Errorf("invalid url: %w", err)
	}
	if parsed.Scheme != "http" && parsed.Scheme != "https" {
		return FetchResult{}, fmt.Errorf("unsupported scheme %q (want http/https)", parsed.Scheme)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, rawURL, nil)
	if err != nil {
		return FetchResult{}, err
	}
	req.Header.Set("User-Agent", f.UserAgent)
	// Signal that we want text. Some servers (HH, LinkedIn) serve
	// different MIME / different markup depending on Accept; readability
	// handles both paths.
	req.Header.Set("Accept", "text/html,application/xhtml+xml;q=0.9,*/*;q=0.1")
	req.Header.Set("Accept-Language", "ru,en;q=0.5")

	resp, err := f.client.Do(req)
	if err != nil {
		return FetchResult{}, fmt.Errorf("http get: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return FetchResult{}, fmt.Errorf("http status %d", resp.StatusCode)
	}

	ct := strings.ToLower(strings.TrimSpace(resp.Header.Get("Content-Type")))
	// Tolerate missing Content-Type but reject clear non-HTML types.
	if ct != "" && !isHTMLContentType(ct) {
		return FetchResult{}, fmt.Errorf("%w: server returned %s (fetch only supports HTML)", domain.ErrUnsupportedMIME, ct)
	}

	// LimitReader + 1 extra byte tells us "overflowed the cap" when we
	// later see len==MaxBytes+1; a clean len<=MaxBytes means we got all
	// the bytes.
	body, err := io.ReadAll(io.LimitReader(resp.Body, f.MaxBytes+1))
	if err != nil {
		return FetchResult{}, fmt.Errorf("read body: %w", err)
	}
	if int64(len(body)) > f.MaxBytes {
		return FetchResult{}, domain.ErrTooLarge
	}

	article, err := readability.FromReader(strings.NewReader(string(body)), parsed)
	if err != nil {
		return FetchResult{}, fmt.Errorf("readability parse: %w", err)
	}

	// TextContent is the readable prose; Title is the <title> element
	// (or OG/twitter title fallback). Both can be empty on pages that
	// resist extraction (SPA shells) — treat empty as ErrEmptyContent
	// so the caller can surface "couldn't extract" to the user.
	text := strings.TrimSpace(article.TextContent)
	if text == "" {
		return FetchResult{}, domain.ErrEmptyContent
	}

	filename := strings.TrimSpace(article.Title)
	if filename == "" {
		filename = deriveFilenameFromURL(parsed)
	}
	// Postgres documents.filename is TEXT but we keep it human-
	// readable; 200 chars is the comfortable cap for UI display and
	// keeps the stored row compact.
	if runes := []rune(filename); len(runes) > 200 {
		filename = string(runes[:200]) + "…"
	}

	return FetchResult{
		Filename:  filename,
		Content:   []byte(text),
		SourceURL: resp.Request.URL.String(), // canonical post-redirect URL
	}, nil
}

// isHTMLContentType returns true for any Content-Type that readability
// can reasonably parse. We're permissive: xhtml, "text/html; charset=…",
// and application/xhtml+xml all count.
func isHTMLContentType(ct string) bool {
	return strings.HasPrefix(ct, "text/html") ||
		strings.HasPrefix(ct, "application/xhtml+xml") ||
		strings.HasPrefix(ct, "application/xhtml") ||
		strings.HasPrefix(ct, "text/plain") // some servers misreport; plaintext is fine as input
}

// deriveFilenameFromURL builds a fallback filename when readability
// found no <title>. Pattern: "host/path" with query-string and trailing
// slashes stripped. Good enough to distinguish sibling URLs in the UI.
func deriveFilenameFromURL(u *url.URL) string {
	base := u.Host + u.Path
	base = strings.TrimSuffix(base, "/")
	if base == "" {
		base = u.String()
	}
	return base
}
