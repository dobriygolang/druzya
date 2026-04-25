// minio_canvas.go — S3 v4 client for the mock-canvas bucket.
//
// Stores Excalidraw PNG exports submitted via the sysdesign-canvas attempt.
// Key shape: "sysdesign/<attempt_uuid>.png".
//
// Signing approach: hand-rolled v4 (mirrors services/podcast/infra/minio.go;
// kept duplicated rather than shared so each domain can evolve independently
// — same rationale as the podcast file header).
//
// Bucket: configurable via MINIO_BUCKET_MOCK_CANVAS, default "mock-canvas".
// Presigned GET TTL: 1 hour (long enough for the user to review feedback;
// short enough that leaked URLs become useless quickly).
package infra

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"sort"
	"strings"
	"time"

	"druz9/mock_interview/domain"
)

// MinIOCanvasStore implements domain.CanvasStore.
type MinIOCanvasStore struct {
	Endpoint       string
	PublicEndpoint string
	AccessKey      string
	SecretKey      string
	Bucket         string
	Region         string
	UseSSL         bool
	HTTP           *http.Client
	now            func() time.Time
}

// NewMinIOCanvasStore wires the store. bucket defaults to "mock-canvas".
func NewMinIOCanvasStore(endpoint, publicEndpoint, accessKey, secretKey, bucket string, useSSL bool) *MinIOCanvasStore {
	if bucket == "" {
		bucket = "mock-canvas"
	}
	return &MinIOCanvasStore{
		Endpoint:       endpoint,
		PublicEndpoint: publicEndpoint,
		AccessKey:      accessKey,
		SecretKey:      secretKey,
		Bucket:         bucket,
		Region:         "us-east-1",
		UseSSL:         useSSL,
		HTTP:           &http.Client{Timeout: 30 * time.Second},
		now:            time.Now,
	}
}

func (s *MinIOCanvasStore) Available() bool {
	return s != nil && s.Endpoint != "" && s.AccessKey != "" && s.SecretKey != ""
}

// EnsureBucket creates the bucket if missing. Idempotent.
func (s *MinIOCanvasStore) EnsureBucket(ctx context.Context) error {
	if !s.Available() {
		return fmt.Errorf("mock_interview.minio.EnsureBucket: %w", domain.ErrCanvasStoreUnavailable)
	}
	now := s.now().UTC()
	bucketURL := s.bucketURL()
	req, err := http.NewRequestWithContext(ctx, http.MethodHead, bucketURL, nil)
	if err != nil {
		return fmt.Errorf("mock_interview.minio.EnsureBucket: build HEAD: %w", err)
	}
	signV4Canvas(req, s.AccessKey, s.SecretKey, s.Region, "s3", canvasEmptySHA256, now)
	resp, err := s.HTTP.Do(req)
	if err != nil {
		return fmt.Errorf("mock_interview.minio.EnsureBucket: HEAD: %w", err)
	}
	_ = resp.Body.Close()
	if resp.StatusCode == http.StatusOK {
		return nil
	}
	if resp.StatusCode != http.StatusNotFound {
		return fmt.Errorf("mock_interview.minio.EnsureBucket: HEAD status %d", resp.StatusCode)
	}
	putReq, err := http.NewRequestWithContext(ctx, http.MethodPut, bucketURL, nil)
	if err != nil {
		return fmt.Errorf("mock_interview.minio.EnsureBucket: build PUT: %w", err)
	}
	putReq.ContentLength = 0
	signV4Canvas(putReq, s.AccessKey, s.SecretKey, s.Region, "s3", canvasEmptySHA256, s.now().UTC())
	putResp, err := s.HTTP.Do(putReq)
	if err != nil {
		return fmt.Errorf("mock_interview.minio.EnsureBucket: PUT: %w", err)
	}
	defer putResp.Body.Close()
	if putResp.StatusCode/100 != 2 && putResp.StatusCode != http.StatusConflict {
		body, _ := io.ReadAll(io.LimitReader(putResp.Body, 512))
		return fmt.Errorf("mock_interview.minio.EnsureBucket: PUT %s: %s", putResp.Status, string(body))
	}
	return nil
}

// PutPNG uploads `png` under `key`. contentType defaults to image/png.
func (s *MinIOCanvasStore) PutPNG(ctx context.Context, key string, png []byte, contentType string) error {
	if !s.Available() {
		return fmt.Errorf("mock_interview.minio.PutPNG: %w", domain.ErrCanvasStoreUnavailable)
	}
	if key == "" {
		return fmt.Errorf("mock_interview.minio.PutPNG: key required")
	}
	if contentType == "" {
		contentType = "image/png"
	}
	hash := canvasSHA256Hex(png)
	now := s.now().UTC()
	req, err := http.NewRequestWithContext(ctx, http.MethodPut, s.objectURL(key), bytes.NewReader(png))
	if err != nil {
		return fmt.Errorf("mock_interview.minio.PutPNG: build req: %w", err)
	}
	req.Header.Set("Content-Type", contentType)
	req.ContentLength = int64(len(png))
	signV4Canvas(req, s.AccessKey, s.SecretKey, s.Region, "s3", hash, now)
	resp, err := s.HTTP.Do(req)
	if err != nil {
		return fmt.Errorf("mock_interview.minio.PutPNG: PUT: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode/100 != 2 {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		return fmt.Errorf("mock_interview.minio.PutPNG: %s %s: %s", resp.Status, key, string(body))
	}
	return nil
}

// PresignGet returns a presigned GET URL valid for ttl (clamped 60s..7d).
func (s *MinIOCanvasStore) PresignGet(_ context.Context, key string, ttl time.Duration) (string, error) {
	if !s.Available() {
		return "", fmt.Errorf("mock_interview.minio.PresignGet: %w", domain.ErrCanvasStoreUnavailable)
	}
	if key == "" {
		return "", fmt.Errorf("mock_interview.minio.PresignGet: key required")
	}
	expirySec := int(ttl.Seconds())
	if expirySec <= 60 {
		expirySec = 60
	}
	if expirySec > 7*24*3600 {
		expirySec = 7 * 24 * 3600
	}
	parsed, err := url.Parse(s.publicObjectURL(key))
	if err != nil {
		return "", fmt.Errorf("mock_interview.minio.PresignGet: parse: %w", err)
	}
	host := parsed.Host
	canonicalURI := parsed.Path
	now := s.now().UTC()
	dateStamp := now.Format("20060102")
	credentialScope := fmt.Sprintf("%s/%s/s3/aws4_request", dateStamp, s.Region)
	q := url.Values{}
	q.Set("X-Amz-Algorithm", "AWS4-HMAC-SHA256")
	q.Set("X-Amz-Credential", s.AccessKey+"/"+credentialScope)
	q.Set("X-Amz-Date", now.Format("20060102T150405Z"))
	q.Set("X-Amz-Expires", fmt.Sprintf("%d", expirySec))
	q.Set("X-Amz-SignedHeaders", "host")
	canonicalQuery := canvasCanonicalQuery(q)
	canonicalRequest := strings.Join([]string{
		"GET",
		canonicalURI,
		canonicalQuery,
		"host:" + host + "\n",
		"host",
		"UNSIGNED-PAYLOAD",
	}, "\n")
	stringToSign := strings.Join([]string{
		"AWS4-HMAC-SHA256",
		now.Format("20060102T150405Z"),
		credentialScope,
		canvasSHA256Hex([]byte(canonicalRequest)),
	}, "\n")
	signingKey := canvasDeriveSigningKey(s.SecretKey, dateStamp, s.Region, "s3")
	signature := hex.EncodeToString(canvasHMACSHA256(signingKey, []byte(stringToSign)))
	return parsed.Scheme + "://" + parsed.Host + canonicalURI + "?" + canonicalQuery +
		"&X-Amz-Signature=" + signature, nil
}

// ─── url helpers ─────────────────────────────────────────────────────────

func (s *MinIOCanvasStore) bucketURL() string {
	return canvasFormatEndpoint(s.Endpoint, s.UseSSL) + "/" + s.Bucket
}

func (s *MinIOCanvasStore) objectURL(key string) string {
	return canvasFormatEndpoint(s.Endpoint, s.UseSSL) + "/" + s.Bucket + "/" + key
}

func (s *MinIOCanvasStore) publicObjectURL(key string) string {
	ep := s.PublicEndpoint
	if ep == "" {
		ep = s.Endpoint
	}
	return canvasFormatEndpoint(ep, s.UseSSL) + "/" + s.Bucket + "/" + key
}

func canvasFormatEndpoint(ep string, useSSL bool) string {
	if strings.HasPrefix(ep, "http://") || strings.HasPrefix(ep, "https://") {
		return strings.TrimRight(ep, "/")
	}
	scheme := "http"
	if useSSL {
		scheme = "https"
	}
	return scheme + "://" + ep
}

// ─── unconfigured fallback ───────────────────────────────────────────────

// UnconfiguredCanvasStore is the explicit "no MinIO creds" implementation.
type UnconfiguredCanvasStore struct{}

func NewUnconfiguredCanvasStore() *UnconfiguredCanvasStore { return &UnconfiguredCanvasStore{} }

func (UnconfiguredCanvasStore) Available() bool { return false }

func (UnconfiguredCanvasStore) PutPNG(_ context.Context, _ string, _ []byte, _ string) error {
	return fmt.Errorf("mock_interview.canvas_store.unconfigured: %w", domain.ErrCanvasStoreUnavailable)
}

func (UnconfiguredCanvasStore) PresignGet(_ context.Context, _ string, _ time.Duration) (string, error) {
	return "", fmt.Errorf("mock_interview.canvas_store.unconfigured: %w", domain.ErrCanvasStoreUnavailable)
}

// Compile-time guards.
var (
	_ domain.CanvasStore = (*MinIOCanvasStore)(nil)
	_ domain.CanvasStore = (*UnconfiguredCanvasStore)(nil)
)

// ─── S3 v4 signing helpers (local copies — see file header) ──────────────

const canvasEmptySHA256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"

func signV4Canvas(req *http.Request, accessKey, secretKey, region, service, bodyHash string, now time.Time) {
	req.Header.Set("Host", req.URL.Host)
	req.Header.Set("X-Amz-Date", now.Format("20060102T150405Z"))
	req.Header.Set("X-Amz-Content-Sha256", bodyHash)

	signedHeaderNames := []string{"host", "x-amz-content-sha256", "x-amz-date"}
	if req.Header.Get("Content-Type") != "" {
		signedHeaderNames = append(signedHeaderNames, "content-type")
	}
	sort.Strings(signedHeaderNames)
	var canonicalHeaders strings.Builder
	for _, h := range signedHeaderNames {
		canonicalHeaders.WriteString(h)
		canonicalHeaders.WriteString(":")
		canonicalHeaders.WriteString(strings.TrimSpace(req.Header.Get(h)))
		canonicalHeaders.WriteString("\n")
	}
	signedHeaders := strings.Join(signedHeaderNames, ";")
	canonicalRequest := strings.Join([]string{
		req.Method,
		req.URL.Path,
		canvasCanonicalQuery(req.URL.Query()),
		canonicalHeaders.String(),
		signedHeaders,
		bodyHash,
	}, "\n")
	dateStamp := now.Format("20060102")
	credentialScope := fmt.Sprintf("%s/%s/%s/aws4_request", dateStamp, region, service)
	stringToSign := strings.Join([]string{
		"AWS4-HMAC-SHA256",
		now.Format("20060102T150405Z"),
		credentialScope,
		canvasSHA256Hex([]byte(canonicalRequest)),
	}, "\n")
	signingKey := canvasDeriveSigningKey(secretKey, dateStamp, region, service)
	signature := hex.EncodeToString(canvasHMACSHA256(signingKey, []byte(stringToSign)))
	auth := fmt.Sprintf("AWS4-HMAC-SHA256 Credential=%s/%s, SignedHeaders=%s, Signature=%s",
		accessKey, credentialScope, signedHeaders, signature)
	req.Header.Set("Authorization", auth)
}

func canvasCanonicalQuery(values url.Values) string {
	keys := make([]string, 0, len(values))
	for k := range values {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	parts := make([]string, 0, len(keys))
	for _, k := range keys {
		for _, v := range values[k] {
			parts = append(parts, canvasURIEscape(k)+"="+canvasURIEscape(v))
		}
	}
	return strings.Join(parts, "&")
}

func canvasURIEscape(s string) string {
	var b strings.Builder
	for _, r := range s {
		if (r >= 'A' && r <= 'Z') || (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') ||
			r == '-' || r == '_' || r == '.' || r == '~' {
			b.WriteRune(r)
		} else {
			b.WriteString(fmt.Sprintf("%%%02X", r))
		}
	}
	return b.String()
}

func canvasDeriveSigningKey(secretKey, dateStamp, region, service string) []byte {
	kDate := canvasHMACSHA256([]byte("AWS4"+secretKey), []byte(dateStamp))
	kRegion := canvasHMACSHA256(kDate, []byte(region))
	kService := canvasHMACSHA256(kRegion, []byte(service))
	return canvasHMACSHA256(kService, []byte("aws4_request"))
}

func canvasHMACSHA256(key, data []byte) []byte {
	m := hmac.New(sha256.New, key)
	m.Write(data)
	return m.Sum(nil)
}

func canvasSHA256Hex(b []byte) string {
	sum := sha256.Sum256(b)
	return hex.EncodeToString(sum[:])
}
