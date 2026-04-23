package infra

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"druz9/daily/domain"
	"druz9/daily/domain/mocks"

	"github.com/google/uuid"
	"go.uber.org/mock/gomock"
)

func silentLog() *slog.Logger { return slog.New(slog.NewTextHandler(io.Discard, nil)) }

// fakeJudge0Server returns a base64-encoded stdout from a stub map keyed by
// the decoded stdin. Anything not in the map → status 11 (Runtime error).
func fakeJudge0Server(t *testing.T, stdoutByStdin map[string]string) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !strings.HasPrefix(r.URL.Path, "/submissions") {
			http.Error(w, "not found", http.StatusNotFound)
			return
		}
		var req judge0SubmissionReq
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "bad", http.StatusBadRequest)
			return
		}
		stdinBytes, _ := base64.StdEncoding.DecodeString(req.Stdin)
		stdout, ok := stdoutByStdin[string(stdinBytes)]
		resp := judge0SubmissionResp{}
		if ok {
			resp.Status.ID = judge0StatusAccepted
			resp.Status.Description = "Accepted"
			resp.Stdout = base64.StdEncoding.EncodeToString([]byte(stdout))
		} else {
			resp.Status.ID = 11
			resp.Status.Description = "Runtime Error (NZEC)"
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(resp)
	}))
}

func TestJudge0SandboxExecutor_AllPass(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	tcRepo := mocks.NewMockTestCaseRepo(ctrl)
	taskID := uuid.New()
	tcRepo.EXPECT().ListForTask(gomock.Any(), taskID).Return([]domain.TestCase{
		{Input: "1", Expected: "ok", Order: 0},
		{Input: "2", Expected: "ok", Order: 1},
	}, nil)

	srv := fakeJudge0Server(t, map[string]string{"1": "ok\n", "2": "ok"})
	defer srv.Close()

	exec := NewJudge0SandboxExecutor(NewJudge0HTTPClient(srv.URL, silentLog()), tcRepo, silentLog())
	passed, total, ok, err := exec.Submit(context.Background(), "package main", "go", domain.TaskPublic{ID: taskID})
	if err != nil {
		t.Fatalf("unexpected err: %v", err)
	}
	if !passed || total != 2 || ok != 2 {
		t.Fatalf("got passed=%v total=%d ok=%d", passed, total, ok)
	}
}

func TestJudge0SandboxExecutor_PartialFail(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	tcRepo := mocks.NewMockTestCaseRepo(ctrl)
	taskID := uuid.New()
	tcRepo.EXPECT().ListForTask(gomock.Any(), taskID).Return([]domain.TestCase{
		{Input: "1", Expected: "ok", Order: 0},
		{Input: "2", Expected: "different", Order: 1},
	}, nil)

	srv := fakeJudge0Server(t, map[string]string{"1": "ok", "2": "ok"})
	defer srv.Close()

	exec := NewJudge0SandboxExecutor(NewJudge0HTTPClient(srv.URL, silentLog()), tcRepo, silentLog())
	passed, total, ok, err := exec.Submit(context.Background(), "x", "python", domain.TaskPublic{ID: taskID})
	if err != nil {
		t.Fatalf("unexpected err: %v", err)
	}
	if passed || total != 2 || ok != 1 {
		t.Fatalf("got passed=%v total=%d ok=%d", passed, total, ok)
	}
}

func TestJudge0SandboxExecutor_TransportFail_503(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	tcRepo := mocks.NewMockTestCaseRepo(ctrl)
	taskID := uuid.New()
	tcRepo.EXPECT().ListForTask(gomock.Any(), taskID).Return([]domain.TestCase{
		{Input: "1", Expected: "ok"},
	}, nil)

	// Server that always 500s — simulates Judge0 outage / overload.
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		http.Error(w, "boom", http.StatusInternalServerError)
	}))
	defer srv.Close()

	exec := NewJudge0SandboxExecutor(NewJudge0HTTPClient(srv.URL, silentLog()), tcRepo, silentLog())
	_, _, _, err := exec.Submit(context.Background(), "x", "go", domain.TaskPublic{ID: taskID})
	if !errors.Is(err, domain.ErrSandboxUnavailable) {
		t.Fatalf("expected ErrSandboxUnavailable, got %v", err)
	}
}

func TestJudge0SandboxExecutor_NoTaskID_503(t *testing.T) {
	t.Parallel()
	exec := NewJudge0SandboxExecutor(NewJudge0HTTPClient("http://invalid", silentLog()),
		mocks.NewMockTestCaseRepo(gomock.NewController(t)), silentLog())
	_, _, _, err := exec.Submit(context.Background(), "x", "go", domain.TaskPublic{})
	if !errors.Is(err, domain.ErrSandboxUnavailable) {
		t.Fatalf("expected ErrSandboxUnavailable, got %v", err)
	}
}

func TestJudge0SandboxExecutor_UnsupportedLanguage_503(t *testing.T) {
	t.Parallel()
	exec := NewJudge0SandboxExecutor(NewJudge0HTTPClient("http://invalid", silentLog()),
		mocks.NewMockTestCaseRepo(gomock.NewController(t)), silentLog())
	_, _, _, err := exec.Submit(context.Background(), "x", "sql", domain.TaskPublic{ID: uuid.New()})
	if !errors.Is(err, domain.ErrSandboxUnavailable) {
		t.Fatalf("expected ErrSandboxUnavailable for sql, got %v", err)
	}
}

func TestJudge0SandboxExecutor_NoTestCases_503(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	tcRepo := mocks.NewMockTestCaseRepo(ctrl)
	taskID := uuid.New()
	tcRepo.EXPECT().ListForTask(gomock.Any(), taskID).Return([]domain.TestCase{}, nil)

	exec := NewJudge0SandboxExecutor(NewJudge0HTTPClient("http://invalid", silentLog()), tcRepo, silentLog())
	_, _, _, err := exec.Submit(context.Background(), "x", "go", domain.TaskPublic{ID: taskID})
	if !errors.Is(err, domain.ErrSandboxUnavailable) {
		t.Fatalf("expected ErrSandboxUnavailable, got %v", err)
	}
}

func TestEqualsStdout_TrimsTrailing(t *testing.T) {
	t.Parallel()
	if !equalsStdout("hello", "hello\n") {
		t.Fatal("expected equality with trailing newline")
	}
	if !equalsStdout("hello\n", "hello") {
		t.Fatal("expected symmetric trim")
	}
	if equalsStdout("hello", "world") {
		t.Fatal("expected inequality")
	}
}
