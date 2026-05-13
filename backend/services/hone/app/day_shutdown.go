package app

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"druz9/hone/domain"

	"github.com/google/uuid"
)

// ─── SubmitDayShutdown ─────────────────────────────────────────────────────
//
// End-of-day ритуал: юзер заполняет 3 короткие textarea (что сделал,
// что висит, что важно на завтра) и нажимает «save». Запись попадает
// в day_shutdowns (UPSERT по (user, shutdown_date)) — повторный submit
// просто обновляет, не дублирует.
//
// Утром daily_brief use case (intelligence) читает вчерашнюю запись
// и кладёт её в coach prompt секцией DAY SHUTDOWN — coach видит «вчера
// юзер закончил X, висит Y, на сегодня важно Z» и рекомендации опираются
// на этот контекст.

type SubmitDayShutdown struct {
	Repo domain.DayShutdownRepo
	Log  *slog.Logger
	Now  func() time.Time
}

type SubmitDayShutdownInput struct {
	UserID uuid.UUID
	// ShutdownDate — если zero-value, use case использует today (UTC).
	// Клиент обычно явно проставляет дату (чтобы 23:55 vs 00:05 не уехали).
	ShutdownDate time.Time
	Done         string
	Pending      string
	Tomorrow     string
}

type SubmitDayShutdownOutput struct {
	Shutdown domain.DayShutdown
}

func (uc *SubmitDayShutdown) Do(ctx context.Context, in SubmitDayShutdownInput) (SubmitDayShutdownOutput, error) {
	done := strings.TrimSpace(in.Done)
	pending := strings.TrimSpace(in.Pending)
	tomorrow := strings.TrimSpace(in.Tomorrow)
	if done == "" && pending == "" && tomorrow == "" {
		return SubmitDayShutdownOutput{}, fmt.Errorf("hone.SubmitDayShutdown.Do: %w", domain.ErrInvalidInput)
	}

	now := uc.Now().UTC()
	date := in.ShutdownDate
	if date.IsZero() {
		date = now.Truncate(24 * time.Hour)
	} else {
		// Нормализуем к 00:00 UTC — в БД колонка DATE, любое hh:mm уйдёт.
		date = date.UTC().Truncate(24 * time.Hour)
	}

	saved, err := uc.Repo.Upsert(ctx, domain.DayShutdown{
		UserID:       in.UserID,
		ShutdownDate: date,
		Done:         done,
		Pending:      pending,
		Tomorrow:     tomorrow,
		CreatedAt:    now,
		UpdatedAt:    now,
	})
	if err != nil {
		return SubmitDayShutdownOutput{}, fmt.Errorf("hone.SubmitDayShutdown.Do: upsert: %w", err)
	}

	if uc.Log != nil {
		uc.Log.Debug("hone.SubmitDayShutdown.Do: saved",
			slog.String("user_id", in.UserID.String()),
			slog.String("shutdown_date", date.Format("2006-01-02")))
	}

	return SubmitDayShutdownOutput{Shutdown: saved}, nil
}

// ─── GetTodayShutdown ──────────────────────────────────────────────────────
//
// Возвращает запись на сегодня, если есть. Frontend использует:
//   - recorded=false → показать пустую модалку (юзер ещё не закрывал день).
//   - recorded=true  → prefill полей.

type GetTodayShutdown struct {
	Repo domain.DayShutdownRepo
	Now  func() time.Time
}

type GetTodayShutdownOutput struct {
	Recorded bool
	Shutdown domain.DayShutdown
}

func (uc *GetTodayShutdown) Do(ctx context.Context, userID uuid.UUID) (GetTodayShutdownOutput, error) {
	today := uc.Now().UTC().Truncate(24 * time.Hour)
	row, err := uc.Repo.GetForDate(ctx, userID, today)
	if err != nil {
		if errors.Is(err, domain.ErrNotFound) {
			return GetTodayShutdownOutput{Recorded: false}, nil
		}
		return GetTodayShutdownOutput{}, fmt.Errorf("hone.GetTodayShutdown.Do: %w", err)
	}
	return GetTodayShutdownOutput{Recorded: true, Shutdown: row}, nil
}
