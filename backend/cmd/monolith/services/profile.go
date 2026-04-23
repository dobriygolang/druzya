package services

import (
	"context"
	"fmt"
	"os"

	profileApp "druz9/profile/app"
	profileInfra "druz9/profile/infra"
	profilePorts "druz9/profile/ports"
	sharedDomain "druz9/shared/domain"
	"druz9/shared/generated/pb/druz9/v1/druz9v1connect"
	"druz9/shared/pkg/eventbus"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
)

// insightGeneratorAdapter bridges app.InsightGenerator → infra.InsightClient.
// Lives in the wirer (not in app/) so the app layer never imports infra,
// preserving the inward dependency direction.
type insightGeneratorAdapter struct{ c *profileInfra.InsightClient }

func (a insightGeneratorAdapter) Generate(
	ctx context.Context, uid uuid.UUID, p profileApp.InsightPayload,
) (string, error) {
	out, err := a.c.Generate(ctx, uid, profileInfra.InsightPayload{
		WeekISO:           p.WeekISO,
		EloDelta:          p.EloDelta,
		WinRateBySection:  p.WinRateBySection,
		HoursStudied:      p.HoursStudied,
		Streak:            p.Streak,
		WeakestSection:    p.WeakestSection,
		AchievementsCount: p.AchievementsCount,
		Model:             p.Model,
	})
	if err != nil {
		return "", fmt.Errorf("profile.insightAdapter: %w", err)
	}
	return out, nil
}

// NewProfile wires the profile bounded context plus its three cross-domain
// reactors (UserRegistered → bootstrap, XPGained → level up, RatingChanged
// → atlas refresh).
//
// Read paths are wrapped in a Redis read-through cache (CachedRepo). Writes
// flow through the same wrapper so invalidation happens automatically: every
// XP delta, career-stage update, settings update, or EnsureDefaults call
// busts the cached bundle for that user. Event handlers receive the cached
// repo for the same reason.
func NewProfile(d Deps) *Module {
	pg := profileInfra.NewPostgres(d.Pool)
	kv := profileInfra.NewRedisKV(d.Redis)
	atlasCat := profileInfra.NewAtlasCataloguePostgres(d.Pool)
	cached := profileInfra.NewCachedRepo(
		pg,
		kv,
		profileInfra.DefaultProfileCacheTTL,
		d.Log,
	)
	// ── Phase B: AI insight ────────────────────────────────────────────────
	//
	// Build an InsightClient backed by OpenRouter. When OPENROUTER_API_KEY is
	// empty the client self-disables (Generate returns "" + nil) and the
	// frontend hides the section — anti-fallback policy in action: NO faked
	// LLM output, the operator sees the WARN at startup.
	//
	// OPENROUTER_INSIGHT_MODEL allows overriding the model id without a
	// rebuild; default is anthropic/claude-sonnet-4 for narrative quality.
	insightModel := os.Getenv("OPENROUTER_INSIGHT_MODEL")
	insightClient := profileInfra.NewInsightClient(
		nil, d.Cfg.LLM.OpenRouterAPIKey, insightModel, d.Log,
	).WithKV(kv)
	getReport := &profileApp.GetReport{
		Repo:    cached,
		Insight: insightGeneratorAdapter{c: insightClient},
		Log:     d.Log,
	}
	// /profile/me/report — собирает несколько SQL-агрегатов; отдельный 5-мин
	// Redis-кеш окупается при любой нагрузке. Инвалидация ниже триггерится
	// событиями MatchCompleted / XPGained.
	reportCache := profileInfra.NewReportCache(
		getReport.Do, kv, profileInfra.DefaultReportCacheTTL, d.Log,
	)
	h := profilePorts.NewHandler(profilePorts.Handler{
		GetProfile:     &profileApp.GetProfile{Repo: cached},
		GetPublic:      &profileApp.GetPublic{Repo: cached},
		GetAtlas:       &profileApp.GetAtlas{Repo: cached, Catalogue: atlasCat},
		GetReport:      getReport,
		GetSettings:    &profileApp.GetSettings{Repo: cached},
		UpdateSettings: &profileApp.UpdateSettings{Repo: cached},
		ReportFetcher:  reportCache,
		Repo:           cached,
		Log:            d.Log,
	})
	server := profilePorts.NewProfileServer(h)

	// Atlas admin CMS — chi-direct, mirrors podcast/ports/cms_handler.go.
	// Bearer auth at the router gate; admin role enforced inside the
	// handler (see AtlasAdminHandler.requireAdmin).
	atlasAdmin := profilePorts.NewAtlasAdminHandler(atlasCat, d.Log)

	onUserRegistered := &profileApp.OnUserRegistered{Repo: cached, Log: d.Log}
	onXPGained := &profileApp.OnXPGained{Repo: cached, Bus: d.Bus, Log: d.Log}
	onRatingChanged := &profileApp.OnRatingChanged{Repo: cached, Log: d.Log}

	connectPath, connectHandler := druz9v1connect.NewProfileServiceHandler(server)
	transcoder := mustTranscode("profile", connectPath, connectHandler)

	return &Module{
		ConnectPath:        connectPath,
		ConnectHandler:     transcoder,
		RequireConnectAuth: true,
		MountREST: func(r chi.Router) {
			r.Get("/profile/me", transcoder.ServeHTTP)
			r.Get("/profile/me/atlas", transcoder.ServeHTTP)
			r.Get("/profile/me/report", transcoder.ServeHTTP)
			r.Put("/profile/me/settings", transcoder.ServeHTTP)
			// /profile/weekly/share/{token} — публичный, авторизация не нужна;
			// REST gate пропускает по publicPaths-prefix /profile/weekly/share/.
			r.Get("/profile/weekly/share/{token}", transcoder.ServeHTTP)
			r.Get("/profile/{username}", transcoder.ServeHTTP)

			// Admin Atlas CMS — chi-direct, JSON only.
			r.Get("/admin/atlas/nodes", atlasAdmin.HandleListNodes)
			r.Post("/admin/atlas/nodes", atlasAdmin.HandleCreateNode)
			r.Put("/admin/atlas/nodes/{id}", atlasAdmin.HandleUpdateNode)
			r.Patch("/admin/atlas/nodes/{id}/position", atlasAdmin.HandleUpdatePosition)
			r.Delete("/admin/atlas/nodes/{id}", atlasAdmin.HandleDeleteNode)
			r.Get("/admin/atlas/edges", atlasAdmin.HandleListEdges)
			r.Post("/admin/atlas/edges", atlasAdmin.HandleCreateEdge)
			r.Delete("/admin/atlas/edges/{id}", atlasAdmin.HandleDeleteEdge)
		},
		Subscribers: []func(*eventbus.InProcess){
			func(b *eventbus.InProcess) {
				b.Subscribe(sharedDomain.UserRegistered{}.Topic(), onUserRegistered.Handle)
				b.Subscribe(sharedDomain.XPGained{}.Topic(), onXPGained.Handle)
				b.Subscribe(sharedDomain.RatingChanged{}.Topic(), onRatingChanged.Handle)
				// Invalidate cached weekly report when underlying activity
				// changes — match end или прирост XP/level. Без этого фронт
				// видел бы 5-минутный устаревший отчёт после нового матча.
				b.Subscribe(sharedDomain.MatchCompleted{}.Topic(), func(ctx context.Context, e sharedDomain.Event) error {
					ev, ok := e.(sharedDomain.MatchCompleted)
					if !ok {
						return nil
					}
					reportCache.Invalidate(ctx, ev.WinnerID)
					for _, l := range ev.LoserIDs {
						reportCache.Invalidate(ctx, l)
					}
					return nil
				})
				b.Subscribe(sharedDomain.XPGained{}.Topic(), func(ctx context.Context, e sharedDomain.Event) error {
					ev, ok := e.(sharedDomain.XPGained)
					if !ok {
						return nil
					}
					reportCache.Invalidate(ctx, ev.UserID)
					return nil
				})
			},
		},
	}
}
