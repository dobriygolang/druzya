// get_checkout_session.go — verify endpoint для /billing/welcome.
//
// Flow:
//   1. фронт после Stripe-redirect'а на /billing/welcome?session_id=cs_test_...
//      вызывает RPC с session_id из URL query;
//   2. UC сначала чекает Redis (60s TTL) — session immutable, повторные
//      hit'ы не дёргают Stripe;
//   3. miss → Stripe RetrieveCheckoutSession → parse → cache в Redis;
//   4. возвращает {paid, tier, amount_paid, currency, period_end, email}.
//
// Edge cases:
//   - session_id пуст → ErrInvalidArgument (caller возвращает 400);
//   - Stripe 404 → ErrNotFound (caller возвращает NotFound / 404);
//   - Stripe API failure → wrap в ErrStripeAPI (caller возвращает Unavailable);
//   - session валидна но client_reference_id ≠ JWT user_id → возвращаем
//     данные без tier гарантии (фронт всё равно покажет welcome, real
//     tier придёт через webhook). Это нужно потому что юзер мог открыть
//     /billing/welcome не залогиненным (Stripe сохраняет session, юзер
//     потом авторизуется на нашей стороне).
//
// Цель caching'а — снизить нагрузку при F5 / двойной mount react-strict-mode:
// каждый раз стучаться к Stripe бессмысленно (session immutable, payment
// status может перейти только pending→paid один раз).
package app

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"druz9/subscription/domain"

	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
)

// GetCheckoutSession — verify-UC. Использует Stripe RetrieveCheckoutSession
// + Redis cache 60s. Если Repo доступен и SubscriptionID известен — резолвит
// period_end из локального snapshot'а Stripe subscription'а (webhook
// поставил после checkout.session.completed).
type GetCheckoutSession struct {
	Client domain.StripeClient
	Repo   domain.StripeRepo
	// Redis опционален. nil → каждый запрос идёт в Stripe.
	Redis *redis.Client
	Log   *slog.Logger
	// CacheTTL — длительность Redis cache'а. 60s по умолчанию.
	CacheTTL time.Duration
}

// NewGetCheckoutSession — конструктор.
func NewGetCheckoutSession(client domain.StripeClient, repo domain.StripeRepo, rdb *redis.Client, log *slog.Logger) *GetCheckoutSession {
	if log == nil {
		panic("subscription.NewGetCheckoutSession: logger is required")
	}
	return &GetCheckoutSession{
		Client:   client,
		Repo:     repo,
		Redis:    rdb,
		Log:      log,
		CacheTTL: 60 * time.Second,
	}
}

// GetCheckoutSessionInput — input.
type GetCheckoutSessionInput struct {
	SessionID string
	// RequesterUserID — user из JWT. Используется для верификации что
	// session принадлежит этому юзеру (client_reference_id matches). Если
	// uuid.Nil — пропускаем check (e.g. /billing/welcome открыли без auth'а
	// — мы всё равно показываем welcome без сильных гарантий).
	RequesterUserID uuid.UUID
}

// GetCheckoutSessionOutput — output.
type GetCheckoutSessionOutput struct {
	Paid          bool
	Tier          string
	AmountPaid    int64
	Currency      string
	PeriodEnd     *time.Time
	CustomerEmail string
	// OwnerUserID — parsed client_reference_id (uuid.Nil if absent/unparseable).
	// Ports layer uses this to enforce a hard ownership check.
	OwnerUserID uuid.UUID
}

// cachePayload — JSON-сериализуемая копия output'а для Redis.
type cachePayload struct {
	Paid          bool   `json:"paid"`
	Tier          string `json:"tier"`
	AmountPaid    int64  `json:"amount_paid"`
	Currency      string `json:"currency"`
	PeriodEndUnix int64  `json:"period_end_unix"` // 0 = nil
	CustomerEmail string `json:"customer_email"`
	OwnerUserID   string `json:"owner_user_id,omitempty"`
}

// cacheKey — Redis key. Session-id immutable, scoped по session — owner-проверка
// делается на каждом hit'е (cache не содержит user-binding'а).
func (uc *GetCheckoutSession) cacheKey(sessionID string) string {
	return "subscription:checkout-session:v1:" + sessionID
}

// Do — main flow.
func (uc *GetCheckoutSession) Do(ctx context.Context, in GetCheckoutSessionInput) (GetCheckoutSessionOutput, error) {
	if uc.Client == nil {
		return GetCheckoutSessionOutput{}, domain.ErrStripeNotConfigured
	}
	sid := strings.TrimSpace(in.SessionID)
	if sid == "" {
		return GetCheckoutSessionOutput{}, fmt.Errorf("subscription.GetCheckoutSession: empty session_id")
	}

	// 1) Cache lookup. Failure read'а — log и идём к Stripe.
	if uc.Redis != nil {
		if raw, err := uc.Redis.Get(ctx, uc.cacheKey(sid)).Bytes(); err == nil && len(raw) > 0 {
			var p cachePayload
			if uerr := json.Unmarshal(raw, &p); uerr == nil {
				out := GetCheckoutSessionOutput{
					Paid:          p.Paid,
					Tier:          p.Tier,
					AmountPaid:    p.AmountPaid,
					Currency:      p.Currency,
					CustomerEmail: p.CustomerEmail,
				}
				if p.PeriodEndUnix > 0 {
					t := time.Unix(p.PeriodEndUnix, 0).UTC()
					out.PeriodEnd = &t
				}
				if p.OwnerUserID != "" {
					if oid, oerr := uuid.Parse(p.OwnerUserID); oerr == nil {
						out.OwnerUserID = oid
					}
				}
				return out, nil
			}
		} else if err != nil && !errors.Is(err, redis.Nil) {
			uc.Log.WarnContext(ctx, "subscription.checkout_session.cache_read",
				slog.String("session_id", sid), slog.Any("err", err))
		}
	}

	// 2) Stripe fetch.
	sess, err := uc.Client.RetrieveCheckoutSession(ctx, sid)
	if err != nil {
		if errors.Is(err, domain.ErrNotFound) {
			return GetCheckoutSessionOutput{}, domain.ErrNotFound
		}
		return GetCheckoutSessionOutput{}, fmt.Errorf("subscription.GetCheckoutSession: stripe: %w", err)
	}

	// 3) Compute paid flag.
	paid := strings.EqualFold(sess.PaymentStatus, "paid") || strings.EqualFold(sess.Status, "complete")

	// 4) Resolve tier + period_end. По умолчанию paid → pro. Если у нас
	// уже есть locally-mirror'ная stripe subscription row, оттуда period_end
	// будет точнее (webhook опередил наш verify).
	tier := ""
	if paid {
		tier = "pro"
	}
	var periodEnd *time.Time
	if uc.Repo != nil && sess.SubscriptionID != "" {
		if local, lerr := uc.Repo.GetSubscriptionByStripeID(ctx, sess.SubscriptionID); lerr == nil {
			if local.CurrentPeriodEnd != nil {
				t := local.CurrentPeriodEnd.UTC()
				periodEnd = &t
			}
		} else if !errors.Is(lerr, domain.ErrNotFound) {
			uc.Log.WarnContext(ctx, "subscription.checkout_session.local_lookup",
				slog.String("session_id", sid),
				slog.String("subscription_id", sess.SubscriptionID),
				slog.Any("err", lerr))
		}
	}

	out := GetCheckoutSessionOutput{
		Paid:          paid,
		Tier:          tier,
		AmountPaid:    sess.AmountTotal,
		Currency:      strings.ToLower(sess.Currency),
		PeriodEnd:     periodEnd,
		CustomerEmail: sess.CustomerEmail,
	}

	// Parse owner before cache write so cache round-trips preserve ownership.
	if sess.ClientReferenceID != "" {
		if ownerID, perr := uuid.Parse(sess.ClientReferenceID); perr == nil {
			out.OwnerUserID = ownerID
		}
	}

	// 5) Cache write — best-effort. Не cache'им если ответ ещё processing
	// (paid=false), потому что juniors / refresh'ы должны re-resolve как
	// только webhook долетит.
	if uc.Redis != nil && paid {
		p := cachePayload{
			Paid:          out.Paid,
			Tier:          out.Tier,
			AmountPaid:    out.AmountPaid,
			Currency:      out.Currency,
			CustomerEmail: out.CustomerEmail,
		}
		if out.PeriodEnd != nil {
			p.PeriodEndUnix = out.PeriodEnd.Unix()
		}
		if out.OwnerUserID != uuid.Nil {
			p.OwnerUserID = out.OwnerUserID.String()
		}
		if raw, merr := json.Marshal(p); merr == nil {
			if serr := uc.Redis.Set(ctx, uc.cacheKey(sid), raw, uc.CacheTTL).Err(); serr != nil {
				uc.Log.WarnContext(ctx, "subscription.checkout_session.cache_write",
					slog.String("session_id", sid), slog.Any("err", serr))
			}
		}
	}

	return out, nil
}
