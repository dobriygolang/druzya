// auto_promote.go — daily cron producer.
//
// Pipeline:
//  1. Fetch promotion candidates (user_count ≥ 5, avg_quality ≥ 0.7,
//     not blocked, last_user_added > 24h ago).
//  2. For each: TaskValidateResource(url, atlas_node) → score.
//  3. IF score ≥ 0.7 AND domain not blocked → INSERT в
//     atlas_nodes.external_resources (priority='supplement',
//     auto_promoted=true) + UPDATE resource_promotion_signals.promoted_at.
//  4. Notify Sergey via admin channel post-hoc.
//
// Decision: NO admin approval gate (Sergey 2026-05-04). Algorithm + LLM +
// domain_reputation решают. См memory/project_curation_model.md «User
// contributions + auto-promote».
package producers

import (
	"context"
	"fmt"
	"log/slog"
	"time"
)

// PromotionCandidateLister — read-side abstraction вокруг
// resource_promotion_signals.
type PromotionCandidateLister interface {
	Candidates(ctx context.Context, minUsers int, minQuality float32) ([]PromotionCandidate, error)
	MarkPromoted(ctx context.Context, url string) error
	MarkBlocked(ctx context.Context, url, reason string) error
}

type PromotionCandidate struct {
	URL             string
	AtlasNodeID     string
	UserCount       int
	AvgQuality      float32
	LastUserAddedAt string
}

// ResourceValidator — TaskValidateResource UC.
type ResourceValidator interface {
	Validate(ctx context.Context, url, atlasNodeID, nodeDescription string) (ValidationResult, error)
}

type ValidationResult struct {
	Alive     bool
	Reputable bool
	OnTopic   bool
	Score     float32
	Reason    string
}

// AtlasResourceWriter — UPSERT atlas_nodes.external_resources jsonb с
// auto_promoted flag.
type AtlasResourceWriter interface {
	AppendAutoPromoted(ctx context.Context, atlasNodeID, resourceURL, why string) error
	NodeDescription(ctx context.Context, atlasNodeID string) (string, error)
}

// AdminNotifier — post-hoc notification (Sergey).
type AdminNotifier interface {
	NotifyAdmin(ctx context.Context, subject, body string) error
}

// AutoPromoteRunner — daily cron entry.
type AutoPromoteRunner struct {
	Lister    PromotionCandidateLister
	Validator ResourceValidator
	Writer    AtlasResourceWriter
	Notifier  AdminNotifier
	Log       *slog.Logger

	// Tunables.
	MinUsers   int     // default 5
	MinQuality float32 // default 0.7
	MinScore   float32 // default 0.7
}

// Run executes one cron-tick. Idempotent — promoted_at IS NULL filter в
// Lister гарантирует что одна и та же URL дважды не promote'ится.
func (r *AutoPromoteRunner) Run(ctx context.Context) error {
	if r.MinUsers == 0 {
		r.MinUsers = 5
	}
	if r.MinQuality == 0 {
		r.MinQuality = 0.7
	}
	if r.MinScore == 0 {
		r.MinScore = 0.7
	}

	cands, err := r.Lister.Candidates(ctx, r.MinUsers, r.MinQuality)
	if err != nil {
		return fmt.Errorf("auto_promote: list candidates: %w", err)
	}
	if len(cands) == 0 {
		return nil
	}
	promoted := 0
	for _, c := range cands {
		// Per-candidate timeout — один LLM call ≤ 12s, fetch ≤ 5s.
		cctx, cancel := context.WithTimeout(ctx, 20*time.Second)
		desc, _ := r.Writer.NodeDescription(cctx, c.AtlasNodeID)
		val, err := r.Validator.Validate(cctx, c.URL, c.AtlasNodeID, desc)
		cancel()
		if err != nil {
			r.logWarn("validate fail", "url", c.URL, "err", err)
			continue
		}
		if !val.Alive {
			_ = r.Lister.MarkBlocked(ctx, c.URL, "dead url: "+val.Reason)
			continue
		}
		if !val.Reputable || !val.OnTopic || val.Score < r.MinScore {
			r.logInfo("auto_promote: skip low-score",
				"url", c.URL, "score", val.Score, "reputable", val.Reputable, "on_topic", val.OnTopic)
			continue
		}
		if err := r.Writer.AppendAutoPromoted(ctx, c.AtlasNodeID, c.URL,
			fmt.Sprintf("user-promoted (%d users, q=%.2f)", c.UserCount, c.AvgQuality)); err != nil {
			r.logWarn("append fail", "url", c.URL, "err", err)
			continue
		}
		_ = r.Lister.MarkPromoted(ctx, c.URL)
		promoted++
		if r.Notifier != nil {
			body := fmt.Sprintf(
				"auto-promoted resource:\nURL: %s\nNode: %s\nUsers: %d · avg quality: %.2f\nLLM score: %.2f · %s",
				c.URL, c.AtlasNodeID, c.UserCount, c.AvgQuality, val.Score, val.Reason)
			_ = r.Notifier.NotifyAdmin(ctx, "auto-promoted "+c.URL, body)
		}
	}
	r.logInfo("auto_promote: tick done",
		"candidates", len(cands), "promoted", promoted)
	return nil
}

func (r *AutoPromoteRunner) logInfo(msg string, args ...any) {
	if r.Log != nil {
		r.Log.Info(msg, args...)
	}
}
func (r *AutoPromoteRunner) logWarn(msg string, args ...any) {
	if r.Log != nil {
		r.Log.Warn(msg, args...)
	}
}
