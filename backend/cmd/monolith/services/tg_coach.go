//go:build strategicwire
// +build strategicwire

// Package services — STRATEGIC SCAFFOLD wirer for tg_coach.
//
// Guarded by `strategicwire` build tag. See orgs.go for activation steps.
package services

import (
	"net/http"

	tgApp "druz9/tg_coach/app"
	tgPorts "druz9/tg_coach/ports"

	"github.com/go-chi/chi/v5"
)

// NewTGCoach wires the Telegram coach bounded context.
//
// STRATEGIC SCAFFOLD: returns 501 stubs. See docs/strategic/tg-coach.md.
func NewTGCoach(d Deps) *Module {
	issue := tgApp.NewIssueLinkToken(nil, d.Log)
	link := tgApp.NewLinkAccount(nil, d.Log)
	command := tgApp.NewHandleCommand(nil, d.Log)

	h := tgPorts.NewHandler(tgPorts.Handler{
		Issue:   issue,
		Link:    link,
		Command: command,
		Log:     d.Log,
	})

	return &Module{
		// /webhooks/telegram is intentionally NOT behind connect auth —
		// Telegram's IP doesn't carry a JWT. Instead the handler must
		// validate the X-Telegram-Bot-Api-Secret-Token header.
		MountREST: func(r chi.Router) {
			r.Post("/webhooks/telegram", http.HandlerFunc(h.HandleWebhook))
			r.Post("/me/telegram/link-token", http.HandlerFunc(h.HandleIssueLinkToken))
		},
	}
}
