// cloudflare.go — Cloudflare Workers AI MeloTTS driver
// (`@cf/myshell-ai/melotts`). Free-tier friendly: 10k neurons/day shared
// across CF AI models, MeloTTS run-cost is low (~1 neuron / short clip),
// trivially within speaking_exercises baseline (15 rows × <200 chars =
// ~15 neurons one-shot).
//
// Reuses CLOUDFLARE_API_KEY + CLOUDFLARE_ACCOUNT_ID from existing
// llmchain driver — same creds, different model. We do NOT add a new
// env var: operator already configures both для llmchain Cloudflare
// path.
//
// API contract (https://developers.cloudflare.com/workers-ai/models/melotts):
//
//	POST https://api.cloudflare.com/client/v4/accounts/{acct}/ai/run/@cf/myshell-ai/melotts
//	Authorization: Bearer {api_key}
//	Body JSON: { "prompt": "<text>", "lang": "en" }
//	Response JSON: { "result": { "audio": "<base64-mp3>" }, "success": true }
//
// 2026-05-13 — CF returns base64 MP3 (audio/mpeg). We decode + return
// raw bytes так что storage layer не парсит JSON envelope.
package tts

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

// Cloudflare — driver for the Workers AI MeloTTS endpoint.
type Cloudflare struct {
	APIKey    string
	AccountID string
	Model     string // default "@cf/myshell-ai/melotts"
	HTTP      *http.Client
}

// NewCloudflare wires the driver. Empty apiKey or accountID returns
// nil — caller swaps for Unconfigured. Default 60s timeout (TTS for
// 200-char prompts usually <2s; generous ceiling protects against
// stuck connections).
func NewCloudflare(apiKey, accountID string) *Cloudflare {
	if strings.TrimSpace(apiKey) == "" || strings.TrimSpace(accountID) == "" {
		return nil
	}
	return &Cloudflare{
		APIKey:    apiKey,
		AccountID: accountID,
		Model:     "@cf/myshell-ai/melotts",
		HTTP:      &http.Client{Timeout: 60 * time.Second},
	}
}

// cloudflareReq — request body shape для MeloTTS. `lang` defaults to
// `en` server-side когда не указан.
type cloudflareReq struct {
	Prompt string `json:"prompt"`
	Lang   string `json:"lang,omitempty"`
}

// cloudflareResp — envelope returned by Workers AI run endpoint. We
// only care about result.audio (base64 MP3). Errors come back via
// success=false + array of error objects; we surface them в text.
type cloudflareResp struct {
	Result struct {
		Audio string `json:"audio"`
	} `json:"result"`
	Success bool `json:"success"`
	Errors  []struct {
		Code    int    `json:"code"`
		Message string `json:"message"`
	} `json:"errors"`
}

// Synthesize runs MeloTTS. Returns audio/mpeg bytes ready for direct
// storage upload.
func (c *Cloudflare) Synthesize(ctx context.Context, in SynthesizeInput) (SynthesizeResult, error) {
	text := strings.TrimSpace(in.Text)
	if text == "" {
		return SynthesizeResult{}, ErrEmptyText
	}
	if c.APIKey == "" || c.AccountID == "" {
		return SynthesizeResult{}, ErrUnavailable
	}
	model := c.Model
	if model == "" {
		model = "@cf/myshell-ai/melotts"
	}
	lang := strings.TrimSpace(in.Lang)
	if lang == "" {
		lang = "en"
	}

	body, err := json.Marshal(cloudflareReq{Prompt: text, Lang: lang})
	if err != nil {
		return SynthesizeResult{}, fmt.Errorf("tts.cloudflare: marshal: %w", err)
	}
	url := fmt.Sprintf("https://api.cloudflare.com/client/v4/accounts/%s/ai/run/%s",
		c.AccountID, model)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return SynthesizeResult{}, fmt.Errorf("tts.cloudflare: build req: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+c.APIKey)
	req.Header.Set("Content-Type", "application/json")

	httpClient := c.HTTP
	if httpClient == nil {
		httpClient = &http.Client{Timeout: 60 * time.Second}
	}
	resp, err := httpClient.Do(req)
	if err != nil {
		return SynthesizeResult{}, fmt.Errorf("tts.cloudflare: do: %w", err)
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(io.LimitReader(resp.Body, 8*1024*1024)) // 8MB ceiling
	if err != nil {
		return SynthesizeResult{}, fmt.Errorf("tts.cloudflare: read body: %w", err)
	}
	if resp.StatusCode/100 != 2 {
		return SynthesizeResult{}, fmt.Errorf("tts.cloudflare: status %d: %s",
			resp.StatusCode, truncate(string(respBody), 256))
	}
	var env cloudflareResp
	if err := json.Unmarshal(respBody, &env); err != nil {
		return SynthesizeResult{}, fmt.Errorf("tts.cloudflare: parse: %w (body=%s)",
			err, truncate(string(respBody), 256))
	}
	if !env.Success {
		// Surface API-level error messages so admin can debug в UI.
		msgs := make([]string, 0, len(env.Errors))
		for _, e := range env.Errors {
			msgs = append(msgs, fmt.Sprintf("[%d] %s", e.Code, e.Message))
		}
		return SynthesizeResult{}, fmt.Errorf("tts.cloudflare: api error: %s",
			strings.Join(msgs, "; "))
	}
	if env.Result.Audio == "" {
		return SynthesizeResult{}, fmt.Errorf("tts.cloudflare: empty audio in response")
	}
	audio, err := base64.StdEncoding.DecodeString(env.Result.Audio)
	if err != nil {
		return SynthesizeResult{}, fmt.Errorf("tts.cloudflare: decode base64: %w", err)
	}
	return SynthesizeResult{
		Audio:       audio,
		ContentType: "audio/mpeg",
		Ext:         ".mp3",
	}, nil
}

// truncate — short error messages keep logs readable.
func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + "…"
}
