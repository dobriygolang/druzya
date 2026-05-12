// byok_validator.go — HTTP-валидатор BYOK ключей против endpoint'а
// провайдера. Минимальный 1-token request (cheapest possible): достаточно
// чтобы проверить «401 vs 200» без burn'а лимита.
package infra

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"druz9/subscription/domain"
)

// BYOKValidator — production-валидатор. Каждый провайдер имеет свой endpoint
// и формат payload'а; держим маппинг inline.
type BYOKValidator struct {
	HTTP *http.Client
}

// NewBYOKValidator — конструктор. Timeout 6s — достаточно даже для cold
// edge LLM endpoint'а, не слишком долго чтобы юзер не успел refresh'нуть.
func NewBYOKValidator() *BYOKValidator {
	return &BYOKValidator{HTTP: &http.Client{Timeout: 6 * time.Second}}
}

// Validate отправляет min-cost request к провайдеру с этим ключом.
// nil = ключ принят. Возвращаемый error — best-effort, не пытается
// различить 401 от 500: caller (SetBYOKKey UC) трактует любое != nil как
// «ключ не принят».
func (v *BYOKValidator) Validate(ctx context.Context, provider domain.BYOKProvider, plainKey string) error {
	cfg, ok := validatorConfigs[provider]
	if !ok {
		return fmt.Errorf("subscription.byok: unsupported provider %q", provider)
	}
	body, err := json.Marshal(cfg.body)
	if err != nil {
		return fmt.Errorf("subscription.byok: marshal: %w", err)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, cfg.url, bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("subscription.byok: new req: %w", err)
	}
	req.Header.Set("content-type", "application/json")
	cfg.authHeader(req, plainKey)
	resp, err := v.HTTP.Do(req)
	if err != nil {
		return fmt.Errorf("subscription.byok: http: %w", err)
	}
	defer resp.Body.Close()
	// 200/2xx = success; 4xx = bad key; 5xx = провайдер прилёг — тоже
	// не принимаем (не хотим хранить непровалидированный ключ).
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("subscription.byok: provider returned %d", resp.StatusCode)
	}
	return nil
}

// providerCfg — таблица провайдер → URL + body + auth-style.
type providerCfg struct {
	url        string
	body       map[string]any
	authHeader func(req *http.Request, key string)
}

// validatorConfigs — статическая карта endpoint'ов. Min-cost shapes:
// 1 token max, no streaming, простейший prompt. См. memory/feedback_providers.md
// о cascade order.
var validatorConfigs = map[domain.BYOKProvider]providerCfg{
	domain.BYOKProviderOpenRouter: {
		url:  "https://openrouter.ai/api/v1/chat/completions",
		body: map[string]any{"model": "openai/gpt-4o-mini", "max_tokens": 1, "messages": []map[string]string{{"role": "user", "content": "hi"}}},
		authHeader: func(req *http.Request, key string) {
			req.Header.Set("authorization", "Bearer "+key)
		},
	},
	domain.BYOKProviderGroq: {
		url:  "https://api.groq.com/openai/v1/chat/completions",
		body: map[string]any{"model": "llama-3.1-8b-instant", "max_tokens": 1, "messages": []map[string]string{{"role": "user", "content": "hi"}}},
		authHeader: func(req *http.Request, key string) {
			req.Header.Set("authorization", "Bearer "+key)
		},
	},
	domain.BYOKProviderCerebras: {
		url:  "https://api.cerebras.ai/v1/chat/completions",
		body: map[string]any{"model": "llama3.1-8b", "max_tokens": 1, "messages": []map[string]string{{"role": "user", "content": "hi"}}},
		authHeader: func(req *http.Request, key string) {
			req.Header.Set("authorization", "Bearer "+key)
		},
	},
	domain.BYOKProviderAnthropic: {
		url:  "https://api.anthropic.com/v1/messages",
		body: map[string]any{"model": "claude-3-5-haiku-latest", "max_tokens": 1, "messages": []map[string]string{{"role": "user", "content": "hi"}}},
		authHeader: func(req *http.Request, key string) {
			req.Header.Set("x-api-key", key)
			req.Header.Set("anthropic-version", "2023-06-01")
		},
	},
	domain.BYOKProviderOpenAI: {
		url:  "https://api.openai.com/v1/chat/completions",
		body: map[string]any{"model": "gpt-4o-mini", "max_tokens": 1, "messages": []map[string]string{{"role": "user", "content": "hi"}}},
		authHeader: func(req *http.Request, key string) {
			req.Header.Set("authorization", "Bearer "+key)
		},
	},
}
