// Package middleware предоставляет HTTP middleware, общий для сервисов.
package middleware

import (
	"context"
	"log/slog"
	"net/http"
	"time"

	"github.com/google/uuid"
)

type ctxKey string

const (
	ctxKeyRequestID ctxKey = "request_id"
	ctxKeyUserID    ctxKey = "user_id"
	ctxKeyUserRole  ctxKey = "user_role"
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

// WithUserID injects the authenticated user into the context. Used by auth middleware.
func WithUserID(ctx context.Context, id uuid.UUID) context.Context {
	return context.WithValue(ctx, ctxKeyUserID, id)
}

// UserRoleFromContext returns the authenticated user's role.
func UserRoleFromContext(ctx context.Context) (string, bool) {
	v, ok := ctx.Value(ctxKeyUserRole).(string)
	return v, ok
}

// WithUserRole injects the user role into the context.
func WithUserRole(ctx context.Context, role string) context.Context {
	return context.WithValue(ctx, ctxKeyUserRole, role)
}

type statusWriter struct {
	http.ResponseWriter
	status int
}

func (s *statusWriter) WriteHeader(code int) {
	s.status = code
	s.ResponseWriter.WriteHeader(code)
}

// Flush forwards to the underlying ResponseWriter if it implements http.Flusher.
// Required by Connect-RPC / vanguard-go: the transcoder rejects any wrapper
// that doesn't forward Flush, because streaming protocols need incremental
// response delivery.
func (s *statusWriter) Flush() {
	if f, ok := s.ResponseWriter.(http.Flusher); ok {
		f.Flush()
	}
}
