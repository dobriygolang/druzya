package llmchain

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"sort"
	"strings"
	"sync"
	"time"

	"druz9/shared/enums"
)

// Chain orchestrates multiple Driver instances. It is the primary public
// type callers use: service-level code takes a *Chain, not individual
// Drivers.
//
// Threading model: Chain is safe for concurrent use. Rate-limit state
// lives in a sync.Map keyed by "<provider>/<model>" and each value is a
// *rateState with its own mutex. The happy path is lock-free apart from
// the one map load.
type Chain struct {
	drivers  map[Provider]Driver
	order    []Provider // resolved priority (healthy providers, in order) — static defaults
	taskMap  TaskModelMap
	state    sync.Map // key: provider+"/"+model → *rateState
	latency  *latencyStore
	log      *slog.Logger
	clock    Clock
	timeouts map[Provider]time.Duration
	// Default cooldowns applied when a provider returns a typed error
	// without a header hint. Tunable for tests.
	defaultCooldowns cooldownPolicy
	// runtimeCfg — optional runtime-loaded overrides (from DB). Когда
	// непустой snapshot активен — методы currentOrder/currentTaskMap/
	// currentVirtualChains возвращают его значения; иначе падают на
	// static defaults (order/taskMap/virtualChains). nil — runtime reload
	// отключён (unit-tests / в startup до wire-up loader'а).
	runtimeCfg *configLoader
}

// cooldownPolicy holds the baked-in durations for each error class.
// Rendered explicit so operators can see (in one place) how long a
// provider stays out of the rotation after each failure type.
type cooldownPolicy struct {
	rateLimit    time.Duration // 429 without Retry-After → 30s
	providerDown time.Duration // 5xx / transport → 60s
	unauthorized time.Duration // 401/403/402 → 1h (operator action needed)
}

var defaultPolicy = cooldownPolicy{
	rateLimit:    30 * time.Second,
	providerDown: 60 * time.Second,
	unauthorized: 1 * time.Hour,
}

// defaultTimeouts — cascading attempt timeouts. Groq is fast; there's
// no point waiting 45s for it — if it isn't responding in 10s something
// is wrong, move on. OpenRouter includes paid Claude which can take
// significantly longer on long prompts.
var defaultTimeouts = map[Provider]time.Duration{
	ProviderGroq:       10 * time.Second,
	ProviderCerebras:   20 * time.Second,
	ProviderMistral:    30 * time.Second,
	ProviderOpenRouter: 45 * time.Second,
	// Ollama — self-hosted CPU-only на VPS (8 ядер, ~25 tok/s на Qwen 3B
	// Q4_K_M). Обычный cloud timeout (10-30s) для локали слишком жёсткий:
	// ответ 300 токенов занимает ~12s + первый байт после холодного загруза
	// модели может прилететь через 5-8s. Ставим 60s — мы и так в fallback,
	// прилично дождаться законченного ответа важнее чем "быстро провалиться".
	ProviderOllama: 60 * time.Second,
	// DeepSeek — платный, API быстрый (sub-second first byte), но reasoner
	// (R1) при extended-thinking может thinking'ать 15-30s. 30s — компромисс.
	ProviderDeepSeek: 30 * time.Second,
}

// Options configures a new Chain.
type Options struct {
	// Order is the priority of providers to try, front to back. Providers
	// not in this list are ignored even if a driver was registered for
	// them. Zero value → natural order from drivers (random map iteration),
	// so callers almost always set this.
	Order []Provider

	// TaskMap overrides the default task → model mapping. nil ⇒ use
	// DefaultTaskModelMap (cloned so this chain's edits don't leak).
	TaskMap TaskModelMap

	// Timeouts overrides the default per-provider attempt deadline. nil ⇒
	// defaultTimeouts. Missing keys fall back to the default.
	Timeouts map[Provider]time.Duration

	// Clock — test seam. nil ⇒ time.Now.
	Clock Clock

	// Log is required (anti-fallback policy: no silent noop loggers).
	Log *slog.Logger

	// RuntimeConfigSource — опциональный источник данных для динамической
	// конфигурации chain'а (порядок / task-map / virtual-chains из БД).
	// nil → runtime reload отключён, chain работает только с hardcoded
	// defaults. Когда задан — конструктор стартует background refresh
	// goroutine через NewChain → context.
	RuntimeConfigSource ConfigSource

	// RuntimeRefreshInterval — как часто loader опрашивает источник.
	// 0 → 30s default. Админ-PUT форсит reload вне тика.
	RuntimeRefreshInterval time.Duration

	// RuntimeCtx — контекст для background refresh goroutine. nil →
	// background.Background(). Обычно wiring передаёт ctx приложения,
	// чтобы graceful shutdown останавливал loader.
	RuntimeCtx context.Context
}

// NewChain builds the orchestrator. Drivers with nil entries are
// ignored — the wirer skips registration when the API key is empty.
func NewChain(drivers map[Provider]Driver, opts Options) (*Chain, error) {
	if opts.Log == nil {
		return nil, fmt.Errorf("llmchain.NewChain: logger is required (anti-fallback policy)")
	}
	if len(drivers) == 0 {
		return nil, fmt.Errorf("llmchain.NewChain: at least one driver is required")
	}

	// Filter order to registered drivers, preserving priority.
	var order []Provider
	if len(opts.Order) > 0 {
		for _, p := range opts.Order {
			if _, ok := drivers[p]; ok {
				order = append(order, p)
			} else {
				opts.Log.Warn("llmchain: Options.Order mentions unregistered provider — skipped",
					slog.String("provider", string(p)))
			}
		}
	} else {
		// Fall back to map iteration (deterministic ORDER is the caller's
		// job); we don't sort because callers must be explicit.
		for p := range drivers {
			order = append(order, p)
		}
	}
	if len(order) == 0 {
		return nil, fmt.Errorf("llmchain.NewChain: no usable providers after filtering against registered drivers")
	}

	taskMap := opts.TaskMap
	if taskMap == nil {
		taskMap = DefaultTaskModelMap.Clone()
	}
	timeouts := make(map[Provider]time.Duration, len(defaultTimeouts))
	for p, d := range defaultTimeouts {
		timeouts[p] = d
	}
	for p, d := range opts.Timeouts {
		timeouts[p] = d
	}
	clock := opts.Clock
	if clock == nil {
		clock = time.Now
	}

	c := &Chain{
		drivers:          drivers,
		order:            order,
		taskMap:          taskMap,
		latency:          newLatencyStore(defaultWindowSize),
		log:              opts.Log,
		clock:            clock,
		timeouts:         timeouts,
		defaultCooldowns: defaultPolicy,
	}

	// Runtime config loader. Если оператор не прицепил ConfigSource — chain
	// живёт на static defaults (как раньше). Иначе — стартуем background
	// goroutine, читающую свежие снэпшоты из БД.
	if opts.RuntimeConfigSource != nil {
		loader := newConfigLoader(opts.RuntimeConfigSource, opts.RuntimeRefreshInterval, opts.Log)
		c.runtimeCfg = loader
		ctx := opts.RuntimeCtx
		if ctx == nil {
			ctx = context.Background()
		}
		go loader.run(ctx)
	}
	return c, nil
}

// RuntimeForceReload — форсит немедленную загрузку config'а из источника.
// Используется admin-PUT handler'ом после успешной записи в БД, чтобы
// изменения вступали в силу без ожидания 30s tick'а.
func (c *Chain) RuntimeForceReload(ctx context.Context) {
	if c.runtimeCfg != nil {
		c.runtimeCfg.forceReload(ctx)
	}
}

// RegisteredProviders возвращает имена всех зарегистрированных провайдеров
// (те, у которых API-ключ был в env на момент NewChain). Нужно admin-UI
// чтобы live-preview знал, какие звенья цепочки реально достижимы, а
// какие будут silently скипнуты при expandVirtualChain.
//
// Порядок НЕ сортируется — отдаём как есть (map iteration). Фронт
// сортирует сам если нужно.
func (c *Chain) RegisteredProviders() []string {
	out := make([]string, 0, len(c.drivers))
	for p := range c.drivers {
		out = append(out, string(p))
	}
	return out
}

// currentOrder — вернёт runtime-заданный порядок если есть (непустой
// ChainOrder в snapshot'е) либо static c.order. Сохраняет гарантию что
// в результат попадают только registered-драйверы (фильтрация по
// c.drivers).
func (c *Chain) currentOrder() []Provider {
	if c.runtimeCfg != nil {
		if snap := c.runtimeCfg.snapshot(); snap != nil && len(snap.ChainOrder) > 0 {
			out := make([]Provider, 0, len(snap.ChainOrder))
			for _, p := range snap.ChainOrder {
				if _, ok := c.drivers[p]; ok {
					out = append(out, p)
				}
			}
			if len(out) > 0 {
				return out
			}
		}
	}
	return c.order
}

// currentTaskMap — runtime-заданный TaskModelMap или c.taskMap. Если
// runtime-map неполный (нет нужного task'а) — дополняем static-default'ами
// по недостающим ключам.
func (c *Chain) currentTaskMap() TaskModelMap {
	if c.runtimeCfg != nil {
		if snap := c.runtimeCfg.snapshot(); snap != nil && len(snap.TaskMap) > 0 {
			merged := c.taskMap.Clone()
			for task, inner := range snap.TaskMap {
				if len(inner) == 0 {
					continue
				}
				merged[task] = inner
			}
			return merged
		}
	}
	return c.taskMap
}

// currentVirtualChains — runtime-заданные виртуалки или static virtualChains
// из tier.go. Ключи-override'ы заменяют defaults one-by-one.
func (c *Chain) currentVirtualChains() map[string][]VirtualCandidate {
	if c.runtimeCfg != nil {
		if snap := c.runtimeCfg.snapshot(); snap != nil && len(snap.VirtualChains) > 0 {
			merged := make(map[string][]VirtualCandidate, len(virtualChains))
			for k, v := range virtualChains {
				merged[k] = v
			}
			for k, v := range snap.VirtualChains {
				if len(v) > 0 {
					merged[k] = v
				}
			}
			return merged
		}
	}
	return virtualChains
}

// ─────────────────────────────────────────────────────────────────────────
// Public entry points.
// ─────────────────────────────────────────────────────────────────────────

// Chat is the non-streaming path. Walks the chain until a success or
// every candidate fails with a retryable class (→ AllProvidersUnavailableError).
// Fatal classes (ErrBadRequest / ErrUnauthorized at the *call* level) short-circuit.
func (c *Chain) Chat(ctx context.Context, req Request) (Response, error) {
	candidates, err := c.candidates(req)
	if err != nil {
		return Response{}, err
	}
	attempts := make([]AttemptError, 0, len(candidates))
	for _, cand := range candidates {
		if block, _, reason := c.stateOf(cand.provider, cand.model).blocked(c.clock()); block {
			attempts = append(attempts, AttemptError{
				Provider: cand.provider, Model: cand.model,
				Err: fmt.Errorf("cooled: %s", reason),
			})
			incFallback(cand.provider, "cooled")
			continue
		}
		attemptCtx, cancel := c.attemptContext(ctx, cand.provider, req.AttemptTimeout)
		start := c.clock()
		resp, cerr := cand.driver.Chat(attemptCtx, cand.model, req)
		cancel()
		if cerr == nil {
			dur := c.clock().Sub(start)
			c.recordSuccess(cand.provider, cand.model, nil)
			c.latency.Record(cand.provider, cand.model, req.Task, dur)
			observeCall(cand.provider, string(req.Task), "ok", dur)
			return resp, nil
		}
		dur := c.clock().Sub(start)
		attempts = append(attempts, AttemptError{
			Provider: cand.provider, Model: cand.model,
			Status: statusOf(cerr), Err: cerr, Duration: dur,
		})
		observeCall(cand.provider, string(req.Task), classLabel(cerr), dur)
		if decision := c.handleError(cand.provider, cand.model, cerr); decision == decisionFatal {
			return Response{}, fmt.Errorf("llmchain.Chat: %w", cerr)
		}
	}
	return Response{}, &AllProvidersUnavailableError{Task: effectiveTaskFor(req), Attempts: attempts}
}

// ChatStream is the streaming path. Fallback is attempted ONLY on
// pre-first-chunk failures (connection / 429 / 5xx / auth). Once a
// provider has started streaming we commit to it — mid-stream errors
// propagate as StreamEvent{Err} to the caller.
func (c *Chain) ChatStream(ctx context.Context, req Request) (<-chan StreamEvent, error) {
	candidates, err := c.candidates(req)
	if err != nil {
		// Конфигурационная или tier-ошибка — кандидаты вообще не построились.
		// Лог на Warn с подробностями: оператор сразу видит что сломалось
		// (no providers configured / unknown virtual / tier-mismatch).
		c.log.WarnContext(ctx, "llmchain.ChatStream: no candidates",
			slog.String("task", string(req.Task)),
			slog.String("model_override", req.ModelOverride),
			slog.Bool("has_images", hasImages(req.Messages)),
			slog.Any("err", err))
		return nil, err
	}
	attempts := make([]AttemptError, 0, len(candidates))
	for _, cand := range candidates {
		if block, _, reason := c.stateOf(cand.provider, cand.model).blocked(c.clock()); block {
			attempts = append(attempts, AttemptError{
				Provider: cand.provider, Model: cand.model,
				Err: fmt.Errorf("cooled: %s", reason),
			})
			incFallback(cand.provider, "cooled")
			c.log.InfoContext(ctx, "llmchain.ChatStream: candidate cooled, skipping",
				slog.String("task", string(req.Task)),
				slog.String("provider", string(cand.provider)),
				slog.String("model", cand.model),
				slog.String("reason", reason))
			continue
		}
		// Unlike Chat, ChatStream must keep the context alive for the
		// *entire* stream, so we don't attach a per-attempt deadline to
		// the parent. We do still set a "time to first byte" ceiling via
		// the HTTP Transport's ResponseHeaderTimeout (60s, baked in). If
		// the upstream stalls on headers, that fires and returns
		// ErrProviderDown before any chunk arrives — handled below.
		start := c.clock()
		ch, cerr := cand.driver.ChatStream(ctx, cand.model, req)
		if cerr == nil {
			// For streams, "latency" = time-to-first-chunk. That's what the
			// user actually feels on a streaming UI; full-stream duration
			// is dominated by content length which we don't control.
			dur := c.clock().Sub(start)
			c.recordSuccess(cand.provider, cand.model, nil)
			c.latency.Record(cand.provider, cand.model, req.Task, dur)
			observeCall(cand.provider, string(req.Task), "stream_started", dur)
			c.log.InfoContext(ctx, "llmchain.ChatStream: stream started",
				slog.String("task", string(req.Task)),
				slog.String("provider", string(cand.provider)),
				slog.String("model", cand.model),
				slog.Bool("has_images", hasImages(req.Messages)),
				slog.Duration("ttfb", dur))
			return ch, nil
		}
		dur := c.clock().Sub(start)
		attempts = append(attempts, AttemptError{
			Provider: cand.provider, Model: cand.model,
			Status: statusOf(cerr), Err: cerr, Duration: dur,
		})
		observeCall(cand.provider, string(req.Task), classLabel(cerr), dur)
		// Per-attempt failure лог. Включает classLabel (rate_limited /
		// model_not_supported / provider_down / etc) — это категория, по
		// которой можно грепать и алертить. err.Error() — полный текст
		// апстримового ответа (для OpenRouter это включает «No endpoints
		// found for ...» — сразу видно что модель умерла из их каталога).
		c.log.WarnContext(ctx, "llmchain.ChatStream: candidate failed",
			slog.String("task", string(req.Task)),
			slog.String("provider", string(cand.provider)),
			slog.String("model", cand.model),
			slog.String("class", classLabel(cerr)),
			slog.Duration("dur", dur),
			slog.Any("err", cerr))
		if decision := c.handleError(cand.provider, cand.model, cerr); decision == decisionFatal {
			return nil, fmt.Errorf("llmchain.ChatStream: %w", cerr)
		}
	}
	// Все провайдеры пройдены, ни один не дал стрим. Финальный summary-лог
	// с агрегацией по providers — с ним один grep даёт картину «почему
	// vision сегодня лежит». Без этого админу приходилось бы листать
	// per-attempt warnings в общем потоке.
	failures := make([]any, 0, len(attempts)*5)
	for _, a := range attempts {
		failures = append(failures,
			slog.Group(string(a.Provider),
				slog.String("model", a.Model),
				slog.Int("status", int(a.Status)),
				slog.String("err", errString(a.Err))))
	}
	c.log.ErrorContext(ctx, "llmchain.ChatStream: all candidates failed",
		slog.String("task", string(req.Task)),
		slog.Int("attempts", len(attempts)),
		slog.Group("by_provider", failures...))
	return nil, &AllProvidersUnavailableError{Task: req.Task, Attempts: attempts}
}

// errString — nil-safe Error().
func errString(err error) string {
	if err == nil {
		return ""
	}
	return err.Error()
}

// effectiveTaskFor — какой task на самом деле гнать через chain. Если
// в request'е есть images, а task не TaskVision — переключаемся.
// Делается в одном месте чтобы и candidates(), и error-construction
// (AllProvidersUnavailableError.Task) видели одинаковую истину.
func effectiveTaskFor(req Request) Task {
	if req.Task != TaskVision && hasImages(req.Messages) {
		return TaskVision
	}
	return req.Task
}

// ─────────────────────────────────────────────────────────────────────────
// Candidate resolution.
// ─────────────────────────────────────────────────────────────────────────

type candidate struct {
	provider Provider
	model    string
	driver   Driver
}

func (c *Chain) candidates(req Request) ([]candidate, error) {
	// ── Virtual-model expansion ────────────────────────────────────────
	// "druz9/pro", "druz9/ultra", "druz9/reasoning" etc. — разворачиваются
	// в multi-provider chain. Tier-gate ДО expand'а, чтобы free-юзер не
	// видел состав paid-цепочки в сообщении об ошибке.
	if IsVirtualModel(req.ModelOverride) {
		required, ok := VirtualModelMinTier[req.ModelOverride]
		if !ok {
			return nil, fmt.Errorf("%w: unknown virtual model %q", ErrNoProvider, req.ModelOverride)
		}
		if !TierCovers(req.UserTier, required) {
			return nil, fmt.Errorf("%w: %q needs %s, got %s",
				ErrTierRequired, req.ModelOverride, required, effectiveTier(req.UserTier))
		}
		// Предпочитаем runtime-chain (из БД) над hardcoded static. Админ
		// меняет порядок провайдеров / состав цепочки через PUT /admin/llm/config.
		vChain, ok := c.currentVirtualChains()[req.ModelOverride]
		if !ok {
			return nil, fmt.Errorf("%w: no chain for virtual %q", ErrNoProvider, req.ModelOverride)
		}
		return c.expandVirtualChain(vChain), nil
	}

	if req.ModelOverride != "" {
		// Concrete model picked — single candidate, no fallback.
		// Tier-gate проверяет что paid-модель доступна юзеру.
		if required := ModelRequiresTier(req.ModelOverride); !TierCovers(req.UserTier, required) {
			return nil, fmt.Errorf("%w: %q needs %s, got %s",
				ErrTierRequired, req.ModelOverride, required, effectiveTier(req.UserTier))
		}
		p := providerFromModelID(req.ModelOverride)
		d, ok := c.drivers[p]
		if !ok {
			return nil, fmt.Errorf("%w: %s for model %q", ErrNoProvider, p, req.ModelOverride)
		}
		return []candidate{{provider: p, model: req.ModelOverride, driver: d}}, nil
	}
	if req.Task == "" {
		return nil, fmt.Errorf("%w: neither Task nor ModelOverride set", ErrBadRequest)
	}
	// Vision auto-routing: если в request'е есть images, а оригинальный
	// task'овый chain — text-only (TaskCopilotStream → Llama 70B, Qwen
	// coder, etc.), переключаемся на TaskVision (vision-capable
	// провайдеры). Без этого скриншот, отправленный copilot'у, цеплял
	// первый провайдер из text-chain'а, тот падал с ErrModelNotSupported,
	// chain дальше пробежал по всем text-провайдерам подряд (тоже text)
	// и итог был AllProvidersUnavailableError → у юзера «copilot failure».
	// Vision-models (qwen-2.5-vl) одинаково хорошо обрабатывают
	// чисто-текстовые сообщения, так что переключение безопасно даже если
	// promo image вдруг не нужен модели.
	effectiveTask := effectiveTaskFor(req)
	if effectiveTask != req.Task {
		c.log.Info("llmchain.candidates: switching to vision task",
			slog.String("requested", string(req.Task)),
			slog.String("effective", string(effectiveTask)))
	}
	// Runtime-config предпочитается static'у — админ может менять порядок
	// и task-map через БД без рестарта (см. currentOrder/currentTaskMap).
	order := c.currentOrder()
	taskMap := c.currentTaskMap()
	out := make([]candidate, 0, len(order))
	for _, p := range order {
		model := taskMap.ModelFor(effectiveTask, p)
		if model == "" {
			continue
		}
		// Tier-gate: пропускаем paid-модели для юзеров с недостаточным tier'ом.
		// По умолчанию все task-map модели free, но defensive — если кто-то
		// добавит paid-модель в default map, tier-gate автоматом её отрежет.
		if required := ModelRequiresTier(model); !TierCovers(req.UserTier, required) {
			continue
		}
		d, ok := c.drivers[p]
		if !ok {
			continue
		}
		out = append(out, candidate{provider: p, model: model, driver: d})
	}
	if len(out) == 0 {
		return nil, fmt.Errorf("%w: no candidates for task %q", ErrNoProvider, effectiveTask)
	}
	// Passive latency reorder: when multiple candidates have enough
	// samples (≥ minSamplesForReorder each), promote the one with the
	// lowest recent p95. Providers without a warm window keep their
	// static-order position so cold starts still respect LLM_CHAIN_ORDER.
	//
	// We intentionally do NOT move cooled providers — they're already
	// skipped at attempt time by the state check. Reordering affects
	// only the ATTEMPT ORDER of healthy candidates.
	out = c.reorderByLatency(out, req.Task)
	return out, nil
}

// reorderByLatency performs a stable sort that pulls low-p95 candidates
// to the front. "Stable" is the key word: candidates without enough
// samples keep their relative static order (they compare equal to each
// other AND to warmed-up siblings, so they don't jump around). Once a
// provider has ≥ minSamplesForReorder samples, it competes on p95.
//
// Why stable-sort instead of plain sort: if Groq and Cerebras both have
// no history (fresh deploy), operator's configured LLM_CHAIN_ORDER must
// win. Unstable sort would shuffle them randomly. Stable preserves the
// static order as a tiebreaker — which is exactly the intent.
func (c *Chain) reorderByLatency(in []candidate, task Task) []candidate {
	if len(in) < 2 || task == "" {
		return in
	}
	// Attach each candidate to its p95 (or "unknown" sentinel = math.MaxInt64
	// so unknowns sink to the back of the sorted-by-p95 view, which after
	// stable-sort means they keep static order relative to each other AND
	// relative to known candidates. Wait — we actually want unknowns to
	// STAY in static order, not sink. So we treat "unknown" as "match the
	// static-order sentinel". Concretely: sort only among known-p95
	// entries, leaving unknowns alone in their original slots.
	type scored struct {
		c    candidate
		p95  time.Duration
		hasP bool
	}
	scoredList := make([]scored, len(in))
	hasAnyKnown := false
	for i, cand := range in {
		p, ok := c.latency.P95(cand.provider, cand.model, task)
		scoredList[i] = scored{c: cand, p95: p, hasP: ok}
		if ok {
			hasAnyKnown = true
		}
	}
	if !hasAnyKnown {
		return in // cold start: nothing to learn from yet
	}
	// Indices of entries with known p95, sorted by p95 ascending.
	knownIdx := make([]int, 0, len(scoredList))
	for i, s := range scoredList {
		if s.hasP {
			knownIdx = append(knownIdx, i)
		}
	}
	sort.SliceStable(knownIdx, func(a, b int) bool {
		return scoredList[knownIdx[a]].p95 < scoredList[knownIdx[b]].p95
	})
	// Rebuild the output: walk the original slice; at each slot that was
	// "known-p95", pull the next entry from the sorted knownIdx list.
	// Unknown-p95 slots keep their original candidate. This preserves
	// static order for cold providers while reordering warm ones among
	// themselves.
	out := make([]candidate, len(in))
	nextKnown := 0
	for i, s := range scoredList {
		if !s.hasP {
			out[i] = s.c
			continue
		}
		out[i] = scoredList[knownIdx[nextKnown]].c
		nextKnown++
	}
	return out
}

// providerFromModelID maps a model id onto its provider. Recognizes the
// "<provider>/<model>" convention we use for Groq/Cerebras/Mistral ids
// we insert into llm_models; falls back to OpenRouter for everything
// else (which is what OpenRouter itself expects — its ids are always
// "vendor/model"). See migration 00045 for the conventions.
func providerFromModelID(id string) Provider {
	// DeepSeek ids — без slash'а ("deepseek-chat", "deepseek-reasoner").
	// Exact-match, чтобы не путать с условным "deepseek-ai/..." от OpenRouter.
	if id == "deepseek-chat" || id == "deepseek-reasoner" {
		return ProviderDeepSeek
	}
	if idx := strings.Index(id, "/"); idx > 0 {
		prefix := Provider(id[:idx])
		switch prefix {
		case ProviderGroq,
			ProviderCerebras,
			ProviderMistral,
			ProviderOpenRouter,
			ProviderDeepSeek,
			ProviderOllama:
			return prefix
		}
	}
	return ProviderOpenRouter
}

// expandVirtualChain конвертирует список virtualCandidate (provider+model
// без driver) в candidate'ы, подтягивая реальные driver'ы из chain'а.
// Элементы без зарегистрированного драйвера ТИХО скипаются — соответствует
// семантике task-based candidates: если оператор не настроил key для
// OpenRouter, pro-цепочка просто "сожмётся" до работающих звеньев.
func (c *Chain) expandVirtualChain(vc []VirtualCandidate) []candidate {
	out := make([]candidate, 0, len(vc))
	for _, v := range vc {
		d, ok := c.drivers[v.Provider]
		if !ok {
			continue
		}
		out = append(out, candidate{provider: v.Provider, model: v.Model, driver: d})
	}
	return out
}

// effectiveTier заменяет пустое значение на "free" для error-сообщений.
func effectiveTier(t enums.SubscriptionPlan) enums.SubscriptionPlan {
	if t == "" {
		return enums.SubscriptionPlanFree
	}
	return t
}

// ─────────────────────────────────────────────────────────────────────────
// Error-class decision.
// ─────────────────────────────────────────────────────────────────────────

type chainDecision int

const (
	decisionFallThrough chainDecision = iota
	decisionFatal
)

// handleError applies the cooldown for the (provider,model) and returns
// whether the chain should keep trying other candidates. Also ingests
// the rate-limit headers from httpStatusError so proactive cooldowns
// update even on rejected calls.
func (c *Chain) handleError(p Provider, model string, err error) chainDecision {
	state := c.stateOf(p, model)
	now := c.clock()

	// Cross-hook: HTTP status carries rate-limit headers on some 429s.
	var hse *httpStatusError
	if errors.As(err, &hse) {
		if rem, reset := parseRateLimitHeaders(p, hse.Headers(), now); rem >= 0 {
			state.recordResponse(rem, reset)
		}
	}

	switch {
	case errors.Is(err, ErrRateLimited):
		cooldown := c.defaultCooldowns.rateLimit
		if hse != nil {
			if ra := parseRetryAfter(hse.Headers().Get("Retry-After"), now); ra > cooldown {
				cooldown = ra
			}
		}
		state.block(now.Add(cooldown), "rate-limited")
		c.log.Warn("llmchain: provider rate-limited, falling through",
			slog.String("provider", string(p)),
			slog.String("model", model),
			slog.Duration("cooldown", cooldown))
		return decisionFallThrough

	case errors.Is(err, ErrProviderDown), errors.Is(err, ErrTimeout):
		cooldown := c.defaultCooldowns.providerDown
		state.block(now.Add(cooldown), "provider down")
		c.log.Warn("llmchain: provider down, falling through",
			slog.String("provider", string(p)),
			slog.String("model", model),
			slog.Any("err", err))
		return decisionFallThrough

	case errors.Is(err, ErrUnauthorized):
		cooldown := c.defaultCooldowns.unauthorized
		state.block(now.Add(cooldown), "unauthorized/payment required")
		// ERROR level — this is an operator-visible issue (wrong/expired
		// key, out of credits). We keep walking the chain because the
		// call itself might still succeed elsewhere, but the alert fires.
		c.log.Error("llmchain: provider refused auth — operator action needed",
			slog.String("provider", string(p)),
			slog.String("model", model),
			slog.Any("err", err))
		return decisionFallThrough

	case errors.Is(err, ErrModelNotSupported):
		// Provider is healthy; it just doesn't match this request (e.g.
		// vision on a text-only driver). Skip the cooldown, move on.
		return decisionFallThrough

	case errors.Is(err, ErrBadRequest):
		// Same-input error everywhere — don't spin up the next provider.
		return decisionFatal

	default:
		// Unknown error — treat conservatively as provider-down.
		cooldown := c.defaultCooldowns.providerDown
		state.block(now.Add(cooldown), "unknown error")
		c.log.Warn("llmchain: unclassified error, treating as provider-down",
			slog.String("provider", string(p)),
			slog.String("model", model),
			slog.Any("err", err))
		return decisionFallThrough
	}
}

// recordSuccess resets the cooldown and reads headers if the caller
// forwarded them (current drivers don't yet — a post-success headers
// ingestion point would go here once added).
func (c *Chain) recordSuccess(p Provider, model string, h http.Header) {
	state := c.stateOf(p, model)
	state.clear()
	if h != nil {
		if rem, reset := parseRateLimitHeaders(p, h, c.clock()); rem >= 0 {
			state.recordResponse(rem, reset)
		}
	}
}

// ─────────────────────────────────────────────────────────────────────────
// State store helpers.
// ─────────────────────────────────────────────────────────────────────────

func (c *Chain) stateOf(p Provider, model string) *rateState {
	key := string(p) + "/" + model
	if v, ok := c.state.Load(key); ok {
		return v.(*rateState)
	}
	fresh := &rateState{}
	actual, _ := c.state.LoadOrStore(key, fresh)
	return actual.(*rateState)
}

func (c *Chain) attemptContext(ctx context.Context, p Provider, override time.Duration) (context.Context, context.CancelFunc) {
	d := c.timeouts[p]
	if override > 0 {
		d = override
	}
	if d <= 0 {
		return ctx, func() {}
	}
	return context.WithTimeout(ctx, d)
}

// statusOf pulls the HTTP status out of an error if any driver layer
// wrapped it with httpStatusError.
func statusOf(err error) int {
	var hse *httpStatusError
	if errors.As(err, &hse) {
		return hse.Status()
	}
	return 0
}

// classLabel picks a short status label for metrics/logs.
func classLabel(err error) string {
	switch {
	case err == nil:
		return "ok"
	case errors.Is(err, ErrRateLimited):
		return "rate_limited"
	case errors.Is(err, ErrProviderDown):
		return "provider_down"
	case errors.Is(err, ErrTimeout):
		return "timeout"
	case errors.Is(err, ErrUnauthorized):
		return "unauthorized"
	case errors.Is(err, ErrBadRequest):
		return "bad_request"
	case errors.Is(err, ErrModelNotSupported):
		return "not_supported"
	default:
		return "unknown"
	}
}
