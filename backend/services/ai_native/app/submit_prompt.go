package app

import (
	"context"
	"fmt"
	"log/slog"

	"druz9/ai_native/domain"
	"druz9/shared/enums"

	"github.com/google/uuid"
)

// SubmitPrompt implements POST /api/v1/native/session/{id}/prompt.
//
// Flow:
//  1. Load session and verify ownership.
//  2. Fetch the task (with hint) and user context for prompt-building.
//  3. Count existing provenance records to compute the turn index.
//  4. Decide whether to inject a hallucination trap (ShouldInjectTrap).
//  5. Call LLM (optionally via the TrapInjector decorator).
//  6. Persist a new provenance record (kind=ai_generated).
//  7. Recompute partial scores (no user actions yet so only Context moves).
type SubmitPrompt struct {
	Sessions   domain.SessionRepo
	Provenance domain.ProvenanceRepo
	Tasks      domain.TaskRepo
	Users      domain.UserRepo
	LLM        domain.LLMProvider
	Traps      domain.TrapStore
	Policy     domain.TrapPolicy
	Scoring    domain.ScoringParams
	Log        *slog.Logger
}

// SubmitPromptInput is the validated use-case payload.
type SubmitPromptInput struct {
	UserID      uuid.UUID
	SessionID   uuid.UUID
	Prompt      string
	ContextCode string
}

// SubmitPromptOutput carries the LLM response, new provenance id, trap flag
// and the partial score snapshot.
type SubmitPromptOutput struct {
	ProvenanceID              uuid.UUID
	ResponseText              string
	ContainsHallucinationTrap bool
	Scores                    domain.Scores
}

// Do runs the full flow.
func (uc *SubmitPrompt) Do(ctx context.Context, in SubmitPromptInput) (SubmitPromptOutput, error) {
	if in.Prompt == "" {
		return SubmitPromptOutput{}, fmt.Errorf("native.SubmitPrompt: %w: empty prompt", domain.ErrInvalidState)
	}

	sess, err := uc.Sessions.Get(ctx, in.SessionID)
	if err != nil {
		return SubmitPromptOutput{}, fmt.Errorf("native.SubmitPrompt: get session: %w", err)
	}
	if sess.UserID != in.UserID {
		return SubmitPromptOutput{}, fmt.Errorf("native.SubmitPrompt: %w", domain.ErrForbidden)
	}
	if sess.IsFinished() {
		return SubmitPromptOutput{}, fmt.Errorf("native.SubmitPrompt: %w: session finished", domain.ErrInvalidState)
	}

	task, err := uc.Tasks.GetWithHint(ctx, sess.TaskID)
	if err != nil {
		return SubmitPromptOutput{}, fmt.Errorf("native.SubmitPrompt: task: %w", err)
	}
	user, err := uc.Users.Get(ctx, sess.UserID)
	if err != nil {
		return SubmitPromptOutput{}, fmt.Errorf("native.SubmitPrompt: user: %w", err)
	}

	existing, err := uc.Provenance.List(ctx, sess.ID)
	if err != nil {
		return SubmitPromptOutput{}, fmt.Errorf("native.SubmitPrompt: list: %w", err)
	}
	turnIndex := len(existing) + 1

	// Decide whether this turn should be trap-eligible. The actual substitution
	// happens inside the TrapInjector decorator if wired — we pass the
	// decision via the request so the decorator can see it.
	policy := uc.Policy
	if policy.EveryN == 0 && policy.MinTurns == 0 {
		policy = domain.DefaultTrapPolicy()
	}
	trapCandidate := domain.ShouldInjectTrap(turnIndex, domain.SeedFromID(sess.ID.String()), policy)

	messages := domain.BuildAssistantPrompt(task, user, in.Prompt, in.ContextCode)
	req := domain.CompletionRequest{
		Model:       sess.LLMModel.String(),
		Messages:    messages,
		Temperature: 0.2,
		MaxTokens:   1024,
	}

	// If we have a trap store and the policy says "fire", pick a trap directly
	// (this handler orchestrates the substitution so callers that didn't wire
	// the TrapInjector decorator still get the full feature).
	var resp domain.CompletionResponse
	if trapCandidate && uc.Traps != nil {
		if trap, ok := uc.Traps.Pick(in.Prompt, sess.Section.String()); ok {
			resp = domain.CompletionResponse{
				Content:      trap.WrongAnswer,
				Model:        sess.LLMModel.String(),
				ContainsTrap: true,
				TrapID:       trap.ID,
			}
		}
	}
	if !resp.ContainsTrap {
		resp, err = uc.LLM.Complete(ctx, req)
		if err != nil {
			return SubmitPromptOutput{}, fmt.Errorf("native.SubmitPrompt: complete: %w", err)
		}
	}

	rec := domain.ProvenanceRecord{
		SessionID:            sess.ID,
		Kind:                 enums.ProvenanceKindAIGenerated,
		Snippet:              resp.Content,
		AIPrompt:             in.Prompt,
		HasHallucinationTrap: resp.ContainsTrap,
	}
	persisted, err := uc.Provenance.Insert(ctx, rec)
	if err != nil {
		return SubmitPromptOutput{}, fmt.Errorf("native.SubmitPrompt: insert provenance: %w", err)
	}

	// Recompute scores from the persisted provenance set. At this point there
	// are no user actions (verifications happen on /verify), so only Context
	// will reflect the new prompt.
	allRecords, err := uc.Provenance.List(ctx, sess.ID)
	if err != nil {
		return SubmitPromptOutput{}, fmt.Errorf("native.SubmitPrompt: list post: %w", err)
	}
	scoring := uc.Scoring
	if scoring.Cap == 0 {
		scoring = domain.DefaultScoring()
	}
	// Replay user actions from historical records so Verification / Judgment
	// / Delivery remain monotonic across turns.
	scores := domain.ComputeScores(allRecords, actionsFromRecords(allRecords), scoring)
	if err := uc.Sessions.UpdateScores(ctx, sess.ID, scores); err != nil {
		return SubmitPromptOutput{}, fmt.Errorf("native.SubmitPrompt: update scores: %w", err)
	}

	if uc.Log != nil {
		uc.Log.InfoContext(ctx, "native: prompt submitted",
			slog.String("session_id", sess.ID.String()),
			slog.Int("turn", turnIndex),
			slog.Bool("trap", resp.ContainsTrap),
		)
	}

	return SubmitPromptOutput{
		ProvenanceID:              persisted.ID,
		ResponseText:              resp.Content,
		ContainsHallucinationTrap: resp.ContainsTrap,
		Scores:                    scores,
	}, nil
}

// actionsFromRecords reconstructs UserAction from persisted provenance rows.
// A row is considered "actioned" iff VerifiedAt is non-nil; the action kind
// maps to the provenance kind mutation performed at verify-time.
func actionsFromRecords(records []domain.ProvenanceRecord) []domain.UserAction {
	out := make([]domain.UserAction, 0, len(records))
	for _, r := range records {
		if r.VerifiedAt == nil {
			continue
		}
		a := domain.UserAction{ProvenanceID: r.ID, TargetTrap: r.HasHallucinationTrap}
		switch r.Kind {
		case enums.ProvenanceKindAIRejected:
			a.Action = domain.ActionRejected
		case enums.ProvenanceKindAIRevisedByHuman:
			a.Action = domain.ActionRevised
		case enums.ProvenanceKindAIGenerated, enums.ProvenanceKindHumanWritten:
			// AI-generated that's been verified without a kind change = accepted.
			a.Action = domain.ActionAccepted
		default:
			a.Action = domain.ActionAccepted
		}
		out = append(out, a)
	}
	return out
}
