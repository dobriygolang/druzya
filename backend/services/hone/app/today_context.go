package app

import (
	"slices"
	"strings"

	"druz9/hone/domain"
)

func buildTodayContext(body string) domain.TodayContext {
	excerpt := compactNoteMemoryBody(body, 600)
	if len([]rune(excerpt)) < 24 {
		return domain.TodayContext{}
	}
	return domain.TodayContext{
		Excerpt:     excerpt,
		Intent:      todayContextIntent(excerpt),
		Blockers:    todayContextSnippets(excerpt, blockerNeedles(), 3),
		Topics:      todayContextTopics(excerpt),
		ActionHints: todayContextSnippets(excerpt, actionNeedles(), 4),
	}
}

func hasTodayContextSignal(ctx domain.TodayContext) bool {
	return ctx.Intent != "" || len(ctx.Blockers) > 0 || len(ctx.Topics) > 0 || len(ctx.ActionHints) > 0
}

func todayContextIntent(body string) string {
	for _, clause := range splitTodayContextClauses(body) {
		lower := strings.ToLower(clause)
		for _, prefix := range []string{"intent:", "today:", "focus:", "goal:", "цель:", "сегодня:", "фокус:", "план:"} {
			if strings.HasPrefix(lower, prefix) {
				return firstTodayContextSentence(strings.TrimSpace(clause[len(prefix):]), 160)
			}
		}
	}
	for _, clause := range splitTodayContextClauses(body) {
		if clause == "" || looksLikeTodayContextActionOrBlocker(clause) {
			continue
		}
		return firstTodayContextSentence(clause, 160)
	}
	return ""
}

func todayContextSnippets(body string, needles []string, limit int) []string {
	if limit <= 0 {
		return nil
	}
	out := make([]string, 0, limit)
	seen := make(map[string]struct{}, limit)
	for _, clause := range splitTodayContextClauses(body) {
		lower := strings.ToLower(clause)
		for _, needle := range needles {
			if !strings.Contains(lower, needle) {
				continue
			}
			snippet := firstTodayContextSentence(strings.Trim(clause, "-*•[] \t"), 140)
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

// maxTodayContextTopics caps how many topic-tags we emit per today-note,
// keeping the plan-prompt tight even when a note touches many themes.
const maxTodayContextTopics = 6

func todayContextTopics(body string) []string {
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
	out := make([]string, 0, maxTodayContextTopics)
	for _, rule := range rules {
		for _, key := range rule.keys {
			if strings.Contains(lower, key) {
				out = append(out, rule.topic)
				break
			}
		}
		if len(out) >= maxTodayContextTopics {
			break
		}
	}
	return out
}

func splitTodayContextClauses(body string) []string {
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

func firstTodayContextSentence(s string, limit int) string {
	s = compactNoteMemoryBody(s, limit)
	for _, sep := range []string{".", "?", "!"} {
		if idx := strings.Index(s, sep); idx > 0 && idx < len(s)-1 {
			return strings.TrimSpace(s[:idx+1])
		}
	}
	return s
}

func looksLikeTodayContextActionOrBlocker(line string) bool {
	lower := strings.ToLower(line)
	needles := append(blockerNeedles(), actionNeedles()...)
	return slices.ContainsFunc(needles, func(marker string) bool { return strings.Contains(lower, marker) })
}

func blockerNeedles() []string {
	return []string{
		"blocker", "blocked", "blocking", "stuck", "hard", "problem",
		"мешает", "блок", "застр", "сложно", "проблем", "не понимаю",
	}
}

func actionNeedles() []string {
	return []string{
		"todo", "need to", "must", "should", "review", "solve", "write", "read",
		"надо", "нужно", "сделать", "разобрать", "прочитать", "решить", "написать",
	}
}
