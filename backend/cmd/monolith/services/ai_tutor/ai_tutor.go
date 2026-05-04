// Package ai_tutor — wiring AI-tutor bounded context в monolith.
//
// Adapters:
//   aiUserCreatorPG — INSERT/UPSERT юзера с role='ai_tutor' через
//                     прямой pgx (нет use-case в profile для admin-creates).
//   tutorRelatorAdapter — wraps tutorDomain.Repo.AcceptInvite-like logic;
//                         мы используем CreateAITutorRelationship прямой
//                         INSERT с ON CONFLICT DO NOTHING.
//   snapshotAdapter — wraps tutorApp.GetStudentSnapshot, formats в текст.
//   llmAdapter — wraps llmchain.Chain, mapping task-kind-string → Task.
package ai_tutor

import (
	"context"
	"fmt"
	"strings"
	"time"

	aiTutorApp "druz9/ai_tutor/app"
	aiTutorDomain "druz9/ai_tutor/domain"
	aiTutorInfra "druz9/ai_tutor/infra"
	aiTutorPorts "druz9/ai_tutor/ports"
	monolithServices "druz9/cmd/monolith/services"
	intelDomain "druz9/intelligence/domain"
	sharedDomain "druz9/shared/domain"
	"druz9/shared/generated/pb/druz9/v1/druz9v1connect"
	"druz9/shared/pkg/eventbus"
	"druz9/shared/pkg/llmchain"
	tutorApp "druz9/tutor/app"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
)

// AITutorDeps — необязательные deps для wiring. Snapshot можно пропустить
// (UC грейсфул деградирует на recall без snapshot-блока), Chain обязателен
// для реального chat (без него SendMessage возвращает ошибку).
type AITutorDeps struct {
	Snapshot *tutorApp.GetStudentSnapshot
	// Chain — llmchain.ChatClient interface (реальный *llmchain.Chain
	// или fake в тестах). Используем интерфейс из shared/pkg/llmchain
	// чтобы не делать type-assertion в bootstrap.go.
	Chain llmchain.ChatClient
	// ExternalActivity — Phase pivot 2026-05-02. Reads aggregated
	// external_activity (LeetCode / Coursera / books) → snapshot text
	// для AI-tutor recall. nil-safe: snapshotAdapter возвращает «(нет
	// данных)» если nil или empty summary.
	ExternalActivity intelDomain.ExternalActivityReader
	// Focus / Mocks / Skills — additional snapshot axes для AI-tutor
	// recall. nil-safe: missing axis = silent skip в snapshot text'е.
	Focus  intelDomain.FocusReader
	Mocks  intelDomain.MockReader
	Skills intelDomain.SkillReader
	// PushAssignment — tutor.PushAssignment use case. Используется
	// OnFailedMock subscriber'ом для proactive trigger'а: после mock
	// с overall<70 AI-coach пушит assignment в Hone TaskBoard. nil-safe:
	// без этого subscriber не подписывается.
	PushAssignment *tutorApp.PushAssignment
}

func NewAITutor(d monolithServices.Deps, td AITutorDeps) *monolithServices.Module {
	pg := aiTutorInfra.NewPostgres(d.Pool)

	aiUserCreator := &aiUserCreatorPG{pool: d.Pool}
	relator := &tutorRelatorAdapter{pool: d.Pool}
	snapshot := &snapshotAdapter{
		uc:       td.Snapshot,
		external: td.ExternalActivity,
		focus:    td.Focus,
		mocks:    td.Mocks,
		skills:   td.Skills,
	}
	llm := &llmAdapter{chain: td.Chain}

	compactUC := &aiTutorApp.Compact{
		Threads:  pg,
		Episodes: pg,
		Facts:    pg,
		LLM:      llm,
		Now:      d.Now,
	}

	server := &aiTutorPorts.Server{
		Personas: pg,
		Threads:  pg,
		Episodes: pg,
		AdoptUC: &aiTutorApp.AdoptAITutor{
			Personas:      pg,
			Threads:       pg,
			Episodes:      pg,
			AIUserCreator: aiUserCreator,
			TutorRelator:  relator,
			Now:           d.Now,
		},
		SendUC: &aiTutorApp.SendMessage{
			Personas:  pg,
			Threads:   pg,
			Episodes:  pg,
			Facts:     pg,
			Snapshot:  snapshot,
			LLM:       llm,
			Compactor: compactUC,
			Now:       d.Now,
		},
		Log: d.Log,
	}

	connectPath, connectHandler := druz9v1connect.NewAITutorServiceHandler(server)
	transcoder := monolithServices.MustTranscode("ai_tutor", connectPath, connectHandler)

	mod := &monolithServices.Module{
		ConnectPath:        connectPath,
		ConnectHandler:     transcoder,
		RequireConnectAuth: true,
		MountREST: func(r chi.Router) {
			r.Post("/ai-tutor/adopt", transcoder.ServeHTTP)
			r.Get("/ai-tutor/threads", transcoder.ServeHTTP)
			r.Get("/ai-tutor/threads/{thread_id}/history", transcoder.ServeHTTP)
			r.Post("/ai-tutor/threads/{thread_id}/messages", transcoder.ServeHTTP)
		},
		MountPublicREST: func(r chi.Router) {
			// Persona catalogue — рендерится на /marketplace до auth.
			r.Get("/ai-tutor/personas", transcoder.ServeHTTP)
		},
	}

	// Proactive trigger: после провального mock'а (overall<70) AI-coach
	// автогенерит assignment в Hone TaskBoard. Подписываемся только
	// если PushAssignment wired — иначе UC всё равно ничего не сделает.
	if td.PushAssignment != nil {
		failedMockUC := &aiTutorApp.OnFailedMock{
			Personas:    pg,
			Threads:     pg,
			Episodes:    pg,
			LLM:         llm,
			Assignments: &assignmentPusherAdapter{uc: td.PushAssignment},
			Guard:       pg, // *Postgres satisfies ProcessedMockGuard (ReserveProcessedMock)
			Now:         d.Now,
		}
		mod.Subscribers = append(mod.Subscribers, func(b *eventbus.InProcess) {
			b.Subscribe(sharedDomain.MockReportReady{}.Topic(), func(ctx context.Context, ev sharedDomain.Event) error {
				e, ok := ev.(sharedDomain.MockReportReady)
				if !ok {
					return nil
				}
				return failedMockUC.Do(ctx, aiTutorApp.OnFailedMockInput{
					SessionID:    e.SessionID,
					StudentID:    e.UserID,
					Section:      string(e.Section),
					OverallScore: e.OverallScore,
					Weaknesses:   e.Weaknesses,
				})
			})
		})
	}

	return mod
}

// ── adapters ────────────────────────────────────────────────────

type aiUserCreatorPG struct{ pool *pgxpool.Pool }

func (c *aiUserCreatorPG) EnsureAIUser(ctx context.Context, slug, displayName string) (uuid.UUID, error) {
	username := "ai-tutor::" + slug
	// UPSERT через ON CONFLICT (username) DO NOTHING + SELECT.
	_, err := c.pool.Exec(ctx, `
		INSERT INTO users (username, role, display_name)
		VALUES ($1, 'ai_tutor', $2)
		ON CONFLICT (username) DO NOTHING`,
		username, displayName,
	)
	if err != nil {
		return uuid.Nil, fmt.Errorf("ai_tutor.EnsureAIUser: %w", err)
	}
	var id pgtype.UUID
	if err := c.pool.QueryRow(ctx,
		`SELECT id FROM users WHERE username = $1`, username,
	).Scan(&id); err != nil {
		return uuid.Nil, fmt.Errorf("ai_tutor.EnsureAIUser read: %w", err)
	}
	if !id.Valid {
		return uuid.Nil, fmt.Errorf("ai_tutor.EnsureAIUser: empty id after upsert")
	}
	return uuid.UUID(id.Bytes), nil
}

type tutorRelatorAdapter struct{ pool *pgxpool.Pool }

// EnsureRelationship — прямой INSERT в tutor_students минуя AcceptInvite
// (который требует invite-код). На AI-тутор-flow «invite» не существует
// — Adopt и есть момент relationship-creation. ON CONFLICT партирует
// active partial-unique-index → не дубликаты на повторных Adopt'ах.
//
// invite_id остаётся NULL (legitimate — у AI relationship нет invite).
func (a *tutorRelatorAdapter) EnsureRelationship(ctx context.Context, tutorID, studentID uuid.UUID, now time.Time) error {
	if a.pool == nil {
		return fmt.Errorf("ai_tutor.tutorRelator: pool not wired")
	}
	if tutorID == uuid.Nil || studentID == uuid.Nil {
		return fmt.Errorf("ai_tutor.tutorRelator: empty ids")
	}
	if tutorID == studentID {
		return fmt.Errorf("ai_tutor.tutorRelator: self-link")
	}
	_, err := a.pool.Exec(ctx, `
		INSERT INTO tutor_students (tutor_id, student_id, started_at)
		VALUES ($1, $2, $3)
		ON CONFLICT DO NOTHING`,
		pgtype.UUID{Bytes: tutorID, Valid: true},
		pgtype.UUID{Bytes: studentID, Valid: true},
		pgtype.Timestamptz{Time: now, Valid: true},
	)
	if err != nil {
		return fmt.Errorf("ai_tutor.tutorRelator.EnsureRelationship: %w", err)
	}
	return nil
}

type snapshotAdapter struct {
	uc       *tutorApp.GetStudentSnapshot
	external intelDomain.ExternalActivityReader
	focus    intelDomain.FocusReader
	mocks    intelDomain.MockReader
	skills   intelDomain.SkillReader
}

// GetSnapshotText собирает короткий текстовый snapshot для AI-tutor recall.
// Текущие axes:
//   - External activity (LeetCode / Coursera / books) — sum minutes / sources / topics за 7 дней
//   - Focus seconds — суммарно за 7 дней (Hone)
//   - Recent mocks — последние 3 finished sessions с score + weak_topics
//   - Weak skills — top-3 atlas-узла с lowest progress
//
// Каждая axis nil-safe и optional. Все ошибки swallowed: AI-tutor должен
// работать даже когда intelligence readers упали.
func (a *snapshotAdapter) GetSnapshotText(ctx context.Context, studentID uuid.UUID) (string, error) {
	if a == nil {
		return "", nil
	}
	var lines []string

	if a.external != nil {
		s, err := a.external.SummaryWindow(ctx, studentID, 7)
		if err == nil && s.MinutesWindow > 0 {
			line := fmt.Sprintf("Внешнее обучение (7 дней): %d мин", s.MinutesWindow)
			if len(s.Sources) > 0 {
				line += " · источники: " + strings.Join(s.Sources, ", ")
			}
			if len(s.TopTopics) > 0 {
				line += " · темы: " + strings.Join(s.TopTopics, ", ")
			}
			lines = append(lines, line)
		}
	}

	if a.focus != nil {
		days, err := a.focus.LastNDays(ctx, studentID, 7)
		if err == nil {
			var totalSec int
			activeDays := 0
			for _, d := range days {
				totalSec += d.Seconds
				if d.Seconds > 0 {
					activeDays++
				}
			}
			if totalSec > 0 {
				lines = append(lines, fmt.Sprintf(
					"Hone focus (7 дней): %d мин активного фокуса в %d/7 днях.",
					totalSec/60, activeDays,
				))
			}
		}
	}

	if a.mocks != nil {
		ms, err := a.mocks.LastNFinished(ctx, studentID, 3)
		if err == nil && len(ms) > 0 {
			parts := make([]string, 0, len(ms))
			for _, m := range ms {
				p := fmt.Sprintf("%s=%d/10", string(m.Section), m.Score)
				if len(m.WeakTopics) > 0 {
					p += " (" + strings.Join(m.WeakTopics, "/") + ")"
				}
				parts = append(parts, p)
			}
			lines = append(lines, "Последние mocks: "+strings.Join(parts, "; "))
		}
	}

	if a.skills != nil {
		sk, err := a.skills.WeakestN(ctx, studentID, 3)
		if err == nil && len(sk) > 0 {
			titles := make([]string, 0, len(sk))
			for _, s := range sk {
				titles = append(titles, s.Title)
			}
			lines = append(lines, "Weak skills: "+strings.Join(titles, ", "))
		}
	}

	if len(lines) == 0 {
		return "", nil
	}
	return strings.Join(lines, "\n"), nil
}

type llmAdapter struct{ chain llmchain.ChatClient }

func (a *llmAdapter) Run(
	ctx context.Context,
	taskKind string,
	messages []aiTutorDomain.LLMMessage,
	opts aiTutorDomain.LLMOptions,
) (aiTutorDomain.LLMResponse, error) {
	if a.chain == nil {
		return aiTutorDomain.LLMResponse{}, fmt.Errorf("ai_tutor.LLM: chain not wired")
	}
	// taskKind — string слаг ("TaskAITutorChat") приходит из persona-row.
	// Конвертим в llmchain.Task.
	var task llmchain.Task
	switch taskKind {
	case "TaskAITutorChat":
		task = llmchain.TaskAITutorChat
	case "TaskAITutorCompact":
		task = llmchain.TaskAITutorCompact
	case "TaskAITutorAssignment":
		task = llmchain.TaskAITutorAssignment
	default:
		// Fallback: chat task. Лучше работать с дефолтом, чем падать.
		task = llmchain.TaskAITutorChat
	}
	chainMsgs := make([]llmchain.Message, 0, len(messages))
	for _, m := range messages {
		chainMsgs = append(chainMsgs, llmchain.Message{
			Role:    llmchain.Role(strings.TrimSpace(m.Role)),
			Content: m.Content,
		})
	}
	resp, err := a.chain.Chat(ctx, llmchain.Request{
		Task:        task,
		Messages:    chainMsgs,
		Temperature: opts.Temperature,
		MaxTokens:   opts.MaxTokens,
		JSONMode:    opts.JSONMode,
	})
	if err != nil {
		return aiTutorDomain.LLMResponse{}, fmt.Errorf("ai_tutor.LLM: %w", err)
	}
	return aiTutorDomain.LLMResponse{
		Content:   resp.Content,
		TokensIn:  resp.TokensIn,
		TokensOut: resp.TokensOut,
		Model:     fmt.Sprintf("%s:%s", resp.Provider, resp.Model),
	}, nil
}

// assignmentPusherAdapter — bridge tutor.PushAssignment → ai_tutor.AssignmentPusher
// без таскания tutor/app в ai_tutor/app.
type assignmentPusherAdapter struct {
	uc *tutorApp.PushAssignment
}

func (a *assignmentPusherAdapter) Push(
	ctx context.Context,
	tutorID, studentID uuid.UUID,
	title, bodyMD string,
	dueAt *time.Time,
) error {
	if a.uc == nil {
		return nil
	}
	_, err := a.uc.Do(ctx, tutorApp.PushAssignmentInput{
		TutorID:   tutorID,
		StudentID: studentID,
		Title:     title,
		BodyMD:    bodyMD,
		DueAt:     dueAt,
	})
	return err
}
