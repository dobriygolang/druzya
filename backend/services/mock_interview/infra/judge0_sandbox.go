// judge0_sandbox.go — Judge0 adapter for mock_interview task_solve attempts.
//
// Mirrors services/daily/infra/judge0_client.go (kept duplicated rather than
// shared so each domain can evolve independently — same rationale as the
// canvas/podcast minio split). Single Submit per attempt loops over every
// test case via /submissions?wait=true and aggregates exact-match stdout.
//
// Anti-fallback: any transport error or unsupported language returns
// ErrSandboxUnavailable. Orchestrator degrades to LLM-only judging.
package infra

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"golang.org/x/sync/errgroup"

	"druz9/mock_interview/domain"
	"druz9/shared/enums"

	"github.com/google/uuid"
)

// judge0StatusAccepted — Judge0 status id for "Accepted".
const judge0StatusAccepted = 3

// Judge0SandboxTimeout bounds a single per-case execution.
const Judge0SandboxTimeout = 15 * time.Second

// Judge0Sandbox is the domain.SandboxExecutor backed by a self-hosted
// Judge0 instance (docker-compose: judge0-server).
type Judge0Sandbox struct {
	BaseURL string
	HTTP    *http.Client
	Cases   domain.MockTaskTestCaseRepo
	Log     *slog.Logger
}

// NewJudge0Sandbox panics on nil deps (anti-fallback policy).
func NewJudge0Sandbox(baseURL string, cases domain.MockTaskTestCaseRepo, log *slog.Logger) *Judge0Sandbox {
	if cases == nil || log == nil {
		panic("mock_interview.NewJudge0Sandbox: cases/log are required")
	}
	return &Judge0Sandbox{
		BaseURL: strings.TrimRight(baseURL, "/"),
		HTTP:    &http.Client{Timeout: Judge0SandboxTimeout + 5*time.Second},
		Cases:   cases,
		Log:     log,
	}
}

// Available — true iff a base URL is set.
func (s *Judge0Sandbox) Available() bool { return s != nil && s.BaseURL != "" }

// languageID resolves the shared Language enum to a Judge0 language id.
// Stock Judge0 v1.13.1 ids; SQL is unsupported (Judge0 has no SQL runtime,
// see services/daily/infra/judge0_client.go for the historical context).
//
// Why not a free string: keeps mock_interview's sandbox path consistent
// with daily's, and means a typo in `mock_tasks.language` raises at the
// enum boundary rather than silently returning ok=false.
func languageID(lang enums.Language) (int, bool) {
	switch lang {
	case enums.LanguageGo:
		return 60, true // Go 1.13.5
	case enums.LanguagePython:
		return 71, true // Python 3.8.1
	case enums.LanguageJavaScript:
		return 63, true // Node.js 12.14.0
	case enums.LanguageTypeScript:
		return 74, true // TypeScript 3.7.4
	case enums.LanguageSQL:
		return 0, false
	default:
		return 0, false
	}
}

type j0Req struct {
	SourceCode string `json:"source_code"`
	Stdin      string `json:"stdin"`
	LanguageID int    `json:"language_id"`
}

type j0Resp struct {
	Stdout string `json:"stdout"`
	Status struct {
		ID          int    `json:"id"`
		Description string `json:"description"`
	} `json:"status"`
}

// Submit runs the user's code against every test case for the task. Returns
// ErrSandboxUnavailable on transport-level failure or unsupported language.
func (s *Judge0Sandbox) Submit(ctx context.Context, code string, language enums.Language, taskID uuid.UUID) (domain.SandboxResult, error) {
	if !s.Available() {
		return domain.SandboxResult{}, fmt.Errorf("mock_interview.Judge0Sandbox.Submit: %w", domain.ErrSandboxUnavailable)
	}
	if taskID == uuid.Nil {
		return domain.SandboxResult{}, fmt.Errorf("mock_interview.Judge0Sandbox.Submit: %w: task_id required", domain.ErrSandboxUnavailable)
	}
	langID, ok := languageID(language)
	if !ok {
		return domain.SandboxResult{}, fmt.Errorf("mock_interview.Judge0Sandbox.Submit: %w: language %q", domain.ErrSandboxUnavailable, language)
	}
	cases, err := s.Cases.ListForTask(ctx, taskID)
	if err != nil {
		return domain.SandboxResult{}, fmt.Errorf("mock_interview.Judge0Sandbox.Submit: load cases: %w", err)
	}
	if len(cases) == 0 {
		return domain.SandboxResult{}, fmt.Errorf("mock_interview.Judge0Sandbox.Submit: %w: no test cases for task %s", domain.ErrSandboxUnavailable, taskID)
	}
	total := len(cases)
	// Run cases in parallel with a small concurrency cap. Sequential
	// `wait=true` calls were monopolising one DB pool conn for ~75s on a
	// 5-case task (see backend perf audit). Cap at 3 — Judge0 is happy
	// with a few concurrent requests, and we don't want to flood the
	// shared docker container with 50 simultaneous compiles either.
	const maxConcurrent = 3
	g, gctx := errgroup.WithContext(ctx)
	g.SetLimit(maxConcurrent)
	results := make([]bool, total)
	for i, tc := range cases {
		i, tc := i, tc
		g.Go(func() error {
			ok, runErr := s.runOne(gctx, code, tc.Input, tc.Expected, langID)
			if runErr != nil {
				return runErr
			}
			results[i] = ok
			return nil
		})
	}
	if err := g.Wait(); err != nil {
		s.Log.WarnContext(ctx, "mock_interview.Judge0Sandbox: run failed",
			slog.String("task_id", taskID.String()), slog.Any("err", err))
		// Count successes that completed before the first failure so the
		// caller can show partial progress in the slog stream.
		passed := 0
		for _, ok := range results {
			if ok {
				passed++
			}
		}
		return domain.SandboxResult{Total: total, PassedCount: passed},
			fmt.Errorf("mock_interview.Judge0Sandbox.Submit: %w: %s", domain.ErrSandboxUnavailable, err.Error())
	}
	passed := 0
	for _, ok := range results {
		if ok {
			passed++
		}
	}
	score := float32(0)
	if total > 0 {
		score = float32(passed) / float32(total) * 100
	}
	verdict := domain.AttemptVerdictFail
	if passed == total {
		verdict = domain.AttemptVerdictPass
	}
	return domain.SandboxResult{
		Total:       total,
		PassedCount: passed,
		Score:       score,
		Verdict:     verdict,
	}, nil
}

// runOne — POST one /submissions?wait=true call. Returns (passed, err). err
// non-nil only on transport failure; compile/runtime errors surface as
// passed=false.
func (s *Judge0Sandbox) runOne(ctx context.Context, code, stdin, expected string, langID int) (bool, error) {
	body, err := json.Marshal(j0Req{
		SourceCode: base64.StdEncoding.EncodeToString([]byte(code)),
		Stdin:      base64.StdEncoding.EncodeToString([]byte(stdin)),
		LanguageID: langID,
	})
	if err != nil {
		return false, fmt.Errorf("marshal: %w", err)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost,
		s.BaseURL+"/submissions?base64_encoded=true&wait=true", bytes.NewReader(body))
	if err != nil {
		return false, fmt.Errorf("build req: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := s.HTTP.Do(req)
	if err != nil {
		return false, fmt.Errorf("do: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()
	raw, err := io.ReadAll(resp.Body)
	if err != nil {
		return false, fmt.Errorf("read: %w", err)
	}
	if resp.StatusCode/100 != 2 {
		return false, fmt.Errorf("status %d: %s", resp.StatusCode, string(raw))
	}
	var out j0Resp
	if err := json.Unmarshal(raw, &out); err != nil {
		return false, fmt.Errorf("decode: %w", err)
	}
	if out.Status.ID != judge0StatusAccepted {
		return false, nil
	}
	stdout, _ := base64.StdEncoding.DecodeString(out.Stdout)
	return equalsStdout(expected, string(stdout)), nil
}

func equalsStdout(expected, actual string) bool {
	return strings.TrimRight(expected, " \t\r\n") == strings.TrimRight(actual, " \t\r\n")
}

// ─── unconfigured fallback ───────────────────────────────────────────────

// UnconfiguredSandbox — explicit no-op. Every Submit returns
// ErrSandboxUnavailable so the orchestrator falls back to LLM-only judging.
type UnconfiguredSandbox struct{}

// NewUnconfiguredSandbox wires the fallback.
func NewUnconfiguredSandbox() *UnconfiguredSandbox { return &UnconfiguredSandbox{} }

// Available always returns false.
func (UnconfiguredSandbox) Available() bool { return false }

// Submit always returns ErrSandboxUnavailable.
func (UnconfiguredSandbox) Submit(_ context.Context, _ string, _ enums.Language, _ uuid.UUID) (domain.SandboxResult, error) {
	return domain.SandboxResult{}, fmt.Errorf("mock_interview.sandbox.unconfigured: %w", domain.ErrSandboxUnavailable)
}

// Compile-time guards.
var (
	_ domain.SandboxExecutor = (*Judge0Sandbox)(nil)
	_ domain.SandboxExecutor = (*UnconfiguredSandbox)(nil)
)
