package app

import (
	"strings"
	"testing"
)

func TestParseGradeResponse_OK(t *testing.T) {
	raw := `{"score":80,"attempts":[
		{"question_id":"q1","user_answer":"a","model_answer":"b","correct":true,"comment":"good"},
		{"question_id":"q2","user_answer":"x","model_answer":"y","correct":false,"comment":"bad"}
	]}`
	out, err := parseGradeResponse(raw)
	if err != nil {
		t.Fatal(err)
	}
	if out.Score != 80 || len(out.Attempts) != 2 {
		t.Fatalf("bad parse: %+v", out)
	}
}

func TestParseGradeResponse_RejectsOutOfRange(t *testing.T) {
	raw := `{"score":150,"attempts":[]}`
	if _, err := parseGradeResponse(raw); err == nil || !strings.Contains(err.Error(), "score out of range") {
		t.Fatalf("expected range error, got %v", err)
	}
}

func TestParseGradeResponse_RejectsEmptyQuestionID(t *testing.T) {
	raw := `{"score":50,"attempts":[{"question_id":"","user_answer":"a","model_answer":"b","correct":false,"comment":""}]}`
	if _, err := parseGradeResponse(raw); err == nil || !strings.Contains(err.Error(), "empty question_id") {
		t.Fatalf("expected empty question_id error, got %v", err)
	}
}

func TestBuildGradePrompt(t *testing.T) {
	answers := []QuestionAnswer{
		{QuestionID: "q1", Question: "What is exactly-once?", UserAnswer: "Idempotent producer + consumer offsets."},
	}
	out, err := buildGradePrompt(answers)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(out, "exactly-once") || !strings.Contains(out, "q1") {
		t.Fatalf("missing fields, got:\n%s", out)
	}
}
