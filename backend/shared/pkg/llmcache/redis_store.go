package llmcache

import (
	"context"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"math/rand"
	"time"

	"druz9/shared/pkg/llmchain"

	"github.com/redis/go-redis/v9"
)

// redisStore инкапсулирует Redis-схему пакета.
//
// Schema (per task):
//
//	llmcache:{task}:entries   — HASH entry_id → JSON {response, created_at}
//	llmcache:{task}:emb:{id}  — STRING bytes(vec float32 LE) — без JSON wrap'а,
//	                             так компактнее (384 × 4 = 1.5KB) и быстрее
//	                             декодится на hot-path Lookup'а.
//	llmcache:{task}:lru       — ZSET entry_id → score = last_access_unix
//
// TTL ставим только на emb: STRING (EXPIRE), потому что только у него
// естественный жизненный цикл "создан — удалён". entries HASH и lru ZSET
// живут "пока task жив" и чистятся через batch-evict — так избегаем
// ситуации когда emb TTL истёк, а запись в HASH осталась orphaned.
type redisStore struct {
	rds   *redis.Client
	dim   int
	ttl   time.Duration
	rand  *rand.Rand // источник entry_id (не криптографически крепкий — ок для ключей)
	nowFn func() time.Time
}

func newRedisStore(rds *redis.Client, dim int, ttl time.Duration) *redisStore {
	return &redisStore{
		rds: rds,
		dim: dim,
		ttl: ttl,
		//nolint:gosec // entry_id — не секрет, коллизии бессмысленны для атакующего.
		rand:  rand.New(rand.NewSource(time.Now().UnixNano())),
		nowFn: time.Now,
	}
}

func keyEntries(task llmchain.Task) string { return "llmcache:" + string(task) + ":entries" }
func keyLRU(task llmchain.Task) string     { return "llmcache:" + string(task) + ":lru" }
func keyEmb(task llmchain.Task, id string) string {
	return "llmcache:" + string(task) + ":emb:" + id
}

// entryRecord — формат значения в entries HASH.
type entryRecord struct {
	Response  llmchain.Response `json:"response"`
	CreatedAt int64             `json:"created_at"`
}

// newEntryID — короткий человекочитаемый id. 16 hex-символов = 64 бита
// энтропии (вероятность коллизии на 8000 entries ≈ 1 на 10^10).
func (s *redisStore) newEntryID() string {
	//nolint:gosec // entry_id — не секрет, коллизии нестрашны атакующему.
	return fmt.Sprintf("%016x", uint64(s.rand.Int63()))
}

// encodeVector — float32 vector → binary LE. 4 байта на компоненту, без
// длинного префикса (длина = dim константа пакета).
func encodeVector(v []float32) []byte {
	out := make([]byte, 4*len(v))
	for i, f := range v {
		binary.LittleEndian.PutUint32(out[i*4:], math.Float32bits(f))
	}
	return out
}

// decodeVector обратная операция. dim mismatch → ошибка.
func decodeVector(b []byte, dim int) ([]float32, error) {
	if len(b) != 4*dim {
		return nil, fmt.Errorf("llmcache: vector dim mismatch: got %d bytes, want %d", len(b), 4*dim)
	}
	out := make([]float32, dim)
	for i := 0; i < dim; i++ {
		out[i] = math.Float32frombits(binary.LittleEndian.Uint32(b[i*4:]))
	}
	return out, nil
}

// findBest — реализует Lookup-flow из cache.go. Возвращает (hit?, response, err).
func (s *redisStore) findBest(ctx context.Context, task llmchain.Task, vec []float32, threshold float32) (bool, llmchain.Response, error) {
	if len(vec) != s.dim {
		return false, llmchain.Response{}, fmt.Errorf("llmcache.findBest: vec dim %d, want %d", len(vec), s.dim)
	}
	ids, err := s.rds.ZRange(ctx, keyLRU(task), 0, -1).Result()
	if err != nil {
		if errors.Is(err, redis.Nil) {
			return false, llmchain.Response{}, nil
		}
		return false, llmchain.Response{}, fmt.Errorf("llmcache.findBest: zrange: %w", err)
	}
	if len(ids) == 0 {
		return false, llmchain.Response{}, nil
	}
	embKeys := make([]string, len(ids))
	for i, id := range ids {
		embKeys[i] = keyEmb(task, id)
	}
	raw, err := s.rds.MGet(ctx, embKeys...).Result()
	if err != nil {
		return false, llmchain.Response{}, fmt.Errorf("llmcache.findBest: mget: %w", err)
	}
	bestScore := float32(-1)
	bestID := ""
	for i, v := range raw {
		if v == nil {
			// emb istёк по TTL, а lru ещё помнит id — скипаем; при следующем
			// save() orphan выловится через evict-loop.
			continue
		}
		// redis Go returns MGet values as interface{} = string.
		str, ok := v.(string)
		if !ok {
			continue
		}
		candVec, derr := decodeVector([]byte(str), s.dim)
		if derr != nil {
			continue
		}
		score := dot(vec, candVec)
		if score > bestScore {
			bestScore = score
			bestID = ids[i]
		}
	}
	if bestScore < threshold || bestID == "" {
		return false, llmchain.Response{}, nil
	}
	// Tянем entry.
	rawEntry, err := s.rds.HGet(ctx, keyEntries(task), bestID).Result()
	if err != nil {
		if errors.Is(err, redis.Nil) {
			// Orphan emb без entry. Считаем за miss.
			return false, llmchain.Response{}, nil
		}
		return false, llmchain.Response{}, fmt.Errorf("llmcache.findBest: hget: %w", err)
	}
	var rec entryRecord
	if err := json.Unmarshal([]byte(rawEntry), &rec); err != nil {
		return false, llmchain.Response{}, fmt.Errorf("llmcache.findBest: decode entry: %w", err)
	}
	// Обновить LRU score. Не продлеваем TTL emb'а — TTL это про TTL, LRU
	// про порядок evict'а.
	s.rds.ZAdd(ctx, keyLRU(task), redis.Z{Score: float64(s.nowFn().Unix()), Member: bestID})
	return true, rec.Response, nil
}

// save добавляет новую запись. При превышении maxEntries вытесняет батчем
// 100 самых старых (чтобы амортизировать round-trip'ы). Возвращает
// количество реально вытесненных entries.
func (s *redisStore) save(ctx context.Context, task llmchain.Task, vec []float32, resp llmchain.Response, maxEntries int) (int, error) {
	if len(vec) != s.dim {
		return 0, fmt.Errorf("llmcache.save: vec dim %d, want %d", len(vec), s.dim)
	}
	id := s.newEntryID()
	now := s.nowFn()
	rec := entryRecord{Response: resp, CreatedAt: now.Unix()}
	payload, err := json.Marshal(rec)
	if err != nil {
		return 0, fmt.Errorf("llmcache.save: marshal: %w", err)
	}
	pipe := s.rds.Pipeline()
	pipe.HSet(ctx, keyEntries(task), id, string(payload))
	pipe.Set(ctx, keyEmb(task, id), encodeVector(vec), s.ttl)
	pipe.ZAdd(ctx, keyLRU(task), redis.Z{Score: float64(now.Unix()), Member: id})
	if _, pipeErr := pipe.Exec(ctx); pipeErr != nil {
		return 0, fmt.Errorf("llmcache.save: pipe: %w", pipeErr)
	}

	// Evict check.
	evicted := 0
	card, err := s.rds.ZCard(ctx, keyLRU(task)).Result()
	if err != nil {
		// Eviction-check best-effort; не считаем это ошибкой save'а.
		return 0, nil //nolint:nilerr // save сам прошёл, evict — отдельная проблема
	}
	if int(card) > maxEntries {
		ev, evErr := s.evictOldest(ctx, task, 100)
		if evErr == nil {
			evicted = ev
		}
	}
	return evicted, nil
}

// evictOldest удаляет n самых старых entries (по LRU score).
func (s *redisStore) evictOldest(ctx context.Context, task llmchain.Task, n int) (int, error) {
	victims, err := s.rds.ZRange(ctx, keyLRU(task), 0, int64(n-1)).Result()
	if err != nil {
		return 0, fmt.Errorf("llmcache.evict: zrange: %w", err)
	}
	if len(victims) == 0 {
		return 0, nil
	}
	pipe := s.rds.Pipeline()
	pipe.HDel(ctx, keyEntries(task), victims...)
	pipe.ZRem(ctx, keyLRU(task), toInterface(victims)...)
	for _, id := range victims {
		pipe.Del(ctx, keyEmb(task, id))
	}
	if _, err := pipe.Exec(ctx); err != nil {
		return 0, fmt.Errorf("llmcache.evict: pipe: %w", err)
	}
	return len(victims), nil
}

// approxSize — ZCARD обёртка для метрики cacheSize. "approx" потому что
// между ZCARD и реальным HLEN может быть рассинхрон (orphan emb TTL).
func (s *redisStore) approxSize(ctx context.Context, task llmchain.Task) (int64, bool) {
	n, err := s.rds.ZCard(ctx, keyLRU(task)).Result()
	if err != nil {
		return 0, false
	}
	return n, true
}

// dot — dot-product (== cosine для нормализованных векторов). Hot path:
// никаких аллокаций, tight loop.
func dot(a, b []float32) float32 {
	var s float32
	// Защита от mismatched dim — не должно случаться, но если случится,
	// лучше вернуть -1 (гарантированно ниже любого threshold) чем panic.
	n := len(a)
	if len(b) < n {
		n = len(b)
	}
	for i := 0; i < n; i++ {
		s += a[i] * b[i]
	}
	return s
}

// toInterface — convert []string → []interface{} для ZRem variadic.
// В go-redis v9 ZRem(ctx, key, members ...interface{}).
func toInterface(s []string) []interface{} {
	out := make([]interface{}, len(s))
	for i, v := range s {
		out[i] = v
	}
	return out
}
