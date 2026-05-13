package domain

import (
	"context"
	"time"

	"github.com/google/uuid"
)

// DailyBriefRepo persists hone_daily_briefs.
type DailyBriefRepo interface {
	// GetForDate returns the cached brief for (user, date). ErrNotFound
	// when no row exists.
	GetForDate(ctx context.Context, userID uuid.UUID, date time.Time) (DailyBrief, error)
	// Upsert replaces the cached brief for (user, date).
	Upsert(ctx context.Context, userID uuid.UUID, date time.Time, b DailyBrief) error
	// LastForcedAt returns the generated_at of the most-recent brief for
	// the user. Used to gate force=true to 1/h. Zero time when none.
	LastForcedAt(ctx context.Context, userID uuid.UUID) (time.Time, error)
	// RecentForUser — Phase 5. Returns last N days of briefs (newest first)
	// для Hone /coach feed. Limit hard-capped at 60 в caller'е чтобы
	// payload не разросся.
	RecentForUser(ctx context.Context, userID uuid.UUID, sinceDays, limit int) ([]DailyBrief, error)
}

// FocusReader reads focus aggregates for the daily-brief prompt. Implementation
// lives in cmd/monolith/services/intelligence.go and queries hone_streak_days.
type FocusReader interface {
	LastNDays(ctx context.Context, userID uuid.UUID, n int) ([]FocusDay, error)
}

// PlanReader reads skipped + completed plan items for the daily-brief
// prompt. Implementation lives in cmd/monolith/services/intelligence.go
// and walks hone_daily_plans.items jsonb.
type PlanReader interface {
	SkippedItems(ctx context.Context, userID uuid.UUID, since time.Time) ([]SkippedPlanItem, error)
	CompletedItems(ctx context.Context, userID uuid.UUID, since time.Time) ([]CompletedPlanItem, error)
}

// NotesReader reads reflection lines + recent notes + embedding-equipped
// corpus. Implementation lives in cmd/monolith/services/intelligence.go.
type NotesReader interface {
	// RecentReflections returns the last N reflection-style notes (notes
	// whose title contains the " — YYYY-MM-DD" suffix written by EndFocusSession).
	RecentReflections(ctx context.Context, userID uuid.UUID, limit int) ([]Reflection, error)
	// RecentNotes returns the top-N notes by updated_at DESC.
	RecentNotes(ctx context.Context, userID uuid.UUID, limit int) ([]NoteHead, error)
	// EmbeddedCorpus returns ALL notes that have a non-null embedding,
	// projection includes full body_md (capped) for QA-context assembly.
	EmbeddedCorpus(ctx context.Context, userID uuid.UUID) ([]NoteEmbedding, error)
}

// Embedder is the bge-small wrapper. Real impl talks to Ollama via the
// shared HoneEmbedder; floor returns ErrEmbeddingUnavailable.
type Embedder interface {
	Embed(ctx context.Context, text string) ([]float32, string, error)
}

// ─── Cross-product readers ────────────────────────────────────────────────
//
// Coach service объединяет три продукта (Hone focus + druz9 mock-interview +
// druz9 arena/codex) — эти reader'ы пробрасывают в prompt сигналы из
// смежных доменов. Все adapter'ы — raw SQL в cmd/monolith/services/intelligence.go,
// чтобы intelligence-domain не импортировал чужие infra-пакеты.

// MockReader — последние finished mock-interview сессии. Coach использует
// score / weak_topics для personalized recommendations: «last system_design
// scored 6/10, weak on capacity-estimation — practice that today».
type MockReader interface {
	LastNFinished(ctx context.Context, userID uuid.UUID, n int) ([]MockSessionSummary, error)

	// RecentAbandonedCount — Phase 4.7. Возвращает кол-во abandoned mock
	// sessions за последние sinceDays. ≥2 = consistency-break сигнал
	// (юзер бросает интервью на середине → coach должен этим управлять).
	RecentAbandonedCount(ctx context.Context, userID uuid.UUID, sinceDays int) (int, error)
}

// QueueReader — снапшот сегодняшней Focus Queue. Coach видит «1/5 done,
// you're behind — focus on first item».
type QueueReader interface {
	TodaySnapshot(ctx context.Context, userID uuid.UUID) (QueueSnapshot, error)
}

// SkillReader — top-N weak skills из Skill Atlas. Coach предлагает решать
// конкретный weakest skill, а не абстрактные «practice algorithms».
type SkillReader interface {
	WeakestN(ctx context.Context, userID uuid.UUID, n int) ([]SkillWeak, error)
}

// DailyNoteReader — recent free-form daily notes (юзер пишет в Today). Это
// signal of intent/mood/topics. Last 3 days хватит для контекста.
type DailyNoteReader interface {
	RecentDailyNotes(ctx context.Context, userID uuid.UUID, n int) ([]DailyNoteHead, error)
}

// MockMessagesReader — keyword frequency analysis над mock_messages
// user-role контентом. Тривиальная term-frequency: lowercase + split по
// non-letter, filter common stop-words, top-N. Reader сам решает window
// (default 14 дней). Coach видит «top-keywords за 2 недели = [prefix-sum,
// dp, segment-tree]» — это hot topics юзера.
type MockMessagesReader interface {
	TopKeywords(ctx context.Context, userID uuid.UUID, withinDays int, topN int) ([]MockKeywords, error)
}

// CodexReader returns curated in-app learning materials matching coach
// signals. It must only return active Codex objects that exist in DB.
type CodexReader interface {
	SuggestArticles(ctx context.Context, userID uuid.UUID, topics []string, limit int) ([]CodexArticleSuggestion, error)
}

// TrackReader — Phase 2d. Surfaces the user's active learning tracks so
// the coach can spot "track stalled 5 days on step 4" patterns and pin
// recommendations to the active step's skill_keys.
type TrackReader interface {
	ActiveTracks(ctx context.Context, userID uuid.UUID) ([]ActiveTrack, error)
}

// ClubReader — Phase 3 final. Adapter в intelligence-context'е, вычитывает
// ghosted club_sessions для severity grader'а («RSVP'нул но не дошёл»).
type ClubReader interface {
	GhostedSessions(ctx context.Context, userID uuid.UUID, windowDays int) ([]GhostedClubSession, error)
}

// GoalsReader — Phase 4.3. Surfaces the user's active goals so the coach
// can frame narrative around them ("Yandex L4 in 5 days — ваш job_target").
// Только status='active' — paused / done / abandoned не светятся.
type GoalsReader interface {
	ActiveGoals(ctx context.Context, userID uuid.UUID) ([]UserGoal, error)
}

// GoalsRepo — full CRUD над user_goals. Reader выше намеренно узкий —
// coach reads только active. Этот интерфейс шире: web /goals страница
// должна видеть paused/done/abandoned + менять статусы.
//
// Caller-friendly: ListByUser возвращает все goals независимо от статуса
// (caller сам фильтрует в UI). Status вынесен на string чтобы avoid
// dragging UserGoalStatus enum в proto/wire-formats — слой выше валидирует
// ('active'|'paused'|'done'|'abandoned').
type GoalsRepo interface {
	GoalsReader
	ListByUser(ctx context.Context, userID uuid.UUID) ([]UserGoal, error)
	Create(ctx context.Context, in CreateGoalInput) (UserGoal, error)
	UpdateStatus(ctx context.Context, userID, goalID uuid.UUID, status string) (UserGoal, error)
	Delete(ctx context.Context, userID, goalID uuid.UUID) error
}

// CreateGoalInput — wire-shape для POST /goals. Deadline опциональный
// (skill/track goals часто без жёсткой даты). TrackID привязка к
// learning track — set null если goal не привязан.
type CreateGoalInput struct {
	UserID    uuid.UUID
	Kind      UserGoalKind
	Title     string
	NotesMD   string
	Deadline  *time.Time
	TrackID   *uuid.UUID
	SkillKeys []string
}

// UserGoalKind mirrors the SQL enum. Stable string values are wire-safe.
type UserGoalKind string

const (
	UserGoalKindJob   UserGoalKind = "job_target"
	UserGoalKindSkill UserGoalKind = "skill_target"
	UserGoalKindTrack UserGoalKind = "track_target"
)

// UserGoal — projection over user_goals.
//
// Status: ActiveGoals (coach reader) фильтрует по 'active', но ListByUser
// (web /goals) показывает все статусы — поле возвращается explicit.
//
// Deadline = nil = «без жёсткого срока» (skill goals часто такие).
// DaysToDeadline pre-computed reader'ом: -1 = no deadline, 0 = today,
// 5 = in 5 days. Coach использует значение в severity-grader'е.
type UserGoal struct {
	ID             uuid.UUID
	Kind           UserGoalKind
	Status         string // active | paused | done | abandoned
	Title          string
	NotesMD        string
	Deadline       *time.Time
	DaysToDeadline int
	TrackID        *uuid.UUID
	SkillKeys      []string
	CreatedAt      time.Time
}

// BriefSynthesizer generates the daily brief via TaskDailyBrief. Real impl
// returns strict JSON parsed into the struct; floor returns ErrLLMUnavailable.
type BriefSynthesizer interface {
	Synthesise(ctx context.Context, in BriefPromptInput) (DailyBrief, error)
}

// BriefPromptInput aggregates everything the synthesiser needs.
type BriefPromptInput struct {
	UserID          uuid.UUID
	Today           time.Time
	FocusDays       []FocusDay
	SkippedRecent   []SkippedPlanItem
	CompletedRecent []CompletedPlanItem
	Reflections     []Reflection
	RecentNotes     []NoteHead
	// PastEpisodes — Memory.Recall hits, передаются в prompt как
	// «past coach interactions» — синтезайзер избегает повторов и
	// корректирует тон под историю user-реакций.
	PastEpisodes []Episode
	// CueMemories — compact derived evidence from Cue desktop turns.
	// Treat as weak interview-practice signal: useful for topics/outcomes,
	// not as authoritative user profile facts.
	CueMemories []Episode

	// ── Cross-product сигналы (могут быть пустыми если reader не wired) ──

	// Mocks — последние finished mock-interview сессии. Score + weak_topics
	// дают specific recommendations вместо generic «do system design».
	Mocks []MockSessionSummary

	// MockAbandonedRecent — Phase 4.7. Кол-во abandoned mock sessions за
	// последние 14 дней. ≥2 = consistency-break warn в severity grader.
	MockAbandonedRecent int

	// Queue — снапшот today queue. «You're 1/5 done на сегодня».
	Queue QueueSnapshot

	// WeakSkills — top-5 weakest skills. Самый прямой сигнал «что качать».
	WeakSkills []SkillWeak

	// DailyNotes — head'ы recent free-form daily notes. Mood / intent signal.
	DailyNotes []DailyNoteHead

	// MockKeywords — top hot topics из user-сообщений в mock-сессиях за
	// 14 дней. Term-frequency analysis. Coach видит реальные topics.
	MockKeywords []MockKeywords

	// CodexArticles — curated learning links selected from codex_articles
	// for current weak topics. The LLM may link only to these exact URLs.
	CodexArticles []CodexArticleSuggestion

	// ActiveTracks — Phase 2d. The user's enrolled learning tracks with
	// current-step progress. Coach uses this to: (a) flag stalled tracks
	// (warn severity), (b) tighten recommendations to the active step's
	// skill_keys, (c) avoid suggesting drills outside the current track
	// when the user has clearly committed to one.
	ActiveTracks []ActiveTrack

	// PendingFollowups — Phase 4.8. Recommendations that the user followed
	// (clicked) within the last 24-48h but coach hasn't yet asked whether
	// they landed. Prompt section nudges the LLM to write «как с [X]?»
	// в narrative/recommendation, чтобы цикл закрывался — иначе тоже
	// самые review_note/tiny_task'и будут предлагаться снова и снова.
	PendingFollowups []PendingFollowup

	// ActiveGoals — Phase 4.3. User's high-level goals (job/skill/track).
	// Coach использует для (a) framing narrative («Yandex L4 в 5 дней —
	// ваш job_target»), (b) deadline-aware severity, (c) приоритезации
	// recommendations в сторону активной цели.
	ActiveGoals []UserGoal

	// GhostedClubs — Phase 3 final. Сессии за окно 7 дней где user
	// RSVP'd_yes но статус остался rsvp_yes (никто не проставил
	// attended). Сигнал disengagement → severity=nudge.
	GhostedClubs []GhostedClubSession

	// External — обучение вне druz9 (LeetCode / Coursera / книги). Coach
	// видит «вчера 60 мин на Coursera» и не предлагает ту же тему в
	// today's plan. Empty struct когда юзер ничего не логирует.
	External ExternalActivitySummary

	// ── Phase 1.7e learning-companion prompt sections (2026-05-04) ──

	// Fork — snapshot ForkProgressReader (см repo.go ForkProgressSnapshot).
	// Prompt-block FORK STATUS активен только когда Mode == "explore".
	Fork ForkProgressSnapshot

	// ResourceTrail — engagement signals из user_resource_log за окно.
	// Prompt-block RESOURCE TRAIL активен когда total events > 0.
	ResourceTrail ResourceEngagement

	// ML — Phase K, M5 (2026-05-13) ML-track detection. When IsML=true,
	// brief synthesiser injects mlBriefOverlay (см infra/ml_prompt.go) as
	// second system message — coach swaps generic Go-senior tropes for
	// ML-flavoured guidance (numpy/pytorch coding, recsys/ranking sysdesign,
	// Lilian Weng / Chip Huyen resource pool). Zero-value (IsML=false) — no
	// overlay, default coach behaviour.
	ML MLProfile
}

// ExternalActivitySummary — 7-дневная агрегация external_activity записей.
// Поля плоские чтобы prompt-builder мог их печатать без нестинга.
type ExternalActivitySummary struct {
	// MinutesWindow — sum(duration_min) за последние 7 дней.
	MinutesWindow int
	// Sources — distinct sources за окно ('leetcode', 'coursera', …).
	Sources []string
	// TopTopics — top-3 atlas-node titles + free_text-метки. Coach
	// использует чтобы понять «что юзер прошёл сам».
	TopTopics []string
}

// ExternalActivityReader — pgx adapter поверх external_activity (миграция
// 00037). Используется DailyBrief'ом и AI-tutor SnapshotProvider'ом.
type ExternalActivityReader interface {
	// SummaryWindow возвращает агрегацию за last N days. Empty struct
	// если ничего не записано (это ОК — большинство юзеров поначалу
	// ничего не логируют).
	SummaryWindow(ctx context.Context, userID uuid.UUID, days int) (ExternalActivitySummary, error)
}

// ── Phase 1.7c readers (learning-companion 2026-05-04) ──

// ResourceTouch — single event from user_resource_log (00055).
type ResourceTouch struct {
	URL         string
	AtlasNodeID string // optional ("" если ресурс был cross-cluster suggestion)
	Kind        string // clicked | finished | skipped | unhelpful | reflection_submitted
	OccurredAt  time.Time
	HoursAgo    int    // pre-computed для prompt'а
	Reflection  string // непустое только когда kind=reflection_submitted
}

// ResourceEngagement — агрегация для RESOURCE TRAIL prompt block.
type ResourceEngagement struct {
	// FinishedRecent — last N finished ресурсы (newest first).
	FinishedRecent []ResourceTouch
	// UnfinishedCount — clicked но не finished/skipped за окно.
	UnfinishedCount int
	// MarkedUnhelpful — last N unhelpful-marks за окно.
	MarkedUnhelpful []ResourceTouch
	// RecentReflections — last N reflection_submitted touches с непустым text.
	RecentReflections []ResourceTouch
}

// ResourceEngagementReader реализует чтения над user_resource_log (00055):
// RESOURCE TRAIL prompt-block, resource_engagement producer (Phase 1.7d),
// admin curation analytics (Phase 12.5).
type ResourceEngagementReader interface {
	// EngagementWindow возвращает агрегацию событий за last N дней.
	// keepRecent ограничивает FinishedRecent / RecentReflections / MarkedUnhelpful.
	EngagementWindow(ctx context.Context, userID uuid.UUID, days, keepRecent int) (ResourceEngagement, error)
}

// ForkBranchScore — per-branch агрегация mock-результатов.
type ForkBranchScore struct {
	Branch             string // "de" | "mle"
	MockCount          int
	AvgScore           float64
	VoluntaryDeepDives int // counted from atlas/resource log signals
}

// ForkProgressSnapshot — input для FORK STATUS prompt-block + fork_progress
// producer (Phase 1.7d). Только когда learning_state.mode=='explore'.
type ForkProgressSnapshot struct {
	Mode             string // explore | commit | deep
	ExploreWeekIndex int    // 1-based; 0 если mode != explore
	CurrentBranch    string // current learning_state.fork_branch ("" if NULL)
	ScoresByBranch   []ForkBranchScore
}

// ForkProgressReader читает learning_state + cross-refs mock_sessions + atlas
// activity. Используется FORK STATUS prompt block + fork_progress producer
// (Phase 1.7d) + admin learning-state tab (Phase 12.5).
type ForkProgressReader interface {
	Snapshot(ctx context.Context, userID uuid.UUID) (ForkProgressSnapshot, error)
}

// GhostedClubSession — projection used by deriveSeverity. Pre-computed
// `HappenedAgo` (days). Coach сам выбирает фразу — здесь только данные.
type GhostedClubSession struct {
	ClubName    string
	TopicTitle  string
	HappenedAgo int
}

// PendingFollowup — derived projection over EpisodeBriefFollowed.
type PendingFollowup struct {
	Title      string
	Kind       RecommendationKind
	TargetID   string    // note_id / plan_item_id если был
	FollowedAt time.Time // когда юзер кликнул
	HoursAgo   int       // pre-computed для prompt'а
}

// AskNotesPromptInput — вход для NoteAnswerer (Phase B). Past Q&A
// эпизоды дают модели контекст «юзер уже спрашивал X».
type AskNotesPromptInput struct {
	Question     string
	ContextNotes []NoteEmbedding
	PastEpisodes []Episode
}

// NoteAnswerer synthesises an answer from question + top-K notes + past Q&A
// episodes. Real impl uses TaskNoteQA; floor returns ErrLLMUnavailable.
//
// Sig сохранена обратно-совместимой: первая версия принимала только
// (question, ctxNotes). Новый параметр past — optional (nil = old behaviour).
type NoteAnswerer interface {
	Answer(ctx context.Context, in AskNotesPromptInput) (string, error)
}
