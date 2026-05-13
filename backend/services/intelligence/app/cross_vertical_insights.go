// cross_vertical_insights.go — Wave 15 cross-vertical insights v2.
//
// Why a separate UC from app/insights.go GenerateInsights:
//   - GenerateInsights walks the SAME prompt-input snapshot the
//     DailyBrief synth uses; it's single-axis (mock weak topic, weak
//     skill, long-absence) and stable enough to upsert into the existing
//     insight stream table.
//   - This UC is multi-axis: it correlates signals across English /
//     Mock / Vocab even when each axis alone is unremarkable. It
//     produces a *separate* read shape (CrossInsight) that the coach
//     next-action + Today UI consume directly — no DB persistence,
//     no upsert. The Today UI calls ListCrossVerticalInsights live;
//     coach next-action calls it inline when the primary action is
//     resolved.
//
// Three producers run in parallel goroutines; results merged + sorted by
// severity DESC, truncated to top 5. Empty result is the happy path on
// a quiet day.
package app

import (
	"context"
	"fmt"
	"log/slog"
	"sort"
	"sync"
	"time"

	"druz9/intelligence/app/producers"
	"druz9/intelligence/domain"

	"github.com/google/uuid"
)

// CrossInsight — projection produced by the Wave 15 cross-vertical UC.
//
// Distinct from domain.Insight: this is ephemeral (no upsert), the wire
// shape is flatter (no event_id / anchor / acted/dismissed state). We
// reuse domain.InsightSeverity for severity ranking so UI shares the
// same colour mapping.
type CrossInsight struct {
	Kind                  string
	Severity              domain.InsightSeverity
	MessageMD             string
	SuggestedActionURL    string
	SuggestedActionLabel  string
}

// CrossVerticalInsights — aggregator UC.
//
// All three readers are optional: nil readers degrade to no signal.
// Tests / partial wiring stay safe.
type CrossVerticalInsights struct {
	English EnglishActivityReaderPort
	Vocab   VocabLagReaderPort
	Mocks   domain.MockReader
	Log     *slog.Logger
	Now     func() time.Time
}

// EnglishActivityReaderPort — narrow port (alias domain.EnglishActivityReader)
// so this UC stays decoupled from the concrete impl. UC depends on the
// interface; wiring binds the postgres adapter.
type EnglishActivityReaderPort = domain.EnglishActivityReader

// VocabLagReaderPort — narrow port (alias domain.VocabLagReader).
type VocabLagReaderPort = domain.VocabLagReader

// ListCrossVerticalInsightsInput — auth-scoped.
type ListCrossVerticalInsightsInput struct {
	UserID uuid.UUID
}

// ListCrossVerticalInsightsOutput — top-5 insights ranked by severity.
type ListCrossVerticalInsightsOutput struct {
	Items []CrossInsight
}

// Do runs all producers in parallel, ranks by severity, returns top 5.
//
// Each producer is fault-isolated: a broken reader returns no signal for
// that producer but doesn't blank out the others. This is consistent with
// how GetDailyBrief degrades readers — partial data beats no data.
func (uc *CrossVerticalInsights) Do(ctx context.Context, in ListCrossVerticalInsightsInput) (ListCrossVerticalInsightsOutput, error) {
	if in.UserID == uuid.Nil {
		return ListCrossVerticalInsightsOutput{}, fmt.Errorf("cross_vertical: %w: zero user_id", domain.ErrInvalidInput)
	}
	now := uc.now()

	var (
		englishOut []domain.Insight
		vocabOut   []domain.Insight
		mockOut    []domain.Insight
		wg         sync.WaitGroup
	)

	if uc.English != nil {
		wg.Add(1)
		go func() {
			defer wg.Done()
			summary, err := uc.English.Summary7d(ctx, in.UserID)
			if err != nil {
				uc.warn("english_activity_reader", err)
				return
			}
			englishOut = producers.FromEnglishPattern(producers.EnglishActivity{
				ReadingDaysLast7:   summary.ReadingDaysLast7,
				VocabReviewedLast7: summary.VocabReviewedLast7,
				SpeakingAttempts7d: summary.SpeakingAttempts7d,
				SpeakingAvgScore7d: summary.SpeakingAvgScore7d,
				LastSpeakingAt:     summary.LastSpeakingAt,
			}, now)
		}()
	}

	if uc.Vocab != nil {
		wg.Add(1)
		go func() {
			defer wg.Done()
			lag, err := uc.Vocab.Lag(ctx, in.UserID)
			if err != nil {
				uc.warn("vocab_lag_reader", err)
				return
			}
			vocabOut = producers.FromVocabLag(producers.VocabLagSnapshot{
				TotalCards:          lag.TotalCards,
				DueCards:            lag.DueCards,
				DaysSinceLastReview: lag.DaysSinceLastReview,
			}, now)
		}()
	}

	if uc.Mocks != nil {
		wg.Add(1)
		go func() {
			defer wg.Done()
			mocks, err := uc.Mocks.LastNFinished(ctx, in.UserID, 8)
			if err != nil {
				uc.warn("mocks_reader", err)
				return
			}
			mockOut = producers.FromMockPattern(mocks, now)
		}()
	}

	wg.Wait()

	combined := make([]domain.Insight, 0, len(englishOut)+len(vocabOut)+len(mockOut))
	combined = append(combined, englishOut...)
	combined = append(combined, vocabOut...)
	combined = append(combined, mockOut...)

	// Rank by severity DESC (critical>warn>nudge>cruise), then by
	// expires_at DESC (longer-lived insights ranked higher tiebreak).
	sort.SliceStable(combined, func(i, j int) bool {
		si := severityRank(combined[i].Severity)
		sj := severityRank(combined[j].Severity)
		if si != sj {
			return si > sj
		}
		return combined[i].ExpiresAt.After(combined[j].ExpiresAt)
	})

	if len(combined) > 5 {
		combined = combined[:5]
	}

	out := make([]CrossInsight, 0, len(combined))
	for _, ins := range combined {
		out = append(out, CrossInsight{
			Kind:                 anchorKind(ins.Anchor),
			Severity:             ins.Severity,
			MessageMD:            buildMessageMD(ins),
			SuggestedActionURL:   ins.DeepLink,
			SuggestedActionLabel: ins.Lever,
		})
	}
	return ListCrossVerticalInsightsOutput{Items: out}, nil
}

func (uc *CrossVerticalInsights) now() time.Time {
	if uc.Now != nil {
		return uc.Now()
	}
	return time.Now()
}

func (uc *CrossVerticalInsights) warn(reader string, err error) {
	if uc.Log == nil || err == nil {
		return
	}
	uc.Log.Warn("cross_vertical: reader failed",
		slog.String("reader", reader),
		slog.Any("err", err))
}

// severityRank maps severity → int for sorting. Higher = more urgent.
func severityRank(s domain.InsightSeverity) int {
	switch s {
	case domain.InsightSeverityCritical:
		return 4
	case domain.InsightSeverityWarn:
		return 3
	case domain.InsightSeverityNudge:
		return 2
	case domain.InsightSeverityCruise:
		return 1
	}
	return 0
}

// anchorKind takes the producer's stable anchor («english:speaking-low:%s»)
// and projects the kind prefix («english:speaking-low») for client routing.
// Empty anchor falls back to "generic".
func anchorKind(anchor string) string {
	if anchor == "" {
		return "generic"
	}
	// Strip the trailing day stamp to keep the kind stable across days.
	// Anchors look like `<domain>:<topic>:<YYYY-MM-DD>` or `<domain>:<topic>`.
	last := -1
	for i := len(anchor) - 1; i >= 0; i-- {
		if anchor[i] == ':' {
			last = i
			break
		}
	}
	if last == -1 {
		return anchor
	}
	suffix := anchor[last+1:]
	if isDayStamp(suffix) {
		return anchor[:last]
	}
	return anchor
}

func isDayStamp(s string) bool {
	if len(s) != 10 {
		return false
	}
	for i, r := range s {
		switch i {
		case 4, 7:
			if r != '-' {
				return false
			}
		default:
			if r < '0' || r > '9' {
				return false
			}
		}
	}
	return true
}

// buildMessageMD assembles a markdown-friendly multi-line message from
// the producer's Headline + Evidence + Interpret. Frontend can render
// raw or pass into a markdown renderer; the project uses lightweight
// markdown in chat messages.
func buildMessageMD(in domain.Insight) string {
	// Headline as bold; evidence + interpret as plain paragraphs.
	return fmt.Sprintf("**%s**\n\n%s\n\n%s", in.Headline, in.Evidence, in.Interpret)
}

// SeverityAtLeast — convenience filter used by NextAction integration to
// pick only severity ≥4 cross-insights for the "secondary action" slot.
func (c CrossInsight) SeverityAtLeast(min domain.InsightSeverity) bool {
	return severityRank(c.Severity) >= severityRank(min)
}
