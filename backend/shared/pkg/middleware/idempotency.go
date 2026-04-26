// idempotency.go — Redis-backed idempotency-key middleware for write-RPCs.
//
// Контракт:
//   - Caller выставляет header `Idempotency-Key: <client-uuid>`. Если header'а
//     нет — middleware passthrough'ит запрос без вмешательства.
//   - Первый запрос с key'ем выполняется normally. После handler'а response
//     (status + body + chosen headers) кэшируется в Redis под `idempo:<scope>:<key>`
//     с TTL 24h. Scope включает userID, чтобы один клиентский UUID не мог
//     обращаться к response'у другого юзера (security).
//   - Повторные запросы с тем же key'ем возвращают cached response без
//     повторного вызова handler'а — гарантирует «exactly-once» semantics для
//     юзера.
//   - Запросы с разными method/path/body чем cached — НЕ allowed: middleware
//     возвращает 422 с message «idempotency-key reused with different request».
//     Это защищает от ошибки клиента (сбросил queue с тем же key'ем но другим
//     payload'ом).
//
// Используется на: POST /api/v1/editor/room, POST /api/v1/whiteboard/room,
// POST .../visibility, и любой другой mutation, где outbox replay может
// re-fire'нуть op'у.
package middleware

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
)

// IdempotencyTTL — сколько Redis хранит cached response. 24h: достаточно
// чтобы offline-клиент успел переподключиться и replay'нуть outbox; не
// слишком долго чтобы Redis не пух от старых entry'ев.
const IdempotencyTTL = 24 * time.Hour

// Maximum body size we'll buffer for hashing/replay. Бесконечный body
// мог бы DoS'ить Redis. 1 MiB достаточно для всех Connect-RPC mutation'ов.
const idempotencyMaxBodyBytes int64 = 1 << 20

type cachedResponse struct {
	Status      int               `json:"status"`
	Body        []byte            `json:"body"`
	ContentType string            `json:"content_type"`
	BodyHash    string            `json:"body_hash"` // sha256 hex для replay-mismatch detection
	ReqHash     string            `json:"req_hash"`  // method+path+sha256(body) — to detect mismatched re-uses
	Headers     map[string]string `json:"headers"`   // selected response headers (ETag, Location, etc.)
}

// Idempotency returns a middleware that dedupes write-requests by the
// `Idempotency-Key` header. Pass nil rdb → no-op middleware (passthrough,
// useful in tests / when Redis unavailable, fail-open instead of fail-closed).
func Idempotency(rdb *redis.Client) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			// Idempotency только для writes. GET/HEAD/OPTIONS — passthrough.
			if r.Method != http.MethodPost && r.Method != http.MethodPut &&
				r.Method != http.MethodPatch && r.Method != http.MethodDelete {
				next.ServeHTTP(w, r)
				return
			}
			key := strings.TrimSpace(r.Header.Get("Idempotency-Key"))
			if key == "" || rdb == nil {
				next.ServeHTTP(w, r)
				return
			}
			// Validate key shape — ожидаем UUID-like строку. Защита от bad
			// caller'ов которые suнут что-нибудь странное и сожрут Redis-key
			// budget. Не forced UUID, но >= 16 chars и no whitespace.
			if len(key) < 16 || len(key) > 128 || strings.ContainsAny(key, " \t\n") {
				next.ServeHTTP(w, r)
				return
			}

			// Buffer body для hash + replay (если нужно). Защищаемся от
			// huge body'ов limit reader'ом.
			limited := io.LimitReader(r.Body, idempotencyMaxBodyBytes+1)
			bodyBytes, err := io.ReadAll(limited)
			if err != nil {
				http.Error(w, `{"error":{"code":"bad_body"}}`, http.StatusBadRequest)
				return
			}
			if int64(len(bodyBytes)) > idempotencyMaxBodyBytes {
				http.Error(w, `{"error":{"code":"body_too_large"}}`, http.StatusRequestEntityTooLarge)
				return
			}
			r.Body = io.NopCloser(bytes.NewReader(bodyBytes))

			// Scope key'а — включаем user_id (если есть) чтобы юзеры не
			// делили namespace. Anonymous (нет UserIDFromContext) → use IP
			// fallback: безопасно потому что rate-limiter уже на уровне
			// route'а ограничит anon abuse'ы.
			uid, _ := UserIDFromContext(r.Context())
			scope := uid.String()
			if uid == uuid.Nil {
				scope = "anon:" + clientIP(r)
			}
			redisKey := "idempo:" + scope + ":" + key

			ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
			defer cancel()

			// Try fetch cached response.
			raw, err := rdb.Get(ctx, redisKey).Bytes()
			if err == nil && len(raw) > 0 {
				var cr cachedResponse
				if jErr := json.Unmarshal(raw, &cr); jErr == nil {
					// Validate request matches cached.
					reqHash := hashReq(r.Method, r.URL.Path, bodyBytes)
					if cr.ReqHash != "" && cr.ReqHash != reqHash {
						// Same key, different request — caller bug.
						http.Error(w,
							`{"error":{"code":"idempotency_mismatch","message":"Idempotency-Key reused with different request payload"}}`,
							http.StatusUnprocessableEntity)
						return
					}
					// Replay cached.
					for k, v := range cr.Headers {
						w.Header().Set(k, v)
					}
					if cr.ContentType != "" {
						w.Header().Set("Content-Type", cr.ContentType)
					}
					w.Header().Set("Idempotent-Replay", "true")
					w.WriteHeader(cr.Status)
					_, _ = w.Write(cr.Body)
					return
				}
			} else if !errors.Is(err, redis.Nil) {
				// Redis transient error — fail-open: passthrough к handler'у,
				// без cache'а. Сетевой blip не должен стопать write'ы.
				next.ServeHTTP(w, r)
				return
			}

			// Cache miss — wrap response writer чтобы capture'нуть response
			// body + status, и run handler.
			rec := &capturingWriter{
				ResponseWriter: w,
				headersExt:     map[string]string{},
				status:         http.StatusOK,
			}
			next.ServeHTTP(rec, r)

			// Только успешные (2xx) ответы кэшируем. 4xx/5xx может быть
			// transient: caller retry'нет со свежим (или тем же) key'ем,
			// получит честный новый ответ.
			if rec.status >= 200 && rec.status < 300 {
				cr := cachedResponse{
					Status:      rec.status,
					Body:        rec.buf.Bytes(),
					ContentType: w.Header().Get("Content-Type"),
					BodyHash:    sha256hex(rec.buf.Bytes()),
					ReqHash:     hashReq(r.Method, r.URL.Path, bodyBytes),
					Headers:     rec.headersExt,
				}
				if blob, mErr := json.Marshal(cr); mErr == nil {
					// Best-effort store; не fail'им запрос если Redis down.
					_ = rdb.Set(ctx, redisKey, blob, IdempotencyTTL).Err()
				}
			}
		})
	}
}

// capturingWriter — http.ResponseWriter wrapper который копирует body в
// buf для последующего cache'а.
type capturingWriter struct {
	http.ResponseWriter
	buf        bytes.Buffer
	status     int
	wroteHead  bool
	headersExt map[string]string
}

func (c *capturingWriter) WriteHeader(code int) {
	if c.wroteHead {
		return
	}
	c.status = code
	c.wroteHead = true
	// Capture select headers worth replaying. ETag/Location — самые
	// важные для idempotent CreateRoom (Location: /room/{id}).
	for _, h := range []string{"ETag", "Location"} {
		if v := c.ResponseWriter.Header().Get(h); v != "" {
			c.headersExt[h] = v
		}
	}
	c.ResponseWriter.WriteHeader(code)
}

func (c *capturingWriter) Write(p []byte) (int, error) {
	if !c.wroteHead {
		c.WriteHeader(http.StatusOK)
	}
	c.buf.Write(p)
	n, err := c.ResponseWriter.Write(p)
	if err != nil {
		return n, fmt.Errorf("idempotency: response write: %w", err)
	}
	return n, nil
}

func sha256hex(b []byte) string {
	h := sha256.Sum256(b)
	return hex.EncodeToString(h[:])
}

func hashReq(method, path string, body []byte) string {
	h := sha256.New()
	h.Write([]byte(method))
	h.Write([]byte{'\n'})
	h.Write([]byte(path))
	h.Write([]byte{'\n'})
	h.Write(body)
	return hex.EncodeToString(h.Sum(nil))
}

func clientIP(r *http.Request) string {
	if v := r.Header.Get("X-Forwarded-For"); v != "" {
		// Берём первый IP — closest to client.
		if i := strings.IndexByte(v, ','); i >= 0 {
			return strings.TrimSpace(v[:i])
		}
		return strings.TrimSpace(v)
	}
	if v := r.Header.Get("X-Real-IP"); v != "" {
		return strings.TrimSpace(v)
	}
	return r.RemoteAddr
}
