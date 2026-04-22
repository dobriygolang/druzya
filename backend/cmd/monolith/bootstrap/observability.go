// Observability primitives — slog, OpenTelemetry tracer, build version.
//
// Build version is overridden at link-time via `-ldflags '-X
// druz9/cmd/monolith/bootstrap.buildVersion=...'` and surfaced as the
// `service.version` resource attribute on every span.
package bootstrap

import (
	"log/slog"

	"druz9/shared/pkg/logger"
	dotel "druz9/shared/pkg/otel"
)

// BuildVersion is set at link-time. Exported so the linker flag can target
// `druz9/cmd/monolith/bootstrap.BuildVersion`.
var BuildVersion = "dev"

func newLogger(env string) *slog.Logger {
	log := logger.New(env)
	slog.SetDefault(log)
	return log
}

// initTracer wires OTel and returns a shutdown closure. A failure is
// non-fatal — we log a warning and continue with traces disabled, keeping
// the same behaviour as the pre-refactor monolith.
func initTracer(log *slog.Logger) func() {
	shutdown, err := dotel.InitTracer("druz9-monolith", BuildVersion)
	if err != nil {
		log.Warn("otel init failed (continuing without traces)", "err", err)
		return func() {}
	}
	return shutdown
}
