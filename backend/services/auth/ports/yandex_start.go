// yandex_start.go — REST endpoint для запуска OAuth-flow Yandex.
//
// Endpoint генерирует одноразовые state и PKCE code_verifier, сохраняет пару
// в Redis с TTL, и возвращает authorize-URL фронту. Фронт делает редирект на
// этот URL; при callback /api/v1/auth/yandex консьюмит state и достаёт
// verifier для завершения PKCE-обмена. Это anti-CSRF + защита от code
// interception (MITM на редиректе).
//
//	POST /api/v1/auth/yandex/start  → 200 {authorize_url, state, expires_at}
//	                                → 429 {error, retry_after}
package ports

import (
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"time"

	"druz9/auth/app"
)

// YandexStartHandler — REST-handler для /api/v1/auth/yandex/start.
type YandexStartHandler struct {
	Start *app.StartLoginYandex
	Log   *slog.Logger
}

// NewYandexStartHandler оборачивает use case в chi-совместимый handler.
func NewYandexStartHandler(start *app.StartLoginYandex, log *slog.Logger) *YandexStartHandler {
	return &YandexStartHandler{Start: start, Log: log}
}

type yandexStartRequest struct {
	// RedirectURI приходит с фронта — в разных окружениях разный origin
	// (local/stage/prod), поэтому не хардкодим на сервере.
	RedirectURI string `json:"redirect_uri"`
}

type yandexStartResponse struct {
	AuthorizeURL string    `json:"authorize_url"`
	State        string    `json:"state"`
	ExpiresAt    time.Time `json:"expires_at"`
}

// ServeHTTP — POST-only endpoint.
func (h *YandexStartHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var req yandexStartRequest
	// Пустое тело допустимо — RedirectURI опционален (бэку он для построения
	// URL не критичен, Yandex может подставить зарегистрированный в кабинете).
	if r.ContentLength > 0 {
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "bad_request"})
			return
		}
	}
	res, err := h.Start.Do(r.Context(), app.StartLoginYandexInput{
		RedirectURI: req.RedirectURI,
		IP:          clientIPFromRequest(r),
	})
	if err != nil {
		var rl *app.RateLimitedError
		switch {
		case errors.As(err, &rl):
			w.Header().Set("Retry-After", itoa(rl.RetryAfterSec))
			writeJSON(w, http.StatusTooManyRequests, map[string]any{"error": "rate_limited", "retry_after": rl.RetryAfterSec})
			return
		default:
			h.Log.WarnContext(r.Context(), "auth.yandex_start.error", slog.Any("err", err))
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "internal"})
			return
		}
	}
	writeJSON(w, http.StatusOK, yandexStartResponse{
		AuthorizeURL: res.AuthorizeURL,
		State:        res.State,
		ExpiresAt:    res.ExpiresAt,
	})
}
