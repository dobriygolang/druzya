package domain

import (
	"time"

	"druz9/shared/enums"

	"github.com/google/uuid"
)

// Conversation is one thread of turns started by an Analyze call.
// Follow-up Chat turns append messages without creating a new conversation.
type Conversation struct {
	ID        uuid.UUID
	UserID    uuid.UUID
	Title     string // auto-derived from the first user message; empty until set
	Model     string // provider-qualified, e.g. "openai/gpt-4o-mini"
	CreatedAt time.Time
	UpdatedAt time.Time
}

// Message is a single turn. Screenshots are not persisted — HasScreenshot is
// a flag-only marker so the history UI can show an image chip on the row.
type Message struct {
	ID             uuid.UUID
	ConversationID uuid.UUID
	Role           enums.MessageRole
	Content        string // markdown; for voice turns, contains the transcript
	HasScreenshot  bool
	TokensIn       int
	TokensOut      int
	LatencyMs      int
	// Rating uses a nullable pointer so zero (unset) is distinguishable from
	// 0 (neutral). DB column is SMALLINT NULL with CHECK IN (-1,0,1).
	Rating    *int8
	CreatedAt time.Time
}

// ConversationDetail is a Conversation with its ordered Messages.
type ConversationDetail struct {
	Conversation Conversation
	Messages     []Message
}

// ConversationSummary is a history-row projection that includes the message
// count (computed via a LEFT JOIN, not stored on the parent).
type ConversationSummary struct {
	Conversation
	MessageCount int
}

// Quota is a user's per-window request bucket. ResetsAt is the moment at
// which requests_used should roll back to zero.
type Quota struct {
	UserID        uuid.UUID
	Plan          enums.SubscriptionPlan
	RequestsUsed  int
	RequestsCap   int // -1 means unlimited
	ResetsAt      time.Time
	ModelsAllowed []string
	UpdatedAt     time.Time
}

// HasBudget reports whether the user can make another request right now.
// Callers must have already rotated the window (see RotateIfDue) if needed.
func (q Quota) HasBudget() bool {
	return q.RequestsCap < 0 || q.RequestsUsed < q.RequestsCap
}

// RotateIfDue returns a quota with the counter zeroed and the window
// extended by 24h iff `now >= ResetsAt`. Otherwise returns the original.
// Pure function — the caller decides whether to persist the result.
func (q Quota) RotateIfDue(now time.Time) (Quota, bool) {
	if !now.Before(q.ResetsAt) {
		q.RequestsUsed = 0
		q.ResetsAt = now.Add(24 * time.Hour)
		return q, true
	}
	return q, false
}

// IsModelAllowed checks membership in ModelsAllowed. Empty ModelsAllowed
// means "no restriction" — plans usually constrain this, not the empty set.
func (q Quota) IsModelAllowed(modelID string) bool {
	if len(q.ModelsAllowed) == 0 {
		return false
	}
	for _, m := range q.ModelsAllowed {
		if m == modelID {
			return true
		}
	}
	return false
}

// ModelSpeedClass is a UI-only grouping surfaced in the provider picker.
type ModelSpeedClass string

const (
	ModelSpeedClassUnspecified ModelSpeedClass = ""
	ModelSpeedClassFast        ModelSpeedClass = "fast"
	ModelSpeedClassBalanced    ModelSpeedClass = "balanced"
	ModelSpeedClassReasoning   ModelSpeedClass = "reasoning"
)

// ProviderModel describes one entry in the model catalogue. All fields are
// server-driven so the client does not hardcode model metadata.
type ProviderModel struct {
	ID                      string // "openai/gpt-4o-mini"
	DisplayName             string // "GPT Fast"
	ProviderName            string // "OpenAI"
	SpeedClass              ModelSpeedClass
	SupportsVision          bool
	SupportsReasoning       bool
	TypicalLatencyMs        int
	ContextWindowTokens     int
	AvailableOnCurrentPlan  bool
}

// HotkeyAction enumerates every action the desktop may bind.
type HotkeyAction string

const (
	HotkeyActionUnspecified         HotkeyAction = ""
	HotkeyActionScreenshotArea      HotkeyAction = "screenshot_area"
	HotkeyActionScreenshotFull      HotkeyAction = "screenshot_full"
	HotkeyActionVoiceInput          HotkeyAction = "voice_input"
	HotkeyActionToggleWindow        HotkeyAction = "toggle_window"
	HotkeyActionQuickPrompt         HotkeyAction = "quick_prompt"
	HotkeyActionClearConversation   HotkeyAction = "clear_conversation"
)

// HotkeyBinding pairs an action with an Electron accelerator string.
type HotkeyBinding struct {
	Action      HotkeyAction
	Accelerator string // "CommandOrControl+Shift+S"
}

// FeatureFlag is a named boolean capability gate. Keys live in code, values
// come from config.
type FeatureFlag struct {
	Key     string
	Enabled bool
}

// PaywallCopy is localized user-facing plan copy. The client is forbidden
// from hardcoding pricing — all of this is server-driven.
type PaywallCopy struct {
	PlanID      string
	DisplayName string
	PriceLabel  string
	Tagline     string
	Bullets     []string
	CTALabel    string
}

// StealthCompatEntry records a known-broken (OS, browser) combination for
// the stealth-overlay feature. The client warns when the user is in-range.
type StealthCompatEntry struct {
	OSVersionMin      string
	OSVersionMax      string
	BrowserID         string
	BrowserVersionMin string
	BrowserVersionMax string
	Note              string
}

// DesktopConfig is the entire remote-config payload shipped to the desktop
// client. Rev is bumped on every change so the client can skip reload.
type DesktopConfig struct {
	Rev                int64
	Models             []ProviderModel
	DefaultModelID     string
	DefaultHotkeys     []HotkeyBinding
	Flags              []FeatureFlag
	Paywall            []PaywallCopy
	StealthWarnings    []StealthCompatEntry
	UpdateFeedURL      string
	MinClientVersion   string
	AnalyticsPolicyKey string
}

// ClientOS tags the desktop runtime.
type ClientOS string

const (
	ClientOSUnspecified ClientOS = ""
	ClientOSMacOS       ClientOS = "macos"
	ClientOSWindows     ClientOS = "windows"
	ClientOSLinux       ClientOS = "linux"
)

// ClientContext is best-effort telemetry from the desktop client. Nothing
// here is required for the request to succeed; fields are used for routing
// hints and debugging only.
type ClientContext struct {
	OS             ClientOS
	OSVersion      string
	AppVersion     string
	TriggerAction  HotkeyAction
	FocusedAppHint string // "com.microsoft.teams"
}

// AttachmentKind distinguishes ephemeral inputs on an Analyze/Chat turn.
// Screenshots are discarded after the LLM call; voice attachments are
// transcribed server-side and collapsed into Message.Content.
type AttachmentKind string

const (
	AttachmentKindUnspecified     AttachmentKind = ""
	AttachmentKindScreenshot      AttachmentKind = "screenshot"
	AttachmentKindVoiceTranscript AttachmentKind = "voice_transcript"
)

// AttachmentInput is raw data uploaded with a turn. Stays in memory only.
type AttachmentInput struct {
	Kind     AttachmentKind
	Data     []byte
	MimeType string
	Width    int // images only
	Height   int // images only
}

// IsScreenshot is a convenience for the HasScreenshot flag.
func (a AttachmentInput) IsScreenshot() bool {
	return a.Kind == AttachmentKindScreenshot && len(a.Data) > 0
}
