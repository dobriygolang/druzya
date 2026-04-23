// Package parsers contains source-specific parser implementations.
//
// Each parser maps a single careers site (HH, Yandex, Ozon, T-Bank, VK) onto
// the domain.Parser contract. Adding a new source means: implement Parser,
// add a constructor, append to RegisterAll. The hourly sync iterates the
// returned slice without knowing anything about each source.
//
// Stubs: not every Russian-market careers page exposes a usable JSON or
// scrapeable HTML structure. Where the page is dynamic enough to make
// hand-rolled scraping a liability, we ship a stub parser that returns 0
// vacancies and logs once at construction. The pipeline still works end-to-
// end and adding a real parser later is a one-file change.
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
func RegisterAll(cfg Config) []domain.Parser {
	if cfg.Log == nil {
		cfg.Log = slog.New(slog.NewTextHandler(noopWriter{}, nil))
	}
	return []domain.Parser{
		NewHH(cfg.Log),
		NewYandex(cfg.Log),
		NewOzon(cfg.Log),
		NewTinkoff(cfg.Log),
		NewVK(cfg.Log),
		// Sber, Avito, Wildberries, MTS, Kaspersky, JetBrains, Lamoda —
		// stubs for now. They get parser slots in the registry so the
		// frontend's source filter shows them as "supported", but Fetch
		// returns 0 until someone wires a real scraper.
		NewStub(domain.SourceSber, "https://sbergile.ru/", cfg.Log),
		NewStub(domain.SourceAvito, "https://avito.tech/", cfg.Log),
		NewStub(domain.SourceWildberries, "https://career.wb.ru/", cfg.Log),
		NewStub(domain.SourceMTS, "https://job.mts.ru/", cfg.Log),
		NewStub(domain.SourceKaspersky, "https://career.kaspersky.com/", cfg.Log),
		NewStub(domain.SourceJetBrains, "https://www.jetbrains.com/careers/", cfg.Log),
		NewStub(domain.SourceLamoda, "https://lamoda.tech/", cfg.Log),
	}
}

// noopWriter is the default sink for nil logger.
type noopWriter struct{}

func (noopWriter) Write(p []byte) (int, error) { return len(p), nil }
