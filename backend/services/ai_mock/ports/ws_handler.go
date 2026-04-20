package ports

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"druz9/ai_mock/app"
	"druz9/ai_mock/domain"
	"druz9/shared/enums"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/gorilla/websocket"
)

// InterventionIdle is the silence window after which the intervention watchdog
// asks the LLM to nudge the candidate. Bible: 2 minutes.
const InterventionIdle = 2 * time.Minute

// WSHandler holds the dependencies for /ws/mock/{sessionId}.
type WSHandler struct {
	Hub      *Hub
	Verifier domain.TokenVerifier
	Sessions domain.SessionRepo
	Messages domain.MessageRepo
	Send     *app.SendMessage
	Stress   *app.IngestStress
	Log      *slog.Logger

	// Upgrader is exposed for tests / origin-policy overrides. Default permits
	// all origins — lock this down before production.
	Upgrader websocket.Upgrader
}

// NewWSHandler constructs a handler with a permissive upgrader.
//
// STUB: Upgrader.CheckOrigin currently allows everything — tighten once the
// frontend origin is pinned per-environment.
func NewWSHandler(hub *Hub, ver domain.TokenVerifier, sess domain.SessionRepo, msgs domain.MessageRepo, send *app.SendMessage, stress *app.IngestStress, log *slog.Logger) *WSHandler {
	return &WSHandler{
		Hub: hub, Verifier: ver, Sessions: sess, Messages: msgs, Send: send, Stress: stress, Log: log,
		Upgrader: websocket.Upgrader{
			ReadBufferSize:  4096,
			WriteBufferSize: 4096,
			CheckOrigin:     func(r *http.Request) bool { return true },
		},
	}
}

// Handle is the chi handler for GET /ws/mock/{sessionId}.
func (h *WSHandler) Handle(w http.ResponseWriter, r *http.Request) {
	sidStr := chi.URLParam(r, "sessionId")
	sid, err := uuid.Parse(sidStr)
	if err != nil {
		http.Error(w, "invalid sessionId", http.StatusBadRequest)
		return
	}
	// Handshake auth via ?token= (bible). Upgraders can't read Authorization
	// reliably from browsers.
	token := r.URL.Query().Get("token")
	if token == "" {
		// Accept "Bearer …" header as a fallback for non-browser clients.
		if auth := r.Header.Get("Authorization"); strings.HasPrefix(auth, "Bearer ") {
			token = strings.TrimPrefix(auth, "Bearer ")
		}
	}
	uid, err := h.Verifier.Verify(token)
	if err != nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	s, err := h.Sessions.Get(r.Context(), sid)
	if err != nil {
		if errors.Is(err, domain.ErrNotFound) {
			http.Error(w, "not found", http.StatusNotFound)
			return
		}
		http.Error(w, "internal", http.StatusInternalServerError)
		return
	}
	if s.UserID != uid {
		http.Error(w, "forbidden", http.StatusForbidden)
		return
	}
	if s.Status == enums.MockStatusFinished || s.Status == enums.MockStatusAbandoned {
		http.Error(w, "session closed", http.StatusConflict)
		return
	}

	ws, err := h.Upgrader.Upgrade(w, r, nil)
	if err != nil {
		h.Log.Warn("mock.ws: upgrade failed", slog.Any("err", err))
		return
	}

	h.servePeer(r.Context(), ws, sid, uid)
}

// servePeer runs until the connection is closed.
func (h *WSHandler) servePeer(rootCtx context.Context, ws *websocket.Conn, sessionID, userID uuid.UUID) {
	ctx, cancel := context.WithCancel(rootCtx)
	defer cancel()

	c := newWSConn(ws, h.Log)
	h.Hub.register(sessionID, c)
	defer func() {
		h.Hub.unregister(sessionID, c)
		close(c.done)
		_ = ws.Close()
	}()

	// Intervention watchdog — fires the LLM hint path on idle.
	watch := domain.NewInterventionWatch(InterventionIdle, func() {
		// Fire-and-forget. The WS output is buffered; errors logged.
		go h.fireIntervention(ctx, sessionID, c)
	})
	defer watch.Stop()
	watch.Poke()

	go c.writeLoop(ctx)

	_ = ws.SetReadDeadline(time.Now().Add(wsReadDeadline))
	ws.SetPongHandler(func(string) error {
		_ = ws.SetReadDeadline(time.Now().Add(wsReadDeadline))
		return nil
	})

	for {
		if ctx.Err() != nil {
			return
		}
		_, data, err := ws.ReadMessage()
		if err != nil {
			return
		}
		_ = ws.SetReadDeadline(time.Now().Add(wsReadDeadline))

		var frame WSInbound
		if err := json.Unmarshal(data, &frame); err != nil {
			continue
		}
		switch frame.Kind {
		case "editor_event":
			var p wsEditorEventPayload
			if err := json.Unmarshal(frame.Payload, &p); err != nil {
				continue
			}
			ev, ok := p.toDomain()
			if !ok {
				continue
			}
			if _, err := h.Stress.Do(ctx, app.IngestStressInput{
				UserID: userID, SessionID: sessionID, Events: []domain.EditorEvent{ev},
			}); err != nil {
				h.Log.Warn("mock.ws: ingest stress", slog.Any("err", err))
			}
			// Editor activity = the candidate is engaged; reset the watchdog.
			watch.Poke()

		case "user_message":
			var p wsUserMessagePayload
			if err := json.Unmarshal(frame.Payload, &p); err != nil {
				continue
			}
			h.streamAssistant(ctx, c, sessionID, userID, p)
			watch.Poke()

		case "voice_chunk":
			var p wsVoiceChunkPayload
			if err := json.Unmarshal(frame.Payload, &p); err != nil {
				continue
			}
			// Treat voice transcript as a text message (bible §8).
			h.streamAssistant(ctx, c, sessionID, userID, wsUserMessagePayload{Content: p.Transcript})
			watch.Poke()

		case "ping":
			// Client-origin ping; ACK with an empty pong frame.
			c.send(WSFrame{Kind: "pong"})

		default:
			// Unknown kinds are ignored — forward-compat.
		}
	}
}

// streamAssistant persists the user message and streams the LLM response token
// by token as ai_token frames, finishing with ai_done.
func (h *WSHandler) streamAssistant(ctx context.Context, c *wsConn, sessionID, userID uuid.UUID, p wsUserMessagePayload) {
	// Persist user message via SendMessage use case is overkill for streaming —
	// we reach into MessageRepo directly. (Rate-limit is still enforced by
	// SendMessage; WS bypasses it intentionally for now — STUB: plumb a shared
	// limiter into WSHandler.)
	content := p.Content
	if p.VoiceTranscript != "" {
		content = p.VoiceTranscript
	}

	s, err := h.Sessions.Get(ctx, sessionID)
	if err != nil {
		c.send(errorFrame("load_session", err))
		return
	}
	if s.Status == enums.MockStatusCreated {
		_ = h.Sessions.UpdateStatus(ctx, sessionID, enums.MockStatusInProgress.String(), false)
		s.Status = enums.MockStatusInProgress
	}

	userMsg, err := h.Messages.Append(ctx, domain.Message{
		SessionID:    sessionID,
		Role:         enums.MessageRoleUser,
		Content:      content,
		CodeSnapshot: p.CodeSnapshot,
	})
	if err != nil {
		c.send(errorFrame("persist_user", err))
		return
	}
	ackMsgFrame(c, "user_message_ack", userMsg)

	ch, err := h.Send.StreamReply(ctx, s, p.CodeSnapshot)
	if err != nil {
		c.send(errorFrame("stream", err))
		return
	}

	var builder strings.Builder
	var tokens int
	for tok := range ch {
		if tok.Err != nil {
			c.send(errorFrame("llm", tok.Err))
			return
		}
		if tok.Delta != "" {
			builder.WriteString(tok.Delta)
			payload, _ := json.Marshal(map[string]any{"delta": tok.Delta})
			c.send(WSFrame{Kind: "ai_token", Payload: payload})
		}
		if tok.Done {
			tokens = tok.TokensUsed
			break
		}
	}

	// Persist final assistant message so /session.last_messages returns it.
	final, err := h.Messages.Append(ctx, domain.Message{
		SessionID:  sessionID,
		Role:       enums.MessageRoleAssistant,
		Content:    builder.String(),
		TokensUsed: tokens,
	})
	if err != nil {
		c.send(errorFrame("persist_assistant", err))
		return
	}
	donePayload, _ := json.Marshal(map[string]any{
		"message_id":  final.ID,
		"tokens_used": tokens,
	})
	c.send(WSFrame{Kind: "ai_done", Payload: donePayload})
}

// fireIntervention is invoked by the watchdog. Runs on its own goroutine.
func (h *WSHandler) fireIntervention(ctx context.Context, sessionID uuid.UUID, c *wsConn) {
	// For MVP we surface a static nudge rather than making another LLM call
	// inline — keeps cost predictable. The next message roundtrip picks up
	// the silence in BuildSystemPrompt via the timing in block 3.
	h.Hub.BroadcastIntervention(sessionID, "Вы молчите — давайте проговорим, какие варианты вы рассматриваете.")
	// Future: call LLM Complete with a specialised "nudge" system prompt.
	_ = ctx
	_ = c
}

// ─────────────────────────────────────────────────────────────────────────

func errorFrame(kind string, err error) WSFrame {
	payload, _ := json.Marshal(map[string]any{"kind": kind, "error": err.Error()})
	return WSFrame{Kind: "error", Payload: payload}
}

func ackMsgFrame(c *wsConn, kind string, m domain.Message) {
	payload, _ := json.Marshal(map[string]any{
		"id":         m.ID,
		"role":       m.Role,
		"content":    m.Content,
		"created_at": m.CreatedAt,
	})
	c.send(WSFrame{Kind: kind, Payload: payload})
}
