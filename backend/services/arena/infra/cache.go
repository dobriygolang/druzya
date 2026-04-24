// Package infra: cache.go — read-through cache поверх Redis для
// arena bounded context. Сейчас от кэша выигрывают два hot-read:
//
//   - GET /api/v1/arena/match/{matchId}  →  MatchInfoCache (TTL 60с)
//   - «queue stats» на /arena            →  QueueStatsCache (TTL 10с)
//
// Оба по форме повторяют profile/infra/cache.go: крохотный интерфейс KV
// (Get/Set/Del), JSON-маршалинг, singleflight для схлопывания stampede,
// ошибки Redis ЛОГИРУЮТСЯ, но НИКОГДА не ломают запрос — всегда
// падаем на upstream-loader. Явные Invalidate-хуки дают писателям
// детерминированно сбивать кэш (например, при завершении матча).
package infra

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"sync"
	"time"

	"druz9/arena/domain"
	"druz9/shared/enums"

	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
	"golang.org/x/sync/singleflight"
)

// CacheKeyVersion поднимают всякий раз, когда меняется on-disk форма JSON.
// Подъём вызывает roll-over промахов кэша без ручного FLUSHDB.
const CacheKeyVersion = "v1"

// DefaultMatchInfoTTL — per-key TTL для кэшированных match-view.
// Метаданные матча после старта почти не меняются; всё же ограничиваем 60с,
// чтобы обновления ELO участников после MatchCompleted подхватывались быстро.
const DefaultMatchInfoTTL = 60 * time.Second

// DefaultQueueStatsTTL — per-key TTL для карточки queue-stats на лендинге
// arena. Маленький — счётчик колеблется каждый tick.
const DefaultQueueStatsTTL = 10 * time.Second

// DefaultMatchHistoryTTL — per-key TTL для страницы /match-history.
// История меняется только после завершения матча — обратный путь:
// обработчик события MatchEnded вызывает MatchHistoryCache.Invalidate(uid).
// 30с — потолок по bible: коротко, чтобы пропущенный invalidate был
// незаметен пользователю, и достаточно долго, чтобы гасить шторм
// обновлений dashboard'а.
const DefaultMatchHistoryTTL = 30 * time.Second

// KV — маленькое подмножество Redis, используемое arena-кэшем.
// *redis.Client удовлетворяет его через kvAdapter ниже; тесты подсовывают
// in-memory map.
type KV interface {
	Get(ctx context.Context, key string) (string, error)
	Set(ctx context.Context, key string, value []byte, ttl time.Duration) error
	Del(ctx context.Context, keys ...string) error
}

// ErrCacheMiss — sentinel, который KV.Get возвращает при отсутствии ключа.
var ErrCacheMiss = errors.New("arena.cache: miss")

// kvAdapter адаптирует *redis.Client к интерфейсу KV.
type kvAdapter struct{ rdb *redis.Client }

// NewRedisKV собирает продакшн-KV поверх реального Redis-клиента.
func NewRedisKV(rdb *redis.Client) KV { return kvAdapter{rdb: rdb} }

func (a kvAdapter) Get(ctx context.Context, key string) (string, error) {
	v, err := a.rdb.Get(ctx, key).Result()
	if errors.Is(err, redis.Nil) {
		return "", ErrCacheMiss
	}
	if err != nil {
		return "", fmt.Errorf("arena.cache.kv.Get: %w", err)
	}
	return v, nil
}

func (a kvAdapter) Set(ctx context.Context, key string, value []byte, ttl time.Duration) error {
	if err := a.rdb.Set(ctx, key, value, ttl).Err(); err != nil {
		return fmt.Errorf("arena.cache.kv.Set: %w", err)
	}
	return nil
}

func (a kvAdapter) Del(ctx context.Context, keys ...string) error {
	if len(keys) == 0 {
		return nil
	}
	if err := a.rdb.Del(ctx, keys...).Err(); err != nil {
		return fmt.Errorf("arena.cache.kv.Del: %w", err)
	}
	return nil
}

// ── Кэш MatchInfo ─────────────────────────────────────────────────────────

// MatchInfoSnapshot — проекция матча, пригодная к кэшированию. Храним
// только неизменные / медленно меняющиеся поля — кода, suspicion score'ов,
// anti-cheat счётчиков тут НЕТ (намеренно: их читают разово и они быстро
// обновляются).
type MatchInfoSnapshot struct {
	Match        domain.Match
	Task         *domain.TaskPublic
	Participants []domain.Participant
}

// MatchInfoLoader подгружает snapshot из upstream (Postgres) при промахе кэша.
type MatchInfoLoader func(ctx context.Context, matchID uuid.UUID) (MatchInfoSnapshot, error)

// MatchInfoCache оборачивает loader read-through-кэшем поверх Redis.
type MatchInfoCache struct {
	kv     KV
	ttl    time.Duration
	log    *slog.Logger
	loader MatchInfoLoader
	sf     singleflight.Group
}

// NewMatchInfoCache собирает кэш. log обязателен (anti-fallback policy).
func NewMatchInfoCache(kv KV, ttl time.Duration, log *slog.Logger, loader MatchInfoLoader) *MatchInfoCache {
	if ttl <= 0 {
		ttl = DefaultMatchInfoTTL
	}
	if log == nil {
		panic("arena.infra.NewMatchInfoCache: logger is required (anti-fallback policy: no silent noop loggers)")
	}
	return &MatchInfoCache{kv: kv, ttl: ttl, log: log, loader: loader}
}

// keyMatchInfo возвращает Redis-ключ для match-info по match-id.
func keyMatchInfo(matchID uuid.UUID) string {
	return fmt.Sprintf("arena:%s:match:%s", CacheKeyVersion, matchID.String())
}

// Get возвращает snapshot, обращаясь к upstream при промахе.
func (c *MatchInfoCache) Get(ctx context.Context, matchID uuid.UUID) (MatchInfoSnapshot, error) {
	key := keyMatchInfo(matchID)
	if raw, err := c.kv.Get(ctx, key); err == nil {
		var snap MatchInfoSnapshot
		if jerr := json.Unmarshal([]byte(raw), &snap); jerr == nil {
			return snap, nil
		}
		c.log.Warn("arena.cache: corrupt match entry, refreshing",
			slog.String("key", key))
	} else if !errors.Is(err, ErrCacheMiss) {
		c.log.Warn("arena.cache: redis Get failed, falling back",
			slog.String("key", key), slog.Any("err", err))
	}
	v, err, _ := c.sf.Do(key, func() (any, error) {
		return c.loader(ctx, matchID)
	})
	if err != nil {
		return MatchInfoSnapshot{}, fmt.Errorf("arena.cache.MatchInfo.Get: %w", err)
	}
	snap, ok := v.(MatchInfoSnapshot)
	if !ok {
		return MatchInfoSnapshot{}, fmt.Errorf("arena.cache: singleflight returned %T", v)
	}
	if data, jerr := json.Marshal(snap); jerr == nil {
		if serr := c.kv.Set(ctx, key, data, c.ttl); serr != nil {
			c.log.Warn("arena.cache: redis Set failed",
				slog.String("key", key), slog.Any("err", serr))
		}
	}
	return snap, nil
}

// Invalidate выселяет запись. Безопасен до/после записи; идемпотентен.
func (c *MatchInfoCache) Invalidate(ctx context.Context, matchID uuid.UUID) {
	if err := c.kv.Del(ctx, keyMatchInfo(matchID)); err != nil {
		c.log.Warn("arena.cache: redis Del failed",
			slog.String("match", matchID.String()), slog.Any("err", err))
	}
}

// ── Кэш queue-stats ───────────────────────────────────────────────────────

// QueueStats — маленький payload, показываемый на /arena (число ожидающих
// игроков по паре (mode, section) и грубая ETA, выведенная из длины очереди).
type QueueStats struct {
	Mode      enums.ArenaMode `json:"mode"`
	Section   enums.Section   `json:"section"`
	Waiting   int             `json:"waiting"`
	EstWaitMs int64           `json:"est_wait_ms"`
}

// QueueStatsLoader возвращает свежие stats из счётчиков Redis ZSET.
type QueueStatsLoader func(ctx context.Context, mode enums.ArenaMode, section enums.Section) (QueueStats, error)

// QueueStatsCache оборачивает loader кэшем с TTL 10с.
type QueueStatsCache struct {
	kv     KV
	ttl    time.Duration
	log    *slog.Logger
	loader QueueStatsLoader
	sf     singleflight.Group
}

// NewQueueStatsCache собирает кэш. log обязателен (anti-fallback policy).
func NewQueueStatsCache(kv KV, ttl time.Duration, log *slog.Logger, loader QueueStatsLoader) *QueueStatsCache {
	if ttl <= 0 {
		ttl = DefaultQueueStatsTTL
	}
	if log == nil {
		panic("arena.infra.NewQueueStatsCache: logger is required (anti-fallback policy: no silent noop loggers)")
	}
	return &QueueStatsCache{kv: kv, ttl: ttl, log: log, loader: loader}
}

// keyQueueStats возвращает Redis-ключ для queue-stats по (mode, section).
func keyQueueStats(mode enums.ArenaMode, section enums.Section) string {
	return fmt.Sprintf("arena:%s:queue_stats:%s:%s", CacheKeyVersion, mode, section)
}

// Get возвращает stats, обращаясь к upstream при промахе.
func (c *QueueStatsCache) Get(ctx context.Context, mode enums.ArenaMode, section enums.Section) (QueueStats, error) {
	key := keyQueueStats(mode, section)
	if raw, err := c.kv.Get(ctx, key); err == nil {
		var s QueueStats
		if jerr := json.Unmarshal([]byte(raw), &s); jerr == nil {
			return s, nil
		}
		c.log.Warn("arena.cache: corrupt queue_stats entry, refreshing",
			slog.String("key", key))
	} else if !errors.Is(err, ErrCacheMiss) {
		c.log.Warn("arena.cache: redis Get failed, falling back",
			slog.String("key", key), slog.Any("err", err))
	}
	v, err, _ := c.sf.Do(key, func() (any, error) {
		return c.loader(ctx, mode, section)
	})
	if err != nil {
		return QueueStats{}, fmt.Errorf("arena.cache.QueueStats.Get: %w", err)
	}
	s, ok := v.(QueueStats)
	if !ok {
		return QueueStats{}, fmt.Errorf("arena.cache: singleflight returned %T", v)
	}
	if data, jerr := json.Marshal(s); jerr == nil {
		if serr := c.kv.Set(ctx, key, data, c.ttl); serr != nil {
			c.log.Warn("arena.cache: redis Set failed",
				slog.String("key", key), slog.Any("err", serr))
		}
	}
	return s, nil
}

// Invalidate выселяет конкретный stat по (mode, section).
func (c *QueueStatsCache) Invalidate(ctx context.Context, mode enums.ArenaMode, section enums.Section) {
	if err := c.kv.Del(ctx, keyQueueStats(mode, section)); err != nil {
		c.log.Warn("arena.cache: redis Del failed",
			slog.String("mode", string(mode)), slog.String("section", string(section)),
			slog.Any("err", err))
	}
}

// ── Кэш match-history ─────────────────────────────────────────────────────

// MatchHistoryFilters фиксирует окно страницы + опциональные фильтры.
// JSON-сериализуются в ключ кэша, чтобы разные кортежи
// (limit, offset, mode, section) уживались, не сталкиваясь.
type MatchHistoryFilters struct {
	Limit   int             `json:"limit"`
	Offset  int             `json:"offset"`
	Mode    enums.ArenaMode `json:"mode"`
	Section enums.Section   `json:"section"`
}

// MatchHistorySnapshot — кэшируемая проекция одной страницы истории.
// Рядом с Items храним Total, чтобы пагинируемым UI не пришлось делать
// второй некэшированный COUNT.
type MatchHistorySnapshot struct {
	Items []domain.MatchHistoryEntry `json:"items"`
	Total int                        `json:"total"`
}

// MatchHistoryLoader подгружает страницу из upstream (Postgres) при промахе.
type MatchHistoryLoader func(ctx context.Context, userID uuid.UUID, f MatchHistoryFilters) (MatchHistorySnapshot, error)

// MatchHistoryCache оборачивает MatchHistoryLoader read-through-кэшем
// поверх Redis + per-user инвалидацией. Per-key TTL — верхняя граница;
// явный Invalidate(uid) бампает per-user «эпоху», встроенную в ключ,
// из-за чего каждая закэшированная страница этого пользователя мгновенно
// промахивается без SCAN по Redis (паттерн marker-key, как в profile/cache).
type MatchHistoryCache struct {
	kv     KV
	ttl    time.Duration
	log    *slog.Logger
	loader MatchHistoryLoader
	sf     singleflight.Group

	// epochs — in-process per-user счётчик, который бампается на Invalidate.
	// В сочетании с ключом кэша даёт O(1) «выгнать всё для uid».
	// Map ограничен активными пользователями — записи не удаляем (устаревшая
	// эпоха безвредна, соответствующие Redis-ключи сами истекают по TTL).
	epochMu sync.RWMutex
	epochs  map[uuid.UUID]uint64
}

// NewMatchHistoryCache собирает кэш. log обязателен (anti-fallback policy).
func NewMatchHistoryCache(kv KV, ttl time.Duration, log *slog.Logger, loader MatchHistoryLoader) *MatchHistoryCache {
	if ttl <= 0 {
		ttl = DefaultMatchHistoryTTL
	}
	if log == nil {
		panic("arena.infra.NewMatchHistoryCache: logger is required (anti-fallback policy: no silent noop loggers)")
	}
	return &MatchHistoryCache{
		kv:     kv,
		ttl:    ttl,
		log:    log,
		loader: loader,
		epochs: make(map[uuid.UUID]uint64),
	}
}

// epochOf возвращает текущее «поколение» инвалидации для userID.
func (c *MatchHistoryCache) epochOf(userID uuid.UUID) uint64 {
	c.epochMu.RLock()
	defer c.epochMu.RUnlock()
	return c.epochs[userID]
}

// keyMatchHistory выводит Redis-ключ по (user, epoch, filters). Бамп
// per-user эпохи через Invalidate мгновенно делает все старые ключи miss'ом.
func keyMatchHistory(userID uuid.UUID, epoch uint64, f MatchHistoryFilters) string {
	mode := string(f.Mode)
	if mode == "" {
		mode = "_"
	}
	sec := string(f.Section)
	if sec == "" {
		sec = "_"
	}
	return fmt.Sprintf("arena:%s:history:%s:e%d:%d:%d:%s:%s",
		CacheKeyVersion, userID.String(), epoch, f.Limit, f.Offset, mode, sec)
}

// Get возвращает одну страницу истории, обращаясь к upstream при промахе.
func (c *MatchHistoryCache) Get(ctx context.Context, userID uuid.UUID, f MatchHistoryFilters) (MatchHistorySnapshot, error) {
	epoch := c.epochOf(userID)
	key := keyMatchHistory(userID, epoch, f)

	if raw, err := c.kv.Get(ctx, key); err == nil {
		var snap MatchHistorySnapshot
		if jerr := json.Unmarshal([]byte(raw), &snap); jerr == nil {
			return snap, nil
		}
		c.log.Warn("arena.cache: corrupt history entry, refreshing",
			slog.String("key", key))
	} else if !errors.Is(err, ErrCacheMiss) {
		c.log.Warn("arena.cache: redis Get failed, falling back",
			slog.String("key", key), slog.Any("err", err))
	}
	v, err, _ := c.sf.Do(key, func() (any, error) {
		return c.loader(ctx, userID, f)
	})
	if err != nil {
		return MatchHistorySnapshot{}, fmt.Errorf("arena.cache.MatchHistory.Get: %w", err)
	}
	snap, ok := v.(MatchHistorySnapshot)
	if !ok {
		return MatchHistorySnapshot{}, fmt.Errorf("arena.cache: singleflight returned %T", v)
	}
	if data, jerr := json.Marshal(snap); jerr == nil {
		if serr := c.kv.Set(ctx, key, data, c.ttl); serr != nil {
			c.log.Warn("arena.cache: redis Set failed",
				slog.String("key", key), slog.Any("err", serr))
		}
	}
	return snap, nil
}

// Invalidate выселяет все закэшированные страницы userID, бампая per-user
// счётчик эпох. Старые ключи сами истекают по TTL — SCAN не нужен.
func (c *MatchHistoryCache) Invalidate(_ context.Context, userID uuid.UUID) {
	c.epochMu.Lock()
	c.epochs[userID]++
	c.epochMu.Unlock()
}

// ── CachedHistoryRepo — обёртка над domain.MatchRepo, которая роутит
// ListByUser через MatchHistoryCache, а все остальные вызовы прокидывает
// в upstream repo напрямую. Именно эту обёртку видит app.GetMyMatches,
// поэтому use-case остаётся независимым от Redis.

// CachedHistoryRepo композирует domain.MatchRepo с MatchHistoryCache.
type CachedHistoryRepo struct {
	domain.MatchRepo
	cache *MatchHistoryCache
}

// NewCachedHistoryRepo собирает CachedHistoryRepo поверх переданного
// upstream repo и кэша. Оба должны быть не-nil.
func NewCachedHistoryRepo(upstream domain.MatchRepo, cache *MatchHistoryCache) *CachedHistoryRepo {
	return &CachedHistoryRepo{MatchRepo: upstream, cache: cache}
}

// ListByUser роутит через кэш. За реальный поход в Postgres отвечает
// upstream-loader, замкнутый на кэше.
func (c *CachedHistoryRepo) ListByUser(
	ctx context.Context,
	userID uuid.UUID,
	limit, offset int,
	modeFilter enums.ArenaMode,
	sectionFilter enums.Section,
) ([]domain.MatchHistoryEntry, int, error) {
	snap, err := c.cache.Get(ctx, userID, MatchHistoryFilters{
		Limit:   limit,
		Offset:  offset,
		Mode:    modeFilter,
		Section: sectionFilter,
	})
	if err != nil {
		return nil, 0, err
	}
	return snap.Items, snap.Total, nil
}

// Interface guard — делает drift заметным, если у MatchRepo появятся новые методы.
var _ domain.MatchRepo = (*CachedHistoryRepo)(nil)
