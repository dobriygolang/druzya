package logger

import (
	"context"
	"log/slog"
	"os"
	"strings"

	"go.opentelemetry.io/otel/trace"
)

// Init собирает канонический slog-handler сервиса.
//
//   - JSON в stdout (Promtail подхватывает и шлёт в Loki)
//   - Уровень из LOG_LEVEL (debug/info/warn/error), по умолчанию info
//   - В каждую запись добавляется `service` и, если в контексте есть span,
//     `trace_id` + `span_id` (чтобы Grafana умела переходить log → trace).
//   - request_id добавляется chi-middleware в middleware.go.
func Init(serviceName string) *slog.Logger {
	level := parseLevel(os.Getenv("LOG_LEVEL"))
	base := slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: level})
	h := &traceHandler{inner: base}
	return slog.New(h).With(slog.String("service", serviceName))
}

func parseLevel(s string) slog.Level {
	switch strings.ToLower(s) {
	case "debug":
		return slog.LevelDebug
	case "warn", "warning":
		return slog.LevelWarn
	case "error":
		return slog.LevelError
	default:
		return slog.LevelInfo
	}
}

// traceHandler оборачивает другой slog.Handler и копирует trace_id / span_id
// активного span'а в каждую запись. Когда span'а нет, расходы — один map-lookup
// на каждый вызов log.
type traceHandler struct{ inner slog.Handler }

func (h *traceHandler) Enabled(ctx context.Context, l slog.Level) bool {
	return h.inner.Enabled(ctx, l)
}

func (h *traceHandler) Handle(ctx context.Context, r slog.Record) error {
	if sc := trace.SpanContextFromContext(ctx); sc.IsValid() {
		r.AddAttrs(
			slog.String("trace_id", sc.TraceID().String()),
			slog.String("span_id", sc.SpanID().String()),
		)
	}
	return h.inner.Handle(ctx, r)
}

func (h *traceHandler) WithAttrs(a []slog.Attr) slog.Handler {
	return &traceHandler{inner: h.inner.WithAttrs(a)}
}

func (h *traceHandler) WithGroup(name string) slog.Handler {
	return &traceHandler{inner: h.inner.WithGroup(name)}
}
