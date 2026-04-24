// Package infra contains Postgres adapters, the OpenRouter client and the
// hallucination-trap catalog for the ai_native domain.
//
// solution_hint flows into BuildAssistantPrompt via TaskRepo.GetWithHint /
// PickForSession. Every OTHER adapter in this file deliberately drops it.
package infra

import (
	"context"
	"errors"
	"fmt"

	"druz9/ai_native/domain"
	ai_nativedb "druz9/ai_native/infra/db"
	"druz9/shared/enums"

	sharedpg "druz9/shared/pkg/pg"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ─────────────────────────────────────────────────────────────────────────
// Sessions
// ─────────────────────────────────────────────────────────────────────────

// Sessions is the persistence adapter for native_sessions.
type Sessions struct {
	pool *pgxpool.Pool
	q    *ai_nativedb.Queries
}

// NewSessions wraps a pool.
func NewSessions(pool *pgxpool.Pool) *Sessions {
	return &Sessions{pool: pool, q: ai_nativedb.New(pool)}
}

// Create inserts a new native_sessions row and returns the hydrated entity.
func (s *Sessions) Create(ctx context.Context, in domain.Session) (domain.Session, error) {
	params := ai_nativedb.CreateNativeSessionParams{
		UserID:     sharedpg.UUID(in.UserID),
		TaskID:     sharedpg.UUID(in.TaskID),
		Section:    in.Section.String(),
		Difficulty: in.Difficulty.String(),
		LlmModel:   pgText(in.LLMModel.String()),
	}
	row, err := s.q.CreateNativeSession(ctx, params)
	if err != nil {
		return domain.Session{}, fmt.Errorf("native.Sessions.Create: %w", err)
	}
	return sessionFromRow(row)
}

// Get loads a session by id.
func (s *Sessions) Get(ctx context.Context, id uuid.UUID) (domain.Session, error) {
	row, err := s.q.GetNativeSession(ctx, sharedpg.UUID(id))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.Session{}, fmt.Errorf("native.Sessions.Get: %w", domain.ErrNotFound)
		}
		return domain.Session{}, fmt.Errorf("native.Sessions.Get: %w", err)
	}
	return sessionFromRow(row)
}

// UpdateScores writes the latest snapshot without touching finished_at.
func (s *Sessions) UpdateScores(ctx context.Context, id uuid.UUID, scores domain.Scores) error {
	affected, err := s.q.UpdateNativeSessionScores(ctx, ai_nativedb.UpdateNativeSessionScoresParams{
		ID:                sharedpg.UUID(id),
		ContextScore:      int32(scores.Context),
		VerificationScore: int32(scores.Verification),
		JudgmentScore:     int32(scores.Judgment),
		DeliveryScore:     int32(scores.Delivery),
	})
	if err != nil {
		return fmt.Errorf("native.Sessions.UpdateScores: %w", err)
	}
	if affected == 0 {
		return fmt.Errorf("native.Sessions.UpdateScores: %w", domain.ErrNotFound)
	}
	return nil
}

// MarkFinished writes the final scores and stamps finished_at=now(). Idempotent:
// returns ErrInvalidState on a second attempt.
func (s *Sessions) MarkFinished(ctx context.Context, id uuid.UUID, scores domain.Scores) error {
	affected, err := s.q.MarkNativeSessionFinished(ctx, ai_nativedb.MarkNativeSessionFinishedParams{
		ID:                sharedpg.UUID(id),
		ContextScore:      int32(scores.Context),
		VerificationScore: int32(scores.Verification),
		JudgmentScore:     int32(scores.Judgment),
		DeliveryScore:     int32(scores.Delivery),
	})
	if err != nil {
		return fmt.Errorf("native.Sessions.MarkFinished: %w", err)
	}
	if affected == 0 {
		return fmt.Errorf("native.Sessions.MarkFinished: %w", domain.ErrInvalidState)
	}
	return nil
}

// ─────────────────────────────────────────────────────────────────────────
// Provenance
// ─────────────────────────────────────────────────────────────────────────

// Provenance is the persistence adapter for native_provenance.
type Provenance struct {
	pool *pgxpool.Pool
	q    *ai_nativedb.Queries
}

// NewProvenance wraps a pool.
func NewProvenance(pool *pgxpool.Pool) *Provenance {
	return &Provenance{pool: pool, q: ai_nativedb.New(pool)}
}

// Insert persists a ProvenanceRecord and returns the hydrated entity.
func (p *Provenance) Insert(ctx context.Context, in domain.ProvenanceRecord) (domain.ProvenanceRecord, error) {
	if !in.Kind.IsValid() {
		return domain.ProvenanceRecord{}, fmt.Errorf("native.Provenance.Insert: invalid kind %q", in.Kind)
	}
	params := ai_nativedb.InsertNativeProvenanceParams{
		SessionID:            sharedpg.UUID(in.SessionID),
		Kind:                 in.Kind.String(),
		Snippet:              in.Snippet,
		Column5:              in.AIPrompt,
		HasHallucinationTrap: in.HasHallucinationTrap,
	}
	if in.ParentID != nil {
		params.ParentID = sharedpg.UUID(*in.ParentID)
	}
	row, err := p.q.InsertNativeProvenance(ctx, params)
	if err != nil {
		return domain.ProvenanceRecord{}, fmt.Errorf("native.Provenance.Insert: %w", err)
	}
	return provenanceFromRow(row), nil
}

// Get returns the provenance record with the given id.
func (p *Provenance) Get(ctx context.Context, id uuid.UUID) (domain.ProvenanceRecord, error) {
	row, err := p.q.GetNativeProvenance(ctx, sharedpg.UUID(id))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.ProvenanceRecord{}, fmt.Errorf("native.Provenance.Get: %w", domain.ErrNotFound)
		}
		return domain.ProvenanceRecord{}, fmt.Errorf("native.Provenance.Get: %w", err)
	}
	return provenanceFromRow(row), nil
}

// List returns all provenance records for a session, in creation order.
func (p *Provenance) List(ctx context.Context, sessionID uuid.UUID) ([]domain.ProvenanceRecord, error) {
	rows, err := p.q.ListNativeProvenance(ctx, sharedpg.UUID(sessionID))
	if err != nil {
		return nil, fmt.Errorf("native.Provenance.List: %w", err)
	}
	out := make([]domain.ProvenanceRecord, 0, len(rows))
	for _, r := range rows {
		out = append(out, provenanceFromRow(r))
	}
	return out, nil
}

// MarkVerified flips a record's kind and stamps verified_at=now(). The new
// kind must be one of the domain's ProvenanceKind values.
func (p *Provenance) MarkVerified(ctx context.Context, id uuid.UUID, newKind string) error {
	if !enums.ProvenanceKind(newKind).IsValid() {
		return fmt.Errorf("native.Provenance.MarkVerified: invalid kind %q", newKind)
	}
	affected, err := p.q.MarkNativeProvenanceVerified(ctx, ai_nativedb.MarkNativeProvenanceVerifiedParams{
		ID:   sharedpg.UUID(id),
		Kind: newKind,
	})
	if err != nil {
		return fmt.Errorf("native.Provenance.MarkVerified: %w", err)
	}
	if affected == 0 {
		return fmt.Errorf("native.Provenance.MarkVerified: %w", domain.ErrNotFound)
	}
	return nil
}

// ─────────────────────────────────────────────────────────────────────────
// Tasks / Users — tiny read-only adapters.
// ─────────────────────────────────────────────────────────────────────────

// Tasks fetches TaskWithHint — only for ai_native internal use.
type Tasks struct {
	q *ai_nativedb.Queries
}

// NewTasks wraps a pool.
func NewTasks(pool *pgxpool.Pool) *Tasks { return &Tasks{q: ai_nativedb.New(pool)} }

// PickForSession picks a random active task matching section+difficulty.
func (t *Tasks) PickForSession(ctx context.Context, section, difficulty string) (domain.TaskWithHint, error) {
	row, err := t.q.PickNativeTask(ctx, ai_nativedb.PickNativeTaskParams{
		Section:    section,
		Difficulty: difficulty,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.TaskWithHint{}, fmt.Errorf("native.Tasks.PickForSession: %w", domain.ErrNotFound)
		}
		return domain.TaskWithHint{}, fmt.Errorf("native.Tasks.PickForSession: %w", err)
	}
	return domain.TaskWithHint{
		ID:           sharedpg.UUIDFrom(row.ID),
		Slug:         row.Slug,
		Title:        row.TitleRu,
		Description:  row.DescriptionRu,
		Difficulty:   enums.Difficulty(row.Difficulty),
		Section:      enums.Section(row.Section),
		SolutionHint: pgTextStr(row.SolutionHint),
	}, nil
}

// GetWithHint fetches a task by id, hint included.
func (t *Tasks) GetWithHint(ctx context.Context, id uuid.UUID) (domain.TaskWithHint, error) {
	row, err := t.q.GetNativeTaskWithHint(ctx, sharedpg.UUID(id))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.TaskWithHint{}, fmt.Errorf("native.Tasks.GetWithHint: %w", domain.ErrNotFound)
		}
		return domain.TaskWithHint{}, fmt.Errorf("native.Tasks.GetWithHint: %w", err)
	}
	return domain.TaskWithHint{
		ID:           sharedpg.UUIDFrom(row.ID),
		Slug:         row.Slug,
		Title:        row.TitleRu,
		Description:  row.DescriptionRu,
		Difficulty:   enums.Difficulty(row.Difficulty),
		Section:      enums.Section(row.Section),
		SolutionHint: pgTextStr(row.SolutionHint),
	}, nil
}

// Users is the tiny subscription-only adapter.
type Users struct {
	q *ai_nativedb.Queries
}

// NewUsers wraps a pool.
func NewUsers(pool *pgxpool.Pool) *Users { return &Users{q: ai_nativedb.New(pool)} }

// Get returns the minimal user context. Free-plan is the conservative fallback
// when the subscription row is missing.
func (u *Users) Get(ctx context.Context, id uuid.UUID) (domain.UserContext, error) {
	plan, err := u.q.GetNativeUserSubscription(ctx, sharedpg.UUID(id))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.UserContext{ID: id, Subscription: enums.SubscriptionPlanFree}, nil
		}
		return domain.UserContext{}, fmt.Errorf("native.Users.Get: %w", err)
	}
	sub := enums.SubscriptionPlan(plan)
	if !sub.IsValid() {
		sub = enums.SubscriptionPlanFree
	}
	return domain.UserContext{ID: id, Subscription: sub}, nil
}

// ─────────────────────────────────────────────────────────────────────────
// Row → domain converters.
// ─────────────────────────────────────────────────────────────────────────

func sessionFromRow(r ai_nativedb.NativeSession) (domain.Session, error) {
	sec := enums.Section(r.Section)
	diff := enums.Difficulty(r.Difficulty)
	if !sec.IsValid() || !diff.IsValid() {
		return domain.Session{}, fmt.Errorf("native.sessionFromRow: invalid enum section=%q diff=%q", sec, diff)
	}
	out := domain.Session{
		ID:         sharedpg.UUIDFrom(r.ID),
		UserID:     sharedpg.UUIDFrom(r.UserID),
		TaskID:     sharedpg.UUIDFrom(r.TaskID),
		Section:    sec,
		Difficulty: diff,
		Scores: domain.Scores{
			Context:      int(r.ContextScore),
			Verification: int(r.VerificationScore),
			Judgment:     int(r.JudgmentScore),
			Delivery:     int(r.DeliveryScore),
		},
	}
	if r.LlmModel.Valid {
		out.LLMModel = enums.LLMModel(r.LlmModel.String)
	}
	if r.StartedAt.Valid {
		out.StartedAt = r.StartedAt.Time
	}
	if r.FinishedAt.Valid {
		t := r.FinishedAt.Time
		out.FinishedAt = &t
	}
	return out, nil
}

func provenanceFromRow(r ai_nativedb.NativeProvenance) domain.ProvenanceRecord {
	out := domain.ProvenanceRecord{
		ID:                   sharedpg.UUIDFrom(r.ID),
		SessionID:            sharedpg.UUIDFrom(r.SessionID),
		Kind:                 enums.ProvenanceKind(r.Kind),
		Snippet:              r.Snippet,
		HasHallucinationTrap: r.HasHallucinationTrap,
		CreatedAt:            r.CreatedAt.Time,
	}
	if r.ParentID.Valid {
		pid := sharedpg.UUIDFrom(r.ParentID)
		out.ParentID = &pid
	}
	if r.AiPrompt.Valid {
		out.AIPrompt = r.AiPrompt.String
	}
	if r.VerifiedAt.Valid {
		t := r.VerifiedAt.Time
		out.VerifiedAt = &t
	}
	return out
}

func pgText(s string) pgtype.Text { return pgtype.Text{String: s, Valid: s != ""} }

func pgTextStr(p pgtype.Text) string {
	if !p.Valid {
		return ""
	}
	return p.String
}

// Interface guards.
var (
	_ domain.SessionRepo    = (*Sessions)(nil)
	_ domain.ProvenanceRepo = (*Provenance)(nil)
	_ domain.TaskRepo       = (*Tasks)(nil)
	_ domain.UserRepo       = (*Users)(nil)
)
