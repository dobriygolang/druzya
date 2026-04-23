package app

import (
	"context"
	"fmt"
	"time"

	"druz9/arena/domain"
	"druz9/shared/enums"

	"github.com/google/uuid"
)

// StartPractice creates an instant single-player match against a built-in AI
// opponent. There is no queue / ready-check — the match is created with
// status=active immediately so the caller can navigate straight to
// /arena/match/:id and start submitting code.
//
// The "AI opponent" is virtual: we persist a single arena_participants row
// for the human user; the AI side is rendered client-side from the response
// payload (see `OpponentLabel` below). This avoids fabricating a fake user
// row in the users table and keeps the FK constraints honest.
//
// The bible (§4.2 — Practice mode) explicitly allows section/difficulty to
// be chosen by the user; we honour that here. Difficulty is picked off the
// caller's ELO band, same as the regular matchmaker.
type StartPractice struct {
	Matches domain.MatchRepo
	Tasks   domain.TaskRepo
	Clock   domain.Clock
}

// StartPracticeInput carries the request shape.
type StartPracticeInput struct {
	UserID      uuid.UUID
	Elo         int
	Section     enums.Section
	NeuralModel string // "random" | "llama3" | "claude" | "gpt4" — informational only.
}

// StartPracticeOutput is the API response.
type StartPracticeOutput struct {
	MatchID       uuid.UUID
	OpponentLabel string // human-readable name of the AI bot, for the client.
	Status        enums.MatchStatus
	StartedAt     time.Time
}

// Do creates the practice match and returns its id.
func (uc *StartPractice) Do(ctx context.Context, in StartPracticeInput) (StartPracticeOutput, error) {
	if !in.Section.IsValid() {
		return StartPracticeOutput{}, fmt.Errorf("arena.StartPractice: invalid section")
	}
	clk := uc.Clock
	if clk == nil {
		clk = domain.RealClock{}
	}
	now := clk.Now()
	diff := domain.DifficultyForEloBand(in.Elo)
	task, err := uc.Tasks.PickBySectionDifficulty(ctx, in.Section, diff)
	if err != nil {
		return StartPracticeOutput{}, fmt.Errorf("arena.StartPractice: pick task: %w", err)
	}
	started := now
	m := domain.Match{
		TaskID:      task.ID,
		TaskVersion: task.Version,
		Section:     in.Section,
		Mode:        enums.ArenaModeSolo1v1,
		Status:      enums.MatchStatusActive,
		StartedAt:   &started,
	}
	parts := []domain.Participant{
		{UserID: in.UserID, Team: 0, EloBefore: in.Elo},
	}
	created, err := uc.Matches.CreateMatch(ctx, m, parts)
	if err != nil {
		return StartPracticeOutput{}, fmt.Errorf("arena.StartPractice: persist: %w", err)
	}
	return StartPracticeOutput{
		MatchID:       created.ID,
		OpponentLabel: opponentLabelFor(in.NeuralModel),
		Status:        enums.MatchStatusActive,
		StartedAt:     started,
	}, nil
}

// opponentLabelFor maps the neural-model hint to a friendly opponent name.
// Unknown / empty inputs degrade to a generic "AI bot" label. This is the
// only place where the model name leaks into a user-visible string, so the
// frontend stays free of model-name hardcoding.
func opponentLabelFor(model string) string {
	switch model {
	case "llama3":
		return "Llama 3 bot"
	case "claude":
		return "Sonnet 4.5 bot"
	case "gpt4":
		return "GPT-4o bot"
	case "random":
		return "Random LLM bot"
	default:
		return "AI bot"
	}
}
