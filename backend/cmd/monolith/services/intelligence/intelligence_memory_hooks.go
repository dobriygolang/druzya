package intelligence

import (
	"context"
	"fmt"
	"log/slog"
	"strings"
	"sync"
	"time"

	honeDomain "druz9/hone/domain"
	intelApp "druz9/intelligence/app"
	intelDomain "druz9/intelligence/domain"
	miDomain "druz9/mock_interview/domain"

	"github.com/google/uuid"
)

// newMockMemoryHook builds the adapter that mock_interview's
// orchestrator uses to write `mock_pipeline_finished` episodes. Same
// pattern as newIntelligenceMemoryHook for hone — the mock_interview
// service stays decoupled from intelligence/domain and only knows the
// narrow miDomain.MemoryHook interface.
func newMockMemoryHook(m *intelApp.Memory, log *slog.Logger) miDomain.MemoryHook {
	return &mockMemoryHook{memory: m, log: log}
}

type mockMemoryHook struct {
	memory *intelApp.Memory
	log    *slog.Logger
}

func (h *mockMemoryHook) OnPipelineFinished(
	ctx context.Context,
	userID uuid.UUID,
	pipelineID uuid.UUID,
	verdict miDomain.PipelineVerdict,
	totalScore *float32,
	stages []miDomain.PipelineStage,
	occurredAt time.Time,
) {
	parts := []string{fmt.Sprintf("verdict=%s", string(verdict))}
	if totalScore != nil {
		parts = append(parts, fmt.Sprintf("total_score=%.0f", *totalScore))
	}
	stagesPayload := make([]map[string]any, 0, len(stages))
	for _, s := range stages {
		row := map[string]any{"stage_kind": string(s.StageKind)}
		if s.Verdict != nil {
			row["verdict"] = string(*s.Verdict)
		}
		if s.Score != nil {
			row["score"] = *s.Score
		}
		stagesPayload = append(stagesPayload, row)
	}
	summary := strings.Join(parts, " · ")
	h.memory.AppendAsync(ctx, intelApp.AppendInput{
		UserID:  userID,
		Kind:    intelDomain.EpisodeMockPipelineFinished,
		Summary: summary,
		Payload: map[string]any{
			"pipeline_id": pipelineID.String(),
			"stages":      stagesPayload,
		},
		OccurredAt: occurredAt,
	})
}

var _ miDomain.MemoryHook = (*mockMemoryHook)(nil)

// memoryHook implements hone/domain.MemoryHook — узкий side-effect channel
// в Coach memory. Hone use cases дёргают (опционально через nil-check).
// Имплементация = thin shim over intelApp.Memory.AppendAsync.
type memoryHook struct {
	memory          *intelApp.Memory
	log             *slog.Logger
	mu              sync.Mutex
	lastDailyNoteAt map[string]time.Time
}

func newIntelligenceMemoryHook(m *intelApp.Memory, log *slog.Logger) honeDomain.MemoryHook {
	return &memoryHook{memory: m, log: log, lastDailyNoteAt: make(map[string]time.Time)}
}

func (h *memoryHook) OnReflectionAdded(ctx context.Context, uid uuid.UUID, reflection, planItemID string, sec int, occ time.Time) {
	if reflection == "" {
		return
	}
	h.memory.AppendAsync(ctx, intelApp.AppendInput{
		UserID: uid, Kind: intelDomain.EpisodeReflectionAdded, Summary: reflection,
		Payload:    map[string]any{"plan_item_id": planItemID, "seconds": sec},
		OccurredAt: occ,
	})
}
func (h *memoryHook) OnStandupRecorded(ctx context.Context, uid uuid.UUID, y, t, b string, occ time.Time) {
	parts := []string{}
	if y != "" {
		parts = append(parts, "Yesterday: "+y)
	}
	if t != "" {
		parts = append(parts, "Today: "+t)
	}
	if b != "" {
		parts = append(parts, "Blockers: "+b)
	}
	if len(parts) == 0 {
		return
	}
	summary := strings.Join(parts, " || ")
	h.memory.AppendAsync(ctx, intelApp.AppendInput{
		UserID: uid, Kind: intelDomain.EpisodeStandupRecorded, Summary: summary,
		Payload:    map[string]any{"yesterday": y, "today": t, "blockers": b},
		OccurredAt: occ,
	})
}
func (h *memoryHook) OnPlanSkipped(ctx context.Context, uid uuid.UUID, title, skill string, occ time.Time) {
	h.memory.AppendAsync(ctx, intelApp.AppendInput{
		UserID: uid, Kind: intelDomain.EpisodePlanSkipped, Summary: title,
		Payload:    map[string]any{"skill_key": skill},
		OccurredAt: occ,
	})
}
func (h *memoryHook) OnPlanCompleted(ctx context.Context, uid uuid.UUID, title, skill string, occ time.Time) {
	h.memory.AppendAsync(ctx, intelApp.AppendInput{
		UserID: uid, Kind: intelDomain.EpisodePlanCompleted, Summary: title,
		Payload:    map[string]any{"skill_key": skill},
		OccurredAt: occ,
	})
}
func (h *memoryHook) OnNoteCreated(ctx context.Context, uid uuid.UUID, noteID uuid.UUID, title, body200 string, occ time.Time) {
	summary := title
	if body200 != "" {
		summary = title + ": " + body200
	}
	h.memory.AppendAsync(ctx, intelApp.AppendInput{
		UserID: uid, Kind: intelDomain.EpisodeNoteCreated, Summary: summary,
		Payload:    map[string]any{"note_id": noteID.String()},
		OccurredAt: occ,
	})
}
func (h *memoryHook) OnDailyNoteSaved(ctx context.Context, uid uuid.UUID, noteID uuid.UUID, title, body600 string, occ time.Time) {
	summary, payload, ok := dailyNoteMemorySnapshot(noteID, title, body600)
	if !ok {
		return
	}
	key := uid.String() + ":" + noteID.String()
	h.mu.Lock()
	last := h.lastDailyNoteAt[key]
	if !last.IsZero() && occ.Sub(last) < 15*time.Minute {
		h.mu.Unlock()
		return
	}
	h.lastDailyNoteAt[key] = occ
	h.mu.Unlock()

	h.memory.AppendAsync(ctx, intelApp.AppendInput{
		UserID:     uid,
		Kind:       intelDomain.EpisodeNoteCreated,
		Summary:    summary,
		Payload:    payload,
		OccurredAt: occ,
	})
}
func (h *memoryHook) OnFocusSessionDone(ctx context.Context, uid uuid.UUID, pinned string, sec int, planItemID string, pomodoros int, occ time.Time) {
	if sec < 5*60 {
		return // короче 5 минут — не «сессия», skip
	}
	summary := pinned
	if summary == "" {
		summary = "Focus block"
	}
	h.memory.AppendAsync(ctx, intelApp.AppendInput{
		UserID: uid, Kind: intelDomain.EpisodeFocusSessionDone, Summary: summary,
		Payload:    map[string]any{"seconds": sec, "plan_item_id": planItemID, "pomodoros": pomodoros},
		OccurredAt: occ,
	})
}

// Compile-time guard.
var _ honeDomain.MemoryHook = (*memoryHook)(nil)

func dailyNoteMemorySnapshot(noteID uuid.UUID, title, body string) (string, map[string]any, bool) {
	excerpt := compactMemoryText(body, 600)
	if len([]rune(excerpt)) < 24 {
		return "", nil, false
	}
	intent := dailyNoteIntent(excerpt)
	blockers := dailyNoteSnippets(excerpt, []string{
		"blocker", "blocked", "blocking", "stuck", "hard", "problem",
		"мешает", "блок", "застр", "сложно", "проблем", "не понимаю",
	}, 3)
	actionHints := dailyNoteSnippets(excerpt, []string{
		"todo", "need to", "must", "should", "review", "solve", "write", "read",
		"надо", "нужно", "сделать", "разобрать", "прочитать", "решить", "написать",
	}, 4)
	topics := dailyNoteTopics(excerpt)

	parts := make([]string, 0, 3)
	if intent != "" {
		parts = append(parts, "Intent: "+intent)
	} else {
		parts = append(parts, "Daily note: "+firstSentence(excerpt, 160))
	}
	if len(blockers) > 0 {
		parts = append(parts, "Blockers: "+strings.Join(blockers, "; "))
	}
	if len(topics) > 0 {
		parts = append(parts, "Topics: "+strings.Join(topics, ", "))
	}
	payload := map[string]any{
		"note_id":      noteID.String(),
		"title":        title,
		"source":       "today",
		"snapshot":     true,
		"excerpt":      excerpt,
		"intent":       intent,
		"blockers":     blockers,
		"topics":       topics,
		"action_hints": actionHints,
	}
	return strings.Join(parts, " | "), payload, true
}

func compactMemoryText(s string, limit int) string {
	s = strings.Join(strings.Fields(strings.TrimSpace(s)), " ")
	if s == "" || limit <= 0 {
		return ""
	}
	runes := []rune(s)
	if len(runes) <= limit {
		return s
	}
	return string(runes[:limit]) + "..."
}

func dailyNoteIntent(body string) string {
	lines := splitMemoryClauses(body)
	for _, line := range lines {
		lower := strings.ToLower(line)
		for _, prefix := range []string{"intent:", "today:", "focus:", "goal:", "цель:", "сегодня:", "фокус:", "план:"} {
			if strings.HasPrefix(lower, prefix) {
				return firstSentence(strings.TrimSpace(line[len(prefix):]), 160)
			}
		}
	}
	for _, line := range lines {
		if line == "" || looksLikeActionOrBlocker(line) {
			continue
		}
		return firstSentence(line, 160)
	}
	return ""
}

func dailyNoteSnippets(body string, needles []string, limit int) []string {
	if limit <= 0 {
		return nil
	}
	out := make([]string, 0, limit)
	seen := make(map[string]struct{}, limit)
	for _, clause := range splitMemoryClauses(body) {
		lower := strings.ToLower(clause)
		for _, needle := range needles {
			if !strings.Contains(lower, needle) {
				continue
			}
			snippet := firstSentence(strings.Trim(clause, "-*•[] \t"), 140)
			key := strings.ToLower(snippet)
			if snippet == "" {
				break
			}
			if _, ok := seen[key]; ok {
				break
			}
			seen[key] = struct{}{}
			out = append(out, snippet)
			break
		}
		if len(out) >= limit {
			return out
		}
	}
	return out
}

func dailyNoteTopics(body string) []string {
	lower := " " + strings.ToLower(body) + " "
	rules := []struct {
		topic string
		keys  []string
	}{
		{"cache-design", []string{"redis", "cache", "кеш", "invalidation"}},
		{"system-design", []string{"system design", "систем дизайн", "архитектур", "scal", "shard", "queue", "load balancer"}},
		{"algorithms", []string{"algorithm", "алгорит", "leetcode", "kata"}},
		{"dynamic-programming", []string{"dynamic programming", "dp", "динамичес"}},
		{"graphs", []string{"graph", "bfs", "dfs", "граф"}},
		{"databases", []string{"postgres", "sql", "database", "db", "база данных"}},
		{"frontend", []string{"react", "typescript", "frontend", "ui", "css"}},
		{"behavioral", []string{"behavioral", "поведен", "leadership", "conflict"}},
		{"interview", []string{"interview", "собес", "интервью"}},
		{"go", []string{"golang", " go ", "grpc"}},
	}
	out := make([]string, 0, 6)
	for _, rule := range rules {
		for _, key := range rule.keys {
			if strings.Contains(lower, key) {
				out = append(out, rule.topic)
				break
			}
		}
		if len(out) >= 6 {
			break
		}
	}
	return out
}

func splitMemoryClauses(body string) []string {
	body = strings.NewReplacer("\r\n", "\n", "\r", "\n", ";", "\n").Replace(body)
	raw := strings.Split(body, "\n")
	out := make([]string, 0, len(raw))
	for _, line := range raw {
		for _, part := range strings.Split(line, ". ") {
			part = strings.TrimSpace(part)
			if part != "" {
				out = append(out, part)
			}
		}
	}
	return out
}

func firstSentence(s string, limit int) string {
	s = compactMemoryText(s, limit)
	for _, sep := range []string{".", "?", "!"} {
		if idx := strings.Index(s, sep); idx > 0 && idx < len(s)-1 {
			return strings.TrimSpace(s[:idx+1])
		}
	}
	return s
}

func looksLikeActionOrBlocker(line string) bool {
	lower := strings.ToLower(line)
	for _, marker := range []string{
		"todo", "need to", "must", "should", "blocker", "blocked", "stuck",
		"надо", "нужно", "сделать", "мешает", "сложно", "застр",
	} {
		if strings.Contains(lower, marker) {
			return true
		}
	}
	return false
}
