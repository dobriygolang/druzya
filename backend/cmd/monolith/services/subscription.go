package services

import (
	"context"
	"log/slog"
	"time"

	"druz9/shared/generated/pb/druz9/v1/druz9v1connect"
	subApp "druz9/subscription/app"
	subDomain "druz9/subscription/domain"
	subInfra "druz9/subscription/infra"
	subPorts "druz9/subscription/ports"

	"github.com/go-chi/chi/v5"
)

// NewSubscription wires the centralised subscription-domain.
//
// Responsibilities:
//   - source of truth для (user_id → tier + expiry)
//   - Connect-RPC SubscriptionService (GET /subscription/tier,
//     admin POST /admin/subscriptions/set-tier)
//   - Boosty-link REST + sync worker (M3). Активируется только при
//     BOOSTY_ACCESS_TOKEN+BOOSTY_BLOG_SLUG выставленных. При отсутствии —
//     tier выставляется только через admin-endpoint (как в M1-M2).
//   - Background cron MarkExpired (раз в час).
//   - Background sync Boosty (раз в 30 мин, если credentials есть).
func NewSubscription(d Deps) *Module {
	pg := subInfra.NewPostgres(d.Pool)
	linkRepo := subInfra.NewLinkPostgres(d.Pool)
	clk := subDomain.RealClock{}

	getTierUC := subApp.NewGetTier(pg, clk)
	setTierUC := subApp.NewSetTier(pg, clk, d.Log)
	linkBoostyUC := subApp.NewLinkBoosty(linkRepo, clk, d.Log)

	server := subPorts.NewSubscriptionServer(getTierUC, setTierUC, d.Log)
	connectPath, connectHandler := druz9v1connect.NewSubscriptionServiceHandler(server)
	transcoder := mustTranscode("subscription", connectPath, connectHandler)

	// Boosty sync: optional — только если оператор выставил credentials.
	boostyClient := subInfra.NewBoostyClient(subInfra.BoostyClientConfig{
		AccessToken: d.Cfg.Subscription.BoostyAccessToken,
		BlogSlug:    d.Cfg.Subscription.BoostyBlogSlug,
	})
	var syncUC *subApp.SyncBoosty
	if boostyClient != nil {
		src := subInfra.NewBoostySourceAdapter(boostyClient)
		tierMap := subApp.ParseTierMapping(d.Cfg.Subscription.BoostyTierMapping)
		if len(tierMap) == 0 {
			d.Log.Warn("subscription.boosty: BOOSTY_TIER_MAPPING empty — sync will skip all " +
				"(укажи формат 'Поддержка:seeker,Вознёсшийся:ascendant')")
		}
		syncUC = subApp.NewSyncBoosty(src, linkRepo, setTierUC, tierMap, d.Log)
	}
	boostyHandler := subPorts.NewBoostyHandler(linkBoostyUC, syncUC, d.Log)

	return &Module{
		ConnectPath:        connectPath,
		ConnectHandler:     transcoder,
		RequireConnectAuth: true,
		MountREST: func(r chi.Router) {
			// Юзер-facing: /subscription/boosty/link — привязать свой
			// boosty_username. Требует auth (bearer), admin не нужен.
			r.Post("/subscription/boosty/link", boostyHandler.HandleLink)
			// Admin-facing: ручной триггер sync'а (когда cron не хочется ждать).
			r.Post("/admin/subscriptions/boosty/sync", boostyHandler.HandleAdminSync)
		},
		Background: []func(ctx context.Context){
			// Cron MarkExpired: раз в час. Первый tick сразу после старта —
			// догоняем то, что накопилось пока мы были down.
			func(ctx context.Context) {
				go runMarkExpired(ctx, pg, clk, d.Log)
			},
			// Boosty sync: раз в 30 мин. Только если syncUC != nil
			// (credentials выставлены).
			func(ctx context.Context) {
				if syncUC == nil {
					d.Log.Info("subscription.boosty: sync worker disabled — " +
						"set BOOSTY_ACCESS_TOKEN+BOOSTY_BLOG_SLUG to enable")
					return
				}
				go runBoostySync(ctx, syncUC, d.Log)
			},
		},
	}
}

// runMarkExpired — выделен в функцию чтобы в main closure не было пирамиды.
func runMarkExpired(ctx context.Context, pg *subInfra.Postgres, clk subDomain.Clock, log *slog.Logger) {
	t := time.NewTicker(time.Hour)
	defer t.Stop()
	// Initial tick.
	if _, err := pg.MarkExpired(ctx, clk.Now()); err != nil {
		log.WarnContext(ctx, "subscription.cron.MarkExpired: initial", "err", err)
	}
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			n, err := pg.MarkExpired(ctx, clk.Now())
			if err != nil {
				log.WarnContext(ctx, "subscription.cron.MarkExpired", "err", err)
				continue
			}
			if n > 0 {
				log.InfoContext(ctx, "subscription.cron.MarkExpired", "affected", n)
			}
		}
	}
}

// runBoostySync — 30-мин cron. Первый tick через 2 мин (даёт api и Boosty
// прогреться после деплоя). При ошибках продолжает цикл — единичные сбои
// Boosty не должны killить worker.
func runBoostySync(ctx context.Context, uc *subApp.SyncBoosty, log *slog.Logger) {
	warmup := time.NewTimer(2 * time.Minute)
	defer warmup.Stop()
	select {
	case <-ctx.Done():
		return
	case <-warmup.C:
	}

	t := time.NewTicker(30 * time.Minute)
	defer t.Stop()
	// First real tick сразу после warmup.
	if _, err := uc.Do(ctx); err != nil {
		log.WarnContext(ctx, "subscription.cron.BoostySync: initial", "err", err)
	}
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			if _, err := uc.Do(ctx); err != nil {
				log.WarnContext(ctx, "subscription.cron.BoostySync", "err", err)
			}
		}
	}
}
