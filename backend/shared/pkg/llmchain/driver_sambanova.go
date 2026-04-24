package llmchain

import "context"

// SambaNova Cloud (https://cloud.sambanova.ai) — OpenAI-compatible
// chat-completions. Hardware достоин: ~580 tok/s на Llama-3.3-70B
// (3-4× Groq).
//
// ⚠️  ВАЖНО: на 2026-Q2 SambaNova — **платный сервис**. При регистрации
// дают $5 trial credit, после исчерпания — billing-only. Free-tier
// для prod неприменим. Драйвер оставлен в коде как **опциональное
// расширение**: регистрируется ТОЛЬКО если оператор явно задал
// SAMBANOVA_API_KEY в env и готов платить. Из DefaultTaskModelMap
// SambaNova НЕ включён — чтобы случайно не попасть в default chain
// на проде. Для активации: установить env + добавить entry в кастомный
// TaskModelMap при создании Chain.
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
