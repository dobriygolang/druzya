// Package infra contains Postgres adapters, the OpenRouter client and the
// MinIO replay uploader for the ai_mock domain.
//
// solution_hint flows into BuildSystemPrompt via TaskRepo.GetWithHint /
// PickForSession. Every OTHER adapter in this file deliberately drops it.
package infra

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"druz9/ai_mock/domain"
	ai_mockdb "druz9/ai_mock/infra/db"
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

// Sessions is the persistence adapter for mock_sessions.
type Sessions struct {
	pool *pgxpool.Pool
	q    *ai_mockdb.Queries
}

// NewSessions wraps a pool.
func NewSessions(pool *pgxpool.Pool) *Sessions {
	return &Sessions{pool: pool, q: ai_mockdb.New(pool)}
}

// Create inserts a new session row and returns the hydrated entity.
func (s *Sessions) Create(ctx context.Context, in domain.Session) (domain.Session, error) {
	params := ai_mockdb.CreateMockSessionParams{
		UserID:      sharedpg.UUID(in.UserID),
		CompanyID:   sharedpg.UUID(in.CompanyID),
		TaskID:      sharedpg.UUID(in.TaskID),
		Section:     in.Section.String(),
		Difficulty:  in.Difficulty.String(),
		Status:      in.Status.String(),
		DurationMin: int32(in.DurationMin),
		VoiceMode:   in.VoiceMode,
		LlmModel:    pgText(in.LLMModel.String()),
		AiAssist:    in.AIAssist,
	}
	if in.PairedUserID != nil {
		params.PairedUserID = sharedpg.UUID(*in.PairedUserID)
	}
	if in.StartedAt != nil {
		params.StartedAt = pgtype.Timestamptz{Time: *in.StartedAt, Valid: true}
	}
	row, err := s.q.CreateMockSession(ctx, params)
	if err != nil {
		return domain.Session{}, fmt.Errorf("mock.Sessions.Create: %w", err)
	}
	return sessionFromRow(row)
}

// Get loads a session by id.
func (s *Sessions) Get(ctx context.Context, id uuid.UUID) (domain.Session, error) {
	row, err := s.q.GetMockSession(ctx, sharedpg.UUID(id))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.Session{}, fmt.Errorf("mock.Sessions.Get: %w", domain.ErrNotFound)
		}
		return domain.Session{}, fmt.Errorf("mock.Sessions.Get: %w", err)
	}
	return sessionFromRow(row)
}

// UpdateStatus sets the session status; finishedAt=true stamps finished_at=now().
func (s *Sessions) UpdateStatus(ctx context.Context, id uuid.UUID, status string, finishedAt bool) error {
	affected, err := s.q.UpdateMockSessionStatus(ctx, ai_mockdb.UpdateMockSessionStatusParams{
		ID:      sharedpg.UUID(id),
		Status:  status,
		Column3: finishedAt,
	})
	if err != nil {
		return fmt.Errorf("mock.Sessions.UpdateStatus: %w", err)
	}
	if affected == 0 {
		return fmt.Errorf("mock.Sessions.UpdateStatus: %w", domain.ErrNotFound)
	}
	return nil
}

// UpdateStress persists the aggregated stress profile.
func (s *Sessions) UpdateStress(ctx context.Context, id uuid.UUID, profile domain.StressProfile) error {
	b, err := json.Marshal(profile)
	if err != nil {
		return fmt.Errorf("mock.Sessions.UpdateStress: marshal: %w", err)
	}
	affected, err := s.q.UpdateMockSessionStress(ctx, ai_mockdb.UpdateMockSessionStressParams{
		ID:      sharedpg.UUID(id),
		Column2: b,
	})
	if err != nil {
		return fmt.Errorf("mock.Sessions.UpdateStress: %w", err)
	}
	if affected == 0 {
		return fmt.Errorf("mock.Sessions.UpdateStress: %w", domain.ErrNotFound)
	}
	return nil
}

// UpdateReport writes the ai_report blob + replay_url.
func (s *Sessions) UpdateReport(ctx context.Context, id uuid.UUID, reportJSON []byte, replayURL string) error {
	affected, err := s.q.UpdateMockSessionReport(ctx, ai_mockdb.UpdateMockSessionReportParams{
		ID:      sharedpg.UUID(id),
		Column2: reportJSON,
		Column3: replayURL,
	})
	if err != nil {
		return fmt.Errorf("mock.Sessions.UpdateReport: %w", err)
	}
	if affected == 0 {
		return fmt.Errorf("mock.Sessions.UpdateReport: %w", domain.ErrNotFound)
	}
	return nil
}

// ─────────────────────────────────────────────────────────────────────────
// Messages
// ─────────────────────────────────────────────────────────────────────────

// Messages is the persistence adapter for mock_messages.
type Messages struct {
	pool *pgxpool.Pool
	q    *ai_mockdb.Queries
}

// NewMessages wraps a pool.
func NewMessages(pool *pgxpool.Pool) *Messages {
	return &Messages{pool: pool, q: ai_mockdb.New(pool)}
}

// Append inserts a message row and returns it.
func (m *Messages) Append(ctx context.Context, msg domain.Message) (domain.Message, error) {
	if !msg.Role.IsValid() {
		return domain.Message{}, fmt.Errorf("mock.Messages.Append: invalid role %q", msg.Role)
	}
	row, err := m.q.AppendMockMessage(ctx, ai_mockdb.AppendMockMessageParams{
		SessionID:      sharedpg.UUID(msg.SessionID),
		Role:           msg.Role.String(),
		Content:        msg.Content,
		Column4:        msg.CodeSnapshot,
		StressSnapshot: msg.StressSnapshot,
		Column6:        int32(msg.TokensUsed),
	})
	if err != nil {
		return domain.Message{}, fmt.Errorf("mock.Messages.Append: %w", err)
	}
	return messageFromRow(row), nil
}

// ListLast returns the most recent `limit` messages in chronological order
// (oldest first). The DB query returns DESC; we reverse it here so callers can
// feed the slice directly into an LLM.
func (m *Messages) ListLast(ctx context.Context, sessionID uuid.UUID, limit int) ([]domain.Message, error) {
	if limit <= 0 {
		limit = 10
	}
	rows, err := m.q.ListLastMockMessages(ctx, ai_mockdb.ListLastMockMessagesParams{
		SessionID: sharedpg.UUID(sessionID),
		Limit:     int32(limit),
	})
	if err != nil {
		return nil, fmt.Errorf("mock.Messages.ListLast: %w", err)
	}
	out := make([]domain.Message, 0, len(rows))
	// rows are DESC — reverse to ASC.
	for i := len(rows) - 1; i >= 0; i-- {
		out = append(out, messageFromRow(rows[i]))
	}
	return out, nil
}

// ListAll returns every message for the session in chronological order.
func (m *Messages) ListAll(ctx context.Context, sessionID uuid.UUID) ([]domain.Message, error) {
	rows, err := m.q.ListAllMockMessages(ctx, sharedpg.UUID(sessionID))
	if err != nil {
		return nil, fmt.Errorf("mock.Messages.ListAll: %w", err)
	}
	out := make([]domain.Message, 0, len(rows))
	for _, r := range rows {
		out = append(out, messageFromRow(r))
	}
	return out, nil
}

// ─────────────────────────────────────────────────────────────────────────
// Tasks / Companies / Users — tiny read-only adapters
// ─────────────────────────────────────────────────────────────────────────

// Tasks fetches TaskWithHint — only used by ai_mock; callers MUST NOT leak the
// hint to the client (domain guards this via TaskWithHint.ToPublic).
type Tasks struct {
	q *ai_mockdb.Queries
}

// NewTasks wraps a pool.
func NewTasks(pool *pgxpool.Pool) *Tasks { return &Tasks{q: ai_mockdb.New(pool)} }

// PickForSession picks a random active task matching section+difficulty.
func (t *Tasks) PickForSession(ctx context.Context, section, difficulty string) (domain.TaskWithHint, error) {
	row, err := t.q.PickTaskForSection(ctx, ai_mockdb.PickTaskForSectionParams{
		Section:    section,
		Difficulty: difficulty,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.TaskWithHint{}, fmt.Errorf("mock.Tasks.PickForSession: %w", domain.ErrNotFound)
		}
		return domain.TaskWithHint{}, fmt.Errorf("mock.Tasks.PickForSession: %w", err)
	}
	return taskFromPickRow(row), nil
}

// GetWithHint fetches a task by id, hint included.
func (t *Tasks) GetWithHint(ctx context.Context, id uuid.UUID) (domain.TaskWithHint, error) {
	row, err := t.q.GetTaskWithHint(ctx, sharedpg.UUID(id))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.TaskWithHint{}, fmt.Errorf("mock.Tasks.GetWithHint: %w", domain.ErrNotFound)
		}
		return domain.TaskWithHint{}, fmt.Errorf("mock.Tasks.GetWithHint: %w", err)
	}
	return taskFromHintRow(row), nil
}

// Companies is the read-only adapter for companies context.
type Companies struct {
	q *ai_mockdb.Queries
}

// NewCompanies wraps a pool.
func NewCompanies(pool *pgxpool.Pool) *Companies { return &Companies{q: ai_mockdb.New(pool)} }

// Get returns the tiny slice of the company row the prompt builder needs.
// NOTE: the companies table has no dedicated llm_model_override or default_level
// column today — those are either stubs or live in dynamic_config. Returning
// empty strings for both is the graceful degrade: PickModel will fall through
// to defaults, BuildSystemPrompt will substitute "middle".
//
// STUB: promote `llm_model_override` + `default_level` to companies schema in
// a future migration (bible §8 mentions per-company model override).
func (c *Companies) Get(ctx context.Context, id uuid.UUID) (domain.CompanyContext, error) {
	row, err := c.q.GetCompanyForMock(ctx, sharedpg.UUID(id))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.CompanyContext{}, fmt.Errorf("mock.Companies.Get: %w", domain.ErrNotFound)
		}
		return domain.CompanyContext{}, fmt.Errorf("mock.Companies.Get: %w", err)
	}
	return domain.CompanyContext{
		ID:   sharedpg.UUIDFrom(row.ID),
		Name: row.Name,
	}, nil
}

// Users fetches just the subscription plan + user id. Everything else (model
// preference, response language) has no storage today and falls back to defaults.
type Users struct {
	q *ai_mockdb.Queries
}

// NewUsers wraps a pool.
func NewUsers(pool *pgxpool.Pool) *Users { return &Users{q: ai_mockdb.New(pool)} }

// Get returns the minimal user context. Free-plan is the conservative fallback
// when the subscription row is missing (e.g. new user pre-onboarding).
func (u *Users) Get(ctx context.Context, id uuid.UUID) (domain.UserContext, error) {
	plan, err := u.q.GetUserSubscription(ctx, sharedpg.UUID(id))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.UserContext{ID: id, Subscription: enums.SubscriptionPlanFree}, nil
		}
		return domain.UserContext{}, fmt.Errorf("mock.Users.Get: %w", err)
	}
	sub := enums.SubscriptionPlan(plan)
	if !sub.IsValid() {
		sub = enums.SubscriptionPlanFree
	}
	return domain.UserContext{ID: id, Subscription: sub}, nil
}

// ─────────────────────────────────────────────────────────────────────────
// Conversion helpers
// ─────────────────────────────────────────────────────────────────────────

func sessionFromRow(r ai_mockdb.MockSession) (domain.Session, error) {
	sec := enums.Section(r.Section)
	diff := enums.Difficulty(r.Difficulty)
	status := enums.MockStatus(r.Status)
	if !sec.IsValid() || !diff.IsValid() || !status.IsValid() {
		return domain.Session{}, fmt.Errorf("mock.sessionFromRow: invalid enum section=%q diff=%q status=%q", sec, diff, status)
	}
	out := domain.Session{
		ID:          sharedpg.UUIDFrom(r.ID),
		UserID:      sharedpg.UUIDFrom(r.UserID),
		CompanyID:   sharedpg.UUIDFrom(r.CompanyID),
		TaskID:      sharedpg.UUIDFrom(r.TaskID),
		Section:     sec,
		Difficulty:  diff,
		Status:      status,
		DurationMin: int(r.DurationMin),
		VoiceMode:   r.VoiceMode,
		AIAssist:    r.AiAssist,
		CreatedAt:   r.CreatedAt.Time,
		Report:      r.AiReport,
	}
	if r.PairedUserID.Valid {
		u := sharedpg.UUIDFrom(r.PairedUserID)
		out.PairedUserID = &u
	}
	if r.LlmModel.Valid {
		out.LLMModel = enums.LLMModel(r.LlmModel.String)
	}
	if r.ReplayUrl.Valid {
		out.ReplayURL = r.ReplayUrl.String
	}
	if r.StartedAt.Valid {
		t := r.StartedAt.Time
		out.StartedAt = &t
	}
	if r.FinishedAt.Valid {
		t := r.FinishedAt.Time
		out.FinishedAt = &t
	}
	out.RunningSummary = r.RunningSummary
	if len(r.StressProfile) > 0 {
		var sp domain.StressProfile
		if err := json.Unmarshal(r.StressProfile, &sp); err == nil {
			out.Stress = sp
		}
	}
	return out, nil
}

func messageFromRow(r ai_mockdb.MockMessage) domain.Message {
	out := domain.Message{
		ID:             sharedpg.UUIDFrom(r.ID),
		SessionID:      sharedpg.UUIDFrom(r.SessionID),
		Role:           enums.MessageRole(r.Role),
		Content:        r.Content,
		StressSnapshot: r.StressSnapshot,
		CreatedAt:      r.CreatedAt.Time,
	}
	if r.CodeSnapshot.Valid {
		out.CodeSnapshot = r.CodeSnapshot.String
	}
	if r.TokensUsed.Valid {
		out.TokensUsed = int(r.TokensUsed.Int32)
	}
	return out
}

func taskFromPickRow(r ai_mockdb.PickTaskForSectionRow) domain.TaskWithHint {
	return domain.TaskWithHint{
		ID:           sharedpg.UUIDFrom(r.ID),
		Slug:         r.Slug,
		Title:        r.TitleRu,
		Description:  r.DescriptionRu,
		Difficulty:   enums.Difficulty(r.Difficulty),
		Section:      enums.Section(r.Section),
		SolutionHint: pgTextStr(r.SolutionHint),
	}
}

func taskFromHintRow(r ai_mockdb.GetTaskWithHintRow) domain.TaskWithHint {
	return domain.TaskWithHint{
		ID:           sharedpg.UUIDFrom(r.ID),
		Slug:         r.Slug,
		Title:        r.TitleRu,
		Description:  r.DescriptionRu,
		Difficulty:   enums.Difficulty(r.Difficulty),
		Section:      enums.Section(r.Section),
		SolutionHint: pgTextStr(r.SolutionHint),
	}
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
	_ domain.SessionRepo = (*Sessions)(nil)
	_ domain.MessageRepo = (*Messages)(nil)
	_ domain.TaskRepo    = (*Tasks)(nil)
	_ domain.CompanyRepo = (*Companies)(nil)
	_ domain.UserRepo    = (*Users)(nil)
)
