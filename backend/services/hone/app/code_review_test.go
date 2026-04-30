package app

import (
	"context"
	"errors"
	"strings"
	"testing"

	"druz9/hone/domain"

	"github.com/google/uuid"
)

type stubReviewGrader struct {
	out   domain.CodeReviewFeedback
	err   error
	last  domain.GradeCodeReviewInput
	calls int
}

func (s *stubReviewGrader) GradeReview(_ context.Context, in domain.GradeCodeReviewInput) (domain.CodeReviewFeedback, error) {
	s.calls++
	s.last = in
	return s.out, s.err
}

func TestGradeCodeReview_HappyPath(t *testing.T) {
	t.Parallel()
	g := &stubReviewGrader{
		out: domain.CodeReviewFeedback{
			OverallScore: 72,
			Issues: []domain.CodeReviewIssue{
				{
					Excerpt:    "this is wrong",
					Category:   domain.ReviewIssueCorrectness,
					Suggestion: "actually it does X correctly",
				},
			},
		},
	}
	uc := &GradeCodeReview{Grader: g}
	out, err := uc.Do(context.Background(), GradeCodeReviewInput{
		UserID:   uuid.New(),
		PRTitle:  "  add cache eviction  ",
		DiffMD:   "  diff --git a/foo.go b/foo.go ... ",
		ReviewMD: "  this is wrong; line 42 needs ...  ",
	})
	if err != nil {
		t.Fatalf("unexpected: %v", err)
	}
	if out.OverallScore != 72 || len(out.Issues) != 1 {
		t.Errorf("feedback round-trip broken: %+v", out)
	}
	// Inputs trimmed before reaching the grader.
	if g.last.PRTitle != "add cache eviction" {
		t.Errorf("PR title not trimmed: %q", g.last.PRTitle)
	}
	if g.last.DiffMD != "diff --git a/foo.go b/foo.go ..." {
		t.Errorf("diff not trimmed: %q", g.last.DiffMD)
	}
}

func TestGradeCodeReview_RejectsMissingInputs(t *testing.T) {
	t.Parallel()
	uc := &GradeCodeReview{Grader: &stubReviewGrader{}}
	cases := []struct {
		name string
		in   GradeCodeReviewInput
	}{
		{"zero user id", GradeCodeReviewInput{DiffMD: "d", ReviewMD: "r"}},
		{"empty diff", GradeCodeReviewInput{UserID: uuid.New(), DiffMD: "  ", ReviewMD: "r"}},
		{"empty review", GradeCodeReviewInput{UserID: uuid.New(), DiffMD: "d", ReviewMD: " "}},
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

func TestGradeCodeReview_RejectsOversizedDiff(t *testing.T) {
	t.Parallel()
	g := &stubReviewGrader{}
	uc := &GradeCodeReview{Grader: g}
	huge := strings.Repeat("a", codeReviewDiffMax+1)
	if _, err := uc.Do(context.Background(), GradeCodeReviewInput{
		UserID:   uuid.New(),
		DiffMD:   huge,
		ReviewMD: "ok",
	}); err == nil {
		t.Fatal("expected size-cap rejection")
	}
	if g.calls != 0 {
		t.Errorf("grader must not be called for oversize diff; calls=%d", g.calls)
	}
}

func TestGradeCodeReview_GraderErrorPropagates(t *testing.T) {
	t.Parallel()
	g := &stubReviewGrader{err: errors.New("provider down")}
	uc := &GradeCodeReview{Grader: g}
	_, err := uc.Do(context.Background(), GradeCodeReviewInput{
		UserID:   uuid.New(),
		DiffMD:   "d",
		ReviewMD: "r",
	})
	if err == nil {
		t.Fatal("grader error must propagate")
	}
}

func TestGradeCodeReview_NilGraderIsRejected(t *testing.T) {
	t.Parallel()
	uc := &GradeCodeReview{Grader: nil}
	if _, err := uc.Do(context.Background(), GradeCodeReviewInput{
		UserID:   uuid.New(),
		DiffMD:   "d",
		ReviewMD: "r",
	}); err == nil {
		t.Fatal("nil grader must error rather than nil-deref")
	}
}
