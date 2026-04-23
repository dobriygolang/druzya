// Package ports — chi REST для friends.
package ports

import (
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"strconv"
	"time"

	friendsApp "druz9/friends/app"
	friendsDomain "druz9/friends/domain"
	sharedMw "druz9/shared/pkg/middleware"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
)

// Handler собирает use cases. NewHandler заполняет дефолты.
type Handler struct {
	List        *friendsApp.ListFriends
	Incoming    *friendsApp.ListIncoming
	Outgoing    *friendsApp.ListOutgoing
	Blocked     *friendsApp.ListBlocked
	Suggestions *friendsApp.ListSuggestions
	Add         *friendsApp.AddFriend
	Accept      *friendsApp.AcceptFriend
	Decline     *friendsApp.DeclineFriend
	Block       *friendsApp.BlockUser
	Unblock     *friendsApp.UnblockUser
	Unfriend    *friendsApp.Unfriend
	Code        *friendsApp.GetMyCode
	Repo        friendsDomain.FriendRepo // для GetIDByPair (преобразование user_id → friendship_id)
	Log         *slog.Logger
}

// NewHandler копия. Log обязателен (anti-fallback policy).
func NewHandler(in Handler) *Handler {
	h := in
	if h.Log == nil {
		panic("friends.ports.NewHandler: Log is required (anti-fallback policy: no silent slog.Default fallback)")
	}
	return &h
}

// Mount регистрирует все REST routes на gated /api/v1.
func (h *Handler) Mount(r chi.Router) {
	r.Get("/friends", h.handleList)
	r.Get("/friends/incoming", h.handleIncoming)
	r.Get("/friends/outgoing", h.handleOutgoing)
	r.Get("/friends/blocked", h.handleBlocked)
	r.Get("/friends/code", h.handleCode)
	r.Post("/friends/request", h.handleRequest)
	r.Post("/friends/suggestions", h.handleSuggestions)
	r.Post("/friends/{id}/accept", h.handleAccept)
	r.Post("/friends/{id}/decline", h.handleDecline)
	r.Post("/friends/{user_id}/block", h.handleBlock)
	r.Delete("/friends/{user_id}/block", h.handleUnblock)
	r.Delete("/friends/{user_id}", h.handleUnfriend)
}

// friendResponse — общая JSON-форма для друга/incoming/outgoing/etc.
//
// Anti-fallback: the `online` field was removed from the JSON contract.
// There is no real presence service — the previous AlwaysOffline stub was
// always shipping `false`. The frontend's online-now section was unused
// noise; FriendsPage now derives status purely from last_match_at.
type friendResponse struct {
	UserID       string     `json:"user_id"`
	Username     string     `json:"username"`
	DisplayName  string     `json:"display_name"`
	AvatarURL    string     `json:"avatar_url"`
	Tier         string     `json:"tier"`
	LastMatchAt  *time.Time `json:"last_match_at"`
	FriendshipID int64      `json:"friendship_id,omitempty"`
}

func toFriendResponse(d friendsApp.FriendDTO) friendResponse {
	return friendResponse{
		UserID:       d.UserID.String(),
		Username:     d.Username,
		DisplayName:  d.DisplayName,
		AvatarURL:    d.AvatarURL,
		Tier:         d.Tier,
		LastMatchAt:  d.LastMatchAt,
		FriendshipID: d.FriendshipID,
	}
}

func (h *Handler) handleList(w http.ResponseWriter, r *http.Request) {
	uid, ok := sharedMw.UserIDFromContext(r.Context())
	if !ok {
		writeJSONError(w, http.StatusUnauthorized, "unauthenticated")
		return
	}
	res, err := h.List.Do(r.Context(), uid)
	if err != nil {
		h.Log.ErrorContext(r.Context(), "friends.List failed", slog.Any("err", err))
		writeJSONError(w, http.StatusInternalServerError, "internal error")
		return
	}
	// Anti-fallback: online_count removed (no presence service exists).
	out := struct {
		Accepted []friendResponse `json:"accepted"`
		Total    int              `json:"total"`
	}{
		Accepted: make([]friendResponse, 0, len(res.Accepted)),
		Total:    res.Total,
	}
	for _, d := range res.Accepted {
		out.Accepted = append(out.Accepted, toFriendResponse(d))
	}
	writeJSON(w, http.StatusOK, out)
}

func (h *Handler) handleIncoming(w http.ResponseWriter, r *http.Request) {
	uid, ok := sharedMw.UserIDFromContext(r.Context())
	if !ok {
		writeJSONError(w, http.StatusUnauthorized, "unauthenticated")
		return
	}
	dtos, err := h.Incoming.Do(r.Context(), uid)
	if err != nil {
		h.Log.ErrorContext(r.Context(), "friends.Incoming failed", slog.Any("err", err))
		writeJSONError(w, http.StatusInternalServerError, "internal error")
		return
	}
	writeJSON(w, http.StatusOK, mapList(dtos))
}

func (h *Handler) handleOutgoing(w http.ResponseWriter, r *http.Request) {
	uid, ok := sharedMw.UserIDFromContext(r.Context())
	if !ok {
		writeJSONError(w, http.StatusUnauthorized, "unauthenticated")
		return
	}
	dtos, err := h.Outgoing.Do(r.Context(), uid)
	if err != nil {
		h.Log.ErrorContext(r.Context(), "friends.Outgoing failed", slog.Any("err", err))
		writeJSONError(w, http.StatusInternalServerError, "internal error")
		return
	}
	writeJSON(w, http.StatusOK, mapList(dtos))
}

func (h *Handler) handleBlocked(w http.ResponseWriter, r *http.Request) {
	uid, ok := sharedMw.UserIDFromContext(r.Context())
	if !ok {
		writeJSONError(w, http.StatusUnauthorized, "unauthenticated")
		return
	}
	dtos, err := h.Blocked.Do(r.Context(), uid)
	if err != nil {
		h.Log.ErrorContext(r.Context(), "friends.Blocked failed", slog.Any("err", err))
		writeJSONError(w, http.StatusInternalServerError, "internal error")
		return
	}
	writeJSON(w, http.StatusOK, mapList(dtos))
}

// requestBody для POST /friends/request.
type requestBody struct {
	UserID string `json:"user_id"`
	Code   string `json:"code"`
}

func (h *Handler) handleRequest(w http.ResponseWriter, r *http.Request) {
	uid, ok := sharedMw.UserIDFromContext(r.Context())
	if !ok {
		writeJSONError(w, http.StatusUnauthorized, "unauthenticated")
		return
	}
	var body requestBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSONError(w, http.StatusBadRequest, "invalid body")
		return
	}
	in := friendsApp.AddInput{Code: body.Code}
	if body.UserID != "" {
		parsed, err := uuid.Parse(body.UserID)
		if err != nil {
			writeJSONError(w, http.StatusBadRequest, "invalid user_id")
			return
		}
		in.UserID = &parsed
	}
	if in.UserID == nil && in.Code == "" {
		writeJSONError(w, http.StatusBadRequest, "user_id or code required")
		return
	}
	f, err := h.Add.Do(r.Context(), uid, in)
	if err != nil {
		switch {
		case errors.Is(err, friendsDomain.ErrSelfFriendship):
			writeJSONError(w, http.StatusBadRequest, "cannot friend self")
		case errors.Is(err, friendsDomain.ErrAlreadyExists):
			// 200 OK с уже-существующей записью — фронт перерендерит
			writeJSON(w, http.StatusOK, map[string]any{
				"friendship_id": f.ID,
				"status":        string(f.Status),
				"already":       true,
			})
		case errors.Is(err, friendsDomain.ErrNotFound), errors.Is(err, friendsDomain.ErrCodeExpired):
			writeJSONError(w, http.StatusNotFound, "code/user not found")
		default:
			h.Log.ErrorContext(r.Context(), "friends.Add failed", slog.Any("err", err))
			writeJSONError(w, http.StatusInternalServerError, "internal error")
		}
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"friendship_id": f.ID,
		"status":        string(f.Status),
	})
}

func (h *Handler) handleSuggestions(w http.ResponseWriter, r *http.Request) {
	uid, ok := sharedMw.UserIDFromContext(r.Context())
	if !ok {
		writeJSONError(w, http.StatusUnauthorized, "unauthenticated")
		return
	}
	dtos, err := h.Suggestions.Do(r.Context(), uid)
	if err != nil {
		h.Log.ErrorContext(r.Context(), "friends.Suggestions failed", slog.Any("err", err))
		writeJSONError(w, http.StatusInternalServerError, "internal error")
		return
	}
	writeJSON(w, http.StatusOK, mapList(dtos))
}

func (h *Handler) handleAccept(w http.ResponseWriter, r *http.Request) {
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
	f, err := h.Accept.Do(r.Context(), id, uid)
	if err != nil {
		if errors.Is(err, friendsDomain.ErrNotFound) {
			writeJSONError(w, http.StatusNotFound, "request not found")
			return
		}
		h.Log.ErrorContext(r.Context(), "friends.Accept failed", slog.Any("err", err))
		writeJSONError(w, http.StatusInternalServerError, "internal error")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"friendship_id": f.ID, "status": string(f.Status)})
}

func (h *Handler) handleDecline(w http.ResponseWriter, r *http.Request) {
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
	if err := h.Decline.Do(r.Context(), id, uid); err != nil {
		if errors.Is(err, friendsDomain.ErrNotFound) {
			writeJSONError(w, http.StatusNotFound, "request not found")
			return
		}
		h.Log.ErrorContext(r.Context(), "friends.Decline failed", slog.Any("err", err))
		writeJSONError(w, http.StatusInternalServerError, "internal error")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handler) handleBlock(w http.ResponseWriter, r *http.Request) {
	uid, ok := sharedMw.UserIDFromContext(r.Context())
	if !ok {
		writeJSONError(w, http.StatusUnauthorized, "unauthenticated")
		return
	}
	target, err := uuid.Parse(chi.URLParam(r, "user_id"))
	if err != nil {
		writeJSONError(w, http.StatusBadRequest, "invalid user_id")
		return
	}
	if err := h.Block.Do(r.Context(), uid, target); err != nil {
		h.Log.ErrorContext(r.Context(), "friends.Block failed", slog.Any("err", err))
		writeJSONError(w, http.StatusInternalServerError, "internal error")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handler) handleUnblock(w http.ResponseWriter, r *http.Request) {
	uid, ok := sharedMw.UserIDFromContext(r.Context())
	if !ok {
		writeJSONError(w, http.StatusUnauthorized, "unauthenticated")
		return
	}
	target, err := uuid.Parse(chi.URLParam(r, "user_id"))
	if err != nil {
		writeJSONError(w, http.StatusBadRequest, "invalid user_id")
		return
	}
	if err := h.Unblock.Do(r.Context(), uid, target); err != nil {
		if errors.Is(err, friendsDomain.ErrNotFound) {
			writeJSONError(w, http.StatusNotFound, "not blocked")
			return
		}
		h.Log.ErrorContext(r.Context(), "friends.Unblock failed", slog.Any("err", err))
		writeJSONError(w, http.StatusInternalServerError, "internal error")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handler) handleUnfriend(w http.ResponseWriter, r *http.Request) {
	uid, ok := sharedMw.UserIDFromContext(r.Context())
	if !ok {
		writeJSONError(w, http.StatusUnauthorized, "unauthenticated")
		return
	}
	target, err := uuid.Parse(chi.URLParam(r, "user_id"))
	if err != nil {
		writeJSONError(w, http.StatusBadRequest, "invalid user_id")
		return
	}
	if err := h.Unfriend.Do(r.Context(), uid, target); err != nil {
		if errors.Is(err, friendsDomain.ErrNotFound) {
			writeJSONError(w, http.StatusNotFound, "not friends")
			return
		}
		h.Log.ErrorContext(r.Context(), "friends.Unfriend failed", slog.Any("err", err))
		writeJSONError(w, http.StatusInternalServerError, "internal error")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handler) handleCode(w http.ResponseWriter, r *http.Request) {
	uid, ok := sharedMw.UserIDFromContext(r.Context())
	if !ok {
		writeJSONError(w, http.StatusUnauthorized, "unauthenticated")
		return
	}
	c, err := h.Code.Do(r.Context(), uid)
	if err != nil {
		h.Log.ErrorContext(r.Context(), "friends.Code failed", slog.Any("err", err))
		writeJSONError(w, http.StatusInternalServerError, "internal error")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"code":       c.Code,
		"expires_at": c.ExpiresAt,
	})
}

// ── helpers ────────────────────────────────────────────────────────────────

func mapList(in []friendsApp.FriendDTO) []friendResponse {
	out := make([]friendResponse, 0, len(in))
	for _, d := range in {
		out = append(out, toFriendResponse(d))
	}
	return out
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeJSONError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]any{"error": map[string]string{"message": msg}})
}
