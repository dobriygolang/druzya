package intelligence

import (
	"context"
	"fmt"
	"log/slog"
	"strings"
	"sync"
	"time"

	honeDomain "druz9/hone/domain"
	intelApp "druz9/intelligence/app"
	intelDomain "druz9/intelligence/domain"
	intelInfra "druz9/intelligence/infra"
	miDomain "druz9/mock_interview/domain"

	"github.com/google/uuid"
)

// newMockMemoryHook builds the adapter that mock_interview's
// orchestrator uses to write `mock_pipeline_finished` episodes. Same
// pattern as newIntelligenceMemoryHook for hone — the mock_interview
// service stays decoupled from intelligence/domain and only knows the
// narrow miDomain.MemoryHook interface.
func newMockMemoryHook(m *intelApp.Memory, log *slog.Logger) miDomain.MemoryHook {
	return &mockMemoryHook{memory: m, log: log}
}

type mockMemoryHook struct {
	memory *intelApp.Memory
	log    *slog.Logger
}

func (h *mockMemoryHook) OnPipelineFinished(
	ctx context.Context,
	userID uuid.UUID,
	pipelineID uuid.UUID,
	verdict miDomain.PipelineVerdict,
	totalScore *float32,
	stages []miDomain.PipelineStage,
	occurredAt time.Time,
) {
	parts := []string{fmt.Sprintf("verdict=%s", string(verdict))}
	if totalScore != nil {
		parts = append(parts, fmt.Sprintf("total_score=%.0f", *totalScore))
	}
	stagesPayload := make([]map[string]any, 0, len(stages))
	for _, s := range stages {
		row := map[string]any{"stage_kind": string(s.StageKind)}
		if s.Verdict != nil {
			row["verdict"] = string(*s.Verdict)
		}
		if s.Score != nil {
			row["score"] = *s.Score
		}
		stagesPayload = append(stagesPayload, row)
	}
	summary := strings.Join(parts, " · ")
	h.memory.AppendAsync(ctx, intelApp.AppendInput{
		UserID:  userID,
		Kind:    intelDomain.EpisodeMockPipelineFinished,
		Summary: summary,
		Payload: map[string]any{
			"pipeline_id": pipelineID.String(),
			"stages":      stagesPayload,
		},
		OccurredAt: occurredAt,
	})
}

var _ miDomain.MemoryHook = (*mockMemoryHook)(nil)

// memoryHook implements hone/domain.MemoryHook — узкий side-effect channel
// в Coach memory. Hone use cases дёргают (опционально через nil-check).
// Имплементация = thin shim over intelApp.Memory.AppendAsync.
type memoryHook struct {
	memory          *intelApp.Memory
	log             *slog.Logger
	mu              sync.Mutex
	lastDailyNoteAt map[string]time.Time
}

func newIntelligenceMemoryHook(m *intelApp.Memory, log *slog.Logger) honeDomain.MemoryHook {
	return &memoryHook{memory: m, log: log, lastDailyNoteAt: make(map[string]time.Time)}
}

func (h *memoryHook) OnReflectionAdded(ctx context.Context, uid uuid.UUID, reflection, planItemID string, sec int, occ time.Time) {
	if reflection == "" {
		return
	}
	h.memory.AppendAsync(ctx, intelApp.AppendInput{
		UserID: uid, Kind: intelDomain.EpisodeReflectionAdded, Summary: reflection,
		Payload:    map[string]any{"plan_item_id": planItemID, "seconds": sec},
		OccurredAt: occ,
	})
}
func (h *memoryHook) OnStandupRecorded(ctx context.Context, uid uuid.UUID, y, t, b string, occ time.Time) {
	parts := []string{}
	if y != "" {
		parts = append(parts, "Yesterday: "+y)
	}
	if t != "" {
		parts = append(parts, "Today: "+t)
	}
	if b != "" {
		parts = append(parts, "Blockers: "+b)
	}
	if len(parts) == 0 {
		return
	}
	summary := strings.Join(parts, " || ")
	h.memory.AppendAsync(ctx, intelApp.AppendInput{
		UserID: uid, Kind: intelDomain.EpisodeStandupRecorded, Summary: summary,
		Payload:    map[string]any{"yesterday": y, "today": t, "blockers": b},
		OccurredAt: occ,
	})
}
func (h *memoryHook) OnPlanSkipped(ctx context.Context, uid uuid.UUID, title, skill string, occ time.Time) {
	h.memory.AppendAsync(ctx, intelApp.AppendInput{
		UserID: uid, Kind: intelDomain.EpisodePlanSkipped, Summary: title,
		Payload:    map[string]any{"skill_key": skill},
		OccurredAt: occ,
	})
}
func (h *memoryHook) OnPlanCompleted(ctx context.Context, uid uuid.UUID, title, skill string, occ time.Time) {
	h.memory.AppendAsync(ctx, intelApp.AppendInput{
		UserID: uid, Kind: intelDomain.EpisodePlanCompleted, Summary: title,
		Payload:    map[string]any{"skill_key": skill},
		OccurredAt: occ,
	})
}
func (h *memoryHook) OnNoteCreated(ctx context.Context, uid uuid.UUID, noteID uuid.UUID, title, body200 string, occ time.Time) {
	summary := title
	if body200 != "" {
		summary = title + ": " + body200
	}
	h.memory.AppendAsync(ctx, intelApp.AppendInput{
		UserID: uid, Kind: intelDomain.EpisodeNoteCreated, Summary: summary,
		Payload:    map[string]any{"note_id": noteID.String()},
		OccurredAt: occ,
	})
}
func (h *memoryHook) OnDailyNoteSaved(ctx context.Context, uid uuid.UUID, noteID uuid.UUID, title, body600 string, occ time.Time) {
	summary, payload, ok := intelInfra.DailyNoteMemorySnapshot(noteID, title, body600)
	if !ok {
		return
	}
	key := uid.String() + ":" + noteID.String()
	h.mu.Lock()
	last := h.lastDailyNoteAt[key]
	if !last.IsZero() && occ.Sub(last) < 15*time.Minute {
		h.mu.Unlock()
		return
	}
	h.lastDailyNoteAt[key] = occ
	h.mu.Unlock()

	h.memory.AppendAsync(ctx, intelApp.AppendInput{
		UserID:     uid,
		Kind:       intelDomain.EpisodeNoteCreated,
		Summary:    summary,
		Payload:    payload,
		OccurredAt: occ,
	})
}
func (h *memoryHook) OnFocusSessionDone(ctx context.Context, uid uuid.UUID, pinned string, sec int, planItemID string, pomodoros int, occ time.Time) {
	if sec < 5*60 {
		return // короче 5 минут — не «сессия», skip
	}
	summary := pinned
	if summary == "" {
		summary = "Focus block"
	}
	h.memory.AppendAsync(ctx, intelApp.AppendInput{
		UserID: uid, Kind: intelDomain.EpisodeFocusSessionDone, Summary: summary,
		Payload:    map[string]any{"seconds": sec, "plan_item_id": planItemID, "pomodoros": pomodoros},
		OccurredAt: occ,
	})
}

// Compile-time guard.
var _ honeDomain.MemoryHook = (*memoryHook)(nil)

// ─── External-activity memory appender ────────────────────────────────────

// NewExternalActivityAppender returns a tiny shim consumed by hone's
// CoachEpisodeAppender adapter. Это узкий interface (single method
// AppendExternal) чтобы hone wiring не импортил intelligence/app.
func NewExternalActivityAppender(m *intelApp.Memory) ExternalAppender {
	return &externalAppender{memory: m}
}

// ExternalAppender — exported interface for cross-package use.
type ExternalAppender interface {
	AppendExternal(ctx context.Context, userID uuid.UUID, summary string, payload map[string]any, occurredAt time.Time)
}

type externalAppender struct {
	memory *intelApp.Memory
}

func (a *externalAppender) AppendExternal(
	ctx context.Context,
	userID uuid.UUID,
	summary string,
	payload map[string]any,
	occurredAt time.Time,
) {
	if a.memory == nil {
		return
	}
	a.memory.AppendAsync(ctx, intelApp.AppendInput{
		UserID:     userID,
		Kind:       intelDomain.EpisodeExternalActivity,
		Summary:    summary,
		Payload:    payload,
		OccurredAt: occurredAt,
	})
}
