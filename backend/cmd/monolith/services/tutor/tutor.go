// Package tutor wires the tutor bounded context into the monolith.
// Wave 2 of docs/feature/tutor.md (tutor as distribution channel).
//
// The proto's PeekInvite RPC is intentionally PUBLIC (the /invite/{code}
// landing page must render before student auth). The REST gate in
// router.go whitelists the corresponding GET path.
package tutor

import (
	"context"
	"time"

	monolithServices "druz9/cmd/monolith/services"
	notifyApp "druz9/notify/app"
	"druz9/shared/enums"
	"druz9/shared/generated/pb/druz9/v1/druz9v1connect"
	tutorApp "druz9/tutor/app"
	tutorInfra "druz9/tutor/infra"
	tutorPorts "druz9/tutor/ports"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// TutorDeps groups the optional cross-context plug-ins. All fields
// are nilable: when missing, the corresponding RPC degrades cleanly
// (PeekInvite returns empty tutor_display; brief returns empty
// markdown). This keeps the module boot-able in environments without
// LLMChain or profile reader.
type TutorDeps struct {
	TutorDisplay tutorPorts.TutorDisplayLookup
	Briefer      tutorApp.PreSessionBriefer
	// NotifySend — optional. Когда set, AssignmentDueSoonWorker крутится
	// в Background и шлёт «due in 24h» нотификации студентам. nil-safe:
	// без этого worker не запускается.
	NotifySend *notifyApp.SendNotification
}

// TutorModule extends Module by exposing the PushAssignment use case so
// other monolith wirings (e.g. ai_tutor proactive triggers) can call it
// without re-constructing the use case + repo. The embedded Module is
// what gets registered in bootstrap's modules slice — TutorModule itself
// stays a wrapper.
type TutorModule struct {
	*monolithServices.Module
	PushAssignment *tutorApp.PushAssignment
}

func NewTutor(d monolithServices.Deps, tdeps TutorDeps) TutorModule {
	repo := tutorInfra.NewPostgres(d.Pool)
	// *Postgres satisfies both domain.Repo and domain.SnapshotRepo —
	// we pass it to both use-case slots without an adapter.
	getSnapshot := &tutorApp.GetStudentSnapshot{Repo: repo, Now: d.Now}
	pushAssignmentUC := &tutorApp.PushAssignment{Repo: repo, Now: d.Now}
	displays := &userDisplaysResolver{pool: d.Pool}
	server := &tutorPorts.TutorServer{
		CreateInviteUC:     &tutorApp.CreateInvite{Repo: repo, Now: d.Now},
		RevokeInviteUC:     &tutorApp.RevokeInvite{Repo: repo, Now: d.Now},
		AcceptInviteUC:     &tutorApp.AcceptInvite{Repo: repo, Now: d.Now},
		ListInvitesUC:      &tutorApp.ListInvites{Repo: repo},
		ListStudentsUC:     &tutorApp.ListStudents{Repo: repo},
		ListMyTutorsUC:     &tutorApp.ListMyTutors{Repo: repo},
		GetTutorActivityUC: &tutorApp.GetTutorActivity{Repo: repo, Now: d.Now},
		// Wave 5.2 group events on circles.
		CreateGroupEventUC:                  &tutorApp.CreateGroupEvent{Repo: repo, Now: d.Now},
		JoinEventUC:                         &tutorApp.JoinEvent{Repo: repo, Now: d.Now},
		LeaveEventUC:                        &tutorApp.LeaveEvent{Repo: repo},
		ListUpcomingGroupEventsForStudentUC: &tutorApp.ListUpcomingGroupEventsForStudent{Repo: repo, Now: d.Now},
		GetEventRSVPCountUC:                 &tutorApp.GetEventRSVPCount{Repo: repo},
		PeekInviteUC:                        &tutorApp.PeekInvite{Repo: repo, Now: d.Now},
		EndRelationshipUC:                   &tutorApp.EndRelationship{Repo: repo, Now: d.Now},
		GetSnapshotUC:                       getSnapshot,
		GenerateBriefUC: &tutorApp.GeneratePreSessionBrief{
			Snapshot: getSnapshot,
			Briefer:  tdeps.Briefer,
		},
		// Wave 5.1 — assignments. *Postgres satisfies domain.AssignmentRepo
		// (CreateAssignment / List* / MarkComplete / ArchiveAssignment +
		// the shared EnsureRelationship). Same struct, three interfaces.
		PushAssignmentUC:          pushAssignmentUC,
		ListAssignmentsForTutorUC: &tutorApp.ListAssignmentsForTutor{Repo: repo},
		ListPendingAssignmentsUC:  &tutorApp.ListPendingForStudent{Repo: repo},
		CompleteAssignmentUC:      &tutorApp.MarkAssignmentComplete{Repo: repo, Now: d.Now},
		ArchiveAssignmentUC:       &tutorApp.ArchiveAssignment{Repo: repo, Now: d.Now},
		// Wave 5.2a — broadcast: needs both the Students repo (Repo) and
		// the AssignmentRepo. *Postgres satisfies both.
		BroadcastAssignmentUC: &tutorApp.BroadcastAssignment{
			Students:    repo,
			Assignments: repo,
			Now:         d.Now,
		},
		InviteByUsernameUC:        &tutorApp.InviteByUsername{Repo: repo, Now: d.Now},
		ListPendingInvitesForMeUC: &tutorApp.ListPendingInvitesForMe{Repo: repo, Now: d.Now},
		// Phase 3.3 — tutor session notes-pad.
		GetSessionNotesUC:  &tutorApp.GetSessionNotes{Repo: repo, Notes: repo},
		SaveSessionNotesUC: &tutorApp.SaveSessionNotes{Repo: repo, Notes: repo},
		PushSharedReadingUC: &tutorApp.PushSharedReading{
			Materials: repo,
			Broadcast: &tutorApp.BroadcastAssignment{
				Students:    repo,
				Assignments: repo,
				Now:         d.Now,
			},
			Now: d.Now,
		},
		ListSharedReadingUC: &tutorApp.ListSharedReading{Materials: repo},
		// Wave 5.2b — calendar events. *Postgres satisfies EventRepo
		// (one struct now satisfies four interfaces: Repo + SnapshotRepo
		// + AssignmentRepo + EventRepo).
		CreateEventUC:                  &tutorApp.CreateEvent{Repo: repo, Now: d.Now},
		CancelEventUC:                  &tutorApp.CancelEvent{Repo: repo, Now: d.Now},
		CompleteEventUC:                &tutorApp.CompleteEvent{Repo: repo, Now: d.Now},
		ListEventsForTutorUC:           &tutorApp.ListEventsForTutor{Repo: repo},
		ListUpcomingEventsForStudentUC: &tutorApp.ListUpcomingEventsForStudent{Repo: repo, Now: d.Now},

		TutorDisplay: tdeps.TutorDisplay,
		Displays:     displays,
		Log:          d.Log,
	}

	connectPath, connectHandler := druz9v1connect.NewTutorServiceHandler(server)
	transcoder := monolithServices.MustTranscode("tutor", connectPath, connectHandler)

	mod := &monolithServices.Module{
		ConnectPath:        connectPath,
		ConnectHandler:     transcoder,
		RequireConnectAuth: true, // PeekInvite carve-out applied by REST gate
		MountREST: func(r chi.Router) {
			r.Post("/tutor/invites", transcoder.ServeHTTP)
			r.Get("/tutor/invites", transcoder.ServeHTTP)
			r.Post("/tutor/invites/{invite_id}/revoke", transcoder.ServeHTTP)
			r.Post("/tutor/invites/accept", transcoder.ServeHTTP)
			r.Get("/tutor/invites/peek/{code}", transcoder.ServeHTTP) // PUBLIC
			r.Get("/tutor/students", transcoder.ServeHTTP)
			r.Get("/tutor/my-tutors", transcoder.ServeHTTP) // Wave 9.4
			r.Get("/tutor/activity", transcoder.ServeHTTP)  // Wave 9.5
			// Wave 5.2 group events.
			r.Post("/tutor/events/group", transcoder.ServeHTTP)
			r.Post("/tutor/events/{event_id}/join", transcoder.ServeHTTP)
			r.Post("/tutor/events/{event_id}/leave", transcoder.ServeHTTP)
			r.Get("/tutor/events/upcoming/group", transcoder.ServeHTTP)
			r.Get("/tutor/events/{event_id}/rsvp-count", transcoder.ServeHTTP)
			r.Post("/tutor/students/{student_id}/end", transcoder.ServeHTTP)
			r.Get("/tutor/students/{student_id}/snapshot", transcoder.ServeHTTP)
			r.Get("/tutor/students/{student_id}/brief", transcoder.ServeHTTP)
			r.Get("/tutor/students/{student_id}/notes", transcoder.ServeHTTP)
			r.Put("/tutor/students/{student_id}/notes", transcoder.ServeHTTP)
			// Wave 5.1 — assignments REST aliases.
			r.Post("/tutor/students/{student_id}/assignments", transcoder.ServeHTTP)
			r.Get("/tutor/students/{student_id}/assignments", transcoder.ServeHTTP)
			r.Get("/tutor/assignments/pending", transcoder.ServeHTTP)
			r.Post("/tutor/assignments/{assignment_id}/complete", transcoder.ServeHTTP)
			r.Post("/tutor/assignments/{assignment_id}/archive", transcoder.ServeHTTP)
			r.Post("/tutor/assignments/broadcast", transcoder.ServeHTTP) // Wave 5.2a
			r.Post("/tutor/shared-reading", transcoder.ServeHTTP)
			r.Get("/tutor/shared-reading", transcoder.ServeHTTP)
			// Wave «Invite by @username».
			r.Post("/tutor/invites/by-username", transcoder.ServeHTTP)
			r.Get("/tutor/invites/pending-for-me", transcoder.ServeHTTP)
			// Wave 5.2b — events REST aliases.
			r.Post("/tutor/events", transcoder.ServeHTTP)
			r.Get("/tutor/events", transcoder.ServeHTTP)
			r.Get("/tutor/events/upcoming", transcoder.ServeHTTP)
			r.Post("/tutor/events/{event_id}/cancel", transcoder.ServeHTTP)
			r.Post("/tutor/events/{event_id}/complete", transcoder.ServeHTTP) // Wave 5.2d
		},
	}

	// AssignmentDueSoonWorker — Wave pivot 2026-05-02. Notifies the student
	// 24h before due_at via notify-сервис. Idempotent through tutor_assignments
	// .due_notified_at column. Only runs if notify is wired.
	if tdeps.NotifySend != nil {
		w := &tutorApp.AssignmentDueSoonWorker{
			Repo:         repo,
			Notify:       &notifySendAdapter{uc: tdeps.NotifySend},
			TutorDisplay: &userDisplayLookup{pool: d.Pool},
			Log:          d.Log,
			Now:          d.Now,
			Interval:     5 * time.Minute,
			Window:       24 * time.Hour,
			BatchLimit:   100,
		}
		mod.Background = append(mod.Background, func(ctx context.Context) { go w.Run(ctx) })
	}

	return TutorModule{Module: mod, PushAssignment: pushAssignmentUC}
}

// userDisplayLookup — мини-reader users.display_name (с fallback на
// username) для tutor display в notification text. Cross-domain shim:
// avoid импорта profile/users domain'а — две колонки этой таблицы стабильные.
type userDisplayLookup struct{ pool *pgxpool.Pool }

func (l *userDisplayLookup) DisplayName(ctx context.Context, tutorID uuid.UUID) string {
	if l == nil || l.pool == nil || tutorID == uuid.Nil {
		return ""
	}
	var displayName, username *string
	err := l.pool.QueryRow(ctx,
		`SELECT display_name, username FROM users WHERE id = $1`, tutorID,
	).Scan(&displayName, &username)
	if err != nil {
		return ""
	}
	if displayName != nil && *displayName != "" {
		return *displayName
	}
	if username != nil {
		return *username
	}
	return ""
}

// userDisplaysResolver — bulk users-display lookup для ListMyTutors /
// ListStudents proto enrichment. Single SELECT с ANY($1::uuid[]) — N+1
// guard. Возвращает map ровно тех ids которые нашлись (missing — клиент
// видит пустые поля).
type userDisplaysResolver struct{ pool *pgxpool.Pool }

func (r *userDisplaysResolver) Resolve(
	ctx context.Context,
	ids []uuid.UUID,
) map[uuid.UUID]tutorPorts.UserDisplay {
	out := make(map[uuid.UUID]tutorPorts.UserDisplay, len(ids))
	if r == nil || r.pool == nil || len(ids) == 0 {
		return out
	}
	rows, err := r.pool.Query(ctx,
		`SELECT id, COALESCE(username,''), COALESCE(display_name,''), COALESCE(avatar_url,'')
		   FROM users WHERE id = ANY($1)`, ids,
	)
	if err != nil {
		return out
	}
	defer rows.Close()
	for rows.Next() {
		var (
			id       uuid.UUID
			username string
			display  string
			avatar   string
		)
		if err := rows.Scan(&id, &username, &display, &avatar); err != nil {
			continue
		}
		out[id] = tutorPorts.UserDisplay{
			Username:    username,
			DisplayName: display,
			AvatarURL:   avatar,
		}
	}
	return out
}

// notifySendAdapter bridges notify SendNotification UC к tutor app.NotifySender.
type notifySendAdapter struct{ uc *notifyApp.SendNotification }

func (a *notifySendAdapter) Send(
	ctx context.Context,
	userID uuid.UUID,
	notType enums.NotificationType,
	payload map[string]any,
) error {
	if a.uc == nil {
		return nil
	}
	return a.uc.Do(ctx, notifyApp.SendInput{
		UserID:  userID,
		Type:    notType,
		Payload: payload,
	})
}
