// Package domain contains typed domain events published through the EventBus.
// Domains must not import each other — communication goes only through these events.
package domain

import (
	"time"

	"druz9/shared/enums"

	"github.com/google/uuid"
)

// Event is the marker interface. Every event must return a stable topic name.
type Event interface {
	Topic() string
	OccurredAt() time.Time
}

type base struct {
	At time.Time `json:"at"`
}

func (b base) OccurredAt() time.Time { return b.At }

// ─────────────────────────────────────────────────────────────────────────
// Auth
// ─────────────────────────────────────────────────────────────────────────

type UserRegistered struct {
	base
	UserID   uuid.UUID          `json:"user_id"`
	Username string             `json:"username"`
	Email    string             `json:"email,omitempty"`
	Provider enums.AuthProvider `json:"provider"`
}

func (UserRegistered) Topic() string { return "auth.UserRegistered" }

type UserLoggedIn struct {
	base
	UserID   uuid.UUID          `json:"user_id"`
	Provider enums.AuthProvider `json:"provider"`
}

func (UserLoggedIn) Topic() string { return "auth.UserLoggedIn" }

// ─────────────────────────────────────────────────────────────────────────
// Arena
// ─────────────────────────────────────────────────────────────────────────

type MatchStarted struct {
	base
	MatchID uuid.UUID     `json:"match_id"`
	Section enums.Section `json:"section"`
	Players []uuid.UUID   `json:"players"`
	TaskID  uuid.UUID     `json:"task_id"`
	TaskVer int           `json:"task_version"`
}

func (MatchStarted) Topic() string { return "arena.MatchStarted" }

type MatchCompleted struct {
	base
	MatchID    uuid.UUID         `json:"match_id"`
	Section    enums.Section     `json:"section"`
	WinnerID   uuid.UUID         `json:"winner_id"`
	LoserIDs   []uuid.UUID       `json:"loser_ids"`
	EloDeltas  map[uuid.UUID]int `json:"elo_deltas"`
	DurationMs int64             `json:"duration_ms"`
}

func (MatchCompleted) Topic() string { return "arena.MatchCompleted" }

type MatchCancelled struct {
	base
	MatchID uuid.UUID `json:"match_id"`
	Reason  string    `json:"reason"`
}

func (MatchCancelled) Topic() string { return "arena.MatchCancelled" }

type AnticheatSignalRaised struct {
	base
	UserID   uuid.UUID                 `json:"user_id"`
	MatchID  *uuid.UUID                `json:"match_id,omitempty"`
	Type     enums.AnticheatSignalType `json:"type"`
	Severity enums.SeverityLevel       `json:"severity"`
	Metadata map[string]any            `json:"metadata,omitempty"`
}

func (AnticheatSignalRaised) Topic() string { return "arena.AnticheatSignalRaised" }

// ─────────────────────────────────────────────────────────────────────────
// AI Mock
// ─────────────────────────────────────────────────────────────────────────

type MockSessionCreated struct {
	base
	SessionID uuid.UUID     `json:"session_id"`
	UserID    uuid.UUID     `json:"user_id"`
	Section   enums.Section `json:"section"`
	CompanyID uuid.UUID     `json:"company_id"`
}

func (MockSessionCreated) Topic() string { return "mock.SessionCreated" }

type MockSessionFinished struct {
	base
	SessionID    uuid.UUID     `json:"session_id"`
	UserID       uuid.UUID     `json:"user_id"`
	Section      enums.Section `json:"section"`
	CompanyID    uuid.UUID     `json:"company_id"`
	OverallScore int           `json:"overall_score"`
	Abandoned    bool          `json:"abandoned"`
}

func (MockSessionFinished) Topic() string { return "mock.SessionFinished" }

// ─────────────────────────────────────────────────────────────────────────
// AI Native Round
// ─────────────────────────────────────────────────────────────────────────

type NativeRoundFinished struct {
	base
	SessionID uuid.UUID     `json:"session_id"`
	UserID    uuid.UUID     `json:"user_id"`
	Section   enums.Section `json:"section"`
	Scores    struct {
		Context      int `json:"context"`
		Verification int `json:"verification"`
		Judgment     int `json:"judgment"`
		Delivery     int `json:"delivery"`
	} `json:"scores"`
}

func (NativeRoundFinished) Topic() string { return "native.RoundFinished" }

// ─────────────────────────────────────────────────────────────────────────
// Daily
// ─────────────────────────────────────────────────────────────────────────

type DailyKataCompleted struct {
	base
	UserID    uuid.UUID `json:"user_id"`
	TaskID    uuid.UUID `json:"task_id"`
	StreakNew int       `json:"streak_new"`
	XPEarned  int       `json:"xp_earned"`
	IsCursed  bool      `json:"is_cursed"`
}

func (DailyKataCompleted) Topic() string { return "daily.KataCompleted" }

type DailyKataMissed struct {
	base
	UserID     uuid.UUID `json:"user_id"`
	StreakLost int       `json:"streak_lost"`
	FreezeUsed bool      `json:"freeze_used"`
}

func (DailyKataMissed) Topic() string { return "daily.KataMissed" }

type InterviewAutopsyCreated struct {
	base
	AutopsyID uuid.UUID `json:"autopsy_id"`
	UserID    uuid.UUID `json:"user_id"`
	CompanyID uuid.UUID `json:"company_id"`
}

func (InterviewAutopsyCreated) Topic() string { return "daily.AutopsyCreated" }

// ─────────────────────────────────────────────────────────────────────────
// Rating / Progression
// ─────────────────────────────────────────────────────────────────────────

type RatingChanged struct {
	base
	UserID  uuid.UUID     `json:"user_id"`
	Section enums.Section `json:"section"`
	EloOld  int           `json:"elo_old"`
	EloNew  int           `json:"elo_new"`
	Source  string        `json:"source"` // "arena" | "mock" | "kata"
	MatchID *uuid.UUID    `json:"match_id,omitempty"`
}

func (RatingChanged) Topic() string { return "rating.Changed" }

type XPGained struct {
	base
	UserID uuid.UUID `json:"user_id"`
	Amount int       `json:"amount"`
	Reason string    `json:"reason"`
}

func (XPGained) Topic() string { return "progress.XPGained" }

type LevelUp struct {
	base
	UserID   uuid.UUID `json:"user_id"`
	LevelOld int       `json:"level_old"`
	LevelNew int       `json:"level_new"`
}

func (LevelUp) Topic() string { return "progress.LevelUp" }

type SkillNodeUnlocked struct {
	base
	UserID  uuid.UUID     `json:"user_id"`
	NodeKey string        `json:"node_key"`
	Section enums.Section `json:"section"`
}

func (SkillNodeUnlocked) Topic() string { return "progress.SkillNodeUnlocked" }

type SkillDecayed struct {
	base
	UserID       uuid.UUID `json:"user_id"`
	NodeKey      string    `json:"node_key"`
	DaysInactive int       `json:"days_inactive"`
}

func (SkillDecayed) Topic() string { return "progress.SkillDecayed" }

// ─────────────────────────────────────────────────────────────────────────
// Guild
// ─────────────────────────────────────────────────────────────────────────

type GuildWarStarted struct {
	base
	WarID  uuid.UUID `json:"war_id"`
	GuildA uuid.UUID `json:"guild_a"`
	GuildB uuid.UUID `json:"guild_b"`
	EndsAt time.Time `json:"ends_at"`
}

func (GuildWarStarted) Topic() string { return "guild.WarStarted" }

type GuildWarFinished struct {
	base
	WarID    uuid.UUID  `json:"war_id"`
	WinnerID *uuid.UUID `json:"winner_id,omitempty"` // nil if draw
}

func (GuildWarFinished) Topic() string { return "guild.WarFinished" }

// ─────────────────────────────────────────────────────────────────────────
// Slot / Human Mock
// ─────────────────────────────────────────────────────────────────────────

type SlotBooked struct {
	base
	SlotID        uuid.UUID `json:"slot_id"`
	InterviewerID uuid.UUID `json:"interviewer_id"`
	CandidateID   uuid.UUID `json:"candidate_id"`
	StartsAt      time.Time `json:"starts_at"`
}

func (SlotBooked) Topic() string { return "slot.Booked" }

type SlotCancelled struct {
	base
	SlotID uuid.UUID `json:"slot_id"`
	ByUser uuid.UUID `json:"by_user"`
}

func (SlotCancelled) Topic() string { return "slot.Cancelled" }

// ─────────────────────────────────────────────────────────────────────────
// Subscription
// ─────────────────────────────────────────────────────────────────────────

type SubscriptionActivated struct {
	base
	UserID uuid.UUID              `json:"user_id"`
	Plan   enums.SubscriptionPlan `json:"plan"`
	Until  time.Time              `json:"until"`
}

func (SubscriptionActivated) Topic() string { return "billing.SubscriptionActivated" }

type SubscriptionExpired struct {
	base
	UserID uuid.UUID `json:"user_id"`
}

func (SubscriptionExpired) Topic() string { return "billing.SubscriptionExpired" }

// ─────────────────────────────────────────────────────────────────────────
// Season
// ─────────────────────────────────────────────────────────────────────────

type SeasonPointsEarned struct {
	base
	UserID   uuid.UUID `json:"user_id"`
	SeasonID uuid.UUID `json:"season_id"`
	Points   int       `json:"points"`
	Source   string    `json:"source"`
}

func (SeasonPointsEarned) Topic() string { return "season.PointsEarned" }

// ─────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────

// Now returns a base with current timestamp. Embed in every event constructor.
func Now() base { return base{At: time.Now().UTC()} }
