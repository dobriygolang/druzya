// Suggest tasks from notes.
//
// Coach читает свежие заметки (last 7 days, AI-readable only) и предлагает
// добавить in-line action-items как таски в TaskBoard. Pre-filter regex'ом
// снимает heavy lift с LLM — мы шлём только matched фрагменты, не всю
// заметку.
//
// Pipeline:
//
//  1. ListAIAvailable — recent notes (NOT encrypted, NOT ai_excluded).
//  2. Pre-filter regex'ами по каждой ноте → собираем «matched excerpts».
//  3. Если ни один excerpt не найден — return пустой list (LLM skip).
//  4. Шлём excerpts + note_id в LLM (NotesActionItemExtractor port).
//  5. Cache в Redis на 1 час per user — повторное открытие view не дёргает LLM.
package app

import (
	"context"
	"crypto/sha1"
	"encoding/hex"
	"fmt"
	"log/slog"
	"regexp"
	"strings"
	"time"

	"druz9/hone/domain"

	"github.com/google/uuid"
)

// DefaultNotesSuggestionLookbackDays — сколько дней назад смотрим заметки.
// 7 дней — свежий контекст; старее юзер уже забыл, что писал.
const DefaultNotesSuggestionLookbackDays = 7

// MaxNotesSuggestionLookbackDays — потолок. 30 дней — больше уже шумит,
// LLM плохо ранжирует «откуда я это взял?».
const MaxNotesSuggestionLookbackDays = 30

// MaxNotesForExtraction — сколько последних заметок мы вообще тянем из
// БД (после фильтрации по encrypted / ai_excluded). 20 — щедрый верх,
// большинство юзеров пишут <5 заметок в неделю.
const MaxNotesForExtraction = 20

// MaxSuggestionsReturned — ограничиваем выдачу. 10 — обычно достаточно;
// больше — это уже backlog, а не «следующая задача».
const MaxSuggestionsReturned = 10

// NotesSuggestionCacheTTL — час на per-user cache. На повторное открытие
// панели не дёргаем LLM. Cache invalidate'ится при AcceptTaskSuggestion
// (см. InvalidateNotesSuggestionsForUser ниже).
const NotesSuggestionCacheTTL = time.Hour

// excerptContextLines — сколько строк до/после match'а тянем как context.
// ±2 — короткая полная мысль, на TaskCard view хватает.
const excerptContextLines = 2

// MaxExcerptLen — режем длинные excerpts (≤200 chars). Frontend всё равно
// truncate'ит в карточке, экономим LLM-токены.
const MaxExcerptLen = 200

// actionKeywords — set substrings, любое попадание = candidate.
// Lowercase лист, по русским / английским формам глаголов / маркеров.
// Слова в составе других слов матчатся через `\\b` regex.
var actionKeywordPatterns = []string{
	// English todo markers
	`(?i)\btodo\s*:?`,
	`(?i)\bfixme\s*:?`,
	// Markdown checkbox
	`(?m)^\s*-\s*\[\s*\]\s+\S`,
	// English action verbs (imperative cues)
	`(?i)\b(fix|review|send|email|ship|deploy|merge|check|investigate|follow[- ]up|reach\s+out|ping|test|implement|refactor)\b`,
	// Russian markers — частые в заметках Sergey
	`(?i)\bнадо\b`,
	`(?i)\bнужно\b`,
	`(?i)\bпочинить\b`,
	`(?i)\bпосмотреть\b`,
	`(?i)\bотправить\b`,
	`(?i)\bответить\b`,
	`(?i)\bобсудить\b`,
	`(?i)\bподготовить\b`,
	`(?i)\bпроверить\b`,
}

// compiledActionRegex — pre-compiled один раз; OR-объединение всех
// keyword patterns. Используем в matchNoteForActions.
var compiledActionRegex = func() *regexp.Regexp {
	joined := strings.Join(actionKeywordPatterns, "|")
	return regexp.MustCompile(joined)
}()

// SuggestionCache — port для Redis-кеша. nil-safe в Do: cache miss →
// прямо в LLM. Wired в monolith через rediscache.New[…].
type SuggestionCache interface {
	Get(ctx context.Context, userID uuid.UUID) ([]domain.TaskSuggestion, time.Time, bool)
	Set(ctx context.Context, userID uuid.UUID, suggestions []domain.TaskSuggestion)
	Delete(ctx context.Context, userID uuid.UUID)
}

// NoteActionExtractor — LLM-port. Реализация живёт в intelligence
// (через адаптер в monolith). Hone не зависит от intelligence напрямую.
type NoteActionExtractor interface {
	// Extract принимает per-note excerpts и возвращает структурированные
	// suggestions. Реализация решает caching / batching / retry — port
	// только подписывает контракт.
	Extract(ctx context.Context, batch ExtractActionBatch) ([]ExtractedAction, error)
}

// ExtractActionBatch — input для LLM-rerank'а.
type ExtractActionBatch struct {
	UserID uuid.UUID
	Items  []NoteExcerpt
}

// NoteExcerpt — один matched фрагмент.
type NoteExcerpt struct {
	NoteID  uuid.UUID
	Title   string
	Excerpt string
}

// ExtractedAction — output LLM-rerank'а.
type ExtractedAction struct {
	Title         string
	SourceNoteID  uuid.UUID
	SourceExcerpt string
}

// SuggestTasksFromNotes use case.
type SuggestTasksFromNotes struct {
	Notes     domain.NoteRepo
	Extractor NoteActionExtractor // nil-safe → returns ErrLLMUnavailable
	Cache     SuggestionCache     // optional
	Log       *slog.Logger
	Now       func() time.Time
}

// SuggestTasksFromNotesInput — wire body.
type SuggestTasksFromNotesInput struct {
	UserID uuid.UUID
	Days   int
}

// SuggestTasksFromNotesOutput — result tuple. CachedAt zero когда ответ
// свежий (cache miss). Frontend форматирует «обновлено N минут назад».
type SuggestTasksFromNotesOutput struct {
	Suggestions []domain.TaskSuggestion
	CachedAt    time.Time
}

// Do executes the use case.
func (uc *SuggestTasksFromNotes) Do(ctx context.Context, in SuggestTasksFromNotesInput) (SuggestTasksFromNotesOutput, error) {
	days := in.Days
	if days <= 0 {
		days = DefaultNotesSuggestionLookbackDays
	}
	if days > MaxNotesSuggestionLookbackDays {
		days = MaxNotesSuggestionLookbackDays
	}

	// Cache fast-path.
	if uc.Cache != nil {
		if cached, when, ok := uc.Cache.Get(ctx, in.UserID); ok {
			return SuggestTasksFromNotesOutput{Suggestions: cached, CachedAt: when}, nil
		}
	}

	if uc.Extractor == nil {
		return SuggestTasksFromNotesOutput{}, fmt.Errorf("hone.SuggestTasksFromNotes: %w", domain.ErrLLMUnavailable)
	}

	lookback := time.Duration(days) * 24 * time.Hour
	notes, err := uc.Notes.ListAIAvailable(ctx, in.UserID, lookback, MaxNotesForExtraction)
	if err != nil {
		return SuggestTasksFromNotesOutput{}, fmt.Errorf("hone.SuggestTasksFromNotes: list: %w", err)
	}
	if len(notes) == 0 {
		return SuggestTasksFromNotesOutput{Suggestions: nil}, nil
	}

	// Pre-filter regex. Собираем excerpts только из notes у которых хоть
	// один match. Это позволяет:
	//  - skip notes без action-items (типично 70-80% — обычные мысли);
	//  - снизить LLM input до релевантных кусков, не всю заметку.
	excerpts := make([]NoteExcerpt, 0, len(notes))
	for _, n := range notes {
		matched := matchNoteForActions(n.BodyMD)
		if matched == "" {
			continue
		}
		excerpts = append(excerpts, NoteExcerpt{
			NoteID:  n.ID,
			Title:   n.Title,
			Excerpt: matched,
		})
	}
	if len(excerpts) == 0 {
		// Заметки есть, action-items в них нет. Не кешируем — следующий
		// keystroke юзера может добавить action; cache=hot-path для repeat
		// open, не для empty state.
		return SuggestTasksFromNotesOutput{Suggestions: nil}, nil
	}

	actions, err := uc.Extractor.Extract(ctx, ExtractActionBatch{
		UserID: in.UserID,
		Items:  excerpts,
	})
	if err != nil {
		return SuggestTasksFromNotesOutput{}, fmt.Errorf("hone.SuggestTasksFromNotes: extract: %w", err)
	}
	if len(actions) > MaxSuggestionsReturned {
		actions = actions[:MaxSuggestionsReturned]
	}
	out := make([]domain.TaskSuggestion, 0, len(actions))
	for _, a := range actions {
		title := strings.TrimSpace(a.Title)
		if title == "" {
			continue
		}
		out = append(out, domain.TaskSuggestion{
			ID:            suggestionID(a.SourceNoteID, title),
			Title:         title,
			SourceNoteID:  a.SourceNoteID,
			SourceExcerpt: truncateExcerpt(a.SourceExcerpt, MaxExcerptLen),
		})
	}

	if uc.Cache != nil {
		uc.Cache.Set(ctx, in.UserID, out)
	}
	return SuggestTasksFromNotesOutput{Suggestions: out}, nil
}

// matchNoteForActions — pre-filter regex. Returns склеенные excerpts с
// ±excerptContextLines строк контекста вокруг каждого match'а. Дедуплицируем
// перекрывающиеся matches: если строка уже включена — пропускаем повтор.
//
// Empty string означает «нет совпадений» → caller skip'ит note полностью.
func matchNoteForActions(body string) string {
	if body == "" {
		return ""
	}
	lines := strings.Split(body, "\n")
	if len(lines) == 0 {
		return ""
	}
	included := make([]bool, len(lines))
	any := false
	for i, line := range lines {
		if !compiledActionRegex.MatchString(line) {
			continue
		}
		any = true
		start := i - excerptContextLines
		if start < 0 {
			start = 0
		}
		end := i + excerptContextLines
		if end >= len(lines) {
			end = len(lines) - 1
		}
		for j := start; j <= end; j++ {
			included[j] = true
		}
	}
	if !any {
		return ""
	}
	var b strings.Builder
	for i, ok := range included {
		if !ok {
			continue
		}
		if b.Len() > 0 {
			b.WriteByte('\n')
		}
		b.WriteString(lines[i])
		if b.Len() > 4*MaxExcerptLen {
			// hard cap, чтобы LLM-input не пухнул на 10-страничные заметки.
			break
		}
	}
	return b.String()
}

// suggestionID — детерминированный hash для (note + title). Frontend
// использует как React key; backend не персистит. Sha1 → hex,
// 16 chars достаточно (collision risk на 10 items на user — пренебрежимо).
func suggestionID(noteID uuid.UUID, title string) string {
	h := sha1.New()
	h.Write([]byte(noteID.String()))
	h.Write([]byte("|"))
	h.Write([]byte(title))
	sum := h.Sum(nil)
	return hex.EncodeToString(sum[:8])
}

// truncateExcerpt — режем UTF-8-safe по rune-boundary.
func truncateExcerpt(s string, maxRunes int) string {
	if maxRunes <= 0 {
		return ""
	}
	runes := []rune(s)
	if len(runes) <= maxRunes {
		return s
	}
	return string(runes[:maxRunes]) + "…"
}

// AcceptTaskSuggestion — создаёт реальную задачу из suggestion'а и
// инвалидирует cache (чтобы не предложили её снова). Wraps existing
// CreateTask UC чтобы reuse'ить categoriser / cursor publish / cache
// invalidate.
type AcceptTaskSuggestion struct {
	CreateTask  *CreateTask
	Cache       SuggestionCache
	Log         *slog.Logger
}

// AcceptTaskSuggestionInput — wire body.
type AcceptTaskSuggestionInput struct {
	UserID       uuid.UUID
	Title        string
	SourceNoteID uuid.UUID // optional, used для bookkeeping
}

// Do executes the use case.
func (uc *AcceptTaskSuggestion) Do(ctx context.Context, in AcceptTaskSuggestionInput) (domain.Task, error) {
	if uc.CreateTask == nil {
		return domain.Task{}, fmt.Errorf("hone.AcceptTaskSuggestion: CreateTask not wired")
	}
	title := strings.TrimSpace(in.Title)
	if title == "" {
		return domain.Task{}, fmt.Errorf("hone.AcceptTaskSuggestion: title empty: %w", domain.ErrInvalidInput)
	}
	brief := ""
	if in.SourceNoteID != uuid.Nil {
		// Trace на источник в brief — юзер увидит откуда взято.
		brief = fmt.Sprintf("From note %s", in.SourceNoteID.String())
	}
	task, err := uc.CreateTask.Do(ctx, CreateTaskInput{
		UserID:  in.UserID,
		Kind:    domain.TaskKindCustom,
		Title:   title,
		BriefMD: brief,
	})
	if err != nil {
		return domain.Task{}, fmt.Errorf("hone.AcceptTaskSuggestion: %w", err)
	}
	if uc.Cache != nil {
		uc.Cache.Delete(ctx, in.UserID)
	}
	return task, nil
}
