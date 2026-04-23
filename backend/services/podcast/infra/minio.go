// minio.go — S3 v4 client for the podcasts bucket.
//
// We re-use the same hand-rolled S3 v4 signing approach as
// ai_mock/infra/replay.go (no minio-go SDK — keeps the dependency surface
// flat for the offline CI build). The functions are deliberately small
// duplicates rather than a shared helper because the two domains evolve
// independently and the file-level isolation makes future divergence
// safe.
//
// Bucket: configurable via MINIO_BUCKET_PODCASTS, default "podcasts".
// Object key shape: "audio/<uuid>.<ext>" (set by the use case).
// Presigned GET TTL: 45 min (matches the cache TTL so the URL outlives
// every cached list response).
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

	"druz9/podcast/domain"
)

// MinIOPodcastStore implements domain.PodcastObjectStore against an
// S3-compatible endpoint (MinIO in production).
type MinIOPodcastStore struct {
	Endpoint  string // "minio:9000" or "https://storage.druz9.online"
	AccessKey string
	SecretKey string
	Bucket    string
	Region    string
	UseSSL    bool
	HTTP      *http.Client
	now       func() time.Time
}

// NewMinIOPodcastStore wires a real store. bucket defaults to "podcasts"
// when empty.
func NewMinIOPodcastStore(endpoint, accessKey, secretKey, bucket string, useSSL bool) *MinIOPodcastStore {
	if bucket == "" {
		bucket = "podcasts"
	}
	return &MinIOPodcastStore{
		Endpoint:  endpoint,
		AccessKey: accessKey,
		SecretKey: secretKey,
		Bucket:    bucket,
		Region:    "us-east-1",
		UseSSL:    useSSL,
		HTTP:      &http.Client{Timeout: 60 * time.Second},
		now:       time.Now,
	}
}

// Available reports whether the store has the minimal config to operate.
func (s *MinIOPodcastStore) Available() bool {
	return s != nil && s.Endpoint != "" && s.AccessKey != "" && s.SecretKey != ""
}

// EnsureBucket creates the bucket if it doesn't exist. Idempotent — safe to
// call at boot. Without it, the operator must manually `mc mb minio/podcasts`
// before the first upload, otherwise PUT returns NoSuchBucket. Returns nil
// when the bucket already exists OR was just created.
//
// Errors are wrapped with context but NOT swallowed — boot-time failure
// here is a real ops problem (wrong credentials, unreachable minio, region
// mismatch) that deserves to crash the process.
func (s *MinIOPodcastStore) EnsureBucket(ctx context.Context) error {
	if !s.Available() {
		return fmt.Errorf("podcast.minio.EnsureBucket: %w", domain.ErrObjectStoreUnavailable)
	}
	now := s.now().UTC()
	// HEAD /<bucket> returns 200 if exists, 404/NoSuchBucket if not.
	headURL := s.bucketURL()
	req, err := http.NewRequestWithContext(ctx, http.MethodHead, headURL, nil)
	if err != nil {
		return fmt.Errorf("podcast.minio.EnsureBucket: build HEAD req: %w", err)
	}
	signV4Podcast(req, s.AccessKey, s.SecretKey, s.Region, "s3", emptySHA256, now)
	resp, err := s.HTTP.Do(req)
	if err != nil {
		return fmt.Errorf("podcast.minio.EnsureBucket: HEAD: %w", err)
	}
	_ = resp.Body.Close()
	if resp.StatusCode == http.StatusOK {
		return nil // bucket exists
	}
	if resp.StatusCode != http.StatusNotFound {
		return fmt.Errorf("podcast.minio.EnsureBucket: unexpected HEAD status %d", resp.StatusCode)
	}
	// Create. PUT /<bucket> with empty body. AWS S3 wants a region in the
	// CreateBucketConfiguration body for non-us-east-1; minio is permissive
	// about empty body in any region.
	putReq, err := http.NewRequestWithContext(ctx, http.MethodPut, headURL, nil)
	if err != nil {
		return fmt.Errorf("podcast.minio.EnsureBucket: build PUT req: %w", err)
	}
	putReq.ContentLength = 0
	signV4Podcast(putReq, s.AccessKey, s.SecretKey, s.Region, "s3", emptySHA256, s.now().UTC())
	putResp, err := s.HTTP.Do(putReq)
	if err != nil {
		return fmt.Errorf("podcast.minio.EnsureBucket: PUT: %w", err)
	}
	defer putResp.Body.Close()
	if putResp.StatusCode/100 != 2 && putResp.StatusCode != http.StatusConflict {
		// 409 BucketAlreadyOwnedByYou is fine in race conditions.
		body, _ := io.ReadAll(io.LimitReader(putResp.Body, 512))
		return fmt.Errorf("podcast.minio.EnsureBucket: PUT %s: %s", putResp.Status, string(body))
	}
	return nil
}

// bucketURL returns scheme://endpoint/<bucket> — used by EnsureBucket's
// HEAD/PUT. objectURL appends the key for object operations.
func (s *MinIOPodcastStore) bucketURL() string {
	scheme := "http"
	if s.UseSSL {
		scheme = "https"
	}
	return fmt.Sprintf("%s://%s/%s", scheme, s.Endpoint, s.Bucket)
}

// emptySHA256 is the well-known v4 hash of an empty payload — required for
// HEAD/PUT requests with no body.
const emptySHA256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"

// PutAudio uploads body under objectKey. Caller is responsible for
// generating the key (e.g. "audio/<uuid>.mp3"); we reject empty keys.
//
// We buffer the body into memory because the streaming S3 v4 signed PUT
// requires a precomputed payload SHA-256. For podcast episodes (typically
// <= 200 MB) this is acceptable; if we ever need bigger files we'll
// switch to streaming "UNSIGNED-PAYLOAD" + content-length-only signature.
func (s *MinIOPodcastStore) PutAudio(ctx context.Context, objectKey string, body io.Reader, length int64, contentType string) (string, error) {
	if !s.Available() {
		return "", fmt.Errorf("podcast.minio.PutAudio: %w", domain.ErrObjectStoreUnavailable)
	}
	if objectKey == "" {
		return "", fmt.Errorf("podcast.minio.PutAudio: objectKey required")
	}
	if contentType == "" {
		contentType = "application/octet-stream"
	}
	// Buffer + hash payload for v4 signing.
	buf := &bytes.Buffer{}
	if length > 0 {
		buf.Grow(int(length))
	}
	if _, err := io.Copy(buf, body); err != nil {
		return "", fmt.Errorf("podcast.minio.PutAudio: read body: %w", err)
	}
	payload := buf.Bytes()
	hash := sha256Hex(payload)

	now := s.now().UTC()
	putURL := s.objectURL(objectKey)
	req, err := http.NewRequestWithContext(ctx, http.MethodPut, putURL, bytes.NewReader(payload))
	if err != nil {
		return "", fmt.Errorf("podcast.minio.PutAudio: build req: %w", err)
	}
	req.Header.Set("Content-Type", contentType)
	req.ContentLength = int64(len(payload))
	signV4Podcast(req, s.AccessKey, s.SecretKey, s.Region, "s3", hash, now)

	resp, err := s.HTTP.Do(req)
	if err != nil {
		return "", fmt.Errorf("podcast.minio.PutAudio: PUT: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode/100 != 2 {
		respBody, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		return "", fmt.Errorf("podcast.minio.PutAudio: %s %s: %s", resp.Status, objectKey, string(respBody))
	}
	return objectKey, nil
}

// PresignGet returns a presigned GET URL valid for ttl. ttl is clamped
// into [60s, 7d].
func (s *MinIOPodcastStore) PresignGet(ctx context.Context, objectKey string, ttl time.Duration) (string, error) {
	_ = ctx // signing is local — no I/O until the client follows the URL.
	if !s.Available() {
		return "", fmt.Errorf("podcast.minio.PresignGet: %w", domain.ErrObjectStoreUnavailable)
	}
	if objectKey == "" {
		return "", fmt.Errorf("podcast.minio.PresignGet: objectKey required")
	}
	expirySec := int(ttl.Seconds())
	if expirySec <= 60 {
		expirySec = 60
	}
	if expirySec > 7*24*3600 {
		expirySec = 7 * 24 * 3600
	}

	parsed, err := url.Parse(s.objectURL(objectKey))
	if err != nil {
		return "", fmt.Errorf("podcast.minio.PresignGet: parse: %w", err)
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

	canonicalQuery := canonicalQueryStringPodcast(q)
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

	signingKey := deriveSigningKeyPodcast(s.SecretKey, dateStamp, s.Region, "s3")
	signature := hex.EncodeToString(hmacSHA256Podcast(signingKey, []byte(stringToSign)))

	return parsed.Scheme + "://" + parsed.Host + canonicalURI + "?" + canonicalQuery +
		"&X-Amz-Signature=" + signature, nil
}

// Delete removes the object. 404 from the store is treated as success
// (best-effort cleanup after the row was already removed).
func (s *MinIOPodcastStore) Delete(ctx context.Context, objectKey string) error {
	if !s.Available() {
		return fmt.Errorf("podcast.minio.Delete: %w", domain.ErrObjectStoreUnavailable)
	}
	if objectKey == "" {
		return nil
	}
	now := s.now().UTC()
	delURL := s.objectURL(objectKey)
	req, err := http.NewRequestWithContext(ctx, http.MethodDelete, delURL, nil)
	if err != nil {
		return fmt.Errorf("podcast.minio.Delete: build req: %w", err)
	}
	signV4Podcast(req, s.AccessKey, s.SecretKey, s.Region, "s3", sha256Hex(nil), now)
	resp, err := s.HTTP.Do(req)
	if err != nil {
		return fmt.Errorf("podcast.minio.Delete: DELETE: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode/100 == 2 || resp.StatusCode == http.StatusNotFound {
		return nil
	}
	respBody, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
	return fmt.Errorf("podcast.minio.Delete: %s %s: %s", resp.Status, objectKey, string(respBody))
}

func (s *MinIOPodcastStore) objectURL(objectKey string) string {
	return s.baseURL() + "/" + s.Bucket + "/" + objectKey
}

func (s *MinIOPodcastStore) baseURL() string {
	ep := s.Endpoint
	if strings.HasPrefix(ep, "http://") || strings.HasPrefix(ep, "https://") {
		return strings.TrimRight(ep, "/")
	}
	scheme := "http"
	if s.UseSSL {
		scheme = "https"
	}
	return scheme + "://" + ep
}

// ─── unconfigured fallback ───────────────────────────────────────────────

// UnconfiguredObjectStore is the explicit "no MinIO creds" implementation.
// Every operation returns ErrObjectStoreUnavailable so callers surface a
// proper 503 with a real reason instead of a hopeful empty URL.
type UnconfiguredObjectStore struct{}

// NewUnconfiguredObjectStore wires the fallback.
func NewUnconfiguredObjectStore() *UnconfiguredObjectStore { return &UnconfiguredObjectStore{} }

// Available always returns false.
func (UnconfiguredObjectStore) Available() bool { return false }

// PutAudio always returns ErrObjectStoreUnavailable.
func (UnconfiguredObjectStore) PutAudio(_ context.Context, _ string, _ io.Reader, _ int64, _ string) (string, error) {
	return "", fmt.Errorf("podcast.minio.unconfigured.PutAudio: %w", domain.ErrObjectStoreUnavailable)
}

// PresignGet always returns ErrObjectStoreUnavailable.
func (UnconfiguredObjectStore) PresignGet(_ context.Context, _ string, _ time.Duration) (string, error) {
	return "", fmt.Errorf("podcast.minio.unconfigured.PresignGet: %w", domain.ErrObjectStoreUnavailable)
}

// Delete always returns ErrObjectStoreUnavailable.
func (UnconfiguredObjectStore) Delete(_ context.Context, _ string) error {
	return fmt.Errorf("podcast.minio.unconfigured.Delete: %w", domain.ErrObjectStoreUnavailable)
}

// Compile-time guards.
var (
	_ domain.PodcastObjectStore = (*MinIOPodcastStore)(nil)
	_ domain.PodcastObjectStore = (*UnconfiguredObjectStore)(nil)
)

// ─── S3 v4 signing helpers (local copies — see file header) ──────────────

func signV4Podcast(req *http.Request, accessKey, secretKey, region, service, bodyHash string, now time.Time) {
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
		canonicalQueryStringPodcast(req.URL.Query()),
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

	signingKey := deriveSigningKeyPodcast(secretKey, dateStamp, region, service)
	signature := hex.EncodeToString(hmacSHA256Podcast(signingKey, []byte(stringToSign)))

	auth := fmt.Sprintf("AWS4-HMAC-SHA256 Credential=%s/%s, SignedHeaders=%s, Signature=%s",
		accessKey, credentialScope, signedHeaders, signature)
	req.Header.Set("Authorization", auth)
}

func canonicalQueryStringPodcast(values url.Values) string {
	keys := make([]string, 0, len(values))
	for k := range values {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	parts := make([]string, 0, len(keys))
	for _, k := range keys {
		for _, v := range values[k] {
			parts = append(parts, awsURIEscapePodcast(k)+"="+awsURIEscapePodcast(v))
		}
	}
	return strings.Join(parts, "&")
}

func awsURIEscapePodcast(s string) string {
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

func deriveSigningKeyPodcast(secretKey, dateStamp, region, service string) []byte {
	kDate := hmacSHA256Podcast([]byte("AWS4"+secretKey), []byte(dateStamp))
	kRegion := hmacSHA256Podcast(kDate, []byte(region))
	kService := hmacSHA256Podcast(kRegion, []byte(service))
	return hmacSHA256Podcast(kService, []byte("aws4_request"))
}

func hmacSHA256Podcast(key, data []byte) []byte {
	m := hmac.New(sha256.New, key)
	m.Write(data)
	return m.Sum(nil)
}

func sha256Hex(b []byte) string {
	sum := sha256.Sum256(b)
	return hex.EncodeToString(sum[:])
}
