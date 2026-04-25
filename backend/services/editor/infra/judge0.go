// judge0.go — minimal Judge0 HTTP adapter for one-shot RunCode.
//
// Unlike daily/arena (test-case grading), the editor domain only needs a
// single synchronous execution: (code, language) → (stdout, stderr,
// exit_code, time_ms, status). No per-task grading, no fixture stdin.
//
// Anti-fallback policy (same as daily): if the sandbox is unreachable or
// Judge0.URL is empty, the use case returns ErrSandboxUnavailable so the
// transport renders Unavailable (503) instead of silently succeeding.
package infra

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"time"

	"druz9/editor/domain"
	"druz9/shared/enums"
)

// DefaultRunTimeout bounds a single RunCode call — request contract is 10 s.
const DefaultRunTimeout = 10 * time.Second

// Judge0RunClient wraps the /submissions?wait=true endpoint for one-shot runs.
//
// Zero-value BaseURL is the documented "disabled sandbox" shape: RunCode
// returns ErrSandboxUnavailable so the caller can map to 503.
type Judge0RunClient struct {
	BaseURL string
	HC      *http.Client
	Log     *slog.Logger
}

// NewJudge0RunClient builds a client. A nil log panics — same anti-fallback
// stance as daily.infra.NewJudge0HTTPClient.
func NewJudge0RunClient(baseURL string, log *slog.Logger) *Judge0RunClient {
	if log == nil {
		panic("editor.infra.NewJudge0RunClient: log is required")
	}
	return &Judge0RunClient{
		BaseURL: strings.TrimRight(baseURL, "/"),
		HC:      &http.Client{Timeout: DefaultRunTimeout + 5*time.Second},
		Log:     log,
	}
}

type judge0RunReq struct {
	SourceCode string `json:"source_code"`
	LanguageID int    `json:"language_id"`
}

type judge0RunResp struct {
	Stdout        string `json:"stdout"`
	Stderr        string `json:"stderr"`
	CompileOutput string `json:"compile_output"`
	Message       string `json:"message"`
	Status        struct {
		ID          int    `json:"id"`
		Description string `json:"description"`
	} `json:"status"`
	Time     string `json:"time"`
	ExitCode int    `json:"exit_code"`
}

// Run executes code once and returns the decoded result.
func (c *Judge0RunClient) Run(ctx context.Context, code string, language enums.Language) (domain.RunResult, error) {
	if c.BaseURL == "" {
		return domain.RunResult{}, fmt.Errorf("editor.Judge0RunClient.Run: %w: Judge0.URL unset", domain.ErrSandboxUnavailable)
	}
	langID, ok := languageID(language)
	if !ok {
		return domain.RunResult{}, fmt.Errorf("editor.Judge0RunClient.Run: %w: language %q not supported", domain.ErrSandboxUnavailable, language)
	}

	body, err := json.Marshal(judge0RunReq{
		SourceCode: base64.StdEncoding.EncodeToString([]byte(code)),
		LanguageID: langID,
	})
	if err != nil {
		return domain.RunResult{}, fmt.Errorf("editor.Judge0RunClient.Run: marshal: %w", err)
	}

	url := c.BaseURL + "/submissions?base64_encoded=true&wait=true"
	runCtx, cancel := context.WithTimeout(ctx, DefaultRunTimeout)
	defer cancel()
	req, err := http.NewRequestWithContext(runCtx, http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return domain.RunResult{}, fmt.Errorf("editor.Judge0RunClient.Run: build req: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.HC.Do(req)
	if err != nil {
		c.Log.WarnContext(ctx, "editor.Judge0RunClient: transport error", slog.Any("err", err))
		return domain.RunResult{}, fmt.Errorf("editor.Judge0RunClient.Run: %w: %s", domain.ErrSandboxUnavailable, err.Error())
	}
	defer func() { _ = resp.Body.Close() }()
	raw, err := io.ReadAll(resp.Body)
	if err != nil {
		return domain.RunResult{}, fmt.Errorf("editor.Judge0RunClient.Run: read: %w", err)
	}
	if resp.StatusCode/100 != 2 {
		return domain.RunResult{}, fmt.Errorf("editor.Judge0RunClient.Run: %w: status %d: %s",
			domain.ErrSandboxUnavailable, resp.StatusCode, string(raw))
	}

	var out judge0RunResp
	if err := json.Unmarshal(raw, &out); err != nil {
		return domain.RunResult{}, fmt.Errorf("editor.Judge0RunClient.Run: decode: %w", err)
	}

	stdoutBytes, _ := base64.StdEncoding.DecodeString(out.Stdout)
	stderrBytes, _ := base64.StdEncoding.DecodeString(out.Stderr)
	compileBytes, _ := base64.StdEncoding.DecodeString(out.CompileOutput)

	// If the program failed to compile, Judge0 returns compile_output and
	// empty stderr — surface it under stderr so the UI has one place to look.
	stderrStr := string(stderrBytes)
	if len(compileBytes) > 0 {
		if stderrStr != "" {
			stderrStr += "\n"
		}
		stderrStr += string(compileBytes)
	}

	// time is returned as a decimal seconds string, e.g. "0.034".
	timeMs := int32(0)
	if out.Time != "" {
		if f, perr := strconv.ParseFloat(out.Time, 64); perr == nil {
			timeMs = int32(f * 1000)
		}
	}

	return domain.RunResult{
		Stdout:   string(stdoutBytes),
		Stderr:   stderrStr,
		ExitCode: int32(out.ExitCode),
		TimeMs:   timeMs,
		Status:   out.Status.Description,
	}, nil
}

// languageID resolves a shared Language enum to Judge0's language_id. Unknown
// or unsupported languages (SQL) return (0, false) — callers map this to
// ErrSandboxUnavailable so the HTTP layer returns Unavailable.
func languageID(lang enums.Language) (int, bool) {
	switch lang {
	case enums.LanguageGo:
		return 60, true
	case enums.LanguagePython:
		return 71, true
	case enums.LanguageJavaScript:
		return 63, true
	case enums.LanguageTypeScript:
		return 74, true
	case enums.LanguageSQL:
		// Stock Judge0 cannot run SQL — same policy as daily/infra/judge0_client.
		return 0, false
	default:
		return 0, false
	}
}

// Guard: interface wiring is shared by the use case via domain.CodeRunner.
var _ domain.CodeRunner = (*Judge0RunClient)(nil)

// Sanity: ensure sentinel is re-exportable for error mapping tests.
var _ = errors.Is
