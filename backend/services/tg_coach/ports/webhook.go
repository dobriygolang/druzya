// Package ports provides the Telegram webhook surface stub.
//
// STRATEGIC SCAFFOLD: returns 501. The real handler should:
//  1. Validate the X-Telegram-Bot-Api-Secret-Token header.
//  2. Parse the Update payload (telebot.v3 Update type works fine).
//  3. Dispatch via app.HandleCommand or app.LinkAccount.
//  4. Reply via the bot send API (do NOT block on the HTTP response).
package ports

import (
	"encoding/json"
	"log/slog"
	"net/http"

	"druz9/tg_coach/app"
)

// Handler bundles use cases.
type Handler struct {
	Issue   *app.IssueLinkToken
	Link    *app.LinkAccount
	Command *app.HandleCommand
	Log     *slog.Logger
}

// NewHandler constructs the HTTP handler. Panics on nil logger.
func NewHandler(h Handler) *Handler {
	if h.Log == nil {
		panic("tg_coach/ports: nil logger passed to NewHandler")
	}
	return &h
}

// HandleWebhook — STRATEGIC SCAFFOLD: not implemented; see docs/strategic/tg-coach.md
//
// When implemented, the bot library to use is `gopkg.in/telebot.v3`.
func (h *Handler) HandleWebhook(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusNotImplemented)
	_ = json.NewEncoder(w).Encode(map[string]string{
		"error":   "not_implemented",
		"op":      "TelegramWebhook",
		"roadmap": "docs/strategic/tg-coach.md",
		"library": "gopkg.in/telebot.v3",
	})
}

// HandleIssueLinkToken — STRATEGIC SCAFFOLD: not implemented; see docs/strategic/tg-coach.md
func (h *Handler) HandleIssueLinkToken(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusNotImplemented)
	_ = json.NewEncoder(w).Encode(map[string]string{
		"error":   "not_implemented",
		"op":      "IssueLinkToken",
		"roadmap": "docs/strategic/tg-coach.md",
	})
}
