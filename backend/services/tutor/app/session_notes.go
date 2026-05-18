// Package app — tutor session notes-pad.
//
// Тутор пишет личные заметки про студента: «на прошлой сессии проходили
// present perfect, дома — IELTS task 1». Студент не видит.
// Auto-save по дебаунсу из UI.
//
// Доступ: tutor должен быть в active relationship со студентом, иначе
// ErrAccessDenied. Используем существующий ListTutorStudents для
// проверки — добавлять отдельный «есть ли relationship?» метод не
// окупается (cache-miss слабо чувствителен на personal endpoint).

package app

import (
	"context"
	"errors"
	"fmt"

	"druz9/tutor/domain"

	"github.com/google/uuid"
)

const maxSessionNotesLen = 32 * 1024 // 32 KiB md — с запасом

// ErrAccessDenied — тутор не привязан к этому студенту.
var ErrAccessDenied = errors.New("tutor: access denied")

// GetSessionNotes — read-or-empty. Возвращает body == "" если notes ещё
// не создавались (см. Postgres.GetSessionNotes).
type GetSessionNotes struct {
	Repo  domain.Repo
	Notes domain.SessionNotesRepo
}

func (uc *GetSessionNotes) Do(ctx context.Context, tutorID, studentID uuid.UUID) (domain.SessionNotes, error) {
	if uc == nil || uc.Notes == nil || uc.Repo == nil {
		return domain.SessionNotes{}, fmt.Errorf("tutor.GetSessionNotes: not wired")
	}
	if err := assertTutorOf(ctx, uc.Repo, tutorID, studentID); err != nil {
		return domain.SessionNotes{}, err
	}
	out, err := uc.Notes.GetSessionNotes(ctx, tutorID, studentID)
	if err != nil {
		return domain.SessionNotes{}, fmt.Errorf("tutor.GetSessionNotes: %w", err)
	}
	return out, nil
}

// SaveSessionNotes — upsert. Тело прошлось через TrimRight для трейлинг-
// whitespace (но не TrimSpace — leading отступы в md значимы).
type SaveSessionNotes struct {
	Repo  domain.Repo
	Notes domain.SessionNotesRepo
}

func (uc *SaveSessionNotes) Do(ctx context.Context, tutorID, studentID uuid.UUID, bodyMD string) (domain.SessionNotes, error) {
	if uc == nil || uc.Notes == nil || uc.Repo == nil {
		return domain.SessionNotes{}, fmt.Errorf("tutor.SaveSessionNotes: not wired")
	}
	if len(bodyMD) > maxSessionNotesLen {
		return domain.SessionNotes{}, fmt.Errorf("tutor.SaveSessionNotes: body too long (max %d): %w", maxSessionNotesLen, domain.ErrInvalidInput)
	}
	if err := assertTutorOf(ctx, uc.Repo, tutorID, studentID); err != nil {
		return domain.SessionNotes{}, err
	}
	out, err := uc.Notes.SaveSessionNotes(ctx, domain.SessionNotes{
		TutorID:   tutorID,
		StudentID: studentID,
		BodyMD:    bodyMD,
	})
	if err != nil {
		return domain.SessionNotes{}, fmt.Errorf("tutor.SaveSessionNotes: %w", err)
	}
	return out, nil
}

// assertTutorOf проверяет что tutorID имеет active relationship со
// studentID. Returns ErrAccessDenied иначе.
func assertTutorOf(ctx context.Context, repo domain.Repo, tutorID, studentID uuid.UUID) error {
	rels, err := repo.ListTutorStudents(ctx, tutorID)
	if err != nil {
		return fmt.Errorf("tutor.assertTutorOf: list: %w", err)
	}
	for _, r := range rels {
		if r.StudentID == studentID {
			return nil
		}
	}
	return ErrAccessDenied
}
