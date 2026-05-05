package hone

import (
	"context"
	"fmt"
	"log/slog"
	"net/http"
	"time"

	monolithServices "druz9/cmd/monolith/services"
	subscriptionServices "druz9/cmd/monolith/services/subscription"
	honeApp "druz9/hone/app"
	honeDomain "druz9/hone/domain"
	honeInfra "druz9/hone/infra"
	honePorts "druz9/hone/ports"
	"druz9/shared/generated/pb/druz9/v1/druz9v1connect"
	"druz9/shared/pkg/metrics"
	"druz9/shared/pkg/ratelimit"
	"druz9/shared/pkg/ttlcache"
	subDomain "druz9/subscription/domain"

	"connectrpc.com/connect"
	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
)

// honeDomainTaskAlias — type alias чтобы избежать прямого imports
// honeDomain.Task в этом файле для generic ttlcache. Уже импортирован
// через honeDomain в build, alias — только nominal.
type honeDomainTaskAlias = honeDomain.Task

// honeEmbedQueueAdapter адаптирует infra.RedisEmbedQueue под app.EmbedQueue.
// Конвертер payload'а, иначе пришлось бы делать infra→app импорт через
// domain (нежелательно — app держит доменный тип EmbedJobItem, infra
// держит свой wire-формат).
type honeEmbedQueueAdapter struct{ q *honeInfra.RedisEmbedQueue }

func (a *honeEmbedQueueAdapter) Dequeue(ctx context.Context) (honeApp.EmbedJobItem, error) {
	job, err := a.q.Dequeue(ctx)
	if err != nil {
		return honeApp.EmbedJobItem{}, fmt.Errorf("hone.embedQueueAdapter.Dequeue: %w", err)
	}
	return honeApp.EmbedJobItem{UserID: job.UserID, NoteID: job.NoteID, Text: job.Text}, nil
}

// NewHone wires the Hone desktop-cockpit bounded context.
//
// Adapter selection is governed by what's configured at boot:
//   - Synthesiser + CritiqueStreamer: real LLM-backed when d.LLMChain is
//     non-nil; otherwise NoLLM* floors return ErrLLMUnavailable (→ 503).
//   - Embedder: real Ollama-backed when OLLAMA_HOST is set; otherwise
//     NoEmbedder returns ErrEmbeddingUnavailable (→ 503 on GetNoteConnections).
//   - SkillAtlasReader: real adapter hits skill_nodes + atlas_nodes; when
//     the user has no rows yet, returns empty slice and the plan prompt
//     falls back to its generic-plan branch.
//
// The d.Pool / d.LLMChain / d.Cfg fields are the only inputs — all other
// per-domain dependencies are private to this file.
func NewHone(d monolithServices.Deps) *monolithServices.Module {
	plans := honeInfra.NewPlans(d.Pool)
	focus := honeInfra.NewFocus(d.Pool)
	streaks := honeInfra.NewStreaks(d.Pool)
	folders := honeInfra.NewFolders(d.Pool)
	// Quota-aware NoteRepo: gate срабатывает на ВСЕХ путях создания notes —
	// CreateNote RPC, RecordStandup, EndFocusSession reflection, whiteboard
	// snapshot export. Раньше check был только в HoneServer.CreateNote, и
	// юзеры обходили его через standup/focus/whiteboard и накапливали >limit
	// (юзер видел "SYNCED 13 / OVER LIMIT 10" в UI).
	noteQuotaCheck := func(ctx context.Context, uid uuid.UUID) error {
		return subscriptionServices.EnforceCreate(ctx, d, uid,
			honeNotesQuotaField,
			func(ctx context.Context, u uuid.UUID) (int, error) {
				if d.QuotaUsageReader == nil {
					return 0, nil
				}
				return d.QuotaUsageReader.CountSyncedNotes(ctx, u)
			})
	}
	notes := honeInfra.NewQuotaAwareNoteRepo(honeInfra.NewNotes(d.Pool), noteQuotaCheck)
	whiteboards := honeInfra.NewWhiteboards(d.Pool)
	resistance := honeInfra.NewResistance(d.Pool)
	queue := honeInfra.NewQueue(d.Pool)
	cueSessions := honeInfra.NewCueSessions(d.Pool)
	settings := honeInfra.NewSettingsRepo(d.Pool)
	external := honeInfra.NewExternalRepo(d.Pool)
	atlasTopics := honeInfra.NewAtlasTopicSearcher(d.Pool)
	atlasTracks := honeInfra.NewAtlasNodeTracksReader(d.Pool)

	// LLM adapters — pick real vs floor per config.
	var (
		synthesiser      honeDomain.PlanSynthesizer
		critiqueStreamer honeDomain.CritiqueStreamer
		embedder         honeDomain.Embedder
		summaryGrader    honeDomain.SummaryGrader
		writingGrader    honeDomain.WritingGrader
		reviewGrader     honeDomain.CodeReviewGrader
	)
	if d.LLMChain != nil {
		synthesiser = honeInfra.NewLLMChainPlanSynthesiser(d.LLMChain, d.Log)
		critiqueStreamer = honeInfra.NewLLMChainCritiqueStreamer(d.LLMChain, d.Log)
		summaryGrader = honeInfra.NewLLMChainSummaryGrader(d.LLMChain, d.Log)
		writingGrader = honeInfra.NewLLMChainWritingGrader(d.LLMChain, d.Log)
		reviewGrader = honeInfra.NewLLMChainCodeReviewGrader(d.LLMChain, d.Log)
		d.Log.Info("hone: LLM adapters wired (plan synthesis + whiteboard critique + summary grader + writing grader + code-review grader)")
	} else {
		synthesiser = honeInfra.NewNoLLMPlanSynthesiser()
		critiqueStreamer = honeInfra.NewNoLLMCritiqueStreamer()
		summaryGrader = honeInfra.NewNoLLMSummaryGrader()
		writingGrader = honeInfra.NewNoLLMWritingGrader()
		reviewGrader = honeInfra.NewNoLLMCodeReviewGrader()
		d.Log.Warn("hone: llmchain not configured — AI features (plan / critique / summary / writing / code-review graders) will return 503")
	}

	// Embedder wired off OLLAMA_HOST independently of the chain — the embed
	// model (bge-small) runs on the same sidecar that hosts the generative
	// floor model, but semantically they're separate concerns.
	if host := d.Cfg.LLMChain.OllamaHost; host != "" {
		embedder = honeInfra.NewHoneEmbedder(host, "") // "" → default bge-small
		d.Log.Info("hone: Ollama embedder wired", slog.String("ollama_host", host))
	} else {
		embedder = honeInfra.NewNoEmbedder()
		d.Log.Warn("hone: OLLAMA_HOST not set — notes auto-links will return 503")
	}

	// Cross-domain shim: weakest skill nodes from profile's tables. Lives
	// in adapters.go to keep boundaries clean (hone never imports profile).
	skills := NewHoneSkillAtlasAdapter(d.Pool)

	// Embedding job: CreateNote/UpdateNote enqueue job в Redis List, background
	// EmbedWorker дрейнит очередь и персистит вектора. Redis-less окружение
	// (tests) — fallback на in-process goroutine (Phase 4 поведение).
	var (
		embedFn     func(ctx context.Context, userID, noteID uuid.UUID, text string)
		embedWorker *honeApp.EmbedWorker
	)
	if d.Redis != nil {
		queue := honeInfra.NewRedisEmbedQueue(d.Redis)
		embedFn = func(ctx context.Context, userID, noteID uuid.UUID, text string) {
			// Enqueue под отдельным коротким timeout'ом: request-ctx может
			// cancel'нуться сразу после 200 OK, а мы всё ещё хотим поставить
			// job. 2 секунды — щедрый потолок для LPUSH.
			eCtx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
			defer cancel()
			if err := queue.Enqueue(eCtx, honeInfra.EmbedJob{UserID: userID, NoteID: noteID, Text: text}); err != nil {
				d.Log.Warn("hone: embed enqueue failed",
					slog.Any("err", err),
					slog.String("note_id", noteID.String()))
			}
		}
		embedWorker = &honeApp.EmbedWorker{
			Queue:    &honeEmbedQueueAdapter{q: queue},
			Embedder: embedder,
			Notes:    notes,
			Log:      d.Log,
			Now:      d.Now,
			PoolSize: 2,
		}
		d.Log.Info("hone: embed queue wired (Redis list)")
	} else {
		embedFn = makeHoneEmbedJob(embedder, notes, d.Log)
		d.Log.Warn("hone: Redis not configured — embed jobs run in-process (fire-and-forget)")
	}

	// Phase 10 — Categoriser instance, shared между Handler.CategoriseTask
	// и CreateTask UC (он использует его как auto-place hook).
	var categoriser *honeApp.CategoriseTask
	if d.LLMChain != nil {
		categoriser = &honeApp.CategoriseTask{Chain: d.LLMChain}
	}

	h := honeApp.NewHandler(honeApp.Handler{
		// Plan
		GeneratePlan:     &honeApp.GeneratePlan{Plans: plans, Skills: skills, Notes: notes, Resistance: resistance, Synthesiser: synthesiser, Queue: queue, Log: d.Log, Now: d.Now},
		GetPlan:          &honeApp.GetPlan{Plans: plans, Now: d.Now},
		DismissPlanItem:  &honeApp.DismissPlanItem{Plans: plans, Resistance: resistance, Log: d.Log, Now: d.Now, Memory: d.IntelligenceMemoryHook},
		CompletePlanItem: &honeApp.CompletePlanItem{Plans: plans, Now: d.Now, Memory: d.IntelligenceMemoryHook},

		// Focus
		StartFocus: &honeApp.StartFocus{Focus: focus, Log: d.Log, Now: d.Now},
		EndFocus:   &honeApp.EndFocus{Focus: focus, Streaks: streaks, Notes: notes, EmbedFn: embedFn, Log: d.Log, Now: d.Now, Memory: d.IntelligenceMemoryHook},
		GetStats:   &honeApp.GetStats{Streaks: streaks, Queue: queue, Now: d.Now},

		// Focus Queue
		ListQueue:        &honeApp.ListQueue{Queue: queue, Now: d.Now},
		AddUserItem:      &honeApp.AddUserItem{Queue: queue, Now: d.Now},
		UpdateItemStatus: &honeApp.UpdateItemStatus{Queue: queue},
		DeleteItem:       &honeApp.DeleteItem{Queue: queue},

		// Notes
		CreateNote:         &honeApp.CreateNote{Notes: notes, EmbedFn: embedFn, Log: d.Log, Now: d.Now, Memory: d.IntelligenceMemoryHook},
		UpdateNote:         &honeApp.UpdateNote{Notes: notes, EmbedFn: embedFn, Log: d.Log, Now: d.Now, Memory: d.IntelligenceMemoryHook},
		GetNote:            &honeApp.GetNote{Notes: notes},
		ListNotes:          &honeApp.ListNotes{Notes: notes},
		DeleteNote:         &honeApp.DeleteNote{Notes: notes},
		MoveNote:           &honeApp.MoveNote{Notes: notes},
		GetNoteConnections: &honeApp.GetNoteConnections{Notes: notes, Embedder: embedder, Log: d.Log},
		SuggestNoteLinks: &honeApp.SuggestNoteLinks{
			Notes:     notes,
			Embedder:  embedder,
			Suggester: NewHoneLinkSuggester(d.IntelligenceLinkSuggester),
			Log:       d.Log,
		},

		// Phase 10 — AI auto-place TaskBoard. Optional: nil-safe в callers.
		// Активен когда LLMChain wired (free-tier groq/cerebras 8B).
		CategoriseTask: categoriser,

		// Folders
		CreateFolder: &honeApp.CreateFolder{Folders: folders, Now: d.Now},
		ListFolders:  &honeApp.ListFolders{Folders: folders},
		DeleteFolder: &honeApp.DeleteFolder{Folders: folders},

		// Whiteboards
		CreateWhiteboard:   &honeApp.CreateWhiteboard{Boards: whiteboards, Now: d.Now},
		UpdateWhiteboard:   &honeApp.UpdateWhiteboard{Boards: whiteboards, Now: d.Now},
		GetWhiteboard:      &honeApp.GetWhiteboard{Boards: whiteboards},
		ListWhiteboards:    &honeApp.ListWhiteboards{Boards: whiteboards},
		DeleteWhiteboard:   &honeApp.DeleteWhiteboard{Boards: whiteboards},
		CritiqueWhiteboard: &honeApp.CritiqueWhiteboard{Boards: whiteboards, Streamer: critiqueStreamer, Log: d.Log},
		SaveCritiqueAsNote: &honeApp.SaveCritiqueAsNote{Boards: whiteboards, Notes: notes, EmbedFn: embedFn, Log: d.Log, Now: d.Now},

		// Standup
		RecordStandup:   &honeApp.RecordStandup{Notes: notes, Plans: plans, EmbedFn: embedFn, Log: d.Log, Now: d.Now, Memory: d.IntelligenceMemoryHook},
		GetTodayStandup: &honeApp.GetTodayStandup{Notes: notes, Queue: queue, Now: d.Now},

		// Cue Sessions
		ImportCueSession:         &honeApp.ImportCueSession{Repo: cueSessions, Log: d.Log, Now: d.Now},
		ListCueSessions:          &honeApp.ListCueSessions{Repo: cueSessions},
		GetCueSession:            &honeApp.GetCueSession{Repo: cueSessions},
		UpdateCueSession:         &honeApp.UpdateCueSession{Repo: cueSessions},
		DeleteCueSession:         &honeApp.DeleteCueSession{Repo: cueSessions},
		SendCueSessionToTelegram: &honeApp.SendCueSessionToTelegram{Repo: cueSessions, Sender: d.HoneNotificationSender, Log: d.Log},

		// User settings (active study mode).
		GetUserSettings:  &honeApp.GetUserSettings{Repo: settings},
		SetActiveTrack:   &honeApp.SetActiveTrack{Repo: settings, Now: d.Now},
		SetEnglishActive: &honeApp.SetEnglishActive{Repo: settings, Now: d.Now},

		// External activity logging. CoachAppender — nil-safe; задача #4
		// (intelligence integration) повесит сюда appender который пишет
		// в coach_episodes для AI-tutor recall + daily-brief mention.
		AddExternalActivity:    &honeApp.AddExternalActivity{Repo: external, CoachAppender: d.ExternalActivityCoachAppender, Now: d.Now, Log: d.Log},
		ListExternalActivity:   &honeApp.ListExternalActivity{Repo: external},
		DeleteExternalActivity: &honeApp.DeleteExternalActivity{Repo: external},
		SearchAtlasTopics:      &honeApp.SearchAtlasTopics{Searcher: atlasTopics},
		ListAtlasNodeTracks:    &honeApp.ListAtlasNodeTracks{Reader: atlasTracks},

		Log: d.Log,
		Now: d.Now,
	})

	// Phase 5 reflection auto-link: intelligence.LogResource UC получает
	// NoteCreator hook, который создаёт hone_notes row и enqueue'ит
	// embedding job. После embedding'а — reflection note сам появляется
	// в SuggestNoteLinks suggestions для упомянутых атлас-узлов (ничего
	// LLM-extract не нужно для MVP).
	if d.IntelligenceLogResource != nil {
		d.IntelligenceLogResource.NoteCreator = NewHoneReflectionNoteCreator(
			notes, embedFn, d.Log, d.Now,
		)
		d.Log.Info("hone: reflection NoteCreator wired into intelligence.LogResource")
	}

	server := honePorts.NewHoneServer(h)
	// Rate-limit GenerateDailyPlan(force=true). Redis-less deployments
	// (tests) leave the limiter nil → the handler falls through unlimited.
	if d.Redis != nil {
		server = server.WithPlanLimiter(ratelimit.NewRedisFixedWindow(d.Redis))
	}
	// Pro-gate для премиум-RPC (GeneratePlan / Critique / Connections).
	// nil-safe: subscription-таблица нет — все Pro, gate выключен.
	server = server.WithTier(NewHoneTierAdapter(d.Pool))
	// Phase 2 quota enforcement: free-tier лимит на synced_notes (default 10).
	// nil-safe (см. EnforceCreate). Closure inline'на, чтобы захватить Deps.
	server = server.WithCreateNoteQuotaCheck(func(ctx context.Context, uid uuid.UUID) error {
		return subscriptionServices.EnforceCreate(ctx, d, uid,
			honeNotesQuotaField,
			func(ctx context.Context, u uuid.UUID) (int, error) {
				if d.QuotaUsageReader == nil {
					return 0, nil
				}
				return d.QuotaUsageReader.CountSyncedNotes(ctx, u)
			})
	})
	// Per-procedure Prometheus metrics (Connect-слой) — ChiMiddleware дает
	// только route-level агрегат, который для RPC мало полезен.
	connectPath, connectHandler := druz9v1connect.NewHoneServiceHandler(
		server,
		connect.WithInterceptors(metrics.ConnectInterceptor()),
	)
	transcoder := monolithServices.MustTranscode("hone", connectPath, connectHandler)

	mod := &monolithServices.Module{
		ConnectPath:        connectPath,
		ConnectHandler:     transcoder,
		RequireConnectAuth: true,
		MountREST: func(r chi.Router) {
			// quotaWrap — оборачивает write-handler в storage gate
			// (если он есть). Read'ы и delete'ы — без gate'а: delete
			// освобождает место, блокировать его при quota_exceeded
			// — это софт-локаут юзера. Plan/focus тоже не gate'аем:
			// сами по себе они почти не пишут (focus_session.delta
			// — байты, а не килобайты).
			quotaWrap := func(h http.HandlerFunc) http.HandlerFunc {
				if d.StorageGate == nil {
					return h
				}
				return d.StorageGate.Middleware(h).ServeHTTP
			}

			// Plan
			r.Post("/hone/plan/generate", transcoder.ServeHTTP)
			r.Get("/hone/plan", transcoder.ServeHTTP)
			r.Post("/hone/plan/dismiss", transcoder.ServeHTTP)
			r.Post("/hone/plan/complete", transcoder.ServeHTTP)
			// Focus
			r.Post("/hone/focus/start", transcoder.ServeHTTP)
			r.Post("/hone/focus/end", transcoder.ServeHTTP)
			r.Get("/hone/stats", transcoder.ServeHTTP)
			// Notes — write-routes за quota gate'ом
			r.Post("/hone/notes", quotaWrap(transcoder.ServeHTTP))
			r.Post("/hone/notes/update", quotaWrap(transcoder.ServeHTTP))
			r.Get("/hone/notes", transcoder.ServeHTTP)
			r.Get("/hone/notes/{id}", transcoder.ServeHTTP)
			r.Post("/hone/notes/delete", transcoder.ServeHTTP)
			r.Post("/hone/notes/move", transcoder.ServeHTTP)
			// Folders
			r.Post("/hone/folders", transcoder.ServeHTTP)
			r.Get("/hone/folders", transcoder.ServeHTTP)
			r.Post("/hone/folders/delete", transcoder.ServeHTTP)
			// Whiteboards — write-routes за quota gate'ом
			r.Post("/hone/whiteboards", quotaWrap(transcoder.ServeHTTP))
			r.Post("/hone/whiteboards/update", quotaWrap(transcoder.ServeHTTP))
			r.Get("/hone/whiteboards", transcoder.ServeHTTP)
			r.Get("/hone/whiteboards/{id}", transcoder.ServeHTTP)
			r.Post("/hone/whiteboards/delete", transcoder.ServeHTTP)
			// GetNoteConnections / CritiqueWhiteboard — server-streaming.
			// Clients use Connect native transport, no REST alias needed.
		},
	}
	if embedWorker != nil {
		mod.Background = append(mod.Background, func(ctx context.Context) { go embedWorker.Run(ctx) })
	}

	// Streak reconciliation — периодически чинит (user, day)-пары где
	// agg focus_sessions разошёлся с streak_days (EndFocus упал на apply'е).
	// Крутится всегда, независимо от Redis — зависит только от БД.
	reconciler := &honeApp.StreakReconciler{
		Streaks:           streaks,
		Log:               d.Log,
		Interval:          15 * time.Minute,
		Lookback:          48 * time.Hour,
		QualifyingSeconds: honeApp.MinQualifyingFocusSeconds,
	}
	mod.Background = append(mod.Background, func(ctx context.Context) { go reconciler.Run(ctx) })

	// Notes overflow auto-archive — free-tier юзеры могли набрать > limit
	// notes до wire'инга quota gate'а (или race'ом). Cron archived'ит
	// oldest-by-updated_at beyond лимита (10 для free) каждый час.
	// Юзер видит «SYNCED 10 / 10» вместо «12 / OVER LIMIT 10».
	mod.Background = append(mod.Background, func(ctx context.Context) {
		go subscriptionServices.RunFreeTierNotesOverflowArchive(ctx, d.Pool, d.Log)
	})

	// ── TaskBoard (v2) wiring ────────────────────────────────────────────
	tasksRepo := honeInfra.NewTaskRepo(d.Pool)
	skillsReader := honeInfra.NewSkillAtlasReader(d.Pool)
	activeUsers := honeInfra.NewActiveUsersReader(d.Pool)

	// CursorEventBus + ReviewAnimator power the AI-cursor visual.
	cursorBus := honeInfra.NewInProcessCursorBus()
	animator := &honeApp.ReviewAnimator{Cursor: cursorBus, Log: d.Log}

	// CoachListener subscribes to bus events and translates them into
	// task transitions + AI comments + cursor animations + XP rewards.
	coachListener := &honeApp.CoachListener{
		Tasks: tasksRepo, Animator: animator, Bus: d.Bus, Log: d.Log,
	}
	if d.Bus != nil {
		coachListener.Register(d.Bus)
	}

	// CoachGenerator — periodic AI suggestions per active user.
	spawner := &honeApp.SpawnAITask{Tasks: tasksRepo, Log: d.Log}
	coachGen := &honeApp.CoachGenerator{
		Tasks:       tasksRepo,
		Skills:      skillsReader,
		ActiveUsers: activeUsers,
		Spawner:     spawner,
		Log:         d.Log,
		Now:         d.Now,
	}
	mod.Background = append(mod.Background, func(ctx context.Context) { go coachGen.Run(ctx) })

	// TaskCleanupWorker — TTL 14d sweep for abandoned `todo` cards.
	taskCleanup := &honeApp.TaskCleanupWorker{
		Sweep: &honeApp.AutoDismissExpired{Tasks: tasksRepo, Log: d.Log, Now: d.Now},
		Log:   d.Log,
	}
	mod.Background = append(mod.Background, func(ctx context.Context) { go taskCleanup.Run(ctx) })

	// Wire the TaskBoard use cases into the existing HoneService Handler.
	// The Connect server (services/hone/ports) already implements ListTasks /
	// CreateTask / MoveTaskStatus / DeleteTask / Add+ListTaskComments and
	// vanguard transcodes /api/v1/hone/tasks/* into them.
	// R4 perf: bounded Categoriser pool (replaces raw `go func()`).
	// nil-safe — CreateTask.Do falls back to raw goroutine when pool nil.
	var categoriserPool honeApp.AsyncSubmitter
	if d.CategoriserPool != nil {
		categoriserPool = d.CategoriserPool
	}
	// R4 perf: in-memory TTL cache на ListTasks. 15m TTL покрывает burst
	// polling (frontend опрашивает на focus change), inline-invalidate
	// в Create/Move/Delete keeps данные corrent. 4096 max keys.
	tasksCache := ttlcache.New[[]honeDomainTaskAlias](15*time.Minute, 4096)
	h.CreateTask = &honeApp.CreateTask{
		Tasks:           tasksRepo,
		Log:             d.Log,
		Categoriser:     categoriser,
		CursorBus:       cursorBus,
		CategoriserPool: categoriserPool,
		Cache:           tasksCache,
	}
	h.ListTasks = &honeApp.ListTasks{Tasks: tasksRepo, Cache: tasksCache}
	h.MoveTaskStatus = &honeApp.MoveTaskStatus{Tasks: tasksRepo, Log: d.Log, Cache: tasksCache}
	h.DeleteTask = &honeApp.DeleteTask{Tasks: tasksRepo, Cache: tasksCache}
	h.AddTaskComment = &honeApp.AddTaskComment{Tasks: tasksRepo}
	h.ListTaskComments = &honeApp.ListTaskComments{Tasks: tasksRepo}

	// Publish-to-web JSON endpoints. /p/{slug} HTML viewer stays chi
	// (rendered with strict CSP — proto codec can't shape that response).
	publishRepo := honeInfra.NewPublishRepo(d.Pool, d.Log)
	h.PublishNote = &honeApp.PublishNote{Repo: publishRepo, Log: d.Log}
	h.UnpublishNote = &honeApp.UnpublishNote{Repo: publishRepo, Log: d.Log}
	h.PublishStatusUC = &honeApp.PublishStatus{Repo: publishRepo, Log: d.Log}
	h.BulkNotesMeta = &honeApp.BulkNotesMeta{Repo: publishRepo, Log: d.Log}
	h.ShareToWeb = &honeApp.ShareToWeb{Repo: publishRepo, Publisher: d.SyncEventBroker, Log: d.Log}
	h.MakePrivate = &honeApp.MakePrivate{Repo: publishRepo, Publisher: d.SyncEventBroker, Log: d.Log}

	// Reading-модуль (Wave 4 of docs/feature/english.md). Library, reader
	// sessions, Leitner SRS vocab. Repo backed by hone_reading_* tables
	// (migration 00013); free-form English content owned by Hone.
	readingRepo := honeInfra.NewReadingRepo(d.Pool)
	h.AddReadingMaterial = &honeApp.AddReadingMaterial{Repo: readingRepo}
	h.UpdateBookProgress = &honeApp.UpdateBookProgress{Repo: readingRepo}
	h.GetReadingMaterial = &honeApp.GetReadingMaterial{Repo: readingRepo}
	h.ListReadingMaterials = &honeApp.ListReadingMaterials{Repo: readingRepo}
	h.ArchiveReadingMaterial = &honeApp.ArchiveReadingMaterial{Repo: readingRepo, Now: d.Now}
	h.StartReadingSession = &honeApp.StartReadingSession{Repo: readingRepo}
	// Wave 4.3: EndReadingSession optionally calls the LLM-backed grader
	// inline. nil-safe — useCase swallows errors so a slow / down provider
	// just leaves ai_summary_score NULL.
	h.EndReadingSession = &honeApp.EndReadingSession{Repo: readingRepo, Grader: summaryGrader, Log: d.Log, Now: d.Now}
	h.AddVocab = &honeApp.AddVocab{Repo: readingRepo}
	h.ReviewVocab = &honeApp.ReviewVocab{Repo: readingRepo, Now: d.Now}
	h.ListVocabDue = &honeApp.ListVocabDue{Repo: readingRepo, Now: d.Now}
	// Wave 4.2 reverse cross-link.
	h.ListVocabBySourceMaterial = &honeApp.ListVocabBySourceMaterial{Repo: readingRepo}

	// Wave 4.4: Writing-as-Focus AI grader. nil-safe — when llmchain is
	// not configured, writingGrader is the floor adapter that returns
	// ErrLLMUnavailable, which the handler translates to 503.
	h.GradeEnglishWriting = &honeApp.GradeEnglishWriting{Grader: writingGrader}

	// Wave 3.6: Code-review-coaching grader. Same nil-safety as above.
	h.GradeCodeReview = &honeApp.GradeCodeReview{Grader: reviewGrader}

	// Wave 6.1: Listening-модуль (audio + transcript library). Click-on-
	// word reuses the AddVocab use case wired above; vocab queue is
	// shared across Reading + Listening surfaces.
	listeningRepo := honeInfra.NewListeningRepo(d.Pool)
	h.AddListeningMaterial = &honeApp.AddListeningMaterial{Repo: listeningRepo}
	h.GetListeningMaterial = &honeApp.GetListeningMaterial{Repo: listeningRepo}
	h.ListListeningMaterials = &honeApp.ListListeningMaterials{Repo: listeningRepo}
	h.ArchiveListeningMaterial = &honeApp.ArchiveListeningMaterial{Repo: listeningRepo, Now: d.Now}
	// YouTube transcript ingestion (Sergey 2026-05-03). yt-dlp бинарь должен
	// быть на PATH api контейнера; если нет — handler вернёт 503 при
	// первом вызове, фронт показывает «manual paste only». Wave dev:
	// ставим всегда, real check на runtime.
	h.IngestYouTubeListening = &honeApp.IngestYouTubeListening{
		Repo:    listeningRepo,
		Fetcher: honeInfra.NewYouTubeFetcher(),
		Now:     d.Now,
	}

	cursorSSE := &cursorSSEHandler{bus: cursorBus, log: d.Log}

	prevMount := mod.MountREST
	mod.MountREST = func(r chi.Router) {
		prevMount(r)
		// REST aliases (defined via google.api.http in hone.proto) — the
		// transcoder is already mounted via ConnectHandler at the connect
		// path; we add the human-friendly REST routes pointing at the same
		// transcoder.
		r.Get("/hone/tasks", transcoder.ServeHTTP)
		r.Post("/hone/tasks", transcoder.ServeHTTP)
		r.Post("/hone/tasks/{id}/status", transcoder.ServeHTTP)
		r.Delete("/hone/tasks/{id}", transcoder.ServeHTTP)
		r.Get("/hone/tasks/{id}/comments", transcoder.ServeHTTP)
		r.Post("/hone/tasks/{id}/comments", transcoder.ServeHTTP)
		// Publish-to-web JSON endpoints — /p/{slug} HTML viewer is mounted
		// separately on MountRoot by the publishing module.
		r.Post("/notes/{id}/publish", transcoder.ServeHTTP)
		r.Post("/notes/{id}/unpublish", transcoder.ServeHTTP)
		r.Get("/notes/{id}/publish-status", transcoder.ServeHTTP)
		r.Post("/notes/{id}/share-to-web", transcoder.ServeHTTP)
		r.Post("/notes/{id}/make-private", transcoder.ServeHTTP)
		r.Get("/notes/meta", transcoder.ServeHTTP)
		// Reading-модуль REST aliases (Wave 4).
		r.Post("/hone/reading/materials", transcoder.ServeHTTP)
		r.Get("/hone/reading/materials", transcoder.ServeHTTP)
		r.Get("/hone/reading/materials/{id}", transcoder.ServeHTTP)
		r.Post("/hone/reading/materials/{id}/archive", transcoder.ServeHTTP)
		r.Post("/hone/reading/materials/{id}/book-progress", transcoder.ServeHTTP)
		r.Post("/hone/reading/sessions/start", transcoder.ServeHTTP)
		r.Post("/hone/reading/sessions/end", transcoder.ServeHTTP)
		r.Post("/hone/reading/vocab", transcoder.ServeHTTP)
		r.Post("/hone/reading/vocab/review", transcoder.ServeHTTP)
		r.Get("/hone/reading/vocab/due", transcoder.ServeHTTP)
		// Wave 4.2 — reverse cross-link reader → saved vocab.
		r.Get("/hone/reading/materials/{material_id}/vocab", transcoder.ServeHTTP)
		// Writing-as-Focus REST alias (Wave 4.4).
		r.Post("/hone/writing/grade", transcoder.ServeHTTP)
		// Code-review-coaching REST alias (Wave 3.6).
		r.Post("/hone/code-review/grade", transcoder.ServeHTTP)
		// Listening-модуль REST aliases (Wave 6.1).
		r.Post("/hone/listening/materials", transcoder.ServeHTTP)
		r.Get("/hone/listening/materials", transcoder.ServeHTTP)
		r.Get("/hone/listening/materials/{id}", transcoder.ServeHTTP)
		r.Post("/hone/listening/materials/{id}/archive", transcoder.ServeHTTP)
		r.Post("/hone/listening/youtube", transcoder.ServeHTTP)
		// User settings (active study mode).
		r.Get("/hone/settings", transcoder.ServeHTTP)
		r.Post("/hone/settings/active-track", transcoder.ServeHTTP)
		r.Post("/hone/settings/english-active", transcoder.ServeHTTP)
		// External activity logging.
		r.Post("/hone/external-activity", transcoder.ServeHTTP)
		r.Get("/hone/external-activity", transcoder.ServeHTTP)
		r.Post("/hone/external-activity/delete", transcoder.ServeHTTP)
		r.Get("/hone/external-activity/atlas-topics", transcoder.ServeHTTP)
		r.Get("/hone/atlas-node-tracks", transcoder.ServeHTTP)
		cursorSSE.Mount(r)
	}

	return mod
}

// makeHoneEmbedJob returns the EmbedFn handed to CreateNote/UpdateNote. The
// function is fire-and-forget from the caller's perspective: the note is
// already saved, we just enrich it with an embedding when possible.
//
// A background-context is used intentionally — the HTTP request context is
// cancelled the moment the client gets their 200, but the embed job must
// outlive it. Errors are logged, not returned (no surface to return to).
func makeHoneEmbedJob(
	embedder honeDomain.Embedder,
	notes honeDomain.NoteRepo,
	log *slog.Logger,
) func(ctx context.Context, userID, noteID uuid.UUID, text string) {
	return func(ctx context.Context, userID, noteID uuid.UUID, text string) {
		vec, model, err := embedder.Embed(ctx, text)
		if err != nil {
			log.Debug("hone: embed skipped",
				slog.Any("err", err),
				slog.String("user_id", userID.String()),
				slog.String("note_id", noteID.String()))
			return
		}
		// Persist the vector. The note may have been updated again in the
		// meantime — that's fine, the next Update kicks a fresh embed job
		// and this write becomes harmless overwrite-of-identical-or-stale.
		//
		// time.Now() rather than Deps.Now because the embed goroutine runs
		// after the request context (and its clock) has been dismissed.
		if err := notes.SetEmbedding(ctx, userID, noteID, vec, model, time.Now().UTC()); err != nil {
			log.Warn("hone: embed persist failed",
				slog.Any("err", err),
				slog.String("note_id", noteID.String()))
		}
	}
}

// honeNotesQuotaField — accessor для domain.QuotaPolicy.SyncedNotes.
func honeNotesQuotaField(p subDomain.QuotaPolicy) int {
	return p.SyncedNotes
}
