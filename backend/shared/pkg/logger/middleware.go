package logger

import (
	"log/slog"
	"net/http"

	"github.com/google/uuid"
)

// Middleware прикрепляет к контексту запроса *slog.Logger.
// Уже привязанные атрибуты: request_id, method, path. trace_id добавляется
// автоматически в traceHandler, когда активен span.
//
// Используйте logger.FromContext(ctx) в любом нижестоящем коде (handler'ы,
// сервисы app, infra-репозитории), чтобы получить logger со всеми этими
// атрибутами без ручного проброса.
func Middleware(base *slog.Logger) func(http.Handler) http.Handler {
	if base == nil {
		base = slog.Default()
	}
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			rid := r.Header.Get("X-Request-ID")
			if rid == "" {
				rid = uuid.NewString()
			}
			w.Header().Set("X-Request-ID", rid)
			l := base.With(
				slog.String("request_id", rid),
				slog.String("method", r.Method),
				slog.String("path", r.URL.Path),
			)
			next.ServeHTTP(w, r.WithContext(WithLogger(r.Context(), l)))
		})
	}
}
