package llmchain

import (
	"context"
	"fmt"
	"strings"
)

// Ollama (https://ollama.ai) — self-hosted sidecar на VPS. Ставим
// Qwen 2.5 3B Q4_K_M (~2.5GB RAM) как **floor-fallback**: когда все
// cloud free-tier провайдеры упёрлись в лимиты, мы не роняем продукт,
// а отвечаем через локальную модель. Качество хуже 70B Llama, но стабильно
// доступно и не жжёт внешних квот.
//
// Wire format: у Ollama есть **OpenAI-compatible** endpoint на
// `/v1/chat/completions` — поэтому наследуем openAIDriver как все
// остальные. Два нюанса:
//
//   - Auth отсутствует. Ollama не требует ключа и отдаёт 401 на пустой
//     `Bearer `. Поэтому ставим skipAuth=true и не шлём Authorization
//     вообще.
//
//   - Model id содержит `:` (например `qwen2.5:3b-instruct-q4_K_M`).
//     Это стандартный формат tag'ов Ollama. openAIDriver.Chat делает
//     stripProviderPrefix только когда ModelOverride задан целиком и
//     имеет `/` в id — двоеточие не триггерит strip, так что передача
//     `qwen2.5:3b-…` работает как есть.
//
// Endpoint строится из host'а передаваемого в конструктор. Типичные
// значения: "http://ollama:11434" внутри docker-compose, либо
// "http://localhost:11434" при локальной разработке без контейнера.
// Публично endpoint НЕ выставляется (см. docker-compose.prod.yml —
// Ollama только в app-net, без ports:).
//
// JSON mode: Ollama 0.5+ поддерживает response_format через OpenAI-
// совместимый слой. Для Qwen 2.5 3B формат соблюдается, но хуже чем у
// cloud 70B — не полагаемся на это для критичных парсеров (VacanciesJSON
// всё равно идёт через Groq/Cerebras primary).
//
// Vision: Qwen 2.5 3B — text-only; supportsVision=false.

// NewOllamaDriver constructs the Ollama driver pointed at a running
// Ollama daemon. host — base URL без trailing slash, напр.
// "http://ollama:11434". Пустой host ⇒ вызов вернёт nil; wirer должен
// пропускать регистрацию когда OLLAMA_HOST не задан (consistent с
// Groq/Cerebras/… поведением на пустой API key).
func NewOllamaDriver(host string) Driver {
	host = strings.TrimRight(strings.TrimSpace(host), "/")
	if host == "" {
		return nil
	}
	endpoint := fmt.Sprintf("%s/v1/chat/completions", host)
	// apiKey='' — Ollama не требует токен; skipAuth=true гарантирует что
	// мы не шлём даже пустой Bearer header.
	d := newOpenAIDriver(ProviderOllama, "", endpoint)
	d.supportsJSONMode = true
	d.supportsVision = false
	d.skipAuth = true
	return &ollamaDriver{openAIDriver: d}
}

type ollamaDriver struct{ *openAIDriver }

// Chat / ChatStream наследуются без изменений — Ollama v1 endpoint на
// 100% соответствует OpenAI wire format для chat-completions и SSE.
func (o *ollamaDriver) Chat(ctx context.Context, model string, req Request) (Response, error) {
	return o.openAIDriver.Chat(ctx, model, req)
}

func (o *ollamaDriver) ChatStream(ctx context.Context, model string, req Request) (<-chan StreamEvent, error) {
	return o.openAIDriver.ChatStream(ctx, model, req)
}
