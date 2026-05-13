// insights_cache_adapter.go — Redis-backed adapter для intelApp.InsightsListCache.
//
// Cross-instance consistency via shared/pkg/rediscache
// — invalidate в одной replica виден всем подписчикам. Pattern delete
// `insights:{uid}:*` для per-user invalidation одним SCAN+DEL.
package intelligence

import (
	"context"
	"fmt"

	intelApp "druz9/intelligence/app"
	intelDomain "druz9/intelligence/domain"
	"druz9/shared/pkg/rediscache"

	"github.com/google/uuid"
)

// insightsRedisCacheAdapter satisfies intelApp.InsightsListCache backed by
// shared/pkg/rediscache. Adapter живёт в monolith wiring чтобы app слой
// не импортировал shared/pkg напрямую (clean arch boundary).
type insightsRedisCacheAdapter struct {
	c *rediscache.Cache[[]intelDomain.Insight]
}

// NewInsightsRedisCache wraps a generic rediscache for ListInsights consumers.
// nil-in → nil-out (сохраняем nil-safety контракт).
func NewInsightsRedisCache(c *rediscache.Cache[[]intelDomain.Insight]) intelApp.InsightsListCache {
	if c == nil {
		return nil
	}
	return &insightsRedisCacheAdapter{c: c}
}

func (a *insightsRedisCacheAdapter) Get(ctx context.Context, key string) ([]intelDomain.Insight, bool) {
	return a.c.Get(ctx, key)
}

func (a *insightsRedisCacheAdapter) Set(ctx context.Context, key string, v []intelDomain.Insight) {
	// Fail-soft: errors logged at the rediscache layer (metrics counter), не
	// возвращаем выше — ListInsights уже отдал caller'у данные.
	_ = a.c.Set(ctx, key, v)
}

func (a *insightsRedisCacheAdapter) Delete(ctx context.Context, key string) {
	_ = a.c.Delete(ctx, key)
}

// DeleteForUser — pattern-delete `insights:{uid}:*` (SCAN+DEL). Удаляет
// все surface×limit комбинации одним проходом, не O(N) round-trips.
func (a *insightsRedisCacheAdapter) DeleteForUser(ctx context.Context, userID uuid.UUID) {
	pattern := fmt.Sprintf("insights:%s:*", userID.String())
	_ = a.c.DeletePattern(ctx, pattern)
}
