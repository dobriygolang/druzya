package logger

import (
	"context"
	"log/slog"
)

type ctxKey struct{}

// FromContext возвращает request-scoped logger, прикреплённый middleware.
// Если такого нет (фоновые горутины, тесты и т.п.) — возвращает slog.Default(),
// чтобы вызывающему коду не приходилось проверять nil.
func FromContext(ctx context.Context) *slog.Logger {
	if ctx == nil {
		return slog.Default()
	}
	if l, ok := ctx.Value(ctxKey{}).(*slog.Logger); ok && l != nil {
		return l
	}
	return slog.Default()
}

// WithLogger возвращает новый контекст с указанным logger'ом.
func WithLogger(ctx context.Context, l *slog.Logger) context.Context {
	return context.WithValue(ctx, ctxKey{}, l)
}
