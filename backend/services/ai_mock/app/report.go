package app

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"druz9/ai_mock/domain"

	"github.com/google/uuid"
)

// ReportStatus is the computed state of a report request.
type ReportStatus string

const (
	// ReportStatusProcessing is returned when the report job has not yet written
	// ai_report. Matches the 202-style contract in the bible ("return stub until
	// ready, or 200 with status=processing").
	ReportStatusProcessing ReportStatus = "processing"
	// ReportStatusReady is returned when ai_report is populated.
	ReportStatusReady ReportStatus = "ready"
)

// GetReport implements GET /api/v1/mock/session/:id/report.
type GetReport struct {
	Sessions domain.SessionRepo
}

// GetReportResult carries the status + optional report draft.
type GetReportResult struct {
	Status    ReportStatus
	SessionID uuid.UUID
	Report    domain.ReportDraft
	ReplayURL string
}

// Do loads the session, returns the parsed report if ready.
func (uc *GetReport) Do(ctx context.Context, userID, sessionID uuid.UUID) (GetReportResult, error) {
	s, err := uc.Sessions.Get(ctx, sessionID)
	if err != nil {
		return GetReportResult{}, fmt.Errorf("mock.GetReport: %w", err)
	}
	if s.UserID != userID {
		return GetReportResult{}, fmt.Errorf("mock.GetReport: %w", domain.ErrForbidden)
	}
	if len(s.Report) == 0 {
		return GetReportResult{Status: ReportStatusProcessing, SessionID: sessionID}, nil
	}
	var draft domain.ReportDraft
	if err := json.Unmarshal(s.Report, &draft); err != nil {
		return GetReportResult{}, fmt.Errorf("mock.GetReport: parse draft: %w", err)
	}
	return GetReportResult{
		Status:    ReportStatusReady,
		SessionID: sessionID,
		Report:    draft,
		ReplayURL: s.ReplayURL,
	}, nil
}

// ParseReportJSON parses an LLM response body that should be a JSON object
// matching the ReportDraft shape. The LLM sometimes wraps JSON in fences or
// prepends commentary; this helper tries to strip that.
func ParseReportJSON(raw string) (domain.ReportDraft, error) {
	s := strings.TrimSpace(raw)
	// Strip markdown fencing if present.
	if strings.HasPrefix(s, "```") {
		if idx := strings.Index(s, "\n"); idx > 0 {
			s = s[idx+1:]
		}
		if end := strings.LastIndex(s, "```"); end >= 0 {
			s = s[:end]
		}
	}
	// Slice to the first '{' and last '}' in case of stray prose.
	if first := strings.Index(s, "{"); first >= 0 {
		if last := strings.LastIndex(s, "}"); last >= first {
			s = s[first : last+1]
		}
	}
	var raw2 struct {
		OverallScore int `json:"overall_score"`
		Sections     struct {
			ProblemSolving domain.ScoredSection `json:"problem_solving"`
			CodeQuality    domain.ScoredSection `json:"code_quality"`
			Communication  domain.ScoredSection `json:"communication"`
			StressHandling domain.ScoredSection `json:"stress_handling"`
		} `json:"sections"`
		Strengths       []string `json:"strengths"`
		Weaknesses      []string `json:"weaknesses"`
		Recommendations []struct {
			Title       string `json:"title"`
			Description string `json:"description"`
			ActionKind  string `json:"action_kind"`
			ActionRef   string `json:"action_ref"`
		} `json:"recommendations"`
		StressAnalysis string `json:"stress_analysis"`
	}
	if err := json.Unmarshal([]byte(s), &raw2); err != nil {
		return domain.ReportDraft{}, fmt.Errorf("mock.ParseReportJSON: %w", err)
	}
	out := domain.ReportDraft{
		OverallScore: raw2.OverallScore,
		Sections: domain.ReportSections{
			ProblemSolving: raw2.Sections.ProblemSolving,
			CodeQuality:    raw2.Sections.CodeQuality,
			Communication:  raw2.Sections.Communication,
			StressHandling: raw2.Sections.StressHandling,
		},
		Strengths:      raw2.Strengths,
		Weaknesses:     raw2.Weaknesses,
		StressAnalysis: raw2.StressAnalysis,
	}
	for _, r := range raw2.Recommendations {
		out.Recommendations = append(out.Recommendations, domain.ReportRecommendation{
			Title:       r.Title,
			Description: r.Description,
			ActionKind:  r.ActionKind,
			ActionRef:   r.ActionRef,
		})
	}
	return out, nil
}
