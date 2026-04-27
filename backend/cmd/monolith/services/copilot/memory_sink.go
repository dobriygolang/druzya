package copilot

import (
	"context"
	"fmt"
	"strings"
	"time"

	copilotDomain "druz9/copilot/domain"
	intelApp "druz9/intelligence/app"
	intelDomain "druz9/intelligence/domain"

	"github.com/google/uuid"
)

// memorySink adapts compact Cue memory to the shared coach_episodes store.
// It belongs in monolith wiring because it bridges copilot and intelligence.
type memorySink struct {
	memory *intelApp.Memory
	now    func() time.Time
}

func newMemorySink(memory *intelApp.Memory, now func() time.Time) *memorySink {
	if memory == nil {
		panic("copilot.newMemorySink: intelligence memory is required")
	}
	if now == nil {
		panic("copilot.newMemorySink: Now is required")
	}
	return &memorySink{memory: memory, now: now}
}

func (s *memorySink) AppendConversationMemory(
	ctx context.Context,
	userID uuid.UUID,
	conversationID uuid.UUID,
	memory copilotDomain.ConversationMemory,
) error {
	occurredAt := s.now().UTC()
	for _, turn := range memory.Turns {
		if turn.Timestamp.After(occurredAt) {
			continue
		}
		if turn.Timestamp.After(occurredAt.Add(-365 * 24 * time.Hour)) {
			occurredAt = turn.Timestamp.UTC()
		}
	}
	if err := s.memory.Append(ctx, intelApp.AppendInput{
		UserID:     userID,
		Kind:       intelDomain.EpisodeCueConversationMemory,
		Summary:    cueMemorySummary(memory),
		Payload:    cueMemoryPayload(conversationID, memory),
		OccurredAt: occurredAt,
	}); err != nil {
		return fmt.Errorf("memory sink: append conversation memory: %w", err)
	}
	return nil
}

func cueMemorySummary(memory copilotDomain.ConversationMemory) string {
	if s := strings.TrimSpace(memory.RollingSummary); s != "" {
		return s
	}
	for i := len(memory.Turns) - 1; i >= 0; i-- {
		t := memory.Turns[i]
		q := strings.TrimSpace(t.Question)
		a := strings.TrimSpace(t.Answer)
		if q != "" && a != "" {
			return "Q: " + q + " A: " + a
		}
		if q != "" {
			return "Q: " + q
		}
	}
	return "Cue conversation memory"
}

func cueMemoryPayload(conversationID uuid.UUID, memory copilotDomain.ConversationMemory) map[string]any {
	turns := make([]map[string]any, 0, len(memory.Turns))
	for _, t := range memory.Turns {
		turns = append(turns, map[string]any{
			"question":       t.Question,
			"answer":         t.Answer,
			"has_screenshot": t.HasScreenshot,
			"timestamp":      t.Timestamp.UTC().Format(time.RFC3339Nano),
			"model":          t.Model,
		})
	}
	embeddings := make([]map[string]any, 0, len(memory.Embeddings))
	for _, e := range memory.Embeddings {
		embeddings = append(embeddings, map[string]any{
			"term":   e.Term,
			"weight": e.Weight,
		})
	}
	return map[string]any{
		"source":             "cue_desktop",
		"conversation_id":    conversationID.String(),
		"turns":              turns,
		"screenshot_summary": memory.ScreenshotSummary,
		"topics":             memory.Topics,
		"outcome":            string(memory.Outcome),
		"rolling_summary":    memory.RollingSummary,
		"embeddings":         embeddings,
	}
}
