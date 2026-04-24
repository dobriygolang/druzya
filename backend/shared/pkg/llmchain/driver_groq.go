package llmchain

import "context"

// Groq (https://console.groq.com) — OpenAI-compatible chat-completions.
// Free tier limits on launch day: 30 RPM / 14.4k RPD per model, plenty
// for our mixed workload.
//
// Vision: Groq Llama models are text-only today; leave supportsVision
// false so the chain routes image calls to a vision-capable provider.
// JSON mode: Groq supports response_format:"json_object" on all models.
const GroqEndpoint = "https://api.groq.com/openai/v1/chat/completions"

// NewGroqDriver constructs the Groq driver. apiKey is required — pass
// the value from config.LLMChain.GroqAPIKey. The chain's wirer MUST
// skip registration when the key is empty (a driver with an empty key
// will only ever return 401, wasting one chain hop per request).
func NewGroqDriver(apiKey string) Driver {
	d := newOpenAIDriver(ProviderGroq, apiKey, GroqEndpoint)
	d.supportsJSONMode = true
	d.supportsVision = false
	return &groqDriver{openAIDriver: d}
}

type groqDriver struct{ *openAIDriver }

// Chat / ChatStream inherit from openAIDriver. We override only if the
// provider deviates; Groq doesn't today.
func (g *groqDriver) Chat(ctx context.Context, model string, req Request) (Response, error) {
	return g.openAIDriver.Chat(ctx, model, req)
}

func (g *groqDriver) ChatStream(ctx context.Context, model string, req Request) (<-chan StreamEvent, error) {
	return g.openAIDriver.ChatStream(ctx, model, req)
}
