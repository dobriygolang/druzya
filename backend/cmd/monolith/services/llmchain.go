package services

import (
	"fmt"
	"log/slog"
	"strings"

	"druz9/shared/pkg/config"
	"druz9/shared/pkg/llmchain"
)

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
func BuildLLMChain(cfg config.Config, log *slog.Logger) (*llmchain.Chain, error) {
	drivers := map[llmchain.Provider]llmchain.Driver{}

	if cfg.LLMChain.GroqAPIKey != "" {
		drivers[llmchain.ProviderGroq] = llmchain.NewGroqDriver(cfg.LLMChain.GroqAPIKey)
	} else {
		log.Warn("llmchain: GROQ_API_KEY not set — primary provider disabled")
	}
	if cfg.LLMChain.CerebrasAPIKey != "" {
		drivers[llmchain.ProviderCerebras] = llmchain.NewCerebrasDriver(cfg.LLMChain.CerebrasAPIKey)
	} else {
		log.Warn("llmchain: CEREBRAS_API_KEY not set — secondary provider disabled")
	}
	if cfg.LLMChain.MistralAPIKey != "" {
		drivers[llmchain.ProviderMistral] = llmchain.NewMistralDriver(cfg.LLMChain.MistralAPIKey)
	}
	// SambaNova Cloud — щедрый free tier на Llama-70B / DeepSeek-R1 /
	// Qwen-72B. Самый быстрый по tok/s из всех (~580 tok/s), удобен как
	// primary для reasoning-heavy тасок.
	if cfg.LLMChain.SambaNovaAPIKey != "" {
		drivers[llmchain.ProviderSambaNova] = llmchain.NewSambaNovaDriver(cfg.LLMChain.SambaNovaAPIKey)
	}
	// Cloudflare Workers AI — требует ДВА секрета (accountID в URL +
	// Bearer токен). Регистрируем только когда оба выставлены:
	// driver с пустым accountID всегда получит 404, а пустой токен —
	// 401; в обоих случаях это одно мёртвое звено цепочки на каждый
	// запрос.
	if cfg.LLMChain.CloudflareAIAccountID != "" && cfg.LLMChain.CloudflareAIToken != "" {
		drivers[llmchain.ProviderCloudflareAI] = llmchain.NewCloudflareAIDriver(
			cfg.LLMChain.CloudflareAIAccountID,
			cfg.LLMChain.CloudflareAIToken,
		)
	} else if cfg.LLMChain.CloudflareAIAccountID != "" || cfg.LLMChain.CloudflareAIToken != "" {
		// Only one of the two was set — operator mistake, loud warn.
		log.Warn("llmchain: Cloudflare AI partial config — need BOTH CLOUDFLARE_AI_ACCOUNT_ID and CLOUDFLARE_AI_TOKEN, skipping")
	}
	// OpenRouter key is shared with the legacy LLM config section so
	// back-compat callers (the Insight client, existing copilot) keep
	// working while the chain coexists during rollout.
	if cfg.LLM.OpenRouterAPIKey != "" {
		drivers[llmchain.ProviderOpenRouter] = llmchain.NewOpenRouterDriver(cfg.LLM.OpenRouterAPIKey)
	}

	if len(drivers) == 0 {
		log.Warn("llmchain: no provider API keys configured — chain unavailable, services will degrade to error")
		// Returning nil is intentional: callers check `if chain != nil`
		// and fall back to the feature-disabled branch (same contract
		// as OPENROUTER_API_KEY=""). NewChain would error out here.
		return nil, nil
	}

	order := parseChainOrder(cfg.LLMChain.ChainOrder)
	chain, err := llmchain.NewChain(drivers, llmchain.Options{
		Order: order,
		Log:   log,
	})
	if err != nil {
		return nil, fmt.Errorf("llmchain: build chain: %w", err)
	}
	return chain, nil
}

// parseChainOrder turns "groq,cerebras,openrouter" into the typed slice.
// Whitespace and empty segments are ignored. Unknown tokens are
// dropped with a silent skip — the chain's constructor WARNs about
// entries that don't match any registered driver, so the operator sees
// the typo there. Empty input returns the baked-in default
// (groq → cerebras → openrouter — Mistral absent).
//
// Recommended prod string once all keys are set:
//
//	LLM_CHAIN_ORDER=sambanova,groq,cerebras,cloudflare,mistral,openrouter
//
// Rationale: SambaNova is both the fastest free-tier (~580 tok/s) and
// the most generous on 70B reasoning, so it leads; Groq/Cerebras keep
// their speed-oriented role for short-JSON tasks; Cloudflare fills the
// "another free 70B pool" slot for when the rest are cooled;
// Mistral/OpenRouter remain as last-resort fallbacks.
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
