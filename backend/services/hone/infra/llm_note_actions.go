// Package infra — LLM-backed action item extractor (Phase K Wave 16).
//
// Wired в honeApp.SuggestTasksFromNotes use case. Caller уже pre-filter'нул
// заметки regex'ом и собрал ±2-line excerpts вокруг каждого match'а; этот
// адаптер шлёт пачку excerpts в LLM (JSON mode) и получает structured
// `{suggestions: [{title, source_note_id, source_excerpt}]}` обратно.
//
// Промпт построен под:
//   - сохранение языка excerpt'а (RU title для RU excerpt, EN для EN);
//   - отсечение упоминаний без action verb / завершённых [x] чекбоксов;
//   - 5-10 слов title в императиве (LLM tends to over-explain otherwise).
//
// Fail-soft contract: SuggestTasksFromNotes treats Extract error как 503,
// но мы НЕ falsify suggestions. Caller сам разруливает (пустой list → юзер
// видит «нет предложений», ошибка → 503 на endpoint).
package infra

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"druz9/hone/app"
	"druz9/shared/pkg/llmchain"
)

// noteActionExtractMaxItems — hard cap LLM input. Use case уже шлёт
// пачку excerpts (typical 5-20 после регексов); 30 — потолок, чтобы prompt
// не разбух при анормальных корпусах нот.
const noteActionExtractMaxItems = 30

// noteActionExtractMaxSuggestions — cap output. Use case дополнительно
// клипает до MaxSuggestionsReturned (=10); это здесь — defensive нижний
// уровень.
const noteActionExtractMaxSuggestions = 10

// noteActionExcerptCap — сколько символов одного excerpt'а уезжает в
// LLM. Хвост режется (включая чтобы не палить privacy зря в логах
// и не платить за токены за multi-page заметки). 600 chars ≈ 200 ru-tokens,
// хватает на 6-8 строк после ±2-line padding.
const noteActionExcerptCap = 600

// LLMChainNoteActionExtractor — LLM реализация honeApp.NoteActionExtractor.
// Chain MUST быть non-nil; wirer fall'ит на NoNoteActionExtractor если
// llmchain не сконфигурён (нет ключей).
type LLMChainNoteActionExtractor struct {
	chain   llmchain.ChatClient
	log     *slog.Logger
	timeout time.Duration
}

// NewLLMChainNoteActionExtractor wires the adapter.
func NewLLMChainNoteActionExtractor(chain llmchain.ChatClient, log *slog.Logger) *LLMChainNoteActionExtractor {
	if chain == nil {
		panic("hone.NewLLMChainNoteActionExtractor: chain is required (use NoNoteActionExtractor when nil)")
	}
	if log == nil {
		panic("hone.NewLLMChainNoteActionExtractor: logger is required (anti-fallback policy)")
	}
	return &LLMChainNoteActionExtractor{chain: chain, log: log, timeout: 10 * time.Second}
}

// noteActionExtractPrompt — system prompt. Markdown-style для читаемости
// (модели уважают структуру), русский — Sergey пишет заметки на русском.
const noteActionExtractPrompt = `Ты помогаешь юзеру вытащить action items из его заметок.

Вход: фрагменты заметок где регулярка нашла маркеры задач (todo:, чек-боксы, глаголы действия типа «починить», «отправить», etc.).

Задача: для каждого фрагмента — если это реально action item (а не упоминание в скобках), сформулируй короткий title задачи (5-10 слов, императив, на языке исходника), оставь оригинальный excerpt для контекста.

Игнорируй:
- вопросы юзеру про себя («что я думаю об X?»),
- упоминания без action («PR Маши хорошо», «вспомнил про DDD»),
- завершённые задачи (отмеченные [x] чекбоксы),
- пожелания / мысли без конкретного шага («надо бы как-нибудь...»).

Правила title:
- 5-10 слов максимум, начинай с глагола в инфинитиве (RU: «починить», «отправить»; EN: «fix», «send»).
- Сохраняй язык оригинала (русский excerpt → русский title).
- БЕЗ маркеров списков, без «todo:», без [x].
- Конкретно: «отправить fix Маше» лучше чем «коммуникация по PR».

Верни СТРОГО JSON без markdown:
{"suggestions": [{"title": "...", "source_note_id": "...", "source_excerpt": "..."}]}

Если ни один фрагмент не actionable — верни {"suggestions": []}.
Максимум 10 suggestions в выдаче.`

// noteActionExtractEnvelope — wire shape.
type noteActionExtractEnvelope struct {
	Suggestions []noteActionExtractItem `json:"suggestions"`
}

type noteActionExtractItem struct {
	Title         string `json:"title"`
	SourceNoteID  string `json:"source_note_id"`
	SourceExcerpt string `json:"source_excerpt"`
}

// Extract calls the chain with batch'а excerpts → parsed suggestions.
// Single attempt (use case loop не делает retry — если LLM лёг, лучше
// вернуть 503 и юзер увидит «временно недоступно», чем повторять
// 8B-вызовы и греть free-tier лимиты).
func (e *LLMChainNoteActionExtractor) Extract(ctx context.Context, batch app.ExtractActionBatch) ([]app.ExtractedAction, error) {
	if len(batch.Items) == 0 {
		return nil, nil
	}
	items := batch.Items
	if len(items) > noteActionExtractMaxItems {
		items = items[:noteActionExtractMaxItems]
	}

	user := buildNoteActionExtractUser(items)

	ctx, cancel := context.WithTimeout(ctx, e.timeout)
	defer cancel()

	resp, err := e.chain.Chat(ctx, llmchain.Request{
		Task:        llmchain.TaskHoneNoteActionExtract,
		JSONMode:    true,
		Temperature: 0.2,
		MaxTokens:   900, // 10 items × ~80 tokens (title + uuid + short excerpt).
		Messages: []llmchain.Message{
			{Role: llmchain.RoleSystem, Content: noteActionExtractPrompt},
			{Role: llmchain.RoleUser, Content: user},
		},
	})
	if err != nil {
		e.log.Warn("hone.LLMChainNoteActionExtractor: chain error", slog.Any("err", err))
		return nil, fmt.Errorf("hone.LLMChainNoteActionExtractor: %w", err)
	}

	parsed, err := parseNoteActionExtract(resp.Content, items)
	if err != nil {
		e.log.Warn("hone.LLMChainNoteActionExtractor: parse error",
			slog.Any("err", err),
			slog.String("preview", firstN(resp.Content, 240)))
		return nil, fmt.Errorf("hone.LLMChainNoteActionExtractor: parse: %w", err)
	}
	if len(parsed) > noteActionExtractMaxSuggestions {
		parsed = parsed[:noteActionExtractMaxSuggestions]
	}
	return parsed, nil
}

// buildNoteActionExtractUser — собирает user message в стабильном формате:
// нумерованный список (note_id + excerpt). Truncate'им excerpt по
// noteActionExcerptCap чтобы prompt не пухнул на больших заметках.
func buildNoteActionExtractUser(items []app.NoteExcerpt) string {
	var b strings.Builder
	b.WriteString("ФРАГМЕНТЫ:\n\n")
	for i, item := range items {
		excerpt := strings.TrimSpace(item.Excerpt)
		if len(excerpt) > noteActionExcerptCap {
			excerpt = excerpt[:noteActionExcerptCap] + "…"
		}
		fmt.Fprintf(&b, "--- [%d]\n", i+1)
		fmt.Fprintf(&b, "source_note_id: %s\n", item.NoteID.String())
		if title := strings.TrimSpace(item.Title); title != "" {
			fmt.Fprintf(&b, "title: %s\n", title)
		}
		fmt.Fprintf(&b, "excerpt:\n%s\n\n", excerpt)
	}
	b.WriteString("Извлеки action items согласно правилам выше. Верни JSON.")
	return b.String()
}

// parseNoteActionExtract — разбирает JSON, валидирует note_id (должен
// совпадать с одним из входных), фильтрует пустые titles, режет до cap.
func parseNoteActionExtract(raw string, batch []app.NoteExcerpt) ([]app.ExtractedAction, error) {
	cleaned := stripJSONFences(raw)
	var env noteActionExtractEnvelope
	if err := json.Unmarshal([]byte(cleaned), &env); err != nil {
		return nil, fmt.Errorf("unmarshal: %w", err)
	}
	// Lookup по note_id (string → original UUID + excerpt). Защищаемся от
	// LLM-галлюцинаций — note_id вне batch'а мы дроп'аем целиком (нет
	// trace'а на исходник = бесполезный suggestion).
	type srcRef struct {
		noteID   string
		excerpt  string
		original app.NoteExcerpt
	}
	idx := make(map[string]srcRef, len(batch))
	for _, item := range batch {
		idx[item.NoteID.String()] = srcRef{
			noteID:   item.NoteID.String(),
			excerpt:  item.Excerpt,
			original: item,
		}
	}
	out := make([]app.ExtractedAction, 0, len(env.Suggestions))
	for _, s := range env.Suggestions {
		title := strings.TrimSpace(s.Title)
		if title == "" {
			continue
		}
		ref, ok := idx[strings.TrimSpace(s.SourceNoteID)]
		if !ok {
			// LLM выдумал note_id — skip silently. Не fail'им весь batch.
			continue
		}
		// Если LLM прислал свой excerpt — используем его (он может быть
		// короче, более «to the point»). Иначе fallback на оригинал из
		// batch'а — у нас он уже truncated до MaxExcerptLen в use case'е.
		excerpt := strings.TrimSpace(s.SourceExcerpt)
		if excerpt == "" {
			excerpt = ref.excerpt
		}
		out = append(out, app.ExtractedAction{
			Title:         title,
			SourceNoteID:  ref.original.NoteID,
			SourceExcerpt: excerpt,
		})
	}
	return out, nil
}

// stripJSONFences — defensive: ```json + trailing ```. Часть моделей
// игнорят JSONMode и оборачивают ответ в маркдаун-fence. Похожий хелпер
// есть в categorise_task.go (app), но он там internal, дублировать
// дешевле чем экспортить ради одного caller'а.
func stripJSONFences(raw string) string {
	s := strings.TrimSpace(raw)
	if !strings.HasPrefix(s, "```") {
		return s
	}
	if i := strings.IndexByte(s, '\n'); i >= 0 {
		s = s[i+1:]
	}
	return strings.TrimSpace(strings.TrimSuffix(s, "```"))
}

// NoNoteActionExtractor — floor adapter. Wirer fall'ит на этот тип когда
// llmchain не сконфигурён (нет ключей при boot'е); behaviour: возвращает
// (nil, nil) и use case рендерит пустой list, БЕЗ 503. Идеомика отличается
// от других hone graders (которые возвращают ErrLLMUnavailable) потому
// что suggest-tasks-from-notes — soft feature: пустые suggestions не
// ломают UX, лучше тихо скрыть panel чем показать ошибку.
type NoNoteActionExtractor struct{}

// NewNoNoteActionExtractor returns the floor adapter.
func NewNoNoteActionExtractor() *NoNoteActionExtractor { return &NoNoteActionExtractor{} }

// Extract returns empty list — never errors. Use case skip'ит cache
// при пустом ответе, поэтому повторное открытие panel вернёт тот же null.
func (*NoNoteActionExtractor) Extract(_ context.Context, _ app.ExtractActionBatch) ([]app.ExtractedAction, error) {
	return nil, nil
}

// ── interface guards ──────────────────────────────────────────────────────

var (
	_ app.NoteActionExtractor = (*LLMChainNoteActionExtractor)(nil)
	_ app.NoteActionExtractor = (*NoNoteActionExtractor)(nil)
)
