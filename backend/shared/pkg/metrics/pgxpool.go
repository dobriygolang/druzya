// pgxpool.go — periodic sampler that converts pgxpool.Stat() into the
// gauge set declared in metrics.go.
//
// pgx itself does not expose a Prometheus collector, so we poll on a
// ticker (cheap: Stat() just reads atomics) and update the gauges. Call
// RegisterPgxPoolCollector once at bootstrap per pool.
package metrics

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// RegisterPgxPoolCollector starts a goroutine that, every `interval`,
// samples pool.Stat() and copies the numbers into the druz9_pgxpool_*
// gauges. The goroutine exits when ctx is done.
//
// interval=15s is a safe default — matches Prometheus default scrape and
// keeps Stat() overhead negligible. Pass 0 to use the default.
func RegisterPgxPoolCollector(ctx context.Context, pool *pgxpool.Pool, interval time.Duration) {
	if interval <= 0 {
		interval = 15 * time.Second
	}

	// Write once synchronously so Prometheus sees non-zero on first scrape.
	sample(pool)

	go func() {
		t := time.NewTicker(interval)
		defer t.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-t.C:
				sample(pool)
			}
		}
	}()
}

func sample(pool *pgxpool.Pool) {
	s := pool.Stat()
	PgxPoolAcquiredConns.Set(float64(s.AcquiredConns()))
	PgxPoolIdleConns.Set(float64(s.IdleConns()))
	PgxPoolTotalConns.Set(float64(s.TotalConns()))
	PgxPoolMaxConns.Set(float64(s.MaxConns()))
	PgxPoolAcquireWaitSeconds.Set(s.AcquireDuration().Seconds())
	PgxPoolCanceledAcquires.Set(float64(s.CanceledAcquireCount()))
}
