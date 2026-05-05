package app

import (
	"context"
	"fmt"
	"strings"
	"time"

	"druz9/ai_tutor/domain"

	"github.com/google/uuid"
)

// SendMessage — main chat use case.
//
// Flow:
//  1. Load thread + verify ownership (student_id == requester)
//  2. IncrementCounters (atomic; ErrRateLimited if daily cap hit)
//  3. Append user-episode
//  4. Recall: persona prompt + facts + summary + recent episodes + snapshot
//  5. LLM call (TaskAITutorChat) с собранным prompt
//  6. Append assistant-episode
//  7. Touch facts (last_used_at update)
//  8. Maybe-compact: если exceed thresholds → trigger в той же call-path
//     (мы синхронны — пусть user подождёт extra 1-2s раз в N сообщений
//     вместо background-job complexity).
type SendMessage struct {
	Personas  domain.PersonaRepo
	Threads   domain.ThreadRepo
	Episodes  domain.EpisodeRepo
	Facts     domain.FactRepo
	Snapshot  domain.SnapshotProvider
	LLM       domain.LLMDispatcher
	Compactor *Compact
	Now       func() time.Time
}

type SendMessageInput struct {
	StudentID uuid.UUID
	ThreadID  uuid.UUID
	Content   string
	// ContextNote — optional. Если непустой, бекенд appends system-episode
	// ПЕРЕД user-episode'ом. Используется AICoachPill'ом для pre-loading'а
	// surface-контекста (atlas-node, mock-result, reading-абзац) на первом
	// turn'е. Subsequent turns в том же thread'е не нуждаются — контекст
	// уже в истории thread'а.
	ContextNote string
}

type SendMessageResult struct {
	UserEpisode      domain.Episode
	AssistantEpisode domain.Episode
	// Compacted = true когда после этого хода сработала auto-compaction.
	// UI может показать тонкий toast «coach подтянул память».
	Compacted bool
}

func (uc *SendMessage) Do(ctx context.Context, in SendMessageInput) (SendMessageResult, error) {
	content := strings.TrimSpace(in.Content)
	if in.StudentID == uuid.Nil || in.ThreadID == uuid.Nil || content == "" {
		return SendMessageResult{}, fmt.Errorf("ai_tutor.SendMessage: %w", domain.ErrInvalidInput)
	}
	if len(content) > 4000 {
		// Hard cap to protect prompt budget. UI должна обрезать раньше.
		return SendMessageResult{}, fmt.Errorf("ai_tutor.SendMessage: content too long: %w", domain.ErrInvalidInput)
	}

	thread, err := uc.Threads.GetThreadByID(ctx, in.ThreadID)
	if err != nil {
		return SendMessageResult{}, fmt.Errorf("ai_tutor.SendMessage: thread: %w", err)
	}
	if thread.StudentID != in.StudentID {
		// Cross-user leak protection. Не палим существование thread'а.
		return SendMessageResult{}, fmt.Errorf("ai_tutor.SendMessage: %w", domain.ErrNotFound)
	}

	now := nowOr(uc.Now)

	// Counters first — если ErrRateLimited, не делаем LLM call впустую.
	thread, err = uc.Threads.IncrementCounters(ctx, thread.ID, now)
	if err != nil {
		return SendMessageResult{}, fmt.Errorf("ai_tutor.SendMessage: counters: %w", err)
	}

	// 1a. Optional context note — system-episode перед user'овским ходом.
	// Используется inline contextual pill'ом для surface-context (atlas-node,
	// mock-result, reading-абзац). Best-effort: ошибка append'а не должна
	// блокировать chat-flow.
	if note := strings.TrimSpace(in.ContextNote); note != "" {
		if _, ctxErr := uc.Episodes.Append(ctx, domain.Episode{
			ThreadID: thread.ID,
			Role:     domain.RoleSystem,
			Content:  note,
		}); ctxErr != nil {
			// Non-fatal — продолжаем чат без преамбулы.
		}
	}

	// 1. Append user episode.
	userEp, err := uc.Episodes.Append(ctx, domain.Episode{
		ThreadID: thread.ID,
		Role:     domain.RoleUser,
		Content:  content,
	})
	if err != nil {
		return SendMessageResult{}, fmt.Errorf("ai_tutor.SendMessage: user episode: %w", err)
	}

	// 2. Recall.
	persona, err := uc.Personas.GetByID(ctx, thread.PersonaID)
	if err != nil {
		return SendMessageResult{}, fmt.Errorf("ai_tutor.SendMessage: persona: %w", err)
	}
	facts, err := uc.Facts.TopRanked(ctx, thread.ID, 5)
	if err != nil {
		return SendMessageResult{}, fmt.Errorf("ai_tutor.SendMessage: facts: %w", err)
	}
	recent, err := uc.Episodes.ListRecent(ctx, thread.ID, 8)
	if err != nil {
		return SendMessageResult{}, fmt.Errorf("ai_tutor.SendMessage: recent: %w", err)
	}
	snapshotText := ""
	if uc.Snapshot != nil {
		// Snapshot tolerated — если репо пустой / тутор-сервис недоступен,
		// продолжаем без него. Coach деградирует в "general advice".
		if s, snapErr := uc.Snapshot.GetSnapshotText(ctx, in.StudentID); snapErr == nil {
			snapshotText = s
		}
	}

	// 3. Build prompt из persona.PromptTemplate с substitutions.
	systemPrompt := renderPromptTemplate(persona.PromptTemplate, promptCtx{
		Snapshot:    snapshotText,
		Facts:       renderFactsBlock(facts),
		Summary:     thread.SummaryMD,
		UserMessage: content,
	})

	// 4. Build messages: system prompt + last N turns (исключая только что
	//    добавленный user — он уже в systemPrompt через {{user_message}}).
	messages := []domain.LLMMessage{
		{Role: "system", Content: systemPrompt},
	}
	if note := strings.TrimSpace(in.ContextNote); note != "" {
		// Surface-контекст для текущего хода. Recall фильтрует system-episodes
		// из истории, поэтому без этого LLM не увидел бы свежий контекст.
		messages = append(messages, domain.LLMMessage{
			Role:    "system",
			Content: "Контекст surface'а: " + note,
		})
	}
	for _, ep := range recent {
		// Skip non-chat episodes из recent — они как контекст бесполезны
		// для LLM (system welcome / snapshot dumps).
		if ep.Role != domain.RoleUser && ep.Role != domain.RoleAssistant {
			continue
		}
		messages = append(messages, domain.LLMMessage{
			Role:    string(ep.Role),
			Content: ep.Content,
		})
	}

	// 5. LLM call.
	resp, err := uc.LLM.Run(ctx, persona.LLMTaskKind, messages, domain.LLMOptions{
		Temperature: 0.6,
		MaxTokens:   1500,
	})
	if err != nil {
		return SendMessageResult{}, fmt.Errorf("ai_tutor.SendMessage: llm: %w", err)
	}

	// 6. Append assistant episode.
	asstEp, err := uc.Episodes.Append(ctx, domain.Episode{
		ThreadID:  thread.ID,
		Role:      domain.RoleAssistant,
		Content:   resp.Content,
		ModelUsed: resp.Model,
		TokensIn:  resp.TokensIn,
		TokensOut: resp.TokensOut,
	})
	if err != nil {
		return SendMessageResult{}, fmt.Errorf("ai_tutor.SendMessage: asst episode: %w", err)
	}

	// 7. Touch facts that we used in prompt.
	if len(facts) > 0 {
		ids := make([]uuid.UUID, 0, len(facts))
		for _, f := range facts {
			ids = append(ids, f.ID)
		}
		if err := uc.Facts.TouchLastUsed(ctx, ids, now); err != nil {
			// Non-fatal — отвечать студенту важнее чем точные timestamps.
		}
	}

	// 8. Auto-compaction trigger.
	res := SendMessageResult{UserEpisode: userEp, AssistantEpisode: asstEp}
	if uc.Compactor != nil && shouldCompact(thread, recent, resp) {
		if cerr := uc.Compactor.Do(ctx, thread.ID); cerr == nil {
			res.Compacted = true
		}
		// Compaction failure тоже non-fatal — следующий ход попробует
		// заново.
	}
	return res, nil
}

// promptCtx — substitutions для persona.PromptTemplate.
type promptCtx struct {
	Snapshot    string
	Facts       string
	Summary     string
	UserMessage string
}

// renderPromptTemplate делает naive {{key}} substitution. Намеренно НЕ
// используем text/template чтобы малой опечатке в шаблоне не падать
// runtime — text/template panic'ит на bad placeholder, а нам нужно
// graceful fallback: unknown {{key}} → empty string.
func renderPromptTemplate(tmpl string, p promptCtx) string {
	subs := map[string]string{
		"{{snapshot}}":     defaultIfEmpty(p.Snapshot, "(нет данных по активности)"),
		"{{facts}}":        defaultIfEmpty(p.Facts, "(пока ничего не запомнил)"),
		"{{summary}}":      defaultIfEmpty(p.Summary, "(ещё не было сводки)"),
		"{{user_message}}": p.UserMessage,
	}
	out := tmpl
	for k, v := range subs {
		out = strings.ReplaceAll(out, k, v)
	}
	return out
}

func defaultIfEmpty(s, fallback string) string {
	if strings.TrimSpace(s) == "" {
		return fallback
	}
	return s
}

func renderFactsBlock(facts []domain.Fact) string {
	if len(facts) == 0 {
		return ""
	}
	var b strings.Builder
	for _, f := range facts {
		fmt.Fprintf(&b, "- %s: %s (confidence %.2f)\n", f.Key, f.Value, f.Confidence)
	}
	return strings.TrimRight(b.String(), "\n")
}

// shouldCompact — true если message_count с момента last_compacted_at
// превышает threshold ИЛИ approx tokens прошлого ответа намекают что
// мы скоро упрёмся в context budget.
//
// Phase R6 — added stale-summary trigger: thread с LastCompactedAt
// старше CompactionStaleAfter (7d) compact'ится даже при низком
// message_count. Без этого SummaryMD растёт unbounded для медленных
// студентов (1-2 messages/week), и facts с low confidence не decay'ятся.
func shouldCompact(thread domain.Thread, recent []domain.Episode, lastResp domain.LLMResponse) bool {
	// Threshold по message_count: считаем диалог-ходов с момента
	// последней compaction. message_count в thread теперь увеличен на 1
	// (после IncrementCounters в начале UC).
	if thread.LastCompactedAt == nil {
		// Никогда не компактили; trigger по абсолютному count.
		return thread.MessageCount >= domain.CompactionMessageThreshold
	}
	// Phase R6 — stale summary trigger. Если SummaryMD не обновлялся
	// >7d, прогоняем compaction даже когда диалог редкий: facts decay'ятся,
	// summary освежается. Защищает медленные threads от unbounded growth.
	if time.Since(*thread.LastCompactedAt) > domain.CompactionStaleAfter && thread.MessageCount > 0 {
		return true
	}
	// Compactили — count episodes since тот timestamp. Approximate через
	// recent (8 episodes) — если все 8 свежее last_compacted_at, то
	// диалог разросся.
	freshCount := 0
	for _, ep := range recent {
		if ep.OccurredAt.After(*thread.LastCompactedAt) {
			freshCount++
		}
	}
	if freshCount >= domain.CompactionMessageThreshold {
		return true
	}
	// Token threshold — если последний ответ alone > N, prompt budget
	// близок к перегрузу.
	return lastResp.TokensIn+lastResp.TokensOut >= domain.CompactionTokenThreshold
}
