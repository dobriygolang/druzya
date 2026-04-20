package logger

import (
	"log/slog"
	"os"
)

// New returns a structured slog logger configured for the given environment.
// In production: JSON handler at Info level. In development: text handler at Debug level.
func New(env string) *slog.Logger {
	var h slog.Handler
	switch env {
	case "production", "staging":
		h = slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo})
	default:
		h = slog.NewTextHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelDebug})
	}
	return slog.New(h)
}
