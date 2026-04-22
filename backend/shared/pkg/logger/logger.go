package logger

import (
	"log/slog"
	"os"
)

// New возвращает структурированный slog logger, настроенный под указанное окружение.
// В production: JSON handler на уровне Info. В dev: текстовый handler на уровне Debug.
func New(env string) *slog.Logger {
	var h slog.Handler
	switch env {
	case "production", "staging":
		h = slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo})
	default:
		h = slog.NewTextHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelDebug})
	}
	return slog.New(&traceHandler{inner: h})
}
