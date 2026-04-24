package services

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"strings"

	"druz9/shared/pkg/llmchain"
	sharedMw "druz9/shared/pkg/middleware"

	"github.com/go-chi/chi/v5"
)

// llmAdminHandler — админские ручки для runtime-config LLM chain'а.
// Два endpoint'а:
//
//	GET  /api/v1/admin/llm/config      — текущий config (version + все поля)
//	PUT  /api/v1/admin/llm/config      — full replace с optimistic lock
//
// Оба требуют role=admin (проверка в handler'е через UserRoleFromContext).
// После успешного PUT — Chain.RuntimeForceReload() чтобы изменения вступили
// в силу мгновенно, не ждя 30s ticker.
type llmAdminHandler struct {
	src   llmchain.ConfigSource
	chain *llmchain.Chain // для force-reload после PUT
	log   *slog.Logger
}

func newLLMAdminHandler(src llmchain.ConfigSource, chain *llmchain.Chain, log *slog.Logger) *llmAdminHandler {
	return &llmAdminHandler{src: src, chain: chain, log: log}
}

// mount регистрирует оба endpoint'а в /api/v1/admin/llm/config.
func (h *llmAdminHandler) mount(r chi.Router) {
	r.Get("/admin/llm/config", h.handleGet)
	r.Put("/admin/llm/config", h.handlePut)
}

type configJSON struct {
	Version       int64                            `json:"version"`
	ChainOrder    []string                         `json:"chain_order"`
	TaskMap       map[string]map[string]string     `json:"task_map"`
	VirtualChains map[string][]virtualCandidateDTO `json:"virtual_chains"`
}

type virtualCandidateDTO struct {
	Provider string `json:"provider"`
	Model    string `json:"model"`
}

func (h *llmAdminHandler) handleGet(w http.ResponseWriter, r *http.Request) {
	if !requireAdmin(w, r) {
		return
	}
	cfg, err := h.src.Load(r.Context())
	if err != nil {
		h.log.ErrorContext(r.Context(), "llm.admin.get: load failed", slog.Any("err", err))
		writeLLMErr(w, http.StatusInternalServerError, "load failed")
		return
	}
	if cfg == nil {
		cfg = &llmchain.RuntimeConfig{}
	}
	writeLLMJSON(w, http.StatusOK, toConfigJSON(cfg))
}

func (h *llmAdminHandler) handlePut(w http.ResponseWriter, r *http.Request) {
	if !requireAdmin(w, r) {
		return
	}
	defer func() { _ = r.Body.Close() }()
	var body configJSON
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeLLMErr(w, http.StatusBadRequest, "invalid json: "+err.Error())
		return
	}
	cfg := fromConfigJSON(body)
	if err := h.src.Save(r.Context(), cfg, body.Version); err != nil {
		if strings.Contains(err.Error(), "version conflict") {
			writeLLMErr(w, http.StatusConflict, "version conflict — reload current config and retry")
			return
		}
		h.log.ErrorContext(r.Context(), "llm.admin.put: save failed", slog.Any("err", err))
		writeLLMErr(w, http.StatusInternalServerError, "save failed")
		return
	}
	// Force reload — чтобы новый порядок / task-map / virtual-chains
	// начали действовать на следующий же запрос.
	if h.chain != nil {
		h.chain.RuntimeForceReload(r.Context())
	}
	// Возвращаем свежий config с incremented version'ом.
	fresh, loadErr := h.src.Load(r.Context())
	if loadErr != nil || fresh == nil {
		writeLLMJSON(w, http.StatusOK, map[string]any{"ok": true})
		return
	}
	writeLLMJSON(w, http.StatusOK, toConfigJSON(fresh))
}

// ─── conversions ──────────────────────────────────────────────────────────

func toConfigJSON(cfg *llmchain.RuntimeConfig) configJSON {
	out := configJSON{
		Version:       cfg.Version,
		ChainOrder:    make([]string, 0, len(cfg.ChainOrder)),
		TaskMap:       map[string]map[string]string{},
		VirtualChains: map[string][]virtualCandidateDTO{},
	}
	for _, p := range cfg.ChainOrder {
		out.ChainOrder = append(out.ChainOrder, string(p))
	}
	for task, inner := range cfg.TaskMap {
		byProv := make(map[string]string, len(inner))
		for prov, model := range inner {
			byProv[string(prov)] = model
		}
		out.TaskMap[string(task)] = byProv
	}
	for virt, chain := range cfg.VirtualChains {
		steps := make([]virtualCandidateDTO, 0, len(chain))
		for _, c := range chain {
			steps = append(steps, virtualCandidateDTO{
				Provider: string(c.Provider),
				Model:    c.Model,
			})
		}
		out.VirtualChains[virt] = steps
	}
	return out
}

func fromConfigJSON(in configJSON) *llmchain.RuntimeConfig {
	cfg := &llmchain.RuntimeConfig{
		Version: in.Version,
	}
	for _, p := range in.ChainOrder {
		cfg.ChainOrder = append(cfg.ChainOrder, llmchain.Provider(p))
	}
	if len(in.TaskMap) > 0 {
		cfg.TaskMap = make(llmchain.TaskModelMap, len(in.TaskMap))
		for task, inner := range in.TaskMap {
			byProv := make(map[llmchain.Provider]string, len(inner))
			for prov, model := range inner {
				byProv[llmchain.Provider(prov)] = model
			}
			cfg.TaskMap[llmchain.Task(task)] = byProv
		}
	}
	if len(in.VirtualChains) > 0 {
		cfg.VirtualChains = make(map[string][]llmchain.VirtualCandidate, len(in.VirtualChains))
		for virt, chain := range in.VirtualChains {
			out := make([]llmchain.VirtualCandidate, 0, len(chain))
			for _, step := range chain {
				out = append(out, llmchain.VirtualCandidate{
					Provider: llmchain.Provider(step.Provider),
					Model:    step.Model,
				})
			}
			cfg.VirtualChains[virt] = out
		}
	}
	return cfg
}

// ─── helpers ─────────────────────────────────────────────────────────────

func requireAdmin(w http.ResponseWriter, r *http.Request) bool {
	role, ok := sharedMw.UserRoleFromContext(r.Context())
	if !ok || role != "admin" {
		writeLLMErr(w, http.StatusForbidden, "admin role required")
		return false
	}
	return true
}

func writeLLMJSON(w http.ResponseWriter, status int, v interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeLLMErr(w http.ResponseWriter, status int, msg string) {
	writeLLMJSON(w, status, map[string]any{"error": map[string]string{"message": msg}})
}

// Compile-time: используем errors пакет (на случай добавления cust-error мэппинга).
var _ = errors.Is
var _ = context.Background

// NewLLMChainAdmin — wiring Module для admin-ручек LLM chain'а.
// chain может быть nil (когда ни один провайдер не настроен) → Module
// просто не регистрирует REST-роуты, админка покажет 404 на /llm/config
// (эквивалентно "сервис отключён").
func NewLLMChainAdmin(d Deps, chain *llmchain.Chain) *Module {
	if chain == nil {
		return &Module{}
	}
	src := newLLMConfigSource(d.Pool)
	h := newLLMAdminHandler(src, chain, d.Log)
	return &Module{
		MountREST: func(r chi.Router) {
			h.mount(r)
		},
	}
}
