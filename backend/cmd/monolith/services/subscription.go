package services

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"time"

	"druz9/shared/generated/pb/druz9/v1/druz9v1connect"
	sharedMw "druz9/shared/pkg/middleware"
	sharedpg "druz9/shared/pkg/pg"
	subApp "druz9/subscription/app"
	subDomain "druz9/subscription/domain"
	subInfra "druz9/subscription/infra"
	subPorts "druz9/subscription/ports"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
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
	usageReader := &subscriptionUsageAdapter{pool: d.Pool}
	configReader := &subscriptionConfigAdapter{pool: d.Pool}
	policyResolver := subApp.NewPolicyResolver(configReader)
	getQuotaUC := subApp.NewGetQuota(getTierUC, usageReader, policyResolver)
	quotaHandler := &quotaRestHandler{uc: getQuotaUC, log: d.Log}
	// Expose resolver via Deps так, что enforce-middleware'ы в других
	// модулях могут читать policy без дублирования логики. См. monolith
	// services/types.go (added).
	d.QuotaResolver = policyResolver
	d.QuotaTierGetter = getTierUC
	d.QuotaUsageReader = usageReader

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
			// Юзер-facing: /subscription/quota — current tier + policy +
			// usage. Используется frontend'ом для UI badges (10/10 published)
			// и upgrade-prompts при достижении лимита.
			r.Get("/subscription/quota", quotaHandler.handle)
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

// ─── Quota usage adapter ──────────────────────────────────────────────────
//
// subscriptionUsageAdapter implements `subApp.UsageReader` через прямые pgx
// queries в notes / whiteboard_rooms / editor_rooms таблицы. Чтобы
// subscription-domain не импортировал чужие infra-пакеты — все queries
// raw SQL. Это intentional cross-domain seam (та же логика что
// honeSkillAtlasAdapter в adapters.go).
//
// Counting strategy:
//   - SyncedNotes: notes принадлежащие user'у которые НЕ ephemeral
//     (Phase 5 free-tier flow: free user'овые notes хранятся в IndexedDB
//     and НЕ создают строку в notes table; create-flow гейтится middleware).
//     Pre-Phase-5 plaintext notes считаются как "synced".
//   - ActiveSharedBoards/Rooms: ownership=user_id AND visibility='shared'
//     AND not expired.
//   - AIThisMonth: пока stub'аем 0 — ai-usage log infrastructure не
//     развёрнута (см. ai_mock service). После того как добавим — заменить.

type subscriptionUsageAdapter struct {
	pool *pgxpool.Pool
}

func (a *subscriptionUsageAdapter) CountSyncedNotes(ctx context.Context, userID uuid.UUID) (int, error) {
	// hone_notes — actual table name (см. migrations/00014_hone_notes.sql).
	// Раньше тут было ошибочное `notes` → каждый /quota request падал
	// «relation \"notes\" does not exist». Free-tier фильтр (archived_at
	// IS NULL) отсекает архивные ноты — они не считаются за quota.
	const q = `SELECT count(*) FROM hone_notes WHERE user_id = $1 AND archived_at IS NULL`
	var n int
	if err := a.pool.QueryRow(ctx, q, sharedpg.UUID(userID)).Scan(&n); err != nil {
		return 0, fmt.Errorf("subscription: count synced notes: %w", err)
	}
	return n, nil
}

func (a *subscriptionUsageAdapter) CountActiveSharedBoards(ctx context.Context, userID uuid.UUID) (int, error) {
	const q = `SELECT count(*) FROM whiteboard_rooms
	            WHERE owner_id = $1
	              AND visibility = 'shared'
	              AND expires_at > now()`
	var n int
	if err := a.pool.QueryRow(ctx, q, sharedpg.UUID(userID)).Scan(&n); err != nil {
		return 0, fmt.Errorf("subscription: count active shared boards: %w", err)
	}
	return n, nil
}

func (a *subscriptionUsageAdapter) CountActiveSharedRooms(ctx context.Context, userID uuid.UUID) (int, error) {
	const q = `SELECT count(*) FROM editor_rooms
	            WHERE owner_id = $1
	              AND visibility = 'shared'
	              AND expires_at > now()`
	var n int
	if err := a.pool.QueryRow(ctx, q, sharedpg.UUID(userID)).Scan(&n); err != nil {
		return 0, fmt.Errorf("subscription: count active shared rooms: %w", err)
	}
	return n, nil
}

func (a *subscriptionUsageAdapter) CountAIThisMonth(_ context.Context, _ uuid.UUID) (int, error) {
	// AI usage log не развёрнут (см. design comment выше). Возвращаем 0
	// чтобы quota check не блокировал AI calls на Phase 1. Заменить когда
	// ai_usage_log table появится.
	return 0, nil
}

// ─── Quota REST handler ───────────────────────────────────────────────────

type quotaRestHandler struct {
	uc  *subApp.GetQuota
	log *slog.Logger
}

type quotaResponse struct {
	Tier   string         `json:"tier"`
	Policy quotaPolicyDTO `json:"policy"`
	Usage  quotaUsageDTO  `json:"usage"`
}

type quotaPolicyDTO struct {
	SyncedNotes        int   `json:"synced_notes"`
	ActiveSharedBoards int   `json:"active_shared_boards"`
	ActiveSharedRooms  int   `json:"active_shared_rooms"`
	SharedTTLSeconds   int64 `json:"shared_ttl_seconds"`
	AIMonthly          int   `json:"ai_monthly"`
}

type quotaUsageDTO struct {
	SyncedNotes        int `json:"synced_notes"`
	ActiveSharedBoards int `json:"active_shared_boards"`
	ActiveSharedRooms  int `json:"active_shared_rooms"`
	AIThisMonth        int `json:"ai_this_month"`
}

func (h *quotaRestHandler) handle(w http.ResponseWriter, r *http.Request) {
	uid, ok := sharedMw.UserIDFromContext(r.Context())
	if !ok {
		http.Error(w, `{"error":{"code":"unauthenticated"}}`, http.StatusUnauthorized)
		return
	}
	snap, err := h.uc.Do(r.Context(), uid)
	if err != nil {
		// Auth-/usage-errors → не fatal: возвращаем degraded snapshot с
		// tier=free + zero usage чтобы фронт не повис в loading state.
		// Лог имеет дело с ошибкой.
		if !errors.Is(err, context.Canceled) {
			h.log.WarnContext(r.Context(), "subscription.quota.handle", "err", err,
				"user_id", uid.String())
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(quotaResponse{
			Tier:   string(subDomain.TierFree),
			Policy: dtoFromPolicy(subDomain.Policy(subDomain.TierFree)),
			Usage:  quotaUsageDTO{},
		})
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(quotaResponse{
		Tier:   string(snap.Tier),
		Policy: dtoFromPolicy(snap.Policy),
		Usage: quotaUsageDTO{
			SyncedNotes:        snap.Usage.SyncedNotes,
			ActiveSharedBoards: snap.Usage.ActiveSharedBoards,
			ActiveSharedRooms:  snap.Usage.ActiveSharedRooms,
			AIThisMonth:        snap.Usage.AIThisMonth,
		},
	})
}

func dtoFromPolicy(p subDomain.QuotaPolicy) quotaPolicyDTO {
	return quotaPolicyDTO{
		SyncedNotes:        p.SyncedNotes,
		ActiveSharedBoards: p.ActiveSharedBoards,
		ActiveSharedRooms:  p.ActiveSharedRooms,
		SharedTTLSeconds:   int64(p.SharedTTL / time.Second),
		AIMonthly:          p.AIMonthly,
	}
}

// ─── Dynamic config adapter ───────────────────────────────────────────────
//
// Реализует subApp.ConfigReader через прямой SELECT в `dynamic_config`.
// Cross-domain seam (subscription не импортирует admin-domain).
type subscriptionConfigAdapter struct {
	pool *pgxpool.Pool
}

func (a *subscriptionConfigAdapter) GetConfig(ctx context.Context, key string) (string, error) {
	const q = `SELECT value FROM dynamic_config WHERE key = $1`
	var raw string
	err := a.pool.QueryRow(ctx, q, key).Scan(&raw)
	if err != nil {
		// Row missing → empty string + nil error. Resolver fallback'ает на
		// hardcoded defaults в этом случае.
		return "", nil
	}
	return raw, nil
}
