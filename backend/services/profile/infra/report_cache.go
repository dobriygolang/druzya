// Package infra: report_cache.go держит read-through Redis-кеш для
// /profile/me/report. Отдельный wrapper вокруг GetReport use-case (а не
// внутри CachedRepo), потому что:
//
//   - инвалидация триггерится не write-path профиля, а событиями matchEnded /
//     XPGained — их подписчик дёрнет Invalidate(uid).
//   - TTL агрессивнее, чем у профиля (5 мин ≈ окно «реальности» отчёта).
//
// Wire устроен так: ReportCache.Get(ctx, uid) либо отдаёт сериализованную
// строку из Redis, либо вызывает loader (use-case) и кладёт результат под
// ключ. Ошибки Redis НИКОГДА не роняют запрос — fallback к upstream.
package infra

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"druz9/profile/app"
	"druz9/shared/pkg/metrics"

	"github.com/google/uuid"
	"golang.org/x/sync/singleflight"
)

// DefaultReportCacheTTL — 5-минутное окно. Короче чем у профиля (60s) —
// отчёт собирает несколько SQL-агрегатов, кэш окупается, но обновлять надо
// чаще, чем раз в час.
const DefaultReportCacheTTL = 5 * time.Minute

// ReportLoader — функция, которая поднимает свежий отчёт; обычно это
// `(*GetReport).Do`.
type ReportLoader func(ctx context.Context, userID uuid.UUID, now time.Time) (app.ReportView, error)

// ReportCache wrap'ит ReportLoader Redis-кешем.
type ReportCache struct {
	kv     KV
	ttl    time.Duration
	log    *slog.Logger
	loader ReportLoader
	sf     singleflight.Group
	now    func() time.Time // overridable in tests
}

// NewReportCache constructs a ReportCache around the given loader and KV.
// log is required (anti-fallback policy). ttl<=0 → DefaultReportCacheTTL.
func NewReportCache(loader ReportLoader, kv KV, ttl time.Duration, log *slog.Logger) *ReportCache {
	if ttl <= 0 {
		ttl = DefaultReportCacheTTL
	}
	if log == nil {
		panic("profile.infra.NewReportCache: logger is required (anti-fallback policy: no silent noop loggers)")
	}
	return &ReportCache{
		kv:     kv,
		ttl:    ttl,
		log:    log,
		loader: loader,
		now:    func() time.Time { return time.Now().UTC() },
	}
}

// reportKey returns the per-user cache key. Versioned so a struct-shape
// change can be rolled out by bumping the prefix.
func reportKey(uid uuid.UUID) string {
	return fmt.Sprintf("profile:%s:report:%s", CacheKeyVersion, uid.String())
}

// Get reads the cached report or loads it on miss.
func (r *ReportCache) Get(ctx context.Context, userID uuid.UUID) (app.ReportView, error) {
	key := reportKey(userID)
	if raw, err := r.kv.Get(ctx, key); err == nil {
		var v app.ReportView
		if jerr := json.Unmarshal([]byte(raw), &v); jerr == nil {
			return v, nil
		}
		r.log.Warn("profile.report_cache: corrupt entry, refreshing",
			slog.String("key", key))
	} else if !errors.Is(err, ErrCacheMiss) {
		// Anti-fallback: real Redis failure propagates.
		return app.ReportView{}, fmt.Errorf("profile.report_cache.Get: redis: %w", err)
	}
	v, err, _ := r.sf.Do(key, func() (any, error) {
		return r.loader(ctx, userID, r.now())
	})
	if err != nil {
		return app.ReportView{}, fmt.Errorf("profile.report_cache.Get: %w", err)
	}
	view, ok := v.(app.ReportView)
	if !ok {
		return app.ReportView{}, fmt.Errorf("profile.report_cache: singleflight returned %T", v)
	}
	if data, jerr := json.Marshal(view); jerr == nil {
		if serr := r.kv.Set(ctx, key, data, r.ttl); serr != nil {
			metrics.CacheSetErrorsTotal.WithLabelValues("profile_report").Inc()
			r.log.Warn("profile.report_cache: redis Set failed",
				slog.String("key", key), slog.Any("err", serr))
		}
	}
	return view, nil
}

// Invalidate deletes the cached report for userID. Safe no-op when no entry.
func (r *ReportCache) Invalidate(ctx context.Context, userID uuid.UUID) {
	if err := r.kv.Del(ctx, reportKey(userID)); err != nil {
		r.log.Warn("profile.report_cache: redis Del failed",
			slog.Any("user_id", userID), slog.Any("err", err))
	}
}
