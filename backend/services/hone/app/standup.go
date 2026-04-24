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

// ─── RecordStandup ─────────────────────────────────────────────────────────

// RecordStandup превращает три классических standup-вопроса в:
//
//  1. Приватную заметку с title="Standup YYYY-MM-DD" и body с разделами
//     «## Yesterday / ## Today / ## Blockers». Заметка пополняет Notes-корпус
//     и попадает в embedding-индекс — будущие заметки / задачи автоматически
//     свяжутся через GetNoteConnections.
//
//  2. Дополнительный PlanItem (kind=custom) в сегодняшнем Plan, если ответ
//     на «today» непустой — чтобы этот пункт можно было запинить в Focus.
//     Генерацию AI-плана НЕ трогает (часть контракта: standup — это ручной
//     ввод, AI его не видит до следующего GenerateDailyPlan).
//
// Ошибки создания заметки — критичны (возвращаем клиенту). Ошибки апдейта
// плана — второстепенны (логируем, возвращаем заметку + пустой/старый Plan).
// Это сознательный trade-off: потеря plan-patch'а менее болезненна, чем
// блокированный standup из-за транзиентной DB-ошибки на патче.
type RecordStandup struct {
	Notes   domain.NoteRepo
	Plans   domain.PlanRepo
	EmbedFn func(ctx context.Context, userID, noteID uuid.UUID, text string)
	Log     *slog.Logger
	Now     func() time.Time
}

// RecordStandupInput — wire body.
type RecordStandupInput struct {
	UserID    uuid.UUID
	Yesterday string
	Today     string
	Blockers  string
}

// RecordStandupOutput — wire response.
type RecordStandupOutput struct {
	Note domain.Note
	Plan domain.Plan // «сегодняшний» plan после патча; может быть zero-value если плана ещё нет
}

// Do executes the use case.
func (uc *RecordStandup) Do(ctx context.Context, in RecordStandupInput) (RecordStandupOutput, error) {
	if strings.TrimSpace(in.Yesterday) == "" && strings.TrimSpace(in.Today) == "" && strings.TrimSpace(in.Blockers) == "" {
		return RecordStandupOutput{}, fmt.Errorf("hone.RecordStandup.Do: %w", domain.ErrInvalidInput)
	}
	now := uc.Now().UTC()
	day := now.Truncate(24 * time.Hour)
	dateStr := day.Format("2006-01-02")

	body := buildStandupBody(in)
	note := domain.Note{
		UserID:    in.UserID,
		Title:     "Standup " + dateStr,
		BodyMD:    body,
		SizeBytes: len(body),
		CreatedAt: now,
		UpdatedAt: now,
	}
	created, err := uc.Notes.Create(ctx, note)
	if err != nil {
		return RecordStandupOutput{}, fmt.Errorf("hone.RecordStandup.Do: create note: %w", err)
	}
	if uc.EmbedFn != nil {
		go uc.EmbedFn(context.Background(), in.UserID, created.ID, created.Title+"\n\n"+created.BodyMD)
	}

	out := RecordStandupOutput{Note: created}

	// Patch сегодняшнего плана — best-effort.
	if today := strings.TrimSpace(in.Today); today != "" {
		patched, perr := uc.appendStandupItem(ctx, in.UserID, day, today)
		switch {
		case perr == nil:
			out.Plan = patched
		case errors.Is(perr, domain.ErrNotFound):
			// Плана ещё нет — это нормально (юзер мог не нажать generate).
			// Возвращаем пустой plan, клиент сам решает показать «Нет плана».
			uc.Log.Debug("hone.RecordStandup.Do: no plan to patch yet",
				slog.String("user_id", in.UserID.String()))
		default:
			uc.Log.Warn("hone.RecordStandup.Do: plan patch failed (non-critical)",
				slog.Any("err", perr), slog.String("user_id", in.UserID.String()))
		}
	}
	return out, nil
}

// appendStandupItem добавляет новый PlanItem к сегодняшнему Plan'у и
// сохраняет через Upsert. Если плана нет — ErrNotFound из GetForDate
// прокидывается наружу; вызывающий решает что с этим делать.
func (uc *RecordStandup) appendStandupItem(ctx context.Context, userID uuid.UUID, day time.Time, todayText string) (domain.Plan, error) {
	p, err := uc.Plans.GetForDate(ctx, userID, day)
	if err != nil {
		return domain.Plan{}, err
	}
	title := todayText
	if len(title) > 60 {
		title = title[:60] + "…"
	}
	p.Items = append(p.Items, domain.PlanItem{
		ID:           newStandupItemID(),
		Kind:         domain.PlanItemCustom,
		Title:        title,
		Subtitle:     "From today's standup",
		EstimatedMin: 30,
	})
	// Upsert перезаписывает items полностью — это ОК: мы только что их
	// прочитали в том же логическом потоке. Между Get и Upsert другой
	// конкурент может тронуть план (напр. параллельный DismissPlanItem),
	// и его изменения потеряются. Принимаем как limitation MVP — один
	// пользователь редко standup'ит и dismiss'ит одновременно.
	return uc.Plans.Upsert(ctx, p)
}

func buildStandupBody(in RecordStandupInput) string {
	var sb strings.Builder
	sb.WriteString("## Yesterday\n")
	if y := strings.TrimSpace(in.Yesterday); y != "" {
		sb.WriteString(y)
	} else {
		sb.WriteString("_(empty)_")
	}
	sb.WriteString("\n\n## Today\n")
	if t := strings.TrimSpace(in.Today); t != "" {
		sb.WriteString(t)
	} else {
		sb.WriteString("_(empty)_")
	}
	sb.WriteString("\n\n## Blockers\n")
	if b := strings.TrimSpace(in.Blockers); b != "" {
		sb.WriteString(b)
	} else {
		sb.WriteString("_(none)_")
	}
	return sb.String()
}

// newStandupItemID — тот же формат, что у plan_generator'а (6-байт hex).
// Дубликат в app-слое вместо импорта из infra, т.к. app не может зависеть
// от infra; crypto/rand напрямую здесь избыточен, используем time-based
// prefix для читаемости в логах.
func newStandupItemID() string {
	// Простой timestamp-based id — коллизия в рамках одного юзера и одной
	// секунды на standup практически невозможна (1 standup/день/юзер).
	return fmt.Sprintf("standup-%d", time.Now().UnixNano()%1_000_000_000)
}
