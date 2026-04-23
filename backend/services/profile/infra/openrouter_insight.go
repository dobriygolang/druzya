// openrouter_insight.go — Phase B of weekly killer-stats. Calls OpenRouter
// chat-completions to produce a 2-paragraph Russian "AI insight" for the
// /profile/me/report endpoint. Wraps the call in a 24 h Redis cache keyed by
// (user-id, weekISO) — LLM output for a finished week is stable, so the same
// page-reload cost is paid once per week per user.
//
// We deliberately re-implement the thin HTTP client here (rather than reusing
// vacancies/infra) to keep cross-domain coupling out: the two extractors will
// drift independently as their prompts evolve.
package infra

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"sort"
	"strings"
	"time"

	"druz9/shared/pkg/metrics"

	"github.com/google/uuid"
)

// InsightOpenRouterEndpoint is the OpenAI-compatible chat endpoint.
const InsightOpenRouterEndpoint = "https://openrouter.ai/api/v1/chat/completions"

// DefaultInsightModel is a higher-quality model than the vacancies extractor —
// the prompt asks for a coaching narrative in Russian, where chain-of-thought
// quality matters. Override via OPENROUTER_INSIGHT_MODEL.
const DefaultInsightModel = "anthropic/claude-sonnet-4"

// DefaultInsightCacheTTL — 24 h. The week's stats don't change once the week
// is over, so the LLM output is effectively stable; we still cap at 24 h to
// give late-arriving matches (timezone edge cases) a chance to refresh.
const DefaultInsightCacheTTL = 24 * time.Hour

// InsightPayload is the structured snapshot we feed the LLM. Build it in the
// app layer from the already-aggregated ReportView fields.
type InsightPayload struct {
	WeekISO           string         // e.g. "2026-W17"
	EloDelta          int            // sum of ELO changes for the week
	WinRateBySection  map[string]int // section name → win-rate %
	HoursStudied      float64        // derived from Activity.TimeMinutes / 60
	Streak            int            // current streak in days
	WeakestSection    string         // section name (lower-case slug); "" if none
	AchievementsCount int            // unlocked this week
}

// InsightClient is the OpenRouter-backed insight generator with Redis cache.
//
// Anti-fallback policy:
//   - Constructor with empty apiKey returns a working struct that emits an
//     empty insight on every call (no fake LLM output). A WARN is logged at
//     construction so misconfigured envs are loud.
//   - Real Redis Get failure propagates as error. Real HTTP failure or non-2xx
//     propagates as error. Caller (app/report.go) catches these and degrades
//     to "" + warn — insight is best-effort, doesn't block the report.
type InsightClient struct {
	apiKey   string
	endpoint string
	model    string
	http     *http.Client
	kv       KV
	cacheTTL time.Duration
	log      *slog.Logger

	// disabled — true when constructed with empty apiKey. Generate returns
	// ("", nil) immediately, skipping cache + HTTP entirely.
	disabled bool
}

// NewInsightClient constructs an insight generator.
//
//   - httpClient may be nil — a default 30 s-timeout client is used.
//   - apiKey == "" puts the client in disabled mode (Generate → "", nil).
//   - model == "" uses DefaultInsightModel.
//   - log is required (anti-fallback: no silent noop loggers).
func NewInsightClient(httpClient *http.Client, apiKey, model string, log *slog.Logger) *InsightClient {
	if log == nil {
		panic("profile.infra.NewInsightClient: logger is required (anti-fallback policy: no silent noop loggers)")
	}
	if httpClient == nil {
		httpClient = &http.Client{Timeout: 30 * time.Second}
	}
	if model == "" {
		model = DefaultInsightModel
	}
	c := &InsightClient{
		apiKey:   apiKey,
		endpoint: InsightOpenRouterEndpoint,
		model:    model,
		http:     httpClient,
		cacheTTL: DefaultInsightCacheTTL,
		log:      log,
	}
	if apiKey == "" {
		c.disabled = true
		log.Warn("profile.insight: OPENROUTER_API_KEY empty — insight generation disabled (Generate will return empty string)")
	}
	return c
}

// WithEndpoint overrides the URL — used by tests.
func (c *InsightClient) WithEndpoint(u string) *InsightClient { c.endpoint = u; return c }

// WithKV attaches a Redis KV for caching. Pass nil to disable caching.
func (c *InsightClient) WithKV(kv KV) *InsightClient { c.kv = kv; return c }

// WithCacheTTL overrides the cache TTL.
func (c *InsightClient) WithCacheTTL(ttl time.Duration) *InsightClient {
	if ttl > 0 {
		c.cacheTTL = ttl
	}
	return c
}

// Model returns the configured model id (used by the wirer to surface it in
// the frontend subtitle, e.g. "Сгенерировано <model>").
func (c *InsightClient) Model() string { return c.model }

// Disabled reports whether this client will short-circuit to "" on every call.
func (c *InsightClient) Disabled() bool { return c.disabled }

// insightCacheKey builds the Redis key for a (uid, weekISO) tuple.
func insightCacheKey(uid uuid.UUID, weekISO string) string {
	return fmt.Sprintf("profile:weekly:ai:%s:%s", uid.String(), weekISO)
}

type insMsg struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type insReq struct {
	Model       string   `json:"model"`
	Messages    []insMsg `json:"messages"`
	Temperature float64  `json:"temperature,omitempty"`
	MaxTokens   int      `json:"max_tokens,omitempty"`
}

type insResp struct {
	Choices []struct {
		Message struct {
			Content string `json:"content"`
		} `json:"message"`
	} `json:"choices"`
}

// insightSystemPrompt is the coaching instruction. Tuned for druz9 domain:
// the user is preparing for a Big-Tech (Yandex / Ozon / T-Bank / VK)
// техническое интервью, and the tone is a senior tech interviewer giving
// honest, calibrated feedback — not a generic "you're doing great" coach.
//
// Domain glossary the prompt may use freely:
//   - ELO         — рейтинг пользователя (по итогам PvP-матчей в /arena)
//   - streak      — серия дней подряд с активностью
//   - war         — командный матч в гильдии
//   - мок-собес   — практическое интервью с напарником / AI-ботом
//   - ката        — короткая задача-упражнение из /atlas
//   - atlas       — каталог задач druz9 с тегами и треками подготовки
//
// Format contract (validated implicitly by the frontend's split('\n\n')):
//   - EXACTLY two paragraphs separated by a single blank line ("\n\n")
//   - NO markdown headers, NO bullet lists, NO emoji
//   - Russian, ≤ 150 words total
//   - Paragraph 2 must name a concrete next-week plan: specific kata names
//     from /atlas (e.g. "Sliding Window Maximum", "Top K Frequent Elements",
//     "Two Sum", "Window Functions Drill"), а также чёткий time-block
//     ("3 ката × 25 мин по утрам, 4 дня").
const insightSystemPrompt = `Ты — senior tech-интервьюер из Big Tech (Яндекс / Ozon / T-Bank / VK), даёшь обратную связь пользователю druz9, который готовится к техническому интервью.

Тон: честный, собранный, без воды и без чрезмерной похвалы. Как будто ты разбираешь его неделю на 1:1. Если результаты слабые — скажи прямо, но конструктивно.

Доменный словарь (используй естественно): ELO, streak, war, мок-собес, ката, atlas.

ФОРМАТ ВЫВОДА — СТРОГО:
  - Ровно 2 параграфа на русском, разделённых пустой строкой ("\n\n").
  - Никаких заголовков, маркеров списка, эмодзи или markdown.
  - До 150 слов суммарно.
  - Параграф 1: честная оценка недели — что реально получилось, что просело. Опирайся на цифры из payload.
  - Параграф 2: ОДИН конкретный план на следующую неделю. Назови конкретные ката из /atlas (напр. "Sliding Window Maximum", "Top K Frequent Elements", "Window Functions Drill") и дай time-block ("3 ката × 25 мин по утрам, 4 дня"). Никаких общих "продолжай в том же духе".

Пример хорошо сформированного insight (формат и тон, не содержание):

Алгоритмы держатся на 80% win-rate, ELO +42 за неделю — стабильный прогресс на medium-уровне. Но SQL просел до 50% и ты не закрыл ни одной задачи на window functions — это будет первой проблемой на собесе в Ozon. Streak 5 дней — норм, но 6.5 часов учёбы за неделю мало для целей senior+.

На следующую неделю фокус — SQL window functions. План: 3 ката × 25 мин по утрам, 5 дней — "Window Functions Drill", "Running Total by Group", "Top-N per Category" из /atlas. В пятницу — мок-собес по SQL, чтобы закрепить под давлением. Алгоритмы держи на поддержке: 1 medium в день, не больше.`

// renderUserPrompt formats the payload deterministically — section keys are
// sorted so two equal payloads render identically (cache hits stay valid).
func renderUserPrompt(p InsightPayload) string {
	var sb strings.Builder
	sb.WriteString("Given this week's stats:\n")
	fmt.Fprintf(&sb, "  - ELO delta: %+d\n", p.EloDelta)
	sb.WriteString("  - Win-rate by section: ")
	if len(p.WinRateBySection) == 0 {
		sb.WriteString("(no matches)\n")
	} else {
		keys := make([]string, 0, len(p.WinRateBySection))
		for k := range p.WinRateBySection {
			keys = append(keys, k)
		}
		sort.Strings(keys)
		parts := make([]string, 0, len(keys))
		for _, k := range keys {
			parts = append(parts, fmt.Sprintf("%s=%d%%", k, p.WinRateBySection[k]))
		}
		sb.WriteString(strings.Join(parts, ", "))
		sb.WriteString("\n")
	}
	fmt.Fprintf(&sb, "  - Study hours: %.1f\n", p.HoursStudied)
	fmt.Fprintf(&sb, "  - Streak: %d days\n", p.Streak)
	weakest := p.WeakestSection
	if weakest == "" {
		weakest = "(none)"
	}
	fmt.Fprintf(&sb, "  - Weakest section: %s\n", weakest)
	fmt.Fprintf(&sb, "  - Achievements unlocked: %d\n", p.AchievementsCount)
	return sb.String()
}

// Generate returns the LLM-generated insight text for one (user, week).
//
// Behavior:
//   - disabled (no API key): returns ("", nil) immediately. NO cache touch,
//     NO HTTP. Anti-fallback: empty string is the explicit "no insight" signal
//     for the frontend, never a faked LLM output.
//   - cache hit: returns cached value, no HTTP.
//   - cache miss + ok HTTP: caches and returns. Cache Set failures are
//     logged + metric'd but DO NOT fail the request (we already have the
//     value).
//   - cache Get / HTTP / non-2xx errors: wrapped error returned to caller.
func (c *InsightClient) Generate(ctx context.Context, uid uuid.UUID, payload InsightPayload) (string, error) {
	if c.disabled {
		return "", nil
	}
	if payload.WeekISO == "" {
		return "", fmt.Errorf("profile.insight.Generate: empty WeekISO in payload")
	}
	key := insightCacheKey(uid, payload.WeekISO)
	if c.kv != nil {
		if raw, err := c.kv.Get(ctx, key); err == nil {
			return raw, nil
		} else if !errors.Is(err, ErrCacheMiss) {
			// Anti-fallback: real Redis failure propagates.
			return "", fmt.Errorf("profile.insight.Generate: cache Get: %w", err)
		}
	}

	body, err := json.Marshal(insReq{
		Model:       c.model,
		Temperature: 0.3,
		MaxTokens:   400,
		Messages: []insMsg{
			{Role: "system", Content: insightSystemPrompt},
			{Role: "user", Content: renderUserPrompt(payload)},
		},
	})
	if err != nil {
		return "", fmt.Errorf("profile.insight.marshal: %w", err)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.endpoint, bytes.NewReader(body))
	if err != nil {
		return "", fmt.Errorf("profile.insight.newreq: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+c.apiKey)

	resp, err := c.http.Do(req)
	if err != nil {
		return "", fmt.Errorf("profile.insight.http: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode >= 400 {
		raw, _ := io.ReadAll(resp.Body)
		return "", fmt.Errorf("profile.insight: status=%d body=%q",
			resp.StatusCode, truncateInsight(string(raw), 256))
	}
	var parsed insResp
	if err := json.NewDecoder(resp.Body).Decode(&parsed); err != nil {
		return "", fmt.Errorf("profile.insight.decode: %w", err)
	}
	if len(parsed.Choices) == 0 {
		// Anti-fallback: empty completion is suspicious; return empty without
		// caching so the next request retries.
		return "", nil
	}
	out := strings.TrimSpace(parsed.Choices[0].Message.Content)
	if c.kv != nil && out != "" {
		if serr := c.kv.Set(ctx, key, []byte(out), c.cacheTTL); serr != nil {
			metrics.CacheSetErrorsTotal.WithLabelValues("profile_insight").Inc()
			c.log.Warn("profile.insight: cache Set failed",
				slog.Any("err", serr))
		}
	}
	return out, nil
}

func truncateInsight(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + "…"
}
