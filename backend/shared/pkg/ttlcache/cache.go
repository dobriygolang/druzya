// Package ttlcache — простой thread-safe in-memory cache с TTL.
//
// Цель: lightweight wrap для hot-endpoint reader'ов которые получают
// burst идентичных вопросов от того же юзера (refresh tab, polling,
// double-click). Не replacement для Redis, не persisted — просто
// первая линия обороны до базы.
//
// Когда использовать:
//   - read-mostly endpoint, типичная нагрузка: тот же ключ за < TTL
//   - данные admin-tolerant к stale на TTL window (insights, tasks lists)
//   - want zero infra-deps (не Redis-wrap'нуть в shared слое — circular)
//
// Когда НЕ:
//   - данные критически-fresh (paywall, subscription state)
//   - cross-instance consistency требуется (выберите Redis)
//   - high-cardinality (миллион ключей: тут лучше LRU с bound'ом)
//
// TODO(perf): swap to Redis-backed cache когда shared client wired в
// hone/intelligence-domain через clean interface (требует больше DI
// работы; in-memory достаточно для single-monolith deploy'а).
package ttlcache

import (
	"sync"
	"time"
)

// Cache[T] хранит entries с absolute expiration time. Не использует
// reflection — generic'и (Go 1.18+).
type Cache[T any] struct {
	mu      sync.RWMutex
	items   map[string]entry[T]
	ttl     time.Duration
	maxSize int // soft cap (purge when exceeded)
}

type entry[T any] struct {
	val     T
	expires time.Time
}

// New создаёт cache. ttl > 0 обязателен (0 → no caching, всё miss).
// maxSize — soft upper bound; при превышении purge'ает expired+oldest.
// 0 → 1024 default.
func New[T any](ttl time.Duration, maxSize int) *Cache[T] {
	if maxSize <= 0 {
		maxSize = 1024
	}
	return &Cache[T]{
		items:   make(map[string]entry[T], 64),
		ttl:     ttl,
		maxSize: maxSize,
	}
}

// Get returns cached value + true если есть И не expired.
func (c *Cache[T]) Get(key string) (T, bool) {
	var zero T
	if c == nil || c.ttl <= 0 {
		return zero, false
	}
	c.mu.RLock()
	e, ok := c.items[key]
	c.mu.RUnlock()
	if !ok {
		return zero, false
	}
	if time.Now().After(e.expires) {
		// expired — clean opportunistically
		c.mu.Lock()
		delete(c.items, key)
		c.mu.Unlock()
		return zero, false
	}
	return e.val, true
}

// Set записывает value под key с default TTL. Triggers purge если
// items > maxSize.
func (c *Cache[T]) Set(key string, val T) {
	if c == nil || c.ttl <= 0 {
		return
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	c.items[key] = entry[T]{val: val, expires: time.Now().Add(c.ttl)}
	if len(c.items) > c.maxSize {
		c.purgeLocked()
	}
}

// Delete удаляет один key. Идемпотентен.
func (c *Cache[T]) Delete(key string) {
	if c == nil {
		return
	}
	c.mu.Lock()
	delete(c.items, key)
	c.mu.Unlock()
}

// purgeLocked удаляет expired entries; если ничего не expired удаляет
// один random (Go map iteration order). Caller должен holdать write lock.
func (c *Cache[T]) purgeLocked() {
	now := time.Now()
	beforeLen := len(c.items)
	for k, e := range c.items {
		if now.After(e.expires) {
			delete(c.items, k)
		}
	}
	if len(c.items) == beforeLen {
		// Nothing expired — drop one random (cheap eviction).
		for k := range c.items {
			delete(c.items, k)
			break
		}
	}
}

// Len возвращает текущее число items (для метрик / тестов).
func (c *Cache[T]) Len() int {
	if c == nil {
		return 0
	}
	c.mu.RLock()
	defer c.mu.RUnlock()
	return len(c.items)
}
