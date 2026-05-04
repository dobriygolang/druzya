// Package app — AI-tutor use cases.
//
// AdoptAITutor — entry point: студент кликает «Adopt» на персоне →
// мы lazy-создаём ai_user, регистрируем relationship через services/tutor,
// открываем thread, шлём welcome-message.
//
// Чат-flow (SendMessage), compaction, assignment-cron — отдельные
// use cases, добавляются в день 2 / 3 (см docs/feature/ai-tutor.md).
package app

import (
	"context"
	"fmt"
	"strings"
	"time"

	"druz9/ai_tutor/domain"

	"github.com/google/uuid"
)

// AdoptAITutor wires together: ensure ai_user → ensure persona.ai_user_id
// → ensure tutor relationship → CreateOrGet thread → append welcome
// system episode.
type AdoptAITutor struct {
	Personas     domain.PersonaRepo
	Threads      domain.ThreadRepo
	Episodes     domain.EpisodeRepo
	AIUserCreator domain.AIUserCreator
	TutorRelator domain.TutorRelator
	Now          func() time.Time
}

type AdoptInput struct {
	StudentID   uuid.UUID
	PersonaSlug string
}

type AdoptResult struct {
	Persona  domain.Persona
	Thread   domain.Thread
	AIUserID uuid.UUID
}

func (uc *AdoptAITutor) Do(ctx context.Context, in AdoptInput) (AdoptResult, error) {
	if in.StudentID == uuid.Nil || strings.TrimSpace(in.PersonaSlug) == "" {
		return AdoptResult{}, fmt.Errorf("ai_tutor.Adopt: %w", domain.ErrInvalidInput)
	}
	persona, err := uc.Personas.GetBySlug(ctx, strings.TrimSpace(in.PersonaSlug))
	if err != nil {
		return AdoptResult{}, fmt.Errorf("ai_tutor.Adopt: persona: %w", err)
	}
	if !persona.Active {
		return AdoptResult{}, fmt.Errorf("ai_tutor.Adopt: persona inactive: %w", domain.ErrInvalidInput)
	}

	// 1) Lazy ai_user creation. Идемпотентно через external_id=slug.
	aiUserID, err := uc.AIUserCreator.EnsureAIUser(ctx, persona.Slug, persona.DisplayName)
	if err != nil {
		return AdoptResult{}, fmt.Errorf("ai_tutor.Adopt: ai_user: %w", err)
	}

	// 2) Stamp ai_user_id на персоне (no-op если уже выставлено).
	if err := uc.Personas.SetAIUserID(ctx, persona.ID, aiUserID); err != nil {
		return AdoptResult{}, fmt.Errorf("ai_tutor.Adopt: persona stamp: %w", err)
	}
	persona.AIUserID = &aiUserID

	now := nowOr(uc.Now)

	// 3) Relationship через services/tutor — ListMyTutors уже умеет
	// возвращать AI-туторов наряду с human, без новых RPC.
	if err := uc.TutorRelator.EnsureRelationship(ctx, aiUserID, in.StudentID, now); err != nil {
		return AdoptResult{}, fmt.Errorf("ai_tutor.Adopt: relationship: %w", err)
	}

	// 4) Thread (идемпотентно). На повторный adopt просто реюзаем.
	thread, err := uc.Threads.CreateOrGet(ctx, in.StudentID, persona.ID)
	if err != nil {
		return AdoptResult{}, fmt.Errorf("ai_tutor.Adopt: thread: %w", err)
	}

	// 5) Welcome system-episode. Только если thread свежий — есть
	// прокси через MessageCount==0 (новый thread без сообщений).
	if thread.MessageCount == 0 {
		welcome := buildWelcomeMessage(persona)
		if _, err := uc.Episodes.Append(ctx, domain.Episode{
			ThreadID: thread.ID,
			Role:     domain.RoleSystem,
			Content:  welcome,
		}); err != nil {
			return AdoptResult{}, fmt.Errorf("ai_tutor.Adopt: welcome: %w", err)
		}
	}

	return AdoptResult{Persona: persona, Thread: thread, AIUserID: aiUserID}, nil
}

func buildWelcomeMessage(p domain.Persona) string {
	return fmt.Sprintf(
		"Привет! Я %s. Готов помогать в твоей подготовке. Расскажи коротко — что готовишь, в какие сроки и что больше всего волнует?",
		p.DisplayName,
	)
}

func nowOr(fn func() time.Time) time.Time {
	if fn != nil {
		return fn()
	}
	return time.Now().UTC()
}
