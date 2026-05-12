package subscription

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"log/slog"
	"os"
	"time"

	monolithServices "druz9/cmd/monolith/services"
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
//
// WireSubscriptionQuota — pre-wire'ит QuotaResolver / TierGetter / UsageReader
// в *Deps ДО того как другие модули (Hone / Editor / Whiteboard) захватят
// замыкания над `Deps`. Раньше это делалось внутри `NewSubscription(d Deps)`,
// но `Deps` передавался by-value → модификации `d.QuotaResolver = ...`
// влияли только на subscription'ову локальную копию, а Hone/Editor/Whiteboard
// уже были инициализированы РАНЬШЕ с `nil` в этих полях → их закрытия
// возвращали nil → EnforceCreate'ы fall-through'или в permissive ветку
// (`return nil // permissive`) → юзер мог создавать notes/rooms/boards
// бесконечно за пределы лимита. Cosmetic UI ("OVER LIMIT") работал, гейты
// — нет. Сейчас это вызывается из bootstrap'а ПЕРВЫМ, через pointer на
// shared deps, так что все последующие NewX(deps) видят правильные не-nil
// поля.
func WireSubscriptionQuota(d *monolithServices.Deps) {
	pg := subInfra.NewPostgres(d.Pool)
	clk := subDomain.RealClock{}
	getTierUC := subApp.NewGetTier(pg, clk)
	setTierUC := subApp.NewSetTier(pg, clk, d.Log)
	usageReader := subInfra.NewQuotaUsageRepo(d.Pool)
	configReader := subInfra.NewDynConfigRepo(d.Pool)
	policyResolver := subApp.NewPolicyResolver(configReader)
	d.QuotaResolver = policyResolver
	d.QuotaTierGetter = getTierUC
	d.QuotaUsageReader = usageReader
	// SetTierUC заранее, чтобы NewCopilot мог set'нуть OnTierChanged hook
	// (subscription.plan меняется → copilot_quotas.plan flip'ается).
	d.SetTierUC = setTierUC
	// Phase J / X1 (P0) — first-install trial Pro granter. Wired here so
	// NewProfile downstream can attach it to the RecordAppInstall UC.
	d.TrialProGranter = subApp.NewGrantFirstInstallTrial(pg, clk, d.Log)
}

func NewSubscription(d monolithServices.Deps) *monolithServices.Module {
	pg := subInfra.NewPostgres(d.Pool)
	clk := subDomain.RealClock{}

	getTierUC := subApp.NewGetTier(pg, clk)
	// Reuse pre-wired SetTier (см. WireSubscriptionQuota) если он есть,
	// чтобы OnTierChanged hook'и которые набросали другие модули
	// (NewCopilot et al.) сохранялись.
	setTierUC := d.SetTierUC
	if setTierUC == nil {
		setTierUC = subApp.NewSetTier(pg, clk, d.Log)
	}
	usageReader := subInfra.NewQuotaUsageRepo(d.Pool)
	configReader := subInfra.NewDynConfigRepo(d.Pool)
	policyResolver := subApp.NewPolicyResolver(configReader)
	getQuotaUC := subApp.NewGetQuota(getTierUC, usageReader, policyResolver)
	d.QuotaResolver = policyResolver
	d.QuotaTierGetter = getTierUC
	d.QuotaUsageReader = usageReader

	server := subPorts.NewSubscriptionServer(getTierUC, setTierUC, d.Log)
	server.GetQuotaUC = getQuotaUC
	// Stream-C wiring: BYOK + CheckTier. Encryption key обязателен — если
	// env var пустой, генерируем ephemeral key с warning'ом (рестарт
	// инвалидирует все ранее сохранённые BYOK ключи). Это failsafe для
	// local-dev / preview deploy'ев; prod должен иметь stable secret.
	byokRepo := subInfra.NewBYOKRepo(d.Pool)
	byokSecret := os.Getenv("BYOK_ENCRYPTION_KEY")
	if byokSecret == "" {
		buf := make([]byte, 32)
		if _, err := rand.Read(buf); err == nil {
			byokSecret = hex.EncodeToString(buf)
			d.Log.Warn("subscription.byok: BYOK_ENCRYPTION_KEY env пуст — using ephemeral key. Previously stored BYOK keys won't decrypt across restarts. Set BYOK_ENCRYPTION_KEY in production.")
		}
	}
	encryptor, encErr := subInfra.NewBYOKEncryptor(byokSecret)
	if encErr != nil {
		d.Log.Error("subscription.byok: encryptor init failed; BYOK endpoints will return 503", "err", encErr)
	}
	validator := subInfra.NewBYOKValidator()
	if encryptor != nil {
		setBYOKKeyUC := subApp.NewSetBYOKKey(byokRepo, encryptor, validator, clk, d.Log)
		removeBYOKKeyUC := subApp.NewRemoveBYOKKey(byokRepo, d.Log)
		// Tutor checker — пока nil (опт-in: подключим когда tutor-service
		// эксп export'нёт IsTutor adapter). CheckTier работает без него,
		// просто source='tutor' не вернётся.
		checkTierUC := subApp.NewCheckTier(getTierUC, byokRepo, nil)
		server.SetBYOKKeyUC = setBYOKKeyUC
		server.RemoveBYOKKeyUC = removeBYOKKeyUC
		server.CheckTierUC = checkTierUC
	}

	// Stream-C Stripe MVP wiring. Все три env'а обязательны для full flow:
	//   STRIPE_SECRET_KEY            → API auth (sk_test_... / sk_live_...)
	//   STRIPE_WEBHOOK_SECRET        → HMAC verification (whsec_...)
	//   STRIPE_PRICE_ID_PRO_MONTHLY  → конкретный price object в Stripe Dashboard
	// При пустом любом — server.CreateCheckoutSessionUC / CancelSubscriptionUC
	// остаются nil → endpoints возвращают Unavailable. Webhook handler тоже
	// nil → POST /stripe-webhook вернёт 503.
	var stripeWebhook *subPorts.StripeWebhookHandler
	stripeSecret := os.Getenv("STRIPE_SECRET_KEY")
	stripeWebhookSecret := os.Getenv("STRIPE_WEBHOOK_SECRET")
	stripePriceID := os.Getenv("STRIPE_PRICE_ID_PRO_MONTHLY")
	if stripeSecret != "" && stripeWebhookSecret != "" && stripePriceID != "" {
		stripeClient := subInfra.NewStripeClient(stripeSecret, stripeWebhookSecret)
		stripeRepo := subInfra.NewStripeRepo(d.Pool)
		createCheckoutUC := subApp.NewCreateCheckoutSession(stripeRepo, stripeClient, stripePriceID, d.Log)
		cancelSubUC := subApp.NewCancelSubscription(stripeRepo, stripeClient, d.Log)
		webhookUC := subApp.NewHandleWebhookEvent(stripeRepo, stripeClient, setTierUC, d.Log)
		server.CreateCheckoutSessionUC = createCheckoutUC
		server.CancelSubscriptionUC = cancelSubUC
		stripeWebhook = subPorts.NewStripeWebhookHandler(webhookUC, d.Log)
		d.Log.Info("subscription.stripe: wired with price_id=" + stripePriceID)
	} else {
		d.Log.Warn("subscription.stripe: env vars пусты (STRIPE_SECRET_KEY / STRIPE_WEBHOOK_SECRET / STRIPE_PRICE_ID_PRO_MONTHLY) — Stripe endpoints отключены")
	}
	connectPath, connectHandler := druz9v1connect.NewSubscriptionServiceHandler(server)
	transcoder := monolithServices.MustTranscode("subscription", connectPath, connectHandler)
	// Pivot 2026-05-01: Boosty sync worker / LinkBoosty UC удалены вместе
	// с marketplace.

	return &monolithServices.Module{
		ConnectPath:        connectPath,
		ConnectHandler:     transcoder,
		RequireConnectAuth: true,
		MountREST: func(r chi.Router) {
			// Pivot 2026-05-01: Boosty marketplace выпилен. /subscription/
			// boosty/link и /admin/subscriptions/boosty/sync REST-aliases
			// удалены; proto RPCs LinkBoosty/AdminBoostySync остаются до
			// планового regen-cleanup'а.
			r.Get("/subscription/quota", transcoder.ServeHTTP)
			r.Post("/admin/subscriptions/set-tier", transcoder.ServeHTTP)
			// Stream-C BYOK + tier-info aliases. Connect-path всегда
			// доступен; REST даёт удобный API для curl/MSW моков.
			r.Get("/subscription/tier-info", transcoder.ServeHTTP)
			r.Post("/subscription/byok", transcoder.ServeHTTP)
			r.Delete("/subscription/byok", transcoder.ServeHTTP)
			// Stream-C Stripe MVP. POST /checkout создаёт Stripe Session;
			// POST /cancel — cancel_at_period_end. Authenticated.
			r.Post("/subscription/checkout", transcoder.ServeHTTP)
			r.Post("/subscription/cancel", transcoder.ServeHTTP)
		},
		MountPublicREST: func(r chi.Router) {
			// Stripe webhook — public POST, signature-verified внутри handler'а.
			// Mounted в MountPublicREST потому что Stripe не отправит JWT.
			if stripeWebhook != nil {
				r.Post("/subscription/stripe-webhook", stripeWebhook.ServeHTTP)
			}
		},
		Background: []func(ctx context.Context){
			// Cron MarkExpired: раз в час. Первый tick сразу после старта —
			// догоняем то, что накопилось пока мы были down.
			func(ctx context.Context) {
				go runMarkExpired(ctx, pg, clk, d.Log)
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
