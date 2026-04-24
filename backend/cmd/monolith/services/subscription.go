package services

import (
	"context"
	"time"

	"druz9/shared/generated/pb/druz9/v1/druz9v1connect"
	subApp "druz9/subscription/app"
	subDomain "druz9/subscription/domain"
	subInfra "druz9/subscription/infra"
	subPorts "druz9/subscription/ports"
)

// NewSubscription wires the centralised subscription-domain.
//
// Responsibilities:
//   - source of truth для (user_id → tier + expiry)
//   - Connect-RPC SubscriptionService (REST /api/v1/subscription/tier +
//     admin POST /api/v1/admin/subscriptions/set-tier)
//   - background cron-tick раз в час → MarkExpired (chills истёкшие
//     записи чтобы ListActive был корректен)
//
// НЕ подключает Boosty/ЮKassa adapter'ы — это M3. Пока можно выдавать
// подписки только вручную через admin-endpoint.
func NewSubscription(d Deps) *Module {
	pg := subInfra.NewPostgres(d.Pool)
	clk := subDomain.RealClock{}

	getTierUC := subApp.NewGetTier(pg, clk)
	setTierUC := subApp.NewSetTier(pg, clk, d.Log)

	server := subPorts.NewSubscriptionServer(getTierUC, setTierUC, d.Log)
	connectPath, connectHandler := druz9v1connect.NewSubscriptionServiceHandler(server)
	transcoder := mustTranscode("subscription", connectPath, connectHandler)

	return &Module{
		ConnectPath:        connectPath,
		ConnectHandler:     transcoder,
		RequireConnectAuth: true,
		// MountREST не нужен — все REST-пути (GET /subscription/tier, POST
		// /admin/subscriptions/set-tier) приходят через transcoder от
		// аннотаций google.api.http в proto.
		Background: []func(ctx context.Context){
			// Cron MarkExpired: раз в час, сдвиг 7 мин чтобы не совпадал с
			// большинством других таймеров (reduces contention).
			func(ctx context.Context) {
				go func() {
					t := time.NewTicker(time.Hour)
					defer t.Stop()
					// Первый tick сразу после старта — обработать то, что
					// накопилось пока мы были down.
					_, err := pg.MarkExpired(ctx, clk.Now())
					if err != nil {
						d.Log.WarnContext(ctx, "subscription.cron.MarkExpired: initial tick",
							"err", err)
					}
					for {
						select {
						case <-ctx.Done():
							return
						case <-t.C:
							n, err := pg.MarkExpired(ctx, clk.Now())
							if err != nil {
								d.Log.WarnContext(ctx, "subscription.cron.MarkExpired",
									"err", err)
								continue
							}
							if n > 0 {
								d.Log.InfoContext(ctx, "subscription.cron.MarkExpired",
									"affected", n)
							}
						}
					}
				}()
			},
		},
	}
}
