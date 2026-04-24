package app

import (
	"context"
	"fmt"
	"log/slog"

	"druz9/copilot/domain"

	"github.com/google/uuid"
)

// RunAnalysis — executed by the SessionEnded bus subscriber. Not an RPC
// entry point (the desktop never calls this directly). Orchestrates:
//  1. Load session; skip if not interview / byok / missing.
//  2. Load conversations + their messages.
//  3. Mark report running.
//  4. Call Analyzer (LLM).
//  5. Write result OR mark failed.
//
// The use case swallows all errors into the report row — we don't want
// a single bad analysis to crash the subscriber loop.
type RunAnalysis struct {
	Sessions domain.SessionRepo
	Messages domain.MessageRepo
	Reports  domain.ReportRepo
	Analyzer domain.Analyzer
	// ReportURLFor renders a stable Druzya-web URL for a session id.
	// Populated by the monolith wiring from LLMAnalyzer.ReportURLFor.
	ReportURLFor func(sessionID string) string
	Log          *slog.Logger
}

type RunAnalysisInput struct {
	SessionID uuid.UUID
}

func (uc *RunAnalysis) Do(ctx context.Context, in RunAnalysisInput) error {
	s, err := uc.Sessions.Get(ctx, in.SessionID)
	if err != nil {
		return fmt.Errorf("copilot.RunAnalysis: load session: %w", err)
	}
	// Only interview sessions get a report. Other kinds were already
	// skipped at EndSession time (no report row seeded) — this is a
	// defense-in-depth guard.
	if s.Kind != domain.SessionKindInterview {
		return nil
	}
	// BYOK-only: the desktop client owns the analysis path; server
	// stays out entirely.
	if s.BYOKOnly {
		return nil
	}

	if mrErr := uc.Reports.MarkRunning(ctx, in.SessionID); mrErr != nil {
		// Not fatal — could be that another worker beat us to it or
		// the row was manually deleted. Continue and let Write sort it.
		if uc.Log != nil {
			uc.Log.Warn("copilot.RunAnalysis: mark running failed", "err", mrErr, "session", in.SessionID)
		}
	}

	convs, err := uc.Sessions.ListConversations(ctx, in.SessionID)
	if err != nil {
		uc.fail(ctx, in.SessionID, err)
		return fmt.Errorf("copilot.RunAnalysis: list conversations: %w", err)
	}
	msgs := make(map[uuid.UUID][]domain.Message, len(convs))
	for _, c := range convs {
		mm, lErr := uc.Messages.List(ctx, c.ID)
		if lErr != nil {
			uc.fail(ctx, in.SessionID, lErr)
			return fmt.Errorf("copilot.RunAnalysis: list messages: %w", lErr)
		}
		msgs[c.ID] = mm
	}

	result, err := uc.Analyzer.Analyze(ctx, domain.AnalyzerInput{
		Session:          s,
		Conversations:    convs,
		MessagesByConvID: msgs,
	})
	if err != nil {
		uc.fail(ctx, in.SessionID, err)
		return fmt.Errorf("copilot.RunAnalysis: analyze: %w", err)
	}

	reportURL := ""
	if uc.ReportURLFor != nil {
		reportURL = uc.ReportURLFor(in.SessionID.String())
	}
	if wErr := uc.Reports.Write(ctx, in.SessionID, result, reportURL); wErr != nil {
		uc.fail(ctx, in.SessionID, wErr)
		return fmt.Errorf("copilot.RunAnalysis: write: %w", wErr)
	}
	return nil
}

func (uc *RunAnalysis) fail(ctx context.Context, id uuid.UUID, err error) {
	if ferr := uc.Reports.Fail(ctx, id, err.Error()); ferr != nil && uc.Log != nil {
		uc.Log.Warn("copilot.RunAnalysis: mark failed also failed", "err", ferr, "session", id)
	}
}
