package llmcache

import (
	"context"
	"hash/fnv"
	"io"
	"log/slog"
	"math"
	"testing"

	"druz9/shared/pkg/llmchain"

	"github.com/alicebob/miniredis/v2"
	"github.com/redis/go-redis/v9"
)

// fakeEmbedder — детерминированный embedder: seed от fnv64(text) → нормализованный вектор.
// Для промптов с общим префиксом векторы получаются близкими (контролируется через
// deriveVec — делим hash на компоненты, чтобы small textual delta → small vec delta).
type fakeEmbedder struct {
	dim int
}

func (f *fakeEmbedder) Dim() int { return f.dim }

func (f *fakeEmbedder) Embed(_ context.Context, text string) ([]float32, error) {
	return deriveVec(text, f.dim), nil
}

// deriveVec превращает текст в фиксированный unit-вектор. НЕ криптограф,
// НЕ настоящий embedding — просто стабильный детерминированный генератор.
// Для тестов close-match эмулируем через deriveVecInterp: смешиваем target
// вектор с базой по коэффициенту. Напрямую по тексту — только через hash.
func deriveVec(text string, dim int) []float32 {
	h := fnv.New64a()
	_, _ = h.Write([]byte(text))
	seed := h.Sum64()
	out := make([]float32, dim)
	for i := 0; i < dim; i++ {
		// lcg: seed → (seed*a+c) mod 2^64, mantissa в [-1,1].
		seed = seed*6364136223846793005 + 1442695040888963407
		out[i] = float32(int64(seed>>11)&0x1FFFFF)/float32(1<<20) - 1
	}
	normalizeInPlace(out)
	return out
}

func newFakeEmbedder() *fakeEmbedder { return &fakeEmbedder{dim: 16} }

func newTestRedis(t *testing.T) *redis.Client {
	t.Helper()
	mr := miniredis.RunT(t)
	return redis.NewClient(&redis.Options{Addr: mr.Addr()})
}

func TestSemanticCache_StoreThenHit(t *testing.T) {
	rds := newTestRedis(t)
	emb := newFakeEmbedder()
	c := NewSemanticCache(rds, emb, Options{
		Log:                 slog.New(slog.NewTextHandler(io.Discard, nil)),
		SimilarityThreshold: 0.99, // одинаковый текст → dot=1.0 → hit
	}).(*SemanticCache)
	defer c.Close()

	ctx := context.Background()
	want := llmchain.Response{Content: "cached answer", Provider: llmchain.ProviderGroq, Model: "x"}
	if err := c.Store(ctx, llmchain.TaskVacanciesJSON, "hello world", want); err != nil {
		t.Fatalf("Store: %v", err)
	}
	// Закрываем канал и ждём воркер, чтобы гарантированно увидеть entry.
	if err := c.Close(); err != nil {
		t.Fatalf("Close: %v", err)
	}

	// Переоткрываем новый SemanticCache на том же Redis'е, чтобы Lookup шёл
	// по реальным данным, а не через async-буфер.
	c2 := NewSemanticCache(rds, emb, Options{
		Log:                 slog.New(slog.NewTextHandler(io.Discard, nil)),
		SimilarityThreshold: 0.99,
	}).(*SemanticCache)
	defer c2.Close()

	resp, hit, err := c2.Lookup(ctx, llmchain.TaskVacanciesJSON, "hello world")
	if err != nil {
		t.Fatalf("Lookup: %v", err)
	}
	if !hit {
		t.Fatalf("want hit for identical prompt")
	}
	if resp.Content != want.Content {
		t.Fatalf("want %q, got %q", want.Content, resp.Content)
	}
}

func TestSemanticCache_DistantPromptMisses(t *testing.T) {
	rds := newTestRedis(t)
	emb := newFakeEmbedder()
	c := NewSemanticCache(rds, emb, Options{
		Log:                 slog.New(slog.NewTextHandler(io.Discard, nil)),
		SimilarityThreshold: 0.95,
	}).(*SemanticCache)
	ctx := context.Background()
	want := llmchain.Response{Content: "apples"}
	_ = c.Store(ctx, llmchain.TaskVacanciesJSON, "apples", want)
	_ = c.Close()

	c2 := NewSemanticCache(rds, emb, Options{
		Log:                 slog.New(slog.NewTextHandler(io.Discard, nil)),
		SimilarityThreshold: 0.95,
	}).(*SemanticCache)
	defer c2.Close()

	_, hit, err := c2.Lookup(ctx, llmchain.TaskVacanciesJSON, "completely unrelated distant prompt")
	if err != nil {
		t.Fatalf("Lookup: %v", err)
	}
	if hit {
		t.Fatalf("must miss on unrelated prompt")
	}
}

func TestSemanticCache_NonCacheableTask(t *testing.T) {
	rds := newTestRedis(t)
	emb := newFakeEmbedder()
	c := NewSemanticCache(rds, emb, Options{
		Log: slog.New(slog.NewTextHandler(io.Discard, nil)),
	}).(*SemanticCache)
	defer c.Close()

	_, hit, err := c.Lookup(context.Background(), llmchain.TaskCopilotStream, "anything")
	if err != nil {
		t.Fatalf("Lookup: %v", err)
	}
	if hit {
		t.Fatalf("non-cacheable task must never hit")
	}
	// Store должно быть no-op.
	if err := c.Store(context.Background(), llmchain.TaskCopilotStream, "k", llmchain.Response{}); err != nil {
		t.Fatalf("Store on non-cacheable: %v", err)
	}
}

func TestSemanticCache_Eviction(t *testing.T) {
	rds := newTestRedis(t)
	emb := newFakeEmbedder()
	c := NewSemanticCache(rds, emb, Options{
		Log:                 slog.New(slog.NewTextHandler(io.Discard, nil)),
		MaxEntriesPerTask:   5,
		SimilarityThreshold: 0.99,
		AsyncStoreWorkers:   1,
	}).(*SemanticCache)
	ctx := context.Background()

	// Кладём больше лимита. Batch-evict сработает при ZCARD > max.
	for i := 0; i < 120; i++ {
		key := "prompt-" + itoa(i)
		_ = c.Store(ctx, llmchain.TaskVacanciesJSON, key, llmchain.Response{Content: key})
	}
	_ = c.Close()

	// Верифицируем через прямой ZCARD что размер не разнёсся в небеса
	// (должно быть не более MaxEntriesPerTask после batch-eviction).
	card, err := rds.ZCard(ctx, keyLRU(llmchain.TaskVacanciesJSON)).Result()
	if err != nil {
		t.Fatalf("ZCard: %v", err)
	}
	if card > 5 {
		t.Fatalf("entries must not exceed max; got %d", card)
	}
}

func TestSemanticCache_CloseIdempotent(t *testing.T) {
	rds := newTestRedis(t)
	emb := newFakeEmbedder()
	c := NewSemanticCache(rds, emb, Options{
		Log: slog.New(slog.NewTextHandler(io.Discard, nil)),
	}).(*SemanticCache)

	if err := c.Close(); err != nil {
		t.Fatalf("first close: %v", err)
	}
	if err := c.Close(); err != nil {
		t.Fatalf("second close must be safe: %v", err)
	}
}

func TestSemanticCache_StoreAfterCloseDoesNotPanic(t *testing.T) {
	rds := newTestRedis(t)
	emb := newFakeEmbedder()
	c := NewSemanticCache(rds, emb, Options{
		Log: slog.New(slog.NewTextHandler(io.Discard, nil)),
	}).(*SemanticCache)

	_ = c.Close()
	// После Close Store должен вернуться ок (job дропается вместо panic
	// "send on closed channel").
	defer func() {
		if r := recover(); r != nil {
			t.Fatalf("Store panicked after Close: %v", r)
		}
	}()
	_ = c.Store(context.Background(), llmchain.TaskVacanciesJSON, "k", llmchain.Response{})
}

func TestSemanticCache_NilRedisReturnsNoop(t *testing.T) {
	c := NewSemanticCache(nil, newFakeEmbedder(), Options{
		Log: slog.New(slog.NewTextHandler(io.Discard, nil)),
	})
	if _, ok := c.(NoopCache); !ok {
		t.Fatalf("want NoopCache, got %T", c)
	}
}

func TestSemanticCache_NilEmbedderReturnsNoop(t *testing.T) {
	rds := newTestRedis(t)
	c := NewSemanticCache(rds, nil, Options{
		Log: slog.New(slog.NewTextHandler(io.Discard, nil)),
	})
	if _, ok := c.(NoopCache); !ok {
		t.Fatalf("want NoopCache, got %T", c)
	}
}

func TestDotUnit(t *testing.T) {
	a := []float32{1, 0, 0}
	b := []float32{1, 0, 0}
	if got := dot(a, b); math.Abs(float64(got)-1) > 1e-6 {
		t.Fatalf("dot identical: got %v", got)
	}
	c := []float32{0, 1, 0}
	if got := dot(a, c); math.Abs(float64(got)) > 1e-6 {
		t.Fatalf("dot orthogonal: got %v", got)
	}
}

func TestEncodeDecodeVector(t *testing.T) {
	in := []float32{0.1, -0.2, 0.3, -0.4, 0.5}
	blob := encodeVector(in)
	out, err := decodeVector(blob, len(in))
	if err != nil {
		t.Fatalf("decode: %v", err)
	}
	for i := range in {
		if math.Abs(float64(in[i]-out[i])) > 1e-7 {
			t.Fatalf("roundtrip[%d]: want %v got %v", i, in[i], out[i])
		}
	}
	if _, err := decodeVector(blob, len(in)+1); err == nil {
		t.Fatalf("want dim mismatch error")
	}
}

// TestDefaultCacheableTasks_Sanity — защита от случайного добавления streaming
// таски в кешируемый список (streaming несовместим со snapshot-кешем).
func TestDefaultCacheableTasks_Sanity(t *testing.T) {
	forbidden := map[llmchain.Task]bool{
		llmchain.TaskCopilotStream: true,
		llmchain.TaskInsightProse:  true,
		llmchain.TaskReasoning:     true,
		llmchain.TaskCodeReview:    true,
	}
	for _, tk := range DefaultCacheableTasks {
		if forbidden[tk] {
			t.Fatalf("task %q must not be in DefaultCacheableTasks", tk)
		}
	}
}

// Небольшой helper потому что strconv.Itoa тянет зависимость ради одной
// строки — а в тесте это чисто cosmetic.
func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	neg := n < 0
	if neg {
		n = -n
	}
	var buf [20]byte
	i := len(buf)
	for n > 0 {
		i--
		buf[i] = byte('0' + n%10)
		n /= 10
	}
	s := string(buf[i:])
	if neg {
		s = "-" + s
	}
	return s
}
