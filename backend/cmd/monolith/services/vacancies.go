package services

import (
	"context"
	"log/slog"
	"time"

	vacApp "druz9/vacancies/app"
	vacDomain "druz9/vacancies/domain"
	vacInfra "druz9/vacancies/infra"
	vacCache "druz9/vacancies/infra/cache"
	vacParsers "druz9/vacancies/infra/parsers"
	vacDetails "druz9/vacancies/infra/parsers/details"
	vacPorts "druz9/vacancies/ports"

	"github.com/go-chi/chi/v5"
)

// NewVacancies wires the vacancies bounded context.
//
// Phase 3 model:
//
//   - Parsed catalogue lives in a single in-process cache (vacInfra/cache).
//     Refreshed every 15 min from each registered Parser in parallel; on
//     per-source failure the prior bucket survives so one portal outage
//     doesn't blank the catalogue.
//   - Refresh-on-boot blocks server start until the first refresh completes
//     (30s budget — fail-open with whatever returned).
//   - Per-user kanban state lives in saved_vacancies as a snapshot row
//     keyed on (user_id, source, external_id). The vacancy JSON is frozen
//     into snapshot_json at save time so the kanban survives upstream
//     deletions and renames.
//
// Anti-fallback policy: per-source refresh failure increments
// vacancies_cache_refresh_errors_total{source} and emits a Warn log. No
// silent zeroing; no fake data.
func NewVacancies(d Deps) *Module {
	pgSaved := vacInfra.NewPgSavedRepo(d.Pool)

	// Skill extractor: only registered when OPENROUTER_API_KEY is set. The
	// AnalyzeURL flow's nil-check skips extraction with a clear startup WARN
	// — far better than silently writing empty skill lists.
	var extractor vacDomain.SkillExtractor
	if d.Cfg.LLM.OpenRouterAPIKey == "" {
		d.Log.Warn("vacancies: OPENROUTER_API_KEY not set — analyze runs without skill normalization")
	} else {
		var kv vacInfra.KV
		if d.Redis != nil {
			kv = vacInfra.NewRedisKV(d.Redis)
		}
		extractor = vacInfra.NewOpenRouterExtractor(d.Cfg.LLM.OpenRouterAPIKey, kv, d.Log)
	}

	parsers := vacParsers.RegisterAll(vacParsers.Config{Log: d.Log})

	// The cache speaks its own Parser interface (structurally satisfied by
	// domain.Parser); convert without copying.
	cacheParsers := make([]vacCache.Parser, 0, len(parsers))
	for _, p := range parsers {
		cacheParsers = append(cacheParsers, p)
	}
	cache := vacCache.New(cacheParsers, d.Log, vacCache.Options{})

	// Phase 4: lazy detail-enrichment cache. Sits on top of the listing
	// cache; populated on first detail-page open per (source, ext_id);
	// stale-while-revalidate at 1h TTL; singleflight per key.
	detailFetchers := vacDetails.RegisterAll(vacDetails.Config{Log: d.Log})
	detailsCache := vacCache.NewDetails(cache, detailFetchers, d.Log, vacCache.DetailsOptions{})

	analyze := &vacApp.AnalyzeURL{Cache: cache, Extractor: extractor}
	list := &vacApp.ListVacancies{Cache: cache}
	get := &vacApp.GetVacancy{Cache: cache}
	getDetails := &vacApp.GetVacancyDetails{Details: detailsCache}
	facets := &vacApp.GetFacets{Cache: cache}
	save := &vacApp.SaveVacancy{Repo: pgSaved, Cache: cache}
	upd := &vacApp.UpdateSavedStatus{Repo: pgSaved}
	rem := &vacApp.RemoveSaved{Repo: pgSaved}
	listSaved := &vacApp.ListSaved{Repo: pgSaved}
	getSaved := &vacApp.GetSaved{Repo: pgSaved, Cache: cache}

	h := &vacPorts.Handler{
		Analyze: analyze, List: list, Get: get, GetDetails: getDetails, Facets: facets,
		Save: save, Update: upd, Remove: rem,
		ListSaved: listSaved, GetSaved: getSaved,
		Log: d.Log,
	}

	// Refresh-on-boot — block server start (with a 30s budget) so the first
	// /vacancies/* request returns real data, not an empty page. This runs
	// synchronously inside NewVacancies so it sits before the App's
	// httpSrv.ListenAndServe in bootstrap.Run.
	bootCtx, bootCancel := context.WithTimeout(context.Background(), vacCache.DefaultBootBudget)
	defer bootCancel()
	counts := cache.RefreshOnce(bootCtx)
	logBootCounts(d.Log, counts)

	return &Module{
		MountREST: func(r chi.Router) {
			h.Mount(r)
		},
		Background: []func(ctx context.Context){
			func(ctx context.Context) { go cache.Run(ctx) },
		},
	}
}

func logBootCounts(log *slog.Logger, counts map[vacDomain.Source]int) {
	if log == nil {
		return
	}
	total := 0
	for _, n := range counts {
		total += n
	}
	attrs := []any{slog.Int("total", total), slog.Duration("budget", vacCache.DefaultBootBudget), slog.Time("at", time.Now())}
	for s, n := range counts {
		attrs = append(attrs, slog.Int(string(s), n))
	}
	log.Info("vacancies.cache: boot warm complete", attrs...)
}
