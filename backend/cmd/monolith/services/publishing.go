// Package services — Phase C-4 «Publish to web» для hone_notes.
//
// Owns:
//   - POST /api/v1/notes/{id}/publish        — owner toggles to public
//   - POST /api/v1/notes/{id}/unpublish      — owner toggles back to private
//   - GET  /api/v1/notes/{id}/publish-status — owner fetches current state
//   - GET  /p/{slug}                         — public HTML view (root mount,
//     no auth)
//
// Markdown→HTML render: github.com/gomarkdown/markdown с CommonExtensions.
// HTML passthrough OFF — вредный markdown'ом подсунутый <script> escape'нут.
//
// /p/{slug} — самодостаточный HTML с inline CSS, OG meta, strict CSP.
// Без JS, без внешних CDN.
package services

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"html"
	"log/slog"
	"net/http"
	"os"
	"strings"
	"time"

	sharedMw "druz9/shared/pkg/middleware"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/gomarkdown/markdown"
	mdhtml "github.com/gomarkdown/markdown/html"
	"github.com/gomarkdown/markdown/parser"
)

// NewPublishing wires the publish-to-web module.
func NewPublishing(d Deps) *Module {
	h := &publishingHandler{pool: d.Pool, log: d.Log}
	return &Module{
		MountREST: func(r chi.Router) {
			r.Post("/notes/{id}/publish", h.publish)
			r.Post("/notes/{id}/unpublish", h.unpublish)
			r.Get("/notes/{id}/publish-status", h.status)
			// Bulk meta — фронт читает на mount списка чтобы рисовать
			// lock-icons / publish-индикаторы в sidebar без N+1
			// per-row hover-fetch'ей. Возвращает только flags, не body —
			// для encrypted notes это безопасно (server'у разрешено
			// видеть факт шифрования, не сам plaintext).
			r.Get("/notes/meta", h.bulkMeta)
		},
		MountRoot: func(r chi.Router) {
			r.Get("/p/{slug}", h.publicView)
		},
	}
}

type publishingHandler struct {
	pool *pgxpool.Pool
	log  *slog.Logger
}

// ─── Owner-only operations ────────────────────────────────────────────────

type publishResponse struct {
	Slug        string    `json:"slug"`
	URL         string    `json:"url"`
	PublishedAt time.Time `json:"publishedAt"`
}

func (h *publishingHandler) publish(w http.ResponseWriter, r *http.Request) {
	uid, ok := sharedMw.UserIDFromContext(r.Context())
	if !ok {
		writePubJSONError(w, http.StatusUnauthorized, "unauthenticated", "")
		return
	}
	noteID, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writePubJSONError(w, http.StatusBadRequest, "bad_id", "")
		return
	}

	// Idempotent: если уже опубликовано — отдаём существующий slug.
	var (
		existingSlug *string
		existingAt   *time.Time
		encrypted    bool
	)
	err = h.pool.QueryRow(r.Context(),
		`SELECT public_slug, published_at, encrypted FROM hone_notes
		  WHERE id=$1 AND user_id=$2`,
		noteID, uid,
	).Scan(&existingSlug, &existingAt, &encrypted)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			writePubJSONError(w, http.StatusNotFound, "not_found", "")
			return
		}
		h.serverError(w, r, "publish.lookup", err, uid)
		return
	}
	if encrypted {
		// Phase C-7: encrypted note нельзя publish (server не имеет
		// plaintext'а чтобы render'нуть HTML). UI должен disable
		// «Publish to web» в three-dots для encrypted notes.
		writePubJSONError(w, http.StatusConflict, "encrypted_cannot_publish",
			"This note is encrypted (Private Vault). Decrypt before publishing.")
		return
	}
	if existingSlug != nil && existingAt != nil {
		writePubJSON(w, http.StatusOK, publishResponse{
			Slug:        *existingSlug,
			URL:         publicURL(*existingSlug),
			PublishedAt: *existingAt,
		})
		return
	}

	// Generate fresh slug — 12 hex chars (48 bits ≈ 280 trillion).
	// Retry-loop on UNIQUE collision (всё равно должно быть исчезающе
	// редко — production-grade defensive).
	var (
		newSlug string
		newAt   time.Time
	)
	const maxAttempts = 5
	for attempt := 0; attempt < maxAttempts; attempt++ {
		candidate, gerr := generateSlug()
		if gerr != nil {
			h.serverError(w, r, "publish.slug-gen", gerr, uid)
			return
		}
		err = h.pool.QueryRow(r.Context(),
			`UPDATE hone_notes
			    SET public_slug = $3, published_at = now()
			  WHERE id = $1 AND user_id = $2
			RETURNING public_slug, published_at`,
			noteID, uid, candidate,
		).Scan(&newSlug, &newAt)
		if err == nil {
			break
		}
		// Unique-violation = SQLSTATE 23505. Try again with new slug.
		if strings.Contains(err.Error(), "23505") {
			continue
		}
		h.serverError(w, r, "publish.update", err, uid)
		return
	}
	if newSlug == "" {
		h.serverError(w, r, "publish.slug-collision-exhausted",
			fmt.Errorf("%d attempts failed", maxAttempts), uid)
		return
	}
	writePubJSON(w, http.StatusOK, publishResponse{
		Slug:        newSlug,
		URL:         publicURL(newSlug),
		PublishedAt: newAt,
	})
}

func (h *publishingHandler) unpublish(w http.ResponseWriter, r *http.Request) {
	uid, ok := sharedMw.UserIDFromContext(r.Context())
	if !ok {
		writePubJSONError(w, http.StatusUnauthorized, "unauthenticated", "")
		return
	}
	noteID, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writePubJSONError(w, http.StatusBadRequest, "bad_id", "")
		return
	}
	cmd, err := h.pool.Exec(r.Context(),
		`UPDATE hone_notes
		    SET public_slug = NULL, published_at = NULL
		  WHERE id = $1 AND user_id = $2`,
		noteID, uid,
	)
	if err != nil {
		h.serverError(w, r, "unpublish", err, uid)
		return
	}
	if cmd.RowsAffected() == 0 {
		writePubJSONError(w, http.StatusNotFound, "not_found", "")
		return
	}
	writePubJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

type publishStatusResponse struct {
	Published bool       `json:"published"`
	Slug      string     `json:"slug,omitempty"`
	URL       string     `json:"url,omitempty"`
	At        *time.Time `json:"publishedAt,omitempty"`
}

func (h *publishingHandler) status(w http.ResponseWriter, r *http.Request) {
	uid, ok := sharedMw.UserIDFromContext(r.Context())
	if !ok {
		writePubJSONError(w, http.StatusUnauthorized, "unauthenticated", "")
		return
	}
	noteID, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writePubJSONError(w, http.StatusBadRequest, "bad_id", "")
		return
	}
	var (
		slugVal *string
		atVal   *time.Time
	)
	err = h.pool.QueryRow(r.Context(),
		`SELECT public_slug, published_at FROM hone_notes
		  WHERE id=$1 AND user_id=$2`,
		noteID, uid,
	).Scan(&slugVal, &atVal)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			writePubJSONError(w, http.StatusNotFound, "not_found", "")
			return
		}
		h.serverError(w, r, "status", err, uid)
		return
	}
	resp := publishStatusResponse{}
	if slugVal != nil && atVal != nil {
		resp.Published = true
		resp.Slug = *slugVal
		resp.URL = publicURL(*slugVal)
		resp.At = atVal
	}
	writePubJSON(w, http.StatusOK, resp)
}

// ─── Bulk meta ────────────────────────────────────────────────────────────

type noteMeta struct {
	ID        string `json:"id"`
	Encrypted bool   `json:"encrypted"`
	Published bool   `json:"published"`
}

type bulkMetaResponse struct {
	Notes []noteMeta `json:"notes"`
}

// bulkMeta возвращает per-note flags для всех активных (не archived)
// заметок юзера. archived из выдачи исключаем, потому что они не
// показываются в sidebar — flag для них бесполезен и тратит bytes.
func (h *publishingHandler) bulkMeta(w http.ResponseWriter, r *http.Request) {
	uid, ok := sharedMw.UserIDFromContext(r.Context())
	if !ok {
		writePubJSONError(w, http.StatusUnauthorized, "unauthenticated", "")
		return
	}
	rows, err := h.pool.Query(r.Context(),
		`SELECT id, encrypted, (public_slug IS NOT NULL AND published_at IS NOT NULL) AS published
		   FROM hone_notes
		  WHERE user_id = $1 AND archived_at IS NULL`,
		uid,
	)
	if err != nil {
		h.serverError(w, r, "bulkMeta.query", err, uid)
		return
	}
	defer rows.Close()
	resp := bulkMetaResponse{Notes: make([]noteMeta, 0, 32)}
	for rows.Next() {
		var m noteMeta
		if err := rows.Scan(&m.ID, &m.Encrypted, &m.Published); err != nil {
			h.serverError(w, r, "bulkMeta.scan", err, uid)
			return
		}
		resp.Notes = append(resp.Notes, m)
	}
	if err := rows.Err(); err != nil {
		h.serverError(w, r, "bulkMeta.rows", err, uid)
		return
	}
	writePubJSON(w, http.StatusOK, resp)
}

// ─── Public view ──────────────────────────────────────────────────────────

func (h *publishingHandler) publicView(w http.ResponseWriter, r *http.Request) {
	slug := chi.URLParam(r, "slug")
	if slug == "" {
		http.NotFound(w, r)
		return
	}
	var (
		title     string
		bodyMD    string
		updatedAt time.Time
	)
	err := h.pool.QueryRow(r.Context(),
		`SELECT title, body_md, updated_at FROM hone_notes
		  WHERE public_slug = $1 AND published_at IS NOT NULL
		    AND archived_at IS NULL`,
		slug,
	).Scan(&title, &bodyMD, &updatedAt)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			renderNotFound(w)
			return
		}
		h.log.ErrorContext(r.Context(), "publishing.publicView",
			slog.Any("err", err), slog.String("slug", slug))
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}

	// 5-минутный edge-cache: бот-краулеры, refresh, share-preview не
	// дёргают БД на каждый hit. Свежий body после edit'а появится
	// максимум через 5 минут на public странице.
	w.Header().Set("Cache-Control", "public, max-age=300")
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	// Strict CSP — only inline styles (мы их сами шлём), никакого JS,
	// никаких внешних ресурсов кроме картинок (data: + https:).
	w.Header().Set("Content-Security-Policy",
		"default-src 'none'; style-src 'unsafe-inline'; img-src data: https:; base-uri 'none';")
	_, _ = w.Write([]byte(renderPublicHTML(title, bodyMD, updatedAt)))
}

// ─── Helpers ──────────────────────────────────────────────────────────────

// generateSlug — 12 hex chars (48 bits) crypto/rand.
func generateSlug() (string, error) {
	var b [6]byte
	if _, err := rand.Read(b[:]); err != nil {
		return "", fmt.Errorf("publishing.generateSlug: %w", err)
	}
	return hex.EncodeToString(b[:]), nil
}

// publicURL — абсолютный URL для public-страницы. DRUZ9_PUBLIC_URL
// env override'ит default (для dev-хоста).
func publicURL(slug string) string {
	base := strings.TrimRight(envOr("DRUZ9_PUBLIC_URL", "https://druz9.online"), "/")
	return base + "/p/" + slug
}

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

// renderPublicHTML — server-side render Markdown → HTML с обвязкой:
// title в <h1>, дата + Hone-link в footer, OG-meta для preview-ботов.
func renderPublicHTML(title, bodyMD string, updatedAt time.Time) string {
	if title == "" {
		title = "Untitled"
	}
	mdParser := parser.NewWithExtensions(parser.CommonExtensions | parser.AutoHeadingIDs)
	htmlRenderer := mdhtml.NewRenderer(mdhtml.RendererOptions{
		Flags: mdhtml.CommonFlags &^ mdhtml.UseXHTML,
	})
	bodyHTML := markdown.Render(mdParser.Parse([]byte(bodyMD)), htmlRenderer)

	titleEsc := html.EscapeString(title)
	descEsc := html.EscapeString(snippet(bodyMD, 160))

	var b strings.Builder
	b.WriteString(`<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>`)
	b.WriteString(titleEsc)
	b.WriteString(` — Hone</title>
<meta name="description" content="`)
	b.WriteString(descEsc)
	b.WriteString(`">
<meta property="og:title" content="`)
	b.WriteString(titleEsc)
	b.WriteString(`">
<meta property="og:description" content="`)
	b.WriteString(descEsc)
	b.WriteString(`">
<meta property="og:type" content="article">
<meta property="article:modified_time" content="`)
	b.WriteString(updatedAt.UTC().Format(time.RFC3339))
	b.WriteString(`">
<style>` + publicCSS + `</style>
</head><body>
<main class="wrap">
<article>
<h1 class="title">`)
	b.WriteString(titleEsc)
	b.WriteString(`</h1>
<div class="content">`)
	b.Write(bodyHTML)
	b.WriteString(`</div>
<footer class="meta">Last updated `)
	b.WriteString(html.EscapeString(updatedAt.UTC().Format("January 2, 2006")))
	b.WriteString(` · published with <a href="https://druz9.online" class="brand">Hone</a></footer>
</article>
</main>
</body></html>`)
	return b.String()
}

func renderNotFound(w http.ResponseWriter) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.WriteHeader(http.StatusNotFound)
	_, _ = w.Write([]byte(`<!doctype html><meta charset="utf-8">
<title>Not found — Hone</title>
<style>` + publicCSS + `</style>
<main class="wrap"><article>
<h1 class="title">Not found</h1>
<p class="content">This note isn't published, or its link has been revoked.</p>
<footer class="meta"><a href="https://druz9.online" class="brand">Hone</a></footer>
</article></main>`))
}

func snippet(md string, n int) string {
	s := strings.TrimSpace(md)
	if len(s) <= n {
		return s
	}
	cut := s[:n]
	if i := strings.LastIndexByte(cut, ' '); i > n/2 {
		cut = cut[:i]
	}
	return cut + "…"
}

// publicCSS — самодостаточный «чистый Notion-like reader». Inline в
// HTML, без внешних шрифтов (system-stack), strict-CSP friendly.
const publicCSS = `
:root {
  --ink:#0e0f12; --ink-60:#5a5e69; --ink-40:#9499a3; --ink-20:#d4d7dd;
  --bg:#fafafa; --card:#fff;
}
@media (prefers-color-scheme: dark) {
  :root { --ink:#f0f1f3; --ink-60:#a0a4ae; --ink-40:#6a6e78; --ink-20:#2a2c30;
          --bg:#0c0d0f; --card:#141518; }
}
* { box-sizing: border-box; margin: 0; }
html, body { background: var(--bg); color: var(--ink);
  font-family: -apple-system, BlinkMacSystemFont, "Inter", system-ui, sans-serif;
  font-size: 16px; line-height: 1.65; -webkit-font-smoothing: antialiased; }
.wrap { max-width: 720px; margin: 0 auto; padding: 80px 28px 64px; }
.title { font-size: 36px; font-weight: 600; letter-spacing: -0.02em; margin-bottom: 28px; }
.content { font-size: 16.5px; line-height: 1.75; color: var(--ink); }
.content h1, .content h2, .content h3 { margin: 1.6em 0 .6em; font-weight: 600; letter-spacing: -0.01em; }
.content h1 { font-size: 26px; }
.content h2 { font-size: 21px; }
.content h3 { font-size: 17px; }
.content p { margin: 0 0 1em; }
.content a { color: inherit; text-decoration: underline; text-decoration-color: var(--ink-40); text-underline-offset: 3px; }
.content a:hover { text-decoration-color: var(--ink); }
.content ul, .content ol { margin: 0 0 1em 1.4em; }
.content li { margin: .35em 0; }
.content code { font: 13.5px ui-monospace, SFMono-Regular, Menlo, monospace;
  padding: .15em .35em; background: var(--card); border: 1px solid var(--ink-20); border-radius: 4px; }
.content pre { background: var(--card); border: 1px solid var(--ink-20); border-radius: 8px;
  padding: 14px 16px; overflow-x: auto; margin: 1em 0; }
.content pre code { padding: 0; background: none; border: none; font-size: 13px; }
.content blockquote { border-left: 3px solid var(--ink-20); padding-left: 16px; color: var(--ink-60); margin: 1em 0; }
.content hr { border: none; border-top: 1px solid var(--ink-20); margin: 2em 0; }
.content img { max-width: 100%; height: auto; border-radius: 6px; margin: 1em 0; }
.content table { border-collapse: collapse; width: 100%; margin: 1em 0; font-size: 14px; }
.content th, .content td { border: 1px solid var(--ink-20); padding: 8px 12px; text-align: left; }
.content th { background: var(--card); font-weight: 600; }
.meta { margin-top: 56px; padding-top: 20px; border-top: 1px solid var(--ink-20);
  font-size: 13px; color: var(--ink-40); }
.brand { color: var(--ink-60); text-decoration: none; }
.brand:hover { color: var(--ink); }
`

// ─── JSON write helpers ───────────────────────────────────────────────────

func writePubJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}

func writePubJSONError(w http.ResponseWriter, status int, code, message string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_, _ = fmt.Fprintf(w, `{"error":{"code":%q,"message":%q}}`, code, message)
}

func (h *publishingHandler) serverError(w http.ResponseWriter, r *http.Request, where string, err error, uid uuid.UUID) {
	if errors.Is(err, context.Canceled) {
		return
	}
	h.log.ErrorContext(r.Context(), "publishing.handler",
		slog.String("where", where),
		slog.String("user_id", uid.String()),
		slog.Any("err", err))
	writePubJSONError(w, http.StatusInternalServerError, "internal", "")
}
