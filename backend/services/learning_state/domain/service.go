package domain

import (
	"fmt"
	"time"

	"github.com/google/uuid"
)

// ValidateState проверяет инварианты перед записью в БД.
//
// Mirror'ит CHECK в миграции 00047:
//   - mode ∈ enum (валидируется типом Mode.IsValid)
//   - mode != explore → CommittedTrackID != nil
//   - ForkBranch если задан — валидное значение
//   - CommittedTrackID и CommittedAt — оба nil или оба не-nil
func ValidateState(s State) error {
	if !s.Mode.IsValid() {
		return fmt.Errorf("%w: mode %q invalid", ErrInvalidTransition, s.Mode)
	}
	if s.Mode != ModeExplore && s.CommittedTrackID == nil {
		return fmt.Errorf("%w: mode=%s requires committed_track_id", ErrInvalidTransition, s.Mode)
	}
	if s.ForkBranch != nil && !s.ForkBranch.IsValid() {
		return fmt.Errorf("%w: fork_branch %q invalid", ErrInvalidTransition, *s.ForkBranch)
	}
	if (s.CommittedTrackID == nil) != (s.CommittedAt == nil) {
		return fmt.Errorf("%w: committed_track_id and committed_at must be both set or both nil", ErrInvalidTransition)
	}
	return nil
}

// ApplyMode — pure-функция перехода Mode'а с derived поля
// (CommittedTrackID/CommittedAt). Caller'у проще держать всю логику
// здесь, чем размазывать по UC.
//
// Семантика:
//   - ModeExplore → сбрасывает committed_track_id/at в nil
//   - ModeCommit/ModeDeep → требует non-nil trackID, ставит committed_at = now
//
// Если переход невалиден — возвращает ErrInvalidTransition.
func ApplyMode(prev State, target Mode, trackID *uuid.UUID, now time.Time) (State, error) {
	if !target.IsValid() {
		return State{}, fmt.Errorf("%w: target mode %q invalid", ErrInvalidTransition, target)
	}
	out := prev
	out.Mode = target
	out.UpdatedAt = now

	switch target {
	case ModeExplore:
		out.CommittedTrackID = nil
		out.CommittedAt = nil
	case ModeCommit, ModeDeep:
		if trackID == nil {
			return State{}, fmt.Errorf("%w: %s requires track_id", ErrInvalidTransition, target)
		}
		// Не перезаписываем committed_at если track тот же — не теряем
		// "когда впервые выбрал".
		sameTrack := prev.CommittedTrackID != nil && *prev.CommittedTrackID == *trackID
		out.CommittedTrackID = trackID
		if !sameTrack || prev.CommittedAt == nil {
			out.CommittedAt = ptrTime(now)
		}
	}
	return out, ValidateState(out)
}

// ApplyFork выставляет ветку fork-анализа. nil = очистить выбор (отменить
// fork-prompt; редко нужно — для admin-tools).
func ApplyFork(prev State, branch *ForkBranch, now time.Time) (State, error) {
	if branch != nil && !branch.IsValid() {
		return State{}, fmt.Errorf("%w: fork_branch %q invalid", ErrInvalidTransition, *branch)
	}
	out := prev
	out.ForkBranch = branch
	out.UpdatedAt = now
	return out, ValidateState(out)
}

func ptrTime(t time.Time) *time.Time { return &t }
