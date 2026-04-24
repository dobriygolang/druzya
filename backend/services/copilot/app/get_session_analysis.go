package app

import (
	"context"
	"errors"
	"fmt"

	"druz9/copilot/domain"

	"github.com/google/uuid"
)

// GetSessionAnalysis — polled by the desktop while the analyzer works.
// Returns a zero-value "still pending" report when the analyzer hasn't
// picked up the event yet (vs NotFound, which means the session never
// ended or belongs to someone else).
type GetSessionAnalysis struct {
	Sessions domain.SessionRepo
	Reports  domain.ReportRepo
}

type GetSessionAnalysisInput struct {
	UserID    uuid.UUID
	SessionID uuid.UUID
}

func (uc *GetSessionAnalysis) Do(ctx context.Context, in GetSessionAnalysisInput) (domain.SessionReport, error) {
	// Ownership guard — the session row has user_id; the report row
	// doesn't. Load the session first.
	s, err := uc.Sessions.Get(ctx, in.SessionID)
	if err != nil {
		return domain.SessionReport{}, fmt.Errorf("copilot.GetSessionAnalysis: %w", err)
	}
	if s.UserID != in.UserID {
		return domain.SessionReport{}, fmt.Errorf("copilot.GetSessionAnalysis: %w", domain.ErrNotFound)
	}

	report, err := uc.Reports.Get(ctx, in.SessionID)
	if err != nil {
		if errors.Is(err, domain.ErrNotFound) {
			// Session ended but no report was seeded — usually a non-interview
			// kind. Return a synthetic "not applicable" report so the
			// client can render "no analysis for this session kind".
			return domain.SessionReport{
				SessionID: in.SessionID,
				Status:    domain.AnalysisStatusReady,
				ReportMarkdown: "Анализ не проводится для сессий этого типа. " +
					"Только 'interview' попадает в пост-разбор.",
			}, nil
		}
		return domain.SessionReport{}, fmt.Errorf("copilot.GetSessionAnalysis: %w", err)
	}
	return report, nil
}
