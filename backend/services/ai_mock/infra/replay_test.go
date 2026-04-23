package infra

import (
	"compress/gzip"
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
)

func TestMinIOReplayUploader_HappyPath(t *testing.T) {
	var (
		gotPath   string
		gotMethod string
		gotBody   []byte
		gotAuth   string
		gotEnc    string
	)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		gotMethod = r.Method
		gotAuth = r.Header.Get("Authorization")
		gotEnc = r.Header.Get("Content-Encoding")
		body, _ := io.ReadAll(r.Body)
		gotBody = body
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	u := NewMinIOReplayUploader(srv.URL, "AKIA-test", "secret-test", false)
	u.now = func() time.Time { return time.Date(2026, 4, 22, 12, 0, 0, 0, time.UTC) }
	sessionID := uuid.MustParse("11111111-2222-3333-4444-555555555555")

	url, err := u.Upload(context.Background(), sessionID, []byte(`{"hello":"world"}`))
	if err != nil {
		t.Fatalf("Upload: %v", err)
	}

	if gotMethod != http.MethodPut {
		t.Errorf("method = %q, want PUT", gotMethod)
	}
	if !strings.HasPrefix(gotPath, "/ai-mock-replays/replays/"+sessionID.String()+"/") {
		t.Errorf("unexpected object path: %q", gotPath)
	}
	if !strings.HasSuffix(gotPath, ".json.gz") {
		t.Errorf("expected .json.gz suffix, got %q", gotPath)
	}
	if gotEnc != "gzip" {
		t.Errorf("expected Content-Encoding gzip, got %q", gotEnc)
	}
	if !strings.Contains(gotAuth, "AWS4-HMAC-SHA256") {
		t.Errorf("expected v4 auth header, got %q", gotAuth)
	}

	// Decompress body and verify roundtrip.
	gr, err := gzip.NewReader(strings.NewReader(string(gotBody)))
	if err != nil {
		t.Fatalf("gunzip: %v", err)
	}
	defer gr.Close()
	plain, _ := io.ReadAll(gr)
	if string(plain) != `{"hello":"world"}` {
		t.Errorf("unexpected payload: %q", plain)
	}

	// Verify presigned URL shape.
	if !strings.Contains(url, "X-Amz-Algorithm=AWS4-HMAC-SHA256") {
		t.Errorf("URL missing X-Amz-Algorithm: %s", url)
	}
	if !strings.Contains(url, "X-Amz-Expires=") {
		t.Errorf("URL missing X-Amz-Expires: %s", url)
	}
	if !strings.Contains(url, "X-Amz-Signature=") {
		t.Errorf("URL missing X-Amz-Signature: %s", url)
	}
	// 7 days = 604800 seconds.
	if !strings.Contains(url, "X-Amz-Expires=604800") {
		t.Errorf("URL expires not 7d: %s", url)
	}
}

func TestMinIOReplayUploader_NotFoundResponse(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusForbidden)
		_, _ = w.Write([]byte("AccessDenied"))
	}))
	defer srv.Close()

	u := NewMinIOReplayUploader(srv.URL, "k", "s", false)
	_, err := u.Upload(context.Background(), uuid.New(), []byte("x"))
	if err == nil {
		t.Fatal("expected error on 403 response")
	}
	if !strings.Contains(err.Error(), "403") {
		t.Errorf("expected 403 in error, got: %v", err)
	}
}

func TestMinIOReplayUploader_MissingCredentials(t *testing.T) {
	u := NewMinIOReplayUploader("localhost:9000", "", "", false)
	_, err := u.Upload(context.Background(), uuid.New(), []byte("x"))
	if err == nil || !strings.Contains(err.Error(), "missing endpoint") {
		t.Errorf("expected missing-creds error, got: %v", err)
	}
}

func TestMinIOReplayUploader_CtxCancelled(t *testing.T) {
	u := NewMinIOReplayUploader("http://localhost:9000", "k", "s", false)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	_, err := u.Upload(ctx, uuid.New(), []byte("x"))
	if err == nil {
		t.Fatal("expected ctx cancelled error")
	}
}

func TestStubReplayUploader_DefaultURL(t *testing.T) {
	u := NewStubReplayUploader("")
	id := uuid.MustParse("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee")
	url, err := u.Upload(context.Background(), id, []byte("x"))
	if err != nil {
		t.Fatalf("Upload: %v", err)
	}
	if !strings.Contains(url, "replays.example.local") || !strings.Contains(url, id.String()) {
		t.Errorf("unexpected URL: %s", url)
	}
}

func TestSignV4_DeterministicSignature(t *testing.T) {
	// Verify two requests with same inputs produce identical Authorization
	// headers (i.e. the signing function is pure given inputs + clock).
	now := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	bodyHash := sha256Hex([]byte("test"))

	mkAuth := func() string {
		req, _ := http.NewRequest(http.MethodPut, "http://localhost:9000/bucket/key", nil)
		req.Header.Set("Content-Type", "application/octet-stream")
		signV4(req, "AKIA", "secret", "us-east-1", "s3", bodyHash, now)
		return req.Header.Get("Authorization")
	}
	a, b := mkAuth(), mkAuth()
	if a != b {
		t.Errorf("signatures differ:\n  a=%s\n  b=%s", a, b)
	}
	if !strings.Contains(a, "AWS4-HMAC-SHA256 Credential=AKIA/20260101/us-east-1/s3/aws4_request") {
		t.Errorf("unexpected scope: %s", a)
	}
}

func TestBaseURL_Variants(t *testing.T) {
	tests := []struct {
		ep, want string
		ssl      bool
	}{
		{"minio:9000", "http://minio:9000", false},
		{"minio:9000", "https://minio:9000", true},
		{"http://x:9000", "http://x:9000", true},    // explicit scheme wins
		{"https://x:9000/", "https://x:9000", true}, // trailing slash trimmed
	}
	for _, tc := range tests {
		u := &MinIOReplayUploader{Endpoint: tc.ep, UseSSL: tc.ssl}
		got := u.baseURL()
		if got != tc.want {
			t.Errorf("baseURL(%q,ssl=%v) = %q, want %q", tc.ep, tc.ssl, got, tc.want)
		}
	}
}

func TestAWSURIEscape(t *testing.T) {
	tests := []struct{ in, want string }{
		{"abc", "abc"},
		{"a b", "a%20b"},
		{"a/b", "a%2Fb"}, // forward slashes ARE escaped per AWS spec
		{"a~b", "a~b"},   // tilde NOT escaped
	}
	for _, tc := range tests {
		got := awsURIEscape(tc.in)
		if got != tc.want {
			t.Errorf("escape(%q) = %q, want %q", tc.in, got, tc.want)
		}
	}
}
