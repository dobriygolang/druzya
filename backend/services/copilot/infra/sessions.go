package infra

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"druz9/copilot/domain"
	copilotdb "druz9/copilot/infra/db"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ─────────────────────────────────────────────────────────────────────────
// Sessions
// ─────────────────────────────────────────────────────────────────────────

type Sessions struct {
	pool *pgxpool.Pool
	q    *copilotdb.Queries
}

func NewSessions(pool *pgxpool.Pool) *Sessions {
	return &Sessions{pool: pool, q: copilotdb.New(pool)}
}

func (r *Sessions) Create(ctx context.Context, userID uuid.UUID, kind domain.SessionKind) (domain.Session, error) {
	row, err := r.q.CreateCopilotSession(ctx, copilotdb.CreateCopilotSessionParams{
		UserID: pgUUID(userID),
		Kind:   string(kind),
	})
	if err != nil {
		// The partial unique index on (user_id) WHERE finished_at IS NULL
		// fires when a live session already exists. pgx exposes this as
		// an SQLSTATE 23505 (unique_violation).
		if isUniqueViolation(err) {
			return domain.Session{}, fmt.Errorf("copilot.Sessions.Create: %w", domain.ErrLiveSessionExists)
		}
		return domain.Session{}, fmt.Errorf("copilot.Sessions.Create: %w", err)
	}
	return sessionFromRow(row), nil
}

func (r *Sessions) Get(ctx context.Context, id uuid.UUID) (domain.Session, error) {
	row, err := r.q.GetCopilotSession(ctx, pgUUID(id))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.Session{}, fmt.Errorf("copilot.Sessions.Get: %w", domain.ErrNotFound)
		}
		return domain.Session{}, fmt.Errorf("copilot.Sessions.Get: %w", err)
	}
	return sessionFromRow(row), nil
}

func (r *Sessions) GetLive(ctx context.Context, userID uuid.UUID) (domain.Session, error) {
	row, err := r.q.GetLiveCopilotSession(ctx, pgUUID(userID))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.Session{}, fmt.Errorf("copilot.Sessions.GetLive: %w", domain.ErrNotFound)
		}
		return domain.Session{}, fmt.Errorf("copilot.Sessions.GetLive: %w", err)
	}
	return sessionFromRow(row), nil
}

func (r *Sessions) End(ctx context.Context, id, userID uuid.UUID) error {
	affected, err := r.q.EndCopilotSession(ctx, copilotdb.EndCopilotSessionParams{
		ID:     pgUUID(id),
		UserID: pgUUID(userID),
	})
	if err != nil {
		return fmt.Errorf("copilot.Sessions.End: %w", err)
	}
	if affected == 0 {
		return fmt.Errorf("copilot.Sessions.End: %w", domain.ErrNotFound)
	}
	return nil
}

func (r *Sessions) MarkByok(ctx context.Context, id uuid.UUID) error {
	if _, err := r.q.MarkCopilotSessionByok(ctx, pgUUID(id)); err != nil {
		return fmt.Errorf("copilot.Sessions.MarkByok: %w", err)
	}
	return nil
}

func (r *Sessions) ListForUser(
	ctx context.Context,
	userID uuid.UUID,
	kind domain.SessionKind,
	cursor domain.Cursor,
	limit int,
) ([]domain.SessionSummary, domain.Cursor, error) {
	if limit <= 0 {
		limit = 20
	} else if limit > 50 {
		limit = 50
	}

	isFirstPage := cursor == ""
	var cursorTS time.Time
	cursorID := uuid.Nil
	if !isFirstPage {
		ts, id, err := decodeCursor(cursor)
		if err != nil {
			return nil, "", fmt.Errorf("copilot.Sessions.ListForUser: %w: %w", domain.ErrInvalidInput, err)
		}
		cursorTS = ts
		cursorID = id
	}

	rows, err := r.q.ListCopilotSessionsForUser(ctx, copilotdb.ListCopilotSessionsForUserParams{
		UserID:          pgUUID(userID),
		KindFilter:      string(kind),
		IsFirstPage:     isFirstPage,
		CursorStartedAt: pgTimestamptz(cursorTS),
		CursorID:        pgUUID(cursorID),
		PageSize:        int32(limit + 1),
	})
	if err != nil {
		return nil, "", fmt.Errorf("copilot.Sessions.ListForUser: %w", err)
	}

	out := make([]domain.SessionSummary, 0, limit)
	for i, row := range rows {
		if i == limit {
			break
		}
		s := domain.Session{
			ID:        fromPgUUID(row.ID),
			UserID:    fromPgUUID(row.UserID),
			Kind:      domain.SessionKind(row.Kind),
			StartedAt: row.StartedAt.Time,
			BYOKOnly:  row.ByokOnly,
		}
		if row.FinishedAt.Valid {
			t := row.FinishedAt.Time
			s.FinishedAt = &t
		}
		out = append(out, domain.SessionSummary{
			Session:           s,
			ConversationCount: int(row.ConversationCount),
		})
	}

	var next domain.Cursor
	if len(rows) > limit {
		last := out[len(out)-1]
		next = encodeCursor(last.StartedAt, last.ID)
	}
	return out, next, nil
}

func (r *Sessions) AttachConversation(ctx context.Context, conversationID, sessionID uuid.UUID) error {
	if _, err := r.q.AttachConversationToSession(ctx, copilotdb.AttachConversationToSessionParams{
		ID:        pgUUID(conversationID),
		SessionID: pgUUID(sessionID),
	}); err != nil {
		return fmt.Errorf("copilot.Sessions.AttachConversation: %w", err)
	}
	return nil
}

func (r *Sessions) ListConversations(ctx context.Context, sessionID uuid.UUID) ([]domain.Conversation, error) {
	rows, err := r.q.ListConversationsInSession(ctx, pgUUID(sessionID))
	if err != nil {
		return nil, fmt.Errorf("copilot.Sessions.ListConversations: %w", err)
	}
	out := make([]domain.Conversation, 0, len(rows))
	for _, row := range rows {
		out = append(out, domain.Conversation{
			ID:        fromPgUUID(row.ID),
			UserID:    fromPgUUID(row.UserID),
			Title:     row.Title,
			Model:     row.Model,
			CreatedAt: row.CreatedAt.Time,
			UpdatedAt: row.UpdatedAt.Time,
		})
	}
	return out, nil
}

// ─────────────────────────────────────────────────────────────────────────
// Reports
// ─────────────────────────────────────────────────────────────────────────

type Reports struct {
	pool *pgxpool.Pool
	q    *copilotdb.Queries
}

func NewReports(pool *pgxpool.Pool) *Reports {
	return &Reports{pool: pool, q: copilotdb.New(pool)}
}

func (r *Reports) Init(ctx context.Context, sessionID uuid.UUID) (domain.SessionReport, error) {
	row, err := r.q.InitCopilotSessionReport(ctx, pgUUID(sessionID))
	if err != nil {
		return domain.SessionReport{}, fmt.Errorf("copilot.Reports.Init: %w", err)
	}
	return reportFromRow(row)
}

func (r *Reports) Get(ctx context.Context, sessionID uuid.UUID) (domain.SessionReport, error) {
	row, err := r.q.GetCopilotSessionReport(ctx, pgUUID(sessionID))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.SessionReport{}, fmt.Errorf("copilot.Reports.Get: %w", domain.ErrNotFound)
		}
		return domain.SessionReport{}, fmt.Errorf("copilot.Reports.Get: %w", err)
	}
	return reportFromRow(row)
}

func (r *Reports) MarkRunning(ctx context.Context, sessionID uuid.UUID) error {
	if _, err := r.q.MarkCopilotSessionReportRunning(ctx, pgUUID(sessionID)); err != nil {
		return fmt.Errorf("copilot.Reports.MarkRunning: %w", err)
	}
	return nil
}

func (r *Reports) Write(ctx context.Context, sessionID uuid.UUID, res domain.AnalyzerResult, reportURL string) error {
	sectionJSON, err := json.Marshal(res.SectionScores)
	if err != nil {
		return fmt.Errorf("copilot.Reports.Write: marshal sections: %w", err)
	}
	weaknessesJSON, err := json.Marshal(res.Weaknesses)
	if err != nil {
		return fmt.Errorf("copilot.Reports.Write: marshal weaknesses: %w", err)
	}
	recommendationsJSON, err := json.Marshal(res.Recommendations)
	if err != nil {
		return fmt.Errorf("copilot.Reports.Write: marshal recommendations: %w", err)
	}
	linksJSON, err := json.Marshal(res.Links)
	if err != nil {
		return fmt.Errorf("copilot.Reports.Write: marshal links: %w", err)
	}
	if _, err := r.q.WriteCopilotSessionReport(ctx, copilotdb.WriteCopilotSessionReportParams{
		SessionID:       pgUUID(sessionID),
		OverallScore:    int32(res.OverallScore),
		SectionScores:   sectionJSON,
		Weaknesses:      weaknessesJSON,
		Recommendations: recommendationsJSON,
		Links:           linksJSON,
		ReportMarkdown:  res.ReportMarkdown,
		ReportUrl:       reportURL,
	}); err != nil {
		return fmt.Errorf("copilot.Reports.Write: %w", err)
	}
	return nil
}

func (r *Reports) Fail(ctx context.Context, sessionID uuid.UUID, errMsg string) error {
	if _, err := r.q.FailCopilotSessionReport(ctx, copilotdb.FailCopilotSessionReportParams{
		SessionID:    pgUUID(sessionID),
		ErrorMessage: errMsg,
	}); err != nil {
		return fmt.Errorf("copilot.Reports.Fail: %w", err)
	}
	return nil
}

// ─────────────────────────────────────────────────────────────────────────
// Row conversions
// ─────────────────────────────────────────────────────────────────────────

func sessionFromRow(r copilotdb.CopilotSession) domain.Session {
	s := domain.Session{
		ID:        fromPgUUID(r.ID),
		UserID:    fromPgUUID(r.UserID),
		Kind:      domain.SessionKind(r.Kind),
		StartedAt: r.StartedAt.Time,
		BYOKOnly:  r.ByokOnly,
	}
	if r.FinishedAt.Valid {
		t := r.FinishedAt.Time
		s.FinishedAt = &t
	}
	return s
}

func reportFromRow(r copilotdb.CopilotSessionReport) (domain.SessionReport, error) {
	out := domain.SessionReport{
		SessionID:      fromPgUUID(r.SessionID),
		Status:         domain.AnalysisStatus(r.Status),
		OverallScore:   int(r.OverallScore),
		ReportMarkdown: r.ReportMarkdown,
		ReportURL:      r.ReportUrl,
		ErrorMessage:   r.ErrorMessage,
		UpdatedAt:      r.UpdatedAt.Time,
	}
	if r.StartedAt.Valid {
		t := r.StartedAt.Time
		out.StartedAt = &t
	}
	if r.FinishedAt.Valid {
		t := r.FinishedAt.Time
		out.FinishedAt = &t
	}
	// JSONB fields default to empty objects/arrays, never nil — decode
	// tolerantly so an older row with NULLs (pre-DEFAULT) doesn't panic.
	if len(r.SectionScores) > 0 {
		if err := json.Unmarshal(r.SectionScores, &out.SectionScores); err != nil {
			return out, fmt.Errorf("copilot.reportFromRow: sections: %w", err)
		}
	}
	if len(r.Weaknesses) > 0 {
		if err := json.Unmarshal(r.Weaknesses, &out.Weaknesses); err != nil {
			return out, fmt.Errorf("copilot.reportFromRow: weaknesses: %w", err)
		}
	}
	if len(r.Recommendations) > 0 {
		if err := json.Unmarshal(r.Recommendations, &out.Recommendations); err != nil {
			return out, fmt.Errorf("copilot.reportFromRow: recommendations: %w", err)
		}
	}
	if len(r.Links) > 0 {
		if err := json.Unmarshal(r.Links, &out.Links); err != nil {
			return out, fmt.Errorf("copilot.reportFromRow: links: %w", err)
		}
	}
	return out, nil
}

func isUniqueViolation(err error) bool {
	// pgx exposes this via a *pgconn.PgError with Code "23505", but we
	// avoid importing pgconn just for one check — the message match is
	// cheap and robust enough for a single call-site. Revisit if we
	// need to distinguish partial-index violations from others.
	return err != nil && strings.Contains(err.Error(), "23505")
}

// Interface guards.
var (
	_ domain.SessionRepo = (*Sessions)(nil)
	_ domain.ReportRepo  = (*Reports)(nil)
)
