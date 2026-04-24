package llmcache

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"net/http"
	"strings"
	"time"
)

// OllamaEmbedder — реализация Embedder через Ollama `/api/embeddings`.
//
// Endpoint: POST {host}/api/embeddings
// Request:  {"model": "<model>", "prompt": "<text>"}
// Response: {"embedding": [float64, float64, ...]}
//
// Ollama отдаёт Python-style []float64; мы downcast'им до []float32 (хватает
// точности для cosine threshold 0.92 ± 0.005, а Redis string экономим вдвое
// против float64). bge-small-en-v1.5 возвращает вектор длины 384.
//
// Timeout по умолчанию короткий (3s): кеш — best-effort, блокировать LLM-путь
// медленным embedding'ом бессмысленно. Пользователь лучше подождёт 2s Groq'а,
// чем 10s Ollama-embed-на-CPU.
type OllamaEmbedder struct {
	endpoint string
	model    string
	dim      int
	http     *http.Client
}

// BgeSmallEnDim — размерность bge-small-en-v1.5. Пакет константно подшивается
// к 384: если оператор укажет другую embedding-модель (например nomic-embed-
// text с 768), придётся завести отдельный OllamaEmbedder с другим Dim, и это
// ок — SemanticCache хранит по task'у, миграция кеша = flushdb нужного префикса.
const BgeSmallEnDim = 384

// DefaultOllamaEmbedModel — имя модели в Ollama registry.
const DefaultOllamaEmbedModel = "bge-small-en-v1.5"

// DefaultOllamaEmbedTimeout — 3s. Embed выполняется синхронно перед Lookup'ом,
// и cache-hit имеет смысл только если он заметно быстрее реального LLM вызова
// (p50 ~500ms). Если Ollama-embed занимает >3s — значит сайдкар перегружен
// и кеш сегодня не помогает; уходим в miss-path без задержки.
const DefaultOllamaEmbedTimeout = 3 * time.Second

// NewOllamaEmbedder конструирует клиента. Сеть в конструкторе НЕ дёргается
// (пакетная инициализация должна быть sync-safe); first-call timeout работает
// как health-check.
//
//   - host: base URL без trailing slash, напр. "http://ollama:11434".
//     Пустой host приведёт к ошибке Embed на первом вызове — wirer должен
//     подставлять NoopCache когда OLLAMA_HOST пуст.
//   - model: имя модели. Пустое ⇒ DefaultOllamaEmbedModel.
//   - timeout: 0 ⇒ DefaultOllamaEmbedTimeout.
func NewOllamaEmbedder(host, model string, timeout time.Duration) *OllamaEmbedder {
	host = strings.TrimRight(strings.TrimSpace(host), "/")
	if model == "" {
		model = DefaultOllamaEmbedModel
	}
	if timeout <= 0 {
		timeout = DefaultOllamaEmbedTimeout
	}
	return &OllamaEmbedder{
		endpoint: host + "/api/embeddings",
		model:    model,
		dim:      BgeSmallEnDim,
		http:     &http.Client{Timeout: timeout},
	}
}

// Dim — размерность вектора. Hardcoded к 384 (bge-small-en-v1.5); если
// оператор подсунет другую модель с другим dim, Embed вернёт ошибку
// ErrEmbedDimMismatch на первом ответе, и кеш уйдёт в degraded-path
// без silent-использования неверного вектора.
func (e *OllamaEmbedder) Dim() int { return e.dim }

type ollamaEmbedReq struct {
	Model  string `json:"model"`
	Prompt string `json:"prompt"`
}

type ollamaEmbedResp struct {
	Embedding []float64 `json:"embedding"`
}

// Embed считает вектор. Нормализует результат на случай если провайдер
// отдал не-unit вектор. Ошибки сети/timeout/non-2xx/decode — все
// возвращаются наружу и логируются вызывающим кодом через метрику
// cacheLookupTotal{result="error"}.
func (e *OllamaEmbedder) Embed(ctx context.Context, text string) ([]float32, error) {
	payload, err := json.Marshal(ollamaEmbedReq{Model: e.model, Prompt: text})
	if err != nil {
		return nil, fmt.Errorf("llmcache.OllamaEmbedder: marshal: %w", err)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, e.endpoint, bytes.NewReader(payload))
	if err != nil {
		return nil, fmt.Errorf("llmcache.OllamaEmbedder: build request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := e.http.Do(req)
	if err != nil {
		return nil, fmt.Errorf("llmcache.OllamaEmbedder: http: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode/100 != 2 {
		// Читаем до 512 байт для диагностики — не тянем полный body.
		snippet, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		return nil, fmt.Errorf("llmcache.OllamaEmbedder: status %d: %s", resp.StatusCode, bytes.TrimSpace(snippet))
	}
	var decoded ollamaEmbedResp
	if err := json.NewDecoder(resp.Body).Decode(&decoded); err != nil {
		return nil, fmt.Errorf("llmcache.OllamaEmbedder: decode: %w", err)
	}
	if len(decoded.Embedding) != e.dim {
		return nil, fmt.Errorf("llmcache.OllamaEmbedder: unexpected dim %d (want %d)", len(decoded.Embedding), e.dim)
	}
	out := make([]float32, e.dim)
	for i, v := range decoded.Embedding {
		out[i] = float32(v)
	}
	normalizeInPlace(out)
	return out, nil
}

// normalizeInPlace — L2-normalization. Cheap защита от не-unit векторов.
// Если вектор нулевой (не должно случаться, но) — оставляем как есть,
// cosine против него даст 0 и войдёт в miss-ветку естественно.
func normalizeInPlace(v []float32) {
	var s float64
	for _, x := range v {
		s += float64(x) * float64(x)
	}
	if s == 0 {
		return
	}
	inv := float32(1.0 / math.Sqrt(s))
	for i := range v {
		v[i] *= inv
	}
}
