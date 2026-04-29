package admin

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"strings"

	"druz9/shared/pkg/config"
	"druz9/shared/pkg/llmcache"
	"druz9/shared/pkg/llmchain"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
)

// LLMProviderKeysConfigKey — dynamic_config key для admin-managed
// API-ключей. Schema: {"groq": ["k1","k2"], "google": ["k1","k2","k3"], ...}
// Слияние с env: DB-ключи ДОПОЛНЯЮТ env-ключи (concat без dedup),
// чтобы admin мог добавить дополнительные free-tier-аккаунты не
// трогая prod env. Empty array в DB == ничего не добавляем.
const LLMProviderKeysConfigKey = "llm_provider_keys"

// BuildLLMChain is the single source of truth for assembling the
// provider chain at monolith boot. Every service wirer that wants to
// dispatch LLM calls through the chain passes this *llmchain.Chain into
// its adapter.
//
// Drivers with empty API keys are skipped (with a startup WARN) — the
// chain needs at least one registered provider or NewChain returns an
// error. Order is derived from cfg.LLMChain.ChainOrder ("groq,cerebras,
// openrouter" by default) intersected with the registered set so
// ops changing LLM_CHAIN_ORDER never end up with a non-functional
// chain because they referenced a provider whose key they forgot to
// set.
//
// The builder is expected to be called ONCE per process; individual
// services share the returned *Chain. Rate-limit state in the chain is
// cross-user (matches the fact that our API keys are cross-user), and
// sharing one instance means a 429 observed by one service pre-empts
// the others from hammering the same provider.
// BuildLLMChain builds the raw provider chain (see doc comment above).
// Kept unchanged in signature + semantics so existing tests/callers that
// want direct access to *llmchain.Chain continue to work. The
// cache-decorated entry point is BuildLLMChainWithCache below.
func BuildLLMChain(cfg config.Config, log *slog.Logger) (*llmchain.Chain, error) {
	return buildLLMChainWithRuntime(cfg, log, nil, nil)
}

// buildLLMChainWithRuntime — внутренняя версия с опциональным pool'ом для
// runtime-config-source и ctx для остановки background refresh'а. Вызывается
// из BuildLLMChainWithCache когда Pool/ctx доступны.
func buildLLMChainWithRuntime(cfg config.Config, log *slog.Logger, pool *pgxpool.Pool, runtimeCtx context.Context) (*llmchain.Chain, error) {
	drivers := map[llmchain.Provider]llmchain.Driver{}

	// splitKeys — поддержка multi-key режима: env-var может содержать
	// CSV из нескольких API-ключей одного провайдера.
	splitKeys := func(raw string) []string {
		if raw == "" {
			return nil
		}
		parts := strings.Split(raw, ",")
		out := make([]string, 0, len(parts))
		for _, p := range parts {
			if p = strings.TrimSpace(p); p != "" {
				out = append(out, p)
			}
		}
		return out
	}

	// Read admin-managed keys из dynamic_config[llm_provider_keys]. Эти
	// ключи объединяются с env (env-keys + db-keys → один MultiKeyDriver).
	// При nil-pool / отсутствии row / парсинг-ошибке тихо игнорим — fallback
	// на чистый env-режим. Без try/recover чтобы typed-error не упал в
	// rebuild-handler'е (там pool гарантирован).
	dbKeys := map[string][]string{}
	if pool != nil {
		var raw string
		if err := pool.QueryRow(runtimeCtx,
			`SELECT value::text FROM dynamic_config WHERE key = $1`,
			LLMProviderKeysConfigKey,
		).Scan(&raw); err == nil && raw != "" && raw != "null" {
			parsed := map[string][]string{}
			if jerr := json.Unmarshal([]byte(raw), &parsed); jerr == nil {
				dbKeys = parsed
			} else if log != nil {
				log.Warn("llmchain: dynamic_config[llm_provider_keys] parse failed",
					slog.String("err", jerr.Error()))
			}
		}
	}
	// Объединяет env-CSV + DB-list, удаляя пустые. Дубли допускаются —
	// MultiKeyDriver round-robin'ит, повтор просто увеличит вероятность
	// выбора этого ключа (admin может намеренно дублировать ключ,
	// который ему даёт высший free-quota).
	mergeKeys := func(envCSV, provider string) []string {
		out := splitKeys(envCSV)
		for _, k := range dbKeys[provider] {
			if k = strings.TrimSpace(k); k != "" {
				out = append(out, k)
			}
		}
		return out
	}
	wrapMulti := func(p llmchain.Provider, ds []llmchain.Driver) llmchain.Driver {
		if len(ds) == 1 {
			return ds[0]
		}
		return llmchain.NewMultiKeyDriver(p, ds, log)
	}

	if keys := mergeKeys(cfg.LLMChain.GroqAPIKey, "groq"); len(keys) > 0 {
		ds := make([]llmchain.Driver, 0, len(keys))
		for _, k := range keys {
			ds = append(ds, llmchain.NewGroqDriver(k))
		}
		drivers[llmchain.ProviderGroq] = wrapMulti(llmchain.ProviderGroq, ds)
	} else {
		log.Warn("llmchain: GROQ_API_KEY not set — primary provider disabled")
	}
	if keys := mergeKeys(cfg.LLMChain.CerebrasAPIKey, "cerebras"); len(keys) > 0 {
		ds := make([]llmchain.Driver, 0, len(keys))
		for _, k := range keys {
			ds = append(ds, llmchain.NewCerebrasDriver(k))
		}
		drivers[llmchain.ProviderCerebras] = wrapMulti(llmchain.ProviderCerebras, ds)
	} else {
		log.Warn("llmchain: CEREBRAS_API_KEY not set — secondary provider disabled")
	}
	if keys := mergeKeys(cfg.LLMChain.MistralAPIKey, "mistral"); len(keys) > 0 {
		ds := make([]llmchain.Driver, 0, len(keys))
		for _, k := range keys {
			ds = append(ds, llmchain.NewMistralDriver(k))
		}
		drivers[llmchain.ProviderMistral] = wrapMulti(llmchain.ProviderMistral, ds)
	}
	if keys := mergeKeys(cfg.LLMChain.GoogleAPIKey, "google"); len(keys) > 0 {
		ds := make([]llmchain.Driver, 0, len(keys))
		for _, k := range keys {
			ds = append(ds, llmchain.NewGoogleDriver(k))
		}
		drivers[llmchain.ProviderGoogle] = wrapMulti(llmchain.ProviderGoogle, ds)
	}
	if cfg.LLMChain.CloudflareAPIKey != "" && cfg.LLMChain.CloudflareAccountID != "" {
		// Cloudflare требует пару (api_key, account_id). Multi-key поддерживается
		// через CSV в API_KEY при ОДНОМ account_id; для разных аккаунтов
		// нужна отдельная env-пара (на текущий момент не реализовано — у
		// большинства юзеров один Cloudflare account).
		keys := mergeKeys(cfg.LLMChain.CloudflareAPIKey, "cloudflare")
		ds := make([]llmchain.Driver, 0, len(keys))
		for _, k := range keys {
			if d := llmchain.NewCloudflareDriver(k, cfg.LLMChain.CloudflareAccountID); d != nil {
				ds = append(ds, d)
			}
		}
		if len(ds) > 0 {
			drivers[llmchain.ProviderCloudflare] = wrapMulti(llmchain.ProviderCloudflare, ds)
		}
	}
	if keys := mergeKeys(cfg.LLMChain.ZAIAPIKey, "zai"); len(keys) > 0 {
		ds := make([]llmchain.Driver, 0, len(keys))
		for _, k := range keys {
			ds = append(ds, llmchain.NewZAIDriver(k))
		}
		drivers[llmchain.ProviderZAI] = wrapMulti(llmchain.ProviderZAI, ds)
	}
	// OpenRouter key is shared с legacy LLM config section.
	if keys := mergeKeys(cfg.LLM.OpenRouterAPIKey, "openrouter"); len(keys) > 0 {
		ds := make([]llmchain.Driver, 0, len(keys))
		for _, k := range keys {
			ds = append(ds, llmchain.NewOpenRouterDriver(k))
		}
		drivers[llmchain.ProviderOpenRouter] = wrapMulti(llmchain.ProviderOpenRouter, ds)
	}
	// DeepSeek direct — платный, multi-key менее актуален (у платных
	// аккаунтов нет per-key квот), но supported by symmetry.
	if keys := mergeKeys(cfg.LLMChain.DeepSeekAPIKey, "deepseek"); len(keys) > 0 {
		ds := make([]llmchain.Driver, 0, len(keys))
		for _, k := range keys {
			ds = append(ds, llmchain.NewDeepSeekDriver(k))
		}
		drivers[llmchain.ProviderDeepSeek] = wrapMulti(llmchain.ProviderDeepSeek, ds)
	}
	// Ollama self-hosted sidecar — self-hosted floor-fallback против
	// исчерпания cloud free-tier квот. Регистрируется только при явно
	// заданном OLLAMA_HOST (пустой host ⇒ NewOllamaDriver возвращает nil
	// и сервис остаётся cloud-only). Из default LLM_CHAIN_ORDER Ollama
	// отсутствует — оператор включает его явно, напр.
	// LLM_CHAIN_ORDER=groq,cerebras,openrouter,ollama.
	if cfg.LLMChain.OllamaHost != "" {
		if d := llmchain.NewOllamaDriver(cfg.LLMChain.OllamaHost); d != nil {
			drivers[llmchain.ProviderOllama] = d
		}
	}

	if len(drivers) == 0 {
		log.Warn("llmchain: no provider API keys configured — chain unavailable, services will degrade to error")
		// Returning nil is intentional: callers check `if chain != nil`
		// and fall back to the feature-disabled branch (same contract
		// as OPENROUTER_API_KEY=""). NewChain would error out here.
		return nil, nil
	}

	order := parseChainOrder(cfg.LLMChain.ChainOrder)
	opts := llmchain.Options{
		Order: order,
		Log:   log,
	}
	// Runtime-reloadable config из БД — опционально. Без pool'а
	// (например backfill-скрипты / тесты) chain работает на static defaults.
	if pool != nil {
		opts.RuntimeConfigSource = newLLMConfigSource(pool)
		opts.RuntimeCtx = runtimeCtx
	}
	chain, err := llmchain.NewChain(drivers, opts)
	if err != nil {
		return nil, fmt.Errorf("llmchain: build chain: %w", err)
	}
	return chain, nil
}

// BuildLLMChainWithCache оборачивает raw *llmchain.Chain семантическим
// кешем (llmcache.CachingChain) поверх Ollama embedder'а + Redis.
//
// Возвращает:
//   - client: llmchain.ChatClient, которым инициализируется Deps.LLMChain
//     (nil если BuildLLMChain вернул nil — т.е. ни один провайдер не
//     зарегистрирован, сервисы должны деградировать как раньше).
//   - shutdown: no-op когда cache disabled, иначе дренит worker-пул.
//     Вызывающий код обязан поставить shutdown в deferred-shutdown список.
//
// Graceful degradation: если OLLAMA_HOST пуст ИЛИ Redis nil ⇒ cache =
// NoopCache, CachingChain всё равно оборачивает Chain чтобы Deps.LLMChain
// имел единый тип (llmchain.ChatClient) независимо от конфига. Lookup
// превращается в мгновенный miss, Store — no-op.
func BuildLLMChainWithCache(cfg config.Config, log *slog.Logger, rdb *redis.Client, pool *pgxpool.Pool, runtimeCtx context.Context) (llmchain.ChatClient, *llmchain.Chain, func() error, error) {
	raw, err := buildLLMChainWithRuntime(cfg, log, pool, runtimeCtx)
	if err != nil {
		return nil, nil, func() error { return nil }, err
	}
	if raw == nil {
		// Ни одного драйвера не зарегистрировано — сервисы видят nil и
		// идут в свою disabled-ветку. Обёртка не нужна.
		return nil, nil, func() error { return nil }, nil
	}
	var cache llmcache.Cache = llmcache.NoopCache{}
	if cfg.LLMChain.OllamaHost != "" && rdb != nil {
		embedder := llmcache.NewOllamaEmbedder(cfg.LLMChain.OllamaHost, llmcache.DefaultOllamaEmbedModel, 0)
		cache = llmcache.NewSemanticCache(rdb, embedder, llmcache.Options{Log: log})
		log.Info("llmcache: semantic cache enabled",
			slog.String("ollama_host", cfg.LLMChain.OllamaHost),
			slog.String("embed_model", llmcache.DefaultOllamaEmbedModel))
	} else {
		log.Info("llmcache: semantic cache disabled (OLLAMA_HOST or Redis unavailable) — passthrough only")
	}
	cc := &llmcache.CachingChain{Chain: raw, Cache: cache, Log: log}
	return cc, raw, cache.Close, nil
}

// parseChainOrder turns "groq,cerebras,openrouter" into the typed slice.
// Whitespace and empty segments are ignored. Unknown tokens are
// dropped with a silent skip — the chain's constructor WARNs about
// entries that don't match any registered driver, so the operator sees
// the typo there. Empty input returns the baked-in default
// (groq → cerebras → openrouter — Mistral absent).
//
// Recommended prod string once все ключи выставлены:
//
//	LLM_CHAIN_ORDER=groq,cerebras,google,cloudflare,zai,mistral,openrouter,deepseek,ollama
//
// Rationale: Groq/Cerebras — самые быстрые free-tier (фронт цепочки для
// латенси-чувствительных task'ов); Google/Cloudflare/Z.AI/Mistral/OpenRouter
// покрывают хвост free-tier квот; DeepSeek и Ollama подключаются только
// для paid-цепочек (druz9/pro/ultra/reasoning) и self-host floor'а.
func parseChainOrder(raw string) []llmchain.Provider {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return []llmchain.Provider{
			llmchain.ProviderGroq,
			llmchain.ProviderCerebras,
			llmchain.ProviderOpenRouter,
		}
	}
	parts := strings.Split(raw, ",")
	out := make([]llmchain.Provider, 0, len(parts))
	for _, p := range parts {
		p = strings.TrimSpace(p)
		if p == "" {
			continue
		}
		out = append(out, llmchain.Provider(p))
	}
	return out
}
