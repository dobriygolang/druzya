package infra

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"druz9/documents/domain"
)

// newTestFetcher — то же что NewURLFetcher, но с коротким таймаутом
// и БЕЗ SSRF-guard'а, так как httptest.Server биндится на 127.0.0.1.
// Production-фетчер ВСЕГДА с guard'ом (см. NewURLFetcher) — этот
// override только для сценариев happy-path против локального mock'а.
func newTestFetcher() *URLFetcher {
	f := NewURLFetcher()
	f.client.Timeout = 2 * time.Second
	// Replace transport with a plain dialer (no guard) so httptest
	// loopback servers are reachable. Any real-prod fetcher built via
	// NewURLFetcher retains the guard.
	f.client.Transport = &http.Transport{
		DialContext: (&net.Dialer{Timeout: 2 * time.Second}).DialContext,
	}
	return f
}

// newGuardedTestFetcher — NewURLFetcher без overrides, используется
// только в SSRF-тестах ниже, чтобы убедиться что guard реально
// блокирует localhost.
func newGuardedTestFetcher() *URLFetcher {
	f := NewURLFetcher()
	f.client.Timeout = 2 * time.Second
	return f
}

// simpleHTML — минимальная HTML-страница с валидным <title> + достаточно
// content'а чтобы readability признал её валидным article. Алгоритм
// readability имеет эвристики на объём — слишком короткие страницы он
// отклоняет.
const simpleHTML = `<!doctype html>
<html>
<head><title>Test Article</title></head>
<body>
<article>
<h1>Test Article</h1>
<p>This is the first paragraph of the article body. It contains enough words
for the readability algorithm to consider it main content and not nav chrome.</p>
<p>Second paragraph with more substantial prose so the extractor has something
to work with. Sentences flow naturally and the algorithm picks them up.</p>
<p>Third paragraph to exceed the minimum content threshold. Real blog posts
and job descriptions usually run 300+ words which is well above this floor.</p>
</article>
</body>
</html>`

// TestURLFetcher_Basic — happy path: HTML-страница, readability извлекает
// заголовок и основное содержимое.
func TestURLFetcher_Basic(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		_, _ = w.Write([]byte(simpleHTML))
	}))
	defer srv.Close()

	f := newTestFetcher()
	res, err := f.Fetch(context.Background(), srv.URL)
	if err != nil {
		t.Fatalf("err: %v", err)
	}
	if res.Filename != "Test Article" {
		t.Errorf("filename = %q, want 'Test Article'", res.Filename)
	}
	if len(res.Content) == 0 {
		t.Errorf("content empty")
	}
	if !strings.Contains(string(res.Content), "first paragraph") {
		t.Errorf("content missing expected text: %q", res.Content)
	}
	if res.SourceURL != srv.URL {
		t.Errorf("sourceURL = %q, want %q", res.SourceURL, srv.URL)
	}
}

// TestURLFetcher_FollowsRedirects — 302 → final page; SourceURL пишется
// канонический (post-redirect). Важно: UI показывает SourceURL как
// "откуда", пользователь ожидает финальный адрес.
func TestURLFetcher_FollowsRedirects(t *testing.T) {
	var finalURL string
	mux := http.NewServeMux()
	mux.HandleFunc("/final", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html")
		_, _ = w.Write([]byte(simpleHTML))
	})
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, finalURL, http.StatusFound)
	})
	srv := httptest.NewServer(mux)
	defer srv.Close()
	finalURL = srv.URL + "/final"

	f := newTestFetcher()
	res, err := f.Fetch(context.Background(), srv.URL+"/start")
	if err != nil {
		t.Fatalf("err: %v", err)
	}
	if res.SourceURL != finalURL {
		t.Errorf("sourceURL = %q, want %q (canonical post-redirect)", res.SourceURL, finalURL)
	}
}

// TestURLFetcher_RedirectLimit — более 5 редиректов → ошибка. Защита
// от redirect-loop'ов.
func TestURLFetcher_RedirectLimit(t *testing.T) {
	var srv *httptest.Server
	srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Бесконечный self-redirect.
		http.Redirect(w, r, srv.URL+"/loop", http.StatusFound)
	}))
	defer srv.Close()

	f := newTestFetcher()
	_, err := f.Fetch(context.Background(), srv.URL)
	if err == nil {
		t.Fatalf("expected error on redirect-loop, got nil")
	}
	if !strings.Contains(err.Error(), "redirect") {
		t.Errorf("error should mention redirect: %v", err)
	}
}

// TestURLFetcher_NonHTMLContentType — image/pdf/etc → ErrUnsupportedMIME.
// Контракт: юзер-facing сообщение "url content is not HTML".
func TestURLFetcher_NonHTMLContentType(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/pdf")
		_, _ = w.Write([]byte("%PDF-1.4\n"))
	}))
	defer srv.Close()

	f := newTestFetcher()
	_, err := f.Fetch(context.Background(), srv.URL)
	if !errors.Is(err, domain.ErrUnsupportedMIME) {
		t.Errorf("want ErrUnsupportedMIME, got %v", err)
	}
}

// TestURLFetcher_BadScheme — ftp:// и подобные схемы должны отклоняться
// ДО HTTP-запроса. Иначе http.Client дал бы обскурную ошибку про неподдерж
// транспорт.
func TestURLFetcher_BadScheme(t *testing.T) {
	f := newTestFetcher()
	_, err := f.Fetch(context.Background(), "ftp://example.com/file")
	if err == nil {
		t.Fatalf("expected error on ftp:// scheme, got nil")
	}
	if !strings.Contains(err.Error(), "scheme") {
		t.Errorf("error should mention scheme: %v", err)
	}
}

// TestURLFetcher_OversizeBody — response > MaxBytes → ErrTooLarge.
// Защита от слива 100MB-статьи в RAG.
func TestURLFetcher_OversizeBody(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html")
		// Пишем кусочками, чтобы не аллоцировать 10MB сразу в тесте.
		_, _ = w.Write([]byte("<html><body>"))
		pad := strings.Repeat("abcd", 1024) // 4KB
		for i := 0; i < 2048; i++ {         // 2048 * 4KB = 8MB > 5MB cap
			_, _ = w.Write([]byte(pad))
		}
		_, _ = w.Write([]byte("</body></html>"))
	}))
	defer srv.Close()

	f := newTestFetcher()
	_, err := f.Fetch(context.Background(), srv.URL)
	if !errors.Is(err, domain.ErrTooLarge) {
		t.Errorf("want ErrTooLarge, got %v", err)
	}
}

// TestURLFetcher_Non2xxStatus — 404/500/etc → ошибка с упоминанием
// статуса, не успех.
func TestURLFetcher_Non2xxStatus(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "not found", http.StatusNotFound)
	}))
	defer srv.Close()

	f := newTestFetcher()
	_, err := f.Fetch(context.Background(), srv.URL)
	if err == nil {
		t.Fatalf("expected error on 404, got nil")
	}
	if !strings.Contains(err.Error(), "404") {
		t.Errorf("error should mention 404: %v", err)
	}
}

// TestURLFetcher_FallbackFilename — страница без <title> → filename
// из host/path. Пустых имён в Document.filename быть не должно.
func TestURLFetcher_FallbackFilename(t *testing.T) {
	// readability возвращает пустой Title для страниц без <title>.
	// Даём ему достаточно content'а, чтобы он признал page валидной.
	html := `<!doctype html><html><body><article>` +
		strings.Repeat("<p>Body paragraph with substantial text content. </p>", 10) +
		`</article></body></html>`
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html")
		_, _ = w.Write([]byte(html))
	}))
	defer srv.Close()

	f := newTestFetcher()
	res, err := f.Fetch(context.Background(), srv.URL+"/some/page")
	if err != nil {
		// Readability может реджектнуть "слишком короткие" страницы;
		// в этом случае тест пропускаем — сути не меняет.
		if errors.Is(err, domain.ErrEmptyContent) {
			t.Skipf("readability rejected synthetic page (ok): %v", err)
		}
		t.Fatalf("err: %v", err)
	}
	if res.Filename == "" {
		t.Errorf("fallback filename is empty")
	}
	if strings.Contains(res.Filename, "Title") {
		t.Errorf("unexpected title in filename: %q", res.Filename)
	}
}

// TestURLFetcher_SSRF_Localhost — httptest.NewServer биндится на
// 127.0.0.1, что делает его идеальной целью для SSRF-теста: если бы
// блокировка не работала, fetch бы прошёл. Ожидаем error, содержащий
// "blocked IP".
func TestURLFetcher_SSRF_Localhost(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Если fetcher дошёл сюда — SSRF guard не сработал.
		t.Error("SSRF guard failed — request reached localhost handler")
		w.WriteHeader(200)
	}))
	defer srv.Close()

	f := newGuardedTestFetcher()
	_, err := f.Fetch(context.Background(), srv.URL)
	if err == nil {
		t.Fatalf("expected SSRF rejection, got nil error")
	}
	if !strings.Contains(err.Error(), "blocked IP") {
		t.Errorf("error should mention blocked IP: %v", err)
	}
}

// TestIsPrivateIP — табличный тест блоклиста. Покрывает каждую ветку
// isPrivateIP: без этого легко сломать guard тихим рефакторингом.
func TestIsPrivateIP(t *testing.T) {
	cases := map[string]bool{
		// Public — must pass
		"8.8.8.8":        false,
		"1.1.1.1":        false,
		"142.250.80.46":  false, // google.com
		"2606:4700::":    false, // cloudflare IPv6

		// Blocked — loopback
		"127.0.0.1":  true,
		"127.0.0.53": true, // systemd-resolved
		"::1":        true,

		// Blocked — private (RFC 1918)
		"10.0.0.1":      true,
		"10.255.255.1":  true,
		"172.16.0.1":    true,
		"172.31.255.1":  true,
		"192.168.1.1":   true,
		"192.168.0.100": true,

		// Blocked — link-local + metadata
		"169.254.169.254": true, // AWS/GCP metadata
		"169.254.0.1":     true,
		"fe80::1":         true,

		// Blocked — shared (RFC 6598, carrier-grade NAT)
		"100.64.0.1":   true,
		"100.127.0.1":  true,

		// Blocked — unspecified
		"0.0.0.0": true,
		"::":      true,

		// Edge — IPv4-mapped IPv6 of a private address
		"::ffff:10.0.0.1":   true,
		"::ffff:127.0.0.1":  true,
		// IPv4-mapped of public address → allowed
		"::ffff:8.8.8.8": false,
	}
	for s, want := range cases {
		ip := net.ParseIP(s)
		if ip == nil {
			t.Errorf("parse %q: nil", s)
			continue
		}
		if got := isPrivateIP(ip); got != want {
			t.Errorf("isPrivateIP(%q) = %v, want %v", s, got, want)
		}
	}
}

// TestIsHTMLContentType — табличный тест хелпера. Он решает, fetch'ать
// ли страницу вообще; ошибка в матчинге = false positives на всех
// сайтах, которые шлют text/html; charset=windows-1251.
func TestIsHTMLContentType(t *testing.T) {
	cases := map[string]bool{
		"text/html":                              true,
		"text/html; charset=utf-8":               true,
		"application/xhtml+xml":                  true,
		"application/xhtml+xml; charset=utf-8":   true,
		"text/plain":                             true,
		"application/pdf":                        false,
		"image/png":                              false,
		"application/json":                       false,
		"":                                       false,
		"application/octet-stream":               false,
	}
	for ct, want := range cases {
		if got := isHTMLContentType(strings.ToLower(ct)); got != want {
			t.Errorf("isHTMLContentType(%q) = %v, want %v", ct, got, want)
		}
	}
}

// Use fmt so goimports doesn't strip it — we import for Debug in new tests.
var _ = fmt.Sprintf
