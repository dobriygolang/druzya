package app

import (
	"context"
	"fmt"
	"strings"
	"time"

	"druz9/ai_tutor/domain"

	"github.com/google/uuid"
)

// AssignmentPusher — narrow port в services/tutor PushAssignment use case.
// Cross-domain: ai_tutor не импортит tutor/app напрямую, monolith wiring
// ставит adapter.
type AssignmentPusher interface {
	Push(ctx context.Context, tutorID, studentID uuid.UUID, title, bodyMD string, dueAt *time.Time) error
}

// ProcessedMockGuard — idempotency lookup. Reserve атомарно ставит row
// в ai_tutor_processed_mocks; возвращает true если первый раз («владей»),
// false если уже обработано (пропуск).
type ProcessedMockGuard interface {
	ReserveProcessedMock(ctx context.Context, sessionID, personaID uuid.UUID) (bool, error)
}

// OnFailedMock — proactive trigger. Когда mock-секция завершилась с
// overall_score<70, мы:
//  1. Находим adopted AI-tutor персону у студента, чей scope_track_kind
//     матчит mock-секцию (algo→dev, english_hr→english, etc).
//  2. Append'аем system-episode «Завалил mock {section}, weak: {topics}»
//     в thread → coach помнит этот эпизод в следующих ходах.
//  3. Генерим текст assignment'а LLM call'ом по persona.LLMTaskKind=
//     TaskAITutorAssignment.
//  4. Пушим assignment в tutor service (due_at = now + 3 days), студент
//     увидит его в Hone TaskBoard.
//
// Idempotency: повторный fire (та же session) перезапишет episode, но
// создаст ещё один assignment. На бэк-стороне дедуп лучше делать через
// flag в payload event'а или через таблицу триггеров — пока не делаем,
// EventBus и так доставляет событие один раз.
type OnFailedMock struct {
	Personas    domain.PersonaRepo
	Threads     domain.ThreadRepo
	Episodes    domain.EpisodeRepo
	LLM         domain.LLMDispatcher
	Assignments AssignmentPusher
	// Guard — optional. Когда nil, idempotency не enforce'ится (могут
	// быть дубли при event-replay). Production wiring всегда передаёт.
	Guard ProcessedMockGuard
	Now   func() time.Time
}

type OnFailedMockInput struct {
	SessionID    uuid.UUID
	StudentID    uuid.UUID
	Section      string // ai_mock section ('algorithms', 'system_design', 'english_hr', …)
	OverallScore int
	Weaknesses   []string
}

const failedMockScoreThreshold = 70
const assignmentDueWindow = 3 * 24 * time.Hour

func (uc *OnFailedMock) Do(ctx context.Context, in OnFailedMockInput) error {
	if in.StudentID == uuid.Nil {
		return fmt.Errorf("ai_tutor.OnFailedMock: %w", domain.ErrInvalidInput)
	}
	if in.OverallScore >= failedMockScoreThreshold {
		return nil // не «завалил» — ничего не делаем
	}
	trackKind := MapSectionToTrackKind(in.Section)
	threads, err := uc.Threads.ListThreadsByStudent(ctx, in.StudentID)
	if err != nil {
		return fmt.Errorf("ai_tutor.OnFailedMock: list threads: %w", err)
	}
	if len(threads) == 0 {
		return nil // студент ещё не adopt'ил персону — silent skip
	}
	// Находим thread персоны c подходящим track_kind. Если не найдём —
	// fallback на первый thread (any persona). Лучше пушнуть в существующего
	// coach'а, чем silently не реагировать.
	var (
		targetThread  domain.Thread
		targetPersona domain.Persona
		found         bool
	)
	for _, t := range threads {
		p, err := uc.Personas.GetByID(ctx, t.PersonaID)
		if err != nil {
			continue
		}
		if p.ScopeTrackKind == trackKind {
			targetThread = t
			targetPersona = p
			break
		}
		if !found {
			targetThread = t
			targetPersona = p
			found = true
		}
	}
	if targetPersona.ID == uuid.Nil {
		return nil
	}

	// Idempotency guard: если эту (session_id, persona_id) уже обработали —
	// пропускаем silent. Reserve атомарно вставляет row.
	if uc.Guard != nil && in.SessionID != uuid.Nil {
		owned, err := uc.Guard.ReserveProcessedMock(ctx, in.SessionID, targetPersona.ID)
		if err != nil {
			return fmt.Errorf("ai_tutor.OnFailedMock: reserve: %w", err)
		}
		if !owned {
			return nil
		}
	}

	now := nowOr(uc.Now)
	weakLine := strings.Join(in.Weaknesses, ", ")
	if weakLine == "" {
		weakLine = "(нет distilled weak topics из report'а)"
	}

	// 1) System-episode «завалил mock» — coach помнит этот факт.
	failureNote := fmt.Sprintf(
		"Студент завалил mock-секцию %s (overall %d/100). Слабые места: %s. Сегодня сгенерирован assignment с дедлайном через 3 дня.",
		in.Section, in.OverallScore, weakLine,
	)
	if _, err := uc.Episodes.Append(ctx, domain.Episode{
		ThreadID: targetThread.ID,
		Role:     domain.RoleSystem,
		Content:  failureNote,
	}); err != nil {
		return fmt.Errorf("ai_tutor.OnFailedMock: append episode: %w", err)
	}

	// 2) LLM-сгенерированный assignment text. Если LLM упал — fallback
	// на стат-промпт (минимально-полезный assignment всё равно лучше чем
	// silent skip).
	title, body := uc.generateAssignment(ctx, targetPersona, in.Section, in.OverallScore, in.Weaknesses)

	// 3) Push assignment via tutor.PushAssignment. tutor_id = ai_user_id
	// персоны. relationship гарантирован: adopt UC уже создаёт его.
	if uc.Assignments == nil || targetPersona.AIUserID == nil {
		return nil
	}
	due := now.Add(assignmentDueWindow)
	if err := uc.Assignments.Push(ctx, *targetPersona.AIUserID, in.StudentID, title, body, &due); err != nil {
		return fmt.Errorf("ai_tutor.OnFailedMock: push assignment: %w", err)
	}
	return nil
}

func (uc *OnFailedMock) generateAssignment(
	ctx context.Context,
	persona domain.Persona,
	section string,
	overall int,
	weaknesses []string,
) (title string, body string) {
	weakLine := strings.Join(weaknesses, ", ")
	fallbackTitle := fmt.Sprintf("Разбор провального mock %s", section)
	fallbackBody := fmt.Sprintf(
		"Mock-секция %s — overall %d/100. Слабые места: %s.\n\n"+
			"План:\n"+
			"1. Прочти 1-2 материала по weakest topic'у (выбери из этого списка).\n"+
			"2. Реши 2-3 task'а на закрытие gap'а.\n"+
			"3. Запиши в Hone Notes 1-параграф рефлексии: «что я понял».\n"+
			"4. На следующей mock-секции жду применения этого.\n",
		section, overall, weakLine,
	)
	if uc.LLM == nil {
		return fallbackTitle, fallbackBody
	}
	prompt := fmt.Sprintf(
		"Студент завалил mock-секцию %s (overall %d/100). Слабые места: %s. "+
			"Сгенерируй короткий actionable assignment с дедлайном 3 дня. "+
			"Верни JSON {\"title\": string<=80, \"body_md\": string markdown с 3-5 шагами}.",
		section, overall, weakLine,
	)
	resp, err := uc.LLM.Run(ctx, persona.LLMTaskKind, []domain.LLMMessage{
		{Role: "system", Content: "Ты — AI-coach. Краткий деловой стиль."},
		{Role: "user", Content: prompt},
	}, domain.LLMOptions{Temperature: 0.4, MaxTokens: 600, JSONMode: true})
	if err != nil || strings.TrimSpace(resp.Content) == "" {
		return fallbackTitle, fallbackBody
	}
	t, b, ok := parseAssignmentJSON(resp.Content)
	if !ok || strings.TrimSpace(t) == "" {
		return fallbackTitle, fallbackBody
	}
	return t, b
}

// parseAssignmentJSON — мини-tolerant parser. Не используем encoding/json
// напрямую чтобы tolerate'ить fenced blocks ` ```json … ``` ` от LLM.
func parseAssignmentJSON(raw string) (title string, body string, ok bool) {
	s := strings.TrimSpace(raw)
	// Strip ```json fences если LLM их положил.
	if strings.HasPrefix(s, "```") {
		s = strings.TrimPrefix(s, "```json")
		s = strings.TrimPrefix(s, "```")
		if i := strings.LastIndex(s, "```"); i >= 0 {
			s = s[:i]
		}
	}
	s = strings.TrimSpace(s)
	// Naive: ищем "title": "..." и "body_md": "...". JSON-decoder тоже сработает,
	// но он строго требует одинарного объекта без trailing prose.
	title = jsonStringField(s, "title")
	body = jsonStringField(s, "body_md")
	if body == "" {
		body = jsonStringField(s, "body")
	}
	if title == "" && body == "" {
		return "", "", false
	}
	return title, body, true
}

func jsonStringField(blob, key string) string {
	idx := strings.Index(blob, "\""+key+"\"")
	if idx < 0 {
		return ""
	}
	rest := blob[idx+len(key)+2:]
	colon := strings.Index(rest, ":")
	if colon < 0 {
		return ""
	}
	rest = strings.TrimSpace(rest[colon+1:])
	if !strings.HasPrefix(rest, "\"") {
		return ""
	}
	rest = rest[1:]
	end := -1
	for i := 0; i < len(rest); i++ {
		if rest[i] == '\\' {
			i++
			continue
		}
		if rest[i] == '"' {
			end = i
			break
		}
	}
	if end < 0 {
		return ""
	}
	return strings.ReplaceAll(strings.ReplaceAll(rest[:end], "\\n", "\n"), "\\\"", "\"")
}

// MapSectionToTrackKind — ai_mock.section → ai_tutor_personas.scope_track_kind.
// Покрывает текущий enum sections; неизвестное падает в 'dev'.
func MapSectionToTrackKind(section string) string {
	switch section {
	case "english_hr":
		return "english"
	case "system_design", "system_design_senior", "tech_lead_em":
		return "dev_senior"
	case "ml_eng":
		return "dev_senior" // ml-персоны нет; senior coach ближайший
	default:
		return "dev"
	}
}
