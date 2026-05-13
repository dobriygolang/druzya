//go:generate mockgen -package app -destination ingest_session_transcript_mock_test.go -source ingest_session_transcript.go MemoryWriter
// ingest_session_transcript.go — F10 Cue session ingestion UC.
//
// Cue (stealth tray-copilot) end-of-session flush'ит transcript + per-stage
// log. UC:
//
//  1. validates input (non-empty stages OR company OR transcript — at least
//     one signal),
//  2. inserts a cue_sessions row,
//  3. fire-and-forget appends a coach_episodes row (kind=cue_session)
//     через MemoryWriter port — DailyBrief / Recall видят session.
//
// MemoryWriter optional — nil-safe (если memory not wired, UC всё равно
// успешно создаёт cue_sessions row).
package app

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"druz9/intelligence/domain"

	"github.com/google/uuid"
)

// MemoryWriter — узкая port-абстракция над Memory.AppendAsync. Вынесена
// чтобы UC не зависел от конкретного Memory struct'а (тестируемость).
type MemoryWriter interface {
	AppendAsync(ctx context.Context, in AppendInput)
}

// AtlasStruggleMarker — port для X5 cross-product handoff. UC дергает при
// обнаружении struggle-сигналов (low self_rating на stage'е) чтобы web
// AtlasPage подсветила соответствующий node на следующем визите.
//
// Кастомный интерфейс (не *app.MarkAtlasStruggle напрямую) — нужно чтобы
// тесты могли подложить fake без сетапа repo, и чтобы UC не зависел от
// конкретного app-typа в том же пакете (cyclical compile во время codegen).
type AtlasStruggleMarker interface {
	Do(ctx context.Context, in MarkAtlasStruggleInput) error
}

// IngestSessionTranscript UC.
type IngestSessionTranscript struct {
	Repo   domain.InterviewSessionRepo
	Memory MemoryWriter // optional, nil-safe
	Now    func() time.Time
	// StruggleMark — X5 (Phase J P2). Optional. When non-nil, the UC scans
	// in.Stages and emits a MarkAtlasStruggle for each stage with
	// self_rating ≤2 (the calibrated "low rating" threshold matches the
	// product spec). Idempotent — repeated ingestion writes latest.
	StruggleMark AtlasStruggleMarker
}

// IngestInterviewSessionInput — wire-shape для UC.
type IngestInterviewSessionInput struct {
	UserID        uuid.UUID
	Company       string
	Persona       string
	Stages        []domain.InterviewStage
	AISummary     string
	RawTranscript string
	CompletedAt   time.Time // zero → server time
}

// Do persists the session and emits a coach memory episode.
func (uc *IngestSessionTranscript) Do(ctx context.Context, in IngestInterviewSessionInput) (domain.InterviewSession, error) {
	if in.UserID == uuid.Nil {
		return domain.InterviewSession{}, fmt.Errorf("intelligence.IngestSessionTranscript: %w: zero user_id", domain.ErrInvalidInput)
	}
	// At least one signal — иначе это noise (пустая ingestion ничему не учит).
	if strings.TrimSpace(in.Company) == "" &&
		strings.TrimSpace(in.RawTranscript) == "" &&
		len(in.Stages) == 0 {
		return domain.InterviewSession{}, fmt.Errorf("intelligence.IngestSessionTranscript: %w: at least one of company/transcript/stages required", domain.ErrInvalidInput)
	}
	for i, s := range in.Stages {
		if strings.TrimSpace(s.Stage) == "" {
			return domain.InterviewSession{}, fmt.Errorf("intelligence.IngestSessionTranscript: %w: stages[%d].stage empty", domain.ErrInvalidInput, i)
		}
		if s.SelfRating < 0 || s.SelfRating > 5 {
			return domain.InterviewSession{}, fmt.Errorf("intelligence.IngestSessionTranscript: %w: stages[%d].self_rating must be 0..5", domain.ErrInvalidInput, i)
		}
	}

	completedAt := in.CompletedAt
	if completedAt.IsZero() {
		completedAt = uc.now().UTC()
	}
	row := domain.InterviewSession{
		UserID:        in.UserID,
		Company:       strings.TrimSpace(in.Company),
		Persona:       strings.TrimSpace(in.Persona),
		Stages:        in.Stages,
		AISummary:     strings.TrimSpace(in.AISummary),
		RawTranscript: in.RawTranscript,
		CompletedAt:   completedAt,
	}
	saved, err := uc.Repo.Insert(ctx, row)
	if err != nil {
		return domain.InterviewSession{}, fmt.Errorf("intelligence.IngestSessionTranscript insert: %w", err)
	}

	// Fire-and-forget memory append. Failure won't roll back insert — coach
	// memory is opportunistic, the durable record lives in cue_sessions.
	if uc.Memory != nil {
		uc.Memory.AppendAsync(ctx, AppendInput{
			UserID:     in.UserID,
			Kind:       domain.EpisodeCueSession,
			Summary:    cueSessionSummary(saved),
			Payload:    cueSessionPayload(saved),
			OccurredAt: completedAt,
		})
	}
	// X5 cross-product handoff: low-rated stages signal "struggle". Web
	// AtlasPage reads via ListAtlasStruggles and highlights matched nodes
	// (subtle b/w indicator, see CLAUDE.md). Stage names ('algo', 'sysdesign')
	// map to canonical atlas anchor ids — frontend Atlas matches by prefix
	// (e.g. `stage:sysdesign` lights up everything under system-design cluster).
	if uc.StruggleMark != nil {
		for _, st := range saved.Stages {
			if st.SelfRating <= 0 || st.SelfRating > 2 {
				// SelfRating 0 = unrated, > 2 = okay. Only 1-2 = struggle signal.
				continue
			}
			confidence := 0.9
			if st.SelfRating == 2 {
				confidence = 0.7
			}
			note := strings.TrimSpace(st.Notes)
			if note == "" {
				note = fmt.Sprintf("cue session @ %s — rated %d/5", saved.Company, st.SelfRating)
			}
			// Best-effort. Ingestion succeeds even when struggle write fails.
			_ = uc.StruggleMark.Do(ctx, MarkAtlasStruggleInput{
				UserID:      in.UserID,
				AtlasNodeID: "stage:" + strings.ToLower(strings.TrimSpace(st.Stage)),
				Source:      string(domain.AtlasStruggleSourceCueSession),
				Confidence:  confidence,
				Note:        note,
			})
		}
	}
	return saved, nil
}

func (uc *IngestSessionTranscript) now() time.Time {
	if uc.Now != nil {
		return uc.Now()
	}
	return time.Now().UTC()
}

// cueSessionSummary picks the best human-readable одностроичный summary.
func cueSessionSummary(s domain.InterviewSession) string {
	if ai := strings.TrimSpace(s.AISummary); ai != "" {
		return ai
	}
	parts := []string{}
	if s.Company != "" {
		parts = append(parts, "Cue session @ "+s.Company)
	} else {
		parts = append(parts, "Cue session")
	}
	if s.Persona != "" {
		parts = append(parts, "persona="+s.Persona)
	}
	if len(s.Stages) > 0 {
		stageNames := make([]string, 0, len(s.Stages))
		for _, st := range s.Stages {
			stageNames = append(stageNames, st.Stage)
		}
		parts = append(parts, "stages=["+strings.Join(stageNames, ",")+"]")
	}
	return strings.Join(parts, " · ")
}

// cueSessionPayload — JSONB payload для coach_episodes row.
func cueSessionPayload(s domain.InterviewSession) map[string]any {
	stages := make([]map[string]any, 0, len(s.Stages))
	for _, st := range s.Stages {
		stages = append(stages, map[string]any{
			"stage":       st.Stage,
			"self_rating": st.SelfRating,
			"notes":       st.Notes,
		})
	}
	payload := map[string]any{
		"source":         "cue_desktop",
		"cue_session_id": s.ID.String(),
		"company":        s.Company,
		"persona":        s.Persona,
		"stages":         stages,
		"ai_summary":     s.AISummary,
		"has_transcript": s.RawTranscript != "",
		"completed_at":   s.CompletedAt.UTC().Format(time.RFC3339),
	}
	return payload
}

// MarshalPayloadJSON — small helper for callers (e.g. tests) needing
// the canonical JSON shape. Exported alongside payload-builder для
// debug + admin endpoints.
func MarshalPayloadJSON(s domain.InterviewSession) ([]byte, error) {
	return json.Marshal(cueSessionPayload(s))
}
