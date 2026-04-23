// Package parsers contains source-specific parser implementations.
//
// Each parser maps a single careers site (Yandex, Ozon, VK, MTS,
// Wildberries…) onto the domain.Parser contract. Adding a new source means:
// implement Parser in its own file, add a constructor, append to
// RegisterAll. The hourly sync iterates the returned slice without knowing
// anything about each source.
//
// Verified live (response shape confirmed via curl 2026-04-23):
//
//	yandex      yandex.ru/jobs/api/publications      (DRF, count=1364)
//	ozon        job-ozon-api.t.o3.ru/v2/vacancy      (Origin header required)
//	vk          team.vk.company/career/api/v2/vacancies/  (DRF, count=306)
//	mts         job.mts.ru/api/v2/vacancies          (Strapi, total=2363)
//	wildberries career.rwb.ru/crm-api/api/v1/pub/vacancies (count=538)
//
// HH.ru's job-seeker API was sunset 2025-12-15 — integration is gone.
//
// Anti-fallback policy: NEVER register a stub parser. A "registered" source
// that always returns 0 vacancies makes the frontend's filter sidebar
// promise data that doesn't exist; users blame the search, ops can't tell
// whether the source genuinely has nothing or our parser is broken. If a
// careers site can't be scraped — or hasn't been verified end-to-end with a
// real curl against the real wire shape — leave it OUT of RegisterAll. The
// constants in domain/entity.go can stay so historical rows still validate.
//
// Currently OUT (unverified): tinkoff, sber, ozontech, avito, kaspersky,
// jetbrains, lamoda. Each will be wired in as it's verified individually.
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
// To add a new source: verify its endpoint with a real curl, implement the
// Parser interface in its own file, append here. NEVER register a stub.
func RegisterAll(cfg Config) []domain.Parser {
	if cfg.Log == nil {
		panic("vacancies.parsers.RegisterAll: logger is required (anti-fallback policy: no silent noop loggers)")
	}
	return []domain.Parser{
		NewYandex(cfg.Log),
		NewOzon(cfg.Log),
		NewVK(cfg.Log),
		NewMTS(cfg.Log),
		NewWildberries(cfg.Log),
	}
}
