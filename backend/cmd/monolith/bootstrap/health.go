// Liveness + readiness HTTP handlers.
//
// /health is a flat liveness check (process is up). /health/ready pings
// Postgres and Redis with a 2s deadline so downstream rotations can
// distinguish "process exists" from "process can serve traffic".
package bootstrap

import (
	"context"
	"encoding/json"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
)

func handleHealth(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	_, _ = w.Write([]byte(`{"status":"ok","checks":{}}`))
}

func readyHandler(pool *pgxpool.Pool, rdb *redis.Client) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
		defer cancel()
		checks := map[string]map[string]any{}
		status := "ok"
		t0 := time.Now()
		if err := pool.Ping(ctx); err != nil {
			status = "unavailable"
			checks["postgres"] = map[string]any{"status": "fail", "error": err.Error()}
		} else {
			checks["postgres"] = map[string]any{"status": "ok", "latency_ms": time.Since(t0).Milliseconds()}
		}
		t0 = time.Now()
		if err := rdb.Ping(ctx).Err(); err != nil {
			status = "unavailable"
			checks["redis"] = map[string]any{"status": "fail", "error": err.Error()}
		} else {
			checks["redis"] = map[string]any{"status": "ok", "latency_ms": time.Since(t0).Milliseconds()}
		}
		w.Header().Set("Content-Type", "application/json")
		if status != "ok" {
			w.WriteHeader(http.StatusServiceUnavailable)
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"status": status, "checks": checks})
	}
}
