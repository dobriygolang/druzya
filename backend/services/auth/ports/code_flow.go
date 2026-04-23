// code_flow.go — REST handlers for the Telegram deep-link code flow.
//
// We chose plain chi handlers over a new pair of Connect RPCs to keep the
// proto generation pipeline untouched (auth.proto change → buf gen → many
// regenerated files). The wire shapes mirror what AuthServer.LoginTelegram
// returns on success so the frontend's bookkeeping (cookie + access_token)
// stays uniform.
//
// Endpoints:
//
//	POST /api/v1/auth/telegram/start  → 200 {code, deep_link, expires_at} | 429
//	POST /api/v1/auth/telegram/poll   → 200 {access_token, expires_in, user, is_new_user}
//	                                  → 202 {pending: true}     (waiting for bot)
//	                                  → 410 {error: "code_expired"}
//	                                  → 429 {error, retry_after}
package ports

import (
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"time"

	"druz9/auth/app"
	"druz9/auth/domain"
	"druz9/shared/enums"
)

// CodeFlowHandler exposes the deep-link code-flow endpoints. Wired in
// services/auth.go and mounted in router.go.
type CodeFlowHandler struct {
	Start *app.StartTelegramCode
	Poll  *app.PollTelegramCode
	Auth  *AuthServer // reused for cookie helpers + AuthResponse builder
	Log   *slog.Logger
}

// NewCodeFlowHandler wires the handler.
func NewCodeFlowHandler(start *app.StartTelegramCode, poll *app.PollTelegramCode, auth *AuthServer, log *slog.Logger) *CodeFlowHandler {
	return &CodeFlowHandler{Start: start, Poll: poll, Auth: auth, Log: log}
}

type startResponse struct {
	Code      string    `json:"code"`
	DeepLink  string    `json:"deep_link"`
	ExpiresAt time.Time `json:"expires_at"`
}

type pollRequest struct {
	Code string `json:"code"`
}

type pollSuccessResponse struct {
	AccessToken string   `json:"access_token"`
	ExpiresIn   int      `json:"expires_in"`
	User        pollUser `json:"user"`
	IsNewUser   bool     `json:"is_new_user"`
}

type pollUser struct {
	ID        string `json:"id"`
	Email     string `json:"email,omitempty"`
	Username  string `json:"username"`
	Role      string `json:"role"`
	Provider  string `json:"provider"`
	AvatarURL string `json:"avatar_url,omitempty"`
}

// HandleStart implements POST /api/v1/auth/telegram/start.
func (h *CodeFlowHandler) HandleStart(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	res, err := h.Start.Do(r.Context(), app.StartTelegramCodeInput{IP: clientIPFromRequest(r)})
	if err != nil {
		h.writeErr(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, startResponse(res))
}

// HandlePoll implements POST /api/v1/auth/telegram/poll.
func (h *CodeFlowHandler) HandlePoll(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var req pollRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "bad_request"})
		return
	}
	res, err := h.Poll.Do(r.Context(), app.PollTelegramCodeInput{
		Code:      req.Code,
		IP:        clientIPFromRequest(r),
		UserAgent: r.Header.Get("User-Agent"),
	})
	if err != nil {
		switch {
		case app.IsCodePending(err):
			writeJSON(w, http.StatusAccepted, map[string]bool{"pending": true})
			return
		case app.IsCodeNotFound(err):
			writeJSON(w, http.StatusGone, map[string]string{"error": "code_expired"})
			return
		}
		h.writeErr(w, r, err)
		return
	}
	// Set the refresh cookie via the AuthServer's existing helper so the
	// behaviour is identical to LoginTelegram.
	w.Header().Add("Set-Cookie", h.Auth.setRefreshCookieString(res.Tokens.RefreshToken, res.Tokens.RefreshExpires))
	writeJSON(w, http.StatusOK, pollSuccessResponse{
		AccessToken: res.Tokens.AccessToken,
		ExpiresIn:   res.Tokens.AccessExpiresIn,
		User: pollUser{
			ID:        res.User.ID.String(),
			Email:     res.User.Email,
			Username:  res.User.Username,
			Role:      string(res.User.Role),
			Provider:  string(enums.AuthProviderTelegram),
			AvatarURL: res.User.AvatarURL,
		},
		IsNewUser: res.IsNewUser,
	})
}

func (h *CodeFlowHandler) writeErr(w http.ResponseWriter, r *http.Request, err error) {
	var rl *app.RateLimitedError
	switch {
	case errors.As(err, &rl):
		w.Header().Set("Retry-After", itoa(rl.RetryAfterSec))
		writeJSON(w, http.StatusTooManyRequests, map[string]any{"error": "rate_limited", "retry_after": rl.RetryAfterSec})
	case errors.Is(err, domain.ErrCodeAlreadyExists):
		writeJSON(w, http.StatusConflict, map[string]string{"error": "code_collision"})
	default:
		h.Log.WarnContext(r.Context(), "auth.code_flow.error", slog.Any("err", err))
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "internal"})
	}
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}

// itoa avoids dragging strconv into the hot-path imports for one int.
func itoa(i int) string {
	// minimal: handle the {0..9999} range we actually emit (rate-limit TTL).
	if i == 0 {
		return "0"
	}
	neg := false
	if i < 0 {
		neg = true
		i = -i
	}
	var buf [12]byte
	pos := len(buf)
	for i > 0 {
		pos--
		buf[pos] = byte('0' + i%10)
		i /= 10
	}
	if neg {
		pos--
		buf[pos] = '-'
	}
	return string(buf[pos:])
}

// clientIPFromRequest mirrors clientIPFromHeader but with an *http.Request.
func clientIPFromRequest(r *http.Request) string {
	return clientIPFromHeader(r.Header, r.RemoteAddr)
}
