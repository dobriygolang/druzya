// Package app — Cue session use cases.
//
// Cue sessions — это импорты из desktop-приложения Cue (отдельный pseudo-
// folder в Hone). Идемпотентны по file_path: повторный Import не дублирует
// сессию и НЕ перезаписывает body_md (юзерские правки сохраняются).
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

// ─── ImportCueSession ───────────────────────────────────────────────────────

// ImportCueSession сохраняет (или обновляет по file_path) одну Cue-сессию.
// Title и raw_analysis всегда обновляются от свежего экспорта; body_md
// остаётся прежним если сессия уже была импортирована.
type ImportCueSession struct {
	Repo domain.CueSessionRepo
	Log  *slog.Logger
	Now  func() time.Time
}

type ImportCueSessionInput struct {
	UserID          uuid.UUID
	FilePath        string
	Title           string
	BodyMD          string // используется только при FIRST import
	RawAnalysisJSON string
	StartedAt       *time.Time
}

func (uc *ImportCueSession) Do(ctx context.Context, in ImportCueSessionInput) (domain.CueSession, error) {
	if strings.TrimSpace(in.FilePath) == "" {
		return domain.CueSession{}, fmt.Errorf("hone.ImportCueSession: %w: file_path required", domain.ErrInvalidInput)
	}
	s := domain.CueSession{
		UserID:          in.UserID,
		FilePath:        in.FilePath,
		Title:           in.Title,
		RawAnalysisJSON: in.RawAnalysisJSON,
		StartedAt:       in.StartedAt,
	}
	out, err := uc.Repo.Import(ctx, s, in.BodyMD)
	if err != nil {
		return domain.CueSession{}, fmt.Errorf("hone.ImportCueSession: %w", err)
	}
	return out, nil
}

// ─── ListCueSessions ────────────────────────────────────────────────────────

type ListCueSessions struct {
	Repo domain.CueSessionRepo
}

func (uc *ListCueSessions) Do(ctx context.Context, userID uuid.UUID) ([]domain.CueSession, error) {
	rows, err := uc.Repo.List(ctx, userID)
	if err != nil {
		return nil, fmt.Errorf("hone.ListCueSessions: %w", err)
	}
	return rows, nil
}

// ─── GetCueSession ──────────────────────────────────────────────────────────

type GetCueSession struct {
	Repo domain.CueSessionRepo
}

func (uc *GetCueSession) Do(ctx context.Context, userID, id uuid.UUID) (domain.CueSession, error) {
	s, err := uc.Repo.Get(ctx, userID, id)
	if err != nil {
		return domain.CueSession{}, fmt.Errorf("hone.GetCueSession: %w", err)
	}
	return s, nil
}

// ─── UpdateCueSession ───────────────────────────────────────────────────────

// UpdateCueSession редактирует body_md (юзерский слой). Title и raw_analysis
// меняются только через ре-импорт из Cue.
type UpdateCueSession struct {
	Repo domain.CueSessionRepo
}

func (uc *UpdateCueSession) Do(ctx context.Context, userID, id uuid.UUID, bodyMD string) (domain.CueSession, error) {
	s, err := uc.Repo.UpdateBody(ctx, userID, id, bodyMD)
	if err != nil {
		return domain.CueSession{}, fmt.Errorf("hone.UpdateCueSession: %w", err)
	}
	return s, nil
}

// ─── DeleteCueSession ───────────────────────────────────────────────────────

type DeleteCueSession struct {
	Repo domain.CueSessionRepo
}

func (uc *DeleteCueSession) Do(ctx context.Context, userID, id uuid.UUID) error {
	if err := uc.Repo.Delete(ctx, userID, id); err != nil {
		return fmt.Errorf("hone.DeleteCueSession: %w", err)
	}
	return nil
}

// ─── SendCueSessionToTelegram ───────────────────────────────────────────────

// SendCueSessionToTelegram читает сессию + шлёт markdown в TG юзера через
// notify-сервис. Если у юзера не linked TG — возвращает ok=false с
// информативным message'ем (не error: это user-facing статус).
type SendCueSessionToTelegram struct {
	Repo   domain.CueSessionRepo
	Sender domain.NotificationSender
	Log    *slog.Logger
}

type SendCueSessionToTelegramOutput struct {
	OK      bool
	Message string
}

func (uc *SendCueSessionToTelegram) Do(ctx context.Context, userID, id uuid.UUID) (SendCueSessionToTelegramOutput, error) {
	if uc.Sender == nil {
		return SendCueSessionToTelegramOutput{
			OK:      false,
			Message: "telegram not configured",
		}, nil
	}
	s, err := uc.Repo.Get(ctx, userID, id)
	if err != nil {
		return SendCueSessionToTelegramOutput{}, fmt.Errorf("hone.SendCueSessionToTelegram: %w", err)
	}
	body := s.BodyMD
	if strings.TrimSpace(body) == "" {
		body = "(empty)"
	}
	title := s.Title
	if title == "" {
		title = "Meeting notes"
	}
	ok, msg, sendErr := uc.Sender.SendCueFollowup(ctx, userID, title, body)
	if sendErr != nil {
		// Infra error — нужно лог + 500. User-side errors (not linked,
		// rate limit) приходят как ok=false без error'а.
		if uc.Log != nil {
			uc.Log.WarnContext(ctx, "hone.SendCueSessionToTelegram: sender failed",
				slog.Any("err", sendErr), slog.String("user_id", userID.String()))
		}
		return SendCueSessionToTelegramOutput{}, fmt.Errorf("hone.SendCueSessionToTelegram: %w", sendErr)
	}
	return SendCueSessionToTelegramOutput{OK: ok, Message: msg}, nil
}

