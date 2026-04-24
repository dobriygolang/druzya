package app

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"druz9/shared/enums"
	"druz9/subscription/domain"
)

// BoostySource — порт для чтения подписчиков у Boosty. Мокабельный: в prod
// — реальный BoostyClient (infra), в тестах — fake.
type BoostySource interface {
	ListSubscribers(ctx context.Context, limit int) ([]BoostySubscriberSnapshot, error)
}

// BoostySubscriberSnapshot — доменная проекция одной записи у Boosty.
// Независим от infra.BoostySubscriber чтобы app-слой не зависел от HTTP-layer'а.
type BoostySubscriberSnapshot struct {
	SubscriberID string
	Username     string
	TierName     string
	ExpiresAt    *time.Time
	IsActive     bool
}

// SyncBoosty — периодический worker, подтягивающий актуальные tier'ы из
// Boosty в нашу БД subscriptions. Вызывается background-cron'ом в
// cmd/monolith/services/subscription.go с интервалом ~30 мин.
//
// Флоу:
//  1. GET список subscriber'ов блога через BoostySource.
//  2. Для каждого: резолвим boosty_username → наш user_id через LinkRepo.
//     Если link нет — skip (юзер не привязал Boosty в Settings).
//  3. Маппим TierName → domain.Tier через TierMapping (env-config).
//  4. SetTierUC.Do(...) — idempotent upsert в subscriptions с
//     provider='boosty', provider_sub_id=SubscriberID, CPE=ExpiresAt.
//  5. Если !IsActive — ставим Status='cancelled' (grace_until сохранится
//     на 24ч вперёд через SetTier, после чего MarkExpired-cron снимет).
type SyncBoosty struct {
	Source      BoostySource
	Links       domain.LinkRepo
	SetTierUC   *SetTier
	TierMapping map[string]domain.Tier // Boosty level name → our Tier
	Log         *slog.Logger
}

// NewSyncBoosty — конструктор.
func NewSyncBoosty(src BoostySource, links domain.LinkRepo, setTier *SetTier,
	tierMap map[string]domain.Tier, log *slog.Logger) *SyncBoosty {
	if log == nil {
		panic("subscription.NewSyncBoosty: logger is required")
	}
	return &SyncBoosty{
		Source: src, Links: links, SetTierUC: setTier,
		TierMapping: tierMap, Log: log,
	}
}

// SyncResult — агрегаты одного run'а sync'а для наблюдаемости.
type SyncResult struct {
	TotalFetched   int
	MatchedUsers   int
	Upserted       int
	SkippedNoLink  int
	SkippedBadTier int
	Errors         int
}

// Do выполняет один tick sync'а. Возвращает агрегаты и error только при
// критичном сбое (полный отказ Source), чтобы cron не сыпал warn'ами в
// Grafana на одиночные проваленные записи.
func (uc *SyncBoosty) Do(ctx context.Context) (SyncResult, error) {
	if uc.Source == nil {
		return SyncResult{}, fmt.Errorf("subscription.SyncBoosty: source not configured")
	}
	subs, err := uc.Source.ListSubscribers(ctx, 1000)
	if err != nil {
		return SyncResult{}, fmt.Errorf("subscription.SyncBoosty: list: %w", err)
	}

	res := SyncResult{TotalFetched: len(subs)}
	for _, s := range subs {
		uid, linkErr := uc.Links.FindUserByExternalID(ctx, domain.ProviderBoosty, s.Username)
		if linkErr != nil {
			if errors.Is(linkErr, domain.ErrNotFound) {
				res.SkippedNoLink++
				continue
			}
			uc.Log.WarnContext(ctx, "subscription.sync.boosty: find link failed",
				slog.String("username", s.Username), slog.Any("err", linkErr))
			res.Errors++
			continue
		}
		res.MatchedUsers++

		tier, ok := uc.TierMapping[s.TierName]
		if !ok {
			// Попробуем case-insensitive match (Boosty иногда возвращает
			// с заглавной, иногда не, мапа от оператора может быть с one-case).
			tier, ok = uc.TierMapping[strings.ToLower(s.TierName)]
		}
		if !ok {
			uc.Log.InfoContext(ctx, "subscription.sync.boosty: unknown tier name — skipping",
				slog.String("username", s.Username),
				slog.String("boosty_tier", s.TierName))
			res.SkippedBadTier++
			continue
		}

		// Деактивированные подписки (on_pause) — попадают в наш БД с Status=active
		// но с пределом current_period_end. MarkExpired-cron позже их пропишет
		// как expired когда grace пройдёт. Это правильно: пользователь на pause
		// всё ещё имеет время до конца оплаченного периода.
		if !s.IsActive {
			// Для paused без expiresAt — нет смысла записывать; degrade сразу.
			if s.ExpiresAt == nil || s.ExpiresAt.Before(time.Now().UTC()) {
				// Ничего не пишем — MarkExpired через grace разберётся.
				res.SkippedBadTier++
				continue
			}
		}

		setErr := uc.SetTierUC.Do(ctx, SetTierInput{
			UserID:           uid,
			Tier:             tier,
			Provider:         domain.ProviderBoosty,
			ProviderSubID:    s.SubscriberID,
			CurrentPeriodEnd: s.ExpiresAt,
			Reason:           "boosty_sync",
		})
		if setErr != nil {
			uc.Log.WarnContext(ctx, "subscription.sync.boosty: set tier failed",
				slog.String("user_id", uid.String()), slog.Any("err", setErr))
			res.Errors++
			continue
		}

		// Отмечаем link verified.
		linkUpdateErr := uc.Links.Upsert(ctx, domain.ProviderLink{
			UserID:       uid,
			Provider:     domain.ProviderBoosty,
			ExternalID:   s.Username,
			ExternalTier: s.TierName,
			VerifiedAt:   ptrNow(),
		})
		if linkUpdateErr != nil {
			uc.Log.WarnContext(ctx, "subscription.sync.boosty: update link verified failed",
				slog.Any("err", linkUpdateErr))
			// Не инкрементим Errors — основной upsert прошёл
		}
		res.Upserted++
	}

	uc.Log.InfoContext(ctx, "subscription.sync.boosty: done",
		slog.Int("total_fetched", res.TotalFetched),
		slog.Int("matched", res.MatchedUsers),
		slog.Int("upserted", res.Upserted),
		slog.Int("no_link", res.SkippedNoLink),
		slog.Int("bad_tier", res.SkippedBadTier),
		slog.Int("errors", res.Errors),
	)
	return res, nil
}

func ptrNow() *time.Time {
	t := time.Now().UTC()
	return &t
}

// ParseTierMapping — helper для конфига: env-строка формата
// "Поддержка:seeker,Вознёсшийся:ascendant" → map[string]Tier.
func ParseTierMapping(s string) map[string]domain.Tier {
	m := make(map[string]domain.Tier)
	if strings.TrimSpace(s) == "" {
		return m
	}
	for _, pair := range strings.Split(s, ",") {
		kv := strings.SplitN(pair, ":", 2)
		if len(kv) != 2 {
			continue
		}
		k := strings.TrimSpace(kv[0])
		v := strings.TrimSpace(strings.ToLower(kv[1]))
		var tier domain.Tier
		switch v {
		case "free":
			tier = enums.SubscriptionPlanFree
		case "seeker":
			tier = enums.SubscriptionPlanSeeker
		case "ascendant", "ascended":
			tier = enums.SubscriptionPlanAscendant
		default:
			continue
		}
		if k != "" {
			m[k] = tier
		}
	}
	return m
}
