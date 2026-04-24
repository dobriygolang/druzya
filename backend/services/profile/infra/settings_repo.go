package infra

import (
	"context"
	"errors"
	"fmt"

	"druz9/profile/domain"
	"druz9/shared/enums"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
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
