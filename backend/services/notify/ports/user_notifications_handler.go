// user_notifications_handler.go — chi REST для in-app notifications feed:
// GET /notifications, GET /notifications/unread_count, POST /notifications/{id}/read,
// POST /notifications/read_all, GET /notifications/prefs, PUT /notifications/prefs.
package ports

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"strconv"
	"time"

	notifyApp "druz9/notify/app"
	notifyDomain "druz9/notify/domain"
	sharedMw "druz9/shared/pkg/middleware"

	"github.com/go-chi/chi/v5"
)

// UserNotificationsHandler собирает use cases для notifications feed.
type UserNotificationsHandler struct {
	List        *notifyApp.ListUserNotifications
	Unread      *notifyApp.CountUnread
	MarkRead    *notifyApp.MarkRead
	MarkAllRead *notifyApp.MarkAllRead
	GetPrefs    *notifyApp.GetPrefs
	UpdatePrefs *notifyApp.UpdatePrefs
	Log         *slog.Logger
}

// NewUserNotificationsHandler конструктор. Log обязателен (anti-fallback policy).
func NewUserNotificationsHandler(in UserNotificationsHandler) *UserNotificationsHandler {
	h := in
	if h.Log == nil {
		panic("notify.ports.NewUserNotificationsHandler: Log is required (anti-fallback policy: no silent slog.Default fallback)")
	}
	return &h
}

// Mount регистрирует REST routes.
func (h *UserNotificationsHandler) Mount(r chi.Router) {
	r.Get("/notifications", h.handleList)
	r.Get("/notifications/unread_count", h.handleUnread)
	r.Post("/notifications/read_all", h.handleReadAll)
	r.Get("/notifications/prefs", h.handleGetPrefs)
	r.Put("/notifications/prefs", h.handleUpdatePrefs)
	r.Post("/notifications/{id}/read", h.handleMarkRead)
}

// notificationResponse — JSON-форма для одного notification'а.
type notificationResponse struct {
	ID        int64          `json:"id"`
	Channel   string         `json:"channel"`
	Type      string         `json:"type"`
	Title     string         `json:"title"`
	Body      string         `json:"body"`
	Payload   map[string]any `json:"payload"`
	Priority  int            `json:"priority"`
	ReadAt    *time.Time     `json:"read_at"`
	CreatedAt time.Time      `json:"created_at"`
}

func toNotificationResponse(n notifyDomain.UserNotification) notificationResponse {
	return notificationResponse{
		ID:        n.ID,
		Channel:   n.Channel,
		Type:      n.Type,
		Title:     n.Title,
		Body:      n.Body,
		Payload:   n.Payload,
		Priority:  n.Priority,
		ReadAt:    n.ReadAt,
		CreatedAt: n.CreatedAt,
	}
}

func (h *UserNotificationsHandler) handleList(w http.ResponseWriter, r *http.Request) {
	uid, ok := sharedMw.UserIDFromContext(r.Context())
	if !ok {
		writeJSONError(w, http.StatusUnauthorized, "unauthenticated")
		return
	}
	q := r.URL.Query()
	f := notifyDomain.NotificationFilter{
		Channel:    q.Get("channel"),
		OnlyUnread: q.Get("unread") == "1" || q.Get("unread") == "true",
	}
	if before := q.Get("before"); before != "" {
		if t, err := time.Parse(time.RFC3339, before); err == nil {
			f.Before = t
		}
	}
	if limit := q.Get("limit"); limit != "" {
		if n, err := strconv.Atoi(limit); err == nil {
			f.Limit = n
		}
	}
	rows, err := h.List.Do(r.Context(), uid, f)
	if err != nil {
		h.Log.ErrorContext(r.Context(), "notify.list failed", slog.Any("err", err))
		writeJSONError(w, http.StatusInternalServerError, "internal error")
		return
	}
	out := make([]notificationResponse, 0, len(rows))
	for _, n := range rows {
		out = append(out, toNotificationResponse(n))
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"items": out,
	})
}

func (h *UserNotificationsHandler) handleUnread(w http.ResponseWriter, r *http.Request) {
	uid, ok := sharedMw.UserIDFromContext(r.Context())
	if !ok {
		writeJSONError(w, http.StatusUnauthorized, "unauthenticated")
		return
	}
	n, err := h.Unread.Do(r.Context(), uid)
	if err != nil {
		h.Log.ErrorContext(r.Context(), "notify.unread failed", slog.Any("err", err))
		writeJSONError(w, http.StatusInternalServerError, "internal error")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"count": n})
}

func (h *UserNotificationsHandler) handleMarkRead(w http.ResponseWriter, r *http.Request) {
	uid, ok := sharedMw.UserIDFromContext(r.Context())
	if !ok {
		writeJSONError(w, http.StatusUnauthorized, "unauthenticated")
		return
	}
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		writeJSONError(w, http.StatusBadRequest, "invalid id")
		return
	}
	if err := h.MarkRead.Do(r.Context(), id, uid); err != nil {
		h.Log.ErrorContext(r.Context(), "notify.markRead failed", slog.Any("err", err))
		writeJSONError(w, http.StatusInternalServerError, "internal error")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *UserNotificationsHandler) handleReadAll(w http.ResponseWriter, r *http.Request) {
	uid, ok := sharedMw.UserIDFromContext(r.Context())
	if !ok {
		writeJSONError(w, http.StatusUnauthorized, "unauthenticated")
		return
	}
	n, err := h.MarkAllRead.Do(r.Context(), uid)
	if err != nil {
		h.Log.ErrorContext(r.Context(), "notify.markAllRead failed", slog.Any("err", err))
		writeJSONError(w, http.StatusInternalServerError, "internal error")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"updated": n})
}

func (h *UserNotificationsHandler) handleGetPrefs(w http.ResponseWriter, r *http.Request) {
	uid, ok := sharedMw.UserIDFromContext(r.Context())
	if !ok {
		writeJSONError(w, http.StatusUnauthorized, "unauthenticated")
		return
	}
	p, err := h.GetPrefs.Do(r.Context(), uid)
	if err != nil {
		h.Log.ErrorContext(r.Context(), "notify.prefs.get failed", slog.Any("err", err))
		writeJSONError(w, http.StatusInternalServerError, "internal error")
		return
	}
	writeJSON(w, http.StatusOK, prefsToResponse(p))
}

type prefsRequest struct {
	ChannelEnabled map[string]bool `json:"channel_enabled"`
	SilenceUntil   *time.Time      `json:"silence_until"`
}

func (h *UserNotificationsHandler) handleUpdatePrefs(w http.ResponseWriter, r *http.Request) {
	uid, ok := sharedMw.UserIDFromContext(r.Context())
	if !ok {
		writeJSONError(w, http.StatusUnauthorized, "unauthenticated")
		return
	}
	var body prefsRequest
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSONError(w, http.StatusBadRequest, "invalid body")
		return
	}
	if body.ChannelEnabled == nil {
		body.ChannelEnabled = map[string]bool{}
	}
	out, err := h.UpdatePrefs.Do(r.Context(), notifyDomain.NotificationPrefs{
		UserID:         uid,
		ChannelEnabled: body.ChannelEnabled,
		SilenceUntil:   body.SilenceUntil,
	})
	if err != nil {
		h.Log.ErrorContext(r.Context(), "notify.prefs.update failed", slog.Any("err", err))
		writeJSONError(w, http.StatusInternalServerError, "internal error")
		return
	}
	writeJSON(w, http.StatusOK, prefsToResponse(out))
}

type prefsResponse struct {
	ChannelEnabled map[string]bool `json:"channel_enabled"`
	SilenceUntil   *time.Time      `json:"silence_until"`
	UpdatedAt      time.Time       `json:"updated_at"`
}

func prefsToResponse(p notifyDomain.NotificationPrefs) prefsResponse {
	if p.ChannelEnabled == nil {
		p.ChannelEnabled = map[string]bool{}
	}
	return prefsResponse{
		ChannelEnabled: p.ChannelEnabled,
		SilenceUntil:   p.SilenceUntil,
		UpdatedAt:      p.UpdatedAt,
	}
}

// writeJSON / writeJSONError копии (private к пакету), чтобы не зависеть
// от support_handler.
func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeJSONError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]any{"error": map[string]string{"message": msg}})
}
