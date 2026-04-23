package parsers

import (
	"io"
	"log/slog"
)

// testLog returns an explicit discard logger for unit tests. Constructors
// panic on nil log (anti-fallback policy: no silent noop loggers); tests use
// io.Discard explicitly to make their silence intentional.
func testLog() *slog.Logger {
	return slog.New(slog.NewTextHandler(io.Discard, nil))
}

func contains(xs []string, x string) bool {
	for _, y := range xs {
		if y == x {
			return true
		}
	}
	return false
}
