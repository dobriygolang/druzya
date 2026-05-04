package domain

import (
	"context"
	"time"

	"github.com/google/uuid"
)

// SessionNotes — Phase 3.3 writeable notepad для тутора per-student.
// Live в tutor_session_notes (миграция 00045). Один markdown-блок на
// (tutor, student) пару — без ревизий и журнала по сессиям. Доступ
// строго tutor-only: студент свои notes не видит.
type SessionNotes struct {
	TutorID   uuid.UUID
	StudentID uuid.UUID
	BodyMD    string
	UpdatedAt time.Time
}

// SessionNotesRepo — узкая repo-surface поверх tutor_session_notes.
//
// SaveSessionNotes — upsert (INSERT … ON CONFLICT DO UPDATE). Empty
// body разрешён — это валидное состояние «тутор очистил блок».
//
// GetSessionNotes — read-or-empty: если row нет, возвращает SessionNotes
// с zero UpdatedAt (чтобы handler отдавал empty body вместо 404). Это
// упрощает first-render на фронте (textarea сразу editable).
type SessionNotesRepo interface {
	GetSessionNotes(ctx context.Context, tutorID, studentID uuid.UUID) (SessionNotes, error)
	SaveSessionNotes(ctx context.Context, n SessionNotes) (SessionNotes, error)
}
