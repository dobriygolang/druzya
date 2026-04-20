package ports

// webhook.go — Telegram bot webhook receiver (not in openapi.yaml).
//
// The route is manually registered in main.go because openapi.yaml does not
// yet declare this endpoint — see WIRING.md. A follow-up openapi patch should
// add it so the frontend-oriented schema stays in sync with reality.

import (
	"context"
	"crypto/subtle"
	"encoding/json"
	"log/slog"
	"net/http"

	tgbotapi "github.com/go-telegram-bot-api/telegram-bot-api/v5"
)

// WebhookHandler is the chi-compatible http.HandlerFunc that Telegram calls
// with an Update JSON body. It verifies the shared secret (query string) and
// delegates parsing to the bot.
type WebhookHandler struct {
	Bot           BotUpdateHandler
	WebhookSecret string
	Log           *slog.Logger
}

// BotUpdateHandler is the narrow bot interface used by the webhook — matches
// infra.TelegramBot.HandleUpdate. Keeping it here as an interface lets us
// unit-test the webhook route without a real bot.
type BotUpdateHandler interface {
	HandleUpdate(ctx context.Context, update tgbotapi.Update) error
}

// NewWebhookHandler constructs a handler. `secret` must equal the
// ?secret=<…> query parameter Telegram passes back from the setWebhook URL.
func NewWebhookHandler(bot BotUpdateHandler, secret string, log *slog.Logger) *WebhookHandler {
	return &WebhookHandler{Bot: bot, WebhookSecret: secret, Log: log}
}

// ServeHTTP implements http.Handler.
func (h *WebhookHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	got := r.URL.Query().Get("secret")
	// Constant-time compare to avoid timing attacks.
	if subtle.ConstantTimeCompare([]byte(got), []byte(h.WebhookSecret)) != 1 {
		h.Log.WarnContext(r.Context(), "notify.webhook: bad secret")
		http.Error(w, "forbidden", http.StatusForbidden)
		return
	}

	var update tgbotapi.Update
	if err := json.NewDecoder(r.Body).Decode(&update); err != nil {
		h.Log.WarnContext(r.Context(), "notify.webhook: bad body", slog.Any("err", err))
		http.Error(w, "bad request", http.StatusBadRequest)
		return
	}
	// Telegram retries aggressively when we return non-2xx, so even if
	// HandleUpdate fails we return 200 and log the error.
	if err := h.Bot.HandleUpdate(r.Context(), update); err != nil {
		h.Log.WarnContext(r.Context(), "notify.webhook: handle",
			slog.Int("update_id", update.UpdateID),
			slog.Any("err", err))
	}
	w.WriteHeader(http.StatusOK)
}
