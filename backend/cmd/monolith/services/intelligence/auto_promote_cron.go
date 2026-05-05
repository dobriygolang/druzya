// auto_promote_cron.go — Phase 3.5d daily cron for resource auto-promote.
//
// Wires producers.AutoPromoteRunner с:
//   - PromotionCandidateLister     — postgres-backed (curation_infra)
//   - ResourceValidator            — обёртка над curation app.ValidateResource UC
//   - AtlasResourceWriter          — pgxpool helper (UPSERT atlas_nodes.external_resources)
//   - AdminNotifier                — slog-only сейчас (TG hookup TODO)
//
// Ticker: 24h. Initial run at boot — catches accumulated candidates.
package intelligence

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"time"

	monolithServices "druz9/cmd/monolith/services"
	"druz9/curation"
	curationApp "druz9/curation/app"
	curationInfra "druz9/curation/infra"
	"druz9/intelligence/app/producers"

	"github.com/jackc/pgx/v5/pgxpool"
)

// NewAutoPromoteCron — module с background loop. Daily tick.
func NewAutoPromoteCron(d monolithServices.Deps) *monolithServices.Module {
	if d.LLMChain == nil {
		d.Log.Warn("intelligence.auto_promote: LLMChain nil — skip cron (TaskValidateResource needs LLM)")
		return &monolithServices.Module{}
	}
	promotion := curationInfra.NewPromotion(d.Pool)
	validator := &validatorAdapter{
		uc: &curationApp.ValidateResource{
			Fetcher: curation.NewFetcher(),
			Chain:   d.LLMChain,
		},
	}
	writer := &atlasWriterAdapter{pool: d.Pool}
	notifier := &slogNotifierAdapter{log: d.Log}

	runner := &producers.AutoPromoteRunner{
		Lister:    promotionListerAdapter{p: promotion},
		Validator: validator,
		Writer:    writer,
		Notifier:  notifier,
		Log:       d.Log,
	}

	return &monolithServices.Module{
		Background: []func(ctx context.Context){
			func(ctx context.Context) {
				// Bootstrap calls Background entries synchronously — нужно
				// spawn'ить goroutine иначе блокирует ListenAndServe.
				go func() {
					ticker := time.NewTicker(24 * time.Hour)
					defer ticker.Stop()
					if err := runner.Run(ctx); err != nil {
						d.Log.Warn("intelligence.auto_promote: initial run", "err", err)
					}
					for {
						select {
						case <-ctx.Done():
							return
						case <-ticker.C:
							if err := runner.Run(ctx); err != nil {
								d.Log.Warn("intelligence.auto_promote: tick", "err", err)
							}
						}
					}
				}()
			},
		},
	}
}

// ─── Adapters ─────────────────────────────────────────────────────────────

type promotionListerAdapter struct{ p *curationInfra.Promotion }

func (a promotionListerAdapter) Candidates(ctx context.Context, minUsers int, minQuality float32) ([]producers.PromotionCandidate, error) {
	cands, err := a.p.Candidates(ctx, minUsers, minQuality)
	if err != nil {
		return nil, fmt.Errorf("promotion candidates: %w", err)
	}
	out := make([]producers.PromotionCandidate, len(cands))
	for i, c := range cands {
		out[i] = producers.PromotionCandidate{
			URL:             c.URL,
			AtlasNodeID:     c.AtlasNodeID,
			UserCount:       c.UserCount,
			AvgQuality:      c.AvgQuality,
			LastUserAddedAt: c.LastUserAddedAt,
		}
	}
	return out, nil
}

func (a promotionListerAdapter) MarkPromoted(ctx context.Context, url string) error {
	if err := a.p.MarkPromoted(ctx, url); err != nil {
		return fmt.Errorf("mark promoted: %w", err)
	}
	return nil
}

func (a promotionListerAdapter) MarkBlocked(ctx context.Context, url, reason string) error {
	if err := a.p.MarkBlocked(ctx, url, reason); err != nil {
		return fmt.Errorf("mark blocked: %w", err)
	}
	return nil
}

type validatorAdapter struct {
	uc *curationApp.ValidateResource
}

func (a *validatorAdapter) Validate(ctx context.Context, url, atlasNodeID, nodeDescription string) (producers.ValidationResult, error) {
	out, err := a.uc.Do(ctx, curationApp.ValidateInput{
		URL: url, AtlasNodeID: atlasNodeID, NodeDescription: nodeDescription,
	})
	if err != nil {
		return producers.ValidationResult{}, fmt.Errorf("validate resource: %w", err)
	}
	return producers.ValidationResult{
		Alive:     out.Alive,
		Reputable: out.Reputable,
		OnTopic:   out.OnTopic,
		Score:     out.Score,
		Reason:    out.Reason,
	}, nil
}

type atlasWriterAdapter struct {
	pool *pgxpool.Pool
}

func (a *atlasWriterAdapter) NodeDescription(ctx context.Context, atlasNodeID string) (string, error) {
	var desc string
	err := a.pool.QueryRow(ctx,
		`SELECT COALESCE(description,'') FROM atlas_nodes WHERE id=$1`,
		atlasNodeID,
	).Scan(&desc)
	if err != nil {
		return desc, fmt.Errorf("scan node description: %w", err)
	}
	return desc, nil
}

func (a *atlasWriterAdapter) AppendAutoPromoted(ctx context.Context, atlasNodeID, resourceURL, why string) error {
	// Append jsonb — minimal Resource shape с auto_promoted=true marker.
	// Если URL уже в массиве, jsonb_path_query вернёт > 0 и мы skip.
	entry := map[string]any{
		"url":           resourceURL,
		"why":           why,
		"priority":      "supplement",
		"auto_promoted": true,
	}
	raw, _ := json.Marshal(entry)
	_, err := a.pool.Exec(ctx, `
UPDATE atlas_nodes
SET external_resources = COALESCE(external_resources,'[]'::jsonb) || $2::jsonb
WHERE id = $1
  AND NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(COALESCE(external_resources,'[]'::jsonb)) e
    WHERE e->>'url' = $3
  )
`, atlasNodeID, raw, resourceURL)
	if err != nil {
		return fmt.Errorf("atlasWriter.AppendAutoPromoted: %w", err)
	}
	return nil
}

// slogNotifierAdapter — MVP impl. TODO: replace на TG-bot adapter (см
// notify.Bot) когда appropriate admin chat настроен.
type slogNotifierAdapter struct {
	log *slog.Logger
}

func (n *slogNotifierAdapter) NotifyAdmin(ctx context.Context, subject, body string) error {
	if n.log != nil {
		n.log.Info("admin-notify · auto-promote", "subject", subject, "body", body)
	}
	return nil
}
