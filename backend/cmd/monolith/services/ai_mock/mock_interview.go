package ai_mock

import (
	"context"
	"fmt"
	"strings"

	monolithServices "druz9/cmd/monolith/services"
	miApp "druz9/mock_interview/app"
	miDomain "druz9/mock_interview/domain"
	miInfra "druz9/mock_interview/infra"
	miPorts "druz9/mock_interview/ports"
	profileInfra "druz9/profile/infra"
	"druz9/shared/generated/pb/druz9/v1/druz9v1connect"
	"druz9/shared/pkg/userlocale"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
)

// NewMockInterview wires the admin CRUD + orchestrator surface for
// the multi-stage mock interview pipeline (per ADR-002).
//
// No Connect mount — the surface is large (~30 RPCs) and not yet stable
// enough to lock into proto. Everything is chi-direct REST under
// /api/v1/admin/mock/* (admin) and /api/v1/mock/* (any user).
//
// requireAdmin is enforced inside the handler (mirrors services/admin
// pattern); the gated REST chain only enforces bearer auth.
func NewMockInterview(d monolithServices.Deps) *monolithServices.Module {
	companies := miInfra.NewCompanies(d.Pool)
	strictness := miInfra.NewStrictness(d.Pool)
	tasks := miInfra.NewTasks(d.Pool)
	questions := miInfra.NewQuestions(d.Pool)
	companyStages := miInfra.NewCompanyStages(d.Pool)
	pipelines := miInfra.NewPipelines(d.Pool)
	pipelineStages := miInfra.NewPipelineStages(d.Pool)
	attempts := miInfra.NewPipelineAttempts(d.Pool)
	// Leaderboard reads are cached for 60s — see infra/cache.go for the
	// rationale (full-scan aggregate that would stall the connection pool
	// under peak load on a 12 GB-RAM box).
	rawLeaderboard := miInfra.NewLeaderboard(d.Pool)
	var leaderboard miDomain.LeaderboardRepo = rawLeaderboard
	if d.Redis != nil {
		leaderboard = miInfra.NewCachedLeaderboardRepo(
			rawLeaderboard,
			miInfra.NewRedisKV(d.Redis),
			miInfra.DefaultLeaderboardTTL,
			d.Log,
		)
	}

	mockTestCases := miInfra.NewMockTaskTestCases(d.Pool)

	handlers := miApp.NewHandlers(
		companies, strictness, tasks, questions, companyStages,
		pipelines, pipelineStages, attempts, leaderboard, mockTestCases,
	)
	if d.Now != nil {
		handlers.Now = d.Now
	}

	// Orchestrator + LLM judge.
	judge := miApp.NewLLMJudge(d.LLMChain, d.Log)

	// F-2: code-execution sandbox for task_solve attempts. JUDGE0_URL points
	// at the docker-compose `judge0-server`; when unset we wire the explicit
	// unconfigured fallback so the orchestrator transparently uses LLM-only
	// judging (anti-fallback policy: no silent fake-pass). We reuse
	// mockTestCases declared above for both the admin CRUD wiring and the
	// sandbox loader.
	var sandbox miDomain.SandboxExecutor = miInfra.NewUnconfiguredSandbox()
	if u := strings.TrimSpace(d.Cfg.Judge0.URL); u != "" {
		sandbox = miInfra.NewJudge0Sandbox(u, mockTestCases, d.Log)
		d.Log.Info("mock_interview: Judge0 sandbox wired", "url", u)
	} else {
		d.Log.Warn("mock_interview: JUDGE0_URL not set — task_solve attempts will be LLM-only")
	}

	orch := &miApp.Orchestrator{
		Pipelines:      pipelines,
		PipelineStages: pipelineStages,
		Attempts:       attempts,
		Questions:      questions,
		Tasks:          tasks,
		CompanyStages:  companyStages,
		Strictness:     handlers, // *Handlers implements ResolveStrictness
		Judge:          judge,
		Sandbox:        sandbox,
		// Redis fallback for the sysdesign canvas autosave. Frontend uses
		// localStorage as primary; this only fires on quota exhaustion.
		CanvasDrafts: miInfra.NewRedisCanvasDrafts(d.Redis),
		// Coach memory tap — emits a `mock_pipeline_finished` episode on
		// every FinishPipeline so future Daily Briefs reference past
		// sessions. nil-safe; bootstrap sets it when intelligence is
		// wired (always, in current setup).
		Memory: d.IntelligenceMockMemoryHook,
		// Atlas bump — translates each finished stage's score into the
		// matching atlas node's `progress` (см.
		// orchestrator.bumpAtlasFromStages). Уж лучше иметь движение по
		// атласу, чем «прошёл мок — а атлас не изменился».
		Skills: mockSkillsAdapter{repo: profileInfra.NewPostgres(d.Pool)},
		// Bus drives publishers — Hone's CoachListener subscribes to
		// MockPipelineFinished to settle kind=sysdesign / kind=reflection
		// tasks. nil-safe: in dev runs without bus everything else still
		// works, just no fan-out.
		Bus: d.Bus,
		// X5: emit struggle marks for low-axis stages so the web AtlasPage
		// highlights what the user is stuck on. nil-safe — the producer
		// returns a nil hook when the UC isn't wired (dev runs without
		// intelligence) and the orchestrator short-circuits.
		Struggle: newAtlasStruggleProducer(d.IntelligenceMarkAtlasStruggle, d.Log),
		Locale:   userlocale.NewPostgresReader(d.Pool),
		Now:      d.Now,
		Log:      d.Log,
	}

	server := miPorts.NewServer(handlers, orch, d.Log)
	// R2: Algo «Run tests» dry-run. Shares the same Judge0 sandbox as the
	// orchestrator's SubmitAnswer override, but bypasses the LLM judge so
	// candidates can iterate quickly without burning provider quota.
	server.AlgoGrader = &miApp.AlgoGrader{
		Sandbox:  sandbox,
		Attempts: attempts,
		Tasks:    tasks,
		Stages:   pipelineStages,
		Log:      d.Log,
	}
	// R2 (closing wave): Coding / SysDesign / Behavioral iterative rubric
	// graders. All three share the free LLM cascade (d.LLMChain); when the
	// chain is nil (no provider configured) graders degrade to a structured
	// unavailable verdict instead of faking a score.
	server.CodingGrader = &miApp.CodingGrader{
		Chain:    d.LLMChain,
		Attempts: attempts,
		Tasks:    tasks,
		Stages:   pipelineStages,
		Log:      d.Log,
	}
	server.SysDesignGrader = &miApp.SysDesignGrader{
		Chain:    d.LLMChain,
		Attempts: attempts,
		Tasks:    tasks,
		Stages:   pipelineStages,
		Log:      d.Log,
	}
	server.BehavioralGrader = &miApp.BehavioralGrader{
		Chain:    d.LLMChain,
		Attempts: attempts,
		Stages:   pipelineStages,
		Log:      d.Log,
	}
	// Post-debrief replay. attempts is shared (it implements both
	// PipelineAttemptRepo and ReplayRepo via the postgres_replay.go methods
	// on the same struct).
	server.Replay = &miApp.MockReplay{
		D: miApp.MockReplayDeps{
			Attempts: attempts,
			Replays:  attempts, // same struct, dual-role interface satisfier
			Chain:    d.LLMChain,
			Log:      d.Log,
			Now:      d.Now,
		},
	}

	// Incremental chi→proto migration. 4 public read endpoints
	// (/mock/companies, /mock/pipelines, /mock/pipelines/{id},
	// /mock/leaderboard) теперь идут через MockPipelineService Connect
	// + REST aliases via vanguard transcoder. Остальные admin/mutating
	// endpoints остаются на chi-direct в Server.Mount() пока. Дублирование
	// /api/v1/mock/* paths нет — chi handler'ы для перенесённых путей
	// удалены из Mount() одновременно с этой регистрацией.
	connectPath, connectHandler := druz9v1connect.NewMockPipelineServiceHandler(server)
	transcoder := monolithServices.MustTranscode("mock_pipeline", connectPath, connectHandler)

	return &monolithServices.Module{
		ConnectPath:        connectPath,
		ConnectHandler:     transcoder,
		RequireConnectAuth: true,
		MountREST: func(r chi.Router) {
			// Migrated endpoints — REST через transcoder.
			r.Get("/mock/companies", transcoder.ServeHTTP)
			r.Get("/mock/pipelines", transcoder.ServeHTTP)
			r.Get("/mock/pipelines/{id}", transcoder.ServeHTTP)
			r.Get("/mock/leaderboard", transcoder.ServeHTTP)
			// slice 2:
			r.Post("/mock/pipelines", transcoder.ServeHTTP)
			r.Post("/mock/pipelines/{id}/cancel", transcoder.ServeHTTP)
			r.Get("/mock/attempts/{id}/finalised", transcoder.ServeHTTP)
			// slice 3 (orchestrator):
			r.Post("/mock/pipelines/{id}/start-next-stage", transcoder.ServeHTTP)
			r.Post("/mock/attempts/{id}/submit", transcoder.ServeHTTP)
			r.Post("/mock/stages/{id}/finish", transcoder.ServeHTTP)
			// R2: Algo «Run tests» (dry-run, no persist).
			r.Post("/mock/attempts/{id}/run-algo", transcoder.ServeHTTP)
			// R2 (closing): Coding / SysDesign / Behavioral rubric runs.
			r.Post("/mock/attempts/{id}/run-coding", transcoder.ServeHTTP)
			r.Post("/mock/attempts/{id}/run-sysdesign", transcoder.ServeHTTP)
			r.Post("/mock/attempts/{id}/run-behavioral", transcoder.ServeHTTP)
			// slice 4 (admin companies + strictness):
			r.Get("/admin/mock/companies", transcoder.ServeHTTP)
			r.Post("/admin/mock/companies", transcoder.ServeHTTP)
			r.Patch("/admin/mock/companies/{id}", transcoder.ServeHTTP)
			r.Post("/admin/mock/companies/{id}/active", transcoder.ServeHTTP)
			r.Get("/admin/mock/strictness", transcoder.ServeHTTP)
			r.Post("/admin/mock/strictness", transcoder.ServeHTTP)
			r.Patch("/admin/mock/strictness/{id}", transcoder.ServeHTTP)
			// slice 5 (admin tasks):
			r.Get("/admin/mock/tasks", transcoder.ServeHTTP)
			r.Get("/admin/mock/tasks/{id}", transcoder.ServeHTTP)
			r.Post("/admin/mock/tasks", transcoder.ServeHTTP)
			r.Patch("/admin/mock/tasks/{id}", transcoder.ServeHTTP)
			r.Post("/admin/mock/tasks/{id}/active", transcoder.ServeHTTP)
			// slice 6 (admin task questions + test-cases):
			r.Post("/admin/mock/tasks/{id}/questions", transcoder.ServeHTTP)
			r.Patch("/admin/mock/task-questions/{id}", transcoder.ServeHTTP)
			r.Delete("/admin/mock/task-questions/{id}", transcoder.ServeHTTP)
			r.Get("/admin/mock/tasks/{id}/test-cases", transcoder.ServeHTTP)
			r.Post("/admin/mock/tasks/{id}/test-cases", transcoder.ServeHTTP)
			r.Patch("/admin/mock/test-cases/{id}", transcoder.ServeHTTP)
			r.Delete("/admin/mock/test-cases/{id}", transcoder.ServeHTTP)
			// slice 7 (admin default + company questions):
			r.Get("/admin/mock/default-questions", transcoder.ServeHTTP)
			r.Post("/admin/mock/default-questions", transcoder.ServeHTTP)
			r.Patch("/admin/mock/default-questions/{id}", transcoder.ServeHTTP)
			r.Delete("/admin/mock/default-questions/{id}", transcoder.ServeHTTP)
			r.Get("/admin/mock/companies/{id}/questions", transcoder.ServeHTTP)
			r.Post("/admin/mock/companies/{id}/questions", transcoder.ServeHTTP)
			r.Patch("/admin/mock/company-questions/{id}", transcoder.ServeHTTP)
			r.Delete("/admin/mock/company-questions/{id}", transcoder.ServeHTTP)
			// slice 8 (admin company stages + bulk-import — финальный mock-able пакет):
			r.Get("/admin/mock/companies/{id}/stages", transcoder.ServeHTTP)
			r.Put("/admin/mock/companies/{id}/stages", transcoder.ServeHTTP)
			r.Post("/admin/mock/tasks/bulk-import", transcoder.ServeHTTP)
			// Остался только canvas binary (4 endpoints) — legit-chi exception.
			server.Mount(r)
		},
	}
}

// mockSkillsAdapter satisfies miDomain.SkillNodeWriter via profile's
// existing Postgres repo. Lives here (cross-context wiring) so neither
// bounded context имеет узнавать другой через import.
type mockSkillsAdapter struct {
	repo *profileInfra.Postgres
}

var _ miDomain.SkillNodeWriter = mockSkillsAdapter{}

func (a mockSkillsAdapter) UpsertSkillNode(ctx context.Context, userID uuid.UUID, nodeKey string, progress int) error {
	if _, err := a.repo.UpsertSkillNode(ctx, userID, nodeKey, progress); err != nil {
		return fmt.Errorf("mock_interview.skills_adapter: %w", err)
	}
	return nil
}
