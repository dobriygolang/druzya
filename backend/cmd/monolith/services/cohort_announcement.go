// Package services — wiring for the cohort announcement bounded context.
//
// Cross-service plumbing: announcements service has zero direct dep on
// cohort. Membership lookup is bridged through CohortMembershipBridge
// (mirrors the slot↔review pattern in services/review.go).
package services

import (
	"context"
	"errors"
	"fmt"

	cohortDomain "druz9/cohort/domain"
	announcementApp "druz9/cohort_announcement/app"
	announcementDomain "druz9/cohort_announcement/domain"
	announcementInfra "druz9/cohort_announcement/infra"
	announcementPorts "druz9/cohort_announcement/ports"
	"druz9/shared/generated/pb/druz9/v1/druz9v1connect"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
)

// CohortMembershipBridge adapts cohort.Repo to the announcement service's
// MembershipLookup port.
type CohortMembershipBridge struct {
	Cohorts cohortDomain.Repo
}

func (b CohortMembershipBridge) LookupMembership(ctx context.Context, cohortID, userID uuid.UUID) (announcementDomain.Role, error) {
	role, err := b.Cohorts.GetMemberRole(ctx, cohortID, userID)
	if err != nil {
		if errors.Is(err, cohortDomain.ErrNotFound) {
			return announcementDomain.RoleNotMember, nil
		}
		return announcementDomain.RoleNotMember, fmt.Errorf("CohortMembershipBridge: %w", err)
	}
	switch role {
	case cohortDomain.RoleOwner:
		return announcementDomain.RoleOwner, nil
	case cohortDomain.RoleCoach:
		return announcementDomain.RoleCoach, nil
	case cohortDomain.RoleMember:
		return announcementDomain.RoleMember, nil
	default:
		return announcementDomain.RoleNotMember, nil
	}
}

// NewCohortAnnouncement wires the announcement bounded context. cohortRepo
// is supplied by NewCohort (which now also returns the repo so this
// service can bridge into membership checks).
func NewCohortAnnouncement(d Deps, cohortRepo cohortDomain.Repo) *Module {
	if d.Log == nil {
		panic("cohort_announcement: nil logger")
	}
	if cohortRepo == nil {
		panic("cohort_announcement: nil cohortRepo (must wire after NewCohort)")
	}
	pg := announcementInfra.NewPostgres(d.Pool)
	bridge := CohortMembershipBridge{Cohorts: cohortRepo}

	create := &announcementApp.CreateAnnouncement{Repo: pg, Membership: bridge, Bus: d.Bus}
	list := &announcementApp.ListByCohort{Repo: pg, Membership: bridge}
	delUC := &announcementApp.DeleteAnnouncement{Repo: pg, Membership: bridge}
	add := &announcementApp.AddReaction{Repo: pg, Membership: bridge}
	rem := &announcementApp.RemoveReaction{Repo: pg, Membership: bridge}

	server := announcementPorts.NewServer(create, list, delUC, add, rem, d.Log)
	connectPath, connectHandler := druz9v1connect.NewCohortAnnouncementServiceHandler(server)
	transcoder := mustTranscode("cohort_announcement", connectPath, connectHandler)

	return &Module{
		ConnectPath:        connectPath,
		ConnectHandler:     transcoder,
		RequireConnectAuth: true,
		MountREST: func(r chi.Router) {
			r.Get("/cohort/{cohort_id}/announcement", transcoder.ServeHTTP)
			r.Post("/cohort/{cohort_id}/announcement", transcoder.ServeHTTP)
			r.Delete("/cohort/announcement/{announcement_id}", transcoder.ServeHTTP)
			r.Post("/cohort/announcement/{announcement_id}/react", transcoder.ServeHTTP)
			r.Delete("/cohort/announcement/{announcement_id}/react/{emoji}", transcoder.ServeHTTP)
		},
	}
}
