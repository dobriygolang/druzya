package ports

// webhook_handler.go — a tiny adapter exposing the WebhookHandler as a plain
// http.HandlerFunc that main.go can plug into chi directly:
//
//   r.Post("/api/v1/notify/telegram/webhook", notifyH.WebhookHandler)
//
// The split keeps server.go (apigen.ServerInterface impl) separate from the
// out-of-contract webhook route.

import "net/http"

// HandlerFunc returns the bound http.HandlerFunc for chi registration.
func (h *WebhookHandler) HandlerFunc() http.HandlerFunc {
	return h.ServeHTTP
}
