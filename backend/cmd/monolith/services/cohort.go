// Package services — wiring for the cohort bounded context.
//
// Since Phase 7 the Postgres adapter lives in cohort/infra.Postgres.
// This file carries the chi HTTP handlers + the NotifyCohortBridge.
// The ConnectRPC migration (own proto, native RPC stubs, server.go in
// cohort/ports) is scheduled as Phase 7b.
//
// Endpoints (all under /api/v1):
//
//	GET    /cohort/list                  — public list (auth not required)
//	POST   /cohort                       — create (auth required)
//	GET    /cohort/{slug}                — detail by slug (auth not required)
//	POST   /cohort/{id}/join             — join by id (auth required)
//	POST   /cohort/{id}/leave            — leave by id (auth required)
//	GET    /cohort/{id}/leaderboard      — leaderboard (auth not required)
//
// Anti-fallback: leaderboard returns [] for empty cohorts; never pads with
// platform averages. 404 on unknown slug. nil-logger panics.
package services

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"time"

	cohortApp "druz9/cohort/app"
	cohortDomain "druz9/cohort/domain"
	cohortInfra "druz9/cohort/infra"
	sharedMw "druz9/shared/pkg/middleware"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
)

// NotifyCohortBridge adapts cohort.Repo to notifyApp.CohortMembersLookup —
// notify uses it to fan-out CohortAnnouncementPosted / CohortMemberJoined /
// CohortGraduated events without directly importing cohort/domain.
type NotifyCohortBridge struct {
	Cohorts cohortDomain.Repo
}

// ListMemberIDs returns every member's user_id as a string. Errors flow
// up; notify handler short-circuits on lookup failure rather than failing.
func (b NotifyCohortBridge) ListMemberIDs(ctx context.Context, cohortID string) ([]string, error) {
	cid, err := uuid.Parse(cohortID)
	if err != nil {
		return nil, fmt.Errorf("NotifyCohortBridge.ListMemberIDs: parse: %w", err)
	}
	rows, err := b.Cohorts.ListMembers(ctx, cid)
	if err != nil {
		return nil, fmt.Errorf("NotifyCohortBridge.ListMemberIDs: %w", err)
	}
	out := make([]string, 0, len(rows))
	for _, m := range rows {
		out = append(out, m.UserID.String())
	}
	return out, nil
}

func (b NotifyCohortBridge) GetOwnerID(ctx context.Context, cohortID string) (string, error) {
	cid, err := uuid.Parse(cohortID)
	if err != nil {
		return "", fmt.Errorf("NotifyCohortBridge.GetOwnerID: parse: %w", err)
	}
	c, err := b.Cohorts.Get(ctx, cid)
	if err != nil {
		return "", fmt.Errorf("NotifyCohortBridge.GetOwnerID: %w", err)
	}
	return c.OwnerID.String(), nil
}

func (b NotifyCohortBridge) GetCohortName(ctx context.Context, cohortID string) (string, error) {
	cid, err := uuid.Parse(cohortID)
	if err != nil {
		return "", fmt.Errorf("NotifyCohortBridge.GetCohortName: parse: %w", err)
	}
	c, err := b.Cohorts.Get(ctx, cid)
	if err != nil {
		return "", fmt.Errorf("NotifyCohortBridge.GetCohortName: %w", err)
	}
	return c.Name, nil
}

// NewCohort wires the cohort bounded context. Returns (Module, Repo) —
// the repo is needed by services that bridge into membership lookups
// (cohort_announcement uses it via CohortMembershipBridge; notify via
// NotifyCohortBridge).
func NewCohort(d Deps) (*Module, cohortDomain.Repo) {
	if d.Log == nil {
		panic("services.NewCohort: log is required")
	}
	repo := cohortInfra.NewPostgres(d.Pool)
	create := cohortApp.NewCreateCohort(repo, d.Log)
	create.Bus = d.Bus
	get := cohortApp.NewGetCohort(repo, d.Log)
	list := cohortApp.NewListCohorts(repo, d.Log)
	join := cohortApp.NewJoinCohort(repo, d.Log)
	join.Bus = d.Bus
	leave := cohortApp.NewLeaveCohort(repo, d.Log)
	leaderboard := cohortApp.NewGetLeaderboard(repo, d.Log)
	update := cohortApp.NewUpdateCohort(repo, d.Log)
	disband := cohortApp.NewDisbandCohort(repo, d.Log)
	setRole := cohortApp.NewSetMemberRole(repo, d.Log)
	issueInvite := cohortApp.NewIssueInvite(repo, d.Log)
	joinByToken := cohortApp.NewJoinByToken(repo, d.Log)
	joinByToken.Bus = d.Bus
	graduate := cohortApp.NewGraduateCohort(repo, d.Bus, d.Log)
	streakHM := cohortApp.NewGetStreakHeatmap(repo, d.Log)
	transferOwn := cohortApp.NewTransferOwnership(repo, d.Log)

	h := &cohortHTTP{
		Create:        create,
		Get:           get,
		List:          list,
		Join:          join,
		Leave:         leave,
		Leaderboard:   leaderboard,
		Update:        update,
		Disband:       disband,
		SetMemberRole: setRole,
		IssueInvite:   issueInvite,
		JoinByToken:   joinByToken,
		Graduate:      graduate,
		StreakHeatmap: streakHM,
		Transfer:      transferOwn,
		Repo:          repo,
		Log:           d.Log,
	}

	return &Module{
		RequireConnectAuth: false, // нет Connect surface
		MountREST: func(r chi.Router) {
			// Discovery + detail — public, без auth gate (роутер сам решает).
			r.Get("/cohort/list", h.handleList)
			r.Get("/cohort/{slug}", h.handleGetBySlug)
			r.Get("/cohort/{id}/leaderboard", h.handleLeaderboard)
			r.Get("/cohort/{id}/streak", h.handleStreakHeatmap)

			// Writes — auth required (auth gate в router.go).
			r.Post("/cohort", h.handleCreate)
			r.Post("/cohort/{id}/join", h.handleJoin)
			r.Post("/cohort/{id}/leave", h.handleLeave)
			// M5c — owner-only moderation.
			r.Patch("/cohort/{id}", h.handleUpdate)
			r.Post("/cohort/{id}/disband", h.handleDisband)
			r.Post("/cohort/{id}/members/{userID}/role", h.handleSetMemberRole)
			// Phase-2 invite tokens.
			r.Post("/cohort/{id}/invite", h.handleIssueInvite)
			r.Post("/cohort/join/by-token", h.handleJoinByToken)
			r.Post("/cohort/{id}/graduate", h.handleGraduate)
			r.Post("/cohort/{id}/transfer", h.handleTransferOwnership)
		},
		// Phase 6: og-meta stub at root. Serves a small HTML with
		// og:title / og:description / og:image etc. for link-preview
		// bots (Telegram, Slack, Twitter, Discord, Facebook). Mounted
		// OUTSIDE /api/v1 and bearer — public by design.
		//
		// Deployment wiring: prod nginx/CDN should rewrite
		// /c/{slug} → /og/c/{slug} when request UA matches common
		// bot patterns, and otherwise pass through to the SPA. The
		// same handler also renders an SVG card at /og/c/{slug}.svg
		// for sites that prefer a static image endpoint.
		MountRoot: func(r chi.Router) {
			r.Get("/og/c/{slug}", h.handleOGHTML)
			r.Get("/og/c/{slug}.svg", h.handleOGImage)
		},
	}, repo
}

// ── HTTP handlers ─────────────────────────────────────────────────────────

type cohortHTTP struct {
	Create        *cohortApp.CreateCohort
	Get           *cohortApp.GetCohort
	List          *cohortApp.ListCohorts
	Join          *cohortApp.JoinCohort
	Leave         *cohortApp.LeaveCohort
	Leaderboard   *cohortApp.GetLeaderboard
	Update        *cohortApp.UpdateCohort
	Disband       *cohortApp.DisbandCohort
	SetMemberRole *cohortApp.SetMemberRole
	IssueInvite   *cohortApp.IssueInvite
	JoinByToken   *cohortApp.JoinByToken
	Graduate      *cohortApp.GraduateCohort
	StreakHeatmap *cohortApp.GetStreakHeatmap
	Transfer      *cohortApp.TransferOwnership
	// Repo — direct access to the underlying cohort.Repo for cross-cutting
	// reads (e.g. HasMember in handleList) that don't justify a use case.
	Repo cohortDomain.Repo
	Log  *slog.Logger
}

type cohortDTO struct {
	ID           string `json:"id"`
	Slug         string `json:"slug"`
	Name         string `json:"name"`
	OwnerID      string `json:"owner_id"`
	StartsAt     string `json:"starts_at"`
	EndsAt       string `json:"ends_at"`
	Status       string `json:"status"`
	Visibility   string `json:"visibility"`
	CreatedAt    string `json:"created_at"`
	MembersCount int    `json:"members_count"`
	// IsMember is true when the authenticated caller is in this cohort
	// (any role). Always false for anonymous reads — public catalogue.
	// Populated only by handleList when an auth context is present.
	IsMember bool `json:"is_member"`
	// Capacity — per-row member cap (since Phase 3.3 / migration 00054).
	Capacity int `json:"capacity"`
	// TopMembers — first N joined members for the catalogue avatar
	// strip. Populated only by handleList; nil elsewhere.
	TopMembers []topMemberDTO `json:"top_members,omitempty"`
}

type topMemberDTO struct {
	UserID      string `json:"user_id"`
	Username    string `json:"username,omitempty"`
	DisplayName string `json:"display_name,omitempty"`
	AvatarURL   string `json:"avatar_url,omitempty"`
}

func cohortToDTO(c cohortDomain.Cohort, count int) cohortDTO {
	capacity := c.Capacity
	if capacity <= 0 {
		capacity = cohortDomain.MaxMembersPhase1
	}
	return cohortDTO{
		ID:           c.ID.String(),
		Slug:         c.Slug,
		Name:         c.Name,
		OwnerID:      c.OwnerID.String(),
		StartsAt:     c.StartsAt.UTC().Format(time.RFC3339),
		EndsAt:       c.EndsAt.UTC().Format(time.RFC3339),
		Status:       string(c.Status),
		Visibility:   string(c.Visibility),
		CreatedAt:    c.CreatedAt.UTC().Format(time.RFC3339),
		MembersCount: count,
		Capacity:     capacity,
	}
}

func writeCohortErr(w http.ResponseWriter, status int, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]any{
		"error": map[string]string{"message": msg},
	})
}

// GET /cohort/list?status=&search=&page=&page_size=
func (h *cohortHTTP) handleList(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	page, _ := strconv.Atoi(q.Get("page"))
	pageSize, _ := strconv.Atoi(q.Get("page_size"))
	f := cohortDomain.ListFilter{
		Status:   strings.TrimSpace(q.Get("status")),
		Search:   strings.TrimSpace(q.Get("search")),
		Sort:     strings.TrimSpace(q.Get("sort")),
		Page:     page,
		PageSize: pageSize,
	}
	out, err := h.List.Do(r.Context(), f)
	if err != nil {
		h.Log.ErrorContext(r.Context(), "cohort.List failed", slog.Any("err", err))
		writeCohortErr(w, http.StatusInternalServerError, "list failed")
		return
	}
	// Resolve membership only when the caller is authed — anonymous reads
	// stay cheap (one query per page) and IsMember falls back to false.
	uid, authed := sharedMw.UserIDFromContext(r.Context())
	items := make([]cohortDTO, 0, len(out.Items))
	for _, c := range out.Items {
		dto := cohortToDTO(c.Cohort, c.MembersCount)
		if authed {
			has, err := h.Repo.HasMember(r.Context(), c.Cohort.ID, uid)
			if err == nil {
				dto.IsMember = has
			}
			// On HasMember error we leave IsMember=false rather than failing
			// the listing — the «ТЫ»-chip just doesn't render that row.
		}
		if len(c.TopMembers) > 0 {
			tm := make([]topMemberDTO, 0, len(c.TopMembers))
			for _, m := range c.TopMembers {
				tm = append(tm, topMemberDTO{
					UserID:      m.UserID.String(),
					Username:    m.Username,
					DisplayName: m.DisplayName,
					AvatarURL:   m.AvatarURL,
				})
			}
			dto.TopMembers = tm
		}
		items = append(items, dto)
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{
		"items": items, "total": out.Total, "page": out.Page, "page_size": out.PageSize,
	})
}

type createCohortReq struct {
	Slug       string `json:"slug"`
	Name       string `json:"name"`
	StartsAt   string `json:"starts_at"`
	EndsAt     string `json:"ends_at"`
	Visibility string `json:"visibility"`
	Capacity   int    `json:"capacity"`
}

// POST /cohort
func (h *cohortHTTP) handleCreate(w http.ResponseWriter, r *http.Request) {
	uid, ok := sharedMw.UserIDFromContext(r.Context())
	if !ok {
		writeCohortErr(w, http.StatusUnauthorized, "unauthenticated")
		return
	}
	var req createCohortReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeCohortErr(w, http.StatusBadRequest, fmt.Sprintf("invalid body: %v", err))
		return
	}
	starts, ends := time.Now().UTC(), time.Now().UTC().Add(56*24*time.Hour)
	if req.StartsAt != "" {
		t, err := time.Parse(time.RFC3339, req.StartsAt)
		if err != nil {
			writeCohortErr(w, http.StatusBadRequest, "starts_at must be RFC3339")
			return
		}
		starts = t
	}
	if req.EndsAt != "" {
		t, err := time.Parse(time.RFC3339, req.EndsAt)
		if err != nil {
			writeCohortErr(w, http.StatusBadRequest, "ends_at must be RFC3339")
			return
		}
		ends = t
	}
	vis := cohortDomain.Visibility(req.Visibility)
	if vis == "" {
		vis = cohortDomain.VisibilityPublic
	}
	if vis != cohortDomain.VisibilityInvite && vis != cohortDomain.VisibilityPublic {
		writeCohortErr(w, http.StatusBadRequest, "visibility must be public|invite")
		return
	}
	id, err := h.Create.DoFull(r.Context(), cohortApp.CreateCohortInput{
		OwnerID: uid, Slug: req.Slug, Name: req.Name,
		StartsAt: starts, EndsAt: ends, Visibility: vis,
		Capacity: req.Capacity,
	})
	if err != nil {
		if errors.Is(err, cohortApp.ErrInvalidInput) {
			writeCohortErr(w, http.StatusBadRequest, err.Error())
			return
		}
		if errors.Is(err, cohortDomain.ErrAlreadyMember) {
			writeCohortErr(w, http.StatusConflict, "slug already taken")
			return
		}
		h.Log.ErrorContext(r.Context(), "cohort.Create failed", slog.Any("err", err))
		writeCohortErr(w, http.StatusInternalServerError, "create failed")
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	_ = json.NewEncoder(w).Encode(map[string]any{"id": id.String()})
}

// GET /cohort/{slug}
func (h *cohortHTTP) handleGetBySlug(w http.ResponseWriter, r *http.Request) {
	slug := chi.URLParam(r, "slug")
	view, err := h.Get.Do(r.Context(), slug)
	if err != nil {
		if errors.Is(err, cohortDomain.ErrNotFound) {
			writeCohortErr(w, http.StatusNotFound, "cohort not found")
			return
		}
		h.Log.ErrorContext(r.Context(), "cohort.Get failed", slog.Any("err", err))
		writeCohortErr(w, http.StatusInternalServerError, "get failed")
		return
	}
	type memberDTO struct {
		UserID      string `json:"user_id"`
		Role        string `json:"role"`
		JoinedAt    string `json:"joined_at"`
		Username    string `json:"username,omitempty"`
		DisplayName string `json:"display_name,omitempty"`
		AvatarURL   string `json:"avatar_url,omitempty"`
	}
	members := make([]memberDTO, 0, len(view.Members))
	for _, m := range view.Members {
		members = append(members, memberDTO{
			UserID:      m.UserID.String(),
			Role:        string(m.Role),
			JoinedAt:    m.JoinedAt.UTC().Format(time.RFC3339),
			Username:    m.Username,
			DisplayName: m.DisplayName,
			AvatarURL:   m.AvatarURL,
		})
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{
		"cohort":  cohortToDTO(view.Cohort, len(view.Members)),
		"members": members,
	})
}

// POST /cohort/{id}/join
func (h *cohortHTTP) handleJoin(w http.ResponseWriter, r *http.Request) {
	uid, ok := sharedMw.UserIDFromContext(r.Context())
	if !ok {
		writeCohortErr(w, http.StatusUnauthorized, "unauthenticated")
		return
	}
	cid, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeCohortErr(w, http.StatusBadRequest, "invalid cohort id")
		return
	}
	err = h.Join.DoByID(r.Context(), cid, uid)
	switch {
	case err == nil:
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{"status": "joined", "cohort_id": cid.String()})
	case errors.Is(err, cohortDomain.ErrNotFound):
		writeCohortErr(w, http.StatusNotFound, "cohort not found")
	case errors.Is(err, cohortDomain.ErrAlreadyMember):
		writeCohortErr(w, http.StatusConflict, "already a member")
	case errors.Is(err, cohortDomain.ErrCohortFull):
		writeCohortErr(w, http.StatusConflict, "cohort is full")
	case errors.Is(err, cohortApp.ErrInvalidInput):
		writeCohortErr(w, http.StatusBadRequest, err.Error())
	default:
		h.Log.ErrorContext(r.Context(), "cohort.Join failed", slog.Any("err", err))
		writeCohortErr(w, http.StatusInternalServerError, "join failed")
	}
}

// POST /cohort/{id}/leave
func (h *cohortHTTP) handleLeave(w http.ResponseWriter, r *http.Request) {
	uid, ok := sharedMw.UserIDFromContext(r.Context())
	if !ok {
		writeCohortErr(w, http.StatusUnauthorized, "unauthenticated")
		return
	}
	cid, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeCohortErr(w, http.StatusBadRequest, "invalid cohort id")
		return
	}
	res, err := h.Leave.Do(r.Context(), cid, uid)
	switch {
	case err == nil:
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"status": res.Status, "cohort_id": cid.String(),
		})
	case errors.Is(err, cohortDomain.ErrNotFound):
		writeCohortErr(w, http.StatusNotFound, "not a member")
	default:
		h.Log.ErrorContext(r.Context(), "cohort.Leave failed", slog.Any("err", err))
		writeCohortErr(w, http.StatusInternalServerError, "leave failed")
	}
}

// GET /cohort/{id}/leaderboard
func (h *cohortHTTP) handleLeaderboard(w http.ResponseWriter, r *http.Request) {
	cid, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeCohortErr(w, http.StatusBadRequest, "invalid cohort id")
		return
	}
	rows, err := h.Leaderboard.Do(r.Context(), cid, "")
	if err != nil {
		h.Log.ErrorContext(r.Context(), "cohort.Leaderboard failed", slog.Any("err", err))
		writeCohortErr(w, http.StatusInternalServerError, "leaderboard failed")
		return
	}
	type rowDTO struct {
		UserID      string `json:"user_id"`
		DisplayName string `json:"display_name"`
		OverallElo  int    `json:"overall_elo"`
		WeeklyXP    int64  `json:"weekly_xp"`
	}
	out := make([]rowDTO, 0, len(rows))
	for _, r := range rows {
		out = append(out, rowDTO{
			UserID: r.UserID.String(), DisplayName: r.DisplayName,
			OverallElo: r.OverallElo, WeeklyXP: r.WeeklyXP,
		})
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{"items": out})
}

// ── M5c handlers ──────────────────────────────────────────────────────────

type updateCohortReq struct {
	Name       *string `json:"name,omitempty"`
	EndsAt     *string `json:"ends_at,omitempty"`
	Visibility *string `json:"visibility,omitempty"`
	Capacity   *int    `json:"capacity,omitempty"`
}

// PATCH /cohort/{id}
func (h *cohortHTTP) handleUpdate(w http.ResponseWriter, r *http.Request) {
	uid, ok := sharedMw.UserIDFromContext(r.Context())
	if !ok {
		writeCohortErr(w, http.StatusUnauthorized, "unauthenticated")
		return
	}
	cohortID, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeCohortErr(w, http.StatusBadRequest, "invalid cohort id")
		return
	}
	var req updateCohortReq
	if decErr := json.NewDecoder(r.Body).Decode(&req); decErr != nil {
		writeCohortErr(w, http.StatusBadRequest, "invalid body")
		return
	}
	in := cohortApp.UpdateCohortInput{CohortID: cohortID, ActorID: uid, Name: req.Name}
	if req.EndsAt != nil && *req.EndsAt != "" {
		t, perr := time.Parse(time.RFC3339, *req.EndsAt)
		if perr != nil {
			writeCohortErr(w, http.StatusBadRequest, "invalid ends_at")
			return
		}
		in.EndsAt = &t
	}
	if req.Visibility != nil && *req.Visibility != "" {
		v := cohortDomain.Visibility(*req.Visibility)
		in.Visibility = &v
	}
	if req.Capacity != nil {
		in.Capacity = req.Capacity
	}
	out, err := h.Update.Do(r.Context(), in)
	if err != nil {
		switch {
		case errors.Is(err, cohortApp.ErrForbidden):
			writeCohortErr(w, http.StatusForbidden, "owner-only")
		case errors.Is(err, cohortApp.ErrInvalidName),
			errors.Is(err, cohortApp.ErrInvalidEnd),
			errors.Is(err, cohortApp.ErrInvalidVisibility),
			errors.Is(err, cohortApp.ErrInvalidCapacity):
			writeCohortErr(w, http.StatusBadRequest, err.Error())
		case errors.Is(err, cohortDomain.ErrNotFound):
			writeCohortErr(w, http.StatusNotFound, "cohort not found")
		default:
			h.Log.ErrorContext(r.Context(), "cohort.Update", slog.Any("err", err))
			writeCohortErr(w, http.StatusInternalServerError, "update failed")
		}
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(cohortToDTO(out, 0))
}

// POST /cohort/{id}/disband
func (h *cohortHTTP) handleDisband(w http.ResponseWriter, r *http.Request) {
	uid, ok := sharedMw.UserIDFromContext(r.Context())
	if !ok {
		writeCohortErr(w, http.StatusUnauthorized, "unauthenticated")
		return
	}
	cohortID, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeCohortErr(w, http.StatusBadRequest, "invalid cohort id")
		return
	}
	if err := h.Disband.Do(r.Context(), cohortID, uid); err != nil {
		switch {
		case errors.Is(err, cohortApp.ErrForbidden):
			writeCohortErr(w, http.StatusForbidden, "owner-only")
		case errors.Is(err, cohortDomain.ErrNotFound):
			writeCohortErr(w, http.StatusNotFound, "cohort not found")
		default:
			h.Log.ErrorContext(r.Context(), "cohort.Disband", slog.Any("err", err))
			writeCohortErr(w, http.StatusInternalServerError, "disband failed")
		}
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{"status": "disbanded", "cohort_id": cohortID.String()})
}

type setRoleReq struct {
	Role string `json:"role"`
}

// POST /cohort/{id}/members/{userID}/role
func (h *cohortHTTP) handleSetMemberRole(w http.ResponseWriter, r *http.Request) {
	actorID, ok := sharedMw.UserIDFromContext(r.Context())
	if !ok {
		writeCohortErr(w, http.StatusUnauthorized, "unauthenticated")
		return
	}
	cohortID, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeCohortErr(w, http.StatusBadRequest, "invalid cohort id")
		return
	}
	targetID, err := uuid.Parse(chi.URLParam(r, "userID"))
	if err != nil {
		writeCohortErr(w, http.StatusBadRequest, "invalid user id")
		return
	}
	var body setRoleReq
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeCohortErr(w, http.StatusBadRequest, "invalid body")
		return
	}
	if err := h.SetMemberRole.Do(r.Context(), cohortID, actorID, targetID, cohortDomain.Role(body.Role)); err != nil {
		switch {
		case errors.Is(err, cohortApp.ErrForbidden):
			writeCohortErr(w, http.StatusForbidden, "owner-only")
		case errors.Is(err, cohortApp.ErrInvalidRole):
			writeCohortErr(w, http.StatusBadRequest, "invalid role")
		case errors.Is(err, cohortDomain.ErrNotFound):
			writeCohortErr(w, http.StatusNotFound, "membership not found")
		default:
			h.Log.ErrorContext(r.Context(), "cohort.SetMemberRole", slog.Any("err", err))
			writeCohortErr(w, http.StatusInternalServerError, "role update failed")
		}
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{"status": "ok"})
}

// ── Phase-2 invite-token handlers (Task B) ────────────────────────────────

type issueInviteReq struct {
	MaxUses    int `json:"max_uses"`    // 0 = unlimited
	TTLSeconds int `json:"ttl_seconds"` // 0 = never expires
}

type issueInviteResp struct {
	Token     string `json:"token"`
	URL       string `json:"url"`
	ExpiresAt string `json:"expires_at,omitempty"`
}

// POST /cohort/{id}/invite
func (h *cohortHTTP) handleIssueInvite(w http.ResponseWriter, r *http.Request) {
	uid, ok := sharedMw.UserIDFromContext(r.Context())
	if !ok {
		writeCohortErr(w, http.StatusUnauthorized, "unauthenticated")
		return
	}
	cohortID, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeCohortErr(w, http.StatusBadRequest, "invalid cohort id")
		return
	}
	var req issueInviteReq
	if decErr := json.NewDecoder(r.Body).Decode(&req); decErr != nil {
		writeCohortErr(w, http.StatusBadRequest, "invalid body")
		return
	}
	ttl := time.Duration(req.TTLSeconds) * time.Second
	token, err := h.IssueInvite.Do(r.Context(), cohortID, uid, req.MaxUses, ttl)
	if err != nil {
		switch {
		case errors.Is(err, cohortApp.ErrForbidden):
			writeCohortErr(w, http.StatusForbidden, "must be coach or owner")
		case errors.Is(err, cohortApp.ErrInvalidMaxUses):
			writeCohortErr(w, http.StatusBadRequest, err.Error())
		default:
			h.Log.ErrorContext(r.Context(), "cohort.IssueInvite", slog.Any("err", err))
			writeCohortErr(w, http.StatusInternalServerError, "issue failed")
		}
		return
	}
	out := issueInviteResp{Token: token, URL: "/c/join/" + token}
	if ttl > 0 {
		out.ExpiresAt = time.Now().Add(ttl).UTC().Format(time.RFC3339)
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(out)
}

type joinByTokenReq struct {
	Token string `json:"token"`
}

// POST /cohort/join/by-token
func (h *cohortHTTP) handleJoinByToken(w http.ResponseWriter, r *http.Request) {
	uid, ok := sharedMw.UserIDFromContext(r.Context())
	if !ok {
		writeCohortErr(w, http.StatusUnauthorized, "unauthenticated")
		return
	}
	var req joinByTokenReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeCohortErr(w, http.StatusBadRequest, "invalid body")
		return
	}
	cohortID, err := h.JoinByToken.Do(r.Context(), req.Token, uid)
	if err != nil {
		switch {
		case errors.Is(err, cohortApp.ErrInvalidToken):
			writeCohortErr(w, http.StatusGone, "invite expired or invalid")
		default:
			h.Log.ErrorContext(r.Context(), "cohort.JoinByToken", slog.Any("err", err))
			writeCohortErr(w, http.StatusInternalServerError, "join failed")
		}
		return
	}
	// Look up the cohort slug so the frontend can navigate without
	// asking for /cohort/{id} → /cohort/{slug} mapping.
	c, err := h.Repo.Get(r.Context(), cohortID)
	if err != nil {
		h.Log.ErrorContext(r.Context(), "cohort.JoinByToken: load slug", slog.Any("err", err))
		// Degrade — still return cohort_id; the page can fall back to /cohorts.
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{"status": "joined", "cohort_id": cohortID.String()})
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{
		"status":    "joined",
		"cohort_id": cohortID.String(),
		"slug":      c.Slug,
	})
}

// POST /cohort/{id}/graduate
func (h *cohortHTTP) handleGraduate(w http.ResponseWriter, r *http.Request) {
	uid, ok := sharedMw.UserIDFromContext(r.Context())
	if !ok {
		writeCohortErr(w, http.StatusUnauthorized, "unauthenticated")
		return
	}
	cohortID, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeCohortErr(w, http.StatusBadRequest, "invalid cohort id")
		return
	}
	out, err := h.Graduate.Do(r.Context(), cohortID, uid)
	if err != nil {
		switch {
		case errors.Is(err, cohortApp.ErrForbidden):
			writeCohortErr(w, http.StatusForbidden, "owner-only")
		case errors.Is(err, cohortDomain.ErrNotFound):
			writeCohortErr(w, http.StatusNotFound, "cohort not found")
		default:
			h.Log.ErrorContext(r.Context(), "cohort.Graduate", slog.Any("err", err))
			writeCohortErr(w, http.StatusInternalServerError, "graduate failed")
		}
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(cohortToDTO(out, 0))
}

// handleOGHTML serves a small HTML document with og:meta tags for
// link-preview bots. Path: GET /og/c/{slug}. Falls through to 404 when
// the slug is unknown — bots get a clear negative signal rather than an
// empty preview.
func (h *cohortHTTP) handleOGHTML(w http.ResponseWriter, r *http.Request) {
	slug := chi.URLParam(r, "slug")
	view, err := h.Get.Do(r.Context(), slug)
	if err != nil {
		writeCohortErr(w, http.StatusNotFound, "cohort not found")
		return
	}
	days := int(time.Until(view.Cohort.EndsAt).Hours() / 24)
	if days < 0 {
		days = 0
	}
	cap := view.Cohort.Capacity
	if cap <= 0 {
		cap = cohortDomain.MaxMembersPhase1
	}
	statusLine := "закрыта"
	switch view.Cohort.Status {
	case cohortDomain.StatusActive:
		if days > 0 {
			statusLine = fmt.Sprintf("до конца %d дн.", days)
		} else {
			statusLine = "последний день"
		}
	case cohortDomain.StatusGraduated:
		statusLine = "выпущена"
	case cohortDomain.StatusCancelled:
		statusLine = "расформирована"
	}
	title := fmt.Sprintf("%s · druz9 cohort", view.Cohort.Name)
	description := fmt.Sprintf("%d/%d участников · %s", len(view.Members), cap, statusLine)
	imageURL := fmt.Sprintf("/og/c/%s.svg", slug)
	canonical := fmt.Sprintf("/c/%s", slug)

	// Keep the body tiny — bots usually stop reading after <head>. We
	// include a <meta refresh> so humans who paste this URL into a
	// browser still land on the SPA.
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "public, max-age=120")
	_, _ = fmt.Fprintf(w, `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<title>%s</title>
<meta name="description" content="%s">
<meta property="og:type" content="website">
<meta property="og:title" content="%s">
<meta property="og:description" content="%s">
<meta property="og:image" content="%s">
<meta property="og:url" content="%s">
<meta name="twitter:card" content="summary_large_image">
<link rel="canonical" href="%s">
<meta http-equiv="refresh" content="0; url=%s">
</head>
<body>
<p>Redirecting to <a href="%s">%s</a>…</p>
</body>
</html>`,
		htmlEscape(title), htmlEscape(description),
		htmlEscape(title), htmlEscape(description),
		htmlEscape(imageURL), htmlEscape(canonical),
		htmlEscape(canonical),
		htmlEscape(canonical),
		htmlEscape(canonical), htmlEscape(view.Cohort.Name),
	)
}

// handleOGImage renders a brand-coloured SVG card with the cohort name
// + members/capacity — used as og:image by handleOGHTML. Plain SVG
// keeps us off the image-library treadmill; social scrapers accept it.
func (h *cohortHTTP) handleOGImage(w http.ResponseWriter, r *http.Request) {
	slug := chi.URLParam(r, "slug")
	// strip the .svg suffix chi keeps on the param
	slug = strings.TrimSuffix(slug, ".svg")
	view, err := h.Get.Do(r.Context(), slug)
	if err != nil {
		writeCohortErr(w, http.StatusNotFound, "cohort not found")
		return
	}
	cap := view.Cohort.Capacity
	if cap <= 0 {
		cap = cohortDomain.MaxMembersPhase1
	}
	status := "active"
	if view.Cohort.Status == cohortDomain.StatusGraduated {
		status = "graduated"
	} else if view.Cohort.Status == cohortDomain.StatusCancelled {
		status = "cancelled"
	}
	w.Header().Set("Content-Type", "image/svg+xml")
	w.Header().Set("Cache-Control", "public, max-age=300")
	_, _ = fmt.Fprintf(w, `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#0B0B0F"/>
      <stop offset="1" stop-color="#1A1030"/>
    </linearGradient>
    <linearGradient id="accent" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#582CFF"/>
      <stop offset="1" stop-color="#22D3EE"/>
    </linearGradient>
  </defs>
  <rect width="1200" height="630" fill="url(#bg)"/>
  <text x="80" y="140" font-family="system-ui,sans-serif" font-size="28" fill="#6B6B7A" font-weight="600">DRUZ9 · COHORT</text>
  <text x="80" y="280" font-family="system-ui,sans-serif" font-size="88" fill="#F5F5F7" font-weight="800">%s</text>
  <text x="80" y="380" font-family="system-ui,sans-serif" font-size="44" fill="url(#accent)" font-weight="700">%d / %d участников · %s</text>
  <text x="80" y="540" font-family="system-ui,sans-serif" font-size="24" fill="#8A8A9B">druz9.online/c/%s</text>
</svg>`,
		xmlEscape(view.Cohort.Name), len(view.Members), cap, status, xmlEscape(slug),
	)
}

// htmlEscape — tiny helper; we avoid pulling html/template just to
// emit five attributes.
func htmlEscape(s string) string {
	s = strings.ReplaceAll(s, "&", "&amp;")
	s = strings.ReplaceAll(s, "<", "&lt;")
	s = strings.ReplaceAll(s, ">", "&gt;")
	s = strings.ReplaceAll(s, `"`, "&quot;")
	s = strings.ReplaceAll(s, "'", "&#39;")
	return s
}

// xmlEscape — SVG needs stricter escaping than HTML attributes.
func xmlEscape(s string) string {
	s = strings.ReplaceAll(s, "&", "&amp;")
	s = strings.ReplaceAll(s, "<", "&lt;")
	s = strings.ReplaceAll(s, ">", "&gt;")
	return s
}

// POST /cohort/{id}/transfer { "new_owner_id": "uuid" }
type transferOwnershipReq struct {
	NewOwnerID string `json:"new_owner_id"`
}

func (h *cohortHTTP) handleTransferOwnership(w http.ResponseWriter, r *http.Request) {
	uid, ok := sharedMw.UserIDFromContext(r.Context())
	if !ok {
		writeCohortErr(w, http.StatusUnauthorized, "unauthenticated")
		return
	}
	cohortID, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeCohortErr(w, http.StatusBadRequest, "invalid cohort id")
		return
	}
	var req transferOwnershipReq
	if decErr := json.NewDecoder(r.Body).Decode(&req); decErr != nil {
		writeCohortErr(w, http.StatusBadRequest, "invalid body")
		return
	}
	newOwner, err := uuid.Parse(strings.TrimSpace(req.NewOwnerID))
	if err != nil {
		writeCohortErr(w, http.StatusBadRequest, "invalid new_owner_id")
		return
	}
	out, err := h.Transfer.Do(r.Context(), cohortID, uid, newOwner)
	if err != nil {
		switch {
		case errors.Is(err, cohortApp.ErrForbidden):
			writeCohortErr(w, http.StatusForbidden, "owner-only")
		case errors.Is(err, cohortApp.ErrInvalidTarget):
			writeCohortErr(w, http.StatusBadRequest, "new owner must be a cohort member")
		case errors.Is(err, cohortDomain.ErrNotFound):
			writeCohortErr(w, http.StatusNotFound, "cohort not found")
		default:
			h.Log.ErrorContext(r.Context(), "cohort.Transfer", slog.Any("err", err))
			writeCohortErr(w, http.StatusInternalServerError, "transfer failed")
		}
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(cohortToDTO(out, 0))
}

// GET /cohort/{id}/streak?days=14
type streakHeatmapDayDTO struct {
	Date   string `json:"date"`
	Solved bool   `json:"solved"`
}

type streakHeatmapRowDTO struct {
	UserID      string                `json:"user_id"`
	Username    string                `json:"username,omitempty"`
	DisplayName string                `json:"display_name,omitempty"`
	Days        []streakHeatmapDayDTO `json:"days"`
}

func (h *cohortHTTP) handleStreakHeatmap(w http.ResponseWriter, r *http.Request) {
	cohortID, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeCohortErr(w, http.StatusBadRequest, "invalid cohort id")
		return
	}
	days, _ := strconv.Atoi(r.URL.Query().Get("days"))
	if days <= 0 {
		days = 14
	}
	rows, err := h.StreakHeatmap.Do(r.Context(), cohortID, days)
	if err != nil {
		h.Log.ErrorContext(r.Context(), "cohort.StreakHeatmap", slog.Any("err", err))
		writeCohortErr(w, http.StatusInternalServerError, "streak failed")
		return
	}
	// Stamp dates on every cell so the frontend can render labels without
	// reconstructing the calendar arithmetic. Days are UTC.
	startDate := time.Now().UTC().AddDate(0, 0, -(days - 1))
	out := make([]streakHeatmapRowDTO, 0, len(rows))
	for _, row := range rows {
		dayDTOs := make([]streakHeatmapDayDTO, 0, len(row.Days))
		for i, solved := range row.Days {
			d := startDate.AddDate(0, 0, i)
			dayDTOs = append(dayDTOs, streakHeatmapDayDTO{
				Date:   d.Format("2006-01-02"),
				Solved: solved,
			})
		}
		out = append(out, streakHeatmapRowDTO{
			UserID:      row.UserID.String(),
			Username:    row.Username,
			DisplayName: row.DisplayName,
			Days:        dayDTOs,
		})
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{"items": out, "days": days})
}
