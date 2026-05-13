// user_context.go — cross-product context contract.
//
// The Cue copilot's unique moat vs Cluely / Final Round AI: when the user
// fires a suggestion mid-interview, the backend already knows their
// learning identity (active goal, recent Coach memory, weekly activity,
// skill-radar gaps, atlas resources). The suggestion comes back
// personalised — "remember last week Coach said start with bottleneck
// analysis" — instead of the generic STAR template a cold-start
// competitor would produce.
//
// This file declares the NARROW domain port the copilot use cases
// consume. The actual fetch lives in the intelligence bounded context
// (services/intelligence/app/GetUserContext). The adapter that bridges
// the two services lives in cmd/monolith/services/copilot/ (matching
// the existing memorySink pattern — copilot doesn't import intelligence
// directly).
package domain

import (
	"context"
	"strings"
	"time"

	"github.com/google/uuid"
)

// UserContextProvider is the narrow port the copilot use cases (Suggest,
// Analyze) consume to fetch cross-product context. nil-safe at the call
// site — if the provider is unwired or fails, suggestion proceeds
// without context (degradation is silent, not a 500).
type UserContextProvider interface {
	// LoadUserContext returns the bundle for the given user. Errors are
	// expected to be RARE: the underlying intelligence UC swallows
	// sub-reader failures internally. A non-nil error indicates a hard
	// problem (zero user_id, infra outage) — callers should log and
	// fall back to empty context, NOT fail the suggestion.
	LoadUserContext(ctx context.Context, userID uuid.UUID) (UserContext, error)
}

// UserContext is the domain-side projection of the intelligence bundle.
// Mirrors druz9.v1.UserContext shape but stays free of proto imports so
// the copilot domain stays standalone.
type UserContext struct {
	ActiveGoal        *UserContextGoal
	RecentMemory      []UserContextMemoryEntry
	Activity          UserContextActivity
	Radar             UserContextRadar
	RelevantResources []UserContextResource
}

// IsEmpty reports whether the bundle has zero usable signals. Caller
// can skip prompt-injection entirely (saves tokens).
func (c UserContext) IsEmpty() bool {
	if c.ActiveGoal != nil {
		return false
	}
	if len(c.RecentMemory) > 0 {
		return false
	}
	if c.Activity.Last7dCount > 0 || c.Activity.Last30dCount > 0 {
		return false
	}
	if len(c.Radar.Axes) > 0 {
		return false
	}
	if len(c.RelevantResources) > 0 {
		return false
	}
	return true
}

// UserContextGoal — minimal goal projection. Fields mirror PrimaryGoal.
type UserContextGoal struct {
	Kind          string
	TargetCompany string
	TargetLevel   string
	TargetText    string
	// TargetDate may be empty ("") if user didn't set a deadline.
	TargetDate string
}

// UserContextMemoryEntry — single coach episode with pre-computed hours_ago.
type UserContextMemoryEntry struct {
	Kind       string
	Summary    string
	OccurredAt time.Time
	HoursAgo   int
}

// UserContextActivity — rolled-up resource_log counts.
type UserContextActivity struct {
	Last7dCount  int
	Last30dCount int
	TopKinds     []string
}

// UserContextRadar — compact skill-radar snapshot.
type UserContextRadar struct {
	Rubric        string
	Axes          []string
	AxisScores    []float64
	WeakestAxis   string
	StrongestAxis string
}

// UserContextResource — atlas resource ref (book / course / paper).
type UserContextResource struct {
	ID    string
	Title string
	URL   string
	Kind  string
}

// ContextPersona selects which slices of the bundle to include in the
// formatted prompt block. Different personas care about different
// signals:
//   - interview: emphasise goal + skill radar (recent struggle areas)
//   - meeting: emphasise recent activity + relevant resources
//   - casual: minimal context (privacy — full bundle would over-share)
type ContextPersona string

const (
	ContextPersonaInterview ContextPersona = "interview"
	ContextPersonaMeeting   ContextPersona = "meeting"
	ContextPersonaCasual    ContextPersona = "casual"
)

// FormatContextPrompt assembles the system-message body Cue injects into
// the LLM call. Returns an empty string when the bundle has nothing
// useful (so the caller can skip the system message entirely instead of
// emitting an empty block — saves a few tokens and reduces LLM noise).
//
// Token budget: target ~400-500 tokens for the formatted output. Each
// section is bounded:
//   - goal: 1 line
//   - memory: up to 5 entries × 1 line
//   - activity: 1 line
//   - radar: 2 lines (weakest + strongest)
//   - resources: up to 3 entries × 1 line
//
// Persona slices applied per CONTRACT above.
func FormatContextPrompt(c UserContext, persona ContextPersona) string {
	if c.IsEmpty() {
		return ""
	}
	if persona == "" {
		persona = ContextPersonaMeeting
	}

	var b strings.Builder
	b.WriteString("USER CONTEXT (from druz9 learning history — use to personalise):\n")

	// ── Goal ── interview emphasises this most.
	if c.ActiveGoal != nil {
		b.WriteString("Goal: ")
		b.WriteString(formatGoalLine(*c.ActiveGoal))
		b.WriteByte('\n')
	}

	// ── Memory ── all personas, but interview gets fewer (more goal-focused).
	memLimit := 5
	if persona == ContextPersonaInterview {
		memLimit = 4
	}
	if persona == ContextPersonaCasual {
		memLimit = 2
	}
	if len(c.RecentMemory) > 0 {
		b.WriteString("Recent memory:\n")
		count := 0
		for _, m := range c.RecentMemory {
			if count >= memLimit {
				break
			}
			line := strings.TrimSpace(m.Summary)
			if line == "" {
				continue
			}
			b.WriteString("- ")
			b.WriteString(formatRelativeAge(m.HoursAgo))
			b.WriteString(" (")
			b.WriteString(m.Kind)
			b.WriteString("): ")
			b.WriteString(truncatePromptLine(line, 160))
			b.WriteByte('\n')
			count++
		}
	}

	// ── Activity ── meeting persona emphasises this most.
	if persona != ContextPersonaCasual {
		if c.Activity.Last7dCount > 0 || c.Activity.Last30dCount > 0 {
			b.WriteString("Activity: ")
			b.WriteString(formatActivityLine(c.Activity))
			b.WriteByte('\n')
		}
	}

	// ── Radar ── interview persona emphasises weakest axis (next-mock prep).
	if len(c.Radar.Axes) > 0 && persona != ContextPersonaCasual {
		weak := strings.TrimSpace(c.Radar.WeakestAxis)
		strong := strings.TrimSpace(c.Radar.StrongestAxis)
		if weak != "" || strong != "" {
			b.WriteString("Skill radar: ")
			parts := make([]string, 0, 2)
			if weak != "" {
				parts = append(parts, "weakest in "+weak)
			}
			if strong != "" {
				parts = append(parts, "strongest in "+strong)
			}
			b.WriteString(strings.Join(parts, ", "))
			b.WriteString(" (rubric: ")
			b.WriteString(c.Radar.Rubric)
			b.WriteString(")\n")
		}
	}

	// ── Resources ── meeting persona emphasises (links to read for follow-up).
	resLimit := 3
	if persona == ContextPersonaInterview {
		resLimit = 2
	}
	if persona == ContextPersonaCasual {
		resLimit = 0
	}
	if resLimit > 0 && len(c.RelevantResources) > 0 {
		b.WriteString("Relevant resources:\n")
		count := 0
		for _, r := range c.RelevantResources {
			if count >= resLimit {
				break
			}
			t := strings.TrimSpace(r.Title)
			if t == "" {
				continue
			}
			b.WriteString("- ")
			b.WriteString(truncatePromptLine(t, 80))
			if r.Kind != "" {
				b.WriteString(" (")
				b.WriteString(r.Kind)
				b.WriteString(")")
			}
			b.WriteByte('\n')
			count++
		}
	}

	// Closing guidance — keeps the LLM from over-quoting the context block.
	b.WriteString("Use this context to personalise the answer when relevant. " +
		"Do NOT quote it verbatim or treat it as the user's literal question.")
	return b.String()
}

// ── Helpers ──────────────────────────────────────────────────────────────

func formatGoalLine(g UserContextGoal) string {
	parts := make([]string, 0, 4)
	if g.TargetCompany != "" {
		parts = append(parts, g.TargetCompany)
	}
	if g.TargetLevel != "" {
		parts = append(parts, g.TargetLevel)
	}
	if g.TargetText != "" {
		parts = append(parts, g.TargetText)
	}
	if g.TargetDate != "" {
		parts = append(parts, "by "+g.TargetDate)
	}
	if len(parts) == 0 {
		parts = append(parts, g.Kind)
	}
	return strings.Join(parts, " · ")
}

func formatActivityLine(a UserContextActivity) string {
	var b strings.Builder
	b.WriteString(itoa(a.Last7dCount))
	b.WriteString(" events 7d / ")
	b.WriteString(itoa(a.Last30dCount))
	b.WriteString(" events 30d")
	if len(a.TopKinds) > 0 {
		b.WriteString(". Top: ")
		b.WriteString(strings.Join(topN(a.TopKinds, 3), ", "))
	}
	return b.String()
}

func formatRelativeAge(hours int) string {
	if hours < 0 {
		hours = 0
	}
	if hours < 1 {
		return "just now"
	}
	if hours < 24 {
		return itoa(hours) + "h ago"
	}
	days := hours / 24
	if days < 14 {
		return itoa(days) + "d ago"
	}
	weeks := days / 7
	return itoa(weeks) + "w ago"
}

func truncatePromptLine(s string, maxRunes int) string {
	s = strings.TrimSpace(s)
	if s == "" {
		return s
	}
	runes := []rune(s)
	if len(runes) <= maxRunes {
		return s
	}
	return string(runes[:maxRunes]) + "…"
}

func topN(in []string, n int) []string {
	if len(in) <= n {
		return in
	}
	return in[:n]
}

// itoa is a tiny helper to avoid pulling strconv into this file's import
// list (strings + time + uuid + context are the only imports we want).
func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	neg := n < 0
	if neg {
		n = -n
	}
	var buf [20]byte
	i := len(buf)
	for n > 0 {
		i--
		buf[i] = byte('0' + n%10)
		n /= 10
	}
	if neg {
		i--
		buf[i] = '-'
	}
	return string(buf[i:])
}
