// Resistance journal use cases (Phase K Wave 15).
//
// Не путать с plan.go::Resistance — там идёт agregate skip skill items.
// Здесь — свободный текст pre-focus, отдельная таблица resistance_log.
package app

import (
	"context"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"druz9/hone/domain"

	"github.com/google/uuid"
)

// MaxResistanceTextLen — длина текста pre-focus подсказки. 200 символов
// — две короткие фразы; больше уже превращается в reflection, а это
// другой канал (focus_reflections.notes).
const MaxResistanceTextLen = 200

// DefaultResistanceJournalWindowDays — окно по умолчанию для weekly digest.
const DefaultResistanceJournalWindowDays = 7

// MaxResistanceJournalWindowDays — потолок на запрос ListResistanceLogs.
// 90 дней совпадает с retention горизонтом telemetry-style таблиц.
const MaxResistanceJournalWindowDays = 90

// LogResistance — фиксирует одну запись. Trim + length-check; возвращает
// hydrated row.
type LogResistance struct {
	Repo domain.JournalRepo
	Log  *slog.Logger
	Now  func() time.Time
}

// LogResistanceInput — wire body.
type LogResistanceInput struct {
	UserID         uuid.UUID
	Text           string
	FocusSessionID *uuid.UUID // optional
	TaskID         *uuid.UUID // optional
}

// Do executes the use case.
func (uc *LogResistance) Do(ctx context.Context, in LogResistanceInput) (domain.JournalEntry, error) {
	text := strings.TrimSpace(in.Text)
	if text == "" {
		return domain.JournalEntry{}, fmt.Errorf("hone.LogResistance: text empty: %w", domain.ErrInvalidInput)
	}
	if len([]rune(text)) > MaxResistanceTextLen {
		// Truncate безопасно по rune-boundary — UTF-8 safe.
		runes := []rune(text)
		text = string(runes[:MaxResistanceTextLen])
	}
	e := domain.JournalEntry{
		UserID:         in.UserID,
		Text:           text,
		FocusSessionID: in.FocusSessionID,
		TaskID:         in.TaskID,
		LoggedAt:       nowOr(uc.Now),
	}
	saved, err := uc.Repo.Insert(ctx, e)
	if err != nil {
		return domain.JournalEntry{}, fmt.Errorf("hone.LogResistance: %w", err)
	}
	return saved, nil
}

// ListResistanceLogs — recency-первый список за окно.
type ListResistanceLogs struct {
	Repo domain.JournalRepo
}

// ListResistanceLogsInput — wire body.
type ListResistanceLogsInput struct {
	UserID uuid.UUID
	Days   int // 0 → DefaultResistanceJournalWindowDays
}

// Do executes the use case.
func (uc *ListResistanceLogs) Do(ctx context.Context, in ListResistanceLogsInput) ([]domain.JournalEntry, error) {
	days := in.Days
	if days <= 0 {
		days = DefaultResistanceJournalWindowDays
	}
	if days > MaxResistanceJournalWindowDays {
		days = MaxResistanceJournalWindowDays
	}
	lookback := time.Duration(days) * 24 * time.Hour
	out, err := uc.Repo.ListRecent(ctx, in.UserID, lookback)
	if err != nil {
		return nil, fmt.Errorf("hone.ListResistanceLogs: %w", err)
	}
	return out, nil
}
