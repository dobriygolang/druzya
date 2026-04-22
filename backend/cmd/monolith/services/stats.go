// Package services — stats wiring.
//
// Provides three small public REST endpoints used by the marketing /
// onboarding pages on the frontend:
//
//	GET /api/v1/stats/public          — platform headline counters
//	GET /api/v1/languages             — supported language picker (with
//	                                    deterministic synthetic player counts)
//	GET /api/v1/onboarding/preview-kata — fixed "Two Sum" preview used in the
//	                                    onboarding step 3 mock
//
// All three are public (bypass bearer auth — see router.go) and own no
// proto schema; they're plain chi handlers. The Module attaches via
// MountREST and is registered in bootstrap.go alongside the proto-driven
// modules.
package services

import (
	"encoding/json"
	"hash/crc32"
	"log/slog"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// NewStats builds the stats Module. It needs the shared pgx pool to count
// users; everything else is hard-coded synthetic data (per the task — the
// architectural wiring matters more than the data source right now).
func NewStats(d Deps) *Module {
	h := &statsHandler{pool: d.Pool, log: d.Log}
	return &Module{
		MountREST: func(r chi.Router) {
			r.Get("/stats/public", h.publicStats)
			r.Get("/languages", h.languages)
			r.Get("/onboarding/preview-kata", h.previewKata)
		},
	}
}

type statsHandler struct {
	pool *pgxpool.Pool
	log  *slog.Logger
}

// ── /api/v1/stats/public ──────────────────────────────────────────────────

type publicStatsResponse struct {
	UsersCount   int `json:"users_count"`
	ActiveToday  int `json:"active_today"`
	MatchesTotal int `json:"matches_total"`
}

func (h *statsHandler) publicStats(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	resp := publicStatsResponse{}

	// users
	if h.pool != nil {
		var n int
		row := h.pool.QueryRow(ctx, `SELECT count(*)::int FROM users`)
		if err := row.Scan(&n); err != nil {
			h.log.WarnContext(ctx, "stats.publicStats: count users", slog.Any("err", err))
		} else {
			resp.UsersCount = n
		}

		// active today: users updated in last 24h (cheap proxy until we add
		// a sessions/activity table)
		var active int
		row = h.pool.QueryRow(ctx,
			`SELECT count(*)::int FROM users WHERE updated_at >= now() - interval '24 hours'`)
		if err := row.Scan(&active); err != nil {
			h.log.WarnContext(ctx, "stats.publicStats: count active", slog.Any("err", err))
		} else {
			resp.ActiveToday = active
		}

		// matches total — arena_matches if it exists; absorb any error to
		// keep the endpoint resilient (table may be absent in fresh
		// environments).
		var matches int
		row = h.pool.QueryRow(ctx, `SELECT count(*)::int FROM arena_matches`)
		if err := row.Scan(&matches); err != nil {
			// table missing or other error — leave zero, do not fail the
			// whole response.
			resp.MatchesTotal = 0
		} else {
			resp.MatchesTotal = matches
		}
	}

	writeJSON(w, http.StatusOK, resp)
}

// ── /api/v1/languages ─────────────────────────────────────────────────────

type languageItem struct {
	Slug          string `json:"slug"`
	Name          string `json:"name"`
	Symbol        string `json:"symbol"`
	Color         string `json:"color"`
	TextColor     string `json:"text_color,omitempty"`
	PlayersActive int    `json:"players_active"`
	KataCount     int    `json:"kata_count"`
}

// canonical language list — mirrors what the onboarding step 2 used to
// hard-code. Keep in sync with the frontend Lang type.
var supportedLanguages = []languageItem{
	{Slug: "go", Name: "Go", Symbol: "Go", Color: "#22D3EE"},
	{Slug: "python", Name: "Python", Symbol: "Py", Color: "#582CFF"},
	{Slug: "java", Name: "Java", Symbol: "Jv", Color: "#F472B6"},
	{Slug: "javascript", Name: "JavaScript", Symbol: "JS", Color: "#FBBF24", TextColor: "#0A0A0F"},
	{Slug: "typescript", Name: "TypeScript", Symbol: "TS", Color: "#22D3EE"},
	{Slug: "cpp", Name: "C++", Symbol: "C++", Color: "#2D1B4D"},
	{Slug: "rust", Name: "Rust", Symbol: "Rs", Color: "#EF4444"},
	{Slug: "kotlin", Name: "Kotlin", Symbol: "Kt", Color: "#FBBF24", TextColor: "#0A0A0F"},
	{Slug: "swift", Name: "Swift", Symbol: "Sw", Color: "#F472B6"},
	{Slug: "sql", Name: "SQL", Symbol: "SQL", Color: "#10B981"},
	{Slug: "csharp", Name: "C#", Symbol: "C#", Color: "#6D43FF"},
	{Slug: "ruby", Name: "Ruby", Symbol: "Rb", Color: "#EF4444"},
	{Slug: "php", Name: "PHP", Symbol: "PHP", Color: "#6D43FF"},
}

func (h *statsHandler) languages(w http.ResponseWriter, r *http.Request) {
	out := make([]languageItem, 0, len(supportedLanguages))
	for _, l := range supportedLanguages {
		// deterministic synthetic counters — same slug ⇒ same value across
		// requests. We do not pretend to count real players yet.
		sum := crc32.ChecksumIEEE([]byte(l.Slug))
		l.PlayersActive = int(sum%5000) + 100
		l.KataCount = int(sum%50) + 5
		out = append(out, l)
	}
	w.Header().Set("Cache-Control", "public, max-age=300")
	writeJSON(w, http.StatusOK, struct {
		Items []languageItem `json:"items"`
	}{Items: out})
}

// ── /api/v1/onboarding/preview-kata ───────────────────────────────────────

type previewKataResponse struct {
	Slug        string   `json:"slug"`
	Title       string   `json:"title"`
	Tags        []string `json:"tags"`
	Difficulty  string   `json:"difficulty"`
	Description string   `json:"description"`
	StarterCode string   `json:"starter_code"`
	TestsTotal  int      `json:"tests_total"`
	TestsPassed int      `json:"tests_passed"`
}

func (h *statsHandler) previewKata(w http.ResponseWriter, r *http.Request) {
	resp := previewKataResponse{
		Slug:       "two-sum",
		Title:      "Two Sum",
		Tags:       []string{"Easy", "Hash Map", "Array"},
		Difficulty: "easy",
		Description: "Given an array of integers `nums` and an integer `target`, " +
			"return indices of the two numbers such that they add up to target. " +
			"You may assume that each input has exactly one solution.",
		StarterCode: "func twoSum(nums []int, target int) []int {\n" +
			"  m := map[int]int{}\n" +
			"  for i, v := range nums {\n" +
			"    if j, ok := m[target-v]; ok {\n" +
			"      return []int{j, i}\n" +
			"    }\n" +
			"    m[v] = i\n" +
			"  }\n" +
			"  return nil\n" +
			"}\n",
		TestsTotal:  3,
		TestsPassed: 0,
	}
	w.Header().Set("Cache-Control", "public, max-age=3600")
	writeJSON(w, http.StatusOK, resp)
}

// ── tiny helpers ──────────────────────────────────────────────────────────

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}
