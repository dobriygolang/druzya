// auto_promote.go — F6 auto-promote daemon (Phase 3.5d pure-Go heuristic).
//
// Pipeline (one tick, every 6h):
//  1. RefreshSignals — recompute avg_quality + user_count + last_logged_at
//     in `resource_promotion_signals` from rows in `user_resource_log`
//     that landed in the last 24h. Aggregates 'finished' events + grade
//     scores from `reflection_quality_score` (NULL ⇒ skip).
//  2. Promote — pull rows that satisfy avg_quality ≥ MinQuality + user_count
//     ≥ MinUsers + promoted_at IS NULL + deprecated_at IS NULL +
//     blocked_reason IS NULL, then UPDATE promoted_at = now() and (best-
//     effort) append into `atlas_nodes.external_resources` jsonb.
//  3. Deprecate — pull rows with user_count ≥ MinUsers + avg_quality ≤
//     MaxBadQuality + deprecated_at IS NULL, then UPDATE deprecated_at +
//     deprecated_reason = 'low_quality_avg'.
//
// No LLM call — this is the cheap heuristic loop that the existing
// intelligence.AutoPromoteCron (LLM-validated) sits on top of:
//   - heuristic loop maintains promoted_at / deprecated_at lifecycles
//   - LLM cron validates fresh candidates before atlas write
// Two crons coexist without conflict (idempotent via partial indexes).
//
// Result counters returned for observability — caller logs them.

package app

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"time"
)

// PromotionSignal — single row from `resource_promotion_signals`.
type PromotionSignal struct {
	URL         string
	AtlasNodeID string
	UserCount   int
	AvgQuality  float32
}

// SignalRefresh — input to PromotionWriter.RefreshSignal: aggregate
// computed from user_resource_log over the last refresh window.
type SignalRefresh struct {
	URL          string
	AtlasNodeID  string // chosen from log row — last seen wins
	UserCount    int    // distinct users with kind='finished'
	AvgQuality   float32
	HasQuality   bool      // false ⇒ avg_quality stays NULL on upsert
	LastLoggedAt time.Time // max(occurred_at) for this url
}

// PromotionReader — read-side port for the auto-promote cron.
type PromotionReader interface {
	// RecentLoggedURLs lists distinct (url, atlas_node_id) pairs that
	// have at least one `finished` event in user_resource_log within
	// `since`. The cron then asks AggregateSignal per URL to refresh
	// the promotion-signals row.
	RecentLoggedURLs(ctx context.Context, since time.Time) ([]LoggedResource, error)

	// AggregateSignal computes user_count + avg_quality + last_logged_at
	// across the entire history of user_resource_log for one URL.
	AggregateSignal(ctx context.Context, url string) (SignalRefresh, error)

	// PromoteCandidates pulls signals eligible for promotion:
	// user_count ≥ minUsers · avg_quality ≥ minQuality ·
	// promoted_at IS NULL · deprecated_at IS NULL · blocked_reason IS NULL.
	PromoteCandidates(ctx context.Context, minUsers int, minQuality float32) ([]PromotionSignal, error)

	// DeprecateCandidates pulls signals eligible for deprecation:
	// user_count ≥ minUsers · avg_quality ≤ maxBadQuality ·
	// deprecated_at IS NULL.
	DeprecateCandidates(ctx context.Context, minUsers int, maxBadQuality float32) ([]PromotionSignal, error)
}

// LoggedResource — minimal projection from user_resource_log for the
// daily-refresh scan.
type LoggedResource struct {
	URL         string
	AtlasNodeID string // last seen wins, "" if log row had NULL
}

// PromotionWriter — write-side port for the auto-promote cron.
type PromotionWriter interface {
	// RefreshSignal upserts a row in resource_promotion_signals from
	// an aggregate computed over user_resource_log. Used by the daily
	// refresh stage so the heuristic signals stay fresh even when
	// AddResource (which BumpAdded's the row) was never called for a
	// curated resource that users only "finished".
	RefreshSignal(ctx context.Context, in SignalRefresh) error

	// MarkPromoted sets promoted_at = now() for one URL. Idempotent: if
	// the row was already promoted the UPDATE is a no-op.
	MarkPromoted(ctx context.Context, url string) error

	// MarkDeprecated sets deprecated_at = now() + deprecated_reason
	// for one URL. Idempotent.
	MarkDeprecated(ctx context.Context, url, reason string) error

	// AppendAtlasResource — best-effort jsonb append into
	// atlas_nodes.external_resources. The cron skips silently when
	// atlasNodeID is empty (orphan log row) or the array already
	// contains the URL.
	AppendAtlasResource(ctx context.Context, atlasNodeID, url string, userCount int, avgQuality float32) error
}

// AutoPromote — UC that runs one tick of the heuristic auto-promote
// daemon.
type AutoPromote struct {
	Reader PromotionReader
	Writer PromotionWriter
	Log    *slog.Logger
	Now    func() time.Time

	// Tunables — zero ⇒ defaults applied at Run().
	MinUsers      int           // default 5
	MinQuality    float32       // default 0.7
	MaxBadQuality float32       // default 0.3
	RefreshWindow time.Duration // default 24h
}

// Result — counters for observability.
type Result struct {
	Refreshed  int
	Promoted   int
	Deprecated int
}

// Run executes one tick. Each stage is independent — a failure in
// refresh does not block promote/deprecate. All errors are joined and
// returned at the end so the cron can log a single line.
func (uc *AutoPromote) Run(ctx context.Context) (Result, error) {
	if uc.Reader == nil || uc.Writer == nil {
		return Result{}, errors.New("curation.AutoPromote: nil reader/writer")
	}
	uc.applyDefaults()

	var (
		res  Result
		errs []error
	)

	res.Refreshed = uc.refresh(ctx, &errs)
	res.Promoted = uc.promote(ctx, &errs)
	res.Deprecated = uc.deprecate(ctx, &errs)

	if uc.Log != nil {
		uc.Log.Info("curation.auto_promote: tick done",
			"refreshed", res.Refreshed,
			"promoted", res.Promoted,
			"deprecated", res.Deprecated,
		)
	}
	return res, errors.Join(errs...)
}

func (uc *AutoPromote) applyDefaults() {
	if uc.MinUsers <= 0 {
		uc.MinUsers = 5
	}
	if uc.MinQuality <= 0 {
		uc.MinQuality = 0.7
	}
	if uc.MaxBadQuality <= 0 {
		uc.MaxBadQuality = 0.3
	}
	if uc.RefreshWindow <= 0 {
		uc.RefreshWindow = 24 * time.Hour
	}
}

func (uc *AutoPromote) refresh(ctx context.Context, errs *[]error) int {
	since := uc.now().Add(-uc.RefreshWindow)
	urls, err := uc.Reader.RecentLoggedURLs(ctx, since)
	if err != nil {
		*errs = append(*errs, fmt.Errorf("recent logged urls: %w", err))
		return 0
	}
	if len(urls) == 0 {
		return 0
	}
	refreshed := 0
	for _, r := range urls {
		if ctx.Err() != nil {
			*errs = append(*errs, ctx.Err())
			return refreshed
		}
		agg, err := uc.Reader.AggregateSignal(ctx, r.URL)
		if err != nil {
			uc.warn("aggregate signal", "url", r.URL, "err", err)
			continue
		}
		if agg.URL == "" {
			agg.URL = r.URL
		}
		if agg.AtlasNodeID == "" {
			agg.AtlasNodeID = r.AtlasNodeID
		}
		if err := uc.Writer.RefreshSignal(ctx, agg); err != nil {
			uc.warn("refresh signal", "url", r.URL, "err", err)
			continue
		}
		refreshed++
	}
	return refreshed
}

func (uc *AutoPromote) promote(ctx context.Context, errs *[]error) int {
	cands, err := uc.Reader.PromoteCandidates(ctx, uc.MinUsers, uc.MinQuality)
	if err != nil {
		*errs = append(*errs, fmt.Errorf("promote candidates: %w", err))
		return 0
	}
	promoted := 0
	for _, c := range cands {
		if ctx.Err() != nil {
			*errs = append(*errs, ctx.Err())
			return promoted
		}
		if err := uc.Writer.MarkPromoted(ctx, c.URL); err != nil {
			uc.warn("mark promoted", "url", c.URL, "err", err)
			continue
		}
		// Best-effort atlas write — orphan rows (no atlas_node_id) are
		// promoted at the signals layer only; the catalogue write is
		// skipped silently.
		if c.AtlasNodeID != "" {
			if err := uc.Writer.AppendAtlasResource(ctx, c.AtlasNodeID, c.URL, c.UserCount, c.AvgQuality); err != nil {
				uc.warn("append atlas", "url", c.URL, "node", c.AtlasNodeID, "err", err)
			}
		}
		promoted++
	}
	return promoted
}

func (uc *AutoPromote) deprecate(ctx context.Context, errs *[]error) int {
	cands, err := uc.Reader.DeprecateCandidates(ctx, uc.MinUsers, uc.MaxBadQuality)
	if err != nil {
		*errs = append(*errs, fmt.Errorf("deprecate candidates: %w", err))
		return 0
	}
	deprecated := 0
	for _, c := range cands {
		if ctx.Err() != nil {
			*errs = append(*errs, ctx.Err())
			return deprecated
		}
		if err := uc.Writer.MarkDeprecated(ctx, c.URL, "low_quality_avg"); err != nil {
			uc.warn("mark deprecated", "url", c.URL, "err", err)
			continue
		}
		deprecated++
	}
	return deprecated
}

func (uc *AutoPromote) now() time.Time {
	if uc.Now != nil {
		return uc.Now().UTC()
	}
	return time.Now().UTC()
}

func (uc *AutoPromote) warn(msg string, args ...any) {
	if uc.Log != nil {
		uc.Log.Warn("curation.auto_promote: "+msg, args...)
	}
}
