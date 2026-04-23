// atlas_admin_handler.go — chi-direct admin CMS for the Atlas catalogue.
//
// Modeled on backend/services/podcast/ports/cms_handler.go: bearer auth
// is enforced at the router gate; admin role is enforced per-handler via
// `requireAdmin`. We deliberately bypass the proto/Connect transcoder —
// adding new RPCs would force a regen across every service binary for a
// purely operational surface.
//
// Endpoints (all under /api/v1/admin/atlas):
//
//	GET    /nodes               — list every node (incl. inactive)
//	POST   /nodes               — create new node
//	PUT    /nodes/{id}          — full update
//	PATCH  /nodes/{id}/position — only pos_x / pos_y
//	DELETE /nodes/{id}          — hard delete (CASCADE removes edges)
//	GET    /edges               — list edges
//	POST   /edges               — create edge {from, to}
//	DELETE /edges/{id}          — remove edge
package ports

import (
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"strconv"
	"strings"

	"druz9/profile/domain"
	"druz9/shared/enums"
	sharedMw "druz9/shared/pkg/middleware"

	"github.com/go-chi/chi/v5"
)

// AtlasAdminHandler exposes admin CRUD over the atlas catalogue.
type AtlasAdminHandler struct {
	Repo domain.AtlasCatalogueRepo
	Log  *slog.Logger
}

// NewAtlasAdminHandler validates dependencies and returns the handler.
// Anti-fallback: nil repo / nil logger panic at wiring time.
func NewAtlasAdminHandler(repo domain.AtlasCatalogueRepo, log *slog.Logger) *AtlasAdminHandler {
	if repo == nil {
		panic("profile.NewAtlasAdminHandler: repo is required")
	}
	if log == nil {
		panic("profile.NewAtlasAdminHandler: logger is required (anti-fallback policy: no silent noop loggers)")
	}
	return &AtlasAdminHandler{Repo: repo, Log: log}
}

// ── DTOs ──────────────────────────────────────────────────────────────────

type atlasNodeDTO struct {
	ID          string `json:"id"`
	Title       string `json:"title"`
	Section     string `json:"section"`
	Kind        string `json:"kind"`
	Description string `json:"description"`
	TotalCount  int    `json:"total_count"`
	PosX        *int   `json:"pos_x,omitempty"`
	PosY        *int   `json:"pos_y,omitempty"`
	SortOrder   int    `json:"sort_order"`
	IsActive    bool   `json:"is_active"`
	EdgesCount  int    `json:"edges_count,omitempty"`
}

type atlasEdgeDTO struct {
	ID   int64  `json:"id"`
	From string `json:"from"`
	To   string `json:"to"`
}

func toNodeDTO(n domain.AtlasCatalogueNode) atlasNodeDTO {
	return atlasNodeDTO{
		ID:          n.ID,
		Title:       n.Title,
		Section:     n.Section,
		Kind:        n.Kind,
		Description: n.Description,
		TotalCount:  n.TotalCount,
		PosX:        n.PosX,
		PosY:        n.PosY,
		SortOrder:   n.SortOrder,
		IsActive:    n.IsActive,
	}
}

// ── routes ────────────────────────────────────────────────────────────────

// HandleListNodes — GET /admin/atlas/nodes
func (h *AtlasAdminHandler) HandleListNodes(w http.ResponseWriter, r *http.Request) {
	if !h.requireAdmin(w, r) {
		return
	}
	nodes, err := h.Repo.ListAllNodes(r.Context())
	if err != nil {
		h.respondErr(w, fmt.Errorf("atlas-admin: list nodes: %w", err))
		return
	}
	out := struct {
		Items []atlasNodeDTO `json:"items"`
	}{Items: make([]atlasNodeDTO, 0, len(nodes))}
	for _, n := range nodes {
		out.Items = append(out.Items, toNodeDTO(n))
	}
	writeJSONOK(w, out)
}

type upsertNodeBody struct {
	ID          string `json:"id"`
	Title       string `json:"title"`
	Section     string `json:"section"`
	Kind        string `json:"kind"`
	Description string `json:"description"`
	TotalCount  int    `json:"total_count"`
	PosX        *int   `json:"pos_x"`
	PosY        *int   `json:"pos_y"`
	SortOrder   int    `json:"sort_order"`
	IsActive    *bool  `json:"is_active"` // optional → defaults to true on create
}

func (b upsertNodeBody) validate() error {
	if strings.TrimSpace(b.ID) == "" {
		return errors.New("id is required")
	}
	if strings.TrimSpace(b.Title) == "" {
		return errors.New("title is required")
	}
	if strings.TrimSpace(b.Section) == "" {
		return errors.New("section is required")
	}
	switch b.Kind {
	case "normal", "keystone", "ascendant", "center":
	default:
		return fmt.Errorf("invalid kind %q (allowed: normal/keystone/ascendant/center)", b.Kind)
	}
	if b.TotalCount < 0 {
		return errors.New("total_count must be >= 0")
	}
	return nil
}

// HandleCreateNode — POST /admin/atlas/nodes
func (h *AtlasAdminHandler) HandleCreateNode(w http.ResponseWriter, r *http.Request) {
	if !h.requireAdmin(w, r) {
		return
	}
	var body upsertNodeBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSONErrAtlas(w, http.StatusBadRequest, fmt.Sprintf("invalid body: %v", err))
		return
	}
	if err := body.validate(); err != nil {
		writeJSONErrAtlas(w, http.StatusBadRequest, err.Error())
		return
	}
	active := true
	if body.IsActive != nil {
		active = *body.IsActive
	}
	n := domain.AtlasCatalogueNode{
		ID:          body.ID,
		Title:       body.Title,
		Section:     body.Section,
		Kind:        body.Kind,
		Description: body.Description,
		TotalCount:  body.TotalCount,
		PosX:        body.PosX,
		PosY:        body.PosY,
		SortOrder:   body.SortOrder,
		IsActive:    active,
	}
	if err := h.Repo.UpsertNode(r.Context(), n); err != nil {
		h.respondErr(w, fmt.Errorf("atlas-admin: upsert node: %w", err))
		return
	}
	writeJSON(w, http.StatusCreated, toNodeDTO(n))
}

// HandleUpdateNode — PUT /admin/atlas/nodes/{id}
func (h *AtlasAdminHandler) HandleUpdateNode(w http.ResponseWriter, r *http.Request) {
	if !h.requireAdmin(w, r) {
		return
	}
	id := chi.URLParam(r, "id")
	if id == "" {
		writeJSONErrAtlas(w, http.StatusBadRequest, "id required")
		return
	}
	var body upsertNodeBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSONErrAtlas(w, http.StatusBadRequest, fmt.Sprintf("invalid body: %v", err))
		return
	}
	body.ID = id // path param wins to avoid mismatch
	if err := body.validate(); err != nil {
		writeJSONErrAtlas(w, http.StatusBadRequest, err.Error())
		return
	}
	active := true
	if body.IsActive != nil {
		active = *body.IsActive
	}
	n := domain.AtlasCatalogueNode{
		ID:          body.ID,
		Title:       body.Title,
		Section:     body.Section,
		Kind:        body.Kind,
		Description: body.Description,
		TotalCount:  body.TotalCount,
		PosX:        body.PosX,
		PosY:        body.PosY,
		SortOrder:   body.SortOrder,
		IsActive:    active,
	}
	if err := h.Repo.UpsertNode(r.Context(), n); err != nil {
		h.respondErr(w, fmt.Errorf("atlas-admin: upsert node: %w", err))
		return
	}
	writeJSONOK(w, toNodeDTO(n))
}

type positionBody struct {
	PosX *int `json:"pos_x"`
	PosY *int `json:"pos_y"`
}

// HandleUpdatePosition — PATCH /admin/atlas/nodes/{id}/position
func (h *AtlasAdminHandler) HandleUpdatePosition(w http.ResponseWriter, r *http.Request) {
	if !h.requireAdmin(w, r) {
		return
	}
	id := chi.URLParam(r, "id")
	if id == "" {
		writeJSONErrAtlas(w, http.StatusBadRequest, "id required")
		return
	}
	var body positionBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSONErrAtlas(w, http.StatusBadRequest, fmt.Sprintf("invalid body: %v", err))
		return
	}
	if err := h.Repo.UpdateNodePosition(r.Context(), id, body.PosX, body.PosY); err != nil {
		h.respondErr(w, fmt.Errorf("atlas-admin: update position: %w", err))
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// HandleDeleteNode — DELETE /admin/atlas/nodes/{id}
func (h *AtlasAdminHandler) HandleDeleteNode(w http.ResponseWriter, r *http.Request) {
	if !h.requireAdmin(w, r) {
		return
	}
	id := chi.URLParam(r, "id")
	if id == "" {
		writeJSONErrAtlas(w, http.StatusBadRequest, "id required")
		return
	}
	if err := h.Repo.DeleteNode(r.Context(), id); err != nil {
		h.respondErr(w, fmt.Errorf("atlas-admin: delete node: %w", err))
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// HandleListEdges — GET /admin/atlas/edges
func (h *AtlasAdminHandler) HandleListEdges(w http.ResponseWriter, r *http.Request) {
	if !h.requireAdmin(w, r) {
		return
	}
	edges, err := h.Repo.ListEdges(r.Context())
	if err != nil {
		h.respondErr(w, fmt.Errorf("atlas-admin: list edges: %w", err))
		return
	}
	out := struct {
		Items []atlasEdgeDTO `json:"items"`
	}{Items: make([]atlasEdgeDTO, 0, len(edges))}
	for _, e := range edges {
		out.Items = append(out.Items, atlasEdgeDTO{ID: e.ID, From: e.From, To: e.To})
	}
	writeJSONOK(w, out)
}

type createEdgeBody struct {
	From string `json:"from"`
	To   string `json:"to"`
}

// HandleCreateEdge — POST /admin/atlas/edges
func (h *AtlasAdminHandler) HandleCreateEdge(w http.ResponseWriter, r *http.Request) {
	if !h.requireAdmin(w, r) {
		return
	}
	var body createEdgeBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSONErrAtlas(w, http.StatusBadRequest, fmt.Sprintf("invalid body: %v", err))
		return
	}
	body.From = strings.TrimSpace(body.From)
	body.To = strings.TrimSpace(body.To)
	if body.From == "" || body.To == "" {
		writeJSONErrAtlas(w, http.StatusBadRequest, "from and to are required")
		return
	}
	if body.From == body.To {
		writeJSONErrAtlas(w, http.StatusBadRequest, "self-edge not allowed")
		return
	}
	id, err := h.Repo.CreateEdge(r.Context(), body.From, body.To)
	if err != nil {
		// Map duplicate-key violations to 409 — the operator probably tried
		// to add an edge that already exists.
		if isUniqueViolation(err) {
			writeJSONErrAtlas(w, http.StatusConflict, "edge already exists")
			return
		}
		h.respondErr(w, fmt.Errorf("atlas-admin: create edge: %w", err))
		return
	}
	writeJSON(w, http.StatusCreated, atlasEdgeDTO{ID: id, From: body.From, To: body.To})
}

// HandleDeleteEdge — DELETE /admin/atlas/edges/{id}
func (h *AtlasAdminHandler) HandleDeleteEdge(w http.ResponseWriter, r *http.Request) {
	if !h.requireAdmin(w, r) {
		return
	}
	raw := chi.URLParam(r, "id")
	id, err := strconv.ParseInt(raw, 10, 64)
	if err != nil {
		writeJSONErrAtlas(w, http.StatusBadRequest, "invalid id")
		return
	}
	if err := h.Repo.DeleteEdge(r.Context(), id); err != nil {
		h.respondErr(w, fmt.Errorf("atlas-admin: delete edge: %w", err))
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// ── helpers ───────────────────────────────────────────────────────────────

func (h *AtlasAdminHandler) requireAdmin(w http.ResponseWriter, r *http.Request) bool {
	if _, ok := sharedMw.UserIDFromContext(r.Context()); !ok {
		writeJSONErrAtlas(w, http.StatusUnauthorized, "unauthenticated")
		return false
	}
	role, ok := sharedMw.UserRoleFromContext(r.Context())
	if !ok || role != string(enums.UserRoleAdmin) {
		writeJSONErrAtlas(w, http.StatusForbidden, "admin role required")
		return false
	}
	return true
}

func (h *AtlasAdminHandler) respondErr(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, domain.ErrNotFound):
		writeJSONErrAtlas(w, http.StatusNotFound, err.Error())
	case errors.Is(err, domain.ErrConflict):
		writeJSONErrAtlas(w, http.StatusConflict, err.Error())
	default:
		h.Log.Error("atlas-admin: unexpected error", slog.Any("err", err))
		writeJSONErrAtlas(w, http.StatusInternalServerError, "atlas admin failure")
	}
}

func writeJSONOK(w http.ResponseWriter, body any) { writeJSON(w, http.StatusOK, body) }

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}

func writeJSONErrAtlas(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}

// isUniqueViolation matches PostgreSQL SQLSTATE 23505 without importing
// pgx into the ports layer — we just check the wrapped error text.
func isUniqueViolation(err error) bool {
	if err == nil {
		return false
	}
	s := err.Error()
	return strings.Contains(s, "23505") || strings.Contains(s, "duplicate key")
}
