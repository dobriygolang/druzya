// llmchain_admin.go — facade-only wiring for the runtime LLM chain admin UI.
//
// Endpoint logic lives in services/admin/ports/llmchain_admin.go (Connect
// server). Both endpoints require role=admin; the gate is applied above
// the transcoder per-path.
package admin

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"

	monolithServices "druz9/cmd/monolith/services"
	authServices "druz9/cmd/monolith/services/auth"

	adminPorts "druz9/admin/ports"
	"druz9/shared/generated/pb/druz9/v1/druz9v1connect"
	"druz9/shared/pkg/llmchain"

	"github.com/go-chi/chi/v5"
)

// NewLLMChainAdmin wires admin GET/PUT for runtime LLM chain config.
//
// chain may be nil (no provider keys configured) — in that case no routes
// are mounted, /llm/config returns 404.
//
// registeredProviders is currently unused on the proto surface. The
// frontend pulls live-preview state from the same response on a separate
// endpoint when needed; keeping the parameter avoids a churn-only signature
// change.
func NewLLMChainAdmin(d monolithServices.Deps, chain *llmchain.Chain, registeredProviders []string) *monolithServices.Module {
	_ = registeredProviders
	if chain == nil {
		return &monolithServices.Module{}
	}
	src := newLLMConfigSource(d.Pool)
	server := &adminPorts.LLMChainAdminServer{
		Source: src,
		Chain:  chain,
		Log:    d.Log,
	}

	connectPath, connectHandler := druz9v1connect.NewLLMChainAdminServiceHandler(server)
	transcoder := monolithServices.MustTranscode("llmchain_admin", connectPath, connectHandler)

	adminGate := func(w http.ResponseWriter, r *http.Request) {
		if _, err := authServices.RequireAdminInline(r); err != nil {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(authServices.StatusForAuthErr(err))
			_, _ = fmt.Fprintf(w, `{"error":"%s"}`, err.Error())
			return
		}
		transcoder.ServeHTTP(w, r)
	}
	testGate := func(w http.ResponseWriter, r *http.Request) {
		if _, err := authServices.RequireAdminInline(r); err != nil {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(authServices.StatusForAuthErr(err))
			_, _ = fmt.Fprintf(w, `{"error":"%s"}`, err.Error())
			return
		}
		llmTestHandler(chain).ServeHTTP(w, r)
	}

	return &monolithServices.Module{
		ConnectPath:    connectPath,
		ConnectHandler: transcoder,
		MountREST: func(r chi.Router) {
			r.Get("/admin/llm/config", adminGate)
			r.Put("/admin/llm/config", adminGate)
			r.Post("/admin/llm/test", testGate)
		},
	}
}

type llmTestRequest struct {
	Provider string `json:"provider"`
	Model    string `json:"model"`
	Prompt   string `json:"prompt"`
}

type llmTestResponse struct {
	OK        bool   `json:"ok"`
	Provider  string `json:"provider"`
	Model     string `json:"model"`
	Content   string `json:"content,omitempty"`
	TokensIn  int    `json:"tokens_in,omitempty"`
	TokensOut int    `json:"tokens_out,omitempty"`
	LatencyMs int64  `json:"latency_ms,omitempty"`
	Error     string `json:"error,omitempty"`
}

func llmTestHandler(chain *llmchain.Chain) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var in llmTestRequest
		if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
			http.Error(w, "invalid json", http.StatusBadRequest)
			return
		}
		in.Provider = strings.TrimSpace(in.Provider)
		in.Model = strings.TrimSpace(in.Model)
		if in.Provider == "" || in.Model == "" {
			http.Error(w, "provider and model required", http.StatusBadRequest)
			return
		}
		resp, err := chain.TestProviderModel(r.Context(), llmchain.Provider(in.Provider), in.Model, in.Prompt)
		w.Header().Set("Content-Type", "application/json")
		if err != nil {
			w.WriteHeader(http.StatusBadGateway)
			_ = json.NewEncoder(w).Encode(llmTestResponse{
				OK:       false,
				Provider: in.Provider,
				Model:    in.Model,
				Error:    err.Error(),
			})
			return
		}
		_ = json.NewEncoder(w).Encode(llmTestResponse{
			OK:        true,
			Provider:  string(resp.Provider),
			Model:     resp.Model,
			Content:   resp.Content,
			TokensIn:  resp.TokensIn,
			TokensOut: resp.TokensOut,
			LatencyMs: resp.Latency.Milliseconds(),
		})
	})
}
