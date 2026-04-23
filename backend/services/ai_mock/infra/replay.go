// Package infra — replay storage backed by an S3-compatible object store
// (MinIO in production).
//
// Why no minio-go SDK? The repo deliberately avoids adding new module
// dependencies during the production-polish phase (offline-build constraint
// for the CI image). The S3 v4 signature is small enough to implement with
// stdlib — see signing helpers below.
//
// Bucket: `ai-mock-replays` (operator must create or rely on auto-create).
// Object key: `replays/<sessionID>/<unix-nanos>.json.gz`.
// Returns a presigned GET URL valid for 7 days.
//
// Lifecycle / retention: configure via `mc ilm` against the bucket once.
// Suggested rule:
//
//	mc ilm rule add minio/ai-mock-replays --expire-days 90
//
// (intentionally NOT enforced in code — ops owns retention policy.)
package infra

import (
	"bytes"
	"compress/gzip"
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

	"druz9/ai_mock/domain"

	"github.com/google/uuid"
)

// MinIOReplayUploader uploads gzipped JSON blobs to a MinIO bucket and
// returns a 7-day presigned GET URL. Compatible with any S3 v4 endpoint.
type MinIOReplayUploader struct {
	Endpoint  string // e.g. "minio:9000" or "https://storage.druz9.online"
	AccessKey string
	SecretKey string
	Bucket    string // default: "ai-mock-replays"
	Region    string // default: "us-east-1" (MinIO ignores region but signing requires one)
	UseSSL    bool
	HTTP      *http.Client
	URLTTL    time.Duration // presigned URL TTL; default 7 days
	now       func() time.Time
}

// NewMinIOReplayUploader builds a real uploader. endpoint may be a bare
// host:port ("minio:9000") OR a full URL ("https://storage.druz9.online").
func NewMinIOReplayUploader(endpoint, accessKey, secretKey string, useSSL bool) *MinIOReplayUploader {
	return &MinIOReplayUploader{
		Endpoint:  endpoint,
		AccessKey: accessKey,
		SecretKey: secretKey,
		Bucket:    "ai-mock-replays",
		Region:    "us-east-1",
		UseSSL:    useSSL,
		HTTP:      &http.Client{Timeout: 30 * time.Second},
		URLTTL:    7 * 24 * time.Hour,
		now:       time.Now,
	}
}

// Upload gzip-compresses payload, PUTs it under
// `replays/<sessionID>/<nanos>.json.gz`, then returns a presigned GET URL
// valid for u.URLTTL.
func (u *MinIOReplayUploader) Upload(ctx context.Context, sessionID uuid.UUID, payload []byte) (string, error) {
	if ctx.Err() != nil {
		return "", fmt.Errorf("ctx cancelled: %w", ctx.Err())
	}
	if u.AccessKey == "" || u.SecretKey == "" || u.Endpoint == "" {
		return "", fmt.Errorf("minio_replay: missing endpoint/accesskey/secretkey")
	}

	// gzip-compress payload.
	var compressed bytes.Buffer
	gw := gzip.NewWriter(&compressed)
	if _, err := gw.Write(payload); err != nil {
		_ = gw.Close()
		return "", fmt.Errorf("minio_replay: gzip write: %w", err)
	}
	if err := gw.Close(); err != nil {
		return "", fmt.Errorf("minio_replay: gzip close: %w", err)
	}

	now := u.now().UTC()
	objectKey := fmt.Sprintf("replays/%s/%d.json.gz", sessionID, now.UnixNano())

	// Build PUT URL.
	putURL := u.objectURL(objectKey)
	body := compressed.Bytes()
	bodyHash := sha256Hex(body)

	req, err := http.NewRequestWithContext(ctx, http.MethodPut, putURL, bytes.NewReader(body))
	if err != nil {
		return "", fmt.Errorf("minio_replay: build request: %w", err)
	}
	req.Header.Set("Content-Type", "application/gzip")
	req.Header.Set("Content-Encoding", "gzip")
	req.ContentLength = int64(len(body))
	signV4(req, u.AccessKey, u.SecretKey, u.Region, "s3", bodyHash, now)

	resp, err := u.HTTP.Do(req)
	if err != nil {
		return "", fmt.Errorf("minio_replay: PUT: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode/100 != 2 {
		respBody, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		return "", fmt.Errorf("minio_replay: PUT %s: %s: %s", objectKey, resp.Status, string(respBody))
	}

	// Build presigned GET.
	presigned, err := u.presignGet(objectKey, u.URLTTL, now)
	if err != nil {
		return "", fmt.Errorf("minio_replay: presign: %w", err)
	}
	return presigned, nil
}

// objectURL returns the absolute URL for objectKey under u.Bucket.
func (u *MinIOReplayUploader) objectURL(objectKey string) string {
	return u.baseURL() + "/" + u.Bucket + "/" + objectKey
}

// baseURL normalises Endpoint into "scheme://host[:port]" form.
func (u *MinIOReplayUploader) baseURL() string {
	ep := u.Endpoint
	if strings.HasPrefix(ep, "http://") || strings.HasPrefix(ep, "https://") {
		return strings.TrimRight(ep, "/")
	}
	scheme := "http"
	if u.UseSSL {
		scheme = "https"
	}
	return scheme + "://" + ep
}

// presignGet builds a v4-presigned GET URL valid for ttl.
func (u *MinIOReplayUploader) presignGet(objectKey string, ttl time.Duration, now time.Time) (string, error) {
	expirySec := int(ttl.Seconds())
	if expirySec <= 0 {
		expirySec = 3600
	}
	if expirySec > 7*24*3600 {
		expirySec = 7 * 24 * 3600
	}

	parsed, err := url.Parse(u.objectURL(objectKey))
	if err != nil {
		return "", fmt.Errorf("minio_replay: parse url: %w", err)
	}
	host := parsed.Host
	canonicalURI := parsed.Path

	dateStamp := now.Format("20060102")
	credentialScope := fmt.Sprintf("%s/%s/s3/aws4_request", dateStamp, u.Region)

	q := url.Values{}
	q.Set("X-Amz-Algorithm", "AWS4-HMAC-SHA256")
	q.Set("X-Amz-Credential", u.AccessKey+"/"+credentialScope)
	q.Set("X-Amz-Date", now.Format("20060102T150405Z"))
	q.Set("X-Amz-Expires", fmt.Sprintf("%d", expirySec))
	q.Set("X-Amz-SignedHeaders", "host")

	canonicalQuery := canonicalQueryString(q)
	canonicalHeaders := "host:" + host + "\n"
	canonicalRequest := strings.Join([]string{
		"GET",
		canonicalURI,
		canonicalQuery,
		canonicalHeaders,
		"host",
		"UNSIGNED-PAYLOAD",
	}, "\n")

	stringToSign := strings.Join([]string{
		"AWS4-HMAC-SHA256",
		now.Format("20060102T150405Z"),
		credentialScope,
		sha256Hex([]byte(canonicalRequest)),
	}, "\n")

	signingKey := deriveSigningKey(u.SecretKey, dateStamp, u.Region, "s3")
	signature := hex.EncodeToString(hmacSHA256(signingKey, []byte(stringToSign)))

	return parsed.Scheme + "://" + parsed.Host + canonicalURI + "?" + canonicalQuery + "&X-Amz-Signature=" + signature, nil
}

// signV4 signs a real (non-presigned) HTTP request with AWS Sig v4 using
// the standard Authorization-header form. Mutates req.Header in place.
func signV4(req *http.Request, accessKey, secretKey, region, service, bodyHash string, now time.Time) {
	req.Header.Set("Host", req.URL.Host)
	req.Header.Set("X-Amz-Date", now.Format("20060102T150405Z"))
	req.Header.Set("X-Amz-Content-Sha256", bodyHash)

	signedHeaderNames := []string{"content-type", "host", "x-amz-content-sha256", "x-amz-date"}
	if req.Header.Get("Content-Encoding") != "" {
		signedHeaderNames = append(signedHeaderNames, "content-encoding")
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
		canonicalQueryString(req.URL.Query()),
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
		sha256Hex([]byte(canonicalRequest)),
	}, "\n")

	signingKey := deriveSigningKey(secretKey, dateStamp, region, service)
	signature := hex.EncodeToString(hmacSHA256(signingKey, []byte(stringToSign)))

	auth := fmt.Sprintf("AWS4-HMAC-SHA256 Credential=%s/%s, SignedHeaders=%s, Signature=%s",
		accessKey, credentialScope, signedHeaders, signature)
	req.Header.Set("Authorization", auth)
}

func canonicalQueryString(values url.Values) string {
	keys := make([]string, 0, len(values))
	for k := range values {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	parts := make([]string, 0, len(keys))
	for _, k := range keys {
		for _, v := range values[k] {
			parts = append(parts, awsURIEscape(k)+"="+awsURIEscape(v))
		}
	}
	return strings.Join(parts, "&")
}

// awsURIEscape escapes per AWS rules (more strict than url.QueryEscape).
func awsURIEscape(s string) string {
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

func deriveSigningKey(secretKey, dateStamp, region, service string) []byte {
	kDate := hmacSHA256([]byte("AWS4"+secretKey), []byte(dateStamp))
	kRegion := hmacSHA256(kDate, []byte(region))
	kService := hmacSHA256(kRegion, []byte(service))
	return hmacSHA256(kService, []byte("aws4_request"))
}

func hmacSHA256(key, data []byte) []byte {
	m := hmac.New(sha256.New, key)
	m.Write(data)
	return m.Sum(nil)
}

func sha256Hex(b []byte) string {
	sum := sha256.Sum256(b)
	return hex.EncodeToString(sum[:])
}

// ─────────────────────────────────────────────────────────────────────────
// Stub fallback (for dev/local where no MinIO is configured).
// ─────────────────────────────────────────────────────────────────────────

// StubReplayUploader returns a fake URL without uploading. Wired by the
// monolith when cfg.MinIO.AccessKey is empty (e.g. local docker-compose
// without the minio service running).
type StubReplayUploader struct {
	BaseURL string
}

// NewStubReplayUploader builds a stub.
func NewStubReplayUploader(baseURL string) *StubReplayUploader {
	if baseURL == "" {
		baseURL = "https://replays.example.local"
	}
	return &StubReplayUploader{BaseURL: baseURL}
}

// Upload is the stub impl — drops payload, returns a fake URL.
func (u *StubReplayUploader) Upload(ctx context.Context, sessionID uuid.UUID, payload []byte) (string, error) {
	if ctx.Err() != nil {
		return "", fmt.Errorf("ctx cancelled: %w", ctx.Err())
	}
	_ = payload
	return fmt.Sprintf("%s/mock-replays/%s.json?stub=1", u.BaseURL, sessionID), nil
}

// Interface guards.
var (
	_ domain.ReplayUploader = (*StubReplayUploader)(nil)
	_ domain.ReplayUploader = (*MinIOReplayUploader)(nil)
)
