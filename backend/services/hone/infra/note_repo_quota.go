// note_repo_quota.go — decorator над NoteRepo'ом который checks quota перед
// Create. Используется ВО ВСЕХ путях создания notes:
//   - CreateNote RPC (existing CheckCreateNoteQuota gate уже срабатывает)
//   - RecordStandup (создаёт "Standup YYYY-MM-DD" note)
//   - EndFocusSession (создаёт reflection note если юзер написал commentary)
//   - Whiteboard snapshot export (создаёт note со ссылкой на board)
//
// Gate работает на уровне Notes.Create — независимо от того какой use case
// его дёрнул. Это closes loophole: раньше ports.HoneServer.CreateNote имел
// свой check, но focus/standup/whiteboard use cases шли мимо него.
package infra

import (
	"context"
	"fmt"
	"time"

	"druz9/hone/domain"

	"github.com/google/uuid"
)

// NoteQuotaCheck — closure возвращающий ошибку (typically `ErrQuotaExceeded`)
// если юзер достиг лимита. nil — passthrough (no enforcement).
type NoteQuotaCheck func(ctx context.Context, userID uuid.UUID) error

// QuotaAwareNoteRepo wraps inner NoteRepo with pre-Create quota check.
type QuotaAwareNoteRepo struct {
	inner domain.NoteRepo
	check NoteQuotaCheck
}

// NewQuotaAwareNoteRepo wraps `inner`. If `check` is nil, returns inner
// unchanged (zero overhead, transparent).
func NewQuotaAwareNoteRepo(inner domain.NoteRepo, check NoteQuotaCheck) domain.NoteRepo {
	if check == nil {
		return inner
	}
	return &QuotaAwareNoteRepo{inner: inner, check: check}
}

// Каждый passthrough оборачивает inner-error fmt.Errorf'ом — wrapcheck
// linter иначе ругается «error returned from interface method should be
// wrapped». Это для трассируемости — стек уже включает наш decorator.

func (r *QuotaAwareNoteRepo) Create(ctx context.Context, n domain.Note) (domain.Note, error) {
	if n.UserID != uuid.Nil {
		if err := r.check(ctx, n.UserID); err != nil {
			return domain.Note{}, fmt.Errorf("hone.QuotaAwareNoteRepo.Create: %w", err)
		}
	}
	out, err := r.inner.Create(ctx, n)
	if err != nil {
		return out, fmt.Errorf("hone.QuotaAwareNoteRepo.Create: %w", err)
	}
	return out, nil
}

func (r *QuotaAwareNoteRepo) Update(ctx context.Context, n domain.Note) (domain.Note, error) {
	out, err := r.inner.Update(ctx, n)
	if err != nil {
		return out, fmt.Errorf("hone.QuotaAwareNoteRepo.Update: %w", err)
	}
	return out, nil
}

func (r *QuotaAwareNoteRepo) Get(ctx context.Context, userID, noteID uuid.UUID) (domain.Note, error) {
	out, err := r.inner.Get(ctx, userID, noteID)
	if err != nil {
		return out, fmt.Errorf("hone.QuotaAwareNoteRepo.Get: %w", err)
	}
	return out, nil
}

func (r *QuotaAwareNoteRepo) List(ctx context.Context, userID uuid.UUID, limit int, cursor string) ([]domain.NoteSummary, string, error) {
	rows, next, err := r.inner.List(ctx, userID, limit, cursor)
	if err != nil {
		return rows, next, fmt.Errorf("hone.QuotaAwareNoteRepo.List: %w", err)
	}
	return rows, next, nil
}

func (r *QuotaAwareNoteRepo) Delete(ctx context.Context, userID, noteID uuid.UUID) error {
	if err := r.inner.Delete(ctx, userID, noteID); err != nil {
		return fmt.Errorf("hone.QuotaAwareNoteRepo.Delete: %w", err)
	}
	return nil
}

func (r *QuotaAwareNoteRepo) SetArchived(ctx context.Context, userID, noteID uuid.UUID, archived bool) error {
	if err := r.inner.SetArchived(ctx, userID, noteID, archived); err != nil {
		return fmt.Errorf("hone.QuotaAwareNoteRepo.SetArchived: %w", err)
	}
	return nil
}

func (r *QuotaAwareNoteRepo) SetEmbedding(ctx context.Context, userID, noteID uuid.UUID, vec []float32, model string, at time.Time) error {
	if err := r.inner.SetEmbedding(ctx, userID, noteID, vec, model, at); err != nil {
		return fmt.Errorf("hone.QuotaAwareNoteRepo.SetEmbedding: %w", err)
	}
	return nil
}

func (r *QuotaAwareNoteRepo) WithEmbeddingsForUser(ctx context.Context, userID uuid.UUID) ([]domain.NoteEmbedding, error) {
	out, err := r.inner.WithEmbeddingsForUser(ctx, userID)
	if err != nil {
		return out, fmt.Errorf("hone.QuotaAwareNoteRepo.WithEmbeddingsForUser: %w", err)
	}
	return out, nil
}

func (r *QuotaAwareNoteRepo) ExistsByTitleForUser(ctx context.Context, userID uuid.UUID, title string) (bool, error) {
	ok, err := r.inner.ExistsByTitleForUser(ctx, userID, title)
	if err != nil {
		return ok, fmt.Errorf("hone.QuotaAwareNoteRepo.ExistsByTitleForUser: %w", err)
	}
	return ok, nil
}

// Compile-time assertion: ensure decorator satisfies the interface.
var _ domain.NoteRepo = (*QuotaAwareNoteRepo)(nil)
