package infra

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"strings"
	"syscall"
	"time"

	"druz9/documents/domain"

	readability "github.com/go-shiori/go-readability"
)

// ErrBlockedIP is what the SSRF guard returns when a fetch resolves
// to an address in the blocklist. Wrapped in an *url.Error by the
// http.Client; callers match via errors.Is.
var ErrBlockedIP = errors.New("ssrf: blocked IP (private/loopback/link-local)")

// dialGuard returns a net.Dialer.Control function that rejects any
// outbound TCP connection whose resolved IP sits in a non-public
// range. The check runs AFTER DNS resolution (Go resolves the
// hostname before calling Control) so a malicious `evil.example.com`
// pointing at `169.254.169.254` gets blocked even though the string
// URL looks public.
//
// Blocklist covers:
//   - IPv4/IPv6 loopback (127/8, ::1)
//   - RFC1918 private (10/8, 172.16/12, 192.168/16) + unique local ULA (fc00::/7)
//   - link-local (169.254/16 — catches AWS/GCP metadata 169.254.169.254)
//   - unspecified (0.0.0.0, ::)
//   - multicast + broadcast
//
// We intentionally DO NOT allow per-install overrides. Admins with a
// genuine need for internal URL fetches should run a separate service;
// making the guard configurable is the #1 way SSRF blocklists fail.
func dialGuard(network, address string, _ syscall.RawConn) error {
	// address is "host:port" with host as an IP literal (Go resolves
	// hostnames before invoking Control). Strip the port.
	host, _, err := net.SplitHostPort(address)
	if err != nil {
		// Unparseable — fail closed; real traffic always has host:port.
		return fmt.Errorf("%w: bad address %q", ErrBlockedIP, address)
	}
	ip := net.ParseIP(host)
	if ip == nil {
		return fmt.Errorf("%w: host is not an IP literal: %q", ErrBlockedIP, host)
	}
	if isPrivateIP(ip) {
		return fmt.Errorf("%w: %s → %s", ErrBlockedIP, network, ip)
	}
	return nil
}

// isPrivateIP returns true for any address the SSRF guard should block.
// Go's net.IP helpers cover most; IsPrivate (Go 1.17+) matches RFC 1918
// + ULA. We add link-local + a safety check for IPv4-mapped IPv6
// (parse ::ffff:10.0.0.1 → 10.0.0.1; Go's To4() normalizes this).
func isPrivateIP(ip net.IP) bool {
	if ip == nil {
		return true
	}
	// Normalize v4-in-v6 so an attacker can't slip "::ffff:127.0.0.1"
	// past us by disguising as an IPv6 address.
	if v4 := ip.To4(); v4 != nil {
		ip = v4
	}
	switch {
	case ip.IsLoopback(),
		ip.IsPrivate(),
		ip.IsLinkLocalUnicast(),
		ip.IsLinkLocalMulticast(),
		ip.IsMulticast(),
		ip.IsUnspecified():
		return true
	}
	// Shared address space (RFC 6598) — 100.64.0.0/10. Go's IsPrivate
	// doesn't cover this; commonly used in carrier-grade NAT and
	// increasingly in cloud private networks.
	if v4 := ip.To4(); v4 != nil && v4[0] == 100 && v4[1] >= 64 && v4[1] <= 127 {
		return true
	}
	return false
}

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
//   - identifying UA;
//   - SSRF guard at the dial layer (rejects private/loopback/link-local).
func NewURLFetcher() *URLFetcher {
	// Custom transport with a dial guard. Every TCP connect —
	// including those via redirects — goes through Control, which
	// refuses any address in the private-net blocklist. http.Client
	// surfaces the dial error verbatim, so errors.Is(err, ErrBlockedIP)
	// works at the caller.
	dialer := &net.Dialer{
		Timeout:   5 * time.Second,
		KeepAlive: 30 * time.Second,
		Control:   dialGuard,
	}
	transport := &http.Transport{
		DialContext:           dialer.DialContext,
		MaxIdleConns:          10,
		IdleConnTimeout:       60 * time.Second,
		TLSHandshakeTimeout:   5 * time.Second,
		ExpectContinueTimeout: 1 * time.Second,
	}
	return &URLFetcher{
		client: &http.Client{
			Transport: transport,
			Timeout:   15 * time.Second,
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
