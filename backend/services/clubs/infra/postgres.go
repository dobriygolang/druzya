// Package infra — Postgres adapter for the clubs bounded context.
package infra

import (
	"context"
	"errors"
	"fmt"
	"time"

	"druz9/clubs/domain"
	sharedpg "druz9/shared/pkg/pg"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Postgres implements domain.Repo over pgx.
type Postgres struct {
	pool *pgxpool.Pool
}

// NewPostgres wraps a pool.
func NewPostgres(pool *pgxpool.Pool) *Postgres {
	if pool == nil {
		panic("clubs/infra.NewPostgres: nil pool")
	}
	return &Postgres{pool: pool}
}

const clubColumns = `
	id, circle_id, slug, name, topic_tag, curator_user_id, curriculum_md,
	schedule_kind, default_zoom_link, tg_anchor_url, cover_image_url,
	is_public, is_active, created_at, updated_at`

const sessionColumns = `
	id, club_id, scheduled_at, duration_min, topic_title, topic_md,
	presenter_handle, zoom_link, tg_post_url, recording_url,
	pre_read_md, summary_md, takeaways_md, status,
	attached_codex_slugs, attached_event_ids,
	created_at, updated_at`

// scanClub parses one club row.
func scanClub(row pgx.Row) (domain.Club, error) {
	var (
		id, circleID, curatorID                          pgtype.UUID
		slug, name, topicTag, curriculumMD, scheduleKind string
		defaultZoom, tgAnchor, coverImage                string
		isPublic, isActive                               bool
		createdAt, updatedAt                             time.Time
	)
	if err := row.Scan(&id, &circleID, &slug, &name, &topicTag, &curatorID,
		&curriculumMD, &scheduleKind, &defaultZoom, &tgAnchor, &coverImage,
		&isPublic, &isActive, &createdAt, &updatedAt); err != nil {
		return domain.Club{}, fmt.Errorf("clubs.pg.scanClub: %w", err)
	}
	c := domain.Club{
		ID:              sharedpg.UUIDFrom(id),
		CircleID:        sharedpg.UUIDFrom(circleID),
		Slug:            slug,
		Name:            name,
		TopicTag:        topicTag,
		CurriculumMD:    curriculumMD,
		ScheduleKind:    scheduleKind,
		DefaultZoomLink: defaultZoom,
		TGAnchorURL:     tgAnchor,
		CoverImageURL:   coverImage,
		IsPublic:        isPublic,
		IsActive:        isActive,
		CreatedAt:       createdAt,
		UpdatedAt:       updatedAt,
	}
	if curatorID.Valid {
		uid := sharedpg.UUIDFrom(curatorID)
		c.CuratorID = &uid
	}
	return c, nil
}

// scanSession parses one session row.
func scanSession(row pgx.Row) (domain.Session, error) {
	var (
		id, clubID                                              pgtype.UUID
		scheduledAt                                             time.Time
		durationMin                                             int32
		topicTitle, topicMD, presenter, zoom, tgPost, recording string
		preRead, summary, takeaways                             string
		status                                                  string
		codexSlugs                                              []string
		eventIDsRaw                                             []pgtype.UUID
		createdAt, updatedAt                                    time.Time
	)
	if err := row.Scan(&id, &clubID, &scheduledAt, &durationMin, &topicTitle, &topicMD,
		&presenter, &zoom, &tgPost, &recording,
		&preRead, &summary, &takeaways, &status,
		&codexSlugs, &eventIDsRaw,
		&createdAt, &updatedAt); err != nil {
		return domain.Session{}, fmt.Errorf("clubs.pg.scanSession: %w", err)
	}
	eventIDs := make([]uuid.UUID, 0, len(eventIDsRaw))
	for _, e := range eventIDsRaw {
		if e.Valid {
			eventIDs = append(eventIDs, sharedpg.UUIDFrom(e))
		}
	}
	return domain.Session{
		ID:                 sharedpg.UUIDFrom(id),
		ClubID:             sharedpg.UUIDFrom(clubID),
		ScheduledAt:        scheduledAt,
		DurationMin:        int(durationMin),
		TopicTitle:         topicTitle,
		TopicMD:            topicMD,
		PresenterHandle:    presenter,
		ZoomLink:           zoom,
		TGPostURL:          tgPost,
		RecordingURL:       recording,
		PreReadMD:          preRead,
		SummaryMD:          summary,
		TakeawaysMD:        takeaways,
		Status:             domain.SessionStatus(status),
		AttachedCodexSlugs: codexSlugs,
		AttachedEventIDs:   eventIDs,
		CreatedAt:          createdAt,
		UpdatedAt:          updatedAt,
	}, nil
}

// ── Repo implementation ─────────────────────────────────────────────────

// ListPublic returns active+public clubs newest-first. Caller-bounded limit.
func (p *Postgres) ListPublic(ctx context.Context, limit int) ([]domain.Club, error) {
	if limit <= 0 || limit > 100 {
		limit = 30
	}
	rows, err := p.pool.Query(ctx,
		`SELECT `+clubColumns+`
		   FROM clubs
		  WHERE is_public AND is_active
		  ORDER BY created_at DESC
		  LIMIT $1`,
		int32(limit),
	)
	if err != nil {
		return nil, fmt.Errorf("clubs.pg.ListPublic: %w", err)
	}
	defer rows.Close()
	out := make([]domain.Club, 0, limit)
	for rows.Next() {
		c, err := scanClub(rows)
		if err != nil {
			return nil, fmt.Errorf("clubs.pg.ListPublic: scan: %w", err)
		}
		out = append(out, c)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("clubs.pg.ListPublic: rows: %w", err)
	}
	return out, nil
}

// GetBySlug — single club lookup.
func (p *Postgres) GetBySlug(ctx context.Context, slug string) (domain.Club, error) {
	row := p.pool.QueryRow(ctx,
		`SELECT `+clubColumns+` FROM clubs WHERE slug = $1 AND is_active`,
		slug,
	)
	c, err := scanClub(row)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.Club{}, domain.ErrNotFound
		}
		return domain.Club{}, fmt.Errorf("clubs.pg.GetBySlug: %w", err)
	}
	return c, nil
}

// GetClubWithSessions — club + split sessions list (upcoming/past).
func (p *Postgres) GetClubWithSessions(ctx context.Context, slug string, upcomingLimit, pastLimit int) (domain.ClubWithSessions, error) {
	c, err := p.GetBySlug(ctx, slug)
	if err != nil {
		return domain.ClubWithSessions{}, err
	}
	upcoming, err := p.listSessionsByClub(ctx, c.ID, true, upcomingLimit)
	if err != nil {
		return domain.ClubWithSessions{}, fmt.Errorf("clubs.pg.GetClubWithSessions: upcoming: %w", err)
	}
	past, err := p.listSessionsByClub(ctx, c.ID, false, pastLimit)
	if err != nil {
		return domain.ClubWithSessions{}, fmt.Errorf("clubs.pg.GetClubWithSessions: past: %w", err)
	}
	return domain.ClubWithSessions{Club: c, Upcoming: upcoming, Past: past}, nil
}

func (p *Postgres) listSessionsByClub(ctx context.Context, clubID uuid.UUID, upcoming bool, limit int) ([]domain.Session, error) {
	if limit <= 0 || limit > 100 {
		limit = 20
	}
	var (
		condition string
		order     string
	)
	if upcoming {
		// scheduled / live в будущем + прямо сейчас.
		condition = `scheduled_at >= now() - interval '2 hours' AND status IN ('scheduled', 'live')`
		order = "scheduled_at ASC"
	} else {
		condition = `(scheduled_at < now() - interval '2 hours' OR status IN ('done', 'cancelled'))`
		order = "scheduled_at DESC"
	}
	q := fmt.Sprintf(`
		SELECT %s
		  FROM club_sessions
		 WHERE club_id = $1 AND %s
		 ORDER BY %s
		 LIMIT $2`, sessionColumns, condition, order)
	rows, err := p.pool.Query(ctx, q, sharedpg.UUID(clubID), int32(limit))
	if err != nil {
		return nil, fmt.Errorf("clubs.pg.listSessionsByClub: query: %w", err)
	}
	defer rows.Close()
	out := make([]domain.Session, 0, limit)
	for rows.Next() {
		s, err := scanSession(rows)
		if err != nil {
			return nil, fmt.Errorf("clubs.pg.listSessionsByClub: scan: %w", err)
		}
		out = append(out, s)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("clubs.pg.listSessionsByClub: rows: %w", err)
	}
	return out, nil
}

// GetSessionWithMaterials — single session + materials + (optional) viewer attendance.
func (p *Postgres) GetSessionWithMaterials(ctx context.Context, sessionID uuid.UUID, viewerUserID *uuid.UUID) (domain.SessionWithMaterials, error) {
	row := p.pool.QueryRow(ctx,
		`SELECT `+sessionColumns+` FROM club_sessions WHERE id = $1`,
		sharedpg.UUID(sessionID),
	)
	s, err := scanSession(row)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.SessionWithMaterials{}, domain.ErrNotFound
		}
		return domain.SessionWithMaterials{}, fmt.Errorf("clubs.pg.GetSessionWithMaterials: %w", err)
	}

	materials, err := p.listMaterials(ctx, sessionID)
	if err != nil {
		return domain.SessionWithMaterials{}, fmt.Errorf("clubs.pg.GetSessionWithMaterials: materials: %w", err)
	}
	out := domain.SessionWithMaterials{Session: s, Materials: materials}
	if viewerUserID != nil {
		var st string
		err := p.pool.QueryRow(ctx,
			`SELECT status FROM club_attendees WHERE session_id = $1 AND user_id = $2`,
			sharedpg.UUID(sessionID), sharedpg.UUID(*viewerUserID),
		).Scan(&st)
		if err == nil {
			out.AttendeeStatus = domain.AttendeeStatus(st)
		}
	}
	return out, nil
}

func (p *Postgres) listMaterials(ctx context.Context, sessionID uuid.UUID) ([]domain.Material, error) {
	rows, err := p.pool.Query(ctx,
		`SELECT id, session_id, kind, label, url, sort_order, created_at
		   FROM club_materials
		  WHERE session_id = $1
		  ORDER BY sort_order ASC, created_at ASC`,
		sharedpg.UUID(sessionID),
	)
	if err != nil {
		return nil, fmt.Errorf("clubs.pg.listMaterials: query: %w", err)
	}
	defer rows.Close()
	out := make([]domain.Material, 0, 4)
	for rows.Next() {
		var (
			id, sid   pgtype.UUID
			kind, lbl string
			url       string
			sortOrder int32
			createdAt time.Time
		)
		if err := rows.Scan(&id, &sid, &kind, &lbl, &url, &sortOrder, &createdAt); err != nil {
			return nil, fmt.Errorf("clubs.pg.listMaterials: scan: %w", err)
		}
		out = append(out, domain.Material{
			ID:        sharedpg.UUIDFrom(id),
			SessionID: sharedpg.UUIDFrom(sid),
			Kind:      kind,
			Label:     lbl,
			URL:       url,
			SortOrder: int(sortOrder),
			CreatedAt: createdAt,
		})
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("clubs.pg.listMaterials: rows: %w", err)
	}
	return out, nil
}

// RSVP upserts an attendee row.
func (p *Postgres) RSVP(ctx context.Context, sessionID, userID uuid.UUID, status domain.AttendeeStatus) (domain.Attendee, error) {
	var (
		st     string
		notes  string
		rsvpAt time.Time
	)
	err := p.pool.QueryRow(ctx,
		`INSERT INTO club_attendees (session_id, user_id, status, rsvp_at)
		 VALUES ($1, $2, $3, now())
		 ON CONFLICT (session_id, user_id) DO UPDATE
		   SET status  = EXCLUDED.status,
		       rsvp_at = now()
		 RETURNING status, notes_md, rsvp_at`,
		sharedpg.UUID(sessionID), sharedpg.UUID(userID), string(status),
	).Scan(&st, &notes, &rsvpAt)
	if err != nil {
		return domain.Attendee{}, fmt.Errorf("clubs.pg.RSVP: %w", err)
	}
	return domain.Attendee{
		SessionID: sessionID,
		UserID:    userID,
		Status:    domain.AttendeeStatus(st),
		NotesMD:   notes,
		RSVPAt:    rsvpAt,
	}, nil
}

// CreateClub inserts a new club. Slug uniqueness enforced by DB.
func (p *Postgres) CreateClub(ctx context.Context, in domain.CreateClubInput) (domain.Club, error) {
	var (
		curatorArg           pgtype.UUID
		isPublic             = in.IsPublic
		newID, circle        pgtype.UUID
		createdAt, updatedAt time.Time
	)
	if in.CuratorID != nil && *in.CuratorID != uuid.Nil {
		curatorArg = sharedpg.UUID(*in.CuratorID)
	}
	err := p.pool.QueryRow(ctx, `
		INSERT INTO clubs (
			circle_id, slug, name, topic_tag, curator_user_id, curriculum_md,
			schedule_kind, default_zoom_link, tg_anchor_url, cover_image_url, is_public
		) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
		RETURNING id, circle_id, created_at, updated_at`,
		sharedpg.UUID(in.CircleID), in.Slug, in.Name, in.TopicTag, curatorArg,
		in.CurriculumMD, in.ScheduleKind, in.DefaultZoomLink, in.TGAnchorURL,
		in.CoverImageURL, isPublic,
	).Scan(&newID, &circle, &createdAt, &updatedAt)
	if err != nil {
		return domain.Club{}, fmt.Errorf("clubs.pg.CreateClub: %w", err)
	}
	out := domain.Club{
		ID:              sharedpg.UUIDFrom(newID),
		CircleID:        sharedpg.UUIDFrom(circle),
		Slug:            in.Slug,
		Name:            in.Name,
		TopicTag:        in.TopicTag,
		CurriculumMD:    in.CurriculumMD,
		ScheduleKind:    in.ScheduleKind,
		DefaultZoomLink: in.DefaultZoomLink,
		TGAnchorURL:     in.TGAnchorURL,
		CoverImageURL:   in.CoverImageURL,
		IsPublic:        isPublic,
		IsActive:        true,
		CreatedAt:       createdAt,
		UpdatedAt:       updatedAt,
	}
	if in.CuratorID != nil && *in.CuratorID != uuid.Nil {
		c := *in.CuratorID
		out.CuratorID = &c
	}
	return out, nil
}

// CreateSession inserts a new session row.
func (p *Postgres) CreateSession(ctx context.Context, in domain.CreateSessionInput) (domain.Session, error) {
	var (
		newID, clubID        pgtype.UUID
		createdAt, updatedAt time.Time
		statusOut            string
	)
	codex := in.AttachedCodexSlugs
	if codex == nil {
		codex = []string{}
	}
	err := p.pool.QueryRow(ctx, `
		INSERT INTO club_sessions (
			club_id, scheduled_at, duration_min, topic_title, topic_md,
			presenter_handle, zoom_link, tg_post_url, pre_read_md,
			attached_codex_slugs
		) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
		RETURNING id, club_id, status, created_at, updated_at`,
		sharedpg.UUID(in.ClubID), in.ScheduledAt, int32(in.DurationMin),
		in.TopicTitle, in.TopicMD, in.PresenterHandle, in.ZoomLink, in.TGPostURL,
		in.PreReadMD, codex,
	).Scan(&newID, &clubID, &statusOut, &createdAt, &updatedAt)
	if err != nil {
		return domain.Session{}, fmt.Errorf("clubs.pg.CreateSession: %w", err)
	}
	return domain.Session{
		ID:                 sharedpg.UUIDFrom(newID),
		ClubID:             sharedpg.UUIDFrom(clubID),
		ScheduledAt:        in.ScheduledAt,
		DurationMin:        in.DurationMin,
		TopicTitle:         in.TopicTitle,
		TopicMD:            in.TopicMD,
		PresenterHandle:    in.PresenterHandle,
		ZoomLink:           in.ZoomLink,
		TGPostURL:          in.TGPostURL,
		PreReadMD:          in.PreReadMD,
		Status:             domain.SessionStatus(statusOut),
		AttachedCodexSlugs: codex,
		AttachedEventIDs:   []uuid.UUID{},
		CreatedAt:          createdAt,
		UpdatedAt:          updatedAt,
	}, nil
}

// NextUpcomingForUser — query: соединяем club_attendees + club_sessions
// + clubs, фильтруем status='rsvp_yes' AND session scheduled_at >=
// now() - 30min (грейс на «уже идёт»). Берём самую раннюю.
func (p *Postgres) NextUpcomingForUser(ctx context.Context, userID uuid.UUID) (*domain.UpcomingForUser, error) {
	var (
		sid, cid    pgtype.UUID
		slug, name  string
		scheduledAt time.Time
		topic, zoom string
	)
	err := p.pool.QueryRow(ctx, `
		SELECT s.id, c.id, c.slug, c.name, s.scheduled_at, s.topic_title, s.zoom_link
		  FROM club_attendees a
		  JOIN club_sessions s ON s.id = a.session_id
		  JOIN clubs c         ON c.id = s.club_id
		 WHERE a.user_id = $1
		   AND a.status  = 'rsvp_yes'
		   AND s.status IN ('scheduled', 'live')
		   AND s.scheduled_at >= now() - interval '30 minutes'
		 ORDER BY s.scheduled_at ASC
		 LIMIT 1`,
		sharedpg.UUID(userID),
	).Scan(&sid, &cid, &slug, &name, &scheduledAt, &topic, &zoom)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, fmt.Errorf("clubs.pg.NextUpcomingForUser: %w", err)
	}
	hours := int(time.Until(scheduledAt).Hours())
	if hours < 0 {
		hours = 0
	}
	return &domain.UpcomingForUser{
		SessionID:    sharedpg.UUIDFrom(sid),
		ClubID:       sharedpg.UUIDFrom(cid),
		ClubSlug:     slug,
		ClubName:     name,
		ScheduledAt:  scheduledAt,
		TopicTitle:   topic,
		ZoomLink:     zoom,
		HoursFromNow: hours,
	}, nil
}

// GhostedSessionsInWindow — сессии в окне past windowDays где user
// RSVP'd_yes но статус остался rsvp_yes (никто не проставил attended).
// Только сессии с status='done' (cancelled не считаем — там не было
// шанса dropout'нуть).
func (p *Postgres) GhostedSessionsInWindow(ctx context.Context, userID uuid.UUID, windowDays int) ([]domain.GhostedClubFact, error) {
	if windowDays <= 0 || windowDays > 60 {
		windowDays = 7
	}
	rows, err := p.pool.Query(ctx, `
		SELECT c.name, s.topic_title, s.scheduled_at
		  FROM club_attendees a
		  JOIN club_sessions s ON s.id = a.session_id
		  JOIN clubs c         ON c.id = s.club_id
		 WHERE a.user_id = $1
		   AND a.status  = 'rsvp_yes'
		   AND s.status  = 'done'
		   AND s.scheduled_at >= now() - ($2 || ' days')::interval
		   AND s.scheduled_at < now()
		 ORDER BY s.scheduled_at DESC
		 LIMIT 5`,
		sharedpg.UUID(userID), fmt.Sprintf("%d", windowDays),
	)
	if err != nil {
		return nil, fmt.Errorf("clubs.pg.GhostedSessionsInWindow: %w", err)
	}
	defer rows.Close()
	now := time.Now().UTC()
	out := make([]domain.GhostedClubFact, 0, 4)
	for rows.Next() {
		var (
			club, topic string
			scheduled   time.Time
		)
		if err := rows.Scan(&club, &topic, &scheduled); err != nil {
			return nil, fmt.Errorf("clubs.pg.GhostedSessionsInWindow: scan: %w", err)
		}
		ago := int(now.Sub(scheduled).Hours() / 24)
		if ago < 0 {
			ago = 0
		}
		out = append(out, domain.GhostedClubFact{
			ClubName: club, TopicTitle: topic, HappenedAgo: ago,
		})
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("clubs.pg.GhostedSessionsInWindow: rows: %w", err)
	}
	return out, nil
}

// Compile-time interface guard.
var _ domain.Repo = (*Postgres)(nil)
