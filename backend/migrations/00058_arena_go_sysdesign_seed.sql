-- 00058_arena_go_sysdesign_seed.sql
-- Расширение пула задач арены по секциям `go` и `system_design`.
--
-- Контекст: 00003_content.sql завёл 30 algo / 15 sql, но всего 3 go (все
-- medium) и 2 system_design (оба hard). Matchmaker дёргает
-- PickBySectionDifficulty(section, difficulty) — на запросе go/easy,
-- go/hard, system_design/easy, system_design/medium запрос возвращал
-- ErrNotFound, и матч не мог собраться. Добавляем задачи по всем
-- difficulty, чтобы arena покрывала те же секции, что и mock_interview.
--
-- Test cases НЕ заводим: go-задачи здесь open-ended (concept + код,
-- проверяется человеком/AI-judge'ом, а не Judge0), system_design — чисто
-- design-rubric. Это согласуется со схемой 00003 (там для go/sd тоже
-- никаких test_cases не вставляется).

-- +goose Up
-- +goose StatementBegin

INSERT INTO tasks(slug, title_ru, title_en, description_ru, description_en,
                  difficulty, section, time_limit_sec, memory_limit_mb,
                  solution_hint, version, is_active) VALUES

-- ---------- GO :: EASY (4) ----------
('go-defer-order', 'Порядок выполнения defer', 'Defer Execution Order',
'## Задача
Объясните, что выведет программа, и почему. Затем перепишите её так, чтобы порядок вывода был обратным.

```go
func main() {
    for i := 0; i < 3; i++ {
        defer fmt.Println(i)
    }
}
```

## Что проверяется
- понимание LIFO-порядка `defer`
- захват переменной цикла (i по значению)
- альтернативная реализация без `defer` (slice + range в обратку).',
'## Task
Explain the program output and why. Rewrite it so the order is reversed.

```go
func main() {
    for i := 0; i < 3; i++ {
        defer fmt.Println(i)
    }
}
```

## Rubric
- LIFO `defer` semantics
- loop-variable capture (i is captured by value at defer time)
- alternative without defer (slice + reverse iteration).',
'easy', 'go', 60, 256,
'defer = LIFO. Output: 2 1 0. Argument is evaluated at defer time, so i is captured by value, not by closure. Reverse: store i in a slice and range over it.',
1, TRUE),

('go-slice-aliasing', 'Алиасинг слайсов', 'Slice Aliasing',
'## Задача
В каком случае присвоение `b := a[1:3]` не приведёт к разделяемому backing array? Покажите код, демонстрирующий, как мутация `b` ломает `a`, и предложите safe-copy решение.

## Что проверяется
- понимание заголовка слайса (ptr, len, cap)
- эффект `append` на overlap
- safe copy через `make + copy`.',
'## Task
When does `b := a[1:3]` NOT share the backing array with `a`? Show code where mutating `b` corrupts `a`, then provide a safe-copy alternative.

## Rubric
- slice header (ptr, len, cap)
- effect of `append` on overlapping slices
- safe copy via `make + copy`.',
'easy', 'go', 60, 256,
'Slicing always shares backing array unless cap is exceeded by append. Safe copy: out := make([]T, len(b)); copy(out, b).',
1, TRUE),

('go-error-wrapping', 'Обёртка ошибок', 'Error Wrapping',
'## Задача
Реализуйте функцию `LoadConfig(path string) (Config, error)`, которая читает файл и парсит JSON. На каждой стадии оберните ошибку с контекстом (`fmt.Errorf("...: %w", err)`), чтобы вызывающий мог использовать `errors.Is` / `errors.As`. Покажите, как клиент проверит `os.ErrNotExist`.

## Что проверяется
- `%w` vs `%v`
- `errors.Is` для sentinel-ошибок
- слои контекста без потери оригинала.',
'## Task
Implement `LoadConfig(path string) (Config, error)` that reads a file and parses JSON. Wrap errors at each stage with `fmt.Errorf("...: %w", err)` so callers can use `errors.Is` / `errors.As`. Show how a caller checks for `os.ErrNotExist`.

## Rubric
- `%w` vs `%v`
- `errors.Is` for sentinel errors
- layered context without losing the original.',
'easy', 'go', 60, 256,
'Use %w to wrap; errors.Is unwraps the chain. errors.As for typed errors. Wrapping at every layer keeps the chain inspectable.',
1, TRUE),

('go-zero-values', 'Zero values и nil maps', 'Zero Values & Nil Maps',
'## Задача
Что произойдёт при выполнении? Объясните каждое поведение и предложите минимальный фикс.

```go
var s []int
s = append(s, 1) // ?

var m map[string]int
m["x"] = 1       // ?

var p *int
fmt.Println(*p)  // ?
```

## Что проверяется
- nil-slice как валидный аргумент `append`
- nil-map → panic при записи
- nil-pointer dereference.',
'## Task
What happens here? Explain each case and provide the minimal fix.

```go
var s []int
s = append(s, 1) // ?

var m map[string]int
m["x"] = 1       // ?

var p *int
fmt.Println(*p)  // ?
```

## Rubric
- nil slice is fine for append
- nil map panics on write — must `make(map[string]int)`
- nil pointer dereference panics.',
'easy', 'go', 45, 256,
'append on nil slice is fine — returns a new slice. Writing to nil map panics. Dereferencing nil pointer panics. Always make() maps before writing.',
1, TRUE),

-- ---------- GO :: MEDIUM (4) ----------
('go-worker-pool', 'Worker pool с graceful shutdown', 'Worker Pool with Graceful Shutdown',
'## Задача
Реализуйте `Pool` с N воркерами и API `Submit(job func()) error`, `Close() error`. После `Close` новые `Submit`-ы возвращают ошибку, но запущенные jobs дорабатывают. Никаких утечек горутин.

## Что проверяется
- jobs канал + buffered/unbuffered trade-off
- закрытие канала ровно один раз (`sync.Once`)
- `WaitGroup` для ожидания воркеров
- сигнал ошибки на Submit после Close.',
'## Task
Implement `Pool` with N workers and `Submit(job func()) error`, `Close() error`. After `Close`, new `Submit`s return an error but in-flight jobs finish. No goroutine leaks.

## Rubric
- jobs channel (buffered/unbuffered trade-off)
- close exactly once (`sync.Once`)
- `WaitGroup` to wait for workers
- error signal on Submit after Close.',
'medium', 'go', 90, 256,
'Buffered jobs chan + N goroutines ranging it; Close sets atomic.Bool then sync.Once-closes the chan; Submit checks atomic before sending; WaitGroup.Wait in Close.',
1, TRUE),

('go-pipeline-fanin', 'Пайплайн fan-out / fan-in', 'Fan-Out / Fan-In Pipeline',
'## Задача
Постройте пайплайн `gen -> map (N горутин) -> reduce`. `gen` отдаёт числа в канал, `map` параллельно умножает на 2, `reduce` суммирует. Все этапы с поддержкой `context.Context` для досрочной отмены.

## Что проверяется
- паттерн fan-out / fan-in
- закрытие выходных каналов
- `select { case <-ctx.Done(): return }` в каждой горутине.',
'## Task
Build a `gen -> map (N goroutines) -> reduce` pipeline. `gen` emits ints, `map` doubles them in parallel, `reduce` sums. All stages support `context.Context` cancellation.

## Rubric
- fan-out / fan-in pattern
- closing output channels
- `select { case <-ctx.Done(): return }` in every goroutine.',
'medium', 'go', 90, 256,
'merge() goroutine per input chan, WaitGroup before close(out). Each stage selects on ctx.Done. Reduce stage just ranges over merged out and sums.',
1, TRUE),

('go-rate-limiter-token', 'Token-bucket rate limiter', 'Token Bucket Rate Limiter',
'## Задача
Реализуйте `RateLimiter` с API `Allow() bool` и `Wait(ctx) error`. Параметры: `rate` токенов/сек, `burst` максимум в bucket. Без сторонних зависимостей.

## Что проверяется
- мат-модель token bucket
- защита состояния mutex''ом
- корректная работа `Wait` с `context.Context`.',
'## Task
Implement `RateLimiter` with `Allow() bool` and `Wait(ctx) error`. Params: `rate` tokens/sec, `burst` max bucket size. No external deps.

## Rubric
- token-bucket math
- mutex-guarded state
- `Wait` integrates with `context.Context`.',
'medium', 'go', 90, 256,
'Maintain tokens float64 and lastRefill time.Time. On call: refill = elapsed*rate, clamp to burst, decrement on consume. Wait sleeps until next token, with select on ctx.Done.',
1, TRUE),

('go-singleflight', 'Дедупликация запросов через singleflight', 'Request Deduplication via Singleflight',
'## Задача
Реализуйте мини-`singleflight.Group` с методом `Do(key string, fn func() (any, error)) (any, error, bool)`. Если несколько горутин одновременно вызывают `Do` с одним key, fn выполняется ровно один раз, остальные ждут результат. Третий return — `shared bool`.

## Что проверяется
- map[string]*call под mutex
- `sync.WaitGroup` или канал для ожидания
- очистка ключа после завершения.',
'## Task
Implement a minimal `singleflight.Group` with `Do(key string, fn func() (any, error)) (any, error, bool)`. Concurrent `Do` calls for the same key invoke fn exactly once; the rest wait for the result. Third return = `shared bool`.

## Rubric
- map[string]*call under mutex
- `sync.WaitGroup` or channel for waiters
- key cleanup after completion.',
'medium', 'go', 90, 256,
'Mutex+map of in-flight calls. New caller registers, others find existing call and wg.Wait(). Leader runs fn, stores result, calls wg.Done, deletes key.',
1, TRUE),

-- ---------- GO :: HARD (3) ----------
('go-deadlock-channels', 'Deadlock на двух каналах', 'Two-Channel Deadlock',
'## Задача
Программа зависает. Найдите deadlock, объясните почему, и перепишите без него (оставив тот же контракт: A пишет в `ch1`, ждёт `ch2`; B пишет в `ch2`, ждёт `ch1`).

```go
ch1 := make(chan int)
ch2 := make(chan int)
go func() { ch1 <- 1; <-ch2 }()
go func() { ch2 <- 1; <-ch1 }()
```

## Что проверяется
- понимание неббуферизированных каналов
- паттерн `select` для разрешения порядка
- использование buffered channel или goroutine для развязки.',
'## Task
The program hangs. Identify the deadlock, explain why, and rewrite without it (keep the contract: A writes to `ch1`, waits for `ch2`; B writes to `ch2`, waits for `ch1`).

```go
ch1 := make(chan int)
ch2 := make(chan int)
go func() { ch1 <- 1; <-ch2 }()
go func() { ch2 <- 1; <-ch1 }()
```

## Rubric
- unbuffered channel semantics
- `select` to break ordering
- buffered channel or extra goroutine to decouple.',
'hard', 'go', 120, 256,
'Unbuffered send blocks until paired receive. Both goroutines block on send → deadlock. Fix: buffered channels (cap=1), or use select to receive concurrently with sending.',
1, TRUE),

('go-context-tree', 'Дерево контекстов и отмена', 'Context Tree & Cancellation',
'## Задача
Спроектируйте `CrawlSite(ctx, root)`, который параллельно обходит ссылки в глубину до 3 уровней с лимитом 10 одновременных горутин. При первой ошибке — отмена всего поддерева, но не ровесников. Покажите код и схему дерева контекстов.

## Что проверяется
- иерархия `context.WithCancel` / `WithTimeout`
- семафор через buffered channel
- разделение «отменить ребёнка» vs «отменить весь обход».',
'## Task
Design `CrawlSite(ctx, root)` that traverses links 3 levels deep, max 10 concurrent goroutines. On first error — cancel the subtree but not siblings. Show code and the ctx tree.

## Rubric
- `context.WithCancel` / `WithTimeout` hierarchy
- semaphore via buffered channel
- distinguish "cancel child" vs "cancel whole crawl".',
'hard', 'go', 120, 256,
'errgroup.WithContext gives sibling-cancel semantics. For subtree-only cancel, child gets its own WithCancel under parent. Semaphore = chan struct{} of cap 10.',
1, TRUE),

('go-memory-model', 'Гонки данных и happens-before', 'Data Races & Happens-Before',
'## Задача
Объясните, почему этот код имеет data race, и предложите 3 разных способа починить (sync/atomic, sync.Mutex, channel). Запустили бы вы `go test -race`?

```go
var ready bool
var data int

func writer() { data = 42; ready = true }
func reader() { for !ready {}; fmt.Println(data) }
```

## Что проверяется
- Go memory model: happens-before
- atomic.Bool / atomic.Store для флага
- channel close как happens-before edge.',
'## Task
Explain the data race and propose 3 fixes (sync/atomic, sync.Mutex, channel). Would you run `go test -race`?

```go
var ready bool
var data int

func writer() { data = 42; ready = true }
func reader() { for !ready {}; fmt.Println(data) }
```

## Rubric
- Go memory model: happens-before
- atomic.Bool / atomic.Store on the flag
- channel close as a happens-before edge.',
'hard', 'go', 120, 256,
'Without sync, no happens-before between writer and reader; data may be 0 even after ready is true. Fixes: atomic.Bool with Load/Store, Mutex around both, or close(ch) signaling.',
1, TRUE),

-- ---------- SYSTEM DESIGN :: EASY (3) ----------
('sd-pastebin', 'Дизайн pastebin', 'Design a Pastebin',
'## Задача
Спроектируйте сервис, где пользователь вставляет текст и получает короткий URL. Чтения 10x чаще записей, TTL 7 дней.

## Рубрика
1. API (POST paste, GET paste/{id})
2. Генерация ID и хранение
3. Когда object storage (S3) выгоднее БД
4. Кэширование популярных paste
5. Ограничения по размеру / rate limit.',
'## Task
Design a service where users paste text and get a short URL. Reads are 10x writes, TTL 7 days.

## Rubric
1. API (POST paste, GET paste/{id})
2. ID generation and storage
3. When object storage (S3) beats DB
4. Caching popular pastes
5. Size limits / rate limit.',
'easy', 'system_design', 90, 256,
'Short ID via base62 + DB sequence; meta in Postgres, body in S3 if >small threshold; CDN cache for hot pastes; TTL via lifecycle policy.',
1, TRUE),

('sd-news-feed-mvp', 'MVP ленты новостей', 'News Feed MVP',
'## Задача
Спроектируйте MVP ленты пользователя: чтение последних 50 постов от подписок. ~1k пользователей, ~10 постов/день каждый.

## Рубрика
1. API (GET /feed)
2. Схема в PostgreSQL
3. Сортировка по времени, пагинация (cursor)
4. Когда стоит думать о денормализации (fan-out on write).',
'## Task
Design a user feed MVP: read latest 50 posts from followees. ~1k users, ~10 posts/day each.

## Rubric
1. API (GET /feed)
2. PostgreSQL schema
3. Time sort, cursor pagination
4. When to consider denormalisation (fan-out on write).',
'easy', 'system_design', 90, 256,
'Single SQL: posts JOIN follows ORDER BY created_at DESC LIMIT 50 — fine for MVP. Cursor on (created_at, id). Fan-out on write only when read load justifies it.',
1, TRUE),

('sd-key-value-cache', 'Дизайн in-memory кэша', 'Design an In-Memory Cache',
'## Задача
Спроектируйте in-memory key-value кэш с фиксированным лимитом по памяти, TTL и LRU-эвикцией. Single-host, no replication.

## Рубрика
1. API (Get/Set/Delete)
2. LRU через doubly linked list + hash map
3. TTL: lazy expire vs background sweeper
4. Метрики: hit rate, evictions
5. Где сломается single-host.',
'## Task
Design an in-memory KV cache with a fixed memory limit, TTL, and LRU eviction. Single host, no replication.

## Rubric
1. API (Get/Set/Delete)
2. LRU via doubly linked list + hash map
3. TTL: lazy expire vs background sweeper
4. Metrics: hit rate, evictions
5. Where single-host breaks.',
'easy', 'system_design', 90, 256,
'Classic LRU = HashMap[key]→Node + DLL. TTL on each entry, lazy on Get + periodic sweep. Memory accounting per entry. Replication / sharding is the next leap.',
1, TRUE),

-- ---------- SYSTEM DESIGN :: MEDIUM (3) ----------
('sd-chat-app', 'Дизайн чата 1-1', 'Design a 1-1 Chat',
'## Задача
Спроектируйте мессенджер 1-1 с доставкой реального времени, историей и подтверждениями delivered/read. ~100k DAU.

## Рубрика
1. WebSocket/long-poll выбор и подключение
2. Хранилище сообщений (Cassandra / Postgres + sharding)
3. Push-нотификации в офлайне
4. Гарантии порядка и идемпотентности
5. Партиционирование по conversation_id.',
'## Task
Design a 1-1 messenger with real-time delivery, history, and delivered/read receipts. ~100k DAU.

## Rubric
1. WebSocket/long-poll choice and connection model
2. Message storage (Cassandra / Postgres + sharding)
3. Push notifications when offline
4. Ordering and idempotency guarantees
5. Partition by conversation_id.',
'medium', 'system_design', 100, 256,
'WebSocket gateways behind LB, sticky by user; conversation_id as Cassandra partition key; APNs/FCM for offline; client-generated message_id for idempotency; receipts as separate events.',
1, TRUE),

('sd-job-queue', 'Дизайн распределённой очереди задач', 'Design a Distributed Job Queue',
'## Задача
Спроектируйте систему отложенных и периодических задач: enqueue, retry с backoff, priority, dedup, observability. Цель: 10k jobs/sec.

## Рубрика
1. Брокер: Redis Streams / Kafka / SQS — trade-offs
2. Семантика at-least-once и идемпотентность хэндлеров
3. Retry/backoff/dead-letter
4. Шедулер для periodic jobs
5. Метрики и алерты.',
'## Task
Design a delayed + periodic job system: enqueue, backoff retry, priority, dedup, observability. Target: 10k jobs/sec.

## Rubric
1. Broker: Redis Streams / Kafka / SQS — trade-offs
2. At-least-once semantics + handler idempotency
3. Retry / backoff / dead-letter
4. Scheduler for periodic jobs
5. Metrics and alerts.',
'medium', 'system_design', 100, 256,
'Redis Streams = simple + low-latency, Kafka = high throughput + replay, SQS = managed. Idempotency via job_id key. DLQ after N retries. Cron leader-elected (or use a scheduler service).',
1, TRUE),

('sd-image-cdn', 'Дизайн CDN для изображений', 'Design an Image CDN',
'## Задача
Спроектируйте систему обработки и доставки картинок: upload, on-the-fly resize, CDN-кэш, инвалидация.

## Рубрика
1. Upload путь и хранение оригиналов (S3)
2. On-the-fly transform (Lambda@Edge / отдельный сервис)
3. Cache-keys и cache-busting
4. Сигнатуры URL и защита от hot-linking
5. Бюджет хранения (variants vs derive on-demand).',
'## Task
Design image processing + delivery: upload, on-the-fly resize, CDN cache, invalidation.

## Rubric
1. Upload path + original storage (S3)
2. On-the-fly transform (Lambda@Edge / dedicated service)
3. Cache keys + cache-busting
4. URL signing + hot-link protection
5. Storage budget (variants vs derive on-demand).',
'medium', 'system_design', 100, 256,
'S3 origin + CDN front. Resize service derives on cache miss; cache key includes transform params. Invalidate via versioned URLs. Signed URLs for private content.',
1, TRUE),

-- ---------- SYSTEM DESIGN :: HARD (2 extra) ----------
('sd-search-typeahead', 'Дизайн search typeahead', 'Design Search Typeahead',
'## Задача
Спроектируйте автокомплит поисковой строки: <100ms p99, top-N suggestions по префиксу, обновление популярности раз в час.

## Рубрика
1. Структура (Trie / FST) и обновление
2. Распределение: где хранить индекс, кэш у клиента
3. Ranking: частота, personalisation, recency
4. Обработка typo (edit distance)
5. Метрики качества и A/B.',
'## Task
Design a search typeahead: <100ms p99, top-N prefix suggestions, popularity refresh every hour.

## Rubric
1. Structure (Trie / FST) and updates
2. Distribution: where the index lives, client-side cache
3. Ranking: frequency, personalisation, recency
4. Typo handling (edit distance)
5. Quality metrics + A/B.',
'hard', 'system_design', 120, 256,
'In-memory Trie/FST per shard, replicated read-only. Hourly pipeline rebuilds from query logs. Edge cache + bloom filter for cold prefixes. Personalisation = re-rank top-K by user signals.',
1, TRUE),

('sd-payment-system', 'Дизайн платёжной системы', 'Design a Payment System',
'## Задача
Спроектируйте обработку платежей: provider abstraction, idempotency, reconciliation, refunds, audit.

## Рубрика
1. State machine платежа
2. Idempotency-Key и защита от двойного списания
3. Reconciliation с провайдером (file / API)
4. Outbox pattern для events
5. PCI-scope и хранение чувствительных данных.',
'## Task
Design payment processing: provider abstraction, idempotency, reconciliation, refunds, audit.

## Rubric
1. Payment state machine
2. Idempotency-Key + double-charge protection
3. Provider reconciliation (file / API)
4. Outbox pattern for events
5. PCI scope + sensitive data storage.',
'hard', 'system_design', 120, 256,
'Strict state machine (created→authorised→captured→settled). Idempotency-Key stored with terminal result. Daily recon job diffs ledger vs provider. Outbox + relay for at-least-once events. Tokenise PAN — never store raw.',
1, TRUE)

ON CONFLICT (slug) DO NOTHING;

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin

DELETE FROM tasks WHERE slug IN (
    'go-defer-order','go-slice-aliasing','go-error-wrapping','go-zero-values',
    'go-worker-pool','go-pipeline-fanin','go-rate-limiter-token','go-singleflight',
    'go-deadlock-channels','go-context-tree','go-memory-model',
    'sd-pastebin','sd-news-feed-mvp','sd-key-value-cache',
    'sd-chat-app','sd-job-queue','sd-image-cdn',
    'sd-search-typeahead','sd-payment-system'
);

-- +goose StatementEnd
