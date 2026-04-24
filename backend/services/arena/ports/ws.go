// Package ports подключает arena-домен к HTTP- и WebSocket-транспортам.
package ports

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"strings"
	"sync"
	"time"

	"druz9/arena/app"

	"github.com/google/uuid"
	"github.com/gorilla/websocket"
)

// TokenVerifier — локальный интерфейс, через который WS-хаб валидирует
// JWT-токены на handshake. Реализуется TokenIssuer из auth-домена;
// инжектится в cmd/monolith-wiring.
type TokenVerifier interface {
	// VerifyAccess парсит сырой токен и возвращает user id его владельца.
	VerifyAccess(raw string) (uuid.UUID, error)
}

// Типы исходящих сообщений (server → client) — bible / openapi x-websocket.
const (
	MsgMatchStart       = "match_start"
	MsgOpponentAccepted = "opponent_accepted"
	MsgOpponentProgress = "opponent_progress"
	MsgMatchResult      = "match_result"
	MsgCountdown        = "countdown"
)

// Типы входящих сообщений (client → server).
const (
	MsgMatchReady = "match_ready"
	MsgCodeSubmit = "code_submit"
	MsgHeartbeat  = "heartbeat"
	// Дополнительные сообщения anticheat-сигналов.
	MsgPasteAttempt = "paste_attempt"
	MsgTabSwitch    = "tab_switch"
)

// rateLimit: 20 msgs/sec per connection (bible §11).
const maxMsgsPerSecond = 20

// Envelope — общая форма сообщения.
type Envelope struct {
	Type string          `json:"type"`
	Data json.RawMessage `json:"data,omitempty"`
}

// client — одно WS-соединение, привязанное к матчу.
type client struct {
	matchID uuid.UUID
	userID  uuid.UUID
	conn    *websocket.Conn
	send    chan []byte
	log     *slog.Logger
	// окно rate limiting'а
	rlMu    sync.Mutex
	rlStart time.Time
	rlCount int
}

// Hub владеет per-match комнатами.
type Hub struct {
	Log            *slog.Logger
	Verifier       TokenVerifier
	AllowedOrigins []string
	upgrader       websocket.Upgrader

	mu    sync.RWMutex
	rooms map[uuid.UUID]map[*client]struct{}

	// anticheat-хуки — инжектятся из cmd/monolith.
	OnPaste OnPasteFunc
	OnTab   OnTabSwitchFunc
}

// OnPasteFunc вызывается каждый раз, когда клиент шлёт событие paste_attempt.
type OnPasteFunc func(ctx context.Context, matchID, userID uuid.UUID)

// OnTabSwitchFunc вызывается на событиях tab_switch.
type OnTabSwitchFunc func(ctx context.Context, matchID, userID uuid.UUID)

// NewHub собирает hub. Origins — список допустимых origin'ов через запятую;
// пустой список принимает любой origin для local dev.
func NewHub(log *slog.Logger, verifier TokenVerifier, allowedOrigins []string) *Hub {
	h := &Hub{
		Log:            log,
		Verifier:       verifier,
		AllowedOrigins: allowedOrigins,
		rooms:          make(map[uuid.UUID]map[*client]struct{}),
	}
	h.upgrader = websocket.Upgrader{
		CheckOrigin: h.originAllowed,
	}
	return h
}

func (h *Hub) originAllowed(r *http.Request) bool {
	if len(h.AllowedOrigins) == 0 {
		return true
	}
	o := r.Header.Get("Origin")
	for _, allowed := range h.AllowedOrigins {
		if strings.EqualFold(strings.TrimSpace(allowed), o) {
			return true
		}
	}
	return false
}

// register добавляет клиента в комнату.
func (h *Hub) register(c *client) {
	h.mu.Lock()
	defer h.mu.Unlock()
	room, ok := h.rooms[c.matchID]
	if !ok {
		room = make(map[*client]struct{})
		h.rooms[c.matchID] = room
	}
	room[c] = struct{}{}
}

// unregister удаляет клиента и закрывает его send-канал.
func (h *Hub) unregister(c *client) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if room, ok := h.rooms[c.matchID]; ok {
		if _, present := room[c]; present {
			delete(room, c)
			close(c.send)
		}
		if len(room) == 0 {
			delete(h.rooms, c.matchID)
		}
	}
}

// Broadcast рассылает envelope всем клиентам в комнате матча.
func (h *Hub) Broadcast(matchID uuid.UUID, msgType string, payload any) {
	env := Envelope{Type: msgType}
	if payload != nil {
		raw, err := json.Marshal(payload)
		if err != nil {
			h.Log.Error("arena.ws.Broadcast: marshal", slog.Any("err", err))
			return
		}
		env.Data = raw
	}
	buf, err := json.Marshal(env)
	if err != nil {
		h.Log.Error("arena.ws.Broadcast: encode", slog.Any("err", err))
		return
	}
	h.mu.RLock()
	room := h.rooms[matchID]
	// снимаем snapshot получателей, чтобы не держать lock на медленных записях
	targets := make([]*client, 0, len(room))
	for c := range room {
		targets = append(targets, c)
	}
	h.mu.RUnlock()
	for _, c := range targets {
		select {
		case c.send <- buf:
		default:
			// Клиент медленный — дропаем и логируем; hub не блокируем.
			h.Log.Warn("arena.ws: slow client dropped",
				slog.String("user", c.userID.String()),
				slog.String("match", matchID.String()))
		}
	}
}

// NotifyMatched реализует app.MatchNotifier — вызывается matchmaker'ом.
// WS-хаб шлёт envelope match_start, адресованный только указанному пользователю.
func (h *Hub) NotifyMatched(_ context.Context, userID, matchID uuid.UUID) {
	// Per-user routing — ищем соединение пользователя (если он уже подключён
	// к комнате) и шлём envelope. Если ещё не подключён — начальный
	// GET /match/{matchId} подтянет состояние.
	h.mu.RLock()
	room := h.rooms[matchID]
	targets := make([]*client, 0, len(room))
	for c := range room {
		if c.userID == userID {
			targets = append(targets, c)
		}
	}
	h.mu.RUnlock()
	buf, _ := json.Marshal(Envelope{Type: MsgOpponentAccepted})
	for _, c := range targets {
		select {
		case c.send <- buf:
		default:
		}
	}
}

// ServeWS апгрейдит HTTP-соединение и запускает read/write-циклы клиента.
// matchId извлекается из URL вызывающим.
func (h *Hub) ServeWS(w http.ResponseWriter, r *http.Request, matchID uuid.UUID, userID uuid.UUID) {
	conn, err := h.upgrader.Upgrade(w, r, nil)
	if err != nil {
		h.Log.Warn("arena.ws: upgrade failed", slog.Any("err", err))
		return
	}
	c := &client{
		matchID: matchID,
		userID:  userID,
		conn:    conn,
		send:    make(chan []byte, 32),
		log:     h.Log,
		rlStart: time.Now(),
	}
	h.register(c)
	go c.writePump()
	go c.readPump(h)
}

// STUB: spectator read-only WS — для режима наблюдателя принимали бы
// соединения, не матча пользователя к участнику, пропускали rate-limit
// дроп, но не принимали входящих сообщений. Вне scope MVP.

// readPump читает входящие сообщения клиента, применяет rate-limit и
// диспетчеризует по типу.
func (c *client) readPump(h *Hub) {
	defer func() {
		h.unregister(c)
		_ = c.conn.Close()
	}()
	c.conn.SetReadLimit(64 * 1024)
	_ = c.conn.SetReadDeadline(time.Now().Add(60 * time.Second))
	c.conn.SetPongHandler(func(string) error {
		return c.conn.SetReadDeadline(time.Now().Add(60 * time.Second))
	})
	for {
		_, data, err := c.conn.ReadMessage()
		if err != nil {
			return
		}
		if !c.rateOk() {
			h.Log.Warn("arena.ws: rate limit — dropping message",
				slog.String("user", c.userID.String()))
			continue
		}
		var env Envelope
		if err := json.Unmarshal(data, &env); err != nil {
			h.Log.Warn("arena.ws: bad json", slog.Any("err", err))
			continue
		}
		switch env.Type {
		case MsgHeartbeat:
			// no-op — pong держит deadline свежим через pong-handler
		case MsgMatchReady:
			// HTTP /confirm — источник истины; WS-событие просто эхоит
			// готовность на противоположную сторону.
			h.Broadcast(c.matchID, MsgOpponentAccepted, map[string]any{
				"user_id": c.userID,
			})
		case MsgCodeSubmit:
			// Отправки также обслуживаются по HTTP. WS-отправка бродкастила
			// бы прогресс; вне scope MVP.
		case MsgPasteAttempt:
			if h.OnPaste != nil {
				h.OnPaste(context.Background(), c.matchID, c.userID)
			}
		case MsgTabSwitch:
			if h.OnTab != nil {
				h.OnTab(context.Background(), c.matchID, c.userID)
			}
		default:
			// Неизвестный тип — игнорируем.
		}
	}
}

// rateOk возвращает true, пока клиент вписывается в бюджет 20 сообщений/сек.
func (c *client) rateOk() bool {
	c.rlMu.Lock()
	defer c.rlMu.Unlock()
	now := time.Now()
	if now.Sub(c.rlStart) >= time.Second {
		c.rlStart = now
		c.rlCount = 0
	}
	c.rlCount++
	return c.rlCount <= maxMsgsPerSecond
}

// writePump стримит исходящие сообщения и шлёт периодические ping'и.
func (c *client) writePump() {
	ping := time.NewTicker(30 * time.Second)
	defer func() {
		ping.Stop()
		_ = c.conn.Close()
	}()
	for {
		select {
		case msg, ok := <-c.send:
			_ = c.conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
			if !ok {
				_ = c.conn.WriteMessage(websocket.CloseMessage, []byte{})
				return
			}
			if err := c.conn.WriteMessage(websocket.TextMessage, msg); err != nil {
				return
			}
		case <-ping.C:
			_ = c.conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
			if err := c.conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		}
	}
}

// Compile-time: Hub реализует app.MatchNotifier.
var _ app.MatchNotifier = (*Hub)(nil)
