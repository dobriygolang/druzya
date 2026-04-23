// atlas_catalogue.go — admin-editable catalogue surface (nodes + edges).
//
// Lives alongside ProfileRepo because the data is read by the same
// /profile/me/atlas use case. The admin CRUD path is a separate
// repo-interface to keep ProfileRepo lean and to make the admin handler
// trivially mockable in tests.
package domain

import (
	"context"
	"errors"
)

// ErrConflict is raised when a unique constraint fails (e.g. duplicate
// edge). Admin handler maps it to HTTP 409.
var ErrConflict = errors.New("profile: conflict")

// AtlasCatalogueNode mirrors a row in atlas_nodes.
//
// Wave-10 (migration 00034) introduced PoE-passive-tree vocabulary:
//   - Kind ∈ {"hub","keystone","notable","small"} — see migration header.
//   - Cluster names a designer-grouped dense gathering (not a 72° sector).
//   - PosX/PosY remain hand-tuned (admin CMS) — clusters are organic.
type AtlasCatalogueNode struct {
	ID          string
	Title       string
	Section     string // enums.Section string (algorithms / sql / go / system_design / behavioral / data_structures / concurrency)
	Kind        string // hub | keystone | notable | small
	Cluster     string // visual cluster id (typically == Section but kept separate)
	Description string
	TotalCount  int
	PosX        *int // nil = first-render auto-place; CMS lets designer pin
	PosY        *int
	SortOrder   int
	IsActive    bool
}

// AtlasCatalogueEdge mirrors a row in atlas_edges.
//
// Kind ∈ {"prereq","suggested","crosslink"} — frontend renders three
// distinct visual grammars per design-review v2:
//
//	prereq    — solid thick + arrow, gates allocation
//	suggested — solid thin, "logical next step"
//	crosslink — dashed faded, "related from another cluster"
type AtlasCatalogueEdge struct {
	ID   int64
	From string
	To   string
	Kind string // prereq | suggested | crosslink
}

// AtlasCatalogueRepo is the admin-CRUD surface over the atlas tree.
// All methods return wrapped errors with the operation name prefix.
type AtlasCatalogueRepo interface {
	ListNodes(ctx context.Context) ([]AtlasCatalogueNode, error)    // is_active = TRUE
	ListAllNodes(ctx context.Context) ([]AtlasCatalogueNode, error) // for admin
	GetNode(ctx context.Context, id string) (AtlasCatalogueNode, error)
	UpsertNode(ctx context.Context, n AtlasCatalogueNode) error
	UpdateNodePosition(ctx context.Context, id string, posX, posY *int) error
	DeleteNode(ctx context.Context, id string) error
	CountEdgesFor(ctx context.Context, id string) (int, error)

	ListEdges(ctx context.Context) ([]AtlasCatalogueEdge, error)
	CreateEdge(ctx context.Context, from, to, kind string) (int64, error)
	DeleteEdge(ctx context.Context, id int64) error
}
