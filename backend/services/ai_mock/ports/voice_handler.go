// Package ports — voice TTS + turn handler.
//
// Mounted at:
//   - POST /api/v1/voice/tts  — synthesise speech via Edge TTS proxy.
//     Body: {"text":"...","voice":"premium-male","lang":"ru-RU"}
//     200 audio/mpeg | 402 premium_required | 501 edge stub.
//   - POST /api/v1/voice/turn — single dialogue turn for the live session.
//     Body: {"sessionId":"abc","text":"user question"}
//     200 application/json {"aiText":"...","audioUrl":null}.
//
// Both endpoints expect bearer auth applied upstream by the chi gate so
// shared/pkg/middleware.UserIDFromContext returns the user. Free-tier users
// are blocked from premium-* voices with HTTP 402.
package ports

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"strings"

	"druz9/ai_mock/infra"
	sharedMw "druz9/shared/pkg/middleware"
)

// UserTierResolver returns the subscription tier ("free" | "premium" | "pro")
// for a given user. The monolith wires a real implementation that joins
// against the profile DB; tests can stub it freely.
type UserTierResolver func(ctx context.Context, userID string) (string, error)

// VoiceTurner produces the AI's reply for a single user utterance. The
// monolith wires this through the existing ai_mock SendMessage flow when
// the sessionId is a real DB session; for the new lightweight voice flow we
// accept any string and the resolver may simply call OpenRouter / a canned
// generator.
type VoiceTurner func(ctx context.Context, userID, sessionID, userText string) (string, error)

// VoiceHandler holds dependencies for /api/v1/voice/*.
type VoiceHandler struct {
	TTS  infra.EdgeTTSClient
	Tier UserTierResolver
	Turn VoiceTurner
	Log  *slog.Logger
}

// NewVoiceHandler wires the handler.
func NewVoiceHandler(tts infra.EdgeTTSClient, tier UserTierResolver, turn VoiceTurner, log *slog.Logger) *VoiceHandler {
	return &VoiceHandler{TTS: tts, Tier: tier, Turn: turn, Log: log}
}

type ttsReq struct {
	Text  string `json:"text"`
	Voice string `json:"voice"`
	Lang  string `json:"lang"`
}

type errorBody struct {
	Error        string `json:"error"`
	TierRequired string `json:"tier_required,omitempty"`
}

// HandleTTS serves POST /api/v1/voice/tts.
func (h *VoiceHandler) HandleTTS(w http.ResponseWriter, r *http.Request) {
	uid, ok := sharedMw.UserIDFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, errorBody{Error: "unauthenticated"})
		return
	}
	var req ttsReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, errorBody{Error: "invalid_body"})
		return
	}
	req.Text = strings.TrimSpace(req.Text)
	if req.Text == "" {
		writeJSON(w, http.StatusBadRequest, errorBody{Error: "text_required"})
		return
	}
	if req.Lang == "" {
		req.Lang = "ru-RU"
	}

	// Premium gate: anything starting with "premium-" requires a paid tier.
	isPremium := strings.HasPrefix(req.Voice, "premium-")
	if isPremium {
		tier, err := h.resolveTier(r.Context(), uid.String())
		if err != nil {
			h.logErr("voice/tts: tier lookup failed", err)
			writeJSON(w, http.StatusInternalServerError, errorBody{Error: "tier_lookup_failed"})
			return
		}
		if tier != "premium" && tier != "pro" {
			writeJSON(w, http.StatusPaymentRequired, errorBody{
				Error:        "premium_required",
				TierRequired: "premium",
			})
			return
		}
	} else {
		// "browser" / unknown — backend has nothing to synthesise. The
		// frontend should call window.speechSynthesis directly. We treat
		// it as a 400 so a misuse is loud.
		writeJSON(w, http.StatusBadRequest, errorBody{Error: "voice_must_be_premium"})
		return
	}

	edgeVoice := infra.PickEdgeVoice(req.Voice, req.Lang)
	audio, err := h.TTS.Synth(r.Context(), req.Text, edgeVoice)
	if errors.Is(err, infra.ErrEdgeTTSNotImplemented) {
		// Stub path — advertise the stub via header so the client falls
		// back gracefully (and so ops dashboards can alarm when this fires
		// in prod, post-implementation).
		w.Header().Set("X-Edge-TTS-Stub", "true")
		writeJSON(w, http.StatusNotImplemented, errorBody{Error: "edge_tts_stub"})
		return
	}
	if err != nil {
		h.logErr("voice/tts: synth failed", err)
		writeJSON(w, http.StatusBadGateway, errorBody{Error: "tts_failed"})
		return
	}
	w.Header().Set("Content-Type", "audio/mpeg")
	w.Header().Set("Cache-Control", "no-store")
	_, _ = w.Write(audio)
}

type turnReq struct {
	SessionID string `json:"sessionId"`
	Text      string `json:"text"`
}

type turnResp struct {
	AIText   string  `json:"aiText"`
	AudioURL *string `json:"audioUrl"`
}

// HandleTurn serves POST /api/v1/voice/turn.
func (h *VoiceHandler) HandleTurn(w http.ResponseWriter, r *http.Request) {
	uid, ok := sharedMw.UserIDFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, errorBody{Error: "unauthenticated"})
		return
	}
	var req turnReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, errorBody{Error: "invalid_body"})
		return
	}
	req.Text = strings.TrimSpace(req.Text)
	if req.Text == "" {
		writeJSON(w, http.StatusBadRequest, errorBody{Error: "text_required"})
		return
	}
	if h.Turn == nil {
		// No real LLM wired yet — echo a canned reply so e2e works.
		writeJSON(w, http.StatusOK, turnResp{AIText: "Понятно. Расскажи подробнее."})
		return
	}
	ai, err := h.Turn(r.Context(), uid.String(), req.SessionID, req.Text)
	if err != nil {
		h.logErr("voice/turn: turn failed", err)
		writeJSON(w, http.StatusInternalServerError, errorBody{Error: "turn_failed"})
		return
	}
	writeJSON(w, http.StatusOK, turnResp{AIText: ai})
}

func (h *VoiceHandler) resolveTier(ctx context.Context, userID string) (string, error) {
	if h.Tier == nil {
		// Conservative default — without a resolver we treat everyone as free.
		return "free", nil
	}
	return h.Tier(ctx, userID)
}

func (h *VoiceHandler) logErr(msg string, err error) {
	if h.Log != nil {
		h.Log.Error(msg, slog.Any("err", err))
	}
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}
