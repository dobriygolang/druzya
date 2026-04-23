// judge0_client.go — real code-execution adapter backed by a self-hosted
// Judge0 container (see docker-compose.yml: judge0-server, judge0-workers,
// judge0-db, judge0-redis on the isolated judge-net network).
//
// Contract:
//
//  1. For each grading test case, POST /submissions?wait=true to Judge0 with
//     base64 source + stdin + language_id, read the response synchronously.
//  2. A case passes iff Judge0 reports status.id == 3 (Accepted) AND the
//     trimmed stdout exactly matches the expected_output (trimmed).
//  3. All cases passed ⇒ Judge0Client.Submit returns (passed=true).
//     Any non-2xx HTTP, any compile/runtime error, any mismatch ⇒ passed=false.
//  4. Transport errors (connection refused, 5xx, timeout) bubble up as
//     ErrSandboxUnavailable so the handler can render 503 — anti-fallback
//     policy: we NEVER report a pass when we could not actually execute.
//
// Language → language_id mapping uses Judge0's v1.13.1 defaults. SQL is NOT
// supported by stock Judge0; we return ErrSandboxUnavailable for now (the
// /daily/run UX already tolerates this — SQL katas will need a Postgres-based
// executor in a follow-up).
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

	"druz9/daily/domain"
	"druz9/shared/enums"

	"github.com/google/uuid"
)

// Judge0 status id 3 = "Accepted" per the upstream status table.
const judge0StatusAccepted = 3

// DefaultJudge0Timeout bounds a single per-case execution. The JSON call
// through ?wait=true blocks until the worker finishes, so this wraps both
// Judge0's internal cpu/wall limits and any container scheduling stall.
const DefaultJudge0Timeout = 15 * time.Second

// Judge0HTTPClient is the raw HTTP client around one Judge0 instance.
type Judge0HTTPClient struct {
	baseURL string
	hc      *http.Client
	log     *slog.Logger
}

// NewJudge0HTTPClient panics on nil log (anti-fallback policy — no silent
// slog.Default fallback, we want the operator to notice missing DI).
func NewJudge0HTTPClient(baseURL string, log *slog.Logger) *Judge0HTTPClient {
	if log == nil {
		panic("daily.infra.NewJudge0HTTPClient: log is required")
	}
	return &Judge0HTTPClient{
		baseURL: strings.TrimRight(baseURL, "/"),
		hc:      &http.Client{Timeout: DefaultJudge0Timeout + 5*time.Second},
		log:     log,
	}
}

// judge0SubmissionReq / judge0SubmissionResp mirror the subset of Judge0's
// /submissions?wait=true payload that we care about. All strings are
// base64-encoded per the API contract.
type judge0SubmissionReq struct {
	SourceCode string `json:"source_code"`
	Stdin      string `json:"stdin"`
	LanguageID int    `json:"language_id"`
}

type judge0SubmissionResp struct {
	Stdout        string `json:"stdout"`
	Stderr        string `json:"stderr"`
	CompileOutput string `json:"compile_output"`
	Message       string `json:"message"`
	Status        struct {
		ID          int    `json:"id"`
		Description string `json:"description"`
	} `json:"status"`
	Time   string `json:"time"`
	Memory int    `json:"memory"`
}

// runOne executes one test case. Returns (passed, stdout, status-description,
// err). err is non-nil only on transport failure — compile/runtime errors
// surface as passed=false so the caller can aggregate across cases.
func (c *Judge0HTTPClient) runOne(ctx context.Context, code, stdin string, langID int) (bool, string, string, error) {
	body, err := json.Marshal(judge0SubmissionReq{
		SourceCode: base64.StdEncoding.EncodeToString([]byte(code)),
		Stdin:      base64.StdEncoding.EncodeToString([]byte(stdin)),
		LanguageID: langID,
	})
	if err != nil {
		return false, "", "", fmt.Errorf("daily.Judge0HTTPClient.runOne: marshal: %w", err)
	}
	url := c.baseURL + "/submissions?base64_encoded=true&wait=true"
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return false, "", "", fmt.Errorf("daily.Judge0HTTPClient.runOne: build req: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.hc.Do(req)
	if err != nil {
		return false, "", "", fmt.Errorf("daily.Judge0HTTPClient.runOne: do: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()
	raw, err := io.ReadAll(resp.Body)
	if err != nil {
		return false, "", "", fmt.Errorf("daily.Judge0HTTPClient.runOne: read: %w", err)
	}
	if resp.StatusCode/100 != 2 {
		return false, "", "", fmt.Errorf("daily.Judge0HTTPClient.runOne: status %d: %s", resp.StatusCode, string(raw))
	}

	var out judge0SubmissionResp
	if err := json.Unmarshal(raw, &out); err != nil {
		return false, "", "", fmt.Errorf("daily.Judge0HTTPClient.runOne: decode: %w", err)
	}
	stdout, _ := base64.StdEncoding.DecodeString(out.Stdout)
	// stderr / compile_output captured for potential future UX — we currently
	// only surface the verdict to the frontend to keep the wire shape tight.
	return out.Status.ID == judge0StatusAccepted, string(stdout), out.Status.Description, nil
}

// languageID resolves the Language enum to a Judge0 language id. Unknown
// languages return (0, false); SQL is deliberately unsupported (see header).
func languageID(lang string) (int, bool) {
	switch enums.Language(lang) {
	case enums.LanguageGo:
		return 60, true // Go 1.13.5
	case enums.LanguagePython:
		return 71, true // Python 3.8.1
	case enums.LanguageJavaScript:
		return 63, true // Node.js 12.14.0
	case enums.LanguageTypeScript:
		return 74, true // TypeScript 3.7.4
	case enums.LanguageSQL:
		// Stock Judge0 cannot run SQL — see header. The caller maps this
		// to ErrSandboxUnavailable so /daily/run returns 503 for SQL katas
		// until a Postgres-backed executor lands.
		return 0, false
	default:
		return 0, false
	}
}

// Judge0SandboxExecutor is the domain.Judge0Client adapter. It iterates over
// the task's test cases, calls Judge0HTTPClient per case, aggregates pass/fail,
// and maps transport failure to ErrSandboxUnavailable so transports render 503.
type Judge0SandboxExecutor struct {
	HTTP  *Judge0HTTPClient
	Cases domain.TestCaseRepo
	Log   *slog.Logger
}

// NewJudge0SandboxExecutor panics on missing dependencies (anti-fallback).
func NewJudge0SandboxExecutor(h *Judge0HTTPClient, cases domain.TestCaseRepo, log *slog.Logger) *Judge0SandboxExecutor {
	if h == nil || cases == nil || log == nil {
		panic("daily.infra.NewJudge0SandboxExecutor: http/cases/log are required")
	}
	return &Judge0SandboxExecutor{HTTP: h, Cases: cases, Log: log}
}

// Submit satisfies domain.Judge0Client.
func (e *Judge0SandboxExecutor) Submit(ctx context.Context, code, language string, task domain.TaskPublic) (bool, int, int, error) {
	if task.ID == uuid.Nil {
		// No task context ⇒ no grading set ⇒ we cannot honestly verify.
		return false, 0, 0, fmt.Errorf("daily.Judge0SandboxExecutor.Submit: %w", domain.ErrSandboxUnavailable)
	}
	langID, ok := languageID(language)
	if !ok {
		return false, 0, 0, fmt.Errorf("daily.Judge0SandboxExecutor.Submit: %w: language %q", domain.ErrSandboxUnavailable, language)
	}
	cases, err := e.Cases.ListForTask(ctx, task.ID)
	if err != nil {
		return false, 0, 0, fmt.Errorf("daily.Judge0SandboxExecutor.Submit: load cases: %w", err)
	}
	if len(cases) == 0 {
		// A task with zero grading rows is a content bug, not a sandbox
		// outage — but returning passed=true would violate anti-fallback,
		// so surface 503 until the operator seeds cases.
		return false, 0, 0, fmt.Errorf("daily.Judge0SandboxExecutor.Submit: no test cases for task %s: %w", task.ID, domain.ErrSandboxUnavailable)
	}

	total := len(cases)
	passedCount := 0
	for _, tc := range cases {
		accepted, stdout, desc, runErr := e.HTTP.runOne(ctx, code, tc.Input, langID)
		if runErr != nil {
			// Transport-level failure ⇒ translate to ErrSandboxUnavailable
			// so the handler surfaces 503. The original error is wrapped
			// (visible in slog) — the sentinel governs HTTP mapping.
			e.Log.WarnContext(ctx, "daily.Judge0SandboxExecutor: run failed",
				slog.String("task_id", task.ID.String()), slog.Any("err", runErr))
			return false, total, passedCount, fmt.Errorf("daily.Judge0SandboxExecutor.Submit: run: %w: %s", domain.ErrSandboxUnavailable, runErr.Error())
		}
		if !accepted {
			e.Log.DebugContext(ctx, "daily.Judge0SandboxExecutor: case rejected by judge",
				slog.String("status", desc), slog.Bool("hidden", tc.IsHidden))
			continue
		}
		if !equalsStdout(tc.Expected, stdout) {
			e.Log.DebugContext(ctx, "daily.Judge0SandboxExecutor: case stdout mismatch",
				slog.Bool("hidden", tc.IsHidden))
			continue
		}
		passedCount++
	}
	return passedCount == total, total, passedCount, nil
}

// equalsStdout trims trailing whitespace / newlines on both sides before
// comparing. Judge0 often appends a trailing \n that the seed data does not.
func equalsStdout(expected, actual string) bool {
	return strings.TrimRight(expected, " \t\r\n") == strings.TrimRight(actual, " \t\r\n")
}

// Interface guard.
var _ domain.Judge0Client = (*Judge0SandboxExecutor)(nil)
