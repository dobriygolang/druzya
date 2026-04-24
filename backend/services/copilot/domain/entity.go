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
	// RunningSummary — фоновый конспект старых turns, поддерживаемый
	// compaction.Worker. Пустая строка у новых диалогов. Загружается только
	// через Get (Create/List не возвращают, чтобы не раздувать history).
	RunningSummary string
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
	ID                     string // "openai/gpt-4o-mini"
	DisplayName            string // "GPT Fast"
	ProviderName           string // "OpenAI"
	SpeedClass             ModelSpeedClass
	SupportsVision         bool
	SupportsReasoning      bool
	TypicalLatencyMs       int
	ContextWindowTokens    int
	AvailableOnCurrentPlan bool
}

// HotkeyAction enumerates every action the desktop may bind.
type HotkeyAction string

const (
	HotkeyActionUnspecified        HotkeyAction = ""
	HotkeyActionScreenshotArea     HotkeyAction = "screenshot_area"
	HotkeyActionScreenshotFull     HotkeyAction = "screenshot_full"
	HotkeyActionVoiceInput         HotkeyAction = "voice_input"
	HotkeyActionToggleWindow       HotkeyAction = "toggle_window"
	HotkeyActionQuickPrompt        HotkeyAction = "quick_prompt"
	HotkeyActionClearConversation  HotkeyAction = "clear_conversation"
	HotkeyActionCursorFreezeToggle HotkeyAction = "cursor_freeze_toggle"
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
	// SubscribeURL is the external URL the CTA button opens. For Boosty,
	// a per-tier purchase link (https://boosty.to/<creator>/purchase/<id>).
	// Empty for free / already-current plans.
	SubscribeURL string
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

// ─────────────────────────────────────────────────────────────────────────
// Sessions (Phase 12)
// ─────────────────────────────────────────────────────────────────────────

// SessionKind tags how a session should be treated downstream. Interview
// triggers the full analyzer path; work / casual are stored for future
// filtering but do not kick off a report.
type SessionKind string

const (
	SessionKindUnspecified SessionKind = ""
	SessionKindInterview   SessionKind = "interview"
	SessionKindWork        SessionKind = "work"
	SessionKindCasual      SessionKind = "casual"
)

// IsValid guards the app layer from persisting a bogus kind.
func (k SessionKind) IsValid() bool {
	switch k {
	case SessionKindInterview, SessionKindWork, SessionKindCasual:
		return true
	case SessionKindUnspecified:
		return false
	}
	return false
}

// Session is a grouping of copilot conversations the user explicitly
// started ("Start interview session" in the desktop tray). All turns
// created between StartSession and EndSession attach here via the
// conversations.session_id FK.
type Session struct {
	ID         uuid.UUID
	UserID     uuid.UUID
	Kind       SessionKind
	StartedAt  time.Time
	FinishedAt *time.Time
	// BYOKOnly — once any server-visible turn used BYOK (future: via
	// client header hint), we mark the session so the analyzer skips.
	// In the current MVP this stays false because BYOK turns never
	// reach the server at all — the desktop runs its own local
	// analysis instead.
	BYOKOnly bool
	// DocumentIDs — documents the user has attached to this session
	// for RAG-context injection. Mutated via AttachDocument /
	// DetachDocument on SessionRepo; kept set-like (no duplicates) at
	// the DB layer. Stale ids (docs deleted while still referenced
	// here) are tolerated — the searcher skips them via its own
	// ownership check.
	DocumentIDs []uuid.UUID
}

// IsFinished — helper for the "live session" partial unique index.
func (s Session) IsFinished() bool { return s.FinishedAt != nil }

// AnalysisStatus progresses through the analyzer job lifecycle.
type AnalysisStatus string

const (
	AnalysisStatusPending AnalysisStatus = "pending"
	AnalysisStatusRunning AnalysisStatus = "running"
	AnalysisStatusReady   AnalysisStatus = "ready"
	AnalysisStatusFailed  AnalysisStatus = "failed"
)

// AnalysisLink — a labeled URL the analyzer includes in the report,
// typically pointing into Druzya's content tree.
type AnalysisLink struct {
	Label string
	URL   string
}

// SessionReport is the analyzer output attached to a session. Stored
// flat so sqlc doesn't need nested structs; JSON-encoded fields are
// round-tripped through []byte in the postgres layer.
//
// `Analysis` / `Title` were added in migration 00053 to power the
// Cluely-style Session Summary view in the desktop. The older fields
// (OverallScore, SectionScores, Weaknesses, Recommendations, Links,
// ReportMarkdown) are kept for back-compat — the web report renderer
// still uses them and old rows keep rendering.
type SessionReport struct {
	SessionID       uuid.UUID
	Status          AnalysisStatus
	OverallScore    int
	SectionScores   map[string]int // "algorithms" → 78, ...
	Weaknesses      []string
	Recommendations []string
	Links           []AnalysisLink
	ReportMarkdown  string
	ReportURL       string
	ErrorMessage    string
	StartedAt       *time.Time
	FinishedAt      *time.Time
	UpdatedAt       time.Time

	// Title is a short human-readable summary derived by the analyzer
	// from the transcript ("Sorting at scale · leader-follower"). Empty
	// on reports from the pre-00053 schema or when the analyzer skipped
	// / failed. Rendered in the Summary header + history row.
	Title string

	// Analysis is the structured Cluely-style breakdown. Every sub-list
	// is optional; empty slices/maps render as "no items detected" in
	// the UI rather than a hard error.
	Analysis SessionAnalysis
}

// SessionAnalysis is the structured post-session report the desktop's
// Summary view consumes. All fields are optional — the LLM emits what
// it can confidently extract from the transcript and leaves the rest
// empty. Treat missing sections as "not applicable", not "error".
//
// JSON field names are the wire format between the LLM (JSON-mode
// response), the DB (JSONB column), and the desktop (IPC payload).
// Keep them snake_case to match the prompt contract.
type SessionAnalysis struct {
	// TLDR — 1-3 sentence elevator pitch of what the session covered.
	TLDR string `json:"tldr,omitempty"`
	// KeyTopics — the technical themes discussed, most-significant
	// first. Rendered as chips in the Summary tab.
	KeyTopics []string `json:"key_topics,omitempty"`
	// ActionItems — concrete things the user should do after the
	// session ("повторить heap-sort", "пройти mock с behavioral").
	ActionItems []AnalysisItem `json:"action_items,omitempty"`
	// Terminology — glossary of technical terms that came up, with a
	// one-line plain-language gloss. Helps the user reinforce
	// vocabulary without re-reading the whole transcript.
	Terminology []AnalysisTerm `json:"terminology,omitempty"`
	// Decisions — design / approach decisions the user made during
	// the session ("chose quicksort over merge sort for in-memory").
	Decisions []AnalysisItem `json:"decisions,omitempty"`
	// OpenQuestions — things the user asked about that remained
	// unresolved. Prompts the next study session.
	OpenQuestions []string `json:"open_questions,omitempty"`
	// Usage — aggregated token / latency / cost accounting. The
	// analyzer does not invent these — they come from the repo layer
	// summing Message rows for the session.
	Usage *AnalysisUsage `json:"usage,omitempty"`
}

// AnalysisItem is a titled paragraph — used for action items and
// decisions. Detail may be empty when a one-liner is enough.
type AnalysisItem struct {
	Title  string `json:"title"`
	Detail string `json:"detail,omitempty"`
}

// AnalysisTerm is a glossary entry.
type AnalysisTerm struct {
	Term       string `json:"term"`
	Definition string `json:"definition"`
}

// AnalysisUsage is the token / latency aggregate for the session.
// Populated outside the LLM — we sum from message rows. Rendered on
// the Usage tab: total turns, tokens in/out, wall time.
type AnalysisUsage struct {
	Turns          int `json:"turns"`
	TokensIn       int `json:"tokens_in"`
	TokensOut      int `json:"tokens_out"`
	TotalLatencyMs int `json:"total_latency_ms"`
}

// AnalyzerInput is what the analyzer receives from the subscriber —
// everything needed to produce the report without querying the DB
// itself. Keeps the analyzer layer pure (no repo dependencies).
type AnalyzerInput struct {
	Session       Session
	Conversations []Conversation
	// MessagesByConvID: messages grouped per-conversation so the
	// analyzer can reconstruct turn order and flag multi-turn threads.
	MessagesByConvID map[uuid.UUID][]Message
}

// AnalyzerResult is the structured output the LLM produces. Shape mirrors
// SessionReport fields 1:1 — the repo layer just copies fields and
// stamps ids / timestamps.
//
// Title + Analysis were added in Phase 3 (migration 00053) to feed the
// desktop's Session Summary view. The legacy scalar fields
// (OverallScore, Weaknesses, …) are still populated for the web report
// so both renderers work off a single analyzer run.
type AnalyzerResult struct {
	OverallScore    int
	SectionScores   map[string]int
	Weaknesses      []string
	Recommendations []string
	Links           []AnalysisLink
	ReportMarkdown  string
	Title           string
	Analysis        SessionAnalysis
}
