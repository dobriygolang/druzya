// Package middleware предоставляет HTTP middleware, общий для сервисов.
package middleware

import (
	"bufio"
	"context"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"time"

	"github.com/google/uuid"
)

type ctxKey string

const (
	ctxKeyRequestID ctxKey = "request_id"
	ctxKeyUserID    ctxKey = "user_id"
	ctxKeyUserRole  ctxKey = "user_role"
	ctxKeyUserTier  ctxKey = "user_tier"
)

// RequestID генерирует или прокидывает X-Request-ID.
func RequestID(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		rid := r.Header.Get("X-Request-ID")
		if rid == "" {
			rid = uuid.NewString()
		}
		w.Header().Set("X-Request-ID", rid)
		ctx := context.WithValue(r.Context(), ctxKeyRequestID, rid)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

// Logger логирует каждый запрос со статус-кодом и latency.
func Logger(log *slog.Logger) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			start := time.Now()
			sw := &statusWriter{ResponseWriter: w, status: http.StatusOK}
			next.ServeHTTP(sw, r)
			log.InfoContext(r.Context(), "http",
				slog.String("method", r.Method),
				slog.String("path", r.URL.Path),
				slog.Int("status", sw.status),
				slog.Duration("latency", time.Since(start)),
				slog.String("request_id", RequestIDFromContext(r.Context())),
			)
		})
	}
}

// Recover ловит panic и возвращает 500, не убивая сервер.
func Recover(log *slog.Logger) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			defer func() {
				if rec := recover(); rec != nil {
					log.ErrorContext(r.Context(), "panic",
						slog.Any("recover", rec),
						slog.String("path", r.URL.Path),
					)
					http.Error(w, `{"error":{"code":"internal","message":"internal error"}}`, http.StatusInternalServerError)
				}
			}()
			next.ServeHTTP(w, r)
		})
	}
}

// RequestIDFromContext извлекает request ID, добавленный middleware RequestID.
func RequestIDFromContext(ctx context.Context) string {
	if v, ok := ctx.Value(ctxKeyRequestID).(string); ok {
		return v
	}
	return ""
}

// UserIDFromContext извлекает ID аутентифицированного пользователя, добавленного auth middleware.
func UserIDFromContext(ctx context.Context) (uuid.UUID, bool) {
	v, ok := ctx.Value(ctxKeyUserID).(uuid.UUID)
	return v, ok
}

// WithUserID кладёт аутентифицированного пользователя в контекст. Используется auth middleware.
func WithUserID(ctx context.Context, id uuid.UUID) context.Context {
	return context.WithValue(ctx, ctxKeyUserID, id)
}

// UserRoleFromContext возвращает роль аутентифицированного пользователя.
func UserRoleFromContext(ctx context.Context) (string, bool) {
	v, ok := ctx.Value(ctxKeyUserRole).(string)
	return v, ok
}

// WithUserRole кладёт роль пользователя в контекст.
func WithUserRole(ctx context.Context, role string) context.Context {
	return context.WithValue(ctx, ctxKeyUserRole, role)
}

// UserTierFromContext извлекает subscription tier'а пользователя. Возвращает
// пустую строку если middleware не резолвила его (например юзер неавторизован,
// subscription-service недоступен — graceful fail-open).
// Caller-ы LLM-chain-а (copilot, vacancies, profile) читают это значение и
// кладут в llmchain.Request.UserTier для paid-model gate'а.
func UserTierFromContext(ctx context.Context) string {
	v, _ := ctx.Value(ctxKeyUserTier).(string)
	return v
}

// WithUserTier кладёт tier в контекст. Используется middleware резолвером
// подписки (см. cmd/monolith/bootstrap/router.go) после auth middleware.
func WithUserTier(ctx context.Context, tier string) context.Context {
	return context.WithValue(ctx, ctxKeyUserTier, tier)
}

type statusWriter struct {
	http.ResponseWriter
	status int
}

func (s *statusWriter) WriteHeader(code int) {
	s.status = code
	s.ResponseWriter.WriteHeader(code)
}

// Flush форвардит вызов в нижележащий ResponseWriter, если тот реализует http.Flusher.
// Требуется Connect-RPC / vanguard-go: транскодер отвергает любую обёртку,
// которая не форвардит Flush, поскольку стриминг-протоколам нужна
// инкрементальная доставка ответа.
func (s *statusWriter) Flush() {
	if f, ok := s.ResponseWriter.(http.Flusher); ok {
		f.Flush()
	}
}

// Hijack пробрасывает в нижележащий ResponseWriter, чтобы WebSocket upgrade
// (gorilla/websocket) мог взять TCP-conn под контроль. Без этого все WS
// endpoints возвращают «response does not implement http.Hijacker».
func (s *statusWriter) Hijack() (net.Conn, *bufio.ReadWriter, error) {
	h, ok := s.ResponseWriter.(http.Hijacker)
	if !ok {
		return nil, nil, http.ErrNotSupported
	}
	conn, rw, err := h.Hijack()
	if err != nil {
		return nil, nil, fmt.Errorf("middleware.statusWriter.Hijack: %w", err)
	}
	return conn, rw, nil
}
