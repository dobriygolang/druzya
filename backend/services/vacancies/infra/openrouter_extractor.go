// openrouter_extractor.go — calls OpenRouter chat-completions to extract
// normalised skill tags from a vacancy description. Wraps the call in a
// 7-day Redis cache keyed by SHA256(description) so the hourly sync re-billing
// the same posting is impossible.
//
// We intentionally re-implement the thin HTTP client here (rather than
// importing ai_mock/infra) to avoid a cross-domain code dependency: ai_mock
// owns LLMProvider with streaming + voice-specific concerns we don't need.
package infra

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"time"
)

// OpenRouterEndpoint is the OpenAI-compatible chat endpoint.
const OpenRouterEndpoint = "https://openrouter.ai/api/v1/chat/completions"

// DefaultExtractorModel is a small, cheap model — vacancy descriptions are
// short and the task is structured extraction (no chain-of-thought).
const DefaultExtractorModel = "openai/gpt-4o-mini"

// DefaultExtractorCacheTTL is the spec'd 7-day TTL.
const DefaultExtractorCacheTTL = 7 * 24 * time.Hour

// OpenRouterExtractor implements domain.SkillExtractor.
type OpenRouterExtractor struct {
	apiKey   string
	endpoint string
	model    string
	http     *http.Client
	kv       KV
	cacheTTL time.Duration
	log      *slog.Logger
}

// NewOpenRouterExtractor constructs a default-configured extractor.
//   - apiKey may be empty for local dev — the extractor returns an empty
//     skill list and logs a warning rather than failing the sync.
//   - kv may be nil — cache is then disabled (every call hits the LLM).
func NewOpenRouterExtractor(apiKey string, kv KV, log *slog.Logger) *OpenRouterExtractor {
	if log == nil {
		log = slog.New(slog.NewTextHandler(discardWriter{}, nil))
	}
	return &OpenRouterExtractor{
		apiKey:   apiKey,
		endpoint: OpenRouterEndpoint,
		model:    DefaultExtractorModel,
		http:     &http.Client{Timeout: 30 * time.Second},
		kv:       kv,
		cacheTTL: DefaultExtractorCacheTTL,
		log:      log,
	}
}

// WithEndpoint overrides the URL — used by tests.
func (e *OpenRouterExtractor) WithEndpoint(u string) *OpenRouterExtractor { e.endpoint = u; return e }

// WithModel overrides the model id — handy for cost/quality tuning.
func (e *OpenRouterExtractor) WithModel(m string) *OpenRouterExtractor { e.model = m; return e }

// WithHTTPClient injects a custom client (tests).
func (e *OpenRouterExtractor) WithHTTPClient(h *http.Client) *OpenRouterExtractor {
	e.http = h
	return e
}

// extractCacheKey returns the Redis key for the cached skill list of one
// description.
func extractCacheKey(description string) string {
	sum := sha256.Sum256([]byte(strings.TrimSpace(description)))
	return fmt.Sprintf("vacancies:%s:skills:%s", CacheKeyVersion, hex.EncodeToString(sum[:16]))
}

type orMsg struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type orReq struct {
	Model       string  `json:"model"`
	Messages    []orMsg `json:"messages"`
	Temperature float64 `json:"temperature,omitempty"`
	MaxTokens   int     `json:"max_tokens,omitempty"`
}

type orResp struct {
	Choices []struct {
		Message struct {
			Content string `json:"content"`
		} `json:"message"`
	} `json:"choices"`
}

// systemPrompt asks for a strict JSON array of normalised lower-case tags.
const systemPrompt = `You extract required technical skills from job descriptions.
Return ONLY a JSON array of normalised lower-case skill tags (no prose, no
markdown). Keep tags atomic ("postgresql", not "postgresql 14"); collapse
synonyms ("golang" -> "go", "k8s" -> "kubernetes"). 5-15 tags is typical.
Examples of valid output:
["go", "postgresql", "kubernetes", "redis", "grpc"]
["python", "django", "celery", "redis", "docker"]`

// Extract returns the LLM-normalised skill list. Cache hit ⇒ no network call.
// On any non-fatal failure (no API key, HTTP error, malformed JSON) we log
// and return an empty slice so the sync pipeline doesn't break.
func (e *OpenRouterExtractor) Extract(ctx context.Context, description string) ([]string, error) {
	desc := strings.TrimSpace(description)
	if desc == "" {
		return []string{}, nil
	}
	if e.kv != nil {
		if raw, err := e.kv.Get(ctx, extractCacheKey(desc)); err == nil {
			var out []string
			if jerr := json.Unmarshal([]byte(raw), &out); jerr == nil {
				return out, nil
			}
			e.log.Warn("vacancies.extractor: corrupt cache entry, refetching")
		} else if !errors.Is(err, ErrCacheMiss) {
			e.log.Warn("vacancies.extractor: cache Get failed, falling back",
				slog.Any("err", err))
		}
	}
	if e.apiKey == "" {
		// Local dev: no key → no extraction, but no error either.
		e.log.Warn("vacancies.extractor: OPENROUTER_API_KEY empty, returning []")
		return []string{}, nil
	}

	body, err := json.Marshal(orReq{
		Model:       e.model,
		Temperature: 0.1,
		MaxTokens:   256,
		Messages: []orMsg{
			{Role: "system", Content: systemPrompt},
			{Role: "user", Content: "Extract skills:\n\n" + truncate(desc, 6000)},
		},
	})
	if err != nil {
		return nil, fmt.Errorf("vacancies.extractor.marshal: %w", err)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, e.endpoint, bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("vacancies.extractor.newreq: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+e.apiKey)

	resp, err := e.http.Do(req)
	if err != nil {
		e.log.Warn("vacancies.extractor: HTTP failed, returning []", slog.Any("err", err))
		return []string{}, nil
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		raw, _ := io.ReadAll(resp.Body)
		e.log.Warn("vacancies.extractor: non-2xx, returning []",
			slog.Int("status", resp.StatusCode),
			slog.String("body", truncate(string(raw), 256)))
		return []string{}, nil
	}
	var parsed orResp
	if err := json.NewDecoder(resp.Body).Decode(&parsed); err != nil {
		e.log.Warn("vacancies.extractor: decode failed, returning []", slog.Any("err", err))
		return []string{}, nil
	}
	if len(parsed.Choices) == 0 {
		return []string{}, nil
	}
	skills := parseSkillList(parsed.Choices[0].Message.Content)
	if e.kv != nil {
		if data, jerr := json.Marshal(skills); jerr == nil {
			if serr := e.kv.Set(ctx, extractCacheKey(desc), data, e.cacheTTL); serr != nil {
				e.log.Warn("vacancies.extractor: cache Set failed",
					slog.Any("err", serr))
			}
		}
	}
	return skills, nil
}

// parseSkillList is tolerant — the LLM occasionally wraps the JSON in
// ```json … ``` fences or adds a trailing period. Strip the obvious noise
// before decoding; on failure fall back to comma-splitting.
func parseSkillList(s string) []string {
	s = strings.TrimSpace(s)
	// Strip code fences.
	if strings.HasPrefix(s, "```") {
		// Drop opening fence line.
		if idx := strings.Index(s, "\n"); idx >= 0 {
			s = s[idx+1:]
		}
		s = strings.TrimSuffix(strings.TrimSpace(s), "```")
		s = strings.TrimSpace(s)
	}
	var arr []string
	if err := json.Unmarshal([]byte(s), &arr); err == nil {
		return cleanSkillList(arr)
	}
	// Fallback: split on commas / newlines and clean.
	parts := strings.FieldsFunc(s, func(r rune) bool {
		switch r {
		case ',', '\n', '[', ']', '"':
			return true
		}
		return false
	})
	return cleanSkillList(parts)
}

func cleanSkillList(in []string) []string {
	seen := map[string]struct{}{}
	out := make([]string, 0, len(in))
	for _, s := range in {
		s = strings.ToLower(strings.TrimSpace(s))
		s = strings.Trim(s, ".·")
		if s == "" {
			continue
		}
		if _, ok := seen[s]; ok {
			continue
		}
		seen[s] = struct{}{}
		out = append(out, s)
	}
	return out
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + "…"
}
