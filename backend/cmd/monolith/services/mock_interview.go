package services

import (
	"context"
	"log/slog"
	"os"
	"strings"
	"time"

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
	leaderboard := miInfra.NewLeaderboard(d.Pool)

	handlers := miApp.NewHandlers(
		companies, strictness, tasks, questions, companyStages,
		pipelines, pipelineStages, attempts, leaderboard,
	)
	if d.Now != nil {
		handlers.Now = d.Now
	}

	// Phase B orchestrator + LLM judge.
	judge := miApp.NewLLMJudge(d.LLMChain, d.Log)

	// F-3: out-of-band canvas image storage. When MinIO creds are wired we
	// construct the real store + ensure the bucket on boot; otherwise we
	// pass the explicit unconfigured fallback so SubmitCanvas degrades to
	// inline-data-url storage rather than crashing.
	var canvas miDomain.CanvasStore = miInfra.NewUnconfiguredCanvasStore()
	if d.Cfg.MinIO.AccessKey != "" && d.Cfg.MinIO.SecretKey != "" && d.Cfg.MinIO.Endpoint != "" {
		miStore := miInfra.NewMinIOCanvasStore(
			d.Cfg.MinIO.Endpoint,
			d.Cfg.MinIO.PublicEndpoint,
			d.Cfg.MinIO.AccessKey,
			d.Cfg.MinIO.SecretKey,
			minioBucketMockCanvas(),
			d.Cfg.MinIO.UseSSL,
		)
		bootCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		if err := miStore.EnsureBucket(bootCtx); err != nil {
			d.Log.Warn("mock_interview: minio EnsureBucket failed; manual `mc mb` may be required",
				slog.String("bucket", minioBucketMockCanvas()),
				slog.Any("err", err))
		}
		cancel()
		canvas = miStore
	}

	// F-2: code-execution sandbox for task_solve attempts. JUDGE0_URL points
	// at the docker-compose `judge0-server`; when unset we wire the explicit
	// unconfigured fallback so the orchestrator transparently uses LLM-only
	// judging (anti-fallback policy: no silent fake-pass).
	mockTestCases := miInfra.NewMockTaskTestCases(d.Pool)
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
		Canvas:         canvas,
		Sandbox:        sandbox,
		Now:            d.Now,
		Log:            d.Log,
	}

	server := miPorts.NewServer(handlers, orch, canvas, d.Log)

	return &Module{
		MountREST: func(r chi.Router) {
			server.Mount(r)
		},
	}
}

// minioBucketMockCanvas reads MINIO_BUCKET_MOCK_CANVAS, default "mock-canvas".
// Domain-local — we don't bloat shared/pkg/config for every bucket name.
func minioBucketMockCanvas() string {
	if v := os.Getenv("MINIO_BUCKET_MOCK_CANVAS"); v != "" {
		return v
	}
	return "mock-canvas"
}
