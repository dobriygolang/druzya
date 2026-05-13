// Package app is the use-case layer for Hone. Each exported struct is one
// wire-addressable operation; Handler bundles them so the ports package
// can depend on a single struct.
package app

import (
	"log/slog"
	"time"

	"druz9/hone/domain"
)

// ChronicSkipWindow / ChronicSkipMinCount — порог «chronic skip» для
// resistance-tracker'а. 14 дней — достаточный lookback чтобы отловить
// устойчивое избегание, и достаточно короткий чтобы «починенный» skill
// (пользователь наконец-то сделал задачу) быстро выпал. 2 — минимальная
// повторность, отличающая «не успел сегодня» от «активно отмахивается».
const (
	ChronicSkipWindow   = 14 * 24 * time.Hour
	ChronicSkipMinCount = 2
)

// Handler bundles all Hone use cases. Constructed in
// cmd/monolith/services/hone.go and handed to ports.NewHoneServer.
type Handler struct {
	// Plan
	GeneratePlan     *GeneratePlan
	GetPlan          *GetPlan
	DismissPlanItem  *DismissPlanItem
	CompletePlanItem *CompletePlanItem

	// Focus
	StartFocus *StartFocus
	EndFocus   *EndFocus
	GetStats   *GetStats

	// Notes
	CreateNote         *CreateNote
	UpdateNote         *UpdateNote
	GetNote            *GetNote
	ListNotes          *ListNotes
	DeleteNote         *DeleteNote
	MoveNote           *MoveNote
	GetNoteConnections *GetNoteConnections
	SuggestNoteLinks   *SuggestNoteLinks

	// Folders
	CreateFolder *CreateFolder
	ListFolders  *ListFolders
	DeleteFolder *DeleteFolder

	// Whiteboards
	CreateWhiteboard   *CreateWhiteboard
	UpdateWhiteboard   *UpdateWhiteboard
	GetWhiteboard      *GetWhiteboard
	ListWhiteboards    *ListWhiteboards
	DeleteWhiteboard   *DeleteWhiteboard
	CritiqueWhiteboard *CritiqueWhiteboard
	SaveCritiqueAsNote *SaveCritiqueAsNote

	// Focus Queue
	ListQueue        *ListQueue
	AddUserItem      *AddUserItem
	UpdateItemStatus *UpdateItemStatus
	DeleteItem       *DeleteItem

	// Standup
	RecordStandup   *RecordStandup
	GetTodayStandup *GetTodayStandup

	// Cue Sessions (pseudo-folder для импортов из Cue desktop'а)
	ImportCueSession         *ImportCueSession
	ListCueSessions          *ListCueSessions
	GetCueSession            *GetCueSession
	UpdateCueSession         *UpdateCueSession
	DeleteCueSession         *DeleteCueSession
	SendCueSessionToTelegram *SendCueSessionToTelegram

	// TaskBoard (Notion-style kanban)
	CreateTask       *CreateTask
	ListTasks        *ListTasks
	MoveTaskStatus   *MoveTaskStatus
	DeleteTask       *DeleteTask
	AddTaskComment   *AddTaskComment
	ListTaskComments *ListTaskComments
	// CategoriseTask — AI auto-place; nil-safe в Handler.New. Caller-side
	// gates calls (not every task stoит LLM-call'а).
	CategoriseTask     *CategoriseTask
	BulkAutoCategorise *BulkAutoCategorise
	UpdateTaskKind     *UpdateTaskKind

	// Time-blocking (Phase K Wave 15) — pin tasks to calendar slots.
	ScheduleTask   *ScheduleTask
	UnscheduleTask *UnscheduleTask

	// Energy tracker (Phase K Wave 15) — 1..5 ratings + recent list.
	LogEnergy      *LogEnergy
	ListEnergyLogs *ListEnergyLogs

	// End-of-day shutdown ritual (Phase K Wave 15) — three textareas
	// (done / pending / tomorrow) UPSERTed once per calendar day. Daily
	// brief reads вчерашнюю запись и кладёт в coach prompt.
	SubmitDayShutdown *SubmitDayShutdown
	GetTodayShutdown  *GetTodayShutdown

	// Publish-to-web (everything except the HTML viewer at /p/{slug}).
	PublishNote     *PublishNote
	UnpublishNote   *UnpublishNote
	PublishStatusUC *PublishStatus
	BulkNotesMeta   *BulkNotesMeta
	ShareToWeb      *ShareToWeb
	MakePrivate     *MakePrivate

	// Reading: library + reader sessions + Leitner SRS vocab queue.
	AddReadingMaterial        *AddReadingMaterial
	GetReadingMaterial        *GetReadingMaterial
	ListReadingMaterials      *ListReadingMaterials
	ArchiveReadingMaterial    *ArchiveReadingMaterial
	StartReadingSession       *StartReadingSession
	EndReadingSession         *EndReadingSession
	AddVocab                  *AddVocab
	ReviewVocab               *ReviewVocab
	ListVocabDue              *ListVocabDue
	ListVocabBySourceMaterial *ListVocabBySourceMaterial

	// Writing-as-Focus. One-shot LLM grader, no persistence.
	GradeEnglishWriting *GradeEnglishWriting

	// Writing prompts library. List user-facing; Add/Archive admin-gated
	// at REST router.
	ListWritingPrompts   *ListWritingPrompts
	AddWritingPrompt     *AddWritingPrompt
	ArchiveWritingPrompt *ArchiveWritingPrompt

	// Code-review-coaching. One-shot grader for diff + review.
	GradeCodeReview *GradeCodeReview

	// Listening: library of audio + transcript; click-on-word reuses AddVocab.
	AddListeningMaterial     *AddListeningMaterial
	GetListeningMaterial     *GetListeningMaterial
	ListListeningMaterials   *ListListeningMaterials
	ArchiveListeningMaterial *ArchiveListeningMaterial
	IngestYouTubeListening   *IngestYouTubeListening

	// Speaking: shadowing exercises with STT-based pronunciation grading.
	ListSpeakingExercises *ListSpeakingExercises
	GradeSpeaking         *GradeSpeaking
	ListSpeakingHistory   *ListSpeakingHistory
	// GenerateSpeakingTTS — admin-only regen of reference audio. nil-safe:
	// handler returns 503 when provider/store not wired.
	GenerateSpeakingTTS *GenerateSpeakingTTS

	// Reading: book-source progress.
	UpdateBookProgress *UpdateBookProgress

	// User settings (active study mode).
	GetUserSettings  *GetUserSettings
	SetActiveTrack   *SetActiveTrack
	SetEnglishActive *SetEnglishActive

	// External activity (structured form, не чат).
	AddExternalActivity    *AddExternalActivity
	ListExternalActivity   *ListExternalActivity
	DeleteExternalActivity *DeleteExternalActivity
	SearchAtlasTopics      *SearchAtlasTopics
	ListAtlasNodeTracks    *ListAtlasNodeTracks

	// Resistance journal (Phase K Wave 15) — pre-focus mini-prompt + list.
	LogResistance      *LogResistance
	ListResistanceLogs *ListResistanceLogs

	// Notes AI-flag (Phase K Wave 15) — soft-privacy toggle.
	UpdateNoteAIExcluded *UpdateNoteAIExcluded

	// Tasks from notes (Phase K Wave 15) — coach reading pipeline.
	SuggestTasksFromNotes *SuggestTasksFromNotes
	AcceptTaskSuggestion  *AcceptTaskSuggestion

	Log *slog.Logger
	Now func() time.Time
}

// NewHandler copies the fields — no side-effects. Caller owns lifetime.
func NewHandler(in Handler) *Handler {
	h := in
	if h.Now == nil {
		h.Now = time.Now
	}
	return &h
}

// MinQualifyingFocusSeconds is the per-day threshold for streak contribution.
// A day counts toward streak only when aggregate focused_seconds crosses
// this line. Ten minutes is the current floor — low enough that "showing
// up" counts, high enough that opening the app briefly doesn't.
const MinQualifyingFocusSeconds = 600

// MaxPlanItems caps AI-generated plan length. More items → less focus;
// Winter-style minimalism pushes us toward a tight list. 4 is the MVP
// default, bumped to 5 if calendar has a mock today (auto-inserted).
const MaxPlanItems = 5

// PlanItemIDSeed is the entropy source used by plan_generator to mint
// item IDs. Deliberately short and stable so dismiss/complete clicks
// don't confuse the UI when ids are long opaque strings.
const PlanItemIDSeed = "hone-plan"

// Ensure domain is referenced at compile time — guards against import
// pruning when early app files don't yet touch domain types.
var _ = domain.PlanItemSolve
