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
	"strings"
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
	// PerSourceTimeout caps how long a single Parser.Fetch can take. Note:
	// extractor budget is separate (ExtractTimeout) — the per-source budget
	// exists to bound the parser's HTTP work + the upsert hot loop.
	PerSourceTimeout time.Duration
	// ExtractTimeout caps Phase 2 (LLM skill extraction) per source. Default
	// 60s — the goal is "best effort, never block the user-visible catalogue
	// from getting populated even if OpenRouter is degraded".
	ExtractTimeout time.Duration
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
		panic("vacancies.app.SyncJob: Log is required (anti-fallback policy: no silent noop loggers)")
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
		panic("vacancies.app.SyncJob: Log is required (anti-fallback policy: no silent noop loggers)")
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

	// Phase 1 — fast upsert loop. Extractor is intentionally NOT called here:
	// a slow/failing LLM would otherwise eat the per-source timeout and
	// starve the upserts, leaving the catalogue empty even though HH returned
	// 100 fresh vacancies (production bug #15). Skill extraction is now a
	// best-effort second phase under its own short budget.
	type extractTarget struct {
		id        int64
		desc      string
		rawSkills []string
	}
	pending := make([]extractTarget, 0, len(items))
	upserted := 0
	for i := range items {
		v := items[i]
		v.Source = p.Source() // safety — parsers should already set it
		if v.ExternalID == "" || v.Title == "" {
			continue
		}
		id, uerr := s.Repo.UpsertByExternal(pctx, &v)
		if uerr != nil {
			s.Log.Warn("vacancies.sync: upsert failed",
				slog.String("source", string(p.Source())),
				slog.String("ext_id", v.ExternalID),
				slog.Any("err", uerr))
			continue
		}
		upserted++
		// Only schedule extraction when the parser returned NO skills — the
		// LLM is best-effort and the OpenRouter cache makes re-runs cheap,
		// but we still want to keep the budget tight.
		if s.Extractor != nil && len(v.NormalizedSkills) == 0 && strings.TrimSpace(v.Description) != "" {
			pending = append(pending, extractTarget{id: id, desc: v.Description, rawSkills: v.RawSkills})
		}
	}
	s.Log.Info("vacancies.sync: source upsert phase done",
		slog.String("source", string(p.Source())),
		slog.Int("fetched", len(items)),
		slog.Int("upserted", upserted),
		slog.Int("pending_extract", len(pending)))

	// Phase 2 — best-effort extraction. Bounded by ExtractTimeout (default
	// 60s) so a hung LLM never blocks the next source. Errors are logged at
	// Warn but never surface to the user.
	if len(pending) == 0 || s.Extractor == nil {
		return
	}
	extractTimeout := s.ExtractTimeout
	if extractTimeout <= 0 {
		extractTimeout = 60 * time.Second
	}
	ectx, ecancel := context.WithTimeout(ctx, extractTimeout)
	defer ecancel()
	extracted := 0
	for _, t := range pending {
		if ectx.Err() != nil {
			s.Log.Info("vacancies.sync: extract phase budget exhausted",
				slog.String("source", string(p.Source())),
				slog.Int("done", extracted),
				slog.Int("remaining", len(pending)-extracted))
			break
		}
		skills, err := s.Extractor.Extract(ectx, t.desc)
		if err != nil {
			s.Log.Warn("vacancies.sync: extractor failed",
				slog.Int64("id", t.id), slog.Any("err", err))
			continue
		}
		merged := domain.NormalizeSkills(append(append([]string{}, t.rawSkills...), skills...))
		if err := s.Repo.UpdateNormalizedSkills(ectx, t.id, merged); err != nil {
			s.Log.Warn("vacancies.sync: update normalized_skills failed",
				slog.Int64("id", t.id), slog.Any("err", err))
			continue
		}
		extracted++
	}
	s.Log.Info("vacancies.sync: source done",
		slog.String("source", string(p.Source())),
		slog.Int("count", len(items)),
		slog.Int("upserted", upserted),
		slog.Int("extracted", extracted))
}
