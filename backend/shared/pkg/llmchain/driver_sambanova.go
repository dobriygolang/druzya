package llmchain

import "context"

// SambaNova Cloud (https://cloud.sambanova.ai) — OpenAI-compatible
// chat-completions. Launched 2024-Q4 as a generous free tier on RDU
// hardware (advertised ~580 tok/s on Llama-3.3-70B, which is 3-4× Groq
// on the same model). Free lane gives ~30 RPM per model as of
// 2026-Q1, with no documented hard daily cap yet — token budget is
// "generous but unspecified", so we still treat it as best-effort.
//
// Wire format is identical to Groq's (OpenAI 1:1). JSON mode and
// streaming both work; vision is not available on the free-tier Llama /
// DeepSeek / Qwen models we use, so supportsVision stays false.
//
// Rate-limit headers: SambaNova emits `x-ratelimit-*` but their layout
// is the standard OpenAI shape, which ratelimit.go already handles via
// the generic branch — no provider-specific parsing needed.
const SambaNovaEndpoint = "https://api.sambanova.ai/v1/chat/completions"

// NewSambaNovaDriver constructs the SambaNova driver. Empty apiKey ⇒
// the wirer must skip registration (consistent with Groq/Cerebras).
func NewSambaNovaDriver(apiKey string) Driver {
	d := newOpenAIDriver(ProviderSambaNova, apiKey, SambaNovaEndpoint)
	d.supportsJSONMode = true
	d.supportsVision = false
	return &sambaNovaDriver{openAIDriver: d}
}

type sambaNovaDriver struct{ *openAIDriver }

// Chat / ChatStream inherit from openAIDriver. SambaNova doesn't deviate
// from the OpenAI wire shape, so no overrides needed today.
func (s *sambaNovaDriver) Chat(ctx context.Context, model string, req Request) (Response, error) {
	return s.openAIDriver.Chat(ctx, model, req)
}

func (s *sambaNovaDriver) ChatStream(ctx context.Context, model string, req Request) (<-chan StreamEvent, error) {
	return s.openAIDriver.ChatStream(ctx, model, req)
}
