package app

import (
	"context"
	"fmt"
	"strings"
	"time"

	"druz9/ai_tutor/domain"

	"github.com/google/uuid"
)

// SendMessage — main chat use case. See doc.go for the call flow.
type SendMessage struct {
	Personas domain.PersonaRepo
	Threads  domain.ThreadRepo
	Episodes domain.EpisodeRepo
	Facts    domain.FactRepo
	Snapshot domain.SnapshotProvider
	LLM      domain.LLMDispatcher
	// Recorder — атомарный writer для (IncrementCounters + Append user-
	// episode). В продакшен wiring это *infra.Postgres; оба write'а
	// летят в одну БД-транзакцию и устраняют race на параллельных
	// SendMessage'ах. nil → legacy non-atomic путь для in-mem fake'ов
	// в тестах.
	Recorder domain.MessageRecorder
	// Embedder — optional. Когда есть, recall facts через semantic путь
	// (embed user message → pgvector cosine + confidence + recency). nil →
	// чистый TopRanked legacy путь (OLLAMA_HOST не настроен).
	Embedder  domain.Embedder
	Compactor *Compact
	Now       func() time.Time
}

// queryEmbedTimeout — hard cap на query embedding в hot chat path. bge-m3
// на CPU = 150-400ms; 800ms потолок без задержки чату. Превышение → recall
// fallback'ает в TopRanked legacy путь.
const queryEmbedTimeout = 800 * time.Millisecond

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

	// Counters + user-episode пишутся атомарно через Recorder в одной
	// БД-транзакции (production path). Без этого параллельные SendMessage
	// гонят: counter ушёл вперёд, а episode не вставился. ErrRateLimited
	// откатывает tx, LLM call не запускается. В тестах с nil Recorder
	// идём legacy путём — последовательно.
	thread, userEp, err := uc.recordIncomingMessage(ctx, thread, content, strings.TrimSpace(in.ContextNote), now)
	if err != nil {
		return SendMessageResult{}, err
	}

	// 2. Recall.
	persona, err := uc.Personas.GetByID(ctx, thread.PersonaID)
	if err != nil {
		return SendMessageResult{}, fmt.Errorf("ai_tutor.SendMessage: persona: %w", err)
	}
	facts, err := uc.recallFacts(ctx, thread.ID, content)
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
		// Non-fatal — отвечать студенту важнее чем точные timestamps.
		_ = uc.Facts.TouchLastUsed(ctx, ids, now)
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
// Stale-summary trigger: thread с LastCompactedAt старше
// CompactionStaleAfter (7d) compact'ится даже при низком message_count.
// Без этого SummaryMD растёт unbounded для медленных студентов (1-2
// messages/week), и facts с low confidence не decay'ятся.
func shouldCompact(thread domain.Thread, recent []domain.Episode, lastResp domain.LLMResponse) bool {
	// Threshold по message_count: считаем диалог-ходов с момента
	// последней compaction. message_count в thread теперь увеличен на 1
	// (после IncrementCounters в начале UC).
	if thread.LastCompactedAt == nil {
		// Никогда не компактили; trigger по абсолютному count.
		return thread.MessageCount >= domain.CompactionMessageThreshold
	}
	// Stale summary trigger. Если SummaryMD не обновлялся >7d, прогоняем
	// compaction даже когда диалог редкий: facts decay'ятся,
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

// recallFacts собирает Top-K facts через гибридный путь:
//
//  1. Если есть Embedder + non-empty userMessage — embed userMessage с
//     tight timeout (queryEmbedTimeout) и сходить в RecallSemantic. Top-K
//     по hybrid score: 0.55*cosine + 0.30*confidence + 0.15*recency_decay.
//  2. Если semantic вернул меньше limit (facts ещё не embed'нуты,
//     Ollama упал, или timeout) — добрать TopRanked, исключая дубли.
//  3. Если Embedder выключен — путь идентичен legacy: чистый TopRanked.
//
// Worst-case latency: 800ms embed timeout + 50ms semantic + 50ms ranked =
// ~900ms на cold miss. Hot path с warm Ollama: ~300ms. LLM сам тратит 2-3s,
// поэтому overhead невидим.
func (uc *SendMessage) recallFacts(
	ctx context.Context, threadID uuid.UUID, userMessage string,
) ([]domain.Fact, error) {
	const limit = 5

	var semantic []domain.Fact
	if uc.Embedder != nil && strings.TrimSpace(userMessage) != "" {
		embedCtx, cancel := context.WithTimeout(ctx, queryEmbedTimeout)
		vec, _, eerr := uc.Embedder.Embed(embedCtx, userMessage)
		cancel()
		if eerr == nil && len(vec) > 0 {
			if hits, rerr := uc.Facts.RecallSemantic(ctx, threadID, vec, limit); rerr == nil {
				semantic = hits
			}
		}
	}

	if len(semantic) >= limit {
		return semantic, nil
	}

	ranked, err := uc.Facts.TopRanked(ctx, threadID, limit)
	if err != nil {
		return nil, err
	}
	return mergeFacts(semantic, ranked, limit), nil
}

// mergeFacts конкатит semantic + ranked, сохраняя порядок semantic и
// добавляя из ranked только новые (по Fact.ID). Стабильно отрезает на limit.
func mergeFacts(primary, fallback []domain.Fact, limit int) []domain.Fact {
	if limit <= 0 {
		return nil
	}
	seen := make(map[uuid.UUID]struct{}, len(primary)+len(fallback))
	out := make([]domain.Fact, 0, limit)
	for _, f := range primary {
		if _, dup := seen[f.ID]; dup {
			continue
		}
		seen[f.ID] = struct{}{}
		out = append(out, f)
		if len(out) >= limit {
			return out
		}
	}
	for _, f := range fallback {
		if _, dup := seen[f.ID]; dup {
			continue
		}
		seen[f.ID] = struct{}{}
		out = append(out, f)
		if len(out) >= limit {
			return out
		}
	}
	return out
}

// recordIncomingMessage скрывает атомарный (Recorder) и legacy non-
// atomic пути за единой сигнатурой. В прод-wiring Recorder != nil —
// counters и user-episode пишутся одним tx; в тестах с in-mem fake'ами
// Recorder=nil, и мы используем последовательную запись ради совместимости
// с in-mem фейками.
func (uc *SendMessage) recordIncomingMessage(
	ctx context.Context,
	thread domain.Thread,
	content, contextNote string,
	now time.Time,
) (domain.Thread, domain.Episode, error) {
	if uc.Recorder != nil {
		updated, userEp, err := uc.Recorder.RecordUserMessage(ctx, thread.ID, content, contextNote, now)
		if err != nil {
			return domain.Thread{}, domain.Episode{}, fmt.Errorf("ai_tutor.SendMessage: record: %w", err)
		}
		return updated, userEp, nil
	}
	updated, err := uc.Threads.IncrementCounters(ctx, thread.ID, now)
	if err != nil {
		return domain.Thread{}, domain.Episode{}, fmt.Errorf("ai_tutor.SendMessage: counters: %w", err)
	}
	if contextNote != "" {
		_, _ = uc.Episodes.Append(ctx, domain.Episode{
			ThreadID: updated.ID,
			Role:     domain.RoleSystem,
			Content:  contextNote,
		})
	}
	userEp, err := uc.Episodes.Append(ctx, domain.Episode{
		ThreadID: updated.ID,
		Role:     domain.RoleUser,
		Content:  content,
	})
	if err != nil {
		return domain.Thread{}, domain.Episode{}, fmt.Errorf("ai_tutor.SendMessage: user episode: %w", err)
	}
	return updated, userEp, nil
}
