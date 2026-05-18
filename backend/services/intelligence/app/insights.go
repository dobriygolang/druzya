// insights.go — atomic-card generator + reader use cases.
//
// The brain produces a stream of Insight
// rows; web/Hone/arena/codex surfaces are thin readers over that
// stream. DailyBrief is still synthesised separately for the weekly
// recap surface, but the day-in-day UX runs on insights now.
//
// GenerateInsights is the write side. It takes the same prompt-input
// snapshot the DailyBrief synthesiser uses, walks deterministic rules,
// and Upserts one Insight per detected anchor. Anchors are stable
// across days, so the same "Yandex interview Friday" doesn't
// duplicate; existing dismissed_at survives the upsert.
//
// ListInsights is the read side. Surface filter + severity-then-recency
// ordering happens in the repo SQL.
package app

import (
	"context"
	"fmt"
	"strings"
	"time"

	"druz9/intelligence/domain"

	"github.com/google/uuid"
)

// GenerateInsights — periodic + on-demand generator. Idempotent for
// the same (user, snapshot) input via Upsert anchor uniqueness.
type GenerateInsights struct {
	Repo domain.InsightRepo
	Now  func() time.Time
	// CacheInvalidator — optional. Drop user's cached ListInsights
	// after Upsert так чтобы next read увидел новые insights без
	// ожидания TTL expire. nil-safe.
	CacheInvalidator *insightsCacheInvalidator
}

// GenerateInsightsInput.
type GenerateInsightsInput struct {
	UserID uuid.UUID
	// Snapshot — what the coach sees right now. Reuses the same
	// envelope the DailyBrief synthesiser consumes so generators
	// don't re-fetch readers.
	Snapshot domain.BriefPromptInput
}

// GenerateInsightsResult.
type GenerateInsightsResult struct {
	Upserted int
	Surfaces map[domain.InsightSurface]int // counts per surface
}

// Do walks the snapshot and produces 0..N insights. Pure orchestration:
// every shape decision lives in the small produce* helpers, easy to
// unit-test in isolation.
func (uc *GenerateInsights) Do(ctx context.Context, in GenerateInsightsInput) (GenerateInsightsResult, error) {
	now := uc.now().UTC()
	candidates := make([]domain.Insight, 0, 8)
	candidates = append(candidates, produceLongAbsenceInsight(in, now)...)
	candidates = append(candidates, produceMockTopicInsight(in, now)...)
	candidates = append(candidates, produceWeakSkillInsight(in, now)...)

	res := GenerateInsightsResult{Surfaces: map[domain.InsightSurface]int{}}
	for _, c := range candidates {
		c.UserID = in.UserID
		if c.Surface == "" {
			c.Surface = domain.InsightSurfaceToday
		}
		if !c.Severity.IsValid() {
			c.Severity = domain.InsightSeverityNudge
		}
		if c.Anchor == "" {
			continue
		}
		c.GeneratedAt = now
		if c.ExpiresAt.IsZero() {
			c.ExpiresAt = now.Add(24 * time.Hour)
		}
		if _, err := uc.Repo.Upsert(ctx, c); err != nil {
			return res, fmt.Errorf("intelligence.GenerateInsights: upsert %q: %w", c.Anchor, err)
		}
		res.Upserted++
		res.Surfaces[c.Surface]++
	}
	// R4 perf: drop user's cached lists после успешного upsert'а так
	// чтобы next ListInsights увидел свежие rows без ожидания TTL.
	if uc.CacheInvalidator != nil && res.Upserted > 0 {
		uc.CacheInvalidator.ForUser(ctx, in.UserID)
	}
	return res, nil
}

func (uc *GenerateInsights) now() time.Time {
	if uc.Now != nil {
		return uc.Now()
	}
	return time.Now()
}

// InsightsListCache — narrow interface для read-through TTL cache.
// Inject'ится в ListInsights через intelligence wiring; nil-safe
// (cache miss = direct DB).
//
// Не импортируем shared/pkg/rediscache напрямую — caller (bootstrap)
// заворачивает concrete *rediscache.Cache[[]Insight] в этот interface.
//
// Backed by Redis. Cross-instance consistency: invalidate в одной
// replica виден всем. Pattern-
// delete `insights:{uid}:*` для per-user invalidation.
type InsightsListCache interface {
	Get(ctx context.Context, key string) ([]domain.Insight, bool)
	Set(ctx context.Context, key string, v []domain.Insight)
	Delete(ctx context.Context, key string)
	// DeleteForUser удаляет все cached entries (любые surface/limit) для
	// userID. Реализация — pattern-delete `insights:{uid}:*`.
	DeleteForUser(ctx context.Context, userID uuid.UUID)
}

// ListInsights — surface-scoped feed. Thin wrapper.
type ListInsights struct {
	Repo domain.InsightRepo
	// Cache — optional in-memory TTL cache. Hot endpoint hit'ится
	// часто (today-feed polling каждые ~30s). nil-safe.
	Cache InsightsListCache
}

// ListInsightsInput.
type ListInsightsInput struct {
	UserID  uuid.UUID
	Surface domain.InsightSurface
	Limit   int
	Offset  int
}

// ListInsightsOutput — rows + total live count under the same predicate.
type ListInsightsOutput struct {
	Items []domain.Insight
	Total int
}

// Do executes the use case.
//
// Severity-ranked feed → offset+limit pagination is correct (cursor-by-key
// would break under tie-breaks in the CASE-derived sort key). Cache only
// the first page (offset=0) — deeper pages are rare and expire quickly.
func (uc *ListInsights) Do(ctx context.Context, in ListInsightsInput) (ListInsightsOutput, error) {
	if in.Offset == 0 {
		cacheKey := insightsCacheKey(in.UserID, in.Surface, in.Limit)
		if uc.Cache != nil {
			if cached, ok := uc.Cache.Get(ctx, cacheKey); ok {
				// Cache stores items only; recompute total only on
				// cache miss. For first-page UI «N of M» stays stable
				// for the cache TTL window.
				return ListInsightsOutput{Items: cached, Total: len(cached)}, nil
			}
		}
		rows, total, err := uc.Repo.ListLiveBySurfacePaged(ctx, in.UserID, in.Surface, 0, in.Limit)
		if err != nil {
			return ListInsightsOutput{}, fmt.Errorf("intelligence.ListInsights: %w", err)
		}
		if uc.Cache != nil {
			uc.Cache.Set(ctx, cacheKey, rows)
		}
		return ListInsightsOutput{Items: rows, Total: total}, nil
	}
	rows, total, err := uc.Repo.ListLiveBySurfacePaged(ctx, in.UserID, in.Surface, in.Offset, in.Limit)
	if err != nil {
		return ListInsightsOutput{}, fmt.Errorf("intelligence.ListInsights: %w", err)
	}
	return ListInsightsOutput{Items: rows, Total: total}, nil
}

// insightsCacheKey builds the lookup key. Surface + limit included
// because they shape the query — отдельные surfaces (today/arena/
// mock/codex) live as отдельные cache lines.
func insightsCacheKey(userID uuid.UUID, surface domain.InsightSurface, limit int) string {
	return fmt.Sprintf("insights:%s:%s:%d", userID.String(), string(surface), limit)
}

// insightsCacheInvalidator — caller (Generate / Ack) уведомляет
// что user'ские insights могли поменяться.
//
// Redis-backed cache supports pattern-delete (`insights:{uid}:*`),
// так что не нужно перебирать все surface×limit комбинации — один SCAN+DEL.
// Fallback на per-key Delete остаётся работающим для in-memory backends.
type insightsCacheInvalidator struct {
	cache InsightsListCache
}

// NewInsightsCacheInvalidator builds a small helper that drops all
// surface variants for a user. Used by GenerateInsights/AckInsight.
func NewInsightsCacheInvalidator(c InsightsListCache) *insightsCacheInvalidator {
	if c == nil {
		return nil
	}
	return &insightsCacheInvalidator{cache: c}
}

// ForUser drops every cached (surface, limit) tuple для userID.
// Implementation использует cache.DeleteForUser — для Redis это
// SCAN+DEL по pattern'у, не O(surfaces×limits) round-trips.
func (inv *insightsCacheInvalidator) ForUser(ctx context.Context, userID uuid.UUID) {
	if inv == nil || inv.cache == nil {
		return
	}
	inv.cache.DeleteForUser(ctx, userID)
}

// AckInsight — user-feedback tap.
type AckInsight struct {
	Repo domain.InsightRepo
	// CacheInvalidator — optional. Drop user's cached ListInsights
	// after follow/dismiss так чтобы next read увидел корректное
	// состояние карточки. nil-safe.
	CacheInvalidator *insightsCacheInvalidator
}

// AckInsightInput. Action 'follow' marks acted_at; 'dismiss' marks
// dismissed_at. Anything else is rejected.
type AckInsightInput struct {
	UserID    uuid.UUID
	InsightID uuid.UUID
	Action    string // 'follow' | 'dismiss'
}

// Do executes the use case.
func (uc *AckInsight) Do(ctx context.Context, in AckInsightInput) error {
	switch in.Action {
	case "follow":
		if err := uc.Repo.MarkActed(ctx, in.UserID, in.InsightID); err != nil {
			return fmt.Errorf("intelligence.AckInsight.follow: %w", err)
		}
	case "dismiss":
		if err := uc.Repo.MarkDismissed(ctx, in.UserID, in.InsightID); err != nil {
			return fmt.Errorf("intelligence.AckInsight.dismiss: %w", err)
		}
	default:
		return fmt.Errorf("intelligence.AckInsight: invalid action %q", in.Action)
	}
	if uc.CacheInvalidator != nil {
		uc.CacheInvalidator.ForUser(ctx, in.UserID)
	}
	return nil
}

// ── deterministic producers ────────────────────────────────────────────
//
// One per "kind of pattern". Each returns ≤2 insights so a noisy day
// can't flood the feed; ranking happens at the read side via severity.

func produceLongAbsenceInsight(in GenerateInsightsInputSnapshot, now time.Time) []domain.Insight {
	days := daysSinceLastTouchSnapshot(in.Snapshot)
	if days < 14 {
		return nil
	}
	return []domain.Insight{{
		Surface:   domain.InsightSurfaceToday,
		Severity:  domain.InsightSeverityCruise,
		Anchor:    "absence:welcome_back",
		Headline:  fmt.Sprintf("Welcome back — %d days off.", days),
		Evidence:  fmt.Sprintf("Last activity %d days ago. Old mock scores and arena losses are stale.", days),
		Interpret: "Re-entry beats catch-up. One small concrete win matters more today than a perfect plan.",
		Lever:     "Do today's daily kata. That's it.",
		DeepLink:  "/arena/kata",
		ExpiresAt: now.Add(72 * time.Hour),
	}}
}

func produceMockTopicInsight(in GenerateInsightsInputSnapshot, now time.Time) []domain.Insight {
	if len(in.Snapshot.Mocks) == 0 {
		return nil
	}
	// Find the most-repeated weak topic across recent mocks.
	counts := map[string]int{}
	for _, m := range in.Snapshot.Mocks {
		for _, t := range m.WeakTopics {
			topic := strings.TrimSpace(strings.ToLower(t))
			if topic == "" {
				continue
			}
			counts[topic]++
		}
	}
	if len(counts) == 0 {
		return nil
	}
	var topTopic string
	topCount := 0
	for t, c := range counts {
		if c > topCount {
			topTopic = t
			topCount = c
		}
	}
	if topCount < 2 {
		return nil
	}
	sev := domain.InsightSeverityNudge
	if topCount >= 3 {
		sev = domain.InsightSeverityWarn
	}
	return []domain.Insight{{
		Surface:   domain.InsightSurfaceToday,
		Severity:  sev,
		Anchor:    "skill:" + topTopic,
		SkillKey:  topTopic,
		Headline:  fmt.Sprintf("%s — flagged in %d mocks.", topTopic, topCount),
		Evidence:  fmt.Sprintf("%s appeared as a weak_topic in %d recent mock report(s).", topTopic, topCount),
		Interpret: "Repeats across separate sessions — pattern, not one-off.",
		Lever:     fmt.Sprintf("One 25-min %s drill before any other work today.", topTopic),
		DeepLink:  "/mock",
		ExpiresAt: now.Add(48 * time.Hour),
	}}
}

func produceWeakSkillInsight(in GenerateInsightsInputSnapshot, now time.Time) []domain.Insight {
	if len(in.Snapshot.WeakSkills) == 0 {
		return nil
	}
	w := in.Snapshot.WeakSkills[0]
	if w.Progress > 30 {
		return nil
	}
	return []domain.Insight{{
		Surface:   domain.InsightSurfaceToday,
		Severity:  domain.InsightSeverityNudge,
		Anchor:    "skill:" + w.SkillKey,
		SkillKey:  w.SkillKey,
		Headline:  fmt.Sprintf("%s at %d/100 — Atlas low.", w.Title, w.Progress),
		Evidence:  fmt.Sprintf("%s sits at %d/100 in your Skill Atlas.", w.Title, w.Progress),
		Interpret: "Single drill won't fix it; weekly cadence will.",
		Lever:     fmt.Sprintf("Start a %s track in Atlas — pick the smallest first step.", w.Title),
		DeepLink:  "/atlas",
		ExpiresAt: now.Add(72 * time.Hour),
	}}
}

// GenerateInsightsInputSnapshot — thin alias keeping producer
// signatures readable. Both fields are read-only inside producers.
type GenerateInsightsInputSnapshot = GenerateInsightsInput

// daysSinceLastTouchSnapshot mirrors daily_brief_diagnosis.daysSinceLastTouch
// without importing infra (which would cause an inverse dep). The two
// implementations stay in sync via a unit test in app/insights_test.go.
func daysSinceLastTouchSnapshot(in domain.BriefPromptInput) int {
	var newest time.Time
	bump := func(t time.Time) {
		if t.IsZero() {
			return
		}
		if newest.IsZero() || t.After(newest) {
			newest = t
		}
	}
	for _, d := range in.FocusDays {
		if d.Seconds > 0 {
			bump(d.Day)
		}
	}
	for _, m := range in.Mocks {
		bump(m.FinishedAt)
	}
	for _, c := range in.CompletedRecent {
		bump(c.PlanDate)
	}
	for _, s := range in.SkippedRecent {
		bump(s.PlanDate)
	}
	for _, r := range in.Reflections {
		bump(r.CreatedAt)
	}
	for _, n := range in.DailyNotes {
		bump(n.Day)
	}
	for _, n := range in.RecentNotes {
		bump(n.UpdatedAt)
	}
	if newest.IsZero() {
		return -1
	}
	today := in.Today.UTC().Truncate(24 * time.Hour)
	gap := today.Sub(newest.UTC().Truncate(24 * time.Hour))
	d := int(gap.Hours() / 24)
	if d < 0 {
		return 0
	}
	return d
}
