// Package app — vacancies use cases. Each file owns one verb.
//
//	sync.go    — periodic background pull from every registered Parser
//	analyze.go — single-URL paste-the-link UX (POST /vacancies/analyze)
//	list.go    — paginated read for the catalogue page
//	save.go    — per-user kanban CRUD
package app

import (
	"context"
	"log/slog"
	"time"

	"druz9/vacancies/domain"
)

// SyncJob iterates every registered parser, upserts the parsed batch into
// vacancies, then asynchronously calls the SkillExtractor for any row whose
// normalized_skills slice is empty.
//
// Designed to be safe to run from a Background goroutine: any parser-level
// error is logged and the loop continues to the next source. The extractor
// runs inline (sequentially) — the OpenRouter client has its own retry/timeout
// so we don't need a worker pool until we have data to justify one.
type SyncJob struct {
	Parsers   []domain.Parser
	Repo      domain.VacancyRepo
	Extractor domain.SkillExtractor
	Log       *slog.Logger
	// Interval is the period between Run-loop ticks. Default 1h.
	Interval time.Duration
	// PerSourceTimeout caps how long a single Parser.Fetch can take.
	PerSourceTimeout time.Duration
}

// Run is the long-running loop wired into Module.Background. It fires once
// immediately so dev environments don't wait an hour for the first batch,
// then ticks at Interval until ctx is done.
func (s *SyncJob) Run(ctx context.Context) {
	if s.Interval <= 0 {
		s.Interval = time.Hour
	}
	if s.PerSourceTimeout <= 0 {
		s.PerSourceTimeout = 2 * time.Minute
	}
	if s.Log == nil {
		s.Log = slog.New(slog.NewTextHandler(noopWriter{}, nil))
	}
	t := time.NewTicker(s.Interval)
	defer t.Stop()
	s.RunOnce(ctx)
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			s.RunOnce(ctx)
		}
	}
}

// RunOnce performs a single sync pass over every parser. Exposed so tests
// (and admin tools) can trigger it without spinning up the loop.
func (s *SyncJob) RunOnce(ctx context.Context) {
	for _, p := range s.Parsers {
		s.runOneParser(ctx, p)
	}
}

func (s *SyncJob) runOneParser(ctx context.Context, p domain.Parser) {
	if s.Log == nil {
		s.Log = slog.New(slog.NewTextHandler(noopWriter{}, nil))
	}
	if s.PerSourceTimeout <= 0 {
		s.PerSourceTimeout = 2 * time.Minute
	}
	pctx, cancel := context.WithTimeout(ctx, s.PerSourceTimeout)
	defer cancel()
	items, err := p.Fetch(pctx)
	if err != nil {
		s.Log.Warn("vacancies.sync: parser.Fetch failed",
			slog.String("source", string(p.Source())),
			slog.Any("err", err))
		return
	}
	for i := range items {
		v := items[i]
		v.Source = p.Source() // safety — parsers should already set it
		if v.ExternalID == "" || v.Title == "" {
			continue
		}
		id, err := s.Repo.UpsertByExternal(pctx, &v)
		if err != nil {
			s.Log.Warn("vacancies.sync: upsert failed",
				slog.String("source", string(p.Source())),
				slog.String("ext_id", v.ExternalID),
				slog.Any("err", err))
			continue
		}
		// Skip extraction if the parser already produced normalised skills
		// AND the upsert was an update (NormalizedSkills is preserved on
		// conflict — see UpsertByExternal). Best-effort: when in doubt,
		// re-run; the cache prevents re-billing.
		if s.Extractor == nil {
			continue
		}
		skills, err := s.Extractor.Extract(pctx, v.Description)
		if err != nil {
			s.Log.Warn("vacancies.sync: extractor failed",
				slog.Int64("id", id), slog.Any("err", err))
			continue
		}
		// Merge parser raw_skills with LLM skills before persisting.
		merged := domain.NormalizeSkills(append(append([]string{}, v.RawSkills...), skills...))
		if err := s.Repo.UpdateNormalizedSkills(pctx, id, merged); err != nil {
			s.Log.Warn("vacancies.sync: update normalized_skills failed",
				slog.Int64("id", id), slog.Any("err", err))
		}
	}
	s.Log.Info("vacancies.sync: source done",
		slog.String("source", string(p.Source())),
		slog.Int("count", len(items)))
}

type noopWriter struct{}

func (noopWriter) Write(p []byte) (int, error) { return len(p), nil }
