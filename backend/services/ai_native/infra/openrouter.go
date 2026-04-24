package infra

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	"druz9/ai_native/domain"
)

// OpenRouterURL is the OpenAI-compatible chat-completions endpoint.
const OpenRouterURL = "https://openrouter.ai/api/v1/chat/completions"

// OpenRouter is a thin non-streaming HTTP client for OpenRouter. It implements
// domain.LLMProvider — ai_native has its own interface by design (no import
// from ai_mock).
type OpenRouter struct {
	apiKey        string
	endpoint      string
	httpClient    *http.Client
	maxRetries429 int
	baseBackoff   time.Duration
}

// NewOpenRouter returns a default-configured client.
func NewOpenRouter(apiKey string) *OpenRouter {
	return &OpenRouter{
		apiKey:   apiKey,
		endpoint: OpenRouterURL,
		// 180s — bumped from 120s for consistency with the rest of the
		// LLM clients; reasoning-tier models on big contexts occasionally
		// brushed against 120s.
		httpClient:    &http.Client{Timeout: 180 * time.Second},
		maxRetries429: 3,
		baseBackoff:   500 * time.Millisecond,
	}
}

// WithEndpoint overrides the endpoint — used by tests.
func (c *OpenRouter) WithEndpoint(u string) *OpenRouter { c.endpoint = u; return c }

// WithHTTPClient overrides the HTTP client — used by tests.
func (c *OpenRouter) WithHTTPClient(h *http.Client) *OpenRouter { c.httpClient = h; return c }

type orRequest struct {
	Model       string      `json:"model"`
	Messages    []orMessage `json:"messages"`
	Temperature float64     `json:"temperature,omitempty"`
	MaxTokens   int         `json:"max_tokens,omitempty"`
}

type orMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type orResponse struct {
	ID      string `json:"id"`
	Choices []struct {
		Message struct {
			Content string `json:"content"`
		} `json:"message"`
	} `json:"choices"`
	Usage struct {
		TotalTokens int `json:"total_tokens"`
	} `json:"usage"`
	Model string `json:"model"`
}

// Complete implements domain.LLMProvider.
func (c *OpenRouter) Complete(ctx context.Context, req domain.CompletionRequest) (domain.CompletionResponse, error) {
	body, err := json.Marshal(orRequest{
		Model:       req.Model,
		Messages:    toORMessages(req.Messages),
		Temperature: req.Temperature,
		MaxTokens:   req.MaxTokens,
	})
	if err != nil {
		return domain.CompletionResponse{}, fmt.Errorf("native.OpenRouter.Complete: marshal: %w", err)
	}

	resp, err := c.doWithRetries(ctx, body)
	if err != nil {
		return domain.CompletionResponse{}, err
	}
	defer resp.Body.Close()

	var parsed orResponse
	if err := json.NewDecoder(resp.Body).Decode(&parsed); err != nil {
		return domain.CompletionResponse{}, fmt.Errorf("native.OpenRouter.Complete: decode: %w", err)
	}
	if len(parsed.Choices) == 0 {
		return domain.CompletionResponse{}, fmt.Errorf("native.OpenRouter.Complete: empty choices")
	}
	return domain.CompletionResponse{
		Content:    parsed.Choices[0].Message.Content,
		TokensUsed: parsed.Usage.TotalTokens,
		Model:      parsed.Model,
	}, nil
}

func (c *OpenRouter) doWithRetries(ctx context.Context, body []byte) (*http.Response, error) {
	var lastErr error
	for attempt := 0; attempt <= c.maxRetries429; attempt++ {
		req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.endpoint, bytes.NewReader(body))
		if err != nil {
			return nil, fmt.Errorf("native.OpenRouter.do: new request: %w", err)
		}
		req.Header.Set("Content-Type", "application/json")
		if c.apiKey != "" {
			req.Header.Set("Authorization", "Bearer "+c.apiKey)
		}
		resp, err := c.httpClient.Do(req)
		if err != nil {
			lastErr = err
			if ctx.Err() != nil {
				return nil, fmt.Errorf("native.OpenRouter.do: ctx cancelled: %w", ctx.Err())
			}
			if attempt < c.maxRetries429 {
				if werr := backoffWait(ctx, c.baseBackoff, attempt); werr != nil {
					return nil, werr
				}
				continue
			}
			return nil, fmt.Errorf("native.OpenRouter.do: %w", err)
		}
		if resp.StatusCode == http.StatusTooManyRequests {
			retryAfter := parseRetryAfter(resp.Header.Get("Retry-After"))
			_ = resp.Body.Close()
			if attempt >= c.maxRetries429 {
				return nil, fmt.Errorf("native.OpenRouter.do: 429 after %d attempts", attempt+1)
			}
			if retryAfter > 0 {
				select {
				case <-ctx.Done():
					return nil, fmt.Errorf("native.OpenRouter.do: ctx cancelled: %w", ctx.Err())
				case <-time.After(retryAfter):
				}
			} else {
				if werr := backoffWait(ctx, c.baseBackoff, attempt); werr != nil {
					return nil, werr
				}
			}
			continue
		}
		if resp.StatusCode >= 400 {
			b, _ := io.ReadAll(resp.Body)
			_ = resp.Body.Close()
			return nil, fmt.Errorf("native.OpenRouter.do: http %d: %s", resp.StatusCode, string(b))
		}
		return resp, nil
	}
	if lastErr != nil {
		return nil, fmt.Errorf("native.OpenRouter.do: exhausted retries: %w", lastErr)
	}
	return nil, fmt.Errorf("native.OpenRouter.do: exhausted retries")
}

func backoffWait(ctx context.Context, base time.Duration, attempt int) error {
	d := base << attempt
	select {
	case <-ctx.Done():
		return fmt.Errorf("native.OpenRouter.backoff: ctx cancelled: %w", ctx.Err())
	case <-time.After(d):
		return nil
	}
}

func parseRetryAfter(h string) time.Duration {
	if h == "" {
		return 0
	}
	if n, err := strconv.Atoi(strings.TrimSpace(h)); err == nil && n > 0 {
		return time.Duration(n) * time.Second
	}
	return 0
}

func toORMessages(in []domain.LLMMessage) []orMessage {
	out := make([]orMessage, 0, len(in))
	for _, m := range in {
		out = append(out, orMessage{Role: string(m.Role), Content: m.Content})
	}
	return out
}

// ─────────────────────────────────────────────────────────────────────────
// TrapInjector — decorator around any LLMProvider that occasionally swaps
// the real completion for a curated hallucination trap. Testable without a
// real HTTP client: feed a stub LLMProvider.
// ─────────────────────────────────────────────────────────────────────────

// TrapInjector wraps an inner provider and, when ShouldFire(req) returns true,
// substitutes the response with a trap drawn from the store.
//
// The caller is responsible for remembering which requests were trap-substituted
// (the returned CompletionResponse.ContainsTrap + TrapID carry that state).
type TrapInjector struct {
	Inner      domain.LLMProvider
	Store      domain.TrapStore
	ShouldFire func(req domain.CompletionRequest) (section string, fire bool)
}

// NewTrapInjector is a small convenience constructor.
func NewTrapInjector(inner domain.LLMProvider, store domain.TrapStore, shouldFire func(domain.CompletionRequest) (string, bool)) *TrapInjector {
	return &TrapInjector{Inner: inner, Store: store, ShouldFire: shouldFire}
}

// Complete implements domain.LLMProvider.
func (t *TrapInjector) Complete(ctx context.Context, req domain.CompletionRequest) (domain.CompletionResponse, error) {
	if t.ShouldFire != nil && t.Store != nil {
		if section, fire := t.ShouldFire(req); fire {
			// Reconstruct the user prompt — last user message body.
			lastUser := ""
			for i := len(req.Messages) - 1; i >= 0; i-- {
				if req.Messages[i].Role == domain.LLMRoleUser {
					lastUser = req.Messages[i].Content
					break
				}
			}
			if trap, ok := t.Store.Pick(lastUser, section); ok {
				return domain.CompletionResponse{
					Content:      trap.WrongAnswer,
					TokensUsed:   0,
					Model:        req.Model,
					ContainsTrap: true,
					TrapID:       trap.ID,
				}, nil
			}
		}
	}
	resp, err := t.Inner.Complete(ctx, req)
	if err != nil {
		return resp, fmt.Errorf("native.TrapInjector.Complete: %w", err)
	}
	return resp, nil
}

// Interface guards.
var (
	_ domain.LLMProvider = (*OpenRouter)(nil)
	_ domain.LLMProvider = (*TrapInjector)(nil)
)
