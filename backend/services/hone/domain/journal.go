// Resistance journal (Phase K Wave 15) — pre-focus mini-prompt «что трудно
// прямо сейчас?». Не путать с ResistanceRepo (`hone_plan_skips`), который
// трекает chronic-skip skill items по skill_key.
package domain

import (
	"context"
	"time"

	"github.com/google/uuid"
)

// JournalEntry — одна запись свободного текста из pre-focus modal.
type JournalEntry struct {
	ID             uuid.UUID
	UserID         uuid.UUID
	Text           string
	FocusSessionID *uuid.UUID // nullable
	TaskID         *uuid.UUID // nullable
	LoggedAt       time.Time
}

// JournalRepo persists resistance_log.
//
//go:generate mockgen -package mocks -destination mocks/journal_mock.go -source journal.go
type JournalRepo interface {
	// Insert пишет новую запись. Возвращает hydrated row с server-side id.
	Insert(ctx context.Context, e JournalEntry) (JournalEntry, error)
	// ListRecent — entries за `lookback`, ORDER BY logged_at DESC.
	ListRecent(ctx context.Context, userID uuid.UUID, lookback time.Duration) ([]JournalEntry, error)
}

// TaskSuggestion — одна предложенная задача с trace на исходник.
// Не персистится: возвращается из SuggestTasksFromNotes в полёте; при
// AcceptTaskSuggestion превращается в обычный hone_tasks row.
type TaskSuggestion struct {
	// ID — детерминированный hash (note_id + title), стабилен пока юзер не
	// меняет title заметки. Используется фронтом как React-list key.
	ID            string
	Title         string
	SourceNoteID  uuid.UUID
	SourceExcerpt string
}
