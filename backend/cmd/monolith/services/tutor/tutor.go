// Package tutor wires the tutor bounded context into the monolith.
// Wave 2 of docs/feature/tutor.md (tutor as distribution channel).
//
// The proto's PeekInvite RPC is intentionally PUBLIC (the /invite/{code}
// landing page must render before student auth). The REST gate in
// router.go whitelists the corresponding GET path.
package tutor

import (
	monolithServices "druz9/cmd/monolith/services"
	"druz9/shared/generated/pb/druz9/v1/druz9v1connect"
	tutorApp "druz9/tutor/app"
	tutorInfra "druz9/tutor/infra"
	tutorPorts "druz9/tutor/ports"

	"github.com/go-chi/chi/v5"
)

// TutorDeps groups the optional cross-context plug-ins. All fields
// are nilable: when missing, the corresponding RPC degrades cleanly
// (PeekInvite returns empty tutor_display; brief returns empty
// markdown). This keeps the module boot-able in environments without
// LLMChain or profile reader.
type TutorDeps struct {
	TutorDisplay tutorPorts.TutorDisplayLookup
	Briefer      tutorApp.PreSessionBriefer
}

func NewTutor(d monolithServices.Deps, tdeps TutorDeps) *monolithServices.Module {
	repo := tutorInfra.NewPostgres(d.Pool)
	// *Postgres satisfies both domain.Repo and domain.SnapshotRepo —
	// we pass it to both use-case slots without an adapter.
	getSnapshot := &tutorApp.GetStudentSnapshot{Repo: repo, Now: d.Now}
	server := &tutorPorts.TutorServer{
		CreateInviteUC:    &tutorApp.CreateInvite{Repo: repo, Now: d.Now},
		RevokeInviteUC:    &tutorApp.RevokeInvite{Repo: repo, Now: d.Now},
		AcceptInviteUC:    &tutorApp.AcceptInvite{Repo: repo, Now: d.Now},
		ListInvitesUC:     &tutorApp.ListInvites{Repo: repo},
		ListStudentsUC:    &tutorApp.ListStudents{Repo: repo},
		PeekInviteUC:      &tutorApp.PeekInvite{Repo: repo, Now: d.Now},
		EndRelationshipUC: &tutorApp.EndRelationship{Repo: repo, Now: d.Now},
		GetSnapshotUC:     getSnapshot,
		GenerateBriefUC: &tutorApp.GeneratePreSessionBrief{
			Snapshot: getSnapshot,
			Briefer:  tdeps.Briefer,
		},
		// Wave 5.1 — assignments. *Postgres satisfies domain.AssignmentRepo
		// (CreateAssignment / List* / MarkComplete / ArchiveAssignment +
		// the shared EnsureRelationship). Same struct, three interfaces.
		PushAssignmentUC:          &tutorApp.PushAssignment{Repo: repo, Now: d.Now},
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

		TutorDisplay: tdeps.TutorDisplay,
		Log:          d.Log,
	}

	connectPath, connectHandler := druz9v1connect.NewTutorServiceHandler(server)
	transcoder := monolithServices.MustTranscode("tutor", connectPath, connectHandler)

	return &monolithServices.Module{
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
			r.Post("/tutor/students/{student_id}/end", transcoder.ServeHTTP)
			r.Get("/tutor/students/{student_id}/snapshot", transcoder.ServeHTTP)
			r.Get("/tutor/students/{student_id}/brief", transcoder.ServeHTTP)
			// Wave 5.1 — assignments REST aliases.
			r.Post("/tutor/students/{student_id}/assignments", transcoder.ServeHTTP)
			r.Get("/tutor/students/{student_id}/assignments", transcoder.ServeHTTP)
			r.Get("/tutor/assignments/pending", transcoder.ServeHTTP)
			r.Post("/tutor/assignments/{assignment_id}/complete", transcoder.ServeHTTP)
			r.Post("/tutor/assignments/{assignment_id}/archive", transcoder.ServeHTTP)
			r.Post("/tutor/assignments/broadcast", transcoder.ServeHTTP) // Wave 5.2a
		},
	}
}
