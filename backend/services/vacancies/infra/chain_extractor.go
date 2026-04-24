// chain_extractor.go — vacancies.SkillExtractor wrapper that dispatches
// through shared/pkg/llmchain.
//
// Intentionally coexists with openrouter_extractor.go rather than
// replacing it: the direct-OpenRouter path is still useful in dev
// environments without a Groq/Cerebras key, and the single-provider
// client is simpler to reason about when debugging extraction quality
// regressions. Which one gets wired is decided by the wirer
// (cmd/monolith/services/vacancies.go).
//
// Caching model change vs OpenRouter path: the chain extractor's cache
// key is (description, user-chosen-model-or-"turbo"). It is NOT keyed
// by the provider that actually served the call. That is deliberate —
// two users with the same description should share a cache entry even
// if Groq served user A and Cerebras served user B. The chain is
// provider-opaque from the caller's perspective; caching has to be
// too, otherwise a Groq-cold day would invalidate every prior hit.
package infra

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"druz9/shared/pkg/llmchain"
	"druz9/shared/pkg/metrics"
)

// ChainExtractor is the llmchain-backed implementation of
// vacancies/domain.SkillExtractor. It talks to the shared chain using
// Task=VacanciesJSON, which picks llama-3.1-8b-instant on Groq /
// llama3.1-8b on Cerebras / qwen3-coder:free on OpenRouter — all models
// we've verified hold strict JSON reliably on vacancy-length inputs.
//
// modelOverride semantics mirror the OpenRouter extractor: empty string
// = "use chain default (Turbo routing)"; non-empty = pin that specific
// model id via chain.Request.ModelOverride. User settings
// (users.ai_vacancies_model) are the caller's source of truth for
// which override to pass — see the vacancies app layer.
type ChainExtractor struct {
	// chain — llmchain.ChatClient (интерфейсный тип), чтобы монолит мог
	// подсунуть декоратор (llmcache.CachingChain) без правок тут.
	chain    llmchain.ChatClient
	kv       KV
	cacheTTL time.Duration
	log      *slog.Logger
}

// NewChainExtractor constructs the adapter. chain MUST be non-nil (the
// wirer checks before calling). log is required per anti-fallback policy.
func NewChainExtractor(chain llmchain.ChatClient, kv KV, log *slog.Logger) *ChainExtractor {
	if chain == nil {
		panic("vacancies.infra.NewChainExtractor: chain is required")
	}
	if log == nil {
		panic("vacancies.infra.NewChainExtractor: logger is required (anti-fallback policy)")
	}
	return &ChainExtractor{
		chain:    chain,
		kv:       kv,
		cacheTTL: DefaultExtractorCacheTTL,
		log:      log,
	}
}

// Extract implements domain.SkillExtractor.
func (e *ChainExtractor) Extract(ctx context.Context, description, modelOverride string) ([]string, error) {
	desc := strings.TrimSpace(description)
	if desc == "" {
		return []string{}, nil
	}
	modelKey := strings.TrimSpace(modelOverride)
	if modelKey == "" {
		modelKey = "turbo" // stable cache-key marker for default routing
	}

	if e.kv != nil {
		if raw, err := e.kv.Get(ctx, chainExtractCacheKey(desc, modelKey)); err == nil {
			var out []string
			if jerr := json.Unmarshal([]byte(raw), &out); jerr == nil {
				return out, nil
			}
			e.log.Warn("vacancies.chain_extractor: corrupt cache entry, refetching")
		} else if !errors.Is(err, ErrCacheMiss) {
			return nil, fmt.Errorf("vacancies.chain_extractor: cache Get: %w", err)
		}
	}

	req := llmchain.Request{
		Messages: []llmchain.Message{
			{Role: llmchain.RoleSystem, Content: systemPrompt},
			{Role: llmchain.RoleUser, Content: "Extract skills:\n\n" + truncateDesc(desc, 6000)},
		},
		Temperature: 0.1,
		MaxTokens:   256,
		JSONMode:    true,
	}
	if modelOverride == "" {
		req.Task = llmchain.TaskVacanciesJSON
	} else {
		req.ModelOverride = modelOverride
	}

	resp, err := e.chain.Chat(ctx, req)
	if err != nil {
		return nil, fmt.Errorf("vacancies.chain_extractor: %w", err)
	}

	skills := parseSkillList(resp.Content)
	if e.kv != nil {
		if data, jerr := json.Marshal(skills); jerr == nil {
			if serr := e.kv.Set(ctx, chainExtractCacheKey(desc, modelKey), data, e.cacheTTL); serr != nil {
				metrics.CacheSetErrorsTotal.WithLabelValues("vacancies_chain_extractor").Inc()
				e.log.Warn("vacancies.chain_extractor: cache Set failed", slog.Any("err", serr))
			}
		}
	}
	return skills, nil
}

// chainExtractCacheKey — namespaced separately from the OpenRouter
// extractor's keys so the two paths don't cross-contaminate during
// rollout. Shares the CacheKeyVersion rotator; bump that in the shared
// file to invalidate every extractor cache at once.
func chainExtractCacheKey(description, modelKey string) string {
	sum := sha256.Sum256([]byte(strings.TrimSpace(description)))
	return fmt.Sprintf("vacancies:%s:chain_skills:%s:%s",
		CacheKeyVersion, modelKey, hex.EncodeToString(sum[:16]))
}

func truncateDesc(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + "…"
}
