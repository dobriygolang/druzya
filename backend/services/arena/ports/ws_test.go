// Package ports — Hub / WS handshake tests.
//
// These tests exercise the public hub surface using a real httptest server
// + gorilla/websocket client; mocking the upgrader doesn't catch the
// quirks (origin check, auth, ping/pong). The WSHandler verifies the JWT
// from ?token= and only joins a room on success.
package ports

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/gorilla/websocket"
)

// fakeVerifier implements TokenVerifier with a single mapping token→uid.
type fakeVerifier struct {
	want string
	uid  uuid.UUID
}

func (f fakeVerifier) VerifyAccess(raw string) (uuid.UUID, error) {
	if raw != f.want {
		return uuid.Nil, errors.New("bad token")
	}
	return f.uid, nil
}

// newWSServer wires a chi mux carrying the hub's WSHandler + a verifier
// that accepts a single token. Returns the server and the hub.
func newWSServer(t *testing.T, verifier TokenVerifier) (*httptest.Server, *Hub) {
	t.Helper()
	hub := NewHub(silentLog(), verifier, nil)
	r := chi.NewRouter()
	r.Get("/ws/arena/{matchId}", hub.WSHandler)
	srv := httptest.NewServer(r)
	t.Cleanup(srv.Close)
	return srv, hub
}

// dial converts http://host → ws://host and opens a client connection.
func dial(t *testing.T, base, path string) (*websocket.Conn, *http.Response, error) {
	t.Helper()
	url := "ws" + strings.TrimPrefix(base, "http") + path
	d := websocket.Dialer{HandshakeTimeout: 2 * time.Second}
	return d.Dial(url, nil)
}

// ── handshake / auth ──────────────────────────────────────────────────────

func TestWS_Handshake_RejectsMissingToken(t *testing.T) {
	t.Parallel()
	srv, _ := newWSServer(t, fakeVerifier{want: "ok", uid: uuid.New()})
	mid := uuid.New()
	_, resp, err := dial(t, srv.URL, "/ws/arena/"+mid.String())
	closeBody(resp)
	if err == nil {
		t.Fatal("expected dial to fail without a token")
	}
	if resp == nil || resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %v", resp)
	}
}

func TestWS_Handshake_RejectsInvalidToken(t *testing.T) {
	t.Parallel()
	srv, _ := newWSServer(t, fakeVerifier{want: "ok", uid: uuid.New()})
	mid := uuid.New()
	_, resp, err := dial(t, srv.URL, "/ws/arena/"+mid.String()+"?token=BAD")
	closeBody(resp)
	if err == nil {
		t.Fatal("expected dial to fail with invalid token")
	}
	if resp == nil || resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %v", resp)
	}
}

func TestWS_Handshake_RejectsBadMatchID(t *testing.T) {
	t.Parallel()
	srv, _ := newWSServer(t, fakeVerifier{want: "ok", uid: uuid.New()})
	_, resp, err := dial(t, srv.URL, "/ws/arena/not-a-uuid?token=ok")
	closeBody(resp)
	if err == nil {
		t.Fatal("expected dial to fail with bad match-id")
	}
	if resp == nil || resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("expected 400, got %v", resp)
	}
}

// closeBody is a helper that drains and closes the http.Response body.
// gorilla/websocket returns the failed-handshake response with the body
// open; we close it here to keep the linter happy.
func closeBody(resp *http.Response) {
	if resp == nil || resp.Body == nil {
		return
	}
	_, _ = io.Copy(io.Discard, resp.Body)
	_ = resp.Body.Close()
}

// ── room semantics ────────────────────────────────────────────────────────

func TestWS_BroadcastReachesAllRoomMembers(t *testing.T) {
	t.Parallel()
	uid := uuid.New()
	srv, hub := newWSServer(t, fakeVerifier{want: "ok", uid: uid})
	mid := uuid.New()

	c1, resp1, err := dial(t, srv.URL, "/ws/arena/"+mid.String()+"?token=ok")
	closeBody(resp1)
	if err != nil {
		t.Fatalf("dial1: %v", err)
	}
	defer c1.Close()
	c2, resp2, err := dial(t, srv.URL, "/ws/arena/"+mid.String()+"?token=ok")
	closeBody(resp2)
	if err != nil {
		t.Fatalf("dial2: %v", err)
	}
	defer c2.Close()

	// Wait for both clients to register on the hub. The room is populated
	// inside ServeWS, which runs after the handshake completes — give it a
	// short grace window.
	if !waitFor(t, time.Second, func() bool { return hub.roomSize(mid) == 2 }) {
		t.Fatalf("room never reached size=2 (got %d)", hub.roomSize(mid))
	}

	hub.Broadcast(mid, MsgMatchStart, map[string]any{"hello": "world"})

	for i, c := range []*websocket.Conn{c1, c2} {
		_ = c.SetReadDeadline(time.Now().Add(time.Second))
		_, data, err := c.ReadMessage()
		if err != nil {
			t.Fatalf("client %d read: %v", i, err)
		}
		var env Envelope
		if err := json.Unmarshal(data, &env); err != nil {
			t.Fatalf("client %d unmarshal: %v", i, err)
		}
		if env.Type != MsgMatchStart {
			t.Fatalf("client %d type=%q", i, env.Type)
		}
	}
}

func TestWS_NotifyMatched_RoutesToTargetUserOnly(t *testing.T) {
	t.Parallel()
	uid := uuid.New()
	srv, hub := newWSServer(t, fakeVerifier{want: "ok", uid: uid})
	mid := uuid.New()

	c, respC, err := dial(t, srv.URL, "/ws/arena/"+mid.String()+"?token=ok")
	closeBody(respC)
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	defer c.Close()
	if !waitFor(t, time.Second, func() bool { return hub.roomSize(mid) == 1 }) {
		t.Fatalf("room never reached size=1")
	}

	hub.NotifyMatched(context.Background(), uid, mid)

	_ = c.SetReadDeadline(time.Now().Add(time.Second))
	_, data, err := c.ReadMessage()
	if err != nil {
		t.Fatalf("read: %v", err)
	}
	var env Envelope
	if err := json.Unmarshal(data, &env); err != nil {
		t.Fatal(err)
	}
	if env.Type != MsgOpponentAccepted {
		t.Fatalf("type=%q", env.Type)
	}
}

func TestWS_UnregisterOnDisconnect(t *testing.T) {
	t.Parallel()
	uid := uuid.New()
	srv, hub := newWSServer(t, fakeVerifier{want: "ok", uid: uid})
	mid := uuid.New()

	c, respC, err := dial(t, srv.URL, "/ws/arena/"+mid.String()+"?token=ok")
	closeBody(respC)
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	if !waitFor(t, time.Second, func() bool { return hub.roomSize(mid) == 1 }) {
		t.Fatalf("not registered")
	}
	_ = c.Close()
	if !waitFor(t, 2*time.Second, func() bool { return hub.roomSize(mid) == 0 }) {
		t.Fatalf("room never cleared after disconnect (size=%d)", hub.roomSize(mid))
	}
}

// ── inbound paste/tab anticheat dispatch ──────────────────────────────────

func TestWS_InboundPaste_FiresOnPasteHook(t *testing.T) {
	t.Parallel()
	uid := uuid.New()
	srv, hub := newWSServer(t, fakeVerifier{want: "ok", uid: uid})
	mid := uuid.New()

	var (
		mu     sync.Mutex
		gotMID uuid.UUID
		gotUID uuid.UUID
		fired  = make(chan struct{}, 1)
	)
	hub.OnPaste = func(_ context.Context, m, u uuid.UUID) {
		mu.Lock()
		gotMID, gotUID = m, u
		mu.Unlock()
		select {
		case fired <- struct{}{}:
		default:
		}
	}

	c, respC, err := dial(t, srv.URL, "/ws/arena/"+mid.String()+"?token=ok")
	closeBody(respC)
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	defer c.Close()
	if !waitFor(t, time.Second, func() bool { return hub.roomSize(mid) == 1 }) {
		t.Fatalf("not registered")
	}

	if err := c.WriteJSON(Envelope{Type: MsgPasteAttempt}); err != nil {
		t.Fatal(err)
	}
	select {
	case <-fired:
	case <-time.After(time.Second):
		t.Fatal("OnPaste hook never fired")
	}
	mu.Lock()
	defer mu.Unlock()
	if gotMID != mid || gotUID != uid {
		t.Fatalf("dispatched (mid=%s uid=%s)", gotMID, gotUID)
	}
}

// ── helpers ───────────────────────────────────────────────────────────────

// roomSize reports the current member count for a room. Test-only helper —
// reaches into hub state under the same lock the production code uses.
func (h *Hub) roomSize(matchID uuid.UUID) int {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return len(h.rooms[matchID])
}

// waitFor polls cond up to d, returning true when it reports true.
func waitFor(t *testing.T, d time.Duration, cond func() bool) bool {
	t.Helper()
	deadline := time.Now().Add(d)
	for time.Now().Before(deadline) {
		if cond() {
			return true
		}
		time.Sleep(10 * time.Millisecond)
	}
	return cond()
}
