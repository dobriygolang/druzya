// Package domain — учебное состояние пользователя: режим (explore /
// commit / deep) и ветка fork-анализа (de / mle / none).
//
// Зачем нужен отдельный сервис: intelligence читает FORK STATUS для
// daily-brief prompt, hone-coach показывает «week N of 6 explore»,
// admin distribution-tab (Phase 12.5) агрегирует по mode. Все три
// слоя ходят к одной таблице, домен общий.
package domain

import (
	"errors"
	"time"

	"github.com/google/uuid"
)

// Mode — текущий режим обучения.
type Mode string

const (
	// ModeExplore — пробует несколько треков. Default после регистрации.
	ModeExplore Mode = "explore"
	// ModeCommit — выбран один track, идёт по нему.
	ModeCommit Mode = "commit"
	// ModeDeep — фокус на mastery committed track'а (углубление).
	ModeDeep Mode = "deep"
)

func (m Mode) IsValid() bool {
	switch m {
	case ModeExplore, ModeCommit, ModeDeep:
		return true
	}
	return false
}

func (m Mode) String() string { return string(m) }

// ForkBranch — cross-cutting специализация внутри dev_senior:
//   - de  — data engineering
//   - mle — ML engineering
//   - none — пользователь явно отказался от fork (single-track)
//
// Pointer-NULL означает «ещё не выбирал» — fork prompt не показан.
type ForkBranch string

const (
	ForkDE   ForkBranch = "de"
	ForkMLE  ForkBranch = "mle"
	ForkNone ForkBranch = "none"
)

func (f ForkBranch) IsValid() bool {
	switch f {
	case ForkDE, ForkMLE, ForkNone:
		return true
	}
	return false
}

func (f ForkBranch) String() string { return string(f) }

// State — снапшот строки learning_state.
//
// Инвариант (поддерживается app + DB CHECK):
//   - Mode == ModeExplore  → CommittedTrackID может быть nil
//   - Mode != ModeExplore  → CommittedTrackID НЕ nil
//
// CommittedAt всегда парный CommittedTrackID (оба nil или оба set) —
// это soft-инвариант, repo приводит при SetMode.
type State struct {
	UserID             uuid.UUID
	Mode               Mode
	ForkBranch         *ForkBranch // nil = не выбирал
	ExploreStartedAt   time.Time
	CommittedTrackID   *uuid.UUID
	CommittedAt        *time.Time
	CreatedAt          time.Time
	UpdatedAt          time.Time
}

// Default возвращает initial state для нового юзера. Lazy-create в repo
// зовёт его, когда строки в DB ещё нет.
func Default(userID uuid.UUID, now time.Time) State {
	return State{
		UserID:           userID,
		Mode:             ModeExplore,
		ExploreStartedAt: now,
		CreatedAt:        now,
		UpdatedAt:        now,
	}
}

// ErrInvalidTransition — попытка перехода mode'а с inconsistent payload'ом
// (commit без trackID, fork без валидной ветки и т.п.).
var ErrInvalidTransition = errors.New("learning_state: invalid transition")

// ErrNotFound — repo не нашёл строку. App lazy-create'ит default'ом.
var ErrNotFound = errors.New("learning_state: not found")
