package infra

import (
	"bufio"
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	"druz9/copilot/domain"
	"druz9/shared/enums"
)

// OpenRouterURL is the OpenAI-compatible chat-completions endpoint. Kept
// overridable for tests via WithEndpoint. We deliberately copy (rather than
// share) this client from ai_mock — the two bounded contexts use different
// domain.LLMProvider shapes and the duplication isolates change blast radius.
const OpenRouterURL = "https://openrouter.ai/api/v1/chat/completions"

// OpenRouter is a streaming OpenRouter client with OpenAI-compatible vision
// support. It implements domain.LLMProvider.
type OpenRouter struct {
	apiKey        string
	endpoint      string
	httpClient    *http.Client
	maxRetries429 int
	maxRetries5xx int
	baseBackoff   time.Duration
}

// NewOpenRouter returns a default-configured streaming client.
//
// Defaults: 60s request timeout (streams may stay open longer than ai_mock's
// text-only calls), 3 retries on 429 and 5xx, 500ms base exponential backoff.
func NewOpenRouter(apiKey string) *OpenRouter {
	return &OpenRouter{
		apiKey:        apiKey,
		endpoint:      OpenRouterURL,
		httpClient:    &http.Client{Timeout: 60 * time.Second},
		maxRetries429: 3,
		maxRetries5xx: 3,
		baseBackoff:   500 * time.Millisecond,
	}
}

// WithEndpoint overrides the endpoint — used by tests.
func (c *OpenRouter) WithEndpoint(u string) *OpenRouter { c.endpoint = u; return c }

// WithHTTPClient overrides the HTTP client — used by tests.
func (c *OpenRouter) WithHTTPClient(h *http.Client) *OpenRouter { c.httpClient = h; return c }

// ─────────────────────────────────────────────────────────────────────────
// Wire format — OpenAI chat-completions with vision support.
//
// When a message has no images, `content` is a plain string. When it has
// images, `content` is an array of parts: `[{type:"text", text:"..."},
// {type:"image_url", image_url:{url:"data:image/png;base64,..."}}]`.
// ─────────────────────────────────────────────────────────────────────────

type orRequest struct {
	Model       string      `json:"model"`
	Messages    []orMessage `json:"messages"`
	Stream      bool        `json:"stream,omitempty"`
	Temperature float64     `json:"temperature,omitempty"`
	MaxTokens   int         `json:"max_tokens,omitempty"`
}

// orMessage uses interface{} content so it can be either string (text-only)
// or []orContentPart (multimodal). json.Marshal picks the right shape.
type orMessage struct {
	Role    string      `json:"role"`
	Content interface{} `json:"content"`
}

type orContentPart struct {
	Type     string      `json:"type"`
	Text     string      `json:"text,omitempty"`
	ImageURL *orImageURL `json:"image_url,omitempty"`
}

type orImageURL struct {
	URL string `json:"url"`
}

type orStreamChunk struct {
	Choices []struct {
		Delta struct {
			Content string `json:"content"`
		} `json:"delta"`
		FinishReason *string `json:"finish_reason"`
	} `json:"choices"`
	Usage *orUsage `json:"usage"`
	Model string   `json:"model"`
}

type orUsage struct {
	PromptTokens     int `json:"prompt_tokens"`
	CompletionTokens int `json:"completion_tokens"`
	TotalTokens      int `json:"total_tokens"`
}

// ─────────────────────────────────────────────────────────────────────────
// Stream — SSE line-by-line.
// ─────────────────────────────────────────────────────────────────────────

// Stream implements domain.LLMProvider. The returned channel closes after
// the final event (Done or Err). The caller should consume until close.
func (c *OpenRouter) Stream(ctx context.Context, req domain.CompletionRequest) (<-chan domain.StreamEvent, error) {
	body, err := json.Marshal(orRequest{
		Model:       req.Model,
		Messages:    toORMessages(req.Messages),
		Stream:      true,
		Temperature: req.Temperature,
		MaxTokens:   req.MaxTokens,
	})
	if err != nil {
		return nil, fmt.Errorf("copilot.OpenRouter.Stream: marshal: %w", err)
	}

	resp, err := c.doWithRetries(ctx, body) //nolint:bodyclose // closed in goroutine below
	if err != nil {
		return nil, err
	}

	out := make(chan domain.StreamEvent, 16)
	go func() {
		defer close(out)
		defer resp.Body.Close()

		reader := bufio.NewReader(resp.Body)
		var modelEcho string
		for {
			if ctx.Err() != nil {
				out <- domain.StreamEvent{Err: ctx.Err()}
				return
			}
			line, err := reader.ReadString('\n')
			if err != nil {
				if errors.Is(err, io.EOF) {
					// Upstream closed without sending a final usage record.
					// Emit a Done with zero usage so the caller can proceed.
					out <- domain.StreamEvent{Done: &domain.CompletionDone{Model: modelEcho}}
					return
				}
				out <- domain.StreamEvent{Err: err}
				return
			}
			line = strings.TrimSpace(line)
			if line == "" || !strings.HasPrefix(line, "data:") {
				continue
			}
			data := strings.TrimSpace(strings.TrimPrefix(line, "data:"))
			if data == "[DONE]" {
				out <- domain.StreamEvent{Done: &domain.CompletionDone{Model: modelEcho}}
				return
			}
			var chunk orStreamChunk
			if err := json.Unmarshal([]byte(data), &chunk); err != nil {
				// Skip malformed lines rather than abort — OpenRouter occasionally
				// emits keep-alive comments.
				continue
			}
			if chunk.Model != "" {
				modelEcho = chunk.Model
			}
			for _, ch := range chunk.Choices {
				if ch.Delta.Content != "" {
					out <- domain.StreamEvent{Delta: ch.Delta.Content}
				}
			}
			if chunk.Usage != nil {
				out <- domain.StreamEvent{Done: &domain.CompletionDone{
					TokensIn:  chunk.Usage.PromptTokens,
					TokensOut: chunk.Usage.CompletionTokens,
					Model:     modelEcho,
				}}
				return
			}
		}
	}()
	return out, nil
}

// ─────────────────────────────────────────────────────────────────────────
// Transport — shared retry loop for 429 and 5xx.
// ─────────────────────────────────────────────────────────────────────────

func (c *OpenRouter) doWithRetries(ctx context.Context, body []byte) (*http.Response, error) {
	maxRetries := c.maxRetries429
	if c.maxRetries5xx > maxRetries {
		maxRetries = c.maxRetries5xx
	}
	var lastErr error
	for attempt := 0; attempt <= maxRetries; attempt++ {
		req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.endpoint, bytes.NewReader(body))
		if err != nil {
			return nil, fmt.Errorf("copilot.OpenRouter.do: new request: %w", err)
		}
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Accept", "text/event-stream")
		if c.apiKey != "" {
			req.Header.Set("Authorization", "Bearer "+c.apiKey)
		}
		resp, err := c.httpClient.Do(req)
		if err != nil {
			lastErr = err
			if ctx.Err() != nil {
				return nil, fmt.Errorf("ctx cancelled: %w", ctx.Err())
			}
			if attempt < maxRetries {
				if werr := backoffWait(ctx, c.baseBackoff, attempt); werr != nil {
					return nil, werr
				}
				continue
			}
			return nil, fmt.Errorf("copilot.OpenRouter.do: %w", err)
		}
		if resp.StatusCode == http.StatusTooManyRequests {
			retryAfter := parseRetryAfter(resp.Header.Get("Retry-After"))
			_ = resp.Body.Close()
			if attempt >= c.maxRetries429 {
				return nil, fmt.Errorf("copilot.OpenRouter.do: 429 after %d attempts", attempt+1)
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
		if resp.StatusCode >= 500 && resp.StatusCode < 600 {
			b, _ := io.ReadAll(resp.Body)
			_ = resp.Body.Close()
			if attempt >= c.maxRetries5xx {
				return nil, fmt.Errorf("copilot.OpenRouter.do: http %d after %d attempts: %s", resp.StatusCode, attempt+1, truncate(string(b), 256))
			}
			if werr := backoffWait(ctx, c.baseBackoff, attempt); werr != nil {
				return nil, werr
			}
			continue
		}
		if resp.StatusCode >= 400 {
			b, _ := io.ReadAll(resp.Body)
			_ = resp.Body.Close()
			return nil, fmt.Errorf("copilot.OpenRouter.do: http %d: %s", resp.StatusCode, truncate(string(b), 256))
		}
		return resp, nil
	}
	if lastErr != nil {
		return nil, fmt.Errorf("copilot.OpenRouter.do: exhausted retries: %w", lastErr)
	}
	return nil, fmt.Errorf("copilot.OpenRouter.do: exhausted retries")
}

// ─────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────

// toORMessages converts domain messages into OpenAI-compatible wire shape.
// Text-only messages get a bare string `content`; messages with images get a
// content-parts array. We always put the user's prompt text first, then the
// images, matching the OpenAI docs recommendation.
func toORMessages(in []domain.LLMMessage) []orMessage {
	out := make([]orMessage, 0, len(in))
	for _, m := range in {
		role := mapRole(m.Role)
		if len(m.Images) == 0 {
			out = append(out, orMessage{Role: role, Content: m.Content})
			continue
		}
		parts := make([]orContentPart, 0, 1+len(m.Images))
		if m.Content != "" {
			parts = append(parts, orContentPart{Type: "text", Text: m.Content})
		}
		for _, img := range m.Images {
			parts = append(parts, orContentPart{
				Type:     "image_url",
				ImageURL: &orImageURL{URL: encodeImageDataURI(img)},
			})
		}
		out = append(out, orMessage{Role: role, Content: parts})
	}
	return out
}

// mapRole projects domain.enums.MessageRole onto OpenAI role strings.
func mapRole(r enums.MessageRole) string {
	switch r {
	case enums.MessageRoleSystem:
		return "system"
	case enums.MessageRoleAssistant:
		return "assistant"
	default:
		return "user"
	}
}

// encodeImageDataURI produces "data:<mime>;base64,<payload>".
func encodeImageDataURI(img domain.LLMImage) string {
	mime := img.MimeType
	if mime == "" {
		mime = "image/png"
	}
	return "data:" + mime + ";base64," + base64.StdEncoding.EncodeToString(img.Data)
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + "…"
}

func backoffWait(ctx context.Context, base time.Duration, attempt int) error {
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
	if n, err := strconv.Atoi(strings.TrimSpace(h)); err == nil && n > 0 {
		return time.Duration(n) * time.Second
	}
	return 0
}

// Interface guard.
var _ domain.LLMProvider = (*OpenRouter)(nil)
