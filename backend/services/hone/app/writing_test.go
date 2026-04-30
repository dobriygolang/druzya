package app

import (
	"context"
	"errors"
	"strings"
	"testing"

	"druz9/hone/domain"

	"github.com/google/uuid"
)

type stubWritingGrader struct {
	out   domain.WritingFeedback
	err   error
	last  domain.GradeWritingInput
	calls int
}

func (s *stubWritingGrader) GradeWriting(_ context.Context, in domain.GradeWritingInput) (domain.WritingFeedback, error) {
	s.calls++
	s.last = in
	return s.out, s.err
}

func TestGradeEnglishWriting_HappyPath(t *testing.T) {
	t.Parallel()
	g := &stubWritingGrader{
		out: domain.WritingFeedback{
			OverallScore: 78,
			Issues: []domain.WritingIssue{
				{Excerpt: "I done it", Category: domain.WritingIssueGrammar, Suggestion: "I did it"},
			},
		},
	}
	uc := &GradeEnglishWriting{Grader: g}
	out, err := uc.Do(context.Background(), GradeEnglishWritingInput{
		UserID: uuid.New(),
		Title:  "  My day  ",
		Text:   "  I done it yesterday.  ",
	})
	if err != nil {
		t.Fatalf("unexpected: %v", err)
	}
	if out.OverallScore != 78 || len(out.Issues) != 1 {
		t.Errorf("feedback round-trip broken: %+v", out)
	}
	// Title + text trimmed before reaching grader.
	if g.last.Title != "My day" || g.last.Text != "I done it yesterday." {
		t.Errorf("input not trimmed: %+v", g.last)
	}
}

func TestGradeEnglishWriting_RejectsZeroIDsAndEmptyText(t *testing.T) {
	t.Parallel()
	uc := &GradeEnglishWriting{Grader: &stubWritingGrader{}}
	cases := []struct {
		name string
		in   GradeEnglishWritingInput
	}{
		{"zero user id", GradeEnglishWritingInput{Text: "hi"}},
		{"empty text", GradeEnglishWritingInput{UserID: uuid.New(), Text: "   "}},
	}
	for _, c := range cases {
		c := c
		t.Run(c.name, func(t *testing.T) {
			t.Parallel()
			if _, err := uc.Do(context.Background(), c.in); err == nil {
				t.Errorf("expected error for %s", c.name)
			}
		})
	}
}

func TestGradeEnglishWriting_RejectsOversizedText(t *testing.T) {
	t.Parallel()
	g := &stubWritingGrader{}
	uc := &GradeEnglishWriting{Grader: g}
	huge := strings.Repeat("a", 50_001)
	if _, err := uc.Do(context.Background(), GradeEnglishWritingInput{
		UserID: uuid.New(),
		Text:   huge,
	}); err == nil {
		t.Fatal("expected size-cap rejection")
	}
	if g.calls != 0 {
		t.Errorf("grader must not be called for oversize text; calls=%d", g.calls)
	}
}

func TestGradeEnglishWriting_GraderErrorPropagates(t *testing.T) {
	t.Parallel()
	g := &stubWritingGrader{err: errors.New("provider down")}
	uc := &GradeEnglishWriting{Grader: g}
	_, err := uc.Do(context.Background(), GradeEnglishWritingInput{
		UserID: uuid.New(),
		Text:   "hello",
	})
	if err == nil {
		t.Fatal("grader error must propagate")
	}
}

func TestGradeEnglishWriting_NilGraderIsRejected(t *testing.T) {
	t.Parallel()
	uc := &GradeEnglishWriting{Grader: nil}
	if _, err := uc.Do(context.Background(), GradeEnglishWritingInput{
		UserID: uuid.New(),
		Text:   "hello",
	}); err == nil {
		t.Fatal("nil grader must error rather than nil-deref")
	}
}
