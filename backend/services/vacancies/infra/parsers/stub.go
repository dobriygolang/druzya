package parsers

import (
	"context"
	"log/slog"

	"druz9/vacancies/domain"
)

// StubParser is a placeholder for sources whose careers page is too dynamic
// to scrape today (heavy SPA, no JSON blob, no public API). It satisfies
// domain.Parser, returns zero vacancies, and logs once at boot.
type StubParser struct {
	source  domain.Source
	baseURL string
	log     *slog.Logger
}

// NewStub returns a stub for the given source. Logs a warning once so we
// remember to come back and implement the real one.
func NewStub(source domain.Source, baseURL string, log *slog.Logger) *StubParser {
	if log == nil {
		log = slog.New(slog.NewTextHandler(noopWriter{}, nil))
	}
	log.Warn("vacancies.parser: using stub (not implemented)",
		slog.String("source", string(source)),
		slog.String("base_url", baseURL))
	return &StubParser{source: source, baseURL: baseURL, log: log}
}

// Source implements domain.Parser.
func (s *StubParser) Source() domain.Source { return s.source }

// Fetch always returns an empty slice; never errors so it doesn't break
// the sync loop.
func (s *StubParser) Fetch(_ context.Context) ([]domain.Vacancy, error) {
	return []domain.Vacancy{}, nil
}
