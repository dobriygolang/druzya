// minio_store.go — S3 v4 client for the `tts-audio` bucket.
//
// Parallel of services/podcast/infra/minio.go — same hand-rolled v4
// signing (no minio-go SDK to keep the dependency surface flat).
// Lives in shared/pkg/tts so any service that wants to upload TTS
// audio can reuse it (hone Speaking initially; future English/listening
// providers can pull the same store).
//
// Bucket: `tts-audio` (configurable via MINIO_BUCKET_TTS env, default
// "tts-audio"). Object key shape: "speaking/<exercise_id>.mp3".
// Public access: presigned GET URLs valid for 7 days (TTS клипы редко
// regen'ятся; long TTL минимизирует cache invalidation). Frontend
// caches presigned URL в audio_url; повторный seed перепишет на новый
// signed URL.
package tts

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
	"slices"
	"strings"
	"time"
)

// MinIOStore writes TTS audio to an S3-compatible bucket.
type MinIOStore struct {
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

// NewMinIOStore wires the store. `bucket` defaults to "tts-audio" when
// empty. Endpoint usually internal Docker hostname ("minio:9000");
// publicEndpoint (optional) — host that goes into the presigned URL
// (production: "https://druz9.online" via nginx /minio/* proxy or
// dedicated "https://storage.druz9.online").
func NewMinIOStore(endpoint, publicEndpoint, accessKey, secretKey, bucket string, useSSL bool) *MinIOStore {
	if bucket == "" {
		bucket = "tts-audio"
	}
	return &MinIOStore{
		Endpoint:       endpoint,
		PublicEndpoint: publicEndpoint,
		AccessKey:      accessKey,
		SecretKey:      secretKey,
		Bucket:         bucket,
		Region:         "us-east-1",
		UseSSL:         useSSL,
		HTTP:           &http.Client{Timeout: 60 * time.Second},
		now:            time.Now,
	}
}

// Available reports whether the store has the minimal config.
func (s *MinIOStore) Available() bool {
	return s != nil && s.Endpoint != "" && s.AccessKey != "" && s.SecretKey != ""
}

// EnsureBucket creates the bucket if it doesn't exist. Idempotent —
// safe to call at boot. Treats 200 (exists) и success-PUT identically.
func (s *MinIOStore) EnsureBucket(ctx context.Context) error {
	if !s.Available() {
		return fmt.Errorf("tts.minio.EnsureBucket: %w", ErrUnavailable)
	}
	now := s.now().UTC()
	headURL := s.bucketURL()
	req, err := http.NewRequestWithContext(ctx, http.MethodHead, headURL, nil)
	if err != nil {
		return fmt.Errorf("tts.minio.EnsureBucket: build HEAD: %w", err)
	}
	signV4TTS(req, s.AccessKey, s.SecretKey, s.Region, "s3", emptySHA256TTS, now)
	resp, err := s.HTTP.Do(req)
	if err != nil {
		return fmt.Errorf("tts.minio.EnsureBucket: HEAD: %w", err)
	}
	_ = resp.Body.Close()
	if resp.StatusCode == http.StatusOK {
		return nil
	}
	if resp.StatusCode != http.StatusNotFound {
		return fmt.Errorf("tts.minio.EnsureBucket: unexpected HEAD status %d", resp.StatusCode)
	}
	putReq, err := http.NewRequestWithContext(ctx, http.MethodPut, headURL, nil)
	if err != nil {
		return fmt.Errorf("tts.minio.EnsureBucket: build PUT: %w", err)
	}
	putReq.ContentLength = 0
	signV4TTS(putReq, s.AccessKey, s.SecretKey, s.Region, "s3", emptySHA256TTS, s.now().UTC())
	putResp, err := s.HTTP.Do(putReq)
	if err != nil {
		return fmt.Errorf("tts.minio.EnsureBucket: PUT: %w", err)
	}
	defer putResp.Body.Close()
	if putResp.StatusCode/100 != 2 && putResp.StatusCode != http.StatusConflict {
		body, _ := io.ReadAll(io.LimitReader(putResp.Body, 512))
		return fmt.Errorf("tts.minio.EnsureBucket: PUT %s: %s", putResp.Status, string(body))
	}
	return nil
}

// Put uploads audio under objectKey. Returns the canonical object key
// stored (для caller persists в DB вместе с public URL).
func (s *MinIOStore) Put(ctx context.Context, objectKey string, body []byte, contentType string) (string, error) {
	if !s.Available() {
		return "", fmt.Errorf("tts.minio.Put: %w", ErrUnavailable)
	}
	if objectKey == "" {
		return "", fmt.Errorf("tts.minio.Put: objectKey required")
	}
	if contentType == "" {
		contentType = "application/octet-stream"
	}
	hash := sha256HexTTS(body)

	now := s.now().UTC()
	putURL := s.objectURL(objectKey)
	req, err := http.NewRequestWithContext(ctx, http.MethodPut, putURL, bytes.NewReader(body))
	if err != nil {
		return "", fmt.Errorf("tts.minio.Put: build: %w", err)
	}
	req.Header.Set("Content-Type", contentType)
	req.ContentLength = int64(len(body))
	signV4TTS(req, s.AccessKey, s.SecretKey, s.Region, "s3", hash, now)

	resp, err := s.HTTP.Do(req)
	if err != nil {
		return "", fmt.Errorf("tts.minio.Put: PUT: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode/100 != 2 {
		respBody, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		return "", fmt.Errorf("tts.minio.Put: %s %s: %s", resp.Status, objectKey, string(respBody))
	}
	return objectKey, nil
}

// PresignGet returns a presigned GET URL valid for `ttl`. Clamped to
// [60s, 7d]. 7d default так что frontend audio_url не invalidates пока
// admin не пересоберёт.
func (s *MinIOStore) PresignGet(ctx context.Context, objectKey string, ttl time.Duration) (string, error) {
	_ = ctx
	if !s.Available() {
		return "", fmt.Errorf("tts.minio.PresignGet: %w", ErrUnavailable)
	}
	if objectKey == "" {
		return "", fmt.Errorf("tts.minio.PresignGet: objectKey required")
	}
	expirySec := int(ttl.Seconds())
	if expirySec <= 60 {
		expirySec = 60
	}
	if expirySec > 7*24*3600 {
		expirySec = 7 * 24 * 3600
	}

	parsed, err := url.Parse(s.publicObjectURL(objectKey))
	if err != nil {
		return "", fmt.Errorf("tts.minio.PresignGet: parse: %w", err)
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

	canonicalQuery := canonicalQueryTTS(q)
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
		sha256HexTTS([]byte(canonicalRequest)),
	}, "\n")

	signingKey := deriveSigningKeyTTS(s.SecretKey, dateStamp, s.Region, "s3")
	signature := hex.EncodeToString(hmacSHA256TTS(signingKey, []byte(stringToSign)))

	return parsed.Scheme + "://" + parsed.Host + canonicalURI + "?" + canonicalQuery +
		"&X-Amz-Signature=" + signature, nil
}

// bucketURL / objectURL / publicObjectURL — separate internal vs public
// scheme/host pairs (same pattern as podcast/infra/minio.go).

func (s *MinIOStore) bucketURL() string {
	return formatEndpointTTS(s.Endpoint, s.UseSSL) + "/" + s.Bucket
}

func (s *MinIOStore) objectURL(objectKey string) string {
	return formatEndpointTTS(s.Endpoint, s.UseSSL) + "/" + s.Bucket + "/" + objectKey
}

func (s *MinIOStore) publicObjectURL(objectKey string) string {
	if s.PublicEndpoint != "" {
		return formatEndpointTTS(s.PublicEndpoint, s.UseSSL) + "/" + s.Bucket + "/" + objectKey
	}
	return s.objectURL(objectKey)
}

func formatEndpointTTS(ep string, useSSL bool) string {
	if strings.HasPrefix(ep, "http://") || strings.HasPrefix(ep, "https://") {
		return strings.TrimRight(ep, "/")
	}
	scheme := "http"
	if useSSL {
		scheme = "https"
	}
	return scheme + "://" + ep
}

// ─── S3 v4 signing helpers — local copies (см. podcast/infra/minio.go) ───

const emptySHA256TTS = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"

func signV4TTS(req *http.Request, accessKey, secretKey, region, service, bodyHash string, now time.Time) {
	req.Header.Set("Host", req.URL.Host)
	req.Header.Set("X-Amz-Date", now.Format("20060102T150405Z"))
	req.Header.Set("X-Amz-Content-Sha256", bodyHash)

	signedHeaderNames := []string{"host", "x-amz-content-sha256", "x-amz-date"}
	if req.Header.Get("Content-Type") != "" {
		signedHeaderNames = append(signedHeaderNames, "content-type")
	}
	slices.Sort(signedHeaderNames)

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
		canonicalQueryTTS(req.URL.Query()),
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
		sha256HexTTS([]byte(canonicalRequest)),
	}, "\n")

	signingKey := deriveSigningKeyTTS(secretKey, dateStamp, region, service)
	signature := hex.EncodeToString(hmacSHA256TTS(signingKey, []byte(stringToSign)))

	auth := fmt.Sprintf("AWS4-HMAC-SHA256 Credential=%s/%s, SignedHeaders=%s, Signature=%s",
		accessKey, credentialScope, signedHeaders, signature)
	req.Header.Set("Authorization", auth)
}

func canonicalQueryTTS(values url.Values) string {
	keys := make([]string, 0, len(values))
	for k := range values {
		keys = append(keys, k)
	}
	slices.Sort(keys)
	parts := make([]string, 0, len(keys))
	for _, k := range keys {
		for _, v := range values[k] {
			parts = append(parts, awsURIEscapeTTS(k)+"="+awsURIEscapeTTS(v))
		}
	}
	return strings.Join(parts, "&")
}

func awsURIEscapeTTS(s string) string {
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

func deriveSigningKeyTTS(secretKey, dateStamp, region, service string) []byte {
	kDate := hmacSHA256TTS([]byte("AWS4"+secretKey), []byte(dateStamp))
	kRegion := hmacSHA256TTS(kDate, []byte(region))
	kService := hmacSHA256TTS(kRegion, []byte(service))
	return hmacSHA256TTS(kService, []byte("aws4_request"))
}

func hmacSHA256TTS(key, data []byte) []byte {
	m := hmac.New(sha256.New, key)
	m.Write(data)
	return m.Sum(nil)
}

func sha256HexTTS(b []byte) string {
	sum := sha256.Sum256(b)
	return hex.EncodeToString(sum[:])
}
