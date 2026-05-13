package userlocale

import (
	"context"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// PostgresReader reads users.locale with a short in-memory TTL cache. The
// hot path is LLM-adjacent (Suggest, Analyze, daily_brief), so a single SQL
// roundtrip every ~5 minutes per user is the right trade. Cache is
// process-local — fan-out is acceptable because the value is small and
// rarely changes.
type PostgresReader struct {
	pool *pgxpool.Pool
	ttl  time.Duration

	mu    sync.RWMutex
	cache map[uuid.UUID]cacheEntry
}

type cacheEntry struct {
	value     string
	expiresAt time.Time
}

const defaultTTL = 5 * time.Minute

// NewPostgresReader builds a Reader backed by the shared pgx pool. A nil pool
// returns a Reader that always answers "ru" — useful for tests and dev paths
// where the DB isn't wired yet.
func NewPostgresReader(pool *pgxpool.Pool) *PostgresReader {
	return &PostgresReader{
		pool:  pool,
		ttl:   defaultTTL,
		cache: make(map[uuid.UUID]cacheEntry),
	}
}

const getLocaleQuery = `SELECT locale FROM users WHERE id = $1`

// Get returns the cached or freshly-loaded locale. Defaults to "ru" on any
// error (no rows, DB down, pool nil). Never returns an error to keep the
// callsite simple.
func (r *PostgresReader) Get(ctx context.Context, userID uuid.UUID) string {
	if r == nil || r.pool == nil {
		return "ru"
	}
	if v, ok := r.lookup(userID); ok {
		return v
	}

	var locale string
	err := r.pool.QueryRow(ctx, getLocaleQuery, userID).Scan(&locale)
	if err != nil {
		if err == pgx.ErrNoRows {
			r.store(userID, "ru")
		}
		return "ru"
	}
	locale = Normalize(locale)
	r.store(userID, locale)
	return locale
}

// Invalidate drops the cached locale for a user. Call after Settings RPC
// updates users.locale so the next LLM call sees the new value immediately.
func (r *PostgresReader) Invalidate(userID uuid.UUID) {
	if r == nil {
		return
	}
	r.mu.Lock()
	delete(r.cache, userID)
	r.mu.Unlock()
}

func (r *PostgresReader) lookup(userID uuid.UUID) (string, bool) {
	r.mu.RLock()
	entry, ok := r.cache[userID]
	r.mu.RUnlock()
	if !ok || time.Now().After(entry.expiresAt) {
		return "", false
	}
	return entry.value, true
}

func (r *PostgresReader) store(userID uuid.UUID, locale string) {
	r.mu.Lock()
	r.cache[userID] = cacheEntry{value: locale, expiresAt: time.Now().Add(r.ttl)}
	r.mu.Unlock()
}

// StaticReader is a test/dev double that always returns the given locale.
type StaticReader string

// Get implements Reader.
func (s StaticReader) Get(_ context.Context, _ uuid.UUID) string {
	if s == "en" {
		return "en"
	}
	return "ru"
}

var (
	_ Reader = (*PostgresReader)(nil)
	_ Reader = StaticReader("ru")
)
