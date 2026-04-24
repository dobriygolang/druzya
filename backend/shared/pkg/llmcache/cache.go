package llmcache

import (
	"context"
	"fmt"
	"log/slog"
	"sync"
	"time"

	"druz9/shared/pkg/llmchain"

	"github.com/redis/go-redis/v9"
)

// Cache — публичный контракт пакета. Реализации:
//
//   - SemanticCache — реальный Redis-backed cache с Ollama embedder'ом.
//     Конструируется через NewSemanticCache, требует rds+embedder.
//
//   - NoopCache — всегда miss / всегда успех. Используется wirer'ом
//     когда хотя бы один из (Redis, Ollama) недоступен — чтобы
//     CachingChain мог декорировать Chain без дополнительных if'ов.
type Cache interface {
	// Lookup ищет семантически похожий закешированный ответ.
	//
	//   (resp, true, nil)  — cache hit.
	//   (_,    false, nil) — miss (чистый промах, это НЕ ошибка).
	//   (_,    false, err) — сбой embedder'а или Redis. Вызывающий код
	//                        обязан не падать, а продолжить в LLM.
	Lookup(ctx context.Context, task llmchain.Task, prompt string) (llmchain.Response, bool, error)

	// Store кеширует успешный ответ. Async — не блокирует вызывающий
	// код. Ошибки логируются и глотаются внутри пакета.
	Store(ctx context.Context, task llmchain.Task, prompt string, resp llmchain.Response) error

	// Close дренит async-workers. Вызывается при graceful shutdown.
	// Повторные Close безопасны.
	Close() error
}

// Options — параметры SemanticCache. Поля без zero-замены (SimilarityThreshold,
// MaxEntriesPerTask, TTL, AsyncStoreWorkers) берут defaults когда оставлены в
// zero-value — так конструктор минимален на happy-path.
type Options struct {
	// SimilarityThreshold — cosine ≥ это значение ⇒ HIT. Default 0.92.
	// Tunable: <0.90 начинает давать ложные совпадения на bge-small-en,
	// >0.95 почти убивает hit-rate. 0.92 — sweet-spot на наших датасетах.
	SimilarityThreshold float32

	// MaxEntriesPerTask — hard cap. Default 2000. Поднимать только при
	// подтверждённом Redis-budget'е: 2000 × ~5KB = ~10MB на task.
	MaxEntriesPerTask int

	// TTL — время жизни entry в Redis. Default 7 дней. Entries трогаются
	// при hit'е (LRU score обновляется, но TTL НЕ продлевается — это
	// защита от "вечных" записей, которые никогда не вытеснятся).
	TTL time.Duration

	// CacheableTasks — какие task'и кешировать. nil ⇒ DefaultCacheableTasks.
	// Любой task не из списка → Lookup сразу miss, Store — no-op.
	CacheableTasks []llmchain.Task

	// AsyncStoreWorkers — фоновых горутин на Store. Default 2. Буфер
	// канала = 64 × workers. При переполнении job дропается с метрикой.
	AsyncStoreWorkers int

	// Log — обязателен (anti-fallback policy: no silent noop loggers).
	Log *slog.Logger
}

// DefaultCacheableTasks — список task'ов кешируемых по умолчанию. Все
// выбраны по критерию "детерминированный на одинаковом input'е":
//
//   - TaskVacanciesJSON — JSON-парсинг вакансии, one-shot strict-JSON.
//     Одинаковая вакансия у двух юзеров → один и тот же результат.
//   - TaskCodingHint — подсказки по конкретной kata; та же kata → та же
//     подсказка, и latency-sensitive (первый байт должен прилететь ≤1s —
//     cache-hit укладывается в 30ms).
//   - TaskSysDesignCritique — типовые архитектуры (e.g. URL shortener,
//     twitter feed) повторяются; критика одной и той же диаграммы у
//     разных юзеров совпадает на 80-90%.
//   - TaskSummarize — детерминированная операция над текстом. Если
//     background summarizer уже разобрал тот же текст — reuse.
//
// Сознательно НЕ включены:
//
//   - TaskCopilotStream — streaming, несовместимо.
//   - TaskInsightProse — персональный контекст (ELO/streak/уик),
//     прожиточный шанс совпадения near-zero, только засоряет cache.
//   - TaskReasoning / TaskCodeReview — sup-user input (код юзера),
//     семантические дубликаты редки и ложный hit особо вреден.
var DefaultCacheableTasks = []llmchain.Task{
	llmchain.TaskVacanciesJSON,
	llmchain.TaskCodingHint,
	llmchain.TaskSysDesignCritique,
	llmchain.TaskSummarize,
}

// Default values (package-level для читаемости в Options comment'ах).
const (
	DefaultSimilarityThreshold = float32(0.92)
	DefaultMaxEntriesPerTask   = 2000
	DefaultTTL                 = 7 * 24 * time.Hour
	DefaultAsyncStoreWorkers   = 2
	// asyncStoreBufferPerWorker — сколько pending Store job'ов можно
	// накопить на одного воркера перед тем как дропать. 64 выбрано
	// эмпирически: при peak-нагрузке ~50 RPS на кешируемый task один
	// воркер обрабатывает 20-30 RPS, 64 даёт запас на burst без
	// bloating памяти (worker job ≈ 200 байт ⇒ 2 × 128 × 200B = 50KB).
	asyncStoreBufferPerWorker = 64
)

// SemanticCache — реальная реализация. Хранит векторы и ответы в Redis,
// считает cosine в Go на brute-force'е (≤2000 × 384 dim = быстро).
type SemanticCache struct {
	rds      *redis.Client
	embedder Embedder
	opts     Options
	log      *slog.Logger

	cacheableSet map[llmchain.Task]struct{}
	store        *redisStore

	storeCh   chan storeJob
	workersWG sync.WaitGroup
	closeOnce sync.Once
	closed    chan struct{}
}

type storeJob struct {
	task   llmchain.Task
	prompt string
	resp   llmchain.Response
}

// NewSemanticCache конструирует кеш и запускает async workers.
//
//   - rds / embedder nil ⇒ возвращает NoopCache (wirer таким образом
//     получает graceful-degradation бесплатно).
//   - opts.Log обязателен.
//
// После вызова обязательно вызвать Close() при shutdown — иначе worker
// горутины останутся висеть.
func NewSemanticCache(rds *redis.Client, embedder Embedder, opts Options) Cache {
	if rds == nil || embedder == nil {
		return NoopCache{}
	}
	if opts.Log == nil {
		// Сознательно panic — см. anti-fallback policy (ни одного silent
		// noop logger'а). Вызывающий код ДОЛЖЕН передать slog.Logger.
		panic("llmcache.NewSemanticCache: logger is required (anti-fallback policy)")
	}
	if opts.SimilarityThreshold <= 0 {
		opts.SimilarityThreshold = DefaultSimilarityThreshold
	}
	if opts.MaxEntriesPerTask <= 0 {
		opts.MaxEntriesPerTask = DefaultMaxEntriesPerTask
	}
	if opts.TTL <= 0 {
		opts.TTL = DefaultTTL
	}
	if opts.AsyncStoreWorkers <= 0 {
		opts.AsyncStoreWorkers = DefaultAsyncStoreWorkers
	}
	if len(opts.CacheableTasks) == 0 {
		opts.CacheableTasks = DefaultCacheableTasks
	}
	cacheableSet := make(map[llmchain.Task]struct{}, len(opts.CacheableTasks))
	for _, t := range opts.CacheableTasks {
		cacheableSet[t] = struct{}{}
	}
	sc := &SemanticCache{
		rds:          rds,
		embedder:     embedder,
		opts:         opts,
		log:          opts.Log,
		cacheableSet: cacheableSet,
		store:        newRedisStore(rds, embedder.Dim(), opts.TTL),
		storeCh:      make(chan storeJob, opts.AsyncStoreWorkers*asyncStoreBufferPerWorker),
		closed:       make(chan struct{}),
	}
	sc.workersWG.Add(opts.AsyncStoreWorkers)
	for i := 0; i < opts.AsyncStoreWorkers; i++ {
		go sc.storeWorker()
	}
	return sc
}

// isCacheable — task в конфигурируемом списке?
func (c *SemanticCache) isCacheable(task llmchain.Task) bool {
	_, ok := c.cacheableSet[task]
	return ok
}

// Lookup — flow:
//  1. task не кешируется? → disabled miss.
//  2. Embed(prompt). Ошибка → err (вызывающий идёт в LLM).
//  3. Redis: ZRANGE всех entry_ids, MGET embeddings, cosine vs каждый.
//  4. Best score ≥ threshold → HGET response, обновить LRU score, hit.
//  5. Иначе → miss.
func (c *SemanticCache) Lookup(ctx context.Context, task llmchain.Task, prompt string) (llmchain.Response, bool, error) {
	if !c.isCacheable(task) {
		cacheLookupTotal.WithLabelValues(string(task), "disabled").Inc()
		return llmchain.Response{}, false, nil
	}
	start := time.Now()
	defer func() {
		cacheLookupDur.WithLabelValues(string(task)).Observe(time.Since(start).Seconds())
	}()

	vec, err := c.embedder.Embed(ctx, prompt)
	if err != nil {
		cacheLookupTotal.WithLabelValues(string(task), "error").Inc()
		return llmchain.Response{}, false, fmt.Errorf("llmcache.Lookup: embed: %w", err)
	}

	hit, resp, err := c.store.findBest(ctx, task, vec, c.opts.SimilarityThreshold)
	if err != nil {
		cacheLookupTotal.WithLabelValues(string(task), "error").Inc()
		return llmchain.Response{}, false, fmt.Errorf("llmcache.Lookup: store: %w", err)
	}
	if !hit {
		cacheLookupTotal.WithLabelValues(string(task), "miss").Inc()
		return llmchain.Response{}, false, nil
	}
	cacheLookupTotal.WithLabelValues(string(task), "hit").Inc()
	return resp, true, nil
}

// Store отправляет job в async-канал. Drop-on-full с метрикой.
func (c *SemanticCache) Store(_ context.Context, task llmchain.Task, prompt string, resp llmchain.Response) error {
	if !c.isCacheable(task) {
		return nil
	}
	// Проверяем closed-state перед send, чтобы не паниковать на закрытом канале.
	select {
	case <-c.closed:
		return nil
	default:
	}
	select {
	case c.storeCh <- storeJob{task: task, prompt: prompt, resp: resp}:
		// Job принят; реальный Store произойдёт в воркере.
		return nil
	default:
		cacheStoreTotal.WithLabelValues(string(task), "dropped").Inc()
		c.log.Warn("llmcache: store queue full, dropping entry",
			slog.String("task", string(task)))
		return nil
	}
}

// Close дренит канал и ждёт воркеров. Безопасно вызывать несколько раз.
func (c *SemanticCache) Close() error {
	c.closeOnce.Do(func() {
		close(c.closed)
		close(c.storeCh)
	})
	c.workersWG.Wait()
	return nil
}

func (c *SemanticCache) storeWorker() {
	defer c.workersWG.Done()
	for job := range c.storeCh {
		// Отдельный context на bg-Store: не протягиваем cancel-ctx из
		// вызывающего RPC, иначе bg-store отменится как только RPC
		// вернул юзеру ответ. Таймаут 5s — baseline для Ollama-embed+Redis.
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		c.doStore(ctx, job)
		cancel()
	}
}

func (c *SemanticCache) doStore(ctx context.Context, job storeJob) {
	vec, err := c.embedder.Embed(ctx, job.prompt)
	if err != nil {
		cacheStoreTotal.WithLabelValues(string(job.task), "error").Inc()
		c.log.Warn("llmcache: store: embed failed",
			slog.String("task", string(job.task)),
			slog.Any("err", err))
		return
	}
	evicted, err := c.store.save(ctx, job.task, vec, job.resp, c.opts.MaxEntriesPerTask)
	if err != nil {
		cacheStoreTotal.WithLabelValues(string(job.task), "error").Inc()
		c.log.Warn("llmcache: store: redis failed",
			slog.String("task", string(job.task)),
			slog.Any("err", err))
		return
	}
	if evicted > 0 {
		cacheEvictionTotal.WithLabelValues(string(job.task)).Add(float64(evicted))
	}
	cacheStoreTotal.WithLabelValues(string(job.task), "stored").Inc()
	if size, ok := c.store.approxSize(ctx, job.task); ok {
		cacheSize.WithLabelValues(string(job.task)).Set(float64(size))
	}
}

// NoopCache — пустая реализация. Lookup всегда miss, Store всегда ок,
// Close — nil. Используется wirer'ом когда Redis или Ollama недоступны.
type NoopCache struct{}

// Lookup — всегда miss. Метрика "disabled" (не "miss"), чтобы разделить
// "реальный промах при включённом кеше" и "кеш отключён конфигом".
func (NoopCache) Lookup(_ context.Context, task llmchain.Task, _ string) (llmchain.Response, bool, error) {
	cacheLookupTotal.WithLabelValues(string(task), "disabled").Inc()
	return llmchain.Response{}, false, nil
}

// Store — no-op.
func (NoopCache) Store(_ context.Context, _ llmchain.Task, _ string, _ llmchain.Response) error {
	return nil
}

// Close — nil.
func (NoopCache) Close() error { return nil }

// Compile-time guards.
var (
	_ Cache = (*SemanticCache)(nil)
	_ Cache = NoopCache{}
)
