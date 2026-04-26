package services

import (
	"strings"

	miApp "druz9/mock_interview/app"
	miDomain "druz9/mock_interview/domain"
	miInfra "druz9/mock_interview/infra"
	miPorts "druz9/mock_interview/ports"

	"github.com/go-chi/chi/v5"
)

// NewMockInterview wires the Phase A admin CRUD + Phase B orchestrator
// surface for the multi-stage mock interview pipeline (ADR-002).
//
// No Connect mount — the surface is large (~30 RPCs) and not yet stable
// enough to lock into proto. Everything is chi-direct REST under
// /api/v1/admin/mock/* (admin) and /api/v1/mock/* (any user).
//
// requireAdmin is enforced inside the handler (mirrors services/admin
// pattern); the gated REST chain only enforces bearer auth.
func NewMockInterview(d Deps) *Module {
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

	// Phase B orchestrator + LLM judge.
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
		Now:    d.Now,
		Log:    d.Log,
	}

	server := miPorts.NewServer(handlers, orch, d.Log)

	return &Module{
		MountREST: func(r chi.Router) {
			server.Mount(r)
		},
	}
}
