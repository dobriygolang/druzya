// memory_snapshot.go — daily-note memory snapshot helpers extracted from
// the wiring layer. Pure string/text transforms that build the summary +
// payload pair appended to Coach memory when Hone saves a "today" note.
package infra

import (
	"strings"

	"github.com/google/uuid"
)

// DailyNoteMemorySnapshot returns (summary, payload, ok) for appending
// a daily-note episode to Coach memory. ok=false means the note was too
// short to be meaningful (<24 runes after compaction).
func DailyNoteMemorySnapshot(noteID uuid.UUID, title, body string) (string, map[string]any, bool) {
	excerpt := CompactMemoryText(body, 600)
	if len([]rune(excerpt)) < 24 {
		return "", nil, false
	}
	intent := DailyNoteIntent(excerpt)
	blockers := DailyNoteSnippets(excerpt, []string{
		"blocker", "blocked", "blocking", "stuck", "hard", "problem",
		"мешает", "блок", "застр", "сложно", "проблем", "не понимаю",
	}, 3)
	actionHints := DailyNoteSnippets(excerpt, []string{
		"todo", "need to", "must", "should", "review", "solve", "write", "read",
		"надо", "нужно", "сделать", "разобрать", "прочитать", "решить", "написать",
	}, 4)
	topics := DailyNoteTopics(excerpt)

	parts := make([]string, 0, 3)
	if intent != "" {
		parts = append(parts, "Intent: "+intent)
	} else {
		parts = append(parts, "Daily note: "+FirstSentence(excerpt, 160))
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

// CompactMemoryText whitespace-collapses + truncates with ellipsis to
// `limit` runes.
func CompactMemoryText(s string, limit int) string {
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

// DailyNoteIntent extracts the "what I want to do today" line from a
// daily note. Looks for explicit prefixes first (Intent:, Today:, etc.),
// falls back to the first non-action/non-blocker clause.
func DailyNoteIntent(body string) string {
	lines := splitMemoryClauses(body)
	for _, line := range lines {
		lower := strings.ToLower(line)
		for _, prefix := range []string{"intent:", "today:", "focus:", "goal:", "цель:", "сегодня:", "фокус:", "план:"} {
			if strings.HasPrefix(lower, prefix) {
				return FirstSentence(strings.TrimSpace(line[len(prefix):]), 160)
			}
		}
	}
	for _, line := range lines {
		if line == "" || looksLikeActionOrBlocker(line) {
			continue
		}
		return FirstSentence(line, 160)
	}
	return ""
}

// DailyNoteSnippets scans clauses for needle keywords and returns up to
// `limit` unique snippets.
func DailyNoteSnippets(body string, needles []string, limit int) []string {
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
			snippet := FirstSentence(strings.Trim(clause, "-*•[] \t"), 140)
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

// DailyNoteTopics maps body text to coarse topic tags via keyword rules.
func DailyNoteTopics(body string) []string {
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

// FirstSentence returns the first sentence-bounded fragment of s (up to
// `limit` runes after compaction).
func FirstSentence(s string, limit int) string {
	s = CompactMemoryText(s, limit)
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
