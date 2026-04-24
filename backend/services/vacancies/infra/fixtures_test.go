package infra

import (
	"context"
	"io"
	"log/slog"
	"sync"
	"time"
)

// testLog returns an explicit discard logger for unit tests. Constructors
// panic on nil log (anti-fallback policy).
func testLog() *slog.Logger {
	return slog.New(slog.NewTextHandler(io.Discard, nil))
}

// memKV is an in-memory KV mimicking Redis for the extractor tests. Only
// Get/Set/Del are exercised — the extractor never INCRs.
type memKV struct {
	mu    sync.Mutex
	store map[string]memEntry
}

type memEntry struct {
	val       []byte
	expiresAt time.Time
}

func newMemKV() *memKV { return &memKV{store: map[string]memEntry{}} }

func (m *memKV) Get(_ context.Context, k string) (string, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	e, ok := m.store[k]
	if !ok {
		return "", ErrCacheMiss
	}
	if !e.expiresAt.IsZero() && time.Now().After(e.expiresAt) {
		delete(m.store, k)
		return "", ErrCacheMiss
	}
	return string(e.val), nil
}

func (m *memKV) Set(_ context.Context, k string, v []byte, ttl time.Duration) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	e := memEntry{val: append([]byte(nil), v...)}
	if ttl > 0 {
		e.expiresAt = time.Now().Add(ttl)
	}
	m.store[k] = e
	return nil
}

func (m *memKV) Del(_ context.Context, keys ...string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, k := range keys {
		delete(m.store, k)
	}
	return nil
}
