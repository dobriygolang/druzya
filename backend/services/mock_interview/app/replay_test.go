// replay_test.go — unit tests для LLM-response parser.
//
// Эти тесты не требуют DB / LLM: validate'им JSON shape coercion +
// regex-fallback на stray text + cap на ≥5 annotations + неизвестный
// type coerce'ится в "missing".
package app

import (
	"strings"
	"testing"

	"druz9/mock_interview/domain"
)

func TestParseReplayJSON_Valid(t *testing.T) {
	raw := `{
		"ideal_answer_md": "## Идеальный ответ\n\nКонкретно по теме...",
		"annotations": [
			{"your_excerpt": "сказал X", "ideal_excerpt": "должен был Y", "type": "incorrect", "comment": "Чёт не то"},
			{"your_excerpt": "", "ideal_excerpt": "ключевая мысль", "type": "missing", "comment": "Не упомянул"},
			{"your_excerpt": "отличная мысль", "ideal_excerpt": "отличная мысль", "type": "good", "comment": "Молодец"}
		]
	}`
	got, err := parseReplayJSON(raw)
	if err != nil {
		t.Fatalf("parseReplayJSON err: %v", err)
	}
	if !strings.Contains(got.IdealAnswerMD, "Идеальный ответ") {
		t.Errorf("ideal_answer_md not preserved: %q", got.IdealAnswerMD)
	}
	if len(got.Annotations) != 3 {
		t.Fatalf("annotations count: got %d, want 3", len(got.Annotations))
	}
	if got.Annotations[0].Type != domain.ReplayAnnotationIncorrect {
		t.Errorf("type[0]: got %q, want incorrect", got.Annotations[0].Type)
	}
	if got.Annotations[2].Type != domain.ReplayAnnotationGood {
		t.Errorf("type[2]: got %q, want good", got.Annotations[2].Type)
	}
}

func TestParseReplayJSON_UnknownTypeCoercedToMissing(t *testing.T) {
	raw := `{
		"ideal_answer_md": "ok",
		"annotations": [{"your_excerpt": "x", "ideal_excerpt": "y", "type": "weird-type", "comment": "c"}]
	}`
	got, err := parseReplayJSON(raw)
	if err != nil {
		t.Fatalf("parseReplayJSON err: %v", err)
	}
	if got.Annotations[0].Type != domain.ReplayAnnotationMissing {
		t.Errorf("unknown type should coerce to missing, got %q", got.Annotations[0].Type)
	}
}

func TestParseReplayJSON_StripsStrayText(t *testing.T) {
	raw := "Sure, here you go:\n\n" + `{"ideal_answer_md":"x","annotations":[]}` + "\n\nLet me know if you need more."
	got, err := parseReplayJSON(raw)
	if err != nil {
		t.Fatalf("parseReplayJSON regex-fallback err: %v", err)
	}
	if got.IdealAnswerMD != "x" {
		t.Errorf("ideal_answer_md: got %q, want x", got.IdealAnswerMD)
	}
}

func TestParseReplayJSON_CapsAtFiveAnnotations(t *testing.T) {
	raw := `{
		"ideal_answer_md": "x",
		"annotations": [
			{"type":"missing","comment":"1","your_excerpt":"","ideal_excerpt":""},
			{"type":"missing","comment":"2","your_excerpt":"","ideal_excerpt":""},
			{"type":"missing","comment":"3","your_excerpt":"","ideal_excerpt":""},
			{"type":"missing","comment":"4","your_excerpt":"","ideal_excerpt":""},
			{"type":"missing","comment":"5","your_excerpt":"","ideal_excerpt":""},
			{"type":"missing","comment":"6","your_excerpt":"","ideal_excerpt":""},
			{"type":"missing","comment":"7","your_excerpt":"","ideal_excerpt":""}
		]
	}`
	got, err := parseReplayJSON(raw)
	if err != nil {
		t.Fatalf("err: %v", err)
	}
	if len(got.Annotations) != 5 {
		t.Errorf("cap not enforced: got %d, want 5", len(got.Annotations))
	}
}

func TestParseReplayJSON_EmptyIdealRejected(t *testing.T) {
	raw := `{"ideal_answer_md": "  ", "annotations": []}`
	if _, err := parseReplayJSON(raw); err == nil {
		t.Error("expected error for empty ideal_answer_md, got nil")
	}
}

func TestBuildReplayUserMsg_IncludesAllSections(t *testing.T) {
	msg := buildReplayUserMsg(replayPromptInput{
		Question:          "What is a hash table?",
		ReferenceAnswerMD: "Hash table maps keys to values via a hash fn.",
		MustMention:       []string{"collision resolution", "amortised O(1)"},
		CommonPitfalls:    []string{"forgetting load factor"},
		YourAnswerMD:      "It's like an array",
		AIFeedbackMD:      "Too brief.",
		AIMissingPoints:   []string{"hash function", "buckets"},
	})
	for _, want := range []string{
		"Вопрос интервьюера",
		"What is a hash table?",
		"Reference-ответ",
		"Hash table maps",
		"must-mention",
		"collision resolution",
		"Типичные ошибки",
		"forgetting load factor",
		"Ответ кандидата",
		"It's like an array",
		"AI-фидбек",
		"Too brief.",
		"hash function",
	} {
		if !strings.Contains(msg, want) {
			t.Errorf("user msg missing %q", want)
		}
	}
}

func TestBuildReplayUserMsg_EmptyAnswerMarked(t *testing.T) {
	msg := buildReplayUserMsg(replayPromptInput{
		Question:     "x",
		YourAnswerMD: "",
	})
	if !strings.Contains(msg, "(пусто)") {
		t.Errorf("empty answer should render as «(пусто)»; got msg=%q", msg)
	}
}
