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
	"net/http"

	monolithServices "druz9/cmd/monolith/services"
	curationApp "druz9/curation/app"
	"druz9/curation"
	curationInfra "druz9/curation/infra"
	curationPorts "druz9/curation/ports"
	"druz9/shared/generated/pb/druz9/v1/druz9v1connect"

	"connectrpc.com/connect"
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
		ReflectionLogUpdater: newReflectionLogUpdater(d),
	})

	connectPath, connectHandler := druz9v1connect.NewCurationServiceHandler(server)

	mod := &monolithServices.Module{
		ConnectPath:        connectPath,
		ConnectHandler:     connectHandler,
		RequireConnectAuth: true,
		MountREST: func(r chi.Router) {
			r.Post("/curation/preview-resource", connectHandler.ServeHTTP)
			r.Post("/curation/add-resource", connectHandler.ServeHTTP)
			r.Post("/curation/hide-resource", connectHandler.ServeHTTP)
			r.Post("/curation/mark-unhelpful", connectHandler.ServeHTTP)
			r.Post("/curation/replace-resource", connectHandler.ServeHTTP)
			r.Post("/curation/reorder-resource", connectHandler.ServeHTTP)
			r.Post("/curation/apply-overrides", connectHandler.ServeHTTP)
			r.Post("/curation/reflection", connectHandler.ServeHTTP)
		},
	}
	_ = mod
	_ = http.MethodPost
	return mod
}

// reflectionLogUpdater — bounded context boundary: curation НЕ владеет
// user_resource_log (intelligence-таблица). Bridge через intel-injected
// updater. Если intelligence module ещё не wired (порядок bootstrap'а) —
// nil → curation fail-softly skip'ает UPDATE, UI всё равно получает grade.
type reflectionLogUpdater struct {
	pool poolExec
}

type poolExec interface {
	Exec(ctx context.Context, sql string, args ...any) (commandTag, error)
}
type commandTag interface{}

// inline pgx wrapper.
type pgxAdapter struct{ d monolithServices.Deps }

func (a *pgxAdapter) UpdateReflection(ctx context.Context, logID uuid.UUID,
	takeaways []string, quality float32, extracted []string, confusion bool) error {
	if a.d.Pool == nil {
		return nil
	}
	// pgx encoded в JSONB; pq массивов через text[].
	takeawaysJSON, err := marshalStringArrayJSON(takeaways)
	if err != nil {
		return err
	}
	_, err = a.d.Pool.Exec(ctx, `
UPDATE user_resource_log
SET reflection_takeaways=$2,
    reflection_quality_score=$3,
    extracted_topics=$4,
    confusion_flag=$5
WHERE id=$1
`, logID, takeawaysJSON, quality, extracted, confusion)
	return err
}

func newReflectionLogUpdater(d monolithServices.Deps) curationPorts.ReflectionLogUpdater {
	return &pgxAdapter{d: d}
}

func marshalStringArrayJSON(s []string) ([]byte, error) {
	if s == nil {
		return []byte("[]"), nil
	}
	// тривиальная JSON encoding без external deps.
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

// Compile-time guards для unused imports.
var (
	_ = connect.NewError
)
