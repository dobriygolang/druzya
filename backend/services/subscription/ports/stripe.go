// stripe.go — Connect-RPC handlers для Stripe checkout / cancel + chi-direct
// webhook receiver. Webhook не идёт через Connect-RPC потому что Stripe
// присылает raw application/json + кастомный Stripe-Signature header — vanguard
// проксирует это плохо.
package ports

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"

	"connectrpc.com/connect"
	"google.golang.org/protobuf/types/known/emptypb"
	"google.golang.org/protobuf/types/known/timestamppb"

	pb "druz9/shared/generated/pb/druz9/v1"
	sharedMw "druz9/shared/pkg/middleware"
	"druz9/subscription/app"
	"druz9/subscription/domain"
)

// CreateCheckoutSession — Connect-RPC handler. user_id из JWT.
func (s *SubscriptionServer) CreateCheckoutSession(
	ctx context.Context,
	req *connect.Request[pb.CreateCheckoutSessionRequest],
) (*connect.Response[pb.CheckoutSessionResponse], error) {
	uid, ok := sharedMw.UserIDFromContext(ctx)
	if !ok {
		return nil, connect.NewError(connect.CodeUnauthenticated, errors.New("unauthenticated"))
	}
	if s.CreateCheckoutSessionUC == nil {
		return nil, connect.NewError(connect.CodeUnavailable, errors.New("stripe_not_configured"))
	}
	// Email опционален: его можно потом передавать из profile-service, но
	// для MVP принимаем что Stripe соберёт email на странице checkout'а.
	out, err := s.CreateCheckoutSessionUC.Do(ctx, app.CreateCheckoutSessionInput{
		UserID:     uid,
		SuccessURL: req.Msg.GetSuccessUrl(),
		CancelURL:  req.Msg.GetCancelUrl(),
		PriceID:    req.Msg.GetPriceId(),
		TrialDays:  int(req.Msg.GetTrialDays()),
		Currency:   req.Msg.GetCurrency(),
	})
	if err != nil {
		if errors.Is(err, domain.ErrStripeNotConfigured) {
			return nil, connect.NewError(connect.CodeUnavailable, err)
		}
		return nil, fmt.Errorf("subscription.CreateCheckoutSession: %w", err)
	}
	return connect.NewResponse(&pb.CheckoutSessionResponse{
		SessionId:   out.SessionID,
		CheckoutUrl: out.CheckoutURL,
	}), nil
}

// GetCheckoutSession — Connect-RPC handler. Verify-endpoint для /billing/welcome.
//
// Auth: JWT необязателен. Юзер мог открыть /billing/welcome неавторизованным
// (e.g. login session expired в момент Stripe-flow'а). Server делает
// best-effort owner-binding через client_reference_id, но не блокирует
// response если mismatch — frontend всё равно показывает welcome.
// Owner-mismatch только логируется как warn.
func (s *SubscriptionServer) GetCheckoutSession(
	ctx context.Context,
	req *connect.Request[pb.GetCheckoutSessionRequest],
) (*connect.Response[pb.GetCheckoutSessionResponse], error) {
	if s.GetCheckoutSessionUC == nil {
		return nil, connect.NewError(connect.CodeUnavailable, errors.New("stripe_not_configured"))
	}
	sid := req.Msg.GetSessionId()
	if sid == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("session_id required"))
	}
	// User id опционален — best-effort owner-binding.
	uid, _ := sharedMw.UserIDFromContext(ctx)

	out, err := s.GetCheckoutSessionUC.Do(ctx, app.GetCheckoutSessionInput{
		SessionID:       sid,
		RequesterUserID: uid,
	})
	if err != nil {
		if errors.Is(err, domain.ErrNotFound) {
			return nil, connect.NewError(connect.CodeNotFound, err)
		}
		if errors.Is(err, domain.ErrStripeNotConfigured) {
			return nil, connect.NewError(connect.CodeUnavailable, err)
		}
		return nil, fmt.Errorf("subscription.GetCheckoutSession: %w", err)
	}
	resp := &pb.GetCheckoutSessionResponse{
		Paid:          out.Paid,
		Tier:          out.Tier,
		AmountPaid:    out.AmountPaid,
		Currency:      out.Currency,
		CustomerEmail: out.CustomerEmail,
	}
	if out.PeriodEnd != nil {
		resp.PeriodEnd = timestamppb.New(out.PeriodEnd.UTC())
	}
	return connect.NewResponse(resp), nil
}

// CancelSubscription — Connect-RPC handler. user_id из JWT.
func (s *SubscriptionServer) CancelSubscription(
	ctx context.Context,
	_ *connect.Request[emptypb.Empty],
) (*connect.Response[emptypb.Empty], error) {
	uid, ok := sharedMw.UserIDFromContext(ctx)
	if !ok {
		return nil, connect.NewError(connect.CodeUnauthenticated, errors.New("unauthenticated"))
	}
	if s.CancelSubscriptionUC == nil {
		return nil, connect.NewError(connect.CodeUnavailable, errors.New("stripe_not_configured"))
	}
	if err := s.CancelSubscriptionUC.Do(ctx, uid); err != nil {
		return nil, fmt.Errorf("subscription.CancelSubscription: %w", err)
	}
	return connect.NewResponse(&emptypb.Empty{}), nil
}

// StripeWebhookHandler — chi-direct http.Handler для /api/v1/subscription/
// stripe-webhook. Stripe шлёт raw JSON + Stripe-Signature header; vanguard
// не подходит. Mount'ится в bootstrap отдельно (MountPublicREST — без auth).
type StripeWebhookHandler struct {
	UC  *app.HandleWebhookEvent
	Log *slog.Logger
}

// NewStripeWebhookHandler — конструктор.
func NewStripeWebhookHandler(uc *app.HandleWebhookEvent, log *slog.Logger) *StripeWebhookHandler {
	return &StripeWebhookHandler{UC: uc, Log: log}
}

// ServeHTTP — обрабатывает Stripe webhook. Status codes:
//   - 200: event accepted (включая unsupported types — silent ack чтобы
//     Stripe не ретраил)
//   - 400: bad signature / unparseable body
//   - 503: webhook UC не сконфигурирован (e.g. STRIPE_WEBHOOK_SECRET пуст)
//   - 500: внутренняя ошибка (Stripe ретраит)
func (h *StripeWebhookHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if h.UC == nil {
		http.Error(w, "stripe webhook not configured", http.StatusServiceUnavailable)
		return
	}
	// Stripe sends moderately-sized JSON (5-50 KB). 1 MB cap — на всякий случай.
	body, err := io.ReadAll(io.LimitReader(r.Body, 1<<20))
	if err != nil {
		http.Error(w, "read body", http.StatusBadRequest)
		return
	}
	sigHeader := r.Header.Get("Stripe-Signature")
	if err := h.UC.Do(r.Context(), body, sigHeader); err != nil {
		if errors.Is(err, domain.ErrInvalidWebhookSignature) {
			h.Log.WarnContext(r.Context(), "subscription.stripe.webhook: bad signature")
			http.Error(w, "invalid signature", http.StatusBadRequest)
			return
		}
		h.Log.WarnContext(r.Context(), "subscription.stripe.webhook: handle", "err", err)
		// Stripe retry'нёт на 5xx — что нам и нужно для transient'ов.
		http.Error(w, "internal", http.StatusInternalServerError)
		return
	}
	w.Header().Set("content-type", "application/json")
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(map[string]bool{"received": true})
}
