// interview_prep_repo.go — postgres adapter for InterviewPrepRepo.
// Phase J / C6 (P1) — single-active per user via partial unique index
// (migration 00107). StartActive is wrapped in a single tx so the prior
// active row is ended atomically with the new INSERT.
package infra

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"druz9/copilot/domain"
	copilotdb "druz9/copilot/infra/db"
	sharedpg "druz9/shared/pkg/pg"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
)

// InterviewPreps is the persistence adapter for interview_prep_sessions.
type InterviewPreps struct {
	pool *pgxpool.Pool
	q    *copilotdb.Queries
}

// NewInterviewPreps wraps a pool with the typed query helpers.
func NewInterviewPreps(pool *pgxpool.Pool) *InterviewPreps {
	return &InterviewPreps{pool: pool, q: copilotdb.New(pool)}
}

// StartActive replaces the user's prior active prep (if any) with a new
// row populated by parsedCV / parsedJD / raw text. The two queries run
// inside a tx so the partial unique index never trips even under
// concurrent calls.
func (r *InterviewPreps) StartActive(
	ctx context.Context,
	userID uuid.UUID,
	parsedCV domain.ParsedCV,
	parsedJD domain.ParsedJD,
	cvText, jdText string,
) (domain.InterviewPrep, error) {
	cvJSON, err := json.Marshal(parsedCV)
	if err != nil {
		return domain.InterviewPrep{}, fmt.Errorf("copilot.InterviewPreps.StartActive: marshal cv: %w", err)
	}
	jdJSON, err := json.Marshal(parsedJD)
	if err != nil {
		return domain.InterviewPrep{}, fmt.Errorf("copilot.InterviewPreps.StartActive: marshal jd: %w", err)
	}

	tx, err := r.pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.ReadCommitted})
	if err != nil {
		return domain.InterviewPrep{}, fmt.Errorf("copilot.InterviewPreps.StartActive: begin tx: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	qtx := r.q.WithTx(tx)

	if _, endErr := qtx.EndActiveInterviewPreps(ctx, sharedpg.UUID(userID)); endErr != nil {
		return domain.InterviewPrep{}, fmt.Errorf("copilot.InterviewPreps.StartActive: end prior: %w", endErr)
	}
	row, err := qtx.InsertInterviewPrepSession(ctx, copilotdb.InsertInterviewPrepSessionParams{
		UserID:   sharedpg.UUID(userID),
		ParsedCv: cvJSON,
		ParsedJd: jdJSON,
		CvText:   textOrNull(cvText),
		JdText:   textOrNull(jdText),
		Company:  textOrNull(parsedJD.Company),
		Role:     textOrNull(parsedJD.Role),
	})
	if err != nil {
		return domain.InterviewPrep{}, fmt.Errorf("copilot.InterviewPreps.StartActive: insert: %w", err)
	}
	if commitErr := tx.Commit(ctx); commitErr != nil {
		return domain.InterviewPrep{}, fmt.Errorf("copilot.InterviewPreps.StartActive: commit: %w", commitErr)
	}
	prep, err := interviewPrepFromRow(row)
	if err != nil {
		return domain.InterviewPrep{}, fmt.Errorf("copilot.InterviewPreps.StartActive: %w", err)
	}
	return prep, nil
}

// GetActive returns the user's single live prep row (or ErrNoActivePrep).
func (r *InterviewPreps) GetActive(ctx context.Context, userID uuid.UUID) (domain.InterviewPrep, error) {
	row, err := r.q.GetActiveInterviewPrep(ctx, sharedpg.UUID(userID))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.InterviewPrep{}, fmt.Errorf("copilot.InterviewPreps.GetActive: %w", domain.ErrNoActivePrep)
		}
		return domain.InterviewPrep{}, fmt.Errorf("copilot.InterviewPreps.GetActive: %w", err)
	}
	prep, err := interviewPrepFromRow(row)
	if err != nil {
		return domain.InterviewPrep{}, fmt.Errorf("copilot.InterviewPreps.GetActive: %w", err)
	}
	return prep, nil
}

// EndActive stamps ended_at. When sessionID is uuid.Nil the user's
// current active prep is ended; otherwise the specific row (scoped to
// user_id for auth). Idempotent — no error when there is nothing to end.
func (r *InterviewPreps) EndActive(ctx context.Context, userID uuid.UUID, sessionID uuid.UUID) error {
	if sessionID == uuid.Nil {
		if _, err := r.q.EndActiveInterviewPreps(ctx, sharedpg.UUID(userID)); err != nil {
			return fmt.Errorf("copilot.InterviewPreps.EndActive: end active: %w", err)
		}
		return nil
	}
	if _, err := r.q.EndInterviewPrepByID(ctx, copilotdb.EndInterviewPrepByIDParams{
		ID:     sharedpg.UUID(sessionID),
		UserID: sharedpg.UUID(userID),
	}); err != nil {
		return fmt.Errorf("copilot.InterviewPreps.EndActive: end by id: %w", err)
	}
	return nil
}

// LoadActivePrep implements domain.InterviewPrepProvider. Same as
// GetActive but maps ErrNoActivePrep → zero-value + nil error so the
// Analyze / Chat / Suggest paths can branch on InterviewPrep.IsZero
// without an error check.
func (r *InterviewPreps) LoadActivePrep(ctx context.Context, userID uuid.UUID) (domain.InterviewPrep, error) {
	prep, err := r.GetActive(ctx, userID)
	if err != nil {
		if errors.Is(err, domain.ErrNoActivePrep) {
			return domain.InterviewPrep{}, nil
		}
		return domain.InterviewPrep{}, err
	}
	return prep, nil
}

// Interface guards.
var (
	_ domain.InterviewPrepRepo     = (*InterviewPreps)(nil)
	_ domain.InterviewPrepProvider = (*InterviewPreps)(nil)
)

// ─────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────

func interviewPrepFromRow(row copilotdb.InterviewPrepSession) (domain.InterviewPrep, error) {
	var parsedCV domain.ParsedCV
	if len(row.ParsedCv) > 0 {
		if err := json.Unmarshal(row.ParsedCv, &parsedCV); err != nil {
			return domain.InterviewPrep{}, fmt.Errorf("unmarshal parsed_cv: %w", err)
		}
	}
	var parsedJD domain.ParsedJD
	if len(row.ParsedJd) > 0 {
		if err := json.Unmarshal(row.ParsedJd, &parsedJD); err != nil {
			return domain.InterviewPrep{}, fmt.Errorf("unmarshal parsed_jd: %w", err)
		}
	}
	prep := domain.InterviewPrep{
		ID:        sharedpg.UUIDFrom(row.ID),
		UserID:    sharedpg.UUIDFrom(row.UserID),
		ParsedCV:  parsedCV,
		ParsedJD:  parsedJD,
		CVText:    textOrEmpty(row.CvText),
		JDText:    textOrEmpty(row.JdText),
		Company:   textOrEmpty(row.Company),
		Role:      textOrEmpty(row.Role),
		StartedAt: row.StartedAt.Time,
	}
	if row.EndedAt.Valid {
		t := row.EndedAt.Time
		prep.EndedAt = &t
	}
	return prep, nil
}

func textOrNull(s string) pgtype.Text {
	if s == "" {
		return pgtype.Text{Valid: false}
	}
	return pgtype.Text{String: s, Valid: true}
}

func textOrEmpty(t pgtype.Text) string {
	if !t.Valid {
		return ""
	}
	return t.String
}
