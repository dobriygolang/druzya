// Package parsers contains source-specific parser implementations.
//
// Each parser maps a single careers site (HH, Yandex, Ozon, T-Bank, VK) onto
// the domain.Parser contract. Adding a new source means: implement Parser
// in its own file, add a constructor, append to RegisterAll. The hourly
// sync iterates the returned slice without knowing anything about each
// source.
//
// Anti-fallback policy: NEVER register a stub parser. A "registered" source
// that always returns 0 vacancies makes the frontend's filter sidebar
// promise data that doesn't exist; users blame the search, ops can't tell
// whether the source genuinely has nothing or our parser is broken. If a
// careers site can't be scraped, leave it out of the enum + registry until
// someone implements the real one.
package parsers

import (
	"log/slog"

	"druz9/vacancies/domain"
)

// Config bundles the per-parser knobs the registry needs at construction
// time. Currently only Logger; extend as we add sources with secrets.
type Config struct {
	Log *slog.Logger
}

// RegisterAll returns every parser the monolith should run. Order is
// significant only insofar as logs are interleaved.
//
// To add a new source: implement Parser interface in own file, append to
// RegisterAll. NEVER register a stub.
func RegisterAll(cfg Config) []domain.Parser {
	if cfg.Log == nil {
		panic("vacancies.parsers.RegisterAll: logger is required (anti-fallback policy: no silent noop loggers)")
	}
	return []domain.Parser{
		NewHH(cfg.Log),
		NewYandex(cfg.Log),
		NewOzon(cfg.Log),
		NewTinkoff(cfg.Log),
		NewVK(cfg.Log),
	}
}
