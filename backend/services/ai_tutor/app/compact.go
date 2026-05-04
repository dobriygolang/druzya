package app

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"druz9/ai_tutor/domain"

	"github.com/google/uuid"
)

// Compact — turns the last N episodes into:
//   1. New summary_md (3-5 bullets, replaces working memory)
//   2. 0-3 fact upserts (extracted student-specific facts)
//
// Trigger flow:
//   - Auto: SendMessage detects threshold breach → calls Compact synchronously
//   - Manual: admin endpoint / next morning cron (TODO)
//
// LLM provider: TaskAITutorCompact — 8B-class, JSON mode. Compaction is
// not user-blocking, so latency budget is generous.
type Compact struct {
	Threads  domain.ThreadRepo
	Episodes domain.EpisodeRepo
	Facts    domain.FactRepo
	LLM      domain.LLMDispatcher
	Now      func() time.Time
}

// compactPayload — что мы парсим из LLM JSON-output.
//
// Free-tier LLM иногда возвращает мусор — вокруг json.Unmarshal стоит
// graceful guard: если parse fails, summary становится plain-text
// fallback (raw LLM content), facts skipped.
type compactPayload struct {
	Summary string `json:"summary"`
	Facts   []struct {
		Key        string  `json:"key"`
		Value      string  `json:"value"`
		Confidence float64 `json:"confidence"`
	} `json:"facts"`
}

const compactPromptTemplate = `Ты — memory-archivist для AI-tutor'а. Твоя задача: превратить последние сообщения чата в краткую сводку + извлечь конкретные факты про студента.

ИНСТРУКЦИИ:
1. Summary — 3-5 буллетов. Что обсуждали, что студент пробовал, на чём застревал. БЕЗ воды.
2. Facts — 0-3 extracted facts. Только конкретика: цели, дедлайны, слабые темы, предпочтения. НЕ повторяй прошлый summary в facts.
3. Confidence: 1.0 = студент явно сказал; 0.7 = вытекает из контекста; 0.4 = догадка.
4. Допустимые fact_key (одно из): goal, weak_topic, preferred_lang, interview_date, company_target, current_block, strong_topic, study_pace.

ВЕРНИ СТРОГО JSON В ФОРМАТЕ:
{
  "summary": "- Bullet 1\n- Bullet 2",
  "facts": [{"key": "weak_topic", "value": "DP optimisation", "confidence": 0.8}]
}

Сообщения для compaction:
{{messages}}

Старая сводка (если есть, учти при объединении):
{{old_summary}}`

func (uc *Compact) Do(ctx context.Context, threadID uuid.UUID) error {
	thread, err := uc.Threads.GetThreadByID(ctx, threadID)
	if err != nil {
		return fmt.Errorf("ai_tutor.Compact: thread: %w", err)
	}

	// Pull more episodes than SendMessage's recent — мы хотим увидеть
	// окно для сжатия (15 last или so).
	recent, err := uc.Episodes.ListRecent(ctx, threadID, 15)
	if err != nil {
		return fmt.Errorf("ai_tutor.Compact: recent: %w", err)
	}
	if len(recent) < 4 {
		// Слишком мало материала — не компактим, ничего не теряем.
		return nil
	}

	// Render messages в plain text.
	var msgs strings.Builder
	for _, ep := range recent {
		if ep.Role != domain.RoleUser && ep.Role != domain.RoleAssistant {
			continue
		}
		fmt.Fprintf(&msgs, "[%s] %s\n", ep.Role, ep.Content)
	}

	prompt := strings.ReplaceAll(compactPromptTemplate, "{{messages}}", msgs.String())
	prompt = strings.ReplaceAll(prompt, "{{old_summary}}", defaultIfEmpty(thread.SummaryMD, "(пусто)"))

	resp, err := uc.LLM.Run(ctx, "TaskAITutorCompact", []domain.LLMMessage{
		{Role: "system", Content: prompt},
	}, domain.LLMOptions{
		Temperature: 0.3,
		MaxTokens:   800,
		JSONMode:    true,
	})
	if err != nil {
		return fmt.Errorf("ai_tutor.Compact: llm: %w", err)
	}

	now := nowOr(uc.Now)

	// Parse LLM output. Graceful fallback: если JSON broken, кладём raw
	// content как summary (хотя бы что-то), facts skip.
	payload := parseCompactPayload(resp.Content)
	if payload.Summary == "" {
		payload.Summary = strings.TrimSpace(resp.Content)
	}

	if err := uc.Threads.UpdateSummary(ctx, threadID, payload.Summary, now); err != nil {
		return fmt.Errorf("ai_tutor.Compact: update summary: %w", err)
	}

	for _, f := range payload.Facts {
		if strings.TrimSpace(f.Key) == "" || strings.TrimSpace(f.Value) == "" {
			continue
		}
		conf := f.Confidence
		if conf < 0 {
			conf = 0
		}
		if conf > 1 {
			conf = 1
		}
		if _, ferr := uc.Facts.Upsert(ctx, domain.Fact{
			ThreadID:   threadID,
			Key:        strings.TrimSpace(f.Key),
			Value:      strings.TrimSpace(f.Value),
			Confidence: conf,
		}); ferr != nil {
			// Non-fatal — следующая compaction попробует заново.
			continue
		}
	}
	return nil
}

func parseCompactPayload(raw string) compactPayload {
	var out compactPayload
	// Trim Markdown code-fences если LLM добавил `````json … `````.
	cleaned := strings.TrimSpace(raw)
	cleaned = strings.TrimPrefix(cleaned, "```json")
	cleaned = strings.TrimPrefix(cleaned, "```")
	cleaned = strings.TrimSuffix(cleaned, "```")
	cleaned = strings.TrimSpace(cleaned)
	_ = json.Unmarshal([]byte(cleaned), &out)
	return out
}
