// Package app — PolicyResolver: admin-overridable quota policies via
// dynamic_config. Admin UI редактирует rows `quota_policy.<tier>` со
// значениями вроде `{"synced_notes": 15, "active_shared_boards": 2, ...}`.
// Resolver кэширует и refresh'ает per request (TTL 5min).
//
// Fallback: если row missing / parse error → hardcoded `domain.PolicyDefaults`.
// Это intentional — мы хотим чтобы админ мог опечататься в JSON'е и не
// положить продакшн (всё ещё будут работать defaults).

package app

import (
	"context"
	"encoding/json"
	"fmt"
	"sync"
	"time"

	"druz9/subscription/domain"
)

// ConfigReader — port-interface для чтения admin-editable конфига. Реализуется
// в monolith через admin-domain config_repo (raw cross-domain SQL OK).
type ConfigReader interface {
	GetConfig(ctx context.Context, key string) (string, error) // raw JSON value
}

// PolicyResolver — кэширующий wrapper. Cache miss / TTL expired → SELECT
// из dynamic_config + parse JSON. Concurrent-safe.
type PolicyResolver struct {
	cfg     ConfigReader
	cacheMu sync.RWMutex
	cache   map[domain.Tier]cachedPolicy
	ttl     time.Duration
	now     func() time.Time
}

type cachedPolicy struct {
	policy domain.QuotaPolicy
	at     time.Time
}

// NewPolicyResolver — конструктор. Если cfg == nil → resolver возвращает
// только defaults (no DB calls). Пригодно для tests / standalone services.
func NewPolicyResolver(cfg ConfigReader) *PolicyResolver {
	return &PolicyResolver{
		cfg:   cfg,
		cache: make(map[domain.Tier]cachedPolicy),
		ttl:   5 * time.Minute,
		now:   time.Now,
	}
}

// Get — главный API. Не возвращает ошибки — даже при DB failure отдаёт
// defaults. Резолвер должен быть устойчив к admin-misconfiguration.
func (r *PolicyResolver) Get(ctx context.Context, tier domain.Tier) domain.QuotaPolicy {
	if r.cfg == nil {
		return domain.PolicyDefaults(tier)
	}
	r.cacheMu.RLock()
	if c, ok := r.cache[tier]; ok && r.now().Sub(c.at) < r.ttl {
		r.cacheMu.RUnlock()
		return c.policy
	}
	r.cacheMu.RUnlock()

	// Slow path: SELECT + parse + populate cache.
	policy := r.resolve(ctx, tier)
	r.cacheMu.Lock()
	r.cache[tier] = cachedPolicy{policy: policy, at: r.now()}
	r.cacheMu.Unlock()
	return policy
}

// Invalidate — clear cache для tier'а. Вызвать после admin-update'а
// dynamic_config'а (чтобы изменение поднялось без рестарта).
func (r *PolicyResolver) Invalidate(tier domain.Tier) {
	r.cacheMu.Lock()
	delete(r.cache, tier)
	r.cacheMu.Unlock()
}

// InvalidateAll — clear cache for all tiers. Use sparingly.
func (r *PolicyResolver) InvalidateAll() {
	r.cacheMu.Lock()
	r.cache = make(map[domain.Tier]cachedPolicy)
	r.cacheMu.Unlock()
}

// resolve — fetch + parse without cache write (caller writes).
func (r *PolicyResolver) resolve(ctx context.Context, tier domain.Tier) domain.QuotaPolicy {
	defaults := domain.PolicyDefaults(tier)
	key := configKey(tier)
	raw, err := r.cfg.GetConfig(ctx, key)
	if err != nil || raw == "" {
		return defaults
	}
	var override quotaPolicyJSON
	if err := json.Unmarshal([]byte(raw), &override); err != nil {
		return defaults
	}
	// Merge: missing/zero fields → use default. JSON.Unmarshal даёт zero
	// для пропущенных полей; мы трактуем 0 как "use default" (никакая квота
	// не должна быть 0 — это бы означало feature полностью disabled).
	// Чтобы выставить 0 — admin указывает Unlimited (-1) и frontend
	// конвертит в "infinite", или используется hardcoded default.
	out := defaults
	if override.SyncedNotes != 0 {
		out.SyncedNotes = override.SyncedNotes
	}
	if override.ActiveSharedBoards != 0 {
		out.ActiveSharedBoards = override.ActiveSharedBoards
	}
	if override.ActiveSharedRooms != 0 {
		out.ActiveSharedRooms = override.ActiveSharedRooms
	}
	if override.SharedTTLSeconds != 0 {
		out.SharedTTL = time.Duration(override.SharedTTLSeconds) * time.Second
	}
	if override.AIMonthly != 0 {
		out.AIMonthly = override.AIMonthly
	}
	return out
}

func configKey(tier domain.Tier) string {
	return fmt.Sprintf("quota_policy.%s", string(tier))
}

type quotaPolicyJSON struct {
	SyncedNotes        int   `json:"synced_notes"`
	ActiveSharedBoards int   `json:"active_shared_boards"`
	ActiveSharedRooms  int   `json:"active_shared_rooms"`
	SharedTTLSeconds   int64 `json:"shared_ttl_seconds"`
	AIMonthly          int   `json:"ai_monthly"`
}
