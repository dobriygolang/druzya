package metrics

import (
	"bufio"
	"net"
	"net/http"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"
)

// ChiMiddleware records HTTP request duration, count, and error count using
// the chi route pattern (e.g. /api/v1/profile/{username}) instead of the raw
// URL — that keeps cardinality bounded.
//
// Wire it AFTER the chi router has had a chance to populate RouteContext —
// i.e. apply via r.Use(...) on the chi.Router itself, not on a wrapping mux.
func ChiMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		sw := &statusCapture{ResponseWriter: w, status: http.StatusOK}
		next.ServeHTTP(sw, r)

		// chi's RouteContext is populated as the request walks the tree, so
		// we read it AFTER ServeHTTP. Falls back to URL.Path if the request
		// didn't match a registered route (404 / mux passthrough).
		path := r.URL.Path
		if rc := chi.RouteContext(r.Context()); rc != nil {
			if pat := rc.RoutePattern(); pat != "" {
				path = pat
			}
		}
		status := strconv.Itoa(sw.status)
		method := r.Method
		dur := time.Since(start).Seconds()

		HTTPRequestsTotal.WithLabelValues(method, path, status).Inc()
		HTTPRequestDuration.WithLabelValues(method, path, status).Observe(dur)
		if sw.status >= 400 {
			HTTPErrorsTotal.WithLabelValues(method, path, status).Inc()
		}
	})
}

// statusCapture is a minimal wrapper that remembers the status code while
// forwarding Flush — Connect/streaming handlers depend on it.
type statusCapture struct {
	http.ResponseWriter
	status      int
	wroteHeader bool
}

func (s *statusCapture) WriteHeader(code int) {
	if !s.wroteHeader {
		s.status = code
		s.wroteHeader = true
	}
	s.ResponseWriter.WriteHeader(code)
}

func (s *statusCapture) Flush() {
	if f, ok := s.ResponseWriter.(http.Flusher); ok {
		f.Flush()
	}
}

// Hijack пробрасывает в нижележащий ResponseWriter — gorilla/websocket
// использует Hijacker при upgrade'е TCP-conn. Без этого все /ws/* endpoints
// падают с «response does not implement http.Hijacker».
func (s *statusCapture) Hijack() (net.Conn, *bufio.ReadWriter, error) {
	if h, ok := s.ResponseWriter.(http.Hijacker); ok {
		return h.Hijack()
	}
	return nil, nil, http.ErrNotSupported
}
