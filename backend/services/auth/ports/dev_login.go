// dev_login.go — INSECURE bypass auth handler для local development.
// Endpoint доступен ТОЛЬКО когда DEV_AUTH=true в env (gate в monolith
// wiring; handler дополнительно отдаёт 404 если nil).
//
//	POST /api/v1/auth/dev/login
//	Body: {"username": "sergey"}
//	Response: 200 {access_token, expires_in, refresh_token, user, is_new_user}
//
// Никаких HMAC, никаких codes, никаких бот'ов. Producтion deployment с
// DEV_AUTH=true — угон любого аккаунта через имя.
package ports

import (
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"

	"druz9/auth/app"
	"druz9/shared/enums"
)

// DevLoginHandler — REST handler для POST /api/v1/auth/dev/login.
// Создаётся wiring'ом ТОЛЬКО когда DEV_AUTH=true; nil-handler возвращает 404.
type DevLoginHandler struct {
	UC   *app.DevLogin
	Auth *AuthServer
	Log  *slog.Logger
}

// NewDevLoginHandler wraps the use case в HTTP-handler.
func NewDevLoginHandler(uc *app.DevLogin, auth *AuthServer, log *slog.Logger) *DevLoginHandler {
	return &DevLoginHandler{UC: uc, Auth: auth, Log: log}
}

type devLoginRequest struct {
	Username string `json:"username"`
}

func (h *DevLoginHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if h == nil || h.UC == nil {
		http.NotFound(w, r)
		return
	}
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var req devLoginRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "bad_request"})
		return
	}
	res, err := h.UC.Do(r.Context(), app.DevLoginInput{
		Username:  req.Username,
		IP:        clientIPFromRequest(r),
		UserAgent: r.Header.Get("User-Agent"),
	})
	if err != nil {
		// Single failure-mode — invalid input. Не светим внутренние детали.
		var rl *app.RateLimitedError
		if errors.As(err, &rl) {
			w.Header().Set("Retry-After", itoa(rl.RetryAfterSec))
			writeJSON(w, http.StatusTooManyRequests, map[string]any{"error": "rate_limited"})
			return
		}
		h.Log.WarnContext(r.Context(), "auth.dev_login.error", slog.Any("err", err))
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	w.Header().Add("Set-Cookie", h.Auth.setRefreshCookieString(res.Tokens.RefreshToken, res.Tokens.RefreshExpires))
	w.Header().Set("X-Refresh-Token", res.Tokens.RefreshToken)
	if res.IsNewUser {
		w.Header().Set("X-Is-New-User", "1")
	} else {
		w.Header().Set("X-Is-New-User", "0")
	}
	writeJSON(w, http.StatusOK, pollSuccessResponse{
		AccessToken:  res.Tokens.AccessToken,
		ExpiresIn:    res.Tokens.AccessExpiresIn,
		RefreshToken: res.Tokens.RefreshToken,
		User: pollUser{
			ID:        res.User.ID.String(),
			Username:  res.User.Username,
			Role:      string(res.User.Role),
			Provider:  string(enums.AuthProviderTelegram),
			AvatarURL: res.User.AvatarURL,
		},
		IsNewUser: res.IsNewUser,
	})
}
