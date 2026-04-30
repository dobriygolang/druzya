// Package clubs wires the Clubs bounded context (Phase 3 final).
//
// REST surface (chi-direct, не proto — read-mostly + curator writes):
//
//	GET  /api/v1/clubs                              — public catalogue
//	GET  /api/v1/clubs/{slug}                       — club detail (sessions split)
//	GET  /api/v1/clubs/sessions/{id}                — session detail (materials)
//	POST /api/v1/clubs/sessions/{id}/rsvp           — set RSVP status (auth)
//	GET  /api/v1/clubs/upcoming-for-me              — Hone Today chip (auth)
//	POST /api/v1/admin/clubs                        — create club (admin)
//	POST /api/v1/admin/clubs/{slug}/sessions        — create session (admin)
//
// Auth: catalogue + GET endpoints — public (anonymous OK). RSVP +
// upcoming-for-me — Bearer. Admin endpoints — Bearer + role=admin.
package clubs

import (
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"strconv"
	"time"

	clubsApp "druz9/clubs/app"
	clubsDomain "druz9/clubs/domain"
	clubsInfra "druz9/clubs/infra"
	monolithServices "druz9/cmd/monolith/services"
	"druz9/shared/enums"
	sharedMw "druz9/shared/pkg/middleware"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
)

// NewClubs wires the Clubs bounded context.
func NewClubs(d monolithServices.Deps) *monolithServices.Module {
	if d.Pool == nil {
		panic("services.NewClubs: pool is required")
	}
	if d.Log == nil {
		panic("services.NewClubs: log is required")
	}
	repo := clubsInfra.NewPostgres(d.Pool)
	listUC := &clubsApp.ListPublicClubs{Repo: repo}
	getUC := &clubsApp.GetClub{Repo: repo}
	getSessionUC := &clubsApp.GetSession{Repo: repo}
	rsvpUC := &clubsApp.RSVP{Repo: repo}
	createClubUC := &clubsApp.CreateClub{Repo: repo}
	createSessionUC := &clubsApp.CreateSession{Repo: repo, Now: d.Now}
	upcomingUC := &clubsApp.NextUpcomingForUser{Repo: repo}

	listHandler := newListHandler(listUC, d.Log)
	getHandler := newGetClubHandler(getUC, d.Log)
	getSessionHandler := newGetSessionHandler(getSessionUC, d.Log)
	rsvpHandler := newRSVPHandler(rsvpUC, d.Log)
	upcomingHandler := newUpcomingForMeHandler(upcomingUC, d.Log)
	createClubHandler := newCreateClubHandler(createClubUC, d.Log)
	createSessionHandler := newCreateSessionHandler(createSessionUC, repo, d.Log)

	return &monolithServices.Module{
		MountPublicREST: func(r chi.Router) {
			// Anonymous-readable: catalogue + club detail + session detail.
			// /clubs/{slug} конфликтует с /clubs/sessions/{id} если порядок
			// неправильный — chi гарантирует literal match выигрывает над
			// param, но для устойчивости даём sessions свой prefix.
			r.Get("/clubs", listHandler)
			r.Get("/clubs/sessions/{id}", getSessionHandler)
			r.Get("/clubs/{slug}", getHandler)
		},
		MountREST: func(r chi.Router) {
			r.Post("/clubs/sessions/{id}/rsvp", rsvpHandler)
			r.Get("/clubs/upcoming-for-me", upcomingHandler)
			// Admin-gated curator writes. Role check внутри handler'а.
			r.Post("/admin/clubs", createClubHandler)
			r.Post("/admin/clubs/{slug}/sessions", createSessionHandler)
		},
	}
}

// ── Wire-shape DTOs ─────────────────────────────────────────────────────

type clubDTO struct {
	ID              string `json:"id"`
	CircleID        string `json:"circle_id"`
	Slug            string `json:"slug"`
	Name            string `json:"name"`
	TopicTag        string `json:"topic_tag"`
	CuratorID       string `json:"curator_id,omitempty"`
	CurriculumMd    string `json:"curriculum_md"`
	ScheduleKind    string `json:"schedule_kind"`
	DefaultZoomLink string `json:"default_zoom_link"`
	TGAnchorURL     string `json:"tg_anchor_url"`
	CoverImageURL   string `json:"cover_image_url"`
	IsPublic        bool   `json:"is_public"`
	CreatedAt       string `json:"created_at"`
}

type sessionDTO struct {
	ID                 string   `json:"id"`
	ClubID             string   `json:"club_id"`
	ScheduledAt        string   `json:"scheduled_at"`
	DurationMin        int      `json:"duration_min"`
	TopicTitle         string   `json:"topic_title"`
	TopicMd            string   `json:"topic_md"`
	PresenterHandle    string   `json:"presenter_handle"`
	ZoomLink           string   `json:"zoom_link"`
	TGPostURL          string   `json:"tg_post_url"`
	RecordingURL       string   `json:"recording_url"`
	PreReadMd          string   `json:"pre_read_md"`
	SummaryMd          string   `json:"summary_md"`
	TakeawaysMd        string   `json:"takeaways_md"`
	Status             string   `json:"status"`
	AttachedCodexSlugs []string `json:"attached_codex_slugs"`
	AttachedEventIDs   []string `json:"attached_event_ids"`
}

type materialDTO struct {
	ID        string `json:"id"`
	Kind      string `json:"kind"`
	Label     string `json:"label"`
	URL       string `json:"url"`
	SortOrder int    `json:"sort_order"`
}

type clubsListResp struct {
	Items []clubDTO `json:"items"`
}

type clubDetailResp struct {
	Club     clubDTO      `json:"club"`
	Upcoming []sessionDTO `json:"upcoming"`
	Past     []sessionDTO `json:"past"`
}

type sessionDetailResp struct {
	Session        sessionDTO    `json:"session"`
	Materials      []materialDTO `json:"materials"`
	AttendeeStatus string        `json:"attendee_status,omitempty"`
}

type rsvpBody struct {
	Status string `json:"status"`
}

type rsvpResp struct {
	SessionID string `json:"session_id"`
	UserID    string `json:"user_id"`
	Status    string `json:"status"`
	RSVPAt    string `json:"rsvp_at"`
}

// ── Mappers ─────────────────────────────────────────────────────────────

func clubToDTO(c clubsDomain.Club) clubDTO {
	out := clubDTO{
		ID:              c.ID.String(),
		CircleID:        c.CircleID.String(),
		Slug:            c.Slug,
		Name:            c.Name,
		TopicTag:        c.TopicTag,
		CurriculumMd:    c.CurriculumMD,
		ScheduleKind:    c.ScheduleKind,
		DefaultZoomLink: c.DefaultZoomLink,
		TGAnchorURL:     c.TGAnchorURL,
		CoverImageURL:   c.CoverImageURL,
		IsPublic:        c.IsPublic,
		CreatedAt:       c.CreatedAt.UTC().Format(time.RFC3339),
	}
	if c.CuratorID != nil {
		out.CuratorID = c.CuratorID.String()
	}
	return out
}

func sessionToDTO(s clubsDomain.Session) sessionDTO {
	codex := s.AttachedCodexSlugs
	if codex == nil {
		codex = []string{}
	}
	events := make([]string, 0, len(s.AttachedEventIDs))
	for _, e := range s.AttachedEventIDs {
		events = append(events, e.String())
	}
	return sessionDTO{
		ID:                 s.ID.String(),
		ClubID:             s.ClubID.String(),
		ScheduledAt:        s.ScheduledAt.UTC().Format(time.RFC3339),
		DurationMin:        s.DurationMin,
		TopicTitle:         s.TopicTitle,
		TopicMd:            s.TopicMD,
		PresenterHandle:    s.PresenterHandle,
		ZoomLink:           s.ZoomLink,
		TGPostURL:          s.TGPostURL,
		RecordingURL:       s.RecordingURL,
		PreReadMd:          s.PreReadMD,
		SummaryMd:          s.SummaryMD,
		TakeawaysMd:        s.TakeawaysMD,
		Status:             string(s.Status),
		AttachedCodexSlugs: codex,
		AttachedEventIDs:   events,
	}
}

func materialToDTO(m clubsDomain.Material) materialDTO {
	return materialDTO{
		ID:        m.ID.String(),
		Kind:      m.Kind,
		Label:     m.Label,
		URL:       m.URL,
		SortOrder: m.SortOrder,
	}
}

// ── Handlers ────────────────────────────────────────────────────────────

func newListHandler(uc *clubsApp.ListPublicClubs, log *slog.Logger) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		limit := 30
		if l := r.URL.Query().Get("limit"); l != "" {
			if v, err := strconv.Atoi(l); err == nil && v > 0 && v <= 100 {
				limit = v
			}
		}
		rows, err := uc.Do(r.Context(), limit)
		if err != nil {
			logErr(log, r, "list", err)
			writeErr(w, http.StatusInternalServerError, "internal")
			return
		}
		out := clubsListResp{Items: make([]clubDTO, 0, len(rows))}
		for _, c := range rows {
			out.Items = append(out.Items, clubToDTO(c))
		}
		writeJSON(w, out)
	}
}

func newGetClubHandler(uc *clubsApp.GetClub, log *slog.Logger) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		slug := chi.URLParam(r, "slug")
		view, err := uc.Do(r.Context(), slug)
		if err != nil {
			if errors.Is(err, clubsDomain.ErrNotFound) {
				writeErr(w, http.StatusNotFound, "not_found")
				return
			}
			if errors.Is(err, clubsDomain.ErrInvalidInput) {
				writeErr(w, http.StatusBadRequest, "bad_input")
				return
			}
			logErr(log, r, "get", err)
			writeErr(w, http.StatusInternalServerError, "internal")
			return
		}
		out := clubDetailResp{
			Club:     clubToDTO(view.Club),
			Upcoming: make([]sessionDTO, 0, len(view.Upcoming)),
			Past:     make([]sessionDTO, 0, len(view.Past)),
		}
		for _, s := range view.Upcoming {
			out.Upcoming = append(out.Upcoming, sessionToDTO(s))
		}
		for _, s := range view.Past {
			out.Past = append(out.Past, sessionToDTO(s))
		}
		writeJSON(w, out)
	}
}

func newGetSessionHandler(uc *clubsApp.GetSession, log *slog.Logger) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		idStr := chi.URLParam(r, "id")
		id, err := uuid.Parse(idStr)
		if err != nil {
			writeErr(w, http.StatusBadRequest, "bad_id")
			return
		}
		// Anonymous-OK; viewer userID опциональный.
		var viewer *uuid.UUID
		if uid, ok := sharedMw.UserIDFromContext(r.Context()); ok {
			viewer = &uid
		}
		view, err := uc.Do(r.Context(), id, viewer)
		if err != nil {
			if errors.Is(err, clubsDomain.ErrNotFound) {
				writeErr(w, http.StatusNotFound, "not_found")
				return
			}
			logErr(log, r, "get_session", err)
			writeErr(w, http.StatusInternalServerError, "internal")
			return
		}
		out := sessionDetailResp{
			Session:   sessionToDTO(view.Session),
			Materials: make([]materialDTO, 0, len(view.Materials)),
		}
		if view.AttendeeStatus != "" {
			out.AttendeeStatus = string(view.AttendeeStatus)
		}
		for _, m := range view.Materials {
			out.Materials = append(out.Materials, materialToDTO(m))
		}
		writeJSON(w, out)
	}
}

func newRSVPHandler(uc *clubsApp.RSVP, log *slog.Logger) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		uid, ok := sharedMw.UserIDFromContext(r.Context())
		if !ok {
			writeErr(w, http.StatusUnauthorized, "unauthenticated")
			return
		}
		idStr := chi.URLParam(r, "id")
		sessionID, err := uuid.Parse(idStr)
		if err != nil {
			writeErr(w, http.StatusBadRequest, "bad_id")
			return
		}
		var body rsvpBody
		if decodeErr := json.NewDecoder(r.Body).Decode(&body); decodeErr != nil {
			writeErr(w, http.StatusBadRequest, "bad_json")
			return
		}
		status := clubsDomain.AttendeeStatus(body.Status)
		out, err := uc.Do(r.Context(), clubsApp.RSVPInput{
			SessionID: sessionID,
			UserID:    uid,
			Status:    status,
		})
		if err != nil {
			if errors.Is(err, clubsDomain.ErrInvalidInput) {
				writeErr(w, http.StatusBadRequest, err.Error())
				return
			}
			logErr(log, r, "rsvp", err)
			writeErr(w, http.StatusInternalServerError, "internal")
			return
		}
		writeJSON(w, rsvpResp{
			SessionID: out.SessionID.String(),
			UserID:    out.UserID.String(),
			Status:    string(out.Status),
			RSVPAt:    out.RSVPAt.UTC().Format(time.RFC3339),
		})
	}
}

// ── Curator + chip handlers ─────────────────────────────────────────────

type createClubBody struct {
	CircleID        string `json:"circle_id"`
	Slug            string `json:"slug"`
	Name            string `json:"name"`
	TopicTag        string `json:"topic_tag"`
	CuratorID       string `json:"curator_id"`
	CurriculumMd    string `json:"curriculum_md"`
	ScheduleKind    string `json:"schedule_kind"`
	DefaultZoomLink string `json:"default_zoom_link"`
	TGAnchorURL     string `json:"tg_anchor_url"`
	CoverImageURL   string `json:"cover_image_url"`
	IsPublic        bool   `json:"is_public"`
}

type createSessionBody struct {
	ScheduledAt        string   `json:"scheduled_at"`
	DurationMin        int      `json:"duration_min"`
	TopicTitle         string   `json:"topic_title"`
	TopicMd            string   `json:"topic_md"`
	PresenterHandle    string   `json:"presenter_handle"`
	ZoomLink           string   `json:"zoom_link"`
	TGPostURL          string   `json:"tg_post_url"`
	PreReadMd          string   `json:"pre_read_md"`
	AttachedCodexSlugs []string `json:"attached_codex_slugs"`
}

type upcomingForMeResp struct {
	SessionID    string `json:"session_id"`
	ClubID       string `json:"club_id"`
	ClubSlug     string `json:"club_slug"`
	ClubName     string `json:"club_name"`
	ScheduledAt  string `json:"scheduled_at"`
	TopicTitle   string `json:"topic_title"`
	ZoomLink     string `json:"zoom_link"`
	HoursFromNow int    `json:"hours_from_now"`
}

func requireAdmin(w http.ResponseWriter, r *http.Request) bool {
	if _, ok := sharedMw.UserIDFromContext(r.Context()); !ok {
		writeErr(w, http.StatusUnauthorized, "unauthenticated")
		return false
	}
	role, ok := sharedMw.UserRoleFromContext(r.Context())
	if !ok || role != string(enums.UserRoleAdmin) {
		writeErr(w, http.StatusForbidden, "admin role required")
		return false
	}
	return true
}

func newUpcomingForMeHandler(uc *clubsApp.NextUpcomingForUser, log *slog.Logger) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		uid, ok := sharedMw.UserIDFromContext(r.Context())
		if !ok {
			writeErr(w, http.StatusUnauthorized, "unauthenticated")
			return
		}
		out, err := uc.Do(r.Context(), uid)
		if err != nil {
			logErr(log, r, "upcoming_for_me", err)
			writeErr(w, http.StatusInternalServerError, "internal")
			return
		}
		if out == nil {
			writeJSON(w, map[string]any{"session": nil})
			return
		}
		writeJSON(w, map[string]any{"session": upcomingForMeResp{
			SessionID:    out.SessionID.String(),
			ClubID:       out.ClubID.String(),
			ClubSlug:     out.ClubSlug,
			ClubName:     out.ClubName,
			ScheduledAt:  out.ScheduledAt.UTC().Format(time.RFC3339),
			TopicTitle:   out.TopicTitle,
			ZoomLink:     out.ZoomLink,
			HoursFromNow: out.HoursFromNow,
		}})
	}
}

func newCreateClubHandler(uc *clubsApp.CreateClub, log *slog.Logger) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !requireAdmin(w, r) {
			return
		}
		var body createClubBody
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			writeErr(w, http.StatusBadRequest, "bad_json")
			return
		}
		circleID, err := uuid.Parse(body.CircleID)
		if err != nil {
			writeErr(w, http.StatusBadRequest, "bad_circle_id")
			return
		}
		var curator *uuid.UUID
		if body.CuratorID != "" {
			cu, parseErr := uuid.Parse(body.CuratorID)
			if parseErr != nil {
				writeErr(w, http.StatusBadRequest, "bad_curator_id")
				return
			}
			curator = &cu
		}
		c, err := uc.Do(r.Context(), clubsDomain.CreateClubInput{
			CircleID:        circleID,
			Slug:            body.Slug,
			Name:            body.Name,
			TopicTag:        body.TopicTag,
			CuratorID:       curator,
			CurriculumMD:    body.CurriculumMd,
			ScheduleKind:    body.ScheduleKind,
			DefaultZoomLink: body.DefaultZoomLink,
			TGAnchorURL:     body.TGAnchorURL,
			CoverImageURL:   body.CoverImageURL,
			IsPublic:        body.IsPublic,
		})
		if err != nil {
			if errors.Is(err, clubsDomain.ErrInvalidInput) {
				writeErr(w, http.StatusBadRequest, err.Error())
				return
			}
			logErr(log, r, "create_club", err)
			writeErr(w, http.StatusInternalServerError, "internal")
			return
		}
		writeJSON(w, clubToDTO(c))
	}
}

func newCreateSessionHandler(uc *clubsApp.CreateSession, repo clubsDomain.Repo, log *slog.Logger) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !requireAdmin(w, r) {
			return
		}
		slug := chi.URLParam(r, "slug")
		club, err := repo.GetBySlug(r.Context(), slug)
		if err != nil {
			if errors.Is(err, clubsDomain.ErrNotFound) {
				writeErr(w, http.StatusNotFound, "club_not_found")
				return
			}
			logErr(log, r, "create_session_lookup", err)
			writeErr(w, http.StatusInternalServerError, "internal")
			return
		}
		var body createSessionBody
		if decodeErr := json.NewDecoder(r.Body).Decode(&body); decodeErr != nil {
			writeErr(w, http.StatusBadRequest, "bad_json")
			return
		}
		scheduledAt, err := time.Parse(time.RFC3339, body.ScheduledAt)
		if err != nil {
			writeErr(w, http.StatusBadRequest, "bad_scheduled_at")
			return
		}
		s, err := uc.Do(r.Context(), clubsDomain.CreateSessionInput{
			ClubID:             club.ID,
			ScheduledAt:        scheduledAt,
			DurationMin:        body.DurationMin,
			TopicTitle:         body.TopicTitle,
			TopicMD:            body.TopicMd,
			PresenterHandle:    body.PresenterHandle,
			ZoomLink:           body.ZoomLink,
			TGPostURL:          body.TGPostURL,
			PreReadMD:          body.PreReadMd,
			AttachedCodexSlugs: body.AttachedCodexSlugs,
		})
		if err != nil {
			if errors.Is(err, clubsDomain.ErrInvalidInput) {
				writeErr(w, http.StatusBadRequest, err.Error())
				return
			}
			logErr(log, r, "create_session", err)
			writeErr(w, http.StatusInternalServerError, "internal")
			return
		}
		writeJSON(w, sessionToDTO(s))
	}
}

// ── helpers ────────────────────────────────────────────────────────────

func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(v)
}

func writeErr(w http.ResponseWriter, status int, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]string{"error": msg})
}

func logErr(log *slog.Logger, r *http.Request, op string, err error) {
	if log == nil {
		return
	}
	log.WarnContext(r.Context(), "clubs."+op, slog.Any("err", err))
}
