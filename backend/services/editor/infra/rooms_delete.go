package infra

import (
	"context"
	"fmt"

	"druz9/editor/domain"

	"github.com/google/uuid"
)

// DeleteOwned removes the editor_rooms row only when owner_id matches.
// CASCADE on FK takes care of editor_participants. Returns domain.ErrNotFound
// when no row matched (either non-owner or unknown id) — handlers MUST NOT
// distinguish between the two to avoid leaking room existence to non-owners.
func (r *Rooms) DeleteOwned(ctx context.Context, id, ownerID uuid.UUID) error {
	tag, err := r.pool.Exec(ctx,
		`DELETE FROM editor_rooms WHERE id = $1 AND owner_id = $2`,
		id, ownerID,
	)
	if err != nil {
		return fmt.Errorf("editor.Rooms.DeleteOwned: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return domain.ErrNotFound
	}
	return nil
}
