package ports

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"

	"druz9/subscription/app"

	sharedMw "druz9/shared/pkg/middleware"
)

// BoostyHandler — chi-REST для Boosty-интеграции. Два endpoint'а:
//
//	POST /api/v1/subscription/boosty/link  — юзер привязывает свой
//	                                         boosty_username. Auth required.
//	POST /api/v1/admin/subscriptions/boosty/sync — ручной триггер sync'а
//	                                               для операторов. Admin-gate.
//
// Почему REST, а не Connect: (1) это опциональные endpoints выкатываемые
// постепенно — proto-ceremony избыточна. (2) /boosty/sync возвращает
// structured-метрики (tamper-proof JSON), proto-wire Connect даёт тот же
// результат с большим boilerplate'ом.
type BoostyHandler struct {
	Link *app.LinkBoosty
	Sync *app.SyncBoosty // может быть nil если BOOSTY_ACCESS_TOKEN не выставлен
	Log  *slog.Logger
}

func NewBoostyHandler(link *app.LinkBoosty, sync *app.SyncBoosty, log *slog.Logger) *BoostyHandler {
	return &BoostyHandler{Link: link, Sync: sync, Log: log}
}

type linkRequest struct {
	BoostyUsername string `json:"boosty_username"`
}
type linkResponse struct {
	OK       bool   `json:"ok"`
	Username string `json:"boosty_username"`
}

// HandleLink — POST /api/v1/subscription/boosty/link.
func (h *BoostyHandler) HandleLink(w http.ResponseWriter, r *http.Request) {
	uid, ok := sharedMw.UserIDFromContext(r.Context())
	if !ok {
		writeJSONErr(w, http.StatusUnauthorized, "unauthenticated")
		return
	}
	defer func() { _ = r.Body.Close() }()
	var req linkRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSONErr(w, http.StatusBadRequest, "invalid json")
		return
	}
	if err := h.Link.Do(r.Context(), app.LinkBoostyInput{
		UserID:         uid,
		BoostyUsername: req.BoostyUsername,
	}); err != nil {
		h.Log.WarnContext(r.Context(), "subscription.boosty.link.failed",
			slog.String("user_id", uid.String()), slog.Any("err", err))
		writeJSONErr(w, http.StatusBadRequest, "invalid boosty username")
		return
	}
	writeJSON(w, http.StatusOK, linkResponse{OK: true, Username: req.BoostyUsername})
}

type syncResponse struct {
	OK             bool `json:"ok"`
	TotalFetched   int  `json:"total_fetched"`
	MatchedUsers   int  `json:"matched_users"`
	Upserted       int  `json:"upserted"`
	SkippedNoLink  int  `json:"skipped_no_link"`
	SkippedBadTier int  `json:"skipped_bad_tier"`
	Errors         int  `json:"errors"`
}

// HandleAdminSync — POST /api/v1/admin/subscriptions/boosty/sync.
// Требует admin role (проверяется в restAuthGate только для /admin/* префикса
// — см. cmd/monolith/bootstrap/router.go). Для MVP admin-проверка встроена
// здесь через UserRoleFromContext.
func (h *BoostyHandler) HandleAdminSync(w http.ResponseWriter, r *http.Request) {
	role, ok := sharedMw.UserRoleFromContext(r.Context())
	if !ok || role != "admin" {
		writeJSONErr(w, http.StatusForbidden, "admin role required")
		return
	}
	if h.Sync == nil {
		writeJSONErr(w, http.StatusServiceUnavailable, "boosty not configured")
		return
	}
	res, err := h.Sync.Do(r.Context())
	if err != nil {
		if errors.Is(err, context.Canceled) {
			writeJSONErr(w, http.StatusServiceUnavailable, "sync cancelled")
			return
		}
		h.Log.ErrorContext(r.Context(), "subscription.boosty.sync.failed", slog.Any("err", err))
		writeJSONErr(w, http.StatusBadGateway, "sync failed")
		return
	}
	writeJSON(w, http.StatusOK, syncResponse{
		OK:             true,
		TotalFetched:   res.TotalFetched,
		MatchedUsers:   res.MatchedUsers,
		Upserted:       res.Upserted,
		SkippedNoLink:  res.SkippedNoLink,
		SkippedBadTier: res.SkippedBadTier,
		Errors:         res.Errors,
	})
}

// ── tiny json helpers (internal) ───────────────────────────────────────────

func writeJSON(w http.ResponseWriter, status int, v interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeJSONErr(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]any{"error": map[string]string{"message": msg}})
}
