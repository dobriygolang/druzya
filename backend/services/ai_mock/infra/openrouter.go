package infra

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	"druz9/ai_mock/domain"
)

// OpenRouterURL is the OpenAI-compatible chat-completions endpoint.
const OpenRouterURL = "https://openrouter.ai/api/v1/chat/completions"

// OpenRouter is a thin HTTP client for OpenRouter. It implements
// domain.LLMProvider.
type OpenRouter struct {
	apiKey     string
	endpoint   string
	httpClient *http.Client
	// maxRetries429 is the retry budget for HTTP 429 responses. Default 3.
	maxRetries429 int
	// baseBackoff is the starting exponential-backoff delay.
	baseBackoff time.Duration
}

// NewOpenRouter returns a default-configured client.
func NewOpenRouter(apiKey string) *OpenRouter {
	return &OpenRouter{
		apiKey:        apiKey,
		endpoint:      OpenRouterURL,
		httpClient:    &http.Client{Timeout: 120 * time.Second},
		maxRetries429: 3,
		baseBackoff:   500 * time.Millisecond,
	}
}

// WithEndpoint overrides the endpoint — used by tests.
func (c *OpenRouter) WithEndpoint(u string) *OpenRouter { c.endpoint = u; return c }

// WithHTTPClient overrides the HTTP client — used by tests.
func (c *OpenRouter) WithHTTPClient(h *http.Client) *OpenRouter { c.httpClient = h; return c }

// ─────────────────────────────────────────────────────────────────────────
// Wire format (OpenAI chat-completions compatible).
// ─────────────────────────────────────────────────────────────────────────

type orRequest struct {
	Model       string      `json:"model"`
	Messages    []orMessage `json:"messages"`
	Stream      bool        `json:"stream,omitempty"`
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

type orStreamChunk struct {
	Choices []struct {
		Delta struct {
			Content string `json:"content"`
		} `json:"delta"`
		FinishReason *string `json:"finish_reason"`
	} `json:"choices"`
	Usage *struct {
		TotalTokens int `json:"total_tokens"`
	} `json:"usage"`
}

// ─────────────────────────────────────────────────────────────────────────
// Complete — non-streaming.
// ─────────────────────────────────────────────────────────────────────────

// Complete implements domain.LLMProvider.
func (c *OpenRouter) Complete(ctx context.Context, req domain.CompletionRequest) (domain.CompletionResponse, error) {
	body, err := json.Marshal(orRequest{
		Model:       req.Model,
		Messages:    toORMessages(req.Messages),
		Temperature: req.Temperature,
		MaxTokens:   req.MaxTokens,
	})
	if err != nil {
		return domain.CompletionResponse{}, fmt.Errorf("mock.OpenRouter.Complete: marshal: %w", err)
	}

	resp, err := c.doWithRetries(ctx, body, false)
	if err != nil {
		return domain.CompletionResponse{}, err
	}
	defer resp.Body.Close()

	var parsed orResponse
	if err := json.NewDecoder(resp.Body).Decode(&parsed); err != nil {
		return domain.CompletionResponse{}, fmt.Errorf("mock.OpenRouter.Complete: decode: %w", err)
	}
	if len(parsed.Choices) == 0 {
		return domain.CompletionResponse{}, fmt.Errorf("mock.OpenRouter.Complete: empty choices")
	}
	return domain.CompletionResponse{
		Content:    parsed.Choices[0].Message.Content,
		TokensUsed: parsed.Usage.TotalTokens,
		Model:      parsed.Model,
	}, nil
}

// ─────────────────────────────────────────────────────────────────────────
// Stream — SSE line-by-line.
// ─────────────────────────────────────────────────────────────────────────

// Stream implements domain.LLMProvider. The returned channel is closed after
// the final token is delivered or an error is emitted.
func (c *OpenRouter) Stream(ctx context.Context, req domain.CompletionRequest) (<-chan domain.Token, error) {
	body, err := json.Marshal(orRequest{
		Model:       req.Model,
		Messages:    toORMessages(req.Messages),
		Stream:      true,
		Temperature: req.Temperature,
		MaxTokens:   req.MaxTokens,
	})
	if err != nil {
		return nil, fmt.Errorf("mock.OpenRouter.Stream: marshal: %w", err)
	}

	resp, err := c.doWithRetries(ctx, body, true) //nolint:bodyclose // closed in goroutine below
	if err != nil {
		return nil, err
	}

	out := make(chan domain.Token, 16)
	go func() {
		defer close(out)
		defer resp.Body.Close()

		reader := bufio.NewReader(resp.Body)
		for {
			if ctx.Err() != nil {
				out <- domain.Token{Err: ctx.Err(), Done: true}
				return
			}
			line, err := reader.ReadString('\n')
			if err != nil {
				if errors.Is(err, io.EOF) {
					out <- domain.Token{Done: true}
					return
				}
				out <- domain.Token{Err: err, Done: true}
				return
			}
			line = strings.TrimSpace(line)
			if line == "" || !strings.HasPrefix(line, "data:") {
				continue
			}
			data := strings.TrimSpace(strings.TrimPrefix(line, "data:"))
			if data == "[DONE]" {
				out <- domain.Token{Done: true}
				return
			}
			var chunk orStreamChunk
			if err := json.Unmarshal([]byte(data), &chunk); err != nil {
				// Skip malformed lines rather than abort — OpenRouter occasionally
				// emits keep-alive comments.
				continue
			}
			for _, ch := range chunk.Choices {
				if ch.Delta.Content != "" {
					out <- domain.Token{Delta: ch.Delta.Content}
				}
			}
			if chunk.Usage != nil {
				out <- domain.Token{Done: true, TokensUsed: chunk.Usage.TotalTokens}
				return
			}
		}
	}()
	return out, nil
}

// ─────────────────────────────────────────────────────────────────────────
// Transport
// ─────────────────────────────────────────────────────────────────────────

func (c *OpenRouter) doWithRetries(ctx context.Context, body []byte, stream bool) (*http.Response, error) {
	var lastErr error
	for attempt := 0; attempt <= c.maxRetries429; attempt++ {
		req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.endpoint, bytes.NewReader(body))
		if err != nil {
			return nil, fmt.Errorf("mock.OpenRouter.do: new request: %w", err)
		}
		req.Header.Set("Content-Type", "application/json")
		if c.apiKey != "" {
			req.Header.Set("Authorization", "Bearer "+c.apiKey)
		}
		if stream {
			req.Header.Set("Accept", "text/event-stream")
		}
		resp, err := c.httpClient.Do(req)
		if err != nil {
			lastErr = err
			if ctx.Err() != nil {
				return nil, fmt.Errorf("ctx cancelled: %w", ctx.Err())
			}
			// transport error — retry with backoff
			if attempt < c.maxRetries429 {
				if werr := backoffWait(ctx, c.baseBackoff, attempt); werr != nil {
					return nil, werr
				}
				continue
			}
			return nil, fmt.Errorf("mock.OpenRouter.do: %w", err)
		}
		if resp.StatusCode == http.StatusTooManyRequests {
			// Respect Retry-After if present.
			retryAfter := parseRetryAfter(resp.Header.Get("Retry-After"))
			_ = resp.Body.Close()
			if attempt >= c.maxRetries429 {
				return nil, fmt.Errorf("mock.OpenRouter.do: 429 after %d attempts", attempt+1)
			}
			if retryAfter > 0 {
				select {
				case <-ctx.Done():
					return nil, fmt.Errorf("ctx cancelled: %w", ctx.Err())
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
			return nil, fmt.Errorf("mock.OpenRouter.do: http %d: %s", resp.StatusCode, string(b))
		}
		return resp, nil
	}
	if lastErr != nil {
		return nil, fmt.Errorf("mock.OpenRouter.do: exhausted retries: %w", lastErr)
	}
	return nil, fmt.Errorf("mock.OpenRouter.do: exhausted retries")
}

func backoffWait(ctx context.Context, base time.Duration, attempt int) error {
	// 1x, 2x, 4x, 8x …
	d := base << attempt
	select {
	case <-ctx.Done():
		return fmt.Errorf("ctx cancelled: %w", ctx.Err())
	case <-time.After(d):
		return nil
	}
}

func parseRetryAfter(h string) time.Duration {
	if h == "" {
		return 0
	}
	// Typically an integer number of seconds.
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

// Interface guard.
var _ domain.LLMProvider = (*OpenRouter)(nil)
