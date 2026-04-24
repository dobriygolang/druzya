package infra

import (
	"context"
	"errors"
	"fmt"

	"druz9/profile/domain"
	profiledb "druz9/profile/infra/db"
	"druz9/shared/enums"

	sharedpg "druz9/shared/pkg/pg"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

// GetSettings composes users + notification_preferences.
// NOTE: dynamic COALESCE + cross-table join with defaults, sqlc can't generate — keep hand-rolled.
func (p *Postgres) GetSettings(ctx context.Context, userID uuid.UUID) (domain.Settings, error) {
	row := p.pool.QueryRow(ctx, `
		SELECT COALESCE(u.display_name,''), u.locale,
		       COALESCE(np.channels, ARRAY['telegram']::text[]),
		       COALESCE(np.telegram_chat_id,''),
		       COALESCE(np.weekly_report_enabled, true),
		       COALESCE(np.skill_decay_warnings_enabled, true),
		       COALESCE(u.ai_insight_model, ''),
		       (u.onboarding_completed_at IS NOT NULL) AS onboarding_completed,
		       COALESCE(u.focus_class, '')
		  FROM users u
		  LEFT JOIN notification_preferences np ON np.user_id = u.id
		 WHERE u.id = $1`, userID)
	var s domain.Settings
	var channels []string
	if err := row.Scan(
		&s.DisplayName, &s.Locale,
		&channels, &s.Notifications.TelegramChatID,
		&s.Notifications.WeeklyReportEnabled, &s.Notifications.SkillDecayWarningsEnabled,
		&s.AIInsightModel,
		&s.OnboardingCompleted,
		&s.FocusClass,
	); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.Settings{}, fmt.Errorf("profile.Postgres.GetSettings: %w", domain.ErrNotFound)
		}
		return domain.Settings{}, fmt.Errorf("profile.Postgres.GetSettings: %w", err)
	}
	s.DefaultLanguage = enums.LanguageGo
	s.Notifications.Channels = parseChannels(channels)
	return s, nil
}

// GetVacanciesModel reads users.ai_vacancies_model. Empty string ⇒
// "no preference set" (SQL NULL was chosen by the column default).
// Callers (vacancies extractor wirer) treat "" as a signal to fall back
// to the extractor's built-in DefaultExtractorModel.
func (p *Postgres) GetVacanciesModel(ctx context.Context, userID uuid.UUID) (string, error) {
	var v string
	err := p.pool.QueryRow(ctx,
		`SELECT COALESCE(ai_vacancies_model, '') FROM users WHERE id = $1`,
		userID,
	).Scan(&v)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return "", fmt.Errorf("profile.Postgres.GetVacanciesModel: %w", domain.ErrNotFound)
		}
		return "", fmt.Errorf("profile.Postgres.GetVacanciesModel: %w", err)
	}
	return v, nil
}

// SetVacanciesModel upserts users.ai_vacancies_model. Empty modelID
// stores SQL NULL (so GET returns "" on the next read — symmetry with
// the GET→empty path). No tier validation happens here: the extractor
// workload is cheap enough that premium gating isn't worth the API
// complexity today. If that changes, add the gate here mirroring
// UpdateSettings' insight-model path.
func (p *Postgres) SetVacanciesModel(ctx context.Context, userID uuid.UUID, modelID string) error {
	tag, err := p.pool.Exec(ctx,
		`UPDATE users SET ai_vacancies_model = NULLIF($2,''), updated_at = now() WHERE id = $1`,
		userID, modelID,
	)
	if err != nil {
		return fmt.Errorf("profile.Postgres.SetVacanciesModel: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("profile.Postgres.SetVacanciesModel: %w", domain.ErrNotFound)
	}
	return nil
}

// UpdateSettings upserts users.* and notification_preferences in one tx.
// NOTE: two separate tables + conditional NULLIF updates; sqlc could express
// each half but composing them in a tx is still wire-by-hand. Keep hand-rolled.
func (p *Postgres) UpdateSettings(ctx context.Context, userID uuid.UUID, s domain.Settings) error {
	tx, err := p.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("profile.Postgres.UpdateSettings: begin: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	// users base columns. The two onboarding-state columns (focus_class +
	// onboarding_completed_at) use a HasX gate from the inbound proto so
	// PUT-with-only-display_name does not clobber a previously chosen
	// focus class. CASE WHEN keeps the column at its current value when
	// the caller did not include it.
	if _, err := tx.Exec(ctx,
		`UPDATE users
		    SET display_name = NULLIF($2,''),
		        locale = COALESCE(NULLIF($3,''), locale),
		        ai_insight_model = NULLIF($4,''),
		        focus_class = CASE WHEN $5::bool THEN $6 ELSE focus_class END,
		        onboarding_completed_at = CASE
		            WHEN $7::bool AND $8::bool THEN now()
		            WHEN $7::bool AND NOT $8::bool THEN NULL
		            ELSE onboarding_completed_at
		        END,
		        updated_at = now()
		  WHERE id = $1`,
		userID, s.DisplayName, s.Locale, s.AIInsightModel,
		s.HasFocusClass, s.FocusClass,
		s.HasOnboardingCompleted, s.OnboardingCompleted,
	); err != nil {
		return fmt.Errorf("profile.Postgres.UpdateSettings: users: %w", err)
	}
	chStrs := make([]string, 0, len(s.Notifications.Channels))
	for _, c := range s.Notifications.Channels {
		if c.IsValid() {
			chStrs = append(chStrs, c.String())
		}
	}
	if len(chStrs) == 0 {
		chStrs = []string{enums.NotificationChannelTelegram.String()}
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO notification_preferences(user_id, channels, telegram_chat_id, weekly_report_enabled, skill_decay_warnings_enabled)
		VALUES ($1, $2, NULLIF($3,''), $4, $5)
		ON CONFLICT (user_id) DO UPDATE SET
		    channels = EXCLUDED.channels,
		    telegram_chat_id = EXCLUDED.telegram_chat_id,
		    weekly_report_enabled = EXCLUDED.weekly_report_enabled,
		    skill_decay_warnings_enabled = EXCLUDED.skill_decay_warnings_enabled,
		    updated_at = now()
	`, userID, chStrs, s.Notifications.TelegramChatID, s.Notifications.WeeklyReportEnabled, s.Notifications.SkillDecayWarningsEnabled); err != nil {
		return fmt.Errorf("profile.Postgres.UpdateSettings: prefs: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("profile.Postgres.UpdateSettings: commit: %w", err)
	}
	return nil
}

// UpdateRole rewrites users.role. Idempotent — admins stay admin even when
// asked to "promote" to interviewer. The proto/handler layer enforces the
// only legal target (`interviewer`); the repo trusts whatever it gets.
func (p *Postgres) UpdateRole(ctx context.Context, userID uuid.UUID, role string) error {
	if _, err := p.pool.Exec(ctx,
		`UPDATE users
		    SET role = $2
		  WHERE id = $1
		    AND role <> 'admin'
		    AND role <> $2`,
		sharedpg.UUID(userID), role,
	); err != nil {
		return fmt.Errorf("profile.Postgres.UpdateRole: %w", err)
	}
	return nil
}

// ── Interviewer application moderation queue (M4a) ────────────────────────

func (p *Postgres) SubmitInterviewerApplication(ctx context.Context, userID uuid.UUID, motivation string) (domain.InterviewerApplication, error) {
	row, err := p.q.SubmitInterviewerApplication(ctx, profiledb.SubmitInterviewerApplicationParams{
		UserID:     sharedpg.UUID(userID),
		Motivation: motivation,
	})
	if err != nil {
		return domain.InterviewerApplication{}, fmt.Errorf("profile.Postgres.SubmitInterviewerApplication: %w", err)
	}
	return interviewerAppFromCols(row.ID, row.UserID, row.Motivation, row.Status,
		row.ReviewedBy, row.ReviewedAt, row.DecisionNote, row.CreatedAt, "", ""), nil
}

func (p *Postgres) GetMyInterviewerApplication(ctx context.Context, userID uuid.UUID) (domain.InterviewerApplication, error) {
	row, err := p.q.GetMyInterviewerApplication(ctx, sharedpg.UUID(userID))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.InterviewerApplication{}, domain.ErrNotFound
		}
		return domain.InterviewerApplication{}, fmt.Errorf("profile.Postgres.GetMyInterviewerApplication: %w", err)
	}
	return interviewerAppFromCols(row.ID, row.UserID, row.Motivation, row.Status,
		row.ReviewedBy, row.ReviewedAt, row.DecisionNote, row.CreatedAt, "", ""), nil
}

func (p *Postgres) ListInterviewerApplications(ctx context.Context, status string) ([]domain.InterviewerApplication, error) {
	if status == "" {
		status = domain.ApplicationStatusPending
	}
	rows, err := p.q.ListInterviewerApplications(ctx, status)
	if err != nil {
		return nil, fmt.Errorf("profile.Postgres.ListInterviewerApplications: %w", err)
	}
	out := make([]domain.InterviewerApplication, 0, len(rows))
	for _, r := range rows {
		out = append(out, interviewerAppFromCols(r.ID, r.UserID, r.Motivation, r.Status,
			r.ReviewedBy, r.ReviewedAt, r.DecisionNote, r.CreatedAt, r.UserUsername, r.UserDisplayName))
	}
	return out, nil
}

func (p *Postgres) GetInterviewerApplication(ctx context.Context, applicationID uuid.UUID) (domain.InterviewerApplication, error) {
	row, err := p.q.GetInterviewerApplicationByID(ctx, sharedpg.UUID(applicationID))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.InterviewerApplication{}, domain.ErrNotFound
		}
		return domain.InterviewerApplication{}, fmt.Errorf("profile.Postgres.GetInterviewerApplication: %w", err)
	}
	return interviewerAppFromCols(row.ID, row.UserID, row.Motivation, row.Status,
		row.ReviewedBy, row.ReviewedAt, row.DecisionNote, row.CreatedAt, "", ""), nil
}

func (p *Postgres) ApproveInterviewerApplication(ctx context.Context, applicationID, adminID uuid.UUID, note string) (domain.InterviewerApplication, error) {
	row, err := p.q.ApproveInterviewerApplication(ctx, profiledb.ApproveInterviewerApplicationParams{
		ID:           sharedpg.UUID(applicationID),
		ReviewedBy:   pgtype.UUID{Bytes: adminID, Valid: true},
		DecisionNote: note,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.InterviewerApplication{}, domain.ErrNotFound
		}
		return domain.InterviewerApplication{}, fmt.Errorf("profile.Postgres.ApproveInterviewerApplication: %w", err)
	}
	return interviewerAppFromCols(row.ID, row.UserID, row.Motivation, row.Status,
		row.ReviewedBy, row.ReviewedAt, row.DecisionNote, row.CreatedAt, "", ""), nil
}

func (p *Postgres) RejectInterviewerApplication(ctx context.Context, applicationID, adminID uuid.UUID, note string) (domain.InterviewerApplication, error) {
	row, err := p.q.RejectInterviewerApplication(ctx, profiledb.RejectInterviewerApplicationParams{
		ID:           sharedpg.UUID(applicationID),
		ReviewedBy:   pgtype.UUID{Bytes: adminID, Valid: true},
		DecisionNote: note,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.InterviewerApplication{}, domain.ErrNotFound
		}
		return domain.InterviewerApplication{}, fmt.Errorf("profile.Postgres.RejectInterviewerApplication: %w", err)
	}
	return interviewerAppFromCols(row.ID, row.UserID, row.Motivation, row.Status,
		row.ReviewedBy, row.ReviewedAt, row.DecisionNote, row.CreatedAt, "", ""), nil
}

func interviewerAppFromCols(
	id, userID pgtype.UUID,
	motivation, status string,
	reviewedBy pgtype.UUID,
	reviewedAt pgtype.Timestamptz,
	decisionNote string,
	createdAt pgtype.Timestamptz,
	username, displayName string,
) domain.InterviewerApplication {
	a := domain.InterviewerApplication{
		ID:              uuid.UUID(id.Bytes),
		UserID:          uuid.UUID(userID.Bytes),
		Motivation:      motivation,
		Status:          status,
		DecisionNote:    decisionNote,
		CreatedAt:       createdAt.Time,
		UserUsername:    username,
		UserDisplayName: displayName,
	}
	if reviewedBy.Valid {
		v := uuid.UUID(reviewedBy.Bytes)
		a.ReviewedBy = &v
	}
	if reviewedAt.Valid {
		t := reviewedAt.Time
		a.ReviewedAt = &t
	}
	return a
}
