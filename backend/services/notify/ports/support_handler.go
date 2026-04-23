// support_handler.go — REST endpoint для формы поддержки на /help.
//
// Простой POST /api/v1/support/ticket принимает:
//
//	{
//	  "contact_kind":  "email" | "telegram",
//	  "contact_value": "user@example.com" | "@username",
//	  "subject":       "Опционально, до 200 chars",
//	  "message":       "Текст обращения (10..5000 chars)"
//	}
//
// На успех — 200 {ticket_id, created_at}. Параллельно шлёт alert в
// support-чат в Telegram (если SUPPORT_TELEGRAM_CHAT_ID задан).
//
// Public endpoint (без auth) — фронт может слать с /help даже от
// незалогиненного юзера. Rate-limit на стороне router.go.
package ports

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	"druz9/notify/domain"
	sharedMw "druz9/shared/pkg/middleware"

	"github.com/google/uuid"
)

// SupportHandler — http.Handler для POST /api/v1/support/ticket.
type SupportHandler struct {
	Repo       domain.SupportRepo
	BotNotify  SupportBotNotifier // optional — если nil, alert в TG не шлём
	Log        *slog.Logger
	MaxMessage int // default 5000
}

// SupportBotNotifier — узкий интерфейс для уведомления оператора в Telegram.
// Реализация в infra/telegram_bot.go (метод BroadcastToSupport).
type SupportBotNotifier interface {
	NotifySupport(ctx context.Context, ticket domain.SupportTicket) error
}

type supportRequest struct {
	ContactKind  string `json:"contact_kind"`
	ContactValue string `json:"contact_value"`
	Subject      string `json:"subject"`
	Message      string `json:"message"`
}

type supportResponse struct {
	TicketID  string    `json:"ticket_id"`
	CreatedAt time.Time `json:"created_at"`
}

// ServeHTTP реализует http.Handler.
func (h *SupportHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	var req supportRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid json: "+err.Error())
		return
	}
	defer func() { _ = r.Body.Close() }()

	maxMsg := h.MaxMessage
	if maxMsg <= 0 {
		maxMsg = 5000
	}
	ticket, err := buildTicket(r.Context(), req, maxMsg)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	if err := h.Repo.Create(r.Context(), &ticket); err != nil {
		if h.Log != nil {
			h.Log.ErrorContext(r.Context(), "support.create failed", slog.Any("err", err))
		}
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}

	// Best-effort оповещение в Telegram. Если не вышло — лог, но не ломаем
	// ответ юзеру: ticket уже сохранён, оператор увидит в админке.
	if h.BotNotify != nil {
		if err := h.BotNotify.NotifySupport(r.Context(), ticket); err != nil && h.Log != nil {
			h.Log.WarnContext(r.Context(), "support.notify_telegram failed",
				slog.String("ticket_id", ticket.ID.String()), slog.Any("err", err))
		}
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(supportResponse{
		TicketID:  ticket.ID.String(),
		CreatedAt: ticket.CreatedAt,
	})
}

// buildTicket валидирует req и собирает доменный объект. user_id берётся из
// context'а если юзер залогинен.
func buildTicket(ctx context.Context, req supportRequest, maxMsg int) (domain.SupportTicket, error) {
	kind := strings.ToLower(strings.TrimSpace(req.ContactKind))
	if kind != "email" && kind != "telegram" {
		return domain.SupportTicket{}, errors.New("contact_kind must be email or telegram")
	}
	value := strings.TrimSpace(req.ContactValue)
	switch kind {
	case "email":
		if !looksLikeEmail(value) {
			return domain.SupportTicket{}, errors.New("invalid email")
		}
		value = strings.ToLower(value)
	case "telegram":
		// Допускаем "@username", "username", "+79991112233". Полная валидация —
		// на стороне оператора.
		if value == "" {
			return domain.SupportTicket{}, errors.New("telegram handle required")
		}
		if !strings.HasPrefix(value, "@") && !strings.HasPrefix(value, "+") {
			value = "@" + value
		}
	}
	subject := strings.TrimSpace(req.Subject)
	if utf8.RuneCountInString(subject) > 200 {
		return domain.SupportTicket{}, errors.New("subject too long (max 200)")
	}
	message := strings.TrimSpace(req.Message)
	msgLen := utf8.RuneCountInString(message)
	if msgLen < 10 {
		return domain.SupportTicket{}, errors.New("message too short (min 10 chars)")
	}
	if msgLen > maxMsg {
		return domain.SupportTicket{}, errors.New("message too long")
	}
	t := domain.SupportTicket{
		ID:           uuid.New(),
		ContactKind:  kind,
		ContactValue: value,
		Subject:      subject,
		Message:      message,
		Status:       domain.SupportStatusOpen,
		CreatedAt:    time.Now().UTC(),
	}
	if uid, ok := sharedMw.UserIDFromContext(ctx); ok {
		t.UserID = &uid
	}
	return t, nil
}

func looksLikeEmail(s string) bool {
	if s == "" {
		return false
	}
	at := strings.IndexByte(s, '@')
	if at <= 0 || at == len(s)-1 {
		return false
	}
	if strings.IndexByte(s[at+1:], '.') < 0 {
		return false
	}
	return !strings.ContainsAny(s, " \t\n\r")
}

func writeError(w http.ResponseWriter, status int, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]any{
		"error": map[string]string{"message": msg},
	})
}
