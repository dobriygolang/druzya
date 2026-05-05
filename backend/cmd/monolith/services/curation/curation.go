// Package curation — monolith bootstrap для services/curation.
//
// Wires:
//   - postgres repos (overrides / promotion / reputation)
//   - app UCs (Add / Hide / MarkUnhelpful / Replace / Reorder /
//     ApplyOverrides / Extract / Grade)
//   - Connect-RPC server (CurationService) + REST aliases
package curation

import (
	"context"
	"fmt"

	monolithServices "druz9/cmd/monolith/services"
	"druz9/curation"
	curationApp "druz9/curation/app"
	curationInfra "druz9/curation/infra"
	curationPorts "druz9/curation/ports"
	"druz9/shared/generated/pb/druz9/v1/druz9v1connect"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
)

// NewCuration wires the curation bounded context. Adapter selection:
//   - LLM-backed UCs (Extract / Grade / ValidateResource) активны если
//     d.LLMChain != nil. Иначе fail-soft: Extract возвращает manual=true,
//     Grade использует наивный quality.
//   - Reputation/Promotion repos активны всегда (Postgres-only).
func NewCuration(d monolithServices.Deps) *monolithServices.Module {
	overrides := curationInfra.NewOverrides(d.Pool)
	promotion := curationInfra.NewPromotion(d.Pool)
	reputation := curationInfra.NewReputation(d.Pool)
	fetcher := curation.NewFetcher()

	addUC := &curationApp.AddResource{
		Repo: overrides, Promotion: promotion, Now: d.Now,
	}
	hideUC := &curationApp.HideResource{Repo: overrides, Now: d.Now}
	unhelpfulUC := &curationApp.MarkUnhelpful{
		Repo: overrides, Reputation: reputation, Now: d.Now,
	}
	replaceUC := &curationApp.ReplaceResource{Repo: overrides, Now: d.Now}
	reorderUC := &curationApp.ReorderResource{Repo: overrides, Now: d.Now}
	applyUC := &curationApp.ApplyOverrides{Repo: overrides}
	extractUC := &curationApp.ExtractResourceContent{Fetcher: fetcher, Chain: d.LLMChain}
	gradeUC := &curationApp.ReflectionGrade{Chain: d.LLMChain}

	server := curationPorts.NewCurationServer(curationPorts.CurationServer{
		Add:                  addUC,
		Hide:                 hideUC,
		Unhelpful:            unhelpfulUC,
		Replace:              replaceUC,
		Reorder:              reorderUC,
		Apply:                applyUC,
		Extract:              extractUC,
		Grade:                gradeUC,
		ReflectionLogUpdater: newReflectionLogUpdater(d, promotion),
	})

	connectPath, connectHandler := druz9v1connect.NewCurationServiceHandler(server)

	return &monolithServices.Module{
		ConnectPath:        connectPath,
		ConnectHandler:     connectHandler,
		RequireConnectAuth: true,
		MountREST: func(r chi.Router) {
			// Live REST callers — Hone outbox дёргает напрямую (см.
			// hone/src/renderer/src/offline/wire.ts).
			r.Post("/curation/add-resource", connectHandler.ServeHTTP)
			r.Post("/curation/hide-resource", connectHandler.ServeHTTP)
			r.Post("/curation/mark-unhelpful", connectHandler.ServeHTTP)
			r.Post("/curation/replace-resource", connectHandler.ServeHTTP)
			r.Post("/curation/reflection", connectHandler.ServeHTTP)
			// Pivot 2026-05-05: orphan REST aliases /preview-resource,
			// /reorder-resource, /apply-overrides удалены — клиенты ходят
			// через Connect-RPC напрямую (см. hone/api/curation.ts).
		},
	}
}

// pgxAdapter — bounded context boundary: curation НЕ владеет
// user_resource_log (intelligence-таблица). Bridge через intel-injected
// updater. После UPDATE'а log-row адаптер также:
//   - bumps resource_promotion_signals.avg_quality (running average)
//     если quality > 0 — это закрывает loop «user submits reflection →
//     auto_promote sees quality signal».
//
// nil-safe: при d.Pool==nil вся ветка skip'ается.
type pgxAdapter struct {
	d         monolithServices.Deps
	promotion *curationInfra.Promotion
}

func (a *pgxAdapter) UpdateReflection(ctx context.Context, logID uuid.UUID,
	takeaways []string, quality float32, extracted []string, confusion bool,
) error {
	if a.d.Pool == nil {
		return nil
	}
	takeawaysJSON, err := marshalStringArrayJSON(takeaways)
	if err != nil {
		return fmt.Errorf("curation.UpdateReflection marshal: %w", err)
	}
	// UPDATE + RETURNING resource_url чтобы потом bump promotion.avg_quality.
	var resourceURL string
	if err := a.d.Pool.QueryRow(ctx, `
UPDATE user_resource_log
SET reflection_takeaways=$2,
    reflection_quality_score=$3,
    extracted_topics=$4,
    confusion_flag=$5
WHERE id=$1
RETURNING resource_url
`, logID, takeawaysJSON, quality, extracted, confusion).Scan(&resourceURL); err != nil {
		return fmt.Errorf("curation.UpdateReflection exec: %w", err)
	}
	// Phase 3.5d closed-loop: feed quality back into promotion signals.
	// Best-effort — promotion_signals row может не существовать (resource
	// был добавлен tutor'ом, не user'ом → не bump'ался AddResource'ом).
	if quality > 0 && resourceURL != "" && a.promotion != nil {
		_ = a.promotion.UpdateQuality(ctx, resourceURL, quality)
	}
	return nil
}

func newReflectionLogUpdater(d monolithServices.Deps, promotion *curationInfra.Promotion) curationPorts.ReflectionLogUpdater {
	return &pgxAdapter{d: d, promotion: promotion}
}

// marshalStringArrayJSON — minimal encoder без external json lib (одно
// место использования, не оправдывает import). Escapes ", \\, \n.
func marshalStringArrayJSON(s []string) ([]byte, error) {
	if s == nil {
		return []byte("[]"), nil
	}
	out := []byte{'['}
	for i, v := range s {
		if i > 0 {
			out = append(out, ',')
		}
		out = append(out, '"')
		for _, r := range v {
			if r == '"' || r == '\\' {
				out = append(out, '\\')
			}
			if r == '\n' {
				out = append(out, '\\', 'n')
				continue
			}
			out = append(out, []byte(string(r))...)
		}
		out = append(out, '"')
	}
	out = append(out, ']')
	return out, nil
}
