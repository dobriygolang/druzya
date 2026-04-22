// Postgres pool, Redis client and other shared infrastructure handles.
//
// Each constructor here is intentionally dumb — it produces a primitive,
// returns it, and lets callers decide ownership. Cleanup is registered by
// the App (see bootstrap.go) so init failures still close anything that
// got created beforehand.
package bootstrap

import (
	"context"
	"time"

	"druz9/shared/pkg/config"
	dotel "druz9/shared/pkg/otel"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
)

func newPostgres(ctx context.Context, dsn string) (*pgxpool.Pool, error) {
	return dotel.NewTracedPool(ctx, dsn)
}

func newRedis(cfg *config.Config) *redis.Client {
	return redis.NewClient(&redis.Options{
		Addr:     cfg.RedisAddr,
		Password: cfg.RedisPass,
	})
}

// nowFunc is the single source of "current time" handed to every domain so
// tests can swap it in one place.
func nowFunc() func() time.Time { return func() time.Time { return time.Now() } }
