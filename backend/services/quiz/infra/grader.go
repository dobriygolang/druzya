package infra

import (
	"context"
	"strings"

	"druz9/quiz/domain"
)

// FuzzyGrader — exact-string fallback when no LLM is configured. Compares
// normalised forms (lowercased, whitespace-collapsed); accepts a match if
// every keyword from the expected answer appears in the given answer.
//
// "Why this floor exists": even without an LLM key the quiz feature is
// usable for codex articles where quiz_answer is short ("DFS",
// "O(n log n)", etc.). LLM grading swaps this in production via the
// LLMGrader below; quizzes degrade gracefully to keyword match.
type FuzzyGrader struct{}

// NewFuzzyGrader wires the floor grader.
func NewFuzzyGrader() *FuzzyGrader { return &FuzzyGrader{} }

// Grade returns Correct=true iff every word from the expected answer is
// present in the given answer (case-insensitive).
func (FuzzyGrader) Grade(_ context.Context, q domain.Question, given string) (domain.AnswerJudgement, error) {
	want := normaliseTokens(q.ExpectedAnswer)
	got := normaliseTokens(given)
	if len(want) == 0 {
		return domain.AnswerJudgement{
			QuestionID:  q.ID,
			GivenAnswer: given,
			Correct:     false,
			Explanation: "Эталонный ответ не задан, автоматическая проверка невозможна.",
		}, nil
	}
	gotSet := make(map[string]struct{}, len(got))
	for _, w := range got {
		gotSet[w] = struct{}{}
	}
	for _, w := range want {
		if _, ok := gotSet[w]; !ok {
			return domain.AnswerJudgement{
				QuestionID:  q.ID,
				GivenAnswer: given,
				Correct:     false,
				Explanation: "Не хватает ключевых слов из эталонного ответа.",
			}, nil
		}
	}
	return domain.AnswerJudgement{
		QuestionID:  q.ID,
		GivenAnswer: given,
		Correct:     true,
		Explanation: "Все ключевые слова присутствуют.",
	}, nil
}

// normaliseTokens lower-cases, splits on whitespace/punctuation, drops
// 1-letter junk so noise like "is/the/a" doesn't dominate the match.
func normaliseTokens(s string) []string {
	s = strings.ToLower(s)
	fields := strings.FieldsFunc(s, func(r rune) bool {
		switch {
		case r == ' ', r == '\t', r == '\n', r == ',', r == '.', r == ';', r == ':',
			r == '(', r == ')', r == '[', r == ']', r == '"', r == '\'':
			return true
		}
		return false
	})
	out := make([]string, 0, len(fields))
	for _, f := range fields {
		if len([]rune(f)) <= 1 {
			continue
		}
		out = append(out, f)
	}
	return out
}

// Compile-time guard.
var _ domain.Grader = (*FuzzyGrader)(nil)
