package services

import (
	"context"

	vacApp "druz9/vacancies/app"
	vacDomain "druz9/vacancies/domain"
	vacInfra "druz9/vacancies/infra"
	vacParsers "druz9/vacancies/infra/parsers"
	vacPorts "druz9/vacancies/ports"

	"github.com/go-chi/chi/v5"
)

// NewVacancies wires the vacancies bounded context.
//
// Read-mostly module — heavy caching at the repo layer (ListByFilter 10m,
// GetByID 1h) keeps the catalogue page snappy, and the OpenRouter extractor
// is wrapped in a 7-day Redis cache so the hourly Sync re-billing the same
// description is impossible.
//
// Background = the SyncJob.Run loop. It crawls every registered Parser once
// per hour, upserts the batch, then runs the LLM extractor on each row.
func NewVacancies(d Deps) *Module {
	pgVacs := vacInfra.NewPgVacancyRepo(d.Pool)
	pgSaved := vacInfra.NewPgSavedRepo(d.Pool)

	var vacRepo vacDomain.VacancyRepo = pgVacs
	if d.Redis != nil {
		kv := vacInfra.NewRedisKV(d.Redis)
		vacRepo = vacInfra.NewCachedVacancyRepo(
			pgVacs, kv,
			vacInfra.DefaultListTTL, vacInfra.DefaultByIDTTL,
			d.Log,
		)
	}

	// Anti-fallback: if OPENROUTER_API_KEY is empty, do NOT register the
	// extractor at all. SyncJob's nil-check skips extraction with a clear
	// startup WARN below — far better than the old "silently return [] at
	// request time" which left vacancies with no skills and nobody knew.
	var extractor vacDomain.SkillExtractor
	if d.Cfg.LLM.OpenRouterAPIKey == "" {
		d.Log.Warn("vacancies: OPENROUTER_API_KEY not set — skill extraction disabled, sync runs without skill normalization")
	} else {
		var kv vacInfra.KV
		if d.Redis != nil {
			kv = vacInfra.NewRedisKV(d.Redis)
		}
		extractor = vacInfra.NewOpenRouterExtractor(d.Cfg.LLM.OpenRouterAPIKey, kv, d.Log)
	}

	parsers := vacParsers.RegisterAll(vacParsers.Config{Log: d.Log})

	sync := &vacApp.SyncJob{
		Parsers:   parsers,
		Repo:      vacRepo,
		Extractor: extractor,
		Log:       d.Log,
	}
	analyze := &vacApp.AnalyzeURL{Parsers: parsers, Repo: vacRepo, Extractor: extractor}
	list := &vacApp.ListVacancies{Repo: vacRepo}
	get := &vacApp.GetVacancy{Repo: vacRepo}
	save := &vacApp.SaveVacancy{Repo: pgSaved}
	upd := &vacApp.UpdateSavedStatus{Repo: pgSaved}
	rem := &vacApp.RemoveSaved{Repo: pgSaved}
	listSaved := &vacApp.ListSaved{Repo: pgSaved}

	h := &vacPorts.Handler{
		Analyze: analyze, List: list, Get: get,
		Save: save, Update: upd, Remove: rem, ListSaved: listSaved,
		Sync: sync,
		Log:  d.Log,
	}

	return &Module{
		MountREST: func(r chi.Router) {
			h.Mount(r)
		},
		Background: []func(ctx context.Context){
			func(ctx context.Context) { go sync.Run(ctx) },
		},
	}
}
