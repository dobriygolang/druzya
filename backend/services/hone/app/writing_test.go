package app

import (
	"context"
	"errors"
	"strings"
	"testing"

	"druz9/hone/domain"
	"druz9/hone/domain/mocks"

	"github.com/google/uuid"
	"go.uber.org/mock/gomock"
)

func TestGradeEnglishWriting_HappyPath(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	g := mocks.NewMockWritingGrader(ctrl)
	var last domain.GradeWritingInput
	g.EXPECT().GradeWriting(gomock.Any(), gomock.Any()).DoAndReturn(
		func(_ context.Context, in domain.GradeWritingInput) (domain.WritingFeedback, error) {
			last = in
			return domain.WritingFeedback{
				OverallScore: 78,
				Issues: []domain.WritingIssue{
					{Excerpt: "I done it", Category: domain.WritingIssueGrammar, Suggestion: "I did it"},
				},
			}, nil
		},
	)
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
	if last.Title != "My day" || last.Text != "I done it yesterday." {
		t.Errorf("input not trimmed: %+v", last)
	}
}

func TestGradeEnglishWriting_RejectsZeroIDsAndEmptyText(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	uc := &GradeEnglishWriting{Grader: mocks.NewMockWritingGrader(ctrl)}
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
	ctrl := gomock.NewController(t)
	g := mocks.NewMockWritingGrader(ctrl)
	// No EXPECT — UC must reject before calling.
	uc := &GradeEnglishWriting{Grader: g}
	huge := strings.Repeat("a", 50_001)
	if _, err := uc.Do(context.Background(), GradeEnglishWritingInput{
		UserID: uuid.New(),
		Text:   huge,
	}); err == nil {
		t.Fatal("expected size-cap rejection")
	}
}

func TestGradeEnglishWriting_GraderErrorPropagates(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	g := mocks.NewMockWritingGrader(ctrl)
	g.EXPECT().GradeWriting(gomock.Any(), gomock.Any()).Return(domain.WritingFeedback{}, errors.New("provider down"))
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
