package domain

import (
	"context"

	"github.com/google/uuid"
)

// LeaderboardEntry is a single row in the fairness-watermarked leaderboard.
// "Fairness watermark": only pipelines run with ai_assist=false count, so
// the ranking is a meaningful signal of unaided performance.
type LeaderboardEntry struct {
	UserID            uuid.UUID
	DisplayName       string
	AvatarURL         string
	PipelinesFinished int
	PipelinesPassed   int
	AvgScore          float32 // 0..100, averaged over finished pipelines with non-null total_score
}

// LeaderboardRepo computes the leaderboard view directly from
// mock_pipelines + users. companyID nil ⇢ global (across companies).
type LeaderboardRepo interface {
	Top(ctx context.Context, companyID *uuid.UUID, limit int) ([]LeaderboardEntry, error)
}

// FairnessWatermark — typed enum of values returned in the
// `fairness_watermark` field of the leaderboard envelope. The frontend
// pins this to a literal-union of the same shape; bumping a value here
// requires a corresponding frontend type bump.
type FairnessWatermark string

const (
	// FairnessAIAssistOffOnly — the leaderboard rows reflect only
	// pipelines run with ai_assist=false. This is currently the only
	// supported watermark.
	FairnessAIAssistOffOnly FairnessWatermark = "ai_assist_off_only"
)
