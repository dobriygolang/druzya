package domain

import (
	"context"

	"github.com/google/uuid"
)

// OrgRepo is the persistence port for the orgs bounded context.
//
// STRATEGIC SCAFFOLD: no implementation exists yet. The Postgres adapter
// will land in `infra/postgres.go` against migration 00027_orgs.sql.
type OrgRepo interface {
	CreateOrg(ctx context.Context, o Organization) (uuid.UUID, error)
	GetOrg(ctx context.Context, id uuid.UUID) (Organization, error)
	GetOrgBySlug(ctx context.Context, slug string) (Organization, error)

	AddMember(ctx context.Context, m OrgMember) error
	ListMembers(ctx context.Context, orgID uuid.UUID) ([]OrgMember, error)

	CreateSeat(ctx context.Context, s OrgSeat) (uuid.UUID, error)
	AssignSeatToUser(ctx context.Context, seatID, userID uuid.UUID) error
	RevokeSeat(ctx context.Context, seatID uuid.UUID) error
	ListSeats(ctx context.Context, orgID uuid.UUID) ([]OrgSeat, error)

	Dashboard(ctx context.Context, orgID uuid.UUID, weekISO string) (DashboardSnapshot, error)
}
