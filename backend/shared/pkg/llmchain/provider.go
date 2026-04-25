// Package llmchain — provider-agnostic LLM routing with automatic fallback.
//
// Motivation: running everything through OpenRouter's :free lane ate 50 req/day
// and 30 RPM, which is too tight for more than one active user. Groq's free
// tier is 14.4k/day on the same OpenAI-compatible wire format, Cerebras is
// similar, and we already have OpenRouter for edge cases. Rather than pick
// one, we chain them: primary → secondary → tertiary with per-(provider,model)
// circuit-breakers and proactive rate-limit tracking via the providers' own
// response headers (x-ratelimit-remaining-*).
//
// Design decisions and the failure modes they target (see also
// ../../../../README_LLMCHAIN.md or the PR description):
//
//   - Task-based model selection, not provider-based. Callers pass a Task
//     (VacanciesJSON / InsightProse / CopilotStream / Reasoning); the chain
//     picks the optimal model for that task on each provider. Example: for
//     VacanciesJSON, Groq uses llama-3.1-8b-instant (fastest JSON), not the
//     70B model — one less config error per integration.
//
//   - Per-(provider,model) circuit state. If Groq's 70B is rate-limited but
//     the 8B is free, we only cool the 70B. Cross-user; the rate limit lives
//     on our API key, not the user's.
//
//   - Proactive cooling from response headers. Groq/Cerebras emit
//     x-ratelimit-remaining-requests + x-ratelimit-reset-requests on every
//     response. When remaining drops ≤ 2, we pre-emptively cool that
//     (provider,model) until the reset timestamp — saves one rejected
//     request on every failure boundary.
//
//   - No mid-stream fallback. Once the first SSE chunk arrives the response
//     is committed: a provider dying mid-stream propagates an error to the
//     caller rather than appending Cerebras's continuation to Groq's prefix.
//     The alternative (buffer-and-commit) adds latency we can't afford for
//     a streaming UI.
//
//   - Error-class-aware retry. 429/5xx → next provider. 401 → alert +
//     cooldown 1h (config issue, retry won't help). 400/403 → return
//     immediately (same input will fail identically everywhere). This is
//     cheaper than a flat "3 retries any error".
//
// Wire format: every provider we integrate (Groq, Cerebras, Mistral,
// OpenRouter) speaks OpenAI-compatible chat-completions, so the Driver
// interface matches that shape 1:1. If we ever add a non-OpenAI provider
// (Anthropic direct, Bedrock) we'll add a translation layer INSIDE the
// driver — Driver's public signature should not grow a second dialect.
package llmchain

import (
	"context"
	"time"

	"druz9/shared/enums"
)

// Provider is the stable id of one upstream. Used as a label in metrics,
// logs, and the llm_models.provider_id column. Adding a new provider
// means: add the constant, write a Driver, register it in the wirer.
type Provider string

const (
	ProviderGroq       Provider = "groq"
	ProviderCerebras   Provider = "cerebras"
	ProviderMistral    Provider = "mistral"
	ProviderOpenRouter Provider = "openrouter"
	// ProviderDeepSeek — paid: api.deepseek.com. Используется в virtual-chain'ах
	// druz9/pro и druz9/reasoning (см. tier.go). В DefaultTaskModelMap
	// отсутствует — это exclusive для paid-tier'ов.
	ProviderDeepSeek Provider = "deepseek"
	// ProviderOllama — self-hosted sidecar (Qwen 2.5 3B Q4_K_M на CPU).
	// Задача: floor-fallback, когда все free-tier cloud провайдеры исчерпали
	// дневные квоты. Медленно (20-30 tok/s на VPS без GPU), но unlimited и
	// полностью под нашим контролем. В DefaultTaskModelMap присутствует во
	// всех chat-тасках как "последний рубеж"; активируется только если
	// оператор задал OLLAMA_HOST и положил "ollama" в LLM_CHAIN_ORDER.
	ProviderOllama Provider = "ollama"
)

// Task identifies a semantic workload class. Each task has its own
// per-provider optimal model in TaskModelMap (see task_map.go). The
// motivation is that "pick Groq" is the wrong abstraction: for
// strict-JSON extraction Groq's llama-3.1-8b-instant is the right call
// (fastest, reliable JSON), but for coaching prose we want the 70B.
// Callers think in tasks; only the chain knows models.
type Task string

const (
	// TaskVacanciesJSON — short strict-JSON extraction from vacancy
	// descriptions. Latency-sensitive (blocks the "Разобрать" button);
	// prefers the 8B-class models on every provider.
	TaskVacanciesJSON Task = "vacancies_json"
	// TaskInsightProse — long-form Russian coaching text from aggregated
	// weekly stats. Quality-sensitive; prefers 70B-class models.
	TaskInsightProse Task = "insight_prose"
	// TaskCopilotStream — interactive SSE chat for the macOS copilot.
	// Quality + streaming; prefers 70B-class models.
	TaskCopilotStream Task = "copilot_stream"
	// TaskReasoning — session analyzer + any other "give me a structured
	// analysis" caller. Quality-heavy; mirrors copilot for now.
	TaskReasoning Task = "reasoning"
	// TaskCodingHint — короткий намёк юзеру который молчит >2 мин в
	// mock-интервью. Small model, low latency: первый байт должен
	// прилететь за ~секунду, иначе намёк опоздал и ломает флоу.
	TaskCodingHint Task = "coding_hint"
	// TaskCodeReview — разбор пользовательского сабмита после mock.
	// Reasoning-heavy; длинный вывод с цитированием кода. Предпочитаем
	// DeepSeek-R1 / llama-70b — скорость не критична, глубина важна.
	TaskCodeReview Task = "code_review"
	// TaskSysDesignCritique — критика архитектурной диаграммы в system-
	// design треке. Quality > speed; требует длинного контекста (чтобы
	// уместить диаграмму + требования), Qwen2.5-72B sweet spot.
	TaskSysDesignCritique Task = "sysdesign_critique"
	// TaskSummarize — суммаризация для background-summarizer (Phase 4).
	// Самая дешёвая модель из доступных: стоимость токенов важнее
	// качества, summary потом может быть перечитан моделью посильнее.
	TaskSummarize Task = "summarize"
	// TaskDailyPlanSynthesis — синтез плана дня для Hone desktop-кокпита.
	// Вход: Skill Atlas gaps + сегодняшний календарь + последние PR/сессии.
	// Выход: 3-4 PlanItem'а с заголовком, subtitle-причиной, deep-link'ом.
	// Reasoning-heavy (нужно взвесить приоритеты), но НЕ streaming — клиент
	// ждёт целого JSON-ответа и рендерит карточки атомарно. 70B-класс.
	TaskDailyPlanSynthesis Task = "daily_plan_synthesis"
	// TaskDailyBrief — синтез утреннего брифа AI-coach слоя. Вход:
	// focus-stats 7d + skipped/completed plan-item'ы + последние reflection'ы
	// + top-5 нот по recency. Выход: strict JSON {headline, narrative,
	// recommendations[3]}. Reasoning + JSON — 70B-класс. Кэшируется на 6h
	// в hone_daily_briefs, force=true — rate-limited 1/h.
	TaskDailyBrief Task = "daily_brief"
	// TaskNoteQA — RAG над корпусом нот. Вход: вопрос юзера + top-8
	// embedded-нот (title + body). Выход: markdown ответ с [N]-цитациями.
	// Text mode (не JSON). 70B для глубины reasoning'а.
	TaskNoteQA Task = "note_qa"
)

// Role mirrors OpenAI chat roles. Kept as a string (not an enum) because
// every provider we speak to also uses strings.
type Role string

const (
	RoleSystem    Role = "system"
	RoleUser      Role = "user"
	RoleAssistant Role = "assistant"
)

// Message is one chat turn.
type Message struct {
	Role    Role
	Content string
	// Images is optional; nil = text-only (the common case). Today only
	// OpenRouter BYOK with a vision model supports images — the other
	// providers' llama models do not. Drivers that can't handle images
	// return a typed error so the chain knows to try the next provider.
	Images []Image
}

// Image carries raw bytes with a mime type. Kept as bytes (not
// base64-encoded) so the encoding happens at most once in the HTTP
// layer.
type Image struct {
	MimeType string
	Data     []byte
}

// Request is the provider-agnostic call shape. Exactly one of Task /
// ModelOverride is the source of truth for model selection.
type Request struct {
	// Task picks the model via TaskModelMap. Ignored when ModelOverride
	// is set. At least one of Task / ModelOverride must be non-zero.
	Task Task

	// ModelOverride pins a specific model id ("groq/llama-3.3-70b-versatile"
	// or "qwen/qwen3-coder:free"). When set, we route to the provider
	// derived from the prefix; if the prefix doesn't match a registered
	// provider, OpenRouter is used as the fallback (legacy model ids
	// without a provider prefix).
	ModelOverride string

	Messages    []Message
	Temperature float64
	MaxTokens   int

	// JSONMode asks the provider to force a valid-JSON response. Groq,
	// OpenRouter and Mistral support this natively via "response_format".
	// Cerebras ignores the hint — we fall back to prompt-level "return
	// only JSON" instruction (already in our system prompts).
	JSONMode bool

	// AttemptTimeout caps the per-provider wall clock. Zero = use the
	// chain's per-provider default (groq 10s, cerebras 20s, others 45s).
	// Individual caller overrides are mostly for tests.
	AttemptTimeout time.Duration

	// UserTier — актуальный tier подписки (free/seeker/ascendant). Пустая
	// строка трактуется как free (graceful default для legacy-caller'ов).
	// Используется для tier-gate'а paid-моделей в candidates(): если
	// ModelOverride требует seeker+, а UserTier=free → ErrTierRequired.
	// Caller обычно заполняет через shared middleware UserTierFromContext.
	UserTier enums.SubscriptionPlan
}

// Response is the non-streaming result.
type Response struct {
	Content   string
	TokensIn  int
	TokensOut int
	// Provider / Model echo back the actually-used upstream so the
	// caller can surface it in observability and UI (the "served by:
	// Groq/llama-3.3-70b · 2.3s" plate on the vacancies page).
	Provider Provider
	Model    string
	Latency  time.Duration
}

// StreamEvent is one frame of a streaming response. Exactly one of
// Delta / Done / Err is set. Channel closes after the terminal frame
// (matching copilot/domain.StreamEvent semantics).
type StreamEvent struct {
	Delta string
	Done  *DoneInfo
	Err   error
}

// DoneInfo carries the terminal frame's token accounting.
type DoneInfo struct {
	TokensIn  int
	TokensOut int
	Provider  Provider
	Model     string
}

// Driver is one upstream's HTTP client. Exactly one Driver instance per
// Provider. Drivers are stateless apart from the HTTP client and API
// key; all retry / fallback / circuit-breaker logic lives on Chain.
type Driver interface {
	// Provider returns the id this driver handles. Used by the chain
	// to build its registry.
	Provider() Provider

	// Chat is a non-streaming request. Errors are typed (see errors.go)
	// so the chain can decide whether to fall through.
	Chat(ctx context.Context, model string, req Request) (Response, error)

	// ChatStream returns a channel that closes after the terminal frame.
	// An error BEFORE the first chunk (connection / 429 / 5xx / auth)
	// is returned as the function's error value — the chain may then
	// retry with the next provider. Errors AFTER the first chunk arrive
	// as StreamEvent{Err} and the chain propagates them to the caller;
	// it does NOT attempt mid-stream fallback.
	ChatStream(ctx context.Context, model string, req Request) (<-chan StreamEvent, error)
}

// Clock is a test seam — the chain injects a clock so rate-limit
// cooldowns are deterministic under test. Production uses time.Now.
type Clock func() time.Time
