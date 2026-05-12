// user_context_adapter.go — C3 (Phase J) cross-product context bridge.
//
// Adapts intelligence.GetUserContext (rich domain types in intel/app)
// to copilot/domain.UserContextProvider (narrow port). Sits in
// cmd/monolith because it's the only place that can legally import
// BOTH intelligence/app AND copilot/domain — bounded contexts don't
// import each other (same pattern as memorySink in this directory).
//
// Caching strategy:
//   - Redis SET with 60s TTL keyed by user_id.
//   - Cache MISS → fetch from intelligence UC, JSON-encode the
//     compact domain shape, SET.
//   - Cache HIT → decode, return. JSON-decode failures fall through to
//     a fresh fetch (treat broken cache as miss, not as error).
//   - All errors fall back to empty bundle — never fail the calling
//     suggestion path. This is critical: Cue suggestion latency budget
//     is ~2-3s on Groq free-tier, and a flapping cache shouldn't add
//     visible failures to the user.
//
// 60s TTL is tuned so:
//   - A user mid-interview gets a stable context across their burst
//     of suggestions (no jitter from per-call DB hits).
//   - A user who just changed goal sees the new goal within a minute
//     (no manual cache-bust needed).
//   - Burst protection: a runaway trigger loop hits cache, not DB.
package copilot

import (
	"context"
	"encoding/json"
	"log/slog"
	"time"

	copilotDomain "druz9/copilot/domain"
	intelApp "druz9/intelligence/app"

	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
)

// userContextAdapter implements copilot/domain.UserContextProvider on
// top of the in-process intelligence UC + Redis cache.
type userContextAdapter struct {
	uc    *intelApp.GetUserContext
	redis *redis.Client
	log   *slog.Logger
	ttl   time.Duration
}

const (
	userContextCacheTTL    = 60 * time.Second
	userContextCachePrefix = "copilot:ucontext:"
)

// newUserContextAdapter wires the adapter. uc may be nil — callers
// already guard via Suggest.UserContext = nil (skip injection). redis
// may be nil — caller falls back to direct UC call without caching.
func newUserContextAdapter(
	uc *intelApp.GetUserContext,
	r *redis.Client,
	log *slog.Logger,
) *userContextAdapter {
	if uc == nil {
		return nil
	}
	return &userContextAdapter{
		uc:    uc,
		redis: r,
		log:   log,
		ttl:   userContextCacheTTL,
	}
}

// LoadUserContext satisfies copilot/domain.UserContextProvider.
func (a *userContextAdapter) LoadUserContext(
	ctx context.Context,
	userID uuid.UUID,
) (copilotDomain.UserContext, error) {
	if a == nil || a.uc == nil {
		return copilotDomain.UserContext{}, nil
	}

	// Cache lookup. nil redis = no cache, straight to UC.
	if a.redis != nil {
		key := userContextCachePrefix + userID.String()
		if raw, err := a.redis.Get(ctx, key).Bytes(); err == nil && len(raw) > 0 {
			var cached cachedUserContext
			if jerr := json.Unmarshal(raw, &cached); jerr == nil {
				return cached.toDomain(), nil
			}
			// Decode failure → treat as miss. Log once at debug.
			if a.log != nil {
				a.log.Debug("copilot.userContextAdapter: cache decode failed — fetching fresh",
					"user", userID.String())
			}
		}
	}

	bundle, err := a.uc.Do(ctx, intelApp.GetUserContextInput{UserID: userID})
	if err != nil {
		// Hard error — log and return empty. Don't propagate; suggestion
		// must not fail because cross-product context hiccupped.
		if a.log != nil {
			a.log.WarnContext(ctx, "copilot.userContextAdapter: intelligence UC failed",
				slog.Any("err", err), slog.String("user", userID.String()))
		}
		return copilotDomain.UserContext{}, nil
	}
	out := intelBundleToCopilot(bundle)

	// Write-through cache. Failures are silent — better to serve fresh
	// from DB on every call than to fail when Redis is degraded.
	if a.redis != nil {
		cached := newCachedUserContext(out)
		if payload, jerr := json.Marshal(cached); jerr == nil {
			if cerr := a.redis.Set(ctx, userContextCachePrefix+userID.String(), payload, a.ttl).Err(); cerr != nil && a.log != nil {
				a.log.DebugContext(ctx, "copilot.userContextAdapter: cache set failed",
					slog.Any("err", cerr))
			}
		}
	}
	return out, nil
}

// cachedUserContext — JSON-safe wire shape for Redis. Mirrors
// copilotDomain.UserContext but uses string timestamps + cleaner field
// names so encoded payloads stay stable across schema additions.
type cachedUserContext struct {
	Goal      *cachedGoal         `json:"goal,omitempty"`
	Memory    []cachedMemoryEntry `json:"memory,omitempty"`
	Activity  cachedActivity      `json:"activity"`
	Radar     cachedRadar         `json:"radar"`
	Resources []cachedResource    `json:"resources,omitempty"`
}

type cachedGoal struct {
	Kind          string `json:"kind"`
	TargetCompany string `json:"target_company,omitempty"`
	TargetLevel   string `json:"target_level,omitempty"`
	TargetText    string `json:"target_text,omitempty"`
	TargetDate    string `json:"target_date,omitempty"`
}

type cachedMemoryEntry struct {
	Kind       string `json:"kind"`
	Summary    string `json:"summary"`
	OccurredAt string `json:"occurred_at"`
	HoursAgo   int    `json:"hours_ago"`
}

type cachedActivity struct {
	Last7d   int      `json:"last_7d"`
	Last30d  int      `json:"last_30d"`
	TopKinds []string `json:"top_kinds,omitempty"`
}

type cachedRadar struct {
	Rubric        string    `json:"rubric,omitempty"`
	Axes          []string  `json:"axes,omitempty"`
	AxisScores    []float64 `json:"axis_scores,omitempty"`
	WeakestAxis   string    `json:"weakest,omitempty"`
	StrongestAxis string    `json:"strongest,omitempty"`
}

type cachedResource struct {
	ID    string `json:"id,omitempty"`
	Title string `json:"title"`
	URL   string `json:"url,omitempty"`
	Kind  string `json:"kind,omitempty"`
}

func newCachedUserContext(c copilotDomain.UserContext) cachedUserContext {
	out := cachedUserContext{
		Activity: cachedActivity{
			Last7d:   c.Activity.Last7dCount,
			Last30d:  c.Activity.Last30dCount,
			TopKinds: c.Activity.TopKinds,
		},
		Radar: cachedRadar{
			Rubric:        c.Radar.Rubric,
			Axes:          c.Radar.Axes,
			AxisScores:    c.Radar.AxisScores,
			WeakestAxis:   c.Radar.WeakestAxis,
			StrongestAxis: c.Radar.StrongestAxis,
		},
	}
	if c.ActiveGoal != nil {
		out.Goal = &cachedGoal{
			Kind:          c.ActiveGoal.Kind,
			TargetCompany: c.ActiveGoal.TargetCompany,
			TargetLevel:   c.ActiveGoal.TargetLevel,
			TargetText:    c.ActiveGoal.TargetText,
			TargetDate:    c.ActiveGoal.TargetDate,
		}
	}
	for _, m := range c.RecentMemory {
		out.Memory = append(out.Memory, cachedMemoryEntry{
			Kind:       m.Kind,
			Summary:    m.Summary,
			OccurredAt: m.OccurredAt.UTC().Format(time.RFC3339Nano),
			HoursAgo:   m.HoursAgo,
		})
	}
	for _, r := range c.RelevantResources {
		out.Resources = append(out.Resources, cachedResource{
			ID:    r.ID,
			Title: r.Title,
			URL:   r.URL,
			Kind:  r.Kind,
		})
	}
	return out
}

func (c cachedUserContext) toDomain() copilotDomain.UserContext {
	out := copilotDomain.UserContext{
		Activity: copilotDomain.UserContextActivity{
			Last7dCount:  c.Activity.Last7d,
			Last30dCount: c.Activity.Last30d,
			TopKinds:     c.Activity.TopKinds,
		},
		Radar: copilotDomain.UserContextRadar{
			Rubric:        c.Radar.Rubric,
			Axes:          c.Radar.Axes,
			AxisScores:    c.Radar.AxisScores,
			WeakestAxis:   c.Radar.WeakestAxis,
			StrongestAxis: c.Radar.StrongestAxis,
		},
	}
	if c.Goal != nil {
		out.ActiveGoal = &copilotDomain.UserContextGoal{
			Kind:          c.Goal.Kind,
			TargetCompany: c.Goal.TargetCompany,
			TargetLevel:   c.Goal.TargetLevel,
			TargetText:    c.Goal.TargetText,
			TargetDate:    c.Goal.TargetDate,
		}
	}
	for _, m := range c.Memory {
		entry := copilotDomain.UserContextMemoryEntry{
			Kind:     m.Kind,
			Summary:  m.Summary,
			HoursAgo: m.HoursAgo,
		}
		if t, err := time.Parse(time.RFC3339Nano, m.OccurredAt); err == nil {
			entry.OccurredAt = t
		}
		out.RecentMemory = append(out.RecentMemory, entry)
	}
	for _, r := range c.Resources {
		out.RelevantResources = append(out.RelevantResources, copilotDomain.UserContextResource{
			ID:    r.ID,
			Title: r.Title,
			URL:   r.URL,
			Kind:  r.Kind,
		})
	}
	return out
}

// intelBundleToCopilot translates the intelligence-side struct into the
// copilot-side narrow shape. Goes here (and not in either domain
// package) because both packages are bounded — neither knows about
// the other. Cmd/monolith is the legitimate translation layer.
func intelBundleToCopilot(b intelApp.UserContextBundle) copilotDomain.UserContext {
	out := copilotDomain.UserContext{
		Activity: copilotDomain.UserContextActivity{
			Last7dCount:  b.Activity.Last7dCount,
			Last30dCount: b.Activity.Last30dCount,
			TopKinds:     b.Activity.TopKinds,
		},
		Radar: copilotDomain.UserContextRadar{
			Rubric:        b.Radar.Rubric,
			Axes:          b.Radar.Axes,
			AxisScores:    b.Radar.AxisScores,
			WeakestAxis:   b.Radar.WeakestAxis,
			StrongestAxis: b.Radar.StrongestAxis,
		},
	}
	if b.ActiveGoal != nil {
		date := ""
		if b.ActiveGoal.TargetDate != nil {
			date = b.ActiveGoal.TargetDate.UTC().Format("2006-01-02")
		}
		out.ActiveGoal = &copilotDomain.UserContextGoal{
			Kind:          string(b.ActiveGoal.Kind),
			TargetCompany: b.ActiveGoal.TargetCompany,
			TargetLevel:   b.ActiveGoal.TargetLevel,
			TargetText:    b.ActiveGoal.TargetText,
			TargetDate:    date,
		}
	}
	for _, m := range b.RecentMemory {
		out.RecentMemory = append(out.RecentMemory, copilotDomain.UserContextMemoryEntry{
			Kind:       m.Kind,
			Summary:    m.Summary,
			OccurredAt: m.OccurredAt,
			HoursAgo:   m.HoursAgo,
		})
	}
	for _, r := range b.RelevantResources {
		out.RelevantResources = append(out.RelevantResources, copilotDomain.UserContextResource{
			ID:    r.ID,
			Title: r.Title,
			URL:   r.URL,
			Kind:  r.Kind,
		})
	}
	return out
}

// Compile-time guard.
var _ copilotDomain.UserContextProvider = (*userContextAdapter)(nil)
