package services

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	profileDomain "druz9/profile/domain"
	profileInfra "druz9/profile/infra"
	vacApp "druz9/vacancies/app"
	vacDomain "druz9/vacancies/domain"
	vacInfra "druz9/vacancies/infra"
	vacCache "druz9/vacancies/infra/cache"
	vacParsers "druz9/vacancies/infra/parsers"
	vacDetails "druz9/vacancies/infra/parsers/details"
	vacPorts "druz9/vacancies/ports"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
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

	// Skill extractor: the llmchain (Groq+Cerebras+OpenRouter) path is
	// preferred — it adds provider fallback and proactive rate-limit
	// avoidance over the single-vendor OpenRouter client. Falls back
	// to direct-OpenRouter when no chain was built (no provider keys
	// set), and runs without normalization when even that is absent.
	var extractor vacDomain.SkillExtractor
	var kv vacInfra.KV
	if d.Redis != nil {
		kv = vacInfra.NewRedisKV(d.Redis)
	}
	switch {
	case d.LLMChain != nil:
		extractor = vacInfra.NewChainExtractor(d.LLMChain, kv, d.Log)
	case d.Cfg.LLM.OpenRouterAPIKey != "":
		extractor = vacInfra.NewOpenRouterExtractor(d.Cfg.LLM.OpenRouterAPIKey, kv, d.Log)
	default:
		d.Log.Warn("vacancies: no LLM provider configured — analyze runs without skill normalization")
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

	// Phase 5: derive the user's stack from real profile statistics.
	// Cross-bounded-context plumbing via thin adapters — vacancies module
	// stays free of profile imports; the wirer (this file) is the only
	// place where the two domains meet. The atlas-side adapter caches the
	// catalogue (≤200 nodes today) on first call so the per-analyze
	// JOIN is two SQL reads, not a graph fan-out.
	profilePG := profileInfra.NewPostgres(d.Pool)
	atlasCat := profileInfra.NewAtlasCataloguePostgres(d.Pool)
	resolver := vacInfra.NewUserSkillsResolver(
		ratingsAdapter{repo: profilePG},
		newAtlasMasteryAdapter(profilePG, atlasCat, d.Log),
		d.Log,
	)

	analyze := &vacApp.AnalyzeURL{
		Cache:     cache,
		Details:   detailsCache,
		Extractor: extractor,
		UserSkill: resolver,
		// Reads users.ai_vacancies_model per-request. Pg (not cached) is
		// fine — one extra point read per /analyze call, already dominated
		// by the OpenRouter round-trip.
		UserModel: vacanciesModelAdapter{repo: profilePG},
		Log:       d.Log,
	}
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

// vacanciesModelAdapter bridges profile.Postgres → vacApp.UserModelResolver.
// Only wraps one method; kept inline in the wirer (no separate file) to
// match the adapter pattern already used for ratingsAdapter.
type vacanciesModelAdapter struct {
	repo *profileInfra.Postgres
}

func (a vacanciesModelAdapter) ResolveVacanciesModel(ctx context.Context, userID uuid.UUID) (string, error) {
	s, err := a.repo.GetVacanciesModel(ctx, userID)
	if err != nil {
		return "", fmt.Errorf("services.vacancies.vacanciesModelAdapter: %w", err)
	}
	return s, nil
}

// ratingsAdapter bridges profile.Postgres → vacancies infra. Two domains,
// two struct shapes — adapter copies the four fields we care about.
type ratingsAdapter struct {
	repo *profileInfra.Postgres
}

func (a ratingsAdapter) ListRatings(ctx context.Context, userID uuid.UUID) ([]vacInfra.SectionRating, error) {
	rs, err := a.repo.ListRatings(ctx, userID)
	if err != nil {
		return nil, fmt.Errorf("services.vacancies.ratingsAdapter: %w", err)
	}
	out := make([]vacInfra.SectionRating, 0, len(rs))
	for _, r := range rs {
		out = append(out, vacInfra.SectionRating{
			Section:      string(r.Section),
			Elo:          r.Elo,
			MatchesCount: r.MatchesCount,
			LastMatchAt:  r.LastMatchAt,
		})
	}
	return out, nil
}

// atlasMasteryAdapter bridges (skill_nodes + atlas_nodes.section) into the
// flat shape vacancies' resolver expects. Caches the atlas catalogue on
// first call (≤200 nodes; rebuilds at process restart) so the per-analyze
// path is one user-scoped query plus an in-memory map join.
type atlasMasteryAdapter struct {
	skills *profileInfra.Postgres
	cat    profileDomain.AtlasCatalogueRepo
	log    *slog.Logger
}

func newAtlasMasteryAdapter(skills *profileInfra.Postgres, cat profileDomain.AtlasCatalogueRepo, log *slog.Logger) *atlasMasteryAdapter {
	return &atlasMasteryAdapter{skills: skills, cat: cat, log: log}
}

func (a *atlasMasteryAdapter) ListUserSkillNodesWithSection(ctx context.Context, userID uuid.UUID) ([]vacInfra.SkillNodeMastery, error) {
	nodes, err := a.skills.ListSkillNodes(ctx, userID)
	if err != nil {
		return nil, fmt.Errorf("services.vacancies.atlasMasteryAdapter: skill_nodes: %w", err)
	}
	if len(nodes) == 0 {
		return nil, nil
	}
	cat, err := a.cat.ListNodes(ctx)
	if err != nil {
		return nil, fmt.Errorf("services.vacancies.atlasMasteryAdapter: catalogue: %w", err)
	}
	sectionByNode := make(map[string]string, len(cat))
	for _, n := range cat {
		sectionByNode[n.ID] = n.Section
	}
	out := make([]vacInfra.SkillNodeMastery, 0, len(nodes))
	for _, n := range nodes {
		sec, ok := sectionByNode[n.NodeKey]
		if !ok {
			// Skill node referencing a now-inactive catalogue row. Skip
			// silently — this is a known race during atlas re-indexing.
			continue
		}
		out = append(out, vacInfra.SkillNodeMastery{
			NodeKey:  n.NodeKey,
			Section:  sec,
			Progress: n.Progress,
		})
	}
	return out, nil
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
