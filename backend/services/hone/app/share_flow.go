// share_flow.go — use-case'ы атомарных «Share to web» / «Make private»
// переходов. UX модель: кнопок encrypt/decrypt у пользователя нет, всё
// сводится к одному toggle'у public ↔ private. Шифрование/дешифровка
// делается клиентом, сервер получает либо plaintext (для share), либо
// ciphertext (для make-private) — оба пути идут одной транзакцией,
// промежуточные «decrypted but not published» состояния невидимы.
package app

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"druz9/hone/domain"

	"github.com/google/uuid"
)

// ─── ShareToWeb ───────────────────────────────────────────────────────────

// ShareToWeb — atomic «decrypt + publish». Клиент сначала локально
// расшифровал заметку (PBKDF2 → AES-GCM), prsedает plaintextMD; сервер
// одной транзакцией пишет body_md, сбрасывает encrypted=false, выставляет
// public_slug+published_at.
//
// Идемпотентность: если заметка уже published И не encrypted → возвращаем
// existing slug без перезаписи body. Если encrypted=true ИЛИ не published
// — выполняем атомарный апдейт.
type ShareToWeb struct {
	Repo      domain.PublishRepo
	Publisher domain.SyncEventPublisher // optional; nil → no realtime push
	EmbedFn   func(ctx context.Context, userID, noteID uuid.UUID, text string)
	Log       *slog.Logger
	// SlugGen — фабрика slug'ов; nil → дефолт generateSlug.
	SlugGen func() (string, error)
}

// ShareToWebInput.
type ShareToWebInput struct {
	UserID         uuid.UUID
	NoteID         uuid.UUID
	PlaintextMD    string
	OriginDeviceID uuid.UUID
}

// ShareToWebOutput.
type ShareToWebOutput struct {
	Slug             string
	PublishedAt      time.Time
	AlreadyPublished bool
}

// Do executes the use case.
func (uc *ShareToWeb) Do(ctx context.Context, in ShareToWebInput) (ShareToWebOutput, error) {
	lookup, err := uc.Repo.LookupForPublish(ctx, in.UserID, in.NoteID)
	if err != nil {
		return ShareToWebOutput{}, fmt.Errorf("hone.ShareToWeb.Do: %w", err)
	}
	if !lookup.Encrypted && lookup.Slug != nil && lookup.PublishedAt != nil {
		return ShareToWebOutput{
			Slug:             *lookup.Slug,
			PublishedAt:      *lookup.PublishedAt,
			AlreadyPublished: true,
		}, nil
	}

	slugGen := uc.SlugGen
	if slugGen == nil {
		slugGen = generateSlug
	}

	var (
		newSlug string
		newAt   time.Time
	)
	for attempt := 0; attempt < publishMaxAttempts; attempt++ {
		candidate, gerr := slugGen()
		if gerr != nil {
			return ShareToWebOutput{}, fmt.Errorf("hone.ShareToWeb.Do: slug-gen: %w", gerr)
		}
		at, aerr := uc.Repo.ShareToWebAtomic(ctx, in.UserID, in.NoteID, in.PlaintextMD, candidate)
		if aerr == nil {
			newSlug = candidate
			newAt = at
			break
		}
		if errors.Is(aerr, domain.ErrPublishSlugCollision) {
			continue
		}
		return ShareToWebOutput{}, fmt.Errorf("hone.ShareToWeb.Do: %w", aerr)
	}
	if newSlug == "" {
		return ShareToWebOutput{}, fmt.Errorf("hone.ShareToWeb.Do: %d slug attempts failed", publishMaxAttempts)
	}

	// Re-index for connections / coach retrieval — body_md is now plaintext.
	if uc.EmbedFn != nil {
		go uc.EmbedFn(context.Background(), in.UserID, in.NoteID, in.PlaintextMD)
	}
	if uc.Publisher != nil {
		uc.Publisher.PublishSyncChange(in.UserID, "hone_notes", in.OriginDeviceID)
	}
	return ShareToWebOutput{Slug: newSlug, PublishedAt: newAt}, nil
}

// ─── MakePrivate ──────────────────────────────────────────────────────────

// ErrMakePrivateEmptyCiphertext — пустой ciphertext.
var ErrMakePrivateEmptyCiphertext = errors.New("hone: empty ciphertext")

// MakePrivate — atomic «encrypt + unpublish». Клиент локально зашифровал
// текущее тело, prsedает ciphertextB64; сервер одной транзакцией пишет body,
// ставит encrypted=true, обнуляет публичный slug+published_at и embedding.
//
// Идемпотентность: если заметка уже encrypted И не published — апдейтим
// только body (ciphertext может быть свежим). Если published — атомарно
// прячем.
type MakePrivate struct {
	Repo      domain.PublishRepo
	Publisher domain.SyncEventPublisher
	Log       *slog.Logger
}

// MakePrivateInput.
type MakePrivateInput struct {
	UserID         uuid.UUID
	NoteID         uuid.UUID
	CiphertextB64  string
	OriginDeviceID uuid.UUID
}

// Do executes the use case.
func (uc *MakePrivate) Do(ctx context.Context, in MakePrivateInput) error {
	if in.CiphertextB64 == "" {
		return ErrMakePrivateEmptyCiphertext
	}
	if err := uc.Repo.MakePrivateAtomic(ctx, in.UserID, in.NoteID, in.CiphertextB64); err != nil {
		return fmt.Errorf("hone.MakePrivate.Do: %w", err)
	}
	if uc.Publisher != nil {
		uc.Publisher.PublishSyncChange(in.UserID, "hone_notes", in.OriginDeviceID)
	}
	return nil
}
